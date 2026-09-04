/**
 * Health and readiness.
 *
 * Two different questions, deliberately separated:
 *
 *   * **Liveness** — is this process working at all? A failing liveness check
 *     means restart me.
 *   * **Readiness** — can it serve traffic right now? A failing readiness check
 *     means take me out of rotation, but do not restart me: the database being
 *     briefly unreachable is not fixed by killing the process, and restarting
 *     on a dependency blip turns a small outage into a crash loop.
 *
 * Conflating them is how a slow database becomes an outage.
 *
 * The rule that matters most here is the timeout. A health check that hangs is
 * worse than one that fails: the load balancer waits, the request queue backs
 * up, and nothing is ever reported. Every check is raced against a deadline and
 * a check that misses it is a failure with that stated as the reason.
 */

export type CheckStatus = 'pass' | 'warn' | 'fail';
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface CheckResult {
  status: CheckStatus;
  /** Safe to show. Never a connection string, a query or a credential. */
  detail?: string;
}

export interface HealthCheck {
  name: string;
  /**
   * Whether the platform can serve without it. A failing critical check makes
   * the whole thing unhealthy; a non-critical one only degrades it.
   */
  critical: boolean;
  kind: 'liveness' | 'readiness';
  run: (signal: AbortSignal) => Promise<CheckResult>;
}

export interface CheckReport extends CheckResult {
  name: string;
  critical: boolean;
  kind: HealthCheck['kind'];
  durationMs: number;
}

export interface HealthReport {
  status: HealthStatus;
  checkedAt: string;
  durationMs: number;
  version?: string;
  checks: readonly CheckReport[];
}

/** A check that has not answered by now is a failure, not a wait. */
export const DEFAULT_CHECK_TIMEOUT_MS = 2000;

export interface HealthOptions {
  now: () => Date;
  timeoutMs?: number;
  version?: string;
  /** Run only liveness or only readiness checks. */
  kind?: HealthCheck['kind'];
}

async function runOne(check: HealthCheck, timeoutMs: number, now: () => Date): Promise<CheckReport> {
  const started = now().getTime();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<CheckResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ status: 'fail', detail: `did not answer within ${timeoutMs}ms` });
    }, timeoutMs);
  });

  let result: CheckResult;
  try {
    result = await Promise.race([check.run(controller.signal), timeout]);
  } catch (err) {
    // The message is the check author's, and they are told to keep it safe.
    // Anything unexpected is reported as a bare failure rather than echoed.
    result = { status: 'fail', detail: err instanceof Error ? err.message : 'check threw' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  return {
    name: check.name,
    critical: check.critical,
    kind: check.kind,
    status: result.status,
    ...(result.detail ? { detail: result.detail } : {}),
    durationMs: Math.max(0, now().getTime() - started),
  };
}

/**
 * Run the checks and aggregate.
 *
 * Checks run concurrently: sequential checks would make the endpoint's own
 * latency the sum of every dependency, which is the thing it exists to warn
 * about.
 */
export async function checkHealth(
  checks: readonly HealthCheck[],
  options: HealthOptions,
): Promise<HealthReport> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
  const selected = options.kind ? checks.filter((c) => c.kind === options.kind) : checks;
  const started = options.now().getTime();

  const results = await Promise.all(selected.map((c) => runOne(c, timeoutMs, options.now)));

  const failedCritical = results.some((r) => r.critical && r.status === 'fail');
  const anyProblem = results.some((r) => r.status !== 'pass');

  return {
    status: failedCritical ? 'unhealthy' : anyProblem ? 'degraded' : 'healthy',
    checkedAt: options.now().toISOString(),
    durationMs: Math.max(0, options.now().getTime() - started),
    ...(options.version ? { version: options.version } : {}),
    checks: results,
  };
}

/**
 * The HTTP status a report should be served with.
 *
 * Degraded is 200: the platform is serving, and taking a node out of rotation
 * because one non-critical dependency is slow removes capacity exactly when it
 * is needed. Only unhealthy is 503.
 */
export function healthHttpStatus(report: HealthReport): number {
  return report.status === 'unhealthy' ? 503 : 200;
}

/** A check that runs a trivial query, for database reachability. */
export function databaseCheck(
  probe: (signal: AbortSignal) => Promise<unknown>,
  options: { name?: string; critical?: boolean } = {},
): HealthCheck {
  return {
    name: options.name ?? 'database',
    critical: options.critical ?? true,
    kind: 'readiness',
    run: async (signal) => {
      await probe(signal);
      // Deliberately no detail on success: a connection string or a server
      // version in a public health payload is free reconnaissance.
      return { status: 'pass' };
    },
  };
}

/** A check that the process is running and can execute code. */
export function livenessCheck(): HealthCheck {
  return {
    name: 'process',
    critical: true,
    kind: 'liveness',
    run: async () => ({ status: 'pass' }),
  };
}
