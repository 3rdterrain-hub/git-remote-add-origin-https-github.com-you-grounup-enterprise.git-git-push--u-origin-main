/**
 * Metrics.
 *
 * Counters and durations, emitted through an injected sink like the logger.
 * Deliberately not a client for any particular backend: what this platform
 * needs is that the measurement happens at the right place with the right
 * dimensions, and where it is shipped is a deployment decision that has not
 * been made yet (P31).
 *
 * Dimensions are bounded on purpose. An unbounded label — a project id, an
 * estimate number — turns one metric into a million time series, which is how
 * a metrics bill arrives and how a dashboard stops loading. Tenancy is carried
 * as `companyId` on the record rather than as a label for the same reason.
 */

export type MetricKind = 'counter' | 'duration' | 'gauge';

export interface MetricRecord {
  timestamp: string;
  kind: MetricKind;
  name: string;
  value: number;
  /** Bounded, low-cardinality dimensions. */
  labels?: Record<string, string>;
  companyId?: string;
  correlationId?: string;
}

export type MetricSink = (record: MetricRecord) => void;

/** More than this many distinct label values on one metric is a modeling error. */
export const MAX_LABELS = 8;
/** A label value longer than this is almost certainly an identifier. */
export const MAX_LABEL_LENGTH = 64;

export class MetricLabelError extends Error {
  constructor(message: string, readonly metric: string) {
    super(message);
    this.name = 'MetricLabelError';
  }
}

function assertLabels(name: string, labels?: Record<string, string>): void {
  if (!labels) return;
  const keys = Object.keys(labels);
  if (keys.length > MAX_LABELS) {
    throw new MetricLabelError(
      `${name} carries ${keys.length} labels, above the ${MAX_LABELS} that keep a metric queryable.`, name);
  }
  for (const [k, v] of Object.entries(labels)) {
    if (typeof v !== 'string') {
      throw new MetricLabelError(`${name} label ${k} must be a string, received ${typeof v}.`, name);
    }
    if (v.length > MAX_LABEL_LENGTH) {
      // An id as a label turns one metric into a million time series.
      throw new MetricLabelError(
        `${name} label ${k} is ${v.length} characters, which is an identifier rather than a dimension.`, name);
    }
  }
}

export interface MetricsOptions {
  sink: MetricSink;
  now: () => Date;
  companyId?: string;
  correlationId?: string;
  /** Labels applied to every metric from this instance. */
  labels?: Record<string, string>;
}

export class Metrics {
  constructor(private readonly options: MetricsOptions) {}

  private emit(kind: MetricKind, name: string, value: number, labels?: Record<string, string>): void {
    if (!Number.isFinite(value)) return;
    const merged = { ...(this.options.labels ?? {}), ...(labels ?? {}) };
    assertLabels(name, merged);
    const record: MetricRecord = {
      timestamp: this.options.now().toISOString(),
      kind, name, value,
      ...(Object.keys(merged).length ? { labels: merged } : {}),
      ...(this.options.companyId ? { companyId: this.options.companyId } : {}),
      ...(this.options.correlationId ? { correlationId: this.options.correlationId } : {}),
    };
    // Same rule as the logger: measurement must never break the thing measured.
    try { this.options.sink(record); } catch { /* the sink is the caller's problem */ }
  }

  /** Something happened. */
  count(name: string, labels?: Record<string, string>, by = 1): void {
    this.emit('counter', name, by, labels);
  }

  /** Something took this long, in milliseconds. */
  duration(name: string, milliseconds: number, labels?: Record<string, string>): void {
    this.emit('duration', name, milliseconds, labels);
  }

  /** Something is currently this. */
  gauge(name: string, value: number, labels?: Record<string, string>): void {
    this.emit('gauge', name, value, labels);
  }

  child(extra: Partial<MetricsOptions>): Metrics {
    return new Metrics({
      ...this.options, ...extra,
      labels: { ...(this.options.labels ?? {}), ...(extra.labels ?? {}) },
    });
  }
}
