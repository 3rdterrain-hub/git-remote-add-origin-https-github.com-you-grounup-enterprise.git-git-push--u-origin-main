-- =============================================================================
-- 0057 — The cash forecast, and the two numbers it was typed with
--
-- The finance screen carried a three-month cash forecast. September was real:
-- it read the current pay application's amount due. October and November were
-- the literals `286_400 / 118_600` and `198_200 / 94_300`, written into the
-- component. A chart of two invented months beside one real one, drawn to the
-- same scale, in the same colors, with no way to tell them apart.
--
-- This is the pattern this build has found roughly twenty times now — the
-- platform asserting a number nothing computes — and it is at its worst here,
-- because a cash forecast is a document people borrow against.
--
-- Deleting the chart would have been the workaround. The forecast is the most
-- useful thing on the screen and the data to build it honestly is almost all
-- present: every open payable already carries a due date. What was missing was
-- one integer on the other side.
--
--   * **Payables** were always computable. `ap_invoices.due_date` is when the
--     money leaves. Nothing needed adding.
--   * **Receivables** were not. A certified pay application records what is
--     due and when it was certified, and nothing recorded when the owner pays.
--     `customers.payment_terms` is free text — 'Net 30' — which reads as data
--     and parses as prose, and a forecast built by pattern-matching English
--     out of a text column is a forecast that silently drops a contract worded
--     'thirty (30) days from certification'.
--
-- So the contract gets the field its payment clause always had: a number of
-- days. Where it is absent the receivable is reported as unscheduled rather
-- than assumed into a month, because an assumed date in a cash forecast is the
-- literal 286,400 again in a more respectable font.
--
-- Work in progress gets the same treatment. The screen computed earned revenue
-- from a `percentComplete` the fixture supplied and the database does not hold:
-- projects have no percent complete, only tasks do. Earned revenue is now
-- cost-to-cost — cost incurred over budget — which is the input method ASC 606
-- recognizes and the one an auditor expects to see.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- What the payment clause says, as a number
-- -----------------------------------------------------------------------------
alter table contracts
  add column if not exists payment_terms_days int
    check (payment_terms_days is null or (payment_terms_days >= 0 and payment_terms_days <= 365));

comment on column contracts.payment_terms_days is
  'Days from certification of a pay application to payment, per the contract''s payment clause. Held as a number because a cash forecast has to compute a date, and prose does not. Null means the clause has not been recorded: the receivable is then reported as unscheduled, never assumed into a month.';

-- -----------------------------------------------------------------------------
-- Work in progress
--
-- Cost-to-cost. Percent complete is cost incurred over the approved budget, and
-- where there is no budget there is no percentage — reported as null rather
-- than as zero, because a project with no budget is not a project that has done
-- no work.
--
-- The ratio is exposed uncapped, because a job that has spent 120% of its
-- budget has told you something important, and clamping it to 100% is how that
-- disappears. Earned revenue uses the capped figure: you cannot earn more than
-- the contract is worth, whatever the cost ran to.
-- -----------------------------------------------------------------------------
create or replace view reporting_wip
with (security_invoker = true) as
select
  f.project_id,
  f.company_id,
  f.project_number,
  f.project_name,
  f.status,
  f.revised_contract_value        as contract_value,
  f.approved_budget,
  f.actual_cost,
  f.billed_to_date,
  f.retainage_held,

  -- Cost-to-cost, uncapped. Null where there is nothing to divide by.
  case when f.approved_budget > 0
       then round(f.actual_cost / f.approved_budget, 6) end   as cost_ratio,

  case when f.approved_budget > 0
       then least(round(f.actual_cost / f.approved_budget, 6), 1) end as percent_complete,

  case when f.approved_budget > 0
       then round(f.revised_contract_value
                  * least(f.actual_cost / f.approved_budget, 1), 2) end as earned_revenue,

  -- Positive is over billed: billed ahead of work performed, which reverses.
  -- Negative is under billed: work done and not yet invoiced, which is cash
  -- sitting in the ground.
  case when f.approved_budget > 0
       then round(f.billed_to_date
                  - f.revised_contract_value * least(f.actual_cost / f.approved_budget, 1), 2) end
                                                              as over_under_billed,

  case when f.approved_budget > 0
        and f.revised_contract_value * least(f.actual_cost / f.approved_budget, 1) > 0
       then round((f.revised_contract_value * least(f.actual_cost / f.approved_budget, 1) - f.actual_cost)
                  / (f.revised_contract_value * least(f.actual_cost / f.approved_budget, 1)), 6) end
                                                              as earned_margin
from reporting_project_financials f
where f.status not in ('lost', 'canceled');

comment on view reporting_wip is
  'Work in progress on the cost-to-cost basis. Percent complete, earned revenue and over/under billing are null where a project carries no approved budget, because the calculation has no denominator — reporting them as zero would show an unbudgeted job as 0% complete and fully under billed.';

grant select on reporting_wip to authenticated;
revoke all on reporting_wip from anon;

-- -----------------------------------------------------------------------------
-- Cash, item by item
--
-- Every row is a real receivable or a real payable with a real reference. A row
-- with a null due date is a real amount whose timing the platform does not
-- know, and it is carried through as such rather than dropped or guessed.
-- -----------------------------------------------------------------------------
create or replace view reporting_cash_flow_items
with (security_invoker = true) as
-- Receivables: certified applications not yet collected.
select
  pa.company_id,
  pa.project_id,
  'in'::text                                          as direction,
  'pay_application'::text                             as source,
  pa.id                                               as source_id,
  p.number || ' pay app ' || pa.application_number     as reference,
  coalesce(cu.name, p.name)                           as counterparty,
  pa.current_due - pa.amount_paid                     as amount,
  case when ct.payment_terms_days is not null
       then (coalesce(pa.approved_at, pa.submitted_at)::date + ct.payment_terms_days)
       end                                            as due_on,
  -- Nothing blocks a certified receivable; the column exists so both halves of
  -- the view have the same shape.
  false                                               as blocked,
  null::text                                          as blocked_reason
from pay_applications pa
join projects p on p.id = pa.project_id
left join contracts ct on ct.project_id = pa.project_id and ct.status in ('executed', 'active')
left join customers cu on cu.id = p.customer_id
where pa.status in ('submitted', 'approved', 'partially_paid')
  and pa.current_due - pa.amount_paid > 0

union all

-- Payables: invoices received and not settled.
select
  i.company_id,
  i.project_id,
  'out'::text,
  'ap_invoice'::text,
  i.id,
  v.name || ' ' || i.invoice_number,
  v.name,
  (i.amount + i.tax - i.retainage_withheld) - i.amount_paid,
  i.due_date,
  -- An invoice failing its three-way match, on hold or disputed is money owed
  -- that is not going to move on its due date. Forecasting it as an outflow
  -- overstates what leaves; dropping it understates what is owed. It is
  -- carried, and flagged.
  (i.status in ('on_hold', 'disputed')
     or i.match_status not in ('matched', 'no_po')),
  case
    when i.status = 'disputed' then 'disputed'
    when i.status = 'on_hold'  then 'on hold'
    when i.match_status not in ('matched', 'no_po') then 'three-way match failed'
  end
from ap_invoices i
join vendors v on v.id = i.vendor_id
where i.status not in ('paid', 'void')
  and (i.amount + i.tax - i.retainage_withheld) - i.amount_paid > 0;

comment on view reporting_cash_flow_items is
  'Open receivables and payables at item grain. A null due_on is an amount whose timing the platform does not know — an uncollected application on a contract with no recorded payment terms, or an invoice with no due date. It is reported as unscheduled and never assumed into a month.';

grant select on reporting_cash_flow_items to authenticated;
revoke all on reporting_cash_flow_items from anon;

-- -----------------------------------------------------------------------------
-- Cash, by month
-- -----------------------------------------------------------------------------
create or replace view reporting_cash_forecast
with (security_invoker = true) as
select
  company_id,
  date_trunc('month', due_on)::date  as month,
  sum(amount) filter (where direction = 'in')                     as inflow,
  sum(amount) filter (where direction = 'out' and not blocked)    as outflow,
  sum(amount) filter (where direction = 'out' and blocked)        as outflow_blocked,
  coalesce(sum(amount) filter (where direction = 'in'), 0)
    - coalesce(sum(amount) filter (where direction = 'out' and not blocked), 0) as net,
  count(*) filter (where direction = 'in')   as receivable_count,
  count(*) filter (where direction = 'out')  as payable_count
from reporting_cash_flow_items
group by company_id, date_trunc('month', due_on)::date;

comment on view reporting_cash_forecast is
  'Cash in and out by month, from real receivables and real payables. The row with a null month holds the amounts whose timing is unknown; it is shown to the reader rather than folded into a month, because a forecast that quietly dates an undated amount is the defect this view replaced.';

grant select on reporting_cash_forecast to authenticated;
revoke all on reporting_cash_forecast from anon;

select app.assert_security_gates();
