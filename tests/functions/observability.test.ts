/**
 * Observability.
 *
 * The redaction suite is deliberately adversarial. A log line is the easiest
 * place in a platform to leak a credential, and every case below is a way it
 * has actually happened somewhere: a header object logged whole, a token pasted
 * into a free-text note, a stack trace carrying a URL with a key in the query
 * string.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  redact, redactSecrets, containsSecret, isRedactedField, REDACTED,
  REDACTED_FIELDS, MAX_VALUE_LENGTH,
} from '../../supabase/functions/_shared/observability/redaction.ts';
import {
  Logger, jsonLineSink, newCorrelationId, correlationIdFrom, LEVELS,
  type LogRecord,
} from '../../supabase/functions/_shared/observability/logger.ts';
import {
  Metrics, MetricLabelError, MAX_LABELS, MAX_LABEL_LENGTH, type MetricRecord,
} from '../../supabase/functions/_shared/observability/metrics.ts';
import {
  checkHealth, healthHttpStatus, databaseCheck, livenessCheck, type HealthCheck,
} from '../../supabase/functions/_shared/observability/health.ts';

const AT = new Date('2026-09-03T09:15:00.000Z');
const now = () => AT;

const API_KEY = `gu_live_7Kd2mNvQ${'a'.repeat(32)}`;
const STRIPE = 'sk_live_51H8xKzABCDEFGHIJKLMNOP';
const WEBHOOK = 'whsec_ABCDEFGHIJKLMNOPQRSTUVWX';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';

// --------------------------------------------------------------- redaction
describe('redaction by field name', () => {
  it('redacts every name on the list', () => {
    for (const f of REDACTED_FIELDS) {
      const out = redact({ [f]: 'something sensitive' }) as Record<string, unknown>;
      expect(out[f], f).toBe(REDACTED);
    }
  });

  it('is case and whitespace insensitive', () => {
    expect(isRedactedField('Authorization')).toBe(true);
    expect(isRedactedField('  API_KEY ')).toBe(true);
  });

  it('leaves business fields that merely look similar alone', () => {
    // A loose rule like "anything ending in _key" would redact these and make
    // the logs useless.
    const out = redact({
      role_key: 'owner', metric_key: 'gross_margin_percent',
      idempotency_key: 'noaa:KTOL:2026-08-24', partition_key: 'p1',
    }) as Record<string, string>;
    expect(out.role_key).toBe('owner');
    expect(out.metric_key).toBe('gross_margin_percent');
    expect(out.idempotency_key).toBe('noaa:KTOL:2026-08-24');
  });

  it('redacts a header object logged whole', () => {
    const rendered = JSON.stringify(redact({
      headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}`, cookie: 'sb=abc' },
    }));
    expect(containsSecret(rendered)).toBeNull();
    expect(rendered).toContain('application/json');
  });
});

describe('redaction by value shape', () => {
  const cases: [string, string][] = [
    ['a GrounUp API key', API_KEY],
    ['a Stripe secret key', STRIPE],
    ['a Stripe webhook secret', WEBHOOK],
    ['a JSON web token', JWT],
    ['a bearer credential', `Bearer ${API_KEY}`],
  ];

  for (const [label, secret] of cases) {
    it(`redacts ${label} wherever it appears`, () => {
      // The safety net a name list can never provide: a credential pasted into
      // a field nobody thought of.
      const rendered = JSON.stringify(redact({
        notes: `customer sent ${secret} by email`,
        nested: { deeper: [{ value: secret }] },
      }));
      expect(containsSecret(rendered), label).toBeNull();
      expect(rendered).toContain(REDACTED);
    });
  }

  it('redacts a private key block', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----';
    expect(containsSecret(redactSecrets(pem))).toBeNull();
  });

  it('redacts a token inside a stack trace', () => {
    // A stack can carry a URL with a key in the query string.
    const err = new Error('request failed');
    err.stack = `Error: request failed\n    at fetch (https://api.example.com/v1?key=${API_KEY})`;
    const rendered = JSON.stringify(redact({ error: err }));
    expect(containsSecret(rendered)).toBeNull();
    expect(rendered).toContain('request failed');
  });

  it('does not mangle text that merely resembles a key', () => {
    const out = redactSecrets('the sku is SK-1042 and the lot is EY-77');
    expect(out).toBe('the sku is SK-1042 and the lot is EY-77');
  });
});

describe('redaction never breaks the caller', () => {
  it('survives a circular object', () => {
    const a: Record<string, unknown> = { name: 'loop' };
    a.self = a;
    expect(() => redact(a)).not.toThrow();
    expect(JSON.stringify(redact(a))).toContain('[circular]');
  });

  it('survives a deeply nested object', () => {
    let deep: Record<string, unknown> = { end: true };
    for (let i = 0; i < 40; i++) deep = { nested: deep };
    expect(JSON.stringify(redact(deep))).toContain('[too deep]');
  });

  it('truncates a value that would make the record unbounded', () => {
    const out = redact({ body: 'x'.repeat(MAX_VALUE_LENGTH + 500) }) as { body: string };
    expect(out.body.length).toBeLessThan(MAX_VALUE_LENGTH + 100);
    expect(out.body).toContain('more characters');
  });

  it('renders a non-finite number rather than emitting invalid JSON', () => {
    const out = redact({ ratio: Number.NaN, size: Number.POSITIVE_INFINITY }) as Record<string, unknown>;
    expect(out.ratio).toBe('NaN');
    expect(out.size).toBe('Infinity');
  });

  it('caps a very long array', () => {
    const out = redact(Array.from({ length: 500 }, (_, i) => i)) as number[];
    expect(out.length).toBeLessThanOrEqual(100);
  });
});

// ------------------------------------------------------------------ logger
describe('the logger', () => {
  const capture = () => {
    const records: LogRecord[] = [];
    return { records, sink: (r: LogRecord) => { records.push(r); } };
  };

  it('stamps the injected clock, not the wall clock', () => {
    const { records, sink } = capture();
    new Logger({ sink, now }).info('priced an estimate');
    expect(records[0]!.timestamp).toBe('2026-09-03T09:15:00.000Z');
  });

  it('carries correlation, tenancy and source on every line', () => {
    const { records, sink } = capture();
    const log = new Logger({
      sink, now, source: 'api.gateway',
      correlationId: 'abc123def', companyId: 'company-1', actorId: 'alice',
    });
    log.info('handled request');
    expect(records[0]).toMatchObject({
      source: 'api.gateway', correlationId: 'abc123def',
      companyId: 'company-1', actorId: 'alice',
    });
  });

  it('redacts fields on the way out', () => {
    const { records, sink } = capture();
    new Logger({ sink, now }).info('authenticated', { authorization: `Bearer ${API_KEY}`, route: '/v1/projects' });
    const rendered = JSON.stringify(records[0]);
    expect(containsSecret(rendered)).toBeNull();
    expect(rendered).toContain('/v1/projects');
  });

  it('redacts the message itself, not only the fields', () => {
    const { records, sink } = capture();
    new Logger({ sink, now }).error(`key ${API_KEY} was rejected`);
    expect(containsSecret(JSON.stringify(records[0]))).toBeNull();
  });

  it('honors the level threshold', () => {
    const { records, sink } = capture();
    const log = new Logger({ sink, now, level: 'warn' });
    log.debug('a'); log.info('b'); log.warn('c'); log.error('d');
    expect(records.map((r) => r.level)).toEqual(['warn', 'error']);
    expect(LEVELS.debug).toBeLessThan(LEVELS.error);
  });

  it('inherits context in a child and adds to it', () => {
    const { records, sink } = capture();
    const root = new Logger({ sink, now, correlationId: 'req-1', context: { region: 'us-east' } });
    root.child({ source: 'connector', context: { provider: 'noaa_nws' } }).info('run started');
    expect(records[0]!.correlationId).toBe('req-1');
    expect(records[0]!.source).toBe('connector');
    expect(records[0]!.fields).toMatchObject({ region: 'us-east', provider: 'noaa_nws' });
  });

  it('never lets a failing sink break the caller', () => {
    // Losing a line is bad. Failing the request that produced it is worse.
    const log = new Logger({ sink: () => { throw new Error('aggregator down'); }, now });
    expect(() => log.info('still fine')).not.toThrow();
  });

  it('times an operation that succeeds', async () => {
    const { records, sink } = capture();
    let t = 0;
    const clock = () => new Date(AT.getTime() + (t += 25));
    const log = new Logger({ sink, now: clock });
    await log.time('query', async () => 'ok');
    expect(records[0]!.durationMs).toBe(25);
    expect(records[0]!.fields).toMatchObject({ outcome: 'ok' });
  });

  it('times an operation that fails, and rethrows', async () => {
    const { records, sink } = capture();
    let t = 0;
    const log = new Logger({ sink, now: () => new Date(AT.getTime() + (t += 40)) });
    // A duration recorded only on success hides the call that took nine
    // seconds and then failed.
    await expect(log.time('query', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(records[0]!.level).toBe('error');
    expect(records[0]!.durationMs).toBe(40);
    expect(records[0]!.fields).toMatchObject({ outcome: 'failed' });
  });

  it('writes one JSON object per line', () => {
    const lines: string[] = [];
    const sink = jsonLineSink((l) => lines.push(l));
    new Logger({ sink, now, source: 's' }).info('hello', { a: 1 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ message: 'hello', source: 's' });
  });

  it('degrades rather than throwing when a record will not serialize', () => {
    const lines: string[] = [];
    const sink = jsonLineSink((l) => lines.push(l));
    const bad = { toJSON() { throw new Error('nope'); } };
    expect(() => sink({
      timestamp: AT.toISOString(), level: 'info', message: 'x',
      fields: { bad } as Record<string, unknown>,
    })).not.toThrow();
    expect(lines[0]).toContain('could not be serialized');
  });
});

describe('correlation ids', () => {
  it('is stable for a fixed clock and random source', () => {
    expect(newCorrelationId(AT, () => 0.5)).toBe(newCorrelationId(AT, () => 0.5));
  });

  it('honors a plain id supplied by the caller, so a trace can span both', () => {
    expect(correlationIdFrom('client-req-0001', AT)).toBe('client-req-0001');
  });

  it('refuses a supplied id that is not plain', () => {
    // An unvalidated header ends up in every log line and in whatever reads
    // them.
    for (const bad of ['', 'short', 'x'.repeat(200), 'has spaces', '<script>alert(1)</script>', 'a;b']) {
      expect(correlationIdFrom(bad, AT, () => 0.5), bad).not.toBe(bad);
    }
  });

  it('generates one when none is supplied', () => {
    expect(correlationIdFrom(null, AT, () => 0.5)).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
  });
});

// ----------------------------------------------------------------- metrics
describe('metrics', () => {
  const capture = () => {
    const records: MetricRecord[] = [];
    return { records, sink: (r: MetricRecord) => { records.push(r); } };
  };

  it('records counters, durations and gauges', () => {
    const { records, sink } = capture();
    const m = new Metrics({ sink, now });
    m.count('api.request', { route: '/v1/projects' });
    m.duration('api.latency', 42, { route: '/v1/projects' });
    m.gauge('connector.consecutive_failures', 3);
    expect(records.map((r) => r.kind)).toEqual(['counter', 'duration', 'gauge']);
    expect(records[1]!.value).toBe(42);
  });

  it('carries tenancy and correlation without making them labels', () => {
    const { records, sink } = capture();
    new Metrics({ sink, now, companyId: 'c1', correlationId: 'r1' }).count('api.request');
    // A company id as a label turns one metric into a million time series.
    expect(records[0]!.companyId).toBe('c1');
    expect(records[0]!.labels).toBeUndefined();
  });

  it('refuses an identifier used as a label', () => {
    const { sink } = capture();
    const m = new Metrics({ sink, now });
    expect(() => m.count('api.request', { project: 'x'.repeat(MAX_LABEL_LENGTH + 1) }))
      .toThrow(MetricLabelError);
  });

  it('refuses more dimensions than keep a metric queryable', () => {
    const { sink } = capture();
    const labels = Object.fromEntries(
      Array.from({ length: MAX_LABELS + 1 }, (_, i) => [`l${i}`, 'v']));
    expect(() => new Metrics({ sink, now }).count('m', labels)).toThrow(/above the/);
  });

  it('drops a non-finite measurement rather than emitting it', () => {
    const { records, sink } = capture();
    new Metrics({ sink, now }).duration('api.latency', Number.NaN);
    expect(records).toEqual([]);
  });

  it('never lets a failing sink break the thing being measured', () => {
    const m = new Metrics({ sink: () => { throw new Error('down'); }, now });
    expect(() => m.count('api.request')).not.toThrow();
  });

  it('merges labels from a child', () => {
    const { records, sink } = capture();
    new Metrics({ sink, now, labels: { service: 'api' } })
      .child({ labels: { route: '/v1/projects' } }).count('request');
    expect(records[0]!.labels).toEqual({ service: 'api', route: '/v1/projects' });
  });
});

// ------------------------------------------------------------------ health
describe('health and readiness', () => {
  const pass = (name: string, kind: HealthCheck['kind'] = 'readiness', critical = true): HealthCheck =>
    ({ name, critical, kind, run: async () => ({ status: 'pass' }) });

  it('reports healthy when everything passes', async () => {
    const r = await checkHealth([pass('database'), livenessCheck()], { now });
    expect(r.status).toBe('healthy');
    expect(healthHttpStatus(r)).toBe(200);
  });

  it('reports unhealthy when a critical check fails', async () => {
    const r = await checkHealth([
      { name: 'database', critical: true, kind: 'readiness', run: async () => ({ status: 'fail', detail: 'unreachable' }) },
    ], { now });
    expect(r.status).toBe('unhealthy');
    expect(healthHttpStatus(r)).toBe(503);
  });

  it('reports degraded, and still serves, when a non-critical check fails', async () => {
    const r = await checkHealth([
      pass('database'),
      { name: 'weather', critical: false, kind: 'readiness', run: async () => ({ status: 'fail' }) },
    ], { now });
    // Taking a node out of rotation because one non-critical dependency is
    // slow removes capacity exactly when it is needed.
    expect(r.status).toBe('degraded');
    expect(healthHttpStatus(r)).toBe(200);
  });

  it('fails a check that hangs rather than waiting for it', async () => {
    vi.useFakeTimers();
    try {
      const hanging: HealthCheck = {
        name: 'stuck', critical: true, kind: 'readiness',
        run: () => new Promise(() => { /* never settles */ }),
      };
      const promise = checkHealth([hanging], { now, timeoutMs: 50 });
      await vi.advanceTimersByTimeAsync(60);
      const r = await promise;
      // A health check that hangs is worse than one that fails: the balancer
      // waits and nothing is ever reported.
      expect(r.status).toBe('unhealthy');
      expect(r.checks[0]!.detail).toContain('did not answer within 50ms');
    } finally {
      vi.useRealTimers();
    }
  });

  it('turns a thrown check into a failure rather than an exception', async () => {
    const r = await checkHealth([
      { name: 'broken', critical: true, kind: 'readiness', run: async () => { throw new Error('connection refused'); } },
    ], { now });
    expect(r.status).toBe('unhealthy');
    expect(r.checks[0]!.status).toBe('fail');
  });

  it('runs only the kind asked for', async () => {
    const r = await checkHealth([pass('database'), livenessCheck()], { now, kind: 'liveness' });
    expect(r.checks.map((c) => c.name)).toEqual(['process']);
  });

  it('says nothing about the database on success', async () => {
    const probe = vi.fn(async () => [{ ok: 1 }]);
    const r = await checkHealth([databaseCheck(probe)], { now });
    // A server version or connection string in a public health payload is free
    // reconnaissance.
    expect(r.checks[0]!.detail).toBeUndefined();
    expect(probe).toHaveBeenCalledOnce();
  });

  it('reports the database unreachable without echoing the connection', async () => {
    const r = await checkHealth([
      databaseCheck(async () => { throw new Error('could not connect'); }),
    ], { now });
    expect(r.status).toBe('unhealthy');
    expect(r.checks[0]!.status).toBe('fail');
  });

  it('runs checks concurrently rather than summing their latency', async () => {
    vi.useFakeTimers();
    try {
      const slow = (name: string): HealthCheck => ({
        name, critical: false, kind: 'readiness',
        run: () => new Promise((resolve) => setTimeout(() => resolve({ status: 'pass' }), 100)),
      });
      const promise = checkHealth([slow('a'), slow('b'), slow('c')], { now, timeoutMs: 500 });
      await vi.advanceTimersByTimeAsync(120);
      const r = await promise;
      // Sequential checks would make the endpoint's own latency the sum of
      // every dependency, which is the thing it exists to warn about.
      expect(r.status).toBe('healthy');
      expect(r.checks).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('carries the build version when given one', async () => {
    const r = await checkHealth([livenessCheck()], { now, version: '1.4.2' });
    expect(r.version).toBe('1.4.2');
    expect(r.checkedAt).toBe('2026-09-03T09:15:00.000Z');
  });
});
