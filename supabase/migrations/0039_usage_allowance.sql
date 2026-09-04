-- =============================================================================
-- 0039 — Usage against allowance, and the AI credit that was never checked
--
-- P30 recorded that storage and AI credits were "deliberately left unenforced,
-- because both need a measured quantity nothing yet meters". **That was wrong
-- about AI credits.** The document analyst has always written a `usage_events`
-- row with metric `ai.request` on every run, and `app.current_usage` has always
-- aggregated that metric over the paid period. Both halves existed and nothing
-- put them together.
--
-- The verdict has been corrected. This migration closes the gap it was wrong
-- about.
--
-- Storage remains unenforced and the reason still holds: nothing measures
-- stored bytes, so there is no quantity to compare an allowance against. A
-- limit checked against a number nobody computes would be theater, which is the
-- same reason the schedule float and the plan limits were defects rather than
-- features.
-- =============================================================================

/**
 * What a company has used of a metered allowance, and whether it may continue.
 *
 * One function rather than a comparison scattered across call sites, so the
 * answer a screen shows and the answer an Edge Function enforces come from the
 * same place and cannot drift apart.
 *
 * A null allowance is unlimited, and so is having no active entitlement — the
 * same permissive default as an unconfigured plan limit, an undefined
 * accounting period and an absent signing limit. A billing gap must never
 * become an outage.
 */
create or replace function app.usage_allowance(
  p_company uuid, p_metric text, p_limit_key text)
returns table (used numeric, allowed int, remaining numeric, within_allowance boolean)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select u.used,
         l.allowed,
         case when l.allowed is null then null else greatest(l.allowed - u.used, 0) end as remaining,
         (l.allowed is null or u.used < l.allowed) as within_allowance
  from (select app.current_usage(p_company, p_metric) as used) u
  cross join (select app.plan_limit(p_company, p_limit_key) as allowed) l;
$$;

grant execute on function app.usage_allowance(uuid, text, text) to authenticated, service_role;

comment on function app.usage_allowance(uuid, text, text) is
  'Usage against a metered allowance for the current paid period. A null allowance is unlimited, and so is having no active entitlement — a billing gap must not become an outage.';

/**
 * May this company make another AI request this period?
 *
 * Named for what it answers, so a call site reads as the question rather than
 * as an arithmetic comparison somebody has to check.
 */
create or replace function app.ai_request_allowed(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select within_allowance from app.usage_allowance(p_company, 'ai.request', 'ai_credits_per_month');
$$;

grant execute on function app.ai_request_allowed(uuid) to authenticated, service_role;

comment on function app.ai_request_allowed(uuid) is
  'Whether the AI credit allowance published on the plan version still has room this period. The one check the document analyst was missing.';

/**
 * Usage against allowance, for the screen that should show it before somebody
 * hits the wall.
 *
 * security_invoker, so a caller sees only their own companies.
 */
create or replace view reporting_usage_allowance
with (security_invoker = true) as
select
  c.id                            as company_id,
  'ai.request'::text              as metric,
  'AI requests'::text             as label,
  a.used,
  a.allowed,
  a.remaining,
  a.within_allowance
from companies c
cross join lateral app.usage_allowance(c.id, 'ai.request', 'ai_credits_per_month') a;

comment on view reporting_usage_allowance is
  'Metered usage against the plan allowance. A null allowance is unlimited.';

grant select on reporting_usage_allowance to authenticated;
revoke all on reporting_usage_allowance from anon;

select app.assert_security_gates();
