/**
 * GET /functions/v1/health        — readiness: can this serve traffic now?
 * GET /functions/v1/health/live   — liveness: is the process working at all?
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
  checkHealth, healthHttpStatus, databaseCheck, livenessCheck,
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

const logSink = jsonLineSink((line) => console.log(line));
const metricSink = (record: unknown) => console.log(JSON.stringify({ metric: record }));

Deno.serve(async (req) => {
  const now = () => new Date();
  const correlationId = correlationIdFrom(req.headers.get('x-correlation-id'), now());
  const log = new Logger({ sink: logSink, now, source: 'health', correlationId });
  const metrics = new Metrics({ sink: metricSink, now, correlationId, labels: { service: 'health' } });

  const url = new URL(req.url);
  const wantsLiveness = url.pathname.endsWith('/live');

  const report = await checkHealth([
    livenessCheck(),
    databaseCheck(async (signal) => {
      // The cheapest query that proves the connection works and RLS is loaded.
      const { error } = await service.from('plans').select('id', { head: true, count: 'exact' })
        .abortSignal(signal);
      if (error) throw new Error(error.message);
    }),
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
