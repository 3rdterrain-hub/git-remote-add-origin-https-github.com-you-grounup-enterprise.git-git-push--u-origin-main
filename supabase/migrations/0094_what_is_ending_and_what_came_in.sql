-- =============================================================================
-- 0094 — What is ending, and what came in
--
-- Three questions an operator was asking and could not answer.
--
-- **Is this company alive?** The tenant list shows a plan and a subscription
-- standing, neither of which says whether anybody is using it. A paying
-- customer nobody has opened in six weeks is the one to call, and looks
-- identical on that list to a paying customer who is in it every day.
--
-- **What ends soon?** Trials, comped periods, allowance overrides,
-- subscriptions set to cancel, and access granted until a date. Five different
-- dates on five different tables, none of them anywhere an operator would look
-- — so the first anybody knew was the customer ringing up about it.
--
-- **What came in?** The dashboard reports monthly recurring revenue, which is
-- a rate rather than money. What was actually invoiced and actually paid, by
-- month, is a different figure and the one an accountant asks for.
--
-- All three are counted rather than tracked, from records that already exist.
-- =============================================================================

/**
 * Whether anybody is actually using this company.
 *
 * `user_profiles.last_seen_at` is stamped on every request, so this asks the
 * cheapest honest question: when did anybody here last do anything. Not "are
 * they paying" — that is the subscription, and the interesting customer is the
 * one where the two answers differ.
 */
create or replace function app.company_last_seen(p_company uuid)
returns timestamptz
language sql stable security definer set search_path = public, pg_catalog
as $$
  select max(up.last_seen_at)
  from company_memberships m
  join user_profiles up on up.id = m.user_id
  where m.company_id = p_company and m.status = 'active';
$$;

grant execute on function app.company_last_seen(uuid) to authenticated, service_role;

create or replace view admin_company_activity as
select
  c.id                                    as company_id,
  c.name,
  c.created_at,
  app.effective_plan(c.id)                as plan_id,
  s.status                                as subscription_status,
  app.billable_seats(c.id)                as seats,
  app.company_last_seen(c.id)             as last_seen,
  round(extract(epoch from (now() - app.company_last_seen(c.id))) / 86400.0)::int
                                          as days_quiet,
  /*
   * Alive, quiet or gone. Thresholds rather than a judgment: a construction
   * company that has not opened the platform in a fortnight is between jobs,
   * and one that has not opened it in six weeks has stopped.
   */
  case
    when app.company_last_seen(c.id) is null then 'never used'
    when app.company_last_seen(c.id) > now() - interval '14 days' then 'active'
    when app.company_last_seen(c.id) > now() - interval '42 days' then 'quiet'
    else 'gone dark'
  end                                     as standing,
  app.is_suspended(c.id)                  as suspended,
  -- The combination worth acting on: money coming in, nobody using it.
  (s.status = 'active'
     and (app.company_last_seen(c.id) is null
          or app.company_last_seen(c.id) < now() - interval '42 days')) as paying_and_gone,
  (select count(*) from estimates x where x.company_id = c.id) as estimates,
  (select count(*) from projects pr where pr.company_id = c.id) as projects
from companies c
left join lateral (
  select st.status from subscriptions st
  where st.company_id = c.id
    and st.status in ('trialing', 'active', 'past_due', 'unpaid', 'paused')
  order by st.created_at desc limit 1
) s on true
where app.operator_can('companies.read')
order by app.company_last_seen(c.id) nulls first;

comment on view admin_company_activity is
  'Whether anybody is actually using each company, beside whether they are paying. The interesting customers are the ones where those two answers differ: paying and gone dark is a cancellation that has not been written yet, and busy on the free plan is a sale.';

grant select on admin_company_activity to authenticated;
revoke all on admin_company_activity from anon;

-- -----------------------------------------------------------------------------
-- What ends soon
--
-- Five kinds of ending, on five tables. Collected here because the first
-- anybody knew about any of them was the customer ringing up.
-- -----------------------------------------------------------------------------
create or replace view admin_expiring as
select * from (
  -- A trial running out.
  select
    e.company_id, c.name as company_name,
    'trial'::text                         as kind,
    'Trial ends'::text                    as what,
    e.valid_until                         as ends_at,
    app.billable_seats(e.company_id)      as seats,
    e.plan_id::text                       as detail
  from entitlements e
  join companies c on c.id = e.company_id
  where e.source = 'trial' and e.valid_until is not null and e.is_active

  union all

  -- Access granted by hand, until a date.
  select
    e.company_id, c.name, 'granted', 'Manual grant ends', e.valid_until,
    app.billable_seats(e.company_id), coalesce(e.grant_reason, '')
  from entitlements e
  join companies c on c.id = e.company_id
  where e.source = 'manual_grant' and e.valid_until is not null and e.is_active

  union all

  -- A subscription somebody has already canceled, still running out its term.
  select
    s.company_id, c.name, 'canceling', 'Subscription ends', s.current_period_end,
    s.quantity, coalesce(s.plan_id, '')
  from subscriptions s
  join companies c on c.id = s.company_id
  where s.cancel_at_period_end and s.status in ('active', 'trialing', 'past_due')

  union all

  -- A comp or discount with an end date on it.
  select
    t.company_id, c.name, 'terms', 'Commercial terms end', t.valid_until,
    app.billable_seats(t.company_id), t.kind
  from company_billing_terms t
  join companies c on c.id = t.company_id
  where t.revoked_at is null and t.valid_until is not null

  union all

  -- An allowance somebody was given for a while.
  select
    o.company_id, c.name, 'allowance', 'Extra allowance ends', o.valid_until,
    app.billable_seats(o.company_id), o.allowance
  from allowance_overrides o
  join companies c on c.id = o.company_id
  where o.revoked_at is null and o.valid_until is not null
) x
where x.ends_at is not null
  and x.ends_at < now() + interval '60 days'
  and app.operator_can('companies.read')
order by x.ends_at;

comment on view admin_expiring is
  'Everything with an end date inside sixty days: trials, manual grants, subscriptions already canceled, comps and discounts, and allowances given for a while. Five kinds of ending on five tables, which is why nobody was watching any of them.';

grant select on admin_expiring to authenticated;
revoke all on admin_expiring from anon;

-- -----------------------------------------------------------------------------
-- What came in
--
-- Recurring revenue is a rate. This is money: what was invoiced and what was
-- actually paid, by the month it belongs to, which is the figure an accountant
-- asks for and the dashboard could not produce.
-- -----------------------------------------------------------------------------
create or replace view admin_earnings_by_month as
select
  m.month,
  coalesce(i.invoiced_cents, 0)           as invoiced_cents,
  coalesce(i.paid_cents, 0)               as paid_cents,
  coalesce(i.invoices, 0)                 as invoices,
  coalesce(i.paying_companies, 0)         as paying_companies,
  -- What was billed and has not arrived. Not the same as a failed payment: an
  -- invoice can simply be young.
  coalesce(i.invoiced_cents, 0) - coalesce(i.paid_cents, 0) as outstanding_cents,
  coalesce(r.refunded_cents, 0)           as refunded_cents,
  coalesce(i.paid_cents, 0) - coalesce(r.refunded_cents, 0) as net_cents
from (
  select generate_series(date_trunc('month', now()) - interval '23 months',
                         date_trunc('month', now()), interval '1 month') as month
) m
left join lateral (
  select
    sum(bi.amount_due_cents)  as invoiced_cents,
    sum(bi.amount_paid_cents) as paid_cents,
    count(*)                  as invoices,
    count(distinct bi.company_id) as paying_companies
  from billing_invoices bi
  /*
   * By the period the invoice covers rather than the day it was issued. An
   * invoice raised on the thirty-first for the following month is next month's
   * money, and putting it in this one is how a revenue report stops matching
   * the accounts.
   */
  where date_trunc('month', coalesce(bi.period_start, bi.created_at)) = m.month
    and bi.status <> 'void'
) i on true
left join lateral (
  select sum(rr.amount_cents) as refunded_cents
  from refund_requests rr
  where rr.state = 'applied' and rr.kind = 'refund'
    and date_trunc('month', rr.applied_at) = m.month
) r on true
where app.operator_can('billing.read')
order by m.month desc;

comment on view admin_earnings_by_month is
  'Money, by the month it belongs to: invoiced, paid, still outstanding, refunded, and the net. Grouped by the period an invoice covers rather than the day it was raised — an invoice issued on the thirty-first for the following month is next month''s money, and mixing those is how a revenue report stops matching the accounts.';

grant select on admin_earnings_by_month to authenticated;
revoke all on admin_earnings_by_month from anon;

select app.assert_security_gates();
