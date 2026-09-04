/**
 * Structured logging, with correlation.
 *
 * Three properties make a log worth having, and none of them is the log line
 * itself:
 *
 *   * **Correlation.** One identifier carried from the request that started the
 *     work through every line it produced. Without it, a production
 *     investigation is grep and hope.
 *   * **Tenancy.** Every line says which company it belongs to, so an incident
 *     affecting one tenant can be separated from noise, and so a support
 *     question can be answered without reading another customer's activity.
 *   * **Safety.** Everything is redacted on the way out. See `redaction.ts` —
 *     a log line is the easiest place in a platform to leak a credential.
 *
 * The sink is injected and the clock is injected, so this is pure and testable
 * and cannot itself perform I/O behind the caller's back.
 */

import { redact } from './redaction.ts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const LEVELS: Readonly<Record<LogLevel, number>> = Object.freeze({
  debug: 10, info: 20, warn: 30, error: 40,
});

export interface LogRecord {
  timestamp: string;
  level: LogLevel;
  message: string;
  /** The request or job this line belongs to. */
  correlationId?: string;
  companyId?: string;
  actorId?: string;
  /** The component that emitted it, e.g. `api.gateway`. */
  source?: string;
  fields?: Record<string, unknown>;
  /** Milliseconds, when the line closes a timed operation. */
  durationMs?: number;
}

export type Sink = (record: LogRecord) => void;

export interface LoggerOptions {
  sink: Sink;
  /** Injected, because a logger that reads the clock cannot be tested exactly. */
  now: () => Date;
  level?: LogLevel;
  source?: string;
  correlationId?: string;
  companyId?: string;
  actorId?: string;
  /** Fields added to every record this logger emits. */
  context?: Record<string, unknown>;
}

/** A sink that writes one JSON object per line, which is what aggregators read. */
export function jsonLineSink(write: (line: string) => void): Sink {
  return (record) => {
    // Never throws: a logging failure must not take the request with it.
    try {
      write(JSON.stringify(record));
    } catch {
      try {
        write(JSON.stringify({
          timestamp: record.timestamp, level: 'error', message: 'log record could not be serialized',
          correlationId: record.correlationId, source: record.source,
        }));
      } catch { /* nothing further is safe to attempt */ }
    }
  };
}

export class Logger {
  private readonly sink: Sink;
  private readonly now: () => Date;
  private readonly threshold: number;
  private readonly base: Pick<LogRecord, 'source' | 'correlationId' | 'companyId' | 'actorId'>;
  private readonly context: Record<string, unknown>;

  constructor(options: LoggerOptions) {
    this.sink = options.sink;
    this.now = options.now;
    this.threshold = LEVELS[options.level ?? 'info'];
    this.base = {
      source: options.source,
      correlationId: options.correlationId,
      companyId: options.companyId,
      actorId: options.actorId,
    };
    this.context = options.context ?? {};
  }

  /** A logger carrying everything this one does, plus more. */
  child(extra: Partial<LoggerOptions> & { context?: Record<string, unknown> }): Logger {
    return new Logger({
      sink: this.sink,
      now: this.now,
      level: (Object.entries(LEVELS).find(([, v]) => v === this.threshold)?.[0] ?? 'info') as LogLevel,
      source: extra.source ?? this.base.source,
      correlationId: extra.correlationId ?? this.base.correlationId,
      companyId: extra.companyId ?? this.base.companyId,
      actorId: extra.actorId ?? this.base.actorId,
      context: { ...this.context, ...(extra.context ?? {}) },
    });
  }

  isEnabled(level: LogLevel): boolean {
    return LEVELS[level] >= this.threshold;
  }

  log(level: LogLevel, message: string, fields?: Record<string, unknown>, durationMs?: number): void {
    if (!this.isEnabled(level)) return;
    const merged = { ...this.context, ...(fields ?? {}) };
    const record: LogRecord = {
      timestamp: this.now().toISOString(),
      level,
      message: String(redact(message)),
      ...this.base,
      ...(Object.keys(merged).length ? { fields: redact(merged) as Record<string, unknown> } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    };
    // A failing sink must not propagate. Losing a line is bad; failing the
    // request that produced it is worse.
    try { this.sink(record); } catch { /* the sink is the caller's problem */ }
  }

  debug(message: string, fields?: Record<string, unknown>): void { this.log('debug', message, fields); }
  info(message: string, fields?: Record<string, unknown>): void { this.log('info', message, fields); }
  warn(message: string, fields?: Record<string, unknown>): void { this.log('warn', message, fields); }
  error(message: string, fields?: Record<string, unknown>): void { this.log('error', message, fields); }

  /**
   * Time an operation and log how long it took, whether it succeeded or not.
   *
   * A duration recorded only on success hides exactly the case worth seeing:
   * the call that took nine seconds and then failed.
   */
  async time<T>(
    message: string,
    fn: () => Promise<T>,
    fields?: Record<string, unknown>,
  ): Promise<T> {
    const started = this.now().getTime();
    try {
      const result = await fn();
      this.log('info', message, { ...fields, outcome: 'ok' }, this.now().getTime() - started);
      return result;
    } catch (err) {
      this.log('error', message, { ...fields, outcome: 'failed', error: err },
        this.now().getTime() - started);
      throw err;
    }
  }
}

/** A correlation id: short, sortable by time, and not a source of entropy anyone relies on. */
export function newCorrelationId(now: Date, random: () => number = Math.random): string {
  const time = now.getTime().toString(36).padStart(9, '0');
  const noise = Math.floor(random() * 0xffffff).toString(36).padStart(5, '0');
  return `${time}-${noise}`;
}

/**
 * The correlation id for an incoming request.
 *
 * An id supplied by the caller is honored so a trace can span the client and
 * the platform — but only when it is short and plain, because an unvalidated
 * header ends up in every log line and in whatever reads them.
 */
export function correlationIdFrom(
  headerValue: string | null,
  now: Date,
  random: () => number = Math.random,
): string {
  const supplied = (headerValue ?? '').trim();
  if (/^[A-Za-z0-9._-]{8,64}$/.test(supplied)) return supplied;
  return newCorrelationId(now, random);
}
