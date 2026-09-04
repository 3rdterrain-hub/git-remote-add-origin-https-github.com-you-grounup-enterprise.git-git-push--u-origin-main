-- =============================================================================
-- 0031 — Plan limits, enforced
--
-- `plans` carried max_seats, max_active_estimates, max_active_projects,
-- storage_gb and ai_credits_per_month. `entitlements` copied all five. The
-- pricing page sold them: "25 active estimates", "Up to 3 users". And nothing
-- anywhere refused the 26th estimate or the 4th user.
--
-- A limit that is recorded and not enforced is the same defect as float nobody
-- computes and a toggle that switches nothing: the platform states a property
-- it does not have. It is worse commercially, because the limit is the reason
-- somebody upgrades.
--
-- Three limits are enforced here, the three a customer actually runs into:
-- active estimates, active projects and seats. Storage and AI credits are not,
-- and are left deliberately unenforced rather than half-enforced — both need a
-- measured quantity this platform does not yet meter, and a limit checked
-- against a number nobody computes would be theater.
-- =============================================================================

/**
 * The limit in force for a company, or NULL for unlimited.
 *
 * NULL means unlimited, and so does the absence of an entitlement row — a
 * company with no commercial state must not be locked out of its own data by a
 * billing control. Access is gated by RLS and entitlement checks; this function
 * only ever answers "how many".
 */
create or replace function app.plan_limit(p_company uuid, p_key text)
returns int
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v int;
begin
  if p_key not in ('max_seats', 'max_active_estimates', 'max_active_projects',
                   'storage_gb', 'ai_credits_per_month') then
    raise exception 'Unknown plan limit "%".', p_key using errcode = 'invalid_parameter_value';
  end if;

  execute format(
    'select e.%I from entitlements e where e.company_id = $1 and e.is_active
       and (e.valid_until is null or e.valid_until > now())', p_key)
  into v using p_company;

  return v;
end;
$$;

comment on function app.plan_limit(uuid, text) is
  'The numeric limit a company is entitled to, or NULL for unlimited. NULL is also returned when there is no active entitlement, so a billing gap never locks a company out of its own records.';

grant execute on function app.plan_limit(uuid, text) to authenticated, service_role;

/**
 * Refuse a row that would take a company past a plan limit.
 *
 * Blocking on insert rather than warning, because a limit that can be walked
 * past is the state this migration exists to leave. The error names the limit
 * and the plan so the message a user sees tells them what to do about it.
 *
 * TG_ARGV: [0] entitlement column, [1] what is being counted, [2] the SQL
 * predicate defining "active" for this table.
 */
create or replace function app.enforce_plan_count_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_limit int := app.plan_limit(new.company_id, tg_argv[0]);
  v_count int;
  v_plan  text;
begin
  if v_limit is null then
    return new;
  end if;

  execute format('select count(*) from public.%I where company_id = $1 and (%s)',
                 tg_table_name, tg_argv[2])
  into v_count using new.company_id;

  if v_count >= v_limit then
    select coalesce(p.name, e.plan_id, 'the current plan') into v_plan
    from entitlements e left join plans p on p.id = e.plan_id
    where e.company_id = new.company_id;

    raise exception
      'This plan allows % %. % already has %. Upgrade to add more.',
      v_limit, tg_argv[1], coalesce(v_plan, 'The current plan'), v_count
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

/*
 * Active estimates.
 *
 * "Active" excludes archived and lost work: a company that has archived last
 * year's bids has not used up this year's allowance, and telling them otherwise
 * would push them to delete their own history to keep working.
 */
create trigger estimates_plan_limit
  before insert on estimates
  for each row execute function app.enforce_plan_count_limit(
    'max_active_estimates', 'active estimates', $$status not in ('archived', 'lost')$$);

/*
 * Active projects. Closed and canceled jobs do not count against the limit,
 * for the same reason.
 */
create trigger projects_plan_limit
  before insert on projects
  for each row execute function app.enforce_plan_count_limit(
    'max_active_projects', 'active projects', $$status not in ('closed', 'canceled')$$);

/*
 * Seats.
 *
 * An invitation counts. A seat is consumed when it is offered, not when it is
 * accepted, or a company could invite past its limit and have the overage
 * appear the moment people sign in.
 */
create trigger company_memberships_plan_limit
  before insert on company_memberships
  for each row execute function app.enforce_plan_count_limit(
    'max_seats', 'users', $$status in ('invited', 'active')$$);

comment on function app.enforce_plan_count_limit() is
  'Refuses an insert that would exceed a plan limit, naming the limit and the plan. NULL limits and companies with no active entitlement pass through.';

/**
 * What a company has used against what it is allowed.
 *
 * The screen a user sees before they hit a wall. security_invoker, so it shows
 * a caller only their own companies.
 */
create or replace view reporting_plan_usage
with (security_invoker = true) as
select
  c.id                                     as company_id,
  e.plan_id,
  e.plan_version_id,
  pv.version                               as plan_version,
  'active estimates'::text                 as resource,
  (select count(*) from estimates x
    where x.company_id = c.id and x.status not in ('archived', 'lost')) as used,
  e.max_active_estimates                   as allowed
from companies c
left join entitlements e on e.company_id = c.id
left join plan_versions pv on pv.id = e.plan_version_id
union all
select
  c.id, e.plan_id, e.plan_version_id, pv.version, 'active projects',
  (select count(*) from projects x
    where x.company_id = c.id and x.status not in ('closed', 'canceled')),
  e.max_active_projects
from companies c
left join entitlements e on e.company_id = c.id
left join plan_versions pv on pv.id = e.plan_version_id
union all
select
  c.id, e.plan_id, e.plan_version_id, pv.version, 'users',
  (select count(*) from company_memberships x
    where x.company_id = c.id and x.status in ('invited', 'active')),
  e.max_seats
from companies c
left join entitlements e on e.company_id = c.id
left join plan_versions pv on pv.id = e.plan_version_id;

comment on view reporting_plan_usage is
  'Usage against allowance for the three enforced limits. A null allowance is unlimited.';

grant select on reporting_plan_usage to authenticated;
revoke all on reporting_plan_usage from anon;

select app.assert_security_gates();
