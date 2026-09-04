/**
 * Public API gateway logic.
 *
 * Everything here is pure and dependency-free so the authorization decisions —
 * the ones that decide whether a caller sees another company's data — are unit
 * testable without a database, a network or a deployment.
 *
 * The order of checks is deliberate and is the security property of the whole
 * surface:
 *
 *   1. Parse the key. A malformed key is rejected before anything is hashed.
 *   2. Look the key up by hash. The key itself is never stored, so a database
 *      read yields nothing replayable.
 *   3. Reject revoked and expired keys before scopes are considered.
 *   4. Check the scope for the matched route.
 *   5. Check the rate limit.
 *   6. Only then does the request reach data — and it reaches it filtered to
 *      the key's own company, which is not negotiable by any scope.
 *
 * A scope says what *kind* of record a caller may read. The company says which
 * records exist. Conflating those two is how an API grows a hole.
 */

export const API_VERSION = 'v1';

/** Every scope the API recognizes. An unknown scope on a key is inert. */
export const SCOPES = [
  'projects:read', 'projects:write',
  'estimates:read',
  'finance:read', 'finance:write',
  'fleet:read', 'fleet:write',
  'workforce:read', 'workforce:write',
  'metrics:read',
] as const;
export type Scope = typeof SCOPES[number];

export interface RouteDef {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Path template with `{param}` placeholders, relative to /v1. */
  template: string;
  scope: Scope;
  summary: string;
  /** The relation the handler reads or writes. */
  resource: string;
}

export const ROUTES: readonly RouteDef[] = [
  { method: 'GET', template: '/projects', scope: 'projects:read', resource: 'projects',
    summary: 'List projects.' },
  { method: 'GET', template: '/projects/{projectId}', scope: 'projects:read', resource: 'projects',
    summary: 'Retrieve one project.' },
  { method: 'GET', template: '/projects/{projectId}/cost-summary', scope: 'finance:read',
    resource: 'reporting_project_financials',
    summary: 'Committed, actual and forecast cost for a project.' },
  { method: 'GET', template: '/projects/{projectId}/change-orders', scope: 'projects:read',
    resource: 'change_orders', summary: 'Change orders on a project.' },
  { method: 'GET', template: '/estimates/{estimateId}', scope: 'estimates:read', resource: 'estimates',
    summary: 'Retrieve an estimate and its current version.' },
  { method: 'GET', template: '/equipment/{equipmentId}/hours', scope: 'fleet:read',
    resource: 'equipment_meter_readings', summary: 'Meter readings, with the source of each.' },
  { method: 'POST', template: '/equipment/{equipmentId}/hours', scope: 'fleet:write',
    resource: 'equipment_meter_readings', summary: 'Record a meter reading from telematics.' },
  { method: 'POST', template: '/time-entries', scope: 'workforce:write', resource: 'time_entries',
    summary: 'Create a time entry.' },
  { method: 'GET', template: '/metrics/{metricKey}', scope: 'metrics:read', resource: 'metric_definitions',
    summary: 'Evaluate a governed metric.' },
];

export interface MatchedRoute {
  route: RouteDef;
  params: Record<string, string>;
}

/**
 * Match a request path against the route table.
 *
 * Matching is exact segment-by-segment: no prefix matching, no wildcards. A
 * router that falls through to a permissive default is how an unscoped
 * endpoint ends up serving data.
 */
export function matchRoute(method: string, path: string): MatchedRoute | null {
  const clean = path.replace(/\/+$/, '') || '/';
  const stripped = clean.startsWith(`/${API_VERSION}`) ? clean.slice(API_VERSION.length + 1) || '/' : clean;
  const parts = stripped.split('/');
  if (parts[0] === '') parts.shift();
  // An empty interior segment is rejected rather than collapsed. Collapsing it
  // shifts every parameter left, so `/projects//cost-summary` would quietly
  // resolve to "the project named cost-summary" instead of a 404.
  if (parts.some((p) => p === '')) return null;

  for (const route of ROUTES) {
    if (route.method !== method.toUpperCase()) continue;
    const tParts = route.template.split('/').filter((p) => p !== '');
    if (tParts.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < tParts.length; i++) {
      const t = tParts[i]!;
      const v = parts[i]!;
      if (t.startsWith('{') && t.endsWith('}')) {
        params[t.slice(1, -1)] = decodeURIComponent(v);
      } else if (t !== v) { ok = false; break; }
    }
    if (ok) return { route, params };
  }
  return null;
}

export const KEY_PATTERN = /^gu_(live|test)_([A-Za-z0-9]{8})([A-Za-z0-9]{32})$/;

export interface ParsedKey {
  environment: 'live' | 'test';
  /** The prefix stored alongside the hash, for identifying a key in a log. */
  prefix: string;
  raw: string;
}

/** Parse `Authorization: Bearer gu_live_…`. Never logs or returns the secret. */
export function parseAuthorization(header: string | null): ParsedKey | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!m) return null;
  const raw = m[1]!;
  const k = KEY_PATTERN.exec(raw);
  if (!k) return null;
  return { environment: k[1] as 'live' | 'test', prefix: `gu_${k[1]}_${k[2]}`, raw };
}

export interface KeyRecord {
  id: string;
  companyId: string;
  scopes: string[];
  rateLimitPerMinute: number;
  expiresAt: string | null;
  revokedAt: string | null;
}

export type Denial =
  | { code: 'unauthenticated'; status: 401; message: string }
  | { code: 'key_revoked'; status: 401; message: string }
  | { code: 'key_expired'; status: 401; message: string }
  | { code: 'not_found'; status: 404; message: string }
  | { code: 'insufficient_scope'; status: 403; message: string; requiredScope: Scope }
  | { code: 'rate_limited'; status: 429; message: string; retryAfterSeconds: number };

export interface Authorized {
  key: KeyRecord;
  match: MatchedRoute;
}

export interface RateState {
  /** Requests already counted in the current window. */
  count: number;
  /** When the current window began. */
  windowStart: Date;
}

/**
 * The complete authorization decision for one request.
 *
 * Returns either a denial or an authorization naming the company every
 * downstream query must be filtered to. There is no third outcome, and no way
 * to reach data without going through this.
 */
export function authorize(input: {
  method: string;
  path: string;
  authorization: string | null;
  lookup: (prefix: string) => KeyRecord | null;
  rate: RateState | null;
  now: Date;
}): Denial | Authorized {
  const parsed = parseAuthorization(input.authorization);
  if (!parsed) {
    return {
      code: 'unauthenticated', status: 401,
      message: 'Provide an API key as `Authorization: Bearer gu_live_…`.',
    };
  }

  const key = input.lookup(parsed.prefix);
  if (!key) {
    // Deliberately identical to a malformed key: distinguishing "no such key"
    // from "wrong key" turns the endpoint into a key-existence oracle.
    return {
      code: 'unauthenticated', status: 401,
      message: 'Provide an API key as `Authorization: Bearer gu_live_…`.',
    };
  }

  if (key.revokedAt !== null) {
    return { code: 'key_revoked', status: 401, message: 'This API key has been revoked.' };
  }
  if (key.expiresAt !== null && new Date(key.expiresAt).getTime() <= input.now.getTime()) {
    return { code: 'key_expired', status: 401, message: 'This API key has expired.' };
  }

  const match = matchRoute(input.method, input.path);
  if (!match) {
    return { code: 'not_found', status: 404, message: `No such endpoint: ${input.method} ${input.path}` };
  }

  if (!key.scopes.includes(match.route.scope)) {
    return {
      code: 'insufficient_scope', status: 403,
      message: `This endpoint requires the ${match.route.scope} scope.`,
      requiredScope: match.route.scope,
    };
  }

  if (input.rate) {
    const elapsed = input.now.getTime() - input.rate.windowStart.getTime();
    if (elapsed < 60_000 && input.rate.count >= key.rateLimitPerMinute) {
      return {
        code: 'rate_limited', status: 429,
        message: `Rate limit of ${key.rateLimitPerMinute} requests per minute exceeded.`,
        retryAfterSeconds: Math.max(1, Math.ceil((60_000 - elapsed) / 1000)),
      };
    }
  }

  return { key, match };
}

export function isDenial(r: Denial | Authorized): r is Denial {
  return 'code' in r;
}

/** Pagination that cannot be used to pull the whole table in one request. */
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

export interface Page { limit: number; offset: number; problems: string[] }

export function parsePagination(params: URLSearchParams): Page {
  const problems: string[] = [];
  let limit = DEFAULT_PAGE_SIZE;
  let offset = 0;

  const rawLimit = params.get('limit');
  if (rawLimit !== null) {
    const n = Number(rawLimit);
    if (!Number.isInteger(n) || n < 1) problems.push('limit must be a positive integer');
    else if (n > MAX_PAGE_SIZE) {
      // Clamped rather than rejected: a caller asking for more than the cap
      // gets the cap and is told, instead of a 400 that breaks their loop.
      limit = MAX_PAGE_SIZE;
      problems.push(`limit was reduced to the maximum of ${MAX_PAGE_SIZE}`);
    } else limit = n;
  }

  const rawOffset = params.get('offset');
  if (rawOffset !== null) {
    const n = Number(rawOffset);
    if (!Number.isInteger(n) || n < 0) problems.push('offset must be a non-negative integer');
    else offset = n;
  }

  return { limit, offset, problems };
}

/** One error shape everywhere, so a caller can handle failures generically. */
export function errorBody(d: Denial): Record<string, unknown> {
  return {
    error: {
      code: d.code,
      message: d.message,
      ...(d.code === 'insufficient_scope' ? { required_scope: d.requiredScope } : {}),
      ...(d.code === 'rate_limited' ? { retry_after_seconds: d.retryAfterSeconds } : {}),
    },
  };
}

export function responseHeaders(d?: Denial): Record<string, string> {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    // A response that names a company is never cacheable by a shared proxy.
    'X-Content-Type-Options': 'nosniff',
    ...(d?.code === 'rate_limited' ? { 'Retry-After': String(d.retryAfterSeconds) } : {}),
  };
}
