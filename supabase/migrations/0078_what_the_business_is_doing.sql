-- =============================================================================
-- 0078 — What the business is doing
--
-- The operator dashboard could count companies and show which Stripe webhooks
-- failed. It could not answer the first question anybody running a SaaS asks:
-- what are we earning, and is it growing.
--
-- Three deliberate positions run through this file.
--
-- **Stripe is the authority on money.** What is billed here is derived from
-- the subscription items mirrored out of Stripe's own webhooks — the price ids
-- and quantities Stripe told us it is charging — not from what GrounUp thinks
-- a customer ought to pay. Where the two would differ, the difference is
-- surfaced as its own figure rather than averaged away.
--
-- **Yearly is not thirteen months of monthly.** An annual subscription is
-- divided by twelve to sit beside monthly ones. That is a presentational
-- convention, and it is named on the screen rather than hidden in a total.
--
-- **What is given away is a number, not an absence.** A comped account
-- contributes nothing to revenue and something real to the cost of running
-- the platform. Free accounts, and what discounts cost, are reported beside
-- the revenue rather than left out of it.
-- =============================================================================

/**
 * What one subscription bills a month, in cents.
 *
 * Read from the items Stripe told us about, so it is what Stripe charges
 * rather than what the catalog says it should. A yearly item is divided by
 * twelve; a subscription with no mirrored items yet — one that arrived before
 * its items did — contributes nothing rather than a guess.
 */
create or replace function app.subscription_monthly_cents(p_subscription uuid)
returns bigint
language sql stable security definer set search_path = public, pg_catalog
as $$
  select coalesce(sum(
    case pp.interval
      when 'year'  then round(pp.unit_amount_cents * si.quantity / 12.0)
      when 'month' then pp.unit_amount_cents * si.quantity
      else 0
    end
  ), 0)::bigint
  from subscription_items si
  join plan_prices pp on pp.stripe_price_id = si.stripe_price_id
  where si.subscription_id = p_subscription;
$$;

grant execute on function app.subscription_monthly_cents(uuid) to authenticated, service_role;

comment on function app.subscription_monthly_cents(uuid) is
  'What Stripe bills this subscription a month, derived from the items mirrored out of its webhooks. Yearly is divided by twelve so it can sit beside monthly; a subscription whose items have not arrived contributes zero rather than an assumed price.';

-- -----------------------------------------------------------------------------
-- Every company, with its standing and what it is worth
-- -----------------------------------------------------------------------------
create or replace view admin_revenue_by_company as
select
  c.id                                    as company_id,
  c.name,
  c.created_at,
  app.effective_plan(c.id)                as plan_id,
  pl.name                                 as plan_name,
  s.status                                as subscription_status,
  s.cancel_at_period_end,
  s.current_period_end,

  app.billable_seats(c.id)                as seats,
  s.quantity                              as seats_billed,

  -- What Stripe actually charges, and what GrounUp's own catalog and this
  -- customer's arrangement say a month should come to. They agree for an
  -- ordinary account; where they do not, somebody should know.
  coalesce(app.subscription_monthly_cents(s.id), 0)::bigint as billed_monthly_cents,
  (app.billable_seats(c.id) * coalesce(app.seat_price_cents(c.id, 'month'), 0))::bigint
                                          as expected_monthly_cents,

  t.kind                                  as terms,
  /*
   * What this account would pay at the list price. The gap between this and
   * what it does pay is the cost of the arrangement — a real number, whether
   * the arrangement is a comp or a discount.
   */
  (app.billable_seats(c.id) * coalesce(
     (select pp.unit_amount_cents from plan_prices pp
       join plans p2 on p2.id = pp.plan_id
      where p2.is_active and p2.is_public and pp.is_active and pp.interval = 'month'
        and pp.unit_amount_cents > 0
      order by pp.updated_at desc limit 1), 0))::bigint as list_monthly_cents,

  (app.effective_plan(c.id) = 'free')     as on_the_free_plan,
  e.source                                as entitlement_source,
  e.valid_until                           as access_valid_until
from companies c
left join entitlements e on e.company_id = c.id
left join plans pl on pl.id = app.effective_plan(c.id)
left join lateral (
  select st.id, st.status, st.quantity, st.cancel_at_period_end, st.current_period_end
  from subscriptions st
  where st.company_id = c.id
    and st.status in ('trialing', 'active', 'past_due', 'unpaid', 'paused')
  order by st.created_at desc limit 1
) s on true
left join lateral (
  select bt.kind from company_billing_terms bt
  where bt.company_id = c.id and bt.revoked_at is null
) t on true
where app.operator_can('billing.read');

comment on view admin_revenue_by_company is
  'Every company beside what it is worth: what Stripe bills it, what its plan and arrangement say it should come to, and what it would pay at the list price. The three differ for a reason in every case, and the reason is in the row.';

grant select on admin_revenue_by_company to authenticated;
revoke all on admin_revenue_by_company from anon;

-- -----------------------------------------------------------------------------
-- The single figure, and the ones that qualify it
-- -----------------------------------------------------------------------------
create or replace view admin_revenue as
select
  count(*)                                                    as companies,
  count(*) filter (where subscription_status = 'active')      as paying,
  count(*) filter (where subscription_status = 'trialing')    as trialing,
  count(*) filter (where subscription_status in ('past_due', 'unpaid'))
                                                              as in_arrears,
  count(*) filter (where cancel_at_period_end)                as leaving,
  count(*) filter (where on_the_free_plan)                    as on_free,
  count(*) filter (where terms is not null)                   as on_terms,

  coalesce(sum(seats), 0)                                     as seats_in_use,
  coalesce(sum(seats_billed), 0)                              as seats_billed,

  -- The figure. Monthly recurring revenue as Stripe bills it.
  coalesce(sum(billed_monthly_cents), 0)                      as mrr_cents,
  coalesce(sum(billed_monthly_cents), 0) * 12                 as arr_cents,

  /*
   * What is not being collected, split by why. Given away is the cost of the
   * comped accounts; discounted is what the arrangements cost against the list
   * price; unbilled seats is the gap between people using the platform and
   * seats anybody is paying for — usually a subscription nobody updated.
   */
  coalesce(sum(list_monthly_cents) filter (where terms = 'free'), 0)
                                                              as given_away_cents,
  coalesce(sum(greatest(list_monthly_cents - expected_monthly_cents, 0))
             filter (where terms in ('percent_off', 'fixed_seat_price')), 0)
                                                              as discounted_cents,
  coalesce(sum(greatest(seats - coalesce(seats_billed, 0), 0))
             filter (where subscription_status = 'active'), 0) as seats_unbilled,

  -- Where Stripe and GrounUp disagree about a paying customer. Not an
  -- accounting figure — a list of things to look at.
  count(*) filter (
    where subscription_status = 'active'
      and abs(billed_monthly_cents - expected_monthly_cents) > 100)
                                                              as accounts_that_disagree
from admin_revenue_by_company
/*
 * The permission is asked again here rather than left to the view underneath.
 * An aggregate with no GROUP BY returns one row even over nothing, so a
 * customer reading this would get a row of zeros — which reveals no figure but
 * does answer "does this view exist and will it talk to me", and the answer
 * should be no. HAVING rather than WHERE because it is the aggregate row being
 * filtered, and it is written so an operator on an empty platform still sees
 * zeros rather than nothing.
 */
having app.operator_can('billing.read');

comment on view admin_revenue is
  'The business in one row: what is recurring, who is paying, what is being given away, and how many accounts Stripe and GrounUp disagree about. Revenue is what Stripe bills — GrounUp''s own expectation is reported beside it rather than instead of it.';

grant select on admin_revenue to authenticated;
revoke all on admin_revenue from anon;

-- -----------------------------------------------------------------------------
-- Whether it is growing
-- -----------------------------------------------------------------------------
create or replace view admin_growth as
select
  m.month,
  coalesce(co.n, 0)   as new_companies,
  coalesce(us.n, 0)   as new_users,
  coalesce(su.n, 0)   as new_subscriptions,
  coalesce(ca.n, 0)   as canceled_subscriptions
from (
  -- Thirteen months, so the current one has the same month last year beside it.
  select generate_series(date_trunc('month', now()) - interval '12 months',
                         date_trunc('month', now()), interval '1 month') as month
) m
left join lateral (
  select count(*) as n from companies c
  where date_trunc('month', c.created_at) = m.month
) co on true
left join lateral (
  select count(*) as n from user_profiles u
  where date_trunc('month', u.created_at) = m.month
) us on true
left join lateral (
  select count(*) as n from subscriptions s
  where date_trunc('month', s.created_at) = m.month
) su on true
left join lateral (
  select count(*) as n from subscriptions s
  where s.canceled_at is not null and date_trunc('month', s.canceled_at) = m.month
) ca on true
where app.operator_can('companies.read')
order by m.month;

comment on view admin_growth is
  'New companies, people and subscriptions by month, and cancellations beside them — thirteen months, so the current month has the same month last year to compare against.';

grant select on admin_growth to authenticated;
revoke all on admin_growth from anon;

-- -----------------------------------------------------------------------------
-- Who arrived
-- -----------------------------------------------------------------------------
create or replace view admin_recent_signups as
select
  u.id                                as user_id,
  u.email,
  u.full_name,
  u.created_at,
  c.id                                as company_id,
  c.name                              as company_name,
  cm.is_owner,
  -- Somebody who signed up and never joined a company got stuck somewhere, and
  -- that is worth seeing rather than filtering out.
  (c.id is null)                      as no_company_yet
from user_profiles u
left join lateral (
  select m.company_id, m.is_owner from company_memberships m
  where m.user_id = u.id and m.status = 'active'
  order by m.joined_at limit 1
) cm on true
left join companies c on c.id = cm.company_id
where app.operator_can('companies.read')
order by u.created_at desc
limit 50;

comment on view admin_recent_signups is
  'The fifty most recent people to sign up, and which company they landed in. Somebody with no company is somebody who got stuck partway through, which is worth seeing rather than filtering out.';

grant select on admin_recent_signups to authenticated;
revoke all on admin_recent_signups from anon;

select app.assert_security_gates();
