/**
 * GET /functions/v1/health        — readiness: can this serve traffic now?
 * GET /functions/v1/health/live   — liveness: is the process working at all?
 * GET /functions/v1/health/ai     — is the AI credential actually accepted?
 *
 * Separated deliberately. A failing readiness check means take me out of
 * rotation; a failing liveness check means restart me. Restarting because the
 * database blipped turns a small outage into a crash loop.
 *
 * The payload is public by design — a load balancer cannot authenticate — so it
 * says whether each dependency is reachable and nothing about how. A server
 * version or a connection string here is free reconnaissance.
 */
import { createClient } from '@supabase/supabase-js';
import {
  checkHealth, healthHttpStatus, databaseCheck, livenessCheck, credentialCheck,
} from '../_shared/observability/health.ts';
import {
  Logger, jsonLineSink, correlationIdFrom,
} from '../_shared/observability/logger.ts';
import { Metrics } from '../_shared/observability/metrics.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUILD_VERSION = Deno.env.get('GROUNUP_BUILD_VERSION') ?? undefined;

const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/*
 * The AI credential check, and why it is its own path.
 *
 * `ANTHROPIC_API_KEY` being *present* proved nothing: one was set on this
 * project and every call still failed with `401 authentication_error / API key
 * is invalid`, which was visible only to somebody reading `ingestion_jobs`
 * afterwards. Nothing on the platform said the AI could not work.
 *
 * `/v1/models` is the probe rather than a message: it answers the only question
 * being asked — does the provider accept this credential — and generates no
 * tokens, so checking costs nothing however often it is asked.
 *
 * Not on the default readiness path, deliberately. A load balancer polling
 * every few seconds must not make an outbound request to a third party, and the
 * answer changes about as often as somebody rotates a key. The result is held
 * for a minute so that an open endpoint cannot be used to hammer the provider.
 */
const AI_PROBE_CACHE_MS = 60_000;
let aiProbe: { at: number; result: { status: 'pass' | 'warn' | 'fail'; detail?: string } } | null = null;

async function probeAiCredential(signal: AbortSignal) {
  const cached = aiProbe;
  if (cached && Date.now() - cached.at < AI_PROBE_CACHE_MS) return cached.result;

  /*
   * Trimmed, because a secret is typed or pasted by a person and a trailing
   * newline is invisible in every interface that shows one. An API key with a
   * stray space is rejected exactly like a wrong key, which sends somebody
   * looking for a problem that is not there.
   */
  const key = Deno.env.get('ANTHROPIC_API_KEY')?.trim();
  if (!key) {
    const result = { status: 'fail' as const, detail: 'no credential is configured' };
    aiProbe = { at: Date.now(), result };
    return result;
  }

  let result: { status: 'pass' | 'warn' | 'fail'; detail?: string };
  try {
    const response = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal,
    });
    result = response.ok
      ? { status: 'pass' }
      /*
       * The status code, never the body. This payload is public, and a
       * provider's error text can carry an account or organization identifier.
       */
      : response.status === 401 || response.status === 403
        ? { status: 'fail', detail: 'the provider refused this credential' }
        : { status: 'warn', detail: `the provider answered ${response.status}` };
  } catch {
    result = { status: 'warn', detail: 'the provider could not be reached' };
  }
  aiProbe = { at: Date.now(), result };
  return result;
}

const logSink = jsonLineSink((line) => console.log(line));
const metricSink = (record: unknown) => console.log(JSON.stringify({ metric: record }));

Deno.serve(async (req) => {
  const now = () => new Date();
  const correlationId = correlationIdFrom(req.headers.get('x-correlation-id'), now());
  const log = new Logger({ sink: logSink, now, source: 'health', correlationId });
  const metrics = new Metrics({ sink: metricSink, now, correlationId, labels: { service: 'health' } });

  const url = new URL(req.url);
  const wantsLiveness = url.pathname.endsWith('/live');
  /* Opt in, by path or by query, so the ordinary probe stays local. */
  const wantsAi = url.pathname.endsWith('/ai') || url.searchParams.get('check') === 'ai';

  const report = await checkHealth([
    livenessCheck(),
    databaseCheck(async (signal) => {
      // The cheapest query that proves the connection works and RLS is loaded.
      const { error } = await service.from('plans').select('id', { head: true, count: 'exact' })
        .abortSignal(signal);
      if (error) throw new Error(error.message);
    }),
    ...(wantsAi ? [credentialCheck('ai_provider', probeAiCredential)] : []),
  ], {
    now,
    kind: wantsLiveness ? 'liveness' : 'readiness',
    version: BUILD_VERSION,
  });

  const status = healthHttpStatus(report);
  metrics.count('health.check', { kind: wantsLiveness ? 'liveness' : 'readiness', status: report.status });
  metrics.duration('health.duration', report.durationMs);
  // Only a problem is worth a line. A readiness probe every few seconds would
  // otherwise become the loudest thing in the logs.
  if (report.status !== 'healthy') {
    log.warn('health check reported a problem', {
      status: report.status,
      failing: report.checks.filter((c) => c.status !== 'pass').map((c) => c.name),
    });
  }

  return new Response(JSON.stringify(report), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Correlation-Id': correlationId,
    },
  });
});
