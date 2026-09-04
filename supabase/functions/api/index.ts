/**
 * The public API gateway.
 *
 * Every request from an external system enters here. The authorization
 * decision itself lives in `_shared/api/gateway.ts` and is exhaustively unit
 * tested without a deployment; this file is the part that cannot be — the
 * database reads, the key hashing, the request log.
 *
 * Two things are load-bearing:
 *
 *   * An API key is not a user, so there is no JWT and RLS has nothing to
 *     evaluate — the gateway runs with the service role and the company filter
 *     is therefore this code's own responsibility. Rather than trusting each
 *     handler to remember it, every query is built through `tenant`, which
 *     applies the filter itself. See the comment on that object.
 *   * The request is logged whatever the outcome, including the failures. An
 *     audit log that records only successes cannot answer the one question it
 *     will be asked: what did that key try to do.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  authorize, isDenial, parsePagination, errorBody, responseHeaders,
  type KeyRecord, type Denial,
} from '../_shared/api/gateway.ts';
import { Logger, jsonLineSink, correlationIdFrom } from '../_shared/observability/logger.ts';
import { Metrics } from '../_shared/observability/metrics.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/** SHA-256 of the presented key. The key itself is never stored or logged. */
async function hashKey(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/*
 * Logging and metrics.
 *
 * Everything a log line carries is redacted on the way out, which matters more
 * here than anywhere else in the platform: this is the one function that reads
 * an Authorization header on every request.
 */
const logSink = jsonLineSink((line) => console.log(line));
const metricSink = (record: unknown) => console.log(JSON.stringify({ metric: record }));

interface LogEntry {
  companyId: string | null;
  apiKeyId: string | null;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  errorCode: string | null;
  ip: string | null;
  userAgent: string | null;
}

async function logRequest(e: LogEntry): Promise<void> {
  if (!e.companyId) return; // Nothing to attribute an unauthenticated probe to.
  // A failure to log must not turn a successful request into an error for the
  // caller, but it must be visible in the function logs.
  const { error } = await service.from('api_requests').insert({
    company_id: e.companyId,
    api_key_id: e.apiKeyId,
    method: e.method,
    path: e.path,
    status_code: e.status,
    duration_ms: e.durationMs,
    error_code: e.errorCode,
    ip_address: e.ip,
    user_agent: e.userAgent,
  });
  if (error) console.error('api_requests insert failed', error.message);
}

/** Requests already made by this key inside the current minute. */
async function currentRate(apiKeyId: string): Promise<{ count: number; windowStart: Date }> {
  const windowStart = new Date(Date.now() - 60_000);
  const { count } = await service
    .from('api_requests')
    .select('id', { count: 'exact', head: true })
    .eq('api_key_id', apiKeyId)
    .gte('occurred_at', windowStart.toISOString());
  return { count: count ?? 0, windowStart };
}

function respond(status: number, body: unknown, denial?: Denial, correlationId?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...responseHeaders(denial),
      // Handed back so a customer reporting a problem can quote one id that
      // finds every line the request produced.
      ...(correlationId ? { 'X-Correlation-Id': correlationId } : {}),
    },
  });
}

Deno.serve(async (req) => {
  const started = Date.now();
  const now = () => new Date();
  // Honored from the caller when it is plain, so a trace can span the client
  // and the platform; generated otherwise.
  const correlationId = correlationIdFrom(req.headers.get('x-correlation-id'), now());
  const url = new URL(req.url);
  // Supabase routes /functions/v1/api/... to this function; the API's own
  // version prefix is what remains.
  const path = url.pathname.replace(/^\/functions\/v1\/api/, '') || '/';
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = req.headers.get('user-agent');
  const authorization = req.headers.get('authorization');

  const log = new Logger({
    sink: logSink, now, source: 'api.gateway', correlationId,
    context: { method: req.method, path },
  });
  const metrics = new Metrics({
    sink: metricSink, now, correlationId, labels: { service: 'api' },
  });

  let record: KeyRecord | null = null;

  // Resolve the key first so the authorization decision has something to work
  // with. The lookup is by hash, so nothing readable from the database can be
  // replayed against this endpoint.
  const bearer = /^Bearer\s+(\S+)$/i.exec(authorization?.trim() ?? '')?.[1];
  if (bearer) {
    const { data } = await service
      .from('api_keys')
      .select('id, company_id, scopes, rate_limit_per_minute, expires_at, revoked_at')
      .eq('key_hash', await hashKey(bearer))
      .maybeSingle();
    if (data) {
      record = {
        id: data.id, companyId: data.company_id, scopes: data.scopes ?? [],
        rateLimitPerMinute: data.rate_limit_per_minute,
        expiresAt: data.expires_at, revokedAt: data.revoked_at,
      };
    }
  }

  const rate = record ? await currentRate(record.id) : null;
  const decision = authorize({
    method: req.method, path, authorization,
    lookup: () => record, rate, now: new Date(),
  });

  if (isDenial(decision)) {
    const durationMs = Date.now() - started;
    await logRequest({
      companyId: record?.companyId ?? null, apiKeyId: record?.id ?? null,
      method: req.method, path, status: decision.status,
      durationMs, errorCode: decision.code, ip, userAgent,
    });
    metrics.count('api.request', { outcome: 'denied', code: decision.code });
    metrics.duration('api.duration', durationMs, { outcome: 'denied' });
    // The key itself never reaches the log: the record carries its id, and
    // every field is redacted on the way out regardless.
    log.warn('request denied', {
      status: decision.status, code: decision.code,
      apiKeyId: record?.id ?? null, companyId: record?.companyId ?? null,
    });
    return respond(decision.status, errorBody(decision), decision, correlationId);
  }

  const { key, match } = decision;

  /*
   * Every query below is built through `tenant`, never through the raw client.
   *
   * An API key is not a user, so there is no JWT for RLS to evaluate and the
   * gateway necessarily runs with the service role — which bypasses RLS. That
   * makes the company filter this code's own responsibility, and a filter that
   * each handler has to remember is a filter that will eventually be forgotten.
   *
   * So the filter is not left to the handlers: `tenant.from()` applies it, and
   * it is the only way a handler can reach a table. The one place a global row
   * is legitimately visible — a seeded metric definition owned by nobody — is
   * `tenant.fromWithGlobals()`, which is separate precisely so it has to be
   * chosen deliberately and shows up in a review.
   */
  /*
   * A client that says who is asking.
   *
   * The gateway authenticates with an API key and necessarily runs as the
   * service role, so `auth.uid()` in the database is null — and before
   * migration 0050 every row this function wrote was audited as an anonymous
   * insert. These headers reach the database as transaction-local request
   * headers, where `app.request_context()` reads them, so a change made through
   * the public API is attributable to the key that made it and to the request
   * it belonged to.
   *
   * Built per request rather than once at module load, because the labels are
   * per request. It is an HTTP wrapper; constructing one costs nothing.
   */
  const attributed = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        'x-grounup-actor': `api_key:${key.id}`,
        'x-grounup-correlation': correlationId,
      },
    },
  });

  const tenant = {
    from(table: string) {
      return {
        select: (columns: string) =>
          attributed.from(table).select(columns).eq('company_id', key.companyId),
        insert: (row: Record<string, unknown>) =>
          attributed.from(table).insert({ ...row, company_id: key.companyId }),
        upsert: (row: Record<string, unknown>, opts: { onConflict: string }) =>
          attributed.from(table).upsert({ ...row, company_id: key.companyId }, opts),
      };
    },
    /** Rows the company owns, plus platform-global rows owned by nobody. */
    fromWithGlobals(table: string, columns: string) {
      return attributed.from(table).select(columns)
        .or(`company_id.eq.${key.companyId},company_id.is.null`);
    },
  };

  const page = parsePagination(url.searchParams);

  try {
    let body: unknown;
    let status = 200;

    switch (match.route.template) {
      case '/projects': {
        const { data, error } = await tenant
          .from('projects')
          .select('id, number, name, status, contract_type, contract_value, planned_start, planned_finish')
          .order('number')
          .range(page.offset, page.offset + page.limit - 1);
        if (error) throw error;
        body = { data, page: { limit: page.limit, offset: page.offset }, warnings: page.problems };
        break;
      }
      case '/projects/{projectId}': {
        const { data, error } = await tenant
          .from('projects').select('*')
          .eq('id', match.params.projectId).maybeSingle();
        if (error) throw error;
        if (!data) { status = 404; body = { error: { code: 'not_found', message: 'No such project.' } }; }
        else body = { data };
        break;
      }
      case '/projects/{projectId}/cost-summary': {
        const { data, error } = await tenant
          .from('reporting_project_financials').select('*')
          .eq('project_id', match.params.projectId).maybeSingle();
        if (error) throw error;
        if (!data) { status = 404; body = { error: { code: 'not_found', message: 'No such project.' } }; }
        else body = { data };
        break;
      }
      case '/projects/{projectId}/change-orders': {
        const { data, error } = await tenant
          .from('change_orders')
          .select('id, number, title, status, origin, cost_impact, price_impact, schedule_impact_days, executed_at')
          .eq('project_id', match.params.projectId)
          .order('number')
          .range(page.offset, page.offset + page.limit - 1);
        if (error) throw error;
        body = { data, page: { limit: page.limit, offset: page.offset } };
        break;
      }
      case '/estimates/{estimateId}': {
        const { data, error } = await tenant
          .from('estimates')
          .select('*, estimate_versions!estimates_current_version_id_fkey(*)')
          .eq('id', match.params.estimateId).maybeSingle();
        if (error) throw error;
        if (!data) { status = 404; body = { error: { code: 'not_found', message: 'No such estimate.' } }; }
        else body = { data };
        break;
      }
      case '/equipment/{equipmentId}/hours': {
        if (req.method === 'GET') {
          const { data, error } = await tenant
            .from('meter_readings')
            .select('id, reading_at, hours, miles, source, is_meter_replacement')
            .eq('asset_id', match.params.equipmentId)
            .order('reading_at', { ascending: false })
            .range(page.offset, page.offset + page.limit - 1);
          if (error) throw error;
          body = { data, page: { limit: page.limit, offset: page.offset } };
        } else {
          const payload = await req.json().catch(() => null) as Record<string, unknown> | null;
          if (!payload) { status = 400; body = { error: { code: 'bad_request', message: 'A JSON body is required.' } }; break; }
          const { data, error } = await tenant.from('meter_readings').insert({
            asset_id: match.params.equipmentId,
            reading_at: payload.reading_at,
            hours: payload.hours ?? null,
            miles: payload.miles ?? null,
            is_meter_replacement: payload.is_meter_replacement === true,
            source: 'telematics',
          }).select().single();
          // A meter that goes backwards is refused by the database, not here.
          // The check belongs with the data so every path is subject to it.
          if (error) { status = 422; body = { error: { code: 'rejected', message: error.message } }; break; }
          status = 201;
          body = { data };
        }
        break;
      }
      case '/time-entries': {
        const payload = await req.json().catch(() => null) as Record<string, unknown> | null;
        if (!payload) { status = 400; body = { error: { code: 'bad_request', message: 'A JSON body is required.' } }; break; }
        const { data, error } = await tenant.from('time_entries').insert({
          employee_id: payload.employee_id,
          project_id: payload.project_id,
          cost_code_id: payload.cost_code_id ?? null,
          work_date: payload.work_date,
          straight_hours: payload.straight_hours ?? 0,
          overtime_hours: payload.overtime_hours ?? 0,
          doubletime_hours: payload.doubletime_hours ?? 0,
          source: 'api',
        }).select().single();
        if (error) { status = 422; body = { error: { code: 'rejected', message: error.message } }; break; }
        status = 201;
        body = { data };
        break;
      }
      case '/metrics/{metricKey}': {
        /*
         * This route is published as "Evaluate a governed metric" and returned
         * the definition — including the expression as SQL text — with no
         * number in it. A consumer asking for gross margin received a sentence
         * of SQL, and the promise was in the OpenAPI specification third
         * parties read.
         *
         * `reporting_metric_values` carries the definition and the value from
         * one place, so this route and any screen report the same figure. The
         * company filter is explicit because the gateway holds an API key
         * rather than a user and necessarily runs as the service role — the
         * same reason every other query here goes through `tenant`.
         *
         * A metric the company has overridden with its own definition is absent
         * from the view rather than answered from the platform's: the platform
         * does not execute SQL a tenant wrote, and returning the platform's
         * number under a name the company redefined would be a wrong answer
         * wearing a right label.
         */
        const { data, error } = await attributed
          .from('reporting_metric_values')
          .select('key, name, description, domain, unit, grain, source_view, ' +
                  'higher_is_better, target_value, value')
          .eq('company_id', key.companyId)
          .eq('key', match.params.metricKey)
          .maybeSingle();
        if (error) throw error;
        if (!data) {
          status = 404;
          body = { error: { code: 'not_found', message:
            'No such metric, or it is overridden by a company definition the platform does not evaluate.' } };
        } else body = { data };
        break;
      }
      default:
        status = 404;
        body = { error: { code: 'not_found', message: 'No such endpoint.' } };
    }

    const durationMs = Date.now() - started;
    await logRequest({
      companyId: key.companyId, apiKeyId: key.id, method: req.method, path,
      status, durationMs,
      errorCode: status >= 400 ? 'handler_error' : null, ip, userAgent,
    });
    metrics.count('api.request', { outcome: status >= 400 ? 'error' : 'ok', route: match.route.template });
    metrics.duration('api.duration', durationMs, { route: match.route.template });
    log.info('request handled', { status, route: match.route.template, companyId: key.companyId });

    // Usage is stamped on the key so a stale integration is visible without
    // trawling the request log.
    await service.from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', key.id);

    return respond(status, body, undefined, correlationId);
  } catch (err) {
    const durationMs = Date.now() - started;
    metrics.count('api.request', { outcome: 'exception', route: match.route.template });
    metrics.duration('api.duration', durationMs, { route: match.route.template });
    log.error('handler failed', { route: match.route.template, error: err, companyId: key.companyId });
    await logRequest({
      companyId: key.companyId, apiKeyId: key.id, method: req.method, path,
      status: 500, durationMs, errorCode: 'internal_error', ip, userAgent,
    });
    // The caller gets no internal detail; the detail is in the function log.
    return respond(500, { error: { code: 'internal_error', message: 'The request could not be completed.' } },
      undefined, correlationId);
  }
});
