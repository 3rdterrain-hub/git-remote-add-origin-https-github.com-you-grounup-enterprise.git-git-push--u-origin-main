/**
 * API gateway authorization.
 *
 * These are the decisions that stand between an API key and another company's
 * data, so they are tested exhaustively and without a database — a security
 * check that can only be exercised against a deployment is a security check
 * nobody runs.
 */
import { describe, expect, it } from 'vitest';
import {
  ROUTES, SCOPES, matchRoute, parseAuthorization, authorize, isDenial,
  parsePagination, errorBody, responseHeaders, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE,
  type KeyRecord,
} from '../../supabase/functions/_shared/api/gateway.ts';

const NOW = new Date('2026-09-02T12:00:00Z');
const KEY = 'gu_live_7Kd2mNvQ' + 'a'.repeat(32);

function key(over: Partial<KeyRecord> = {}): KeyRecord {
  return {
    id: 'key-1', companyId: 'company-1',
    scopes: ['projects:read', 'finance:read'],
    rateLimitPerMinute: 120, expiresAt: null, revokedAt: null,
    ...over,
  };
}

const lookupOk = (k: KeyRecord = key()) => () => k;
const lookupNone = () => null;

function run(over: Partial<Parameters<typeof authorize>[0]> = {}) {
  return authorize({
    method: 'GET', path: '/v1/projects', authorization: `Bearer ${KEY}`,
    lookup: lookupOk(), rate: null, now: NOW, ...over,
  });
}

describe('the route table', () => {
  it('gives every route a scope the API recognizes', () => {
    for (const r of ROUTES) {
      expect(SCOPES, `${r.method} ${r.template}`).toContain(r.scope);
    }
  });

  it('guards every write route with a write scope', () => {
    for (const r of ROUTES) {
      if (r.method === 'GET') continue;
      // A write behind a read scope is the quiet version of no authorization.
      expect(r.scope.endsWith(':write'), `${r.method} ${r.template}`).toBe(true);
    }
  });

  it('declares no duplicate route', () => {
    const seen = new Set(ROUTES.map((r) => `${r.method} ${r.template}`));
    expect(seen.size).toBe(ROUTES.length);
  });
});

describe('route matching', () => {
  it('matches a literal path', () => {
    expect(matchRoute('GET', '/v1/projects')?.route.template).toBe('/projects');
  });

  it('matches with or without the version prefix', () => {
    expect(matchRoute('GET', '/projects')?.route.template).toBe('/projects');
  });

  it('extracts path parameters', () => {
    const m = matchRoute('GET', '/v1/projects/abc-123/cost-summary');
    expect(m?.params.projectId).toBe('abc-123');
    expect(m?.route.scope).toBe('finance:read');
  });

  it('decodes an encoded parameter', () => {
    expect(matchRoute('GET', '/v1/metrics/gross_margin_percent')?.params.metricKey)
      .toBe('gross_margin_percent');
  });

  it('separates methods on the same path', () => {
    expect(matchRoute('GET', '/v1/equipment/e1/hours')?.route.scope).toBe('fleet:read');
    expect(matchRoute('POST', '/v1/equipment/e1/hours')?.route.scope).toBe('fleet:write');
  });

  it('does not match a prefix', () => {
    // A router that falls through to a permissive default is how an unscoped
    // endpoint ends up serving data.
    expect(matchRoute('GET', '/v1/projects/abc/anything-else')).toBeNull();
    expect(matchRoute('GET', '/v1/projectsXYZ')).toBeNull();
  });

  it('ignores a trailing slash', () => {
    expect(matchRoute('GET', '/v1/projects/')?.route.template).toBe('/projects');
  });

  it('returns null for an empty path parameter', () => {
    expect(matchRoute('GET', '/v1/projects//cost-summary')).toBeNull();
  });
});

describe('key parsing', () => {
  it('accepts a well-formed bearer key', () => {
    const p = parseAuthorization(`Bearer ${KEY}`);
    expect(p?.environment).toBe('live');
    expect(p?.prefix).toBe('gu_live_7Kd2mNvQ');
  });

  it('is case-insensitive on the scheme', () => {
    expect(parseAuthorization(`bearer ${KEY}`)?.prefix).toBe('gu_live_7Kd2mNvQ');
  });

  it('rejects a missing or malformed header', () => {
    expect(parseAuthorization(null)).toBeNull();
    expect(parseAuthorization('')).toBeNull();
    expect(parseAuthorization(KEY)).toBeNull();
    expect(parseAuthorization(`Basic ${KEY}`)).toBeNull();
    expect(parseAuthorization('Bearer not-a-key')).toBeNull();
    expect(parseAuthorization('Bearer gu_live_short')).toBeNull();
  });

  it('never puts the secret in the prefix it exposes', () => {
    const p = parseAuthorization(`Bearer ${KEY}`)!;
    expect(KEY.startsWith(p.prefix)).toBe(true);
    expect(p.prefix.length).toBeLessThan(KEY.length);
  });
});

describe('authorization', () => {
  it('authorizes a key holding the required scope', () => {
    const r = run();
    expect(isDenial(r)).toBe(false);
    if (!isDenial(r)) expect(r.key.companyId).toBe('company-1');
  });

  it('rejects a request with no key', () => {
    const r = run({ authorization: null });
    expect(isDenial(r) && r.status).toBe(401);
  });

  it('gives an unknown key the same answer as a malformed one', () => {
    // Distinguishing "no such key" from "wrong key" turns the endpoint into a
    // key-existence oracle.
    const unknown = run({ lookup: lookupNone });
    const malformed = run({ authorization: 'Bearer nonsense' });
    expect(isDenial(unknown) && isDenial(malformed)).toBe(true);
    if (isDenial(unknown) && isDenial(malformed)) {
      expect(unknown.code).toBe(malformed.code);
      expect(unknown.message).toBe(malformed.message);
      expect(unknown.status).toBe(malformed.status);
    }
  });

  it('rejects a revoked key before considering its scopes', () => {
    const r = run({ lookup: lookupOk(key({ revokedAt: '2026-08-01T00:00:00Z' })) });
    expect(isDenial(r) && r.code).toBe('key_revoked');
  });

  it('rejects an expired key', () => {
    const r = run({ lookup: lookupOk(key({ expiresAt: '2026-09-01T00:00:00Z' })) });
    expect(isDenial(r) && r.code).toBe('key_expired');
  });

  it('accepts a key that has not expired yet', () => {
    expect(isDenial(run({ lookup: lookupOk(key({ expiresAt: '2027-01-01T00:00:00Z' })) }))).toBe(false);
  });

  it('rejects a key that expires exactly now', () => {
    const r = run({ lookup: lookupOk(key({ expiresAt: NOW.toISOString() })) });
    expect(isDenial(r) && r.code).toBe('key_expired');
  });

  it('refuses an endpoint the key has no scope for, and names the scope', () => {
    const r = run({ method: 'POST', path: '/v1/time-entries' });
    expect(isDenial(r) && r.code).toBe('insufficient_scope');
    if (isDenial(r) && r.code === 'insufficient_scope') {
      expect(r.requiredScope).toBe('workforce:write');
      expect(r.status).toBe(403);
    }
  });

  it('does not let a read scope reach a write endpoint', () => {
    const r = run({
      method: 'POST', path: '/v1/equipment/e1/hours',
      lookup: lookupOk(key({ scopes: ['fleet:read'] })),
    });
    expect(isDenial(r) && r.code).toBe('insufficient_scope');
  });

  it('reports an unknown endpoint as not found, after the key is validated', () => {
    const r = run({ path: '/v1/payroll' });
    expect(isDenial(r) && r.status).toBe(404);
  });

  it('checks the key before the route, so a bad key never maps the surface', () => {
    // Answering 404 for an unknown path on an unauthenticated request would
    // let anyone enumerate which endpoints exist.
    const r = run({ path: '/v1/payroll', authorization: null });
    expect(isDenial(r) && r.status).toBe(401);
  });

  it('rate limits once the window count reaches the key limit', () => {
    const r = run({
      lookup: lookupOk(key({ rateLimitPerMinute: 10 })),
      rate: { count: 10, windowStart: new Date(NOW.getTime() - 30_000) },
    });
    expect(isDenial(r) && r.code).toBe('rate_limited');
    if (isDenial(r) && r.code === 'rate_limited') {
      expect(r.status).toBe(429);
      expect(r.retryAfterSeconds).toBe(30);
    }
  });

  it('allows the request that sits exactly under the limit', () => {
    expect(isDenial(run({
      lookup: lookupOk(key({ rateLimitPerMinute: 10 })),
      rate: { count: 9, windowStart: new Date(NOW.getTime() - 30_000) },
    }))).toBe(false);
  });

  it('starts a fresh window after sixty seconds', () => {
    expect(isDenial(run({
      lookup: lookupOk(key({ rateLimitPerMinute: 10 })),
      rate: { count: 500, windowStart: new Date(NOW.getTime() - 61_000) },
    }))).toBe(false);
  });

  it('always names the company the request must be filtered to', () => {
    const r = run({ lookup: lookupOk(key({ companyId: 'company-2' })) });
    expect(isDenial(r)).toBe(false);
    // The scope says what kind of record may be read; the company says which
    // records exist. No scope can widen the second.
    if (!isDenial(r)) expect(r.key.companyId).toBe('company-2');
  });

  it('ignores a scope the API does not recognize', () => {
    const r = run({
      path: '/v1/time-entries', method: 'POST',
      lookup: lookupOk(key({ scopes: ['*', 'admin', 'everything:write'] })),
    });
    expect(isDenial(r) && r.code).toBe('insufficient_scope');
  });
});

describe('pagination', () => {
  it('defaults to a sane page size', () => {
    const p = parsePagination(new URLSearchParams());
    expect(p.limit).toBe(DEFAULT_PAGE_SIZE);
    expect(p.offset).toBe(0);
    expect(p.problems).toEqual([]);
  });

  it('clamps rather than rejects an oversized limit', () => {
    const p = parsePagination(new URLSearchParams('limit=100000'));
    expect(p.limit).toBe(MAX_PAGE_SIZE);
    // Clamping keeps a caller's loop working; a 400 would just break it.
    expect(p.problems[0]).toContain('reduced to the maximum');
  });

  it('refuses a limit that is not a positive integer', () => {
    for (const q of ['limit=0', 'limit=-5', 'limit=abc', 'limit=1.5']) {
      expect(parsePagination(new URLSearchParams(q)).problems.length).toBeGreaterThan(0);
    }
  });

  it('refuses a negative offset', () => {
    expect(parsePagination(new URLSearchParams('offset=-1')).problems.length).toBeGreaterThan(0);
  });
});

describe('responses', () => {
  it('uses one error shape for every denial', () => {
    const r = run({ authorization: null });
    if (!isDenial(r)) throw new Error('expected a denial');
    expect(errorBody(r)).toEqual({
      error: { code: 'unauthenticated', message: expect.any(String) },
    });
  });

  it('includes the required scope so a caller can fix the key', () => {
    const r = run({ method: 'POST', path: '/v1/time-entries' });
    if (!isDenial(r)) throw new Error('expected a denial');
    expect(errorBody(r)).toMatchObject({ error: { required_scope: 'workforce:write' } });
  });

  it('sends Retry-After with a rate limit', () => {
    const r = run({
      lookup: lookupOk(key({ rateLimitPerMinute: 1 })),
      rate: { count: 1, windowStart: new Date(NOW.getTime() - 10_000) },
    });
    if (!isDenial(r)) throw new Error('expected a denial');
    expect(responseHeaders(r)['Retry-After']).toBe('50');
  });

  it('never allows a shared proxy to cache a tenant response', () => {
    expect(responseHeaders()['Cache-Control']).toBe('no-store');
  });
});
