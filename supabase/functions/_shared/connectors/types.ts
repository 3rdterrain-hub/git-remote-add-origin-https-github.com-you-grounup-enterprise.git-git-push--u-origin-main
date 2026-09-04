/**
 * The connector adapter contract.
 *
 * Every external system — accounting, payroll, telematics, weather — reaches
 * GrounUp through one of these. The contract exists so the runtime can treat
 * Sage and a weather service identically: authenticate, pull a window, map to
 * GrounUp records, report what happened.
 *
 * Three properties are deliberate:
 *
 *  1. `fetch` receives an injected `HttpFetch`. An adapter never calls the
 *     network directly, so every adapter is testable against recorded fixtures
 *     with no credentials and no live dependency.
 *  2. Credentials arrive as a `CredentialBag` resolved from the platform secret
 *     store by the runtime. An adapter cannot read the database, so it cannot
 *     leak one tenant's data into another's request.
 *  3. `map` is separate from `fetch`. Vendor payload shapes change; the mapping
 *     from a vendor record to a GrounUp record is where that churn is absorbed,
 *     and it is pure, so it can be tested exhaustively.
 *
 * This module is dependency-free and Deno-free on purpose: the same file runs
 * inside an Edge Function and under the test runner.
 */

export type ConnectorType =
  | 'accounting' | 'payroll' | 'telematics' | 'fuel_card'
  | 'machine_control' | 'weather' | 'storage' | 'esignature' | 'webhook';

export type Direction = 'inbound' | 'outbound';

/** The subset of `fetch` an adapter is allowed to use. */
export type HttpFetch = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

/**
 * Resolved credentials.
 *
 * The runtime resolves `connectors.credential_ref` against the secret store and
 * hands the adapter only the values it declared. Nothing here is ever written
 * back to the database or included in a run record.
 */
export type CredentialBag = Readonly<Record<string, string>>;

export interface CredentialRequirement {
  key: string;
  label: string;
  /** Whether the connector can run at all without it. */
  required: boolean;
  help?: string;
}

/** What an adapter needs to know about the tenant it is running for. */
export interface ConnectorContext {
  companyId: string;
  connectorId: string;
  /** Adapter-specific settings from `connectors.config`. */
  config: Readonly<Record<string, unknown>>;
  credentials: CredentialBag;
  /** Inclusive start of the window to pull, ISO date or timestamp. */
  since: string;
  /** Exclusive end of the window. */
  until: string;
  http: HttpFetch;
  /** Injected so a run is reproducible in a test. */
  now: () => Date;
}

/**
 * One record produced by an adapter, already normalized.
 *
 * `externalId` is what makes a rerun safe: the runtime upserts on
 * (connector_id, target, externalId), so pulling an overlapping window twice
 * updates rather than duplicates.
 */
export interface NormalizedRecord {
  /** The GrounUp table this record is destined for. */
  target: string;
  externalId: string;
  /** Column values, already in GrounUp's units and vocabulary. */
  values: Record<string, unknown>;
  /** Anything the adapter could not map, kept for diagnosis. */
  unmapped?: Record<string, unknown>;
}

/** A record the adapter refused, with the reason. */
export interface SkippedRecord {
  externalId: string;
  reason: string;
}

export interface FetchResult {
  records: NormalizedRecord[];
  skipped: SkippedRecord[];
  /** Warnings that did not stop the run. */
  warnings: string[];
  /**
   * A stable key for this window. A rerun with the same key is a no-op at the
   * database level — the runtime relies on this for the idempotency index on
   * `connector_runs`.
   */
  idempotencyKey: string;
}

export interface ConnectorAdapter {
  readonly provider: string;
  readonly type: ConnectorType;
  readonly displayName: string;
  readonly direction: Direction;
  readonly credentialRequirements: readonly CredentialRequirement[];
  /**
   * Validate `connectors.config` before the connector may be enabled.
   * Returns the problems; an empty array means the config is usable.
   */
  validateConfig(config: Readonly<Record<string, unknown>>): string[];
  fetch(ctx: ConnectorContext): Promise<FetchResult>;
}

/** Raised by an adapter when the remote system is at fault, not the config. */
export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}

/** Config validation helpers, so every adapter reports problems the same way. */
export function requireString(
  config: Readonly<Record<string, unknown>>, key: string, problems: string[],
): string | null {
  const v = config[key];
  if (typeof v !== 'string' || v.trim() === '') {
    problems.push(`${key} is required and must be a non-empty string`);
    return null;
  }
  return v.trim();
}

export function requireNumber(
  config: Readonly<Record<string, unknown>>, key: string, problems: string[],
  opts: { min?: number; max?: number } = {},
): number | null {
  const v = config[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    problems.push(`${key} is required and must be a finite number`);
    return null;
  }
  if (opts.min !== undefined && v < opts.min) {
    problems.push(`${key} must be at least ${opts.min}, received ${v}`);
    return null;
  }
  if (opts.max !== undefined && v > opts.max) {
    problems.push(`${key} must be at most ${opts.max}, received ${v}`);
    return null;
  }
  return v;
}
