/**
 * The connector runtime.
 *
 * One place where every adapter is executed, so retry, failure classification,
 * idempotency and run recording behave identically no matter which vendor is on
 * the other end. An adapter that had to implement these itself would implement
 * them slightly differently each time, which is how integrations quietly
 * double-post payroll.
 */

import { ConnectorError, type ConnectorAdapter, type ConnectorContext, type NormalizedRecord } from './types.ts';

export interface RunRecord {
  connectorId: string;
  companyId: string;
  direction: 'inbound' | 'outbound';
  startedAt: string;
  finishedAt: string;
  recordsRead: number;
  recordsWritten: number;
  recordsSkipped: number;
  idempotencyKey: string | null;
  status: 'succeeded' | 'partial' | 'failed' | 'skipped';
  errorMessage: string | null;
  warnings: string[];
}

export interface RunOutcome {
  run: RunRecord;
  records: NormalizedRecord[];
}

/** Persists normalized records; returns how many it actually wrote. */
export type RecordWriter = (records: readonly NormalizedRecord[]) => Promise<number>;

export interface RunOptions {
  /** Attempts for a retryable failure, including the first. */
  maxAttempts?: number;
  /** Milliseconds to wait before attempt n (1-indexed). Injected for tests. */
  backoffMs?: (attempt: number) => number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_BACKOFF = (attempt: number) => Math.min(1000 * 2 ** (attempt - 1), 30_000);

/**
 * Run one adapter and produce the record that goes into `connector_runs`.
 *
 * Never throws for a connector-level failure: a failed run is a row, not an
 * exception, because a connector that fails silently and a connector that
 * crashes the scheduler are both worse than one that records what went wrong.
 */
export async function runConnector(
  adapter: ConnectorAdapter,
  ctx: ConnectorContext,
  write: RecordWriter,
  options: RunOptions = {},
): Promise<RunOutcome> {
  const maxAttempts = options.maxAttempts ?? 3;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const startedAt = ctx.now().toISOString();

  const base = {
    connectorId: ctx.connectorId,
    companyId: ctx.companyId,
    direction: adapter.direction,
    startedAt,
  };

  const configProblems = adapter.validateConfig(ctx.config);
  if (configProblems.length) {
    return {
      records: [],
      run: {
        ...base,
        finishedAt: ctx.now().toISOString(),
        recordsRead: 0, recordsWritten: 0, recordsSkipped: 0,
        idempotencyKey: null,
        status: 'failed',
        // A misconfiguration is not retried. Retrying a bad config just
        // produces the same failure three times and hides the real cause.
        errorMessage: `Configuration is invalid: ${configProblems.join('; ')}`,
        warnings: [],
      },
    };
  }

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await adapter.fetch(ctx);
      let written = 0;
      let writeError: string | null = null;
      try {
        written = await write(result.records);
      } catch (err) {
        writeError = err instanceof Error ? err.message : String(err);
      }

      const partial = writeError !== null || result.skipped.length > 0;
      return {
        records: result.records,
        run: {
          ...base,
          finishedAt: ctx.now().toISOString(),
          recordsRead: result.records.length + result.skipped.length,
          recordsWritten: written,
          recordsSkipped: result.skipped.length,
          idempotencyKey: result.idempotencyKey,
          status: partial ? 'partial' : 'succeeded',
          errorMessage: writeError
            ?? (result.skipped.length
              ? `${result.skipped.length} record(s) skipped: ${result.skipped.slice(0, 3).map((s) => s.reason).join('; ')}`
              : null),
          warnings: result.warnings,
        },
      };
    } catch (err) {
      lastError = err;
      const retryable = err instanceof ConnectorError ? err.retryable : false;
      if (!retryable || attempt === maxAttempts) break;
      await sleep(backoffMs(attempt));
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  return {
    records: [],
    run: {
      ...base,
      finishedAt: ctx.now().toISOString(),
      recordsRead: 0, recordsWritten: 0, recordsSkipped: 0,
      idempotencyKey: null,
      status: 'failed',
      errorMessage: message,
      warnings: [],
    },
  };
}

/** Every adapter the runtime can dispatch to. */
export function buildRegistry(adapters: readonly ConnectorAdapter[]): Map<string, ConnectorAdapter> {
  const map = new Map<string, ConnectorAdapter>();
  for (const a of adapters) {
    const key = `${a.type}:${a.provider}`;
    if (map.has(key)) throw new Error(`Duplicate connector adapter registered for ${key}`);
    map.set(key, a);
  }
  return map;
}
