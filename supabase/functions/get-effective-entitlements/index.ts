/**
 * POST /functions/v1/get-effective-entitlements
 *
 * Returns what a company may currently use, and what the calling user is
 * permitted to do with it.
 *
 * Both halves are returned because they are genuinely different questions.
 * A company can be entitled to `projects` while the signed-in user has no
 * `projects.write` permission; the UI needs to distinguish "upgrade your plan"
 * from "ask your administrator".
 */
import { getCaller, isUuid } from '../_shared/auth.ts';
import { fail, json, preflight } from '../_shared/http.ts';

const PERMISSION_KEYS = [
  'company.manage', 'users.manage', 'libraries.read', 'libraries.write', 'libraries.approve',
  'estimates.read', 'estimates.write', 'estimates.approve', 'estimates.issue',
  'crm.read', 'crm.write', 'projects.read', 'projects.write',
  'documents.read', 'documents.write', 'reports.read', 'audit.read',
  'ai.accept_findings', 'billing.read', 'billing.manage',
] as const;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') return fail('method_not_allowed', 'Use POST.', 405, origin);

  try {
    const caller = await getCaller(req);
    if (!caller) return fail('unauthenticated', 'Sign in to read entitlements.', 401, origin);

    const { companyId } = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!isUuid(companyId)) return fail('bad_request', 'A valid companyId is required.', 400, origin);

    // Read through the caller's client so RLS confirms membership. A user who
    // is not a member simply gets no row.
    const { data: entitlement, error } = await caller.client
      .from('entitlements')
      .select('plan_id, is_active, features, max_seats, max_active_estimates, max_active_projects, storage_gb, ai_credits_per_month, valid_until, source')
      .eq('company_id', companyId)
      .maybeSingle();

    if (error) return fail('lookup_failed', 'Entitlements could not be read.', 500, origin, error);
    if (!entitlement) return fail('forbidden', 'You are not a member of this company.', 403, origin);

    const permissions: Record<string, boolean> = {};
    await Promise.all(PERMISSION_KEYS.map(async (key) => {
      const { data } = await caller.client.rpc('has_permission', { p_company: companyId, p_permission: key });
      permissions[key] = data === true;
    }));

    const expired = entitlement.valid_until !== null && new Date(entitlement.valid_until) <= new Date();
    const usage = await Promise.all(
      ['ai.request', 'documents.pages_processed', 'storage.bytes'].map(async (metric) => {
        const { data } = await caller.client.rpc('current_usage', { p_company: companyId, p_metric: metric });
        return [metric, Number(data ?? 0)] as const;
      }),
    );

    return json({
      companyId,
      plan: entitlement.plan_id,
      active: entitlement.is_active && !expired,
      expired,
      features: entitlement.is_active && !expired ? entitlement.features : [],
      limits: {
        maxSeats: entitlement.max_seats,
        maxActiveEstimates: entitlement.max_active_estimates,
        maxActiveProjects: entitlement.max_active_projects,
        storageGb: entitlement.storage_gb,
        aiCreditsPerMonth: entitlement.ai_credits_per_month,
      },
      usage: Object.fromEntries(usage),
      validUntil: entitlement.valid_until,
      source: entitlement.source,
      permissions,
    }, 200, origin);
  } catch (err) {
    return fail('internal_error', 'Entitlements could not be resolved.', 500, origin, err);
  }
});
