-- =============================================================================
-- 0075 — What an upsell is, now that there is one plan
--
-- `admin_upsell_potential` was written for a five-tier ladder. Its central
-- column was "the next plan up", and its strongest signal was a customer
-- pressed against a seat or estimate ceiling. Seed 0002 then collapsed the
-- ladder to one plan, priced per seat, with AI credits and storage measured.
--
-- The view kept running and kept returning rows. It just stopped meaning
-- anything: there is no plan above the only plan, so `next_plan` is always
-- null and 'Room to move up' can never fire; and the ceilings it watched were
-- deliberately set to null, because a cap on a per-seat plan would refuse the
-- eleventh person on a plan that charges for the eleventh person. A view that
-- reports no potential for every customer is worse than no view — it is an
-- empty pipeline that looks like a checked one.
--
-- Under one plan an upsell is one of four concrete things, and every one of
-- them is already measured:
--
--   * more people using the platform than the subscription is billing for
--   * AI credits past what the plan includes
--   * storage past what the plan includes
--   * a trial about to end
--
-- The last is not an upsell so much as the moment the account is won or lost,
-- which is exactly when somebody should call.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- One definition of what a company is using
--
-- Two screens now quote these figures: the customer's own usage view and the
-- operator's pipeline. Deriving them twice is how the number on a renewal call
-- comes to differ from the number on the customer's screen, so the calculation
-- moves into a function and both views read it.
-- -----------------------------------------------------------------------------
create or replace function app.company_usage(p_company uuid)
returns table (
  seats                    int,
  ai_requests_this_period  numeric,
  ai_credits_included      int,
  storage_bytes            bigint,
  storage_gb               numeric,
  storage_gb_included      int,
  files_without_a_size     bigint
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    app.billable_seats(p_company),
    -- A flow: requests within the paid period.
    app.current_usage(p_company, 'ai.request'),
    app.plan_limit(p_company, 'ai_credits_per_month'),
    -- A level: what is held right now.
    app.storage_bytes(p_company),
    round(app.storage_bytes(p_company) / 1073741824.0, 3),
    app.plan_limit(p_company, 'storage_gb'),
    /*
     * How much of the stored total is unmeasured. A file whose size was never
     * recorded contributes nothing above, so this says how far the figure could
     * be understated rather than leaving it to be discovered on a dispute.
     */
    (select count(*) from document_versions dv
      where dv.company_id = p_company and dv.byte_size is null);
$$;

grant execute on function app.company_usage(uuid) to authenticated, service_role;

comment on function app.company_usage(uuid) is
  'What one company is using: seats, AI credits this period, storage held now, and how many stored files never recorded a size. The single definition behind both the customer usage view and the operator pipeline, so the two cannot drift.';

/*
 * The customer-facing view keeps its shape and its invoker semantics — which
 * rows it returns is still decided by RLS on `companies` — and stops computing
 * the figures itself.
 */
create or replace view reporting_company_usage
with (security_invoker = true) as
select
  c.id   as company_id,
  c.name,
  u.seats,
  u.ai_requests_this_period,
  u.ai_credits_included,
  u.storage_bytes,
  u.storage_gb,
  u.storage_gb_included,
  u.files_without_a_size
from companies c
cross join lateral app.company_usage(c.id) u;

-- The shape changes — "next plan up" and the tier ceilings are gone — so the
-- view is dropped rather than replaced.
drop view if exists admin_upsell_potential;

create view admin_upsell_potential as
select
  c.id                                    as company_id,
  c.name,
  e.plan_id                               as current_plan,
  p.name                                  as current_plan_name,

  -- Seats: what is being used against what is being billed. Under per-seat
  -- pricing this is the whole commercial relationship in two numbers.
  u.seats                                 as seats_in_use,
  s.quantity                              as seats_billed,
  greatest(u.seats - coalesce(s.quantity, 0), 0) as seats_unbilled,

  -- A flow, summed over the paid period.
  u.ai_requests_this_period,
  u.ai_credits_included,

  -- A level, measured now.
  u.storage_gb,
  u.storage_gb_included,
  u.files_without_a_size,

  e.source                                as entitlement_source,
  e.valid_until                           as trial_ends,
  s.status                                as subscription_status,

  /*
   * Why this customer is worth a call, ordered so the most concrete reason
   * wins: money already owed beats a limit already passed, which beats one
   * being approached, which beats a clock running out.
   *
   * Null is a real answer. A customer inside their allowances on a plan that
   * includes everything has no upsell, and saying so is more useful than
   * inventing one.
   */
  case
    when u.seats > coalesce(s.quantity, 0) and s.quantity is not null
      then 'Using ' || u.seats || ' seats, billed for ' || s.quantity
    when u.ai_credits_included is not null
         and u.ai_requests_this_period > u.ai_credits_included
      then 'Past the AI credit allowance'
    when u.storage_gb_included is not null
         and u.storage_gb > u.storage_gb_included
      then 'Past the storage allowance'
    when u.ai_credits_included is not null and u.ai_credits_included > 0
         and u.ai_requests_this_period >= u.ai_credits_included * 0.8
      then 'Approaching the AI credit allowance'
    when u.storage_gb_included is not null and u.storage_gb_included > 0
         and u.storage_gb >= u.storage_gb_included * 0.8
      then 'Approaching the storage allowance'
    when e.source = 'trial' and e.valid_until is not null
         and e.valid_until < now() + interval '7 days'
      then 'Trial ends within a week'
  end                                     as signal,

  (select count(*) from upsell_proposals up
    where up.company_id = c.id and up.state = 'proposed') as open_proposals
from companies c
left join entitlements e on e.company_id = c.id
left join plans p on p.id = e.plan_id
left join lateral (
  select st.quantity, st.status
  from subscriptions st
  where st.company_id = c.id
    and st.status in ('trialing', 'active', 'past_due', 'unpaid', 'paused')
  order by st.created_at desc limit 1
) s on true
/*
 * The usage figures come from reporting_company_usage rather than being
 * re-derived here, so the number an operator quotes on a call is the same
 * number the customer sees on their own usage screen. That view is
 * security_invoker, and this one is definer — so it is read through a definer
 * function rather than joined to directly, which would silently apply the
 * operator's own tenant visibility (none) and return nothing.
 */
left join lateral (select * from app.company_usage(c.id)) u on true
where app.operator_can('upsell.propose');

comment on view admin_upsell_potential is
  'Which customers are worth a call, under one plan priced per seat: seats in use against seats billed, AI credits and storage against what is included, and trials about to end. Null signal is a real answer — a customer inside their allowances has no upsell. Counts and standing only; no customer business data.';

grant select on admin_upsell_potential to authenticated;
revoke all on admin_upsell_potential from anon;

select app.assert_security_gates();
