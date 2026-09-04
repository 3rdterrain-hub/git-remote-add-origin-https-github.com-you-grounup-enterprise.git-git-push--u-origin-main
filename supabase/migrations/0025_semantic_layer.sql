-- =============================================================================
-- 0025 — Semantic layer: governed metrics and the reporting views behind them
--
-- The problem this solves is not technical. Ask four people in a construction
-- company what their gross margin was last quarter and you get four answers,
-- because each built it from a slightly different query. This migration makes
-- the definition the artefact: one row per metric, one place it is computed,
-- and every dashboard, export and API response reading the same one.
--
-- Two rules hold throughout:
--   * `expression` is never interpolated into a query built from user input.
--     It is executed only through the views declared here.
--   * Every view filters on company_id and inherits RLS from its base tables
--     (`security_invoker = true`), so a reporting view can never become the
--     hole through which one company reads another's numbers.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Reporting views
--
-- `security_invoker = true` is the whole security story here. Without it a view
-- runs as its owner and silently bypasses the RLS on every table underneath —
-- which is exactly how reporting layers become the weakest point in an
-- otherwise well-isolated system.
-- -----------------------------------------------------------------------------

create or replace view reporting_project_financials
with (security_invoker = true) as
select
  p.id                              as project_id,
  p.company_id,
  p.division_id,
  p.number                          as project_number,
  p.name                            as project_name,
  p.status,
  p.contract_type,
  p.contract_value,
  p.approved_budget,
  coalesce(co.approved_price_impact, 0)                     as approved_change_orders,
  p.contract_value + coalesce(co.approved_price_impact, 0)  as revised_contract_value,
  coalesce(c.actual_cost, 0)        as actual_cost,
  coalesce(c.committed_cost, 0)     as committed_cost,
  coalesce(c.labor_cost, 0)         as labor_cost,
  coalesce(c.equipment_cost, 0)     as equipment_cost,
  coalesce(c.material_cost, 0)      as material_cost,
  coalesce(c.subcontract_cost, 0)   as subcontract_cost,
  coalesce(b.billed_to_date, 0)     as billed_to_date,
  coalesce(b.retainage_held, 0)     as retainage_held,
  -- Margin against the revised contract, not the original. Reporting margin
  -- against the original value ignores every approved change order and
  -- flatters or damns a project for work that was never in its scope.
  (p.contract_value + coalesce(co.approved_price_impact, 0)) - coalesce(c.actual_cost, 0)
                                    as gross_profit_to_date,
  p.planned_start, p.planned_finish, p.actual_start, p.actual_finish
from projects p
left join lateral (
  select
    sum(pc.amount) filter (where not pc.is_committed)        as actual_cost,
    sum(pc.amount) filter (where pc.is_committed)            as committed_cost,
    -- Burden is labor cost. Reporting it separately makes labor look cheaper
    -- than it is, which is how a crew that is losing money looks fine on a
    -- dashboard. Fuel belongs with the machine that burned it, for the same
    -- reason.
    sum(pc.amount) filter (where pc.cost_type in ('labor', 'labor_burden'))  as labor_cost,
    sum(pc.amount) filter (where pc.cost_type in ('equipment', 'fuel'))      as equipment_cost,
    sum(pc.amount) filter (where pc.cost_type = 'material')                  as material_cost,
    sum(pc.amount) filter (where pc.cost_type in ('subcontract', 'trucking', 'disposal')) as subcontract_cost
  from project_costs pc
  where pc.project_id = p.id
) c on true
left join lateral (
  select
    sum(pa.price_impact) filter (where pa.status = 'executed') as approved_price_impact
  from change_orders pa
  where pa.project_id = p.id
) co on true
left join lateral (
  -- The latest approved application is the billed position; summing every
  -- application would multiply the contract by the number of periods, because
  -- each one is cumulative to date.
  select pa.total_earned as billed_to_date, pa.retainage_to_date as retainage_held
  from pay_applications pa
  where pa.project_id = p.id and pa.status in ('approved', 'partially_paid', 'paid')
  order by pa.period_end desc, pa.application_number desc
  limit 1
) b on true;

comment on view reporting_project_financials is
  'Project financial position. Billed-to-date is the latest approved application, not a sum of them — pay applications are cumulative, and summing them multiplies the contract by the period count.';

create or replace view reporting_labor_productivity
with (security_invoker = true) as
select
  te.company_id,
  te.project_id,
  te.cost_code_id,
  date_trunc('week', te.work_date)::date as week_of,
  count(distinct te.employee_id)         as employees,
  sum(te.straight_hours)                 as straight_hours,
  sum(te.overtime_hours)                 as overtime_hours,
  sum(te.doubletime_hours)               as doubletime_hours,
  sum(te.total_hours)                    as total_hours,
  -- Premium hours as a share of the total. A crew running 20% overtime is
  -- either short-staffed or behind, and both cost money the estimate did not
  -- carry.
  case when sum(te.total_hours) > 0
       then round((sum(te.overtime_hours) + sum(te.doubletime_hours)) / sum(te.total_hours), 4)
       else null end                     as premium_hour_ratio
from time_entries te
where te.approval_state = 'approved'
group by te.company_id, te.project_id, te.cost_code_id, date_trunc('week', te.work_date);

comment on view reporting_labor_productivity is
  'Approved hours only. Unapproved time is a claim about what happened, not a record of it, and including it makes productivity move every time someone edits a timesheet.';

create or replace view reporting_safety_summary
with (security_invoker = true) as
select
  si.company_id,
  si.project_id,
  date_trunc('month', si.occurred_at)::date          as month_of,
  count(*)                                           as incidents,
  count(*) filter (where si.is_osha_recordable)      as recordables,
  count(*) filter (where si.days_away > 0)           as lost_time_cases,
  coalesce(sum(si.days_away), 0)                     as days_away,
  coalesce(sum(si.days_restricted), 0)               as days_restricted,
  count(*) filter (where si.investigation_state <> 'closed') as open_investigations
from safety_incidents si
group by si.company_id, si.project_id, date_trunc('month', si.occurred_at);

comment on view reporting_safety_summary is
  'Incident counts by month. The rate metrics (TRIR, DART) divide these by hours worked and are defined in metric_definitions rather than hard-coded here, because the 200,000-hour constant is an OSHA convention that belongs in a definition someone can read.';

create or replace view reporting_bid_performance
with (security_invoker = true) as
select
  e.company_id,
  e.division_id,
  date_trunc('month', e.created_at)::date            as month_of,
  count(*)                                           as estimates,
  count(*) filter (where e.status in ('issued', 'awarded', 'lost')) as submitted,
  count(*) filter (where e.status = 'awarded')       as won,
  count(*) filter (where e.status = 'lost')          as lost,
  -- Hit rate over decided bids only. Counting bids still out as losses
  -- understates the rate; counting them as wins overstates it. Neither is a
  -- number worth acting on.
  case when count(*) filter (where e.status in ('awarded', 'lost')) > 0
       then round(count(*) filter (where e.status = 'awarded')::numeric
                  / count(*) filter (where e.status in ('awarded', 'lost')), 4)
       else null end                                 as hit_rate
from estimates e
group by e.company_id, e.division_id, date_trunc('month', e.created_at);

comment on view reporting_bid_performance is
  'Hit rate over decided bids only. Bids still outstanding are neither wins nor losses, and treating them as either produces a number nobody should act on.';

-- -----------------------------------------------------------------------------
-- Seed metric definitions
--
-- These are global (company_id null): every company starts from the same
-- definitions and may override any of them by inserting its own row with the
-- same key, exactly as the three-tier library scope works everywhere else.
-- -----------------------------------------------------------------------------

insert into metric_definitions
  (company_id, key, name, description, domain, unit, expression, grain, higher_is_better, is_active)
values
  (null, 'gross_profit_to_date',
   'Gross profit to date',
   'Revised contract value less actual cost incurred. Uses the revised contract so approved change orders count as the revenue they are.',
   'financial', 'currency',
   'sum(gross_profit_to_date)', 'project', true, true),

  (null, 'gross_margin_percent',
   'Gross margin',
   'Gross profit as a share of revised contract value. Undefined on a project with no contract value rather than reported as zero.',
   'financial', 'percent',
   'case when sum(revised_contract_value) > 0 then sum(gross_profit_to_date) / sum(revised_contract_value) end',
   'project', true, true),

  (null, 'cost_to_complete',
   'Cost to complete',
   'Approved budget less actual cost. Negative means the budget is already spent and the remaining work has no funding behind it.',
   'financial', 'currency',
   'sum(approved_budget) - sum(actual_cost)', 'project', false, true),

  (null, 'billed_to_date',
   'Billed to date',
   'The latest approved pay application. Pay applications are cumulative, so this is a maximum and never a sum.',
   'financial', 'currency',
   'sum(billed_to_date)', 'project', true, true),

  (null, 'unbilled_cost',
   'Unbilled cost',
   'Cost incurred that has not yet reached an approved application. This is the working capital the company is lending the project.',
   'financial', 'currency',
   'sum(actual_cost) - sum(billed_to_date)', 'project', false, true),

  (null, 'retainage_held',
   'Retainage held',
   'Retainage withheld on approved applications, recoverable at closeout.',
   'financial', 'currency',
   'sum(retainage_held)', 'project', false, true),

  (null, 'change_order_ratio',
   'Change order ratio',
   'Executed change orders as a share of the original contract. A high ratio points at the completeness of the bid documents as often as at the work.',
   'financial', 'percent',
   'case when sum(contract_value) > 0 then sum(approved_change_orders) / sum(contract_value) end',
   'project', null, true),

  (null, 'labor_cost_ratio',
   'Labor share of cost',
   'Labor as a share of total actual cost. The number that moves first when production slips.',
   'operations', 'percent',
   'case when sum(actual_cost) > 0 then sum(labor_cost) / sum(actual_cost) end',
   'project', null, true),

  (null, 'premium_hour_ratio',
   'Premium hour ratio',
   'Overtime and doubletime as a share of approved hours. Sustained premium hours mean the crew is short or the schedule is late.',
   'workforce', 'percent',
   'case when sum(total_hours) > 0 then (sum(overtime_hours) + sum(doubletime_hours)) / sum(total_hours) end',
   'project', false, true),

  (null, 'hours_worked',
   'Hours worked',
   'Approved hours. Unapproved time is a claim about what happened, not a record of it.',
   'workforce', 'hours',
   'sum(total_hours)', 'project', null, true),

  (null, 'trir',
   'Total recordable incident rate',
   'OSHA TRIR: recordable incidents per 100 full-time workers per year, calculated as recordables x 200,000 / hours worked. The 200,000 is 100 workers at 40 hours for 50 weeks — an OSHA convention, stated here so nobody has to guess where it came from.',
   'safety', 'ratio',
   'case when sum(total_hours) > 0 then sum(recordables) * 200000.0 / sum(total_hours) end',
   'company', false, true),

  (null, 'dart_rate',
   'DART rate',
   'Days away, restricted or transferred, per 100 full-time workers per year. Same 200,000-hour basis as TRIR.',
   'safety', 'ratio',
   'case when sum(total_hours) > 0 then (sum(lost_time_cases) + sum(days_restricted)) * 200000.0 / sum(total_hours) end',
   'company', false, true),

  (null, 'open_investigations',
   'Open investigations',
   'Incidents whose investigation has not been closed. An incident without a completed investigation is an unlearned lesson.',
   'safety', 'count',
   'sum(open_investigations)', 'company', false, true),

  (null, 'bid_hit_rate',
   'Bid hit rate',
   'Wins as a share of decided bids. Outstanding bids are excluded, because counting them either way produces a number nobody should act on.',
   'sales', 'percent',
   'case when sum(won) + sum(lost) > 0 then sum(won)::numeric / (sum(won) + sum(lost)) end',
   'company', true, true),

  (null, 'estimates_submitted',
   'Estimates submitted',
   'Bids submitted in the period. Volume, read alongside hit rate rather than instead of it.',
   'sales', 'count',
   'sum(submitted)', 'company', true, true),

  (null, 'backlog_value',
   'Backlog',
   'Revised contract value less billed to date across active projects. What is sold but not yet earned.',
   'financial', 'currency',
   'sum(revised_contract_value) - sum(billed_to_date)', 'company', true, true);

-- -----------------------------------------------------------------------------
-- Grants
--
-- The views inherit RLS from their base tables, so authenticated is enough.
-- `anon` gets nothing: an unauthenticated caller has no company, and a
-- reporting view is exactly the wrong place to discover that.
-- -----------------------------------------------------------------------------
grant select on reporting_project_financials  to authenticated;
grant select on reporting_labor_productivity  to authenticated;
grant select on reporting_safety_summary      to authenticated;
grant select on reporting_bid_performance     to authenticated;

revoke all on reporting_project_financials  from anon;
revoke all on reporting_labor_productivity  from anon;
revoke all on reporting_safety_summary      from anon;
revoke all on reporting_bid_performance     from anon;

-- Reporting views are the classic RLS bypass. This asserts the property rather
-- than trusting that every view above was written with the option set.
do $$
declare
  v record;
begin
  for v in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'v'
      and c.relname like 'reporting_%'
  loop
    if not exists (
      select 1 from pg_class c2
      join pg_namespace n2 on n2.oid = c2.relnamespace
      where n2.nspname = 'public' and c2.relname = v.relname
        and c2.reloptions @> array['security_invoker=true']
    ) then
      raise exception
        'Reporting view %.% does not set security_invoker; it would run as its owner and bypass RLS on every table beneath it.',
        'public', v.relname;
    end if;
  end loop;
end;
$$;

select app.assert_security_gates();
