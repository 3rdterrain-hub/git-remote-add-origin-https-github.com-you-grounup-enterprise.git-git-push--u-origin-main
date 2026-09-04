-- =============================================================================
-- 0041 — The safety rate the platform defined and could not compute
--
-- Migration 0040 gave every metric a source view and a test that runs each
-- expression against it. On its first run that test failed twice, and both
-- failures were real.
--
--   * **TRIR and DART had no source.** Both are defined as incidents times
--     200,000 divided by hours worked. Incidents live in
--     `reporting_safety_summary`; hours live in `reporting_labor_productivity`.
--     No view in the platform carried both, so neither rate could be computed
--     from anything — while the safety view's own comment claimed the rates
--     "are defined in metric_definitions rather than hard-coded here", as
--     though defining them were the same as producing them.
--
--   * **The DART numerator added a case count to a day count.** It read
--     `sum(lost_time_cases) + sum(days_restricted)` — one term counting cases,
--     the other counting days. A single restricted-duty case lasting twelve
--     days contributed twelve to a rate that counts cases, inflating it
--     twelvefold. DART is a *case* rate: an OSHA recordable counts once if it
--     cost any days away, restricted duty, or a job transfer, whether that was
--     one day or ninety.
--
-- These are the two numbers a general contractor is prequalified on and an
-- insurer is rated on. The first defect made them unproducible; the second
-- would have made them wrong in the direction that costs work.
-- =============================================================================

/**
 * Recordable incidents and the hours they were exposed over, at one grain.
 *
 * A rate needs a numerator and a denominator in the same row, and they come
 * from opposite ends of the platform: incidents from the safety module, hours
 * from approved time. A full outer join rather than an inner one, because both
 * halves are meaningful alone — a month with hours and no incidents is a TRIR
 * of zero and the best month a company can have, and inner-joining it away
 * would quietly report a company's rate as though its safe months never
 * happened. A month with an incident and no approved hours yields a null rate
 * rather than a division by zero: that is a timekeeping gap, not a rate.
 *
 * Approved hours only, matching `reporting_labor_productivity`. Unapproved time
 * is a claim about what happened, and a safety rate that moves when somebody
 * edits a timesheet is not a safety rate.
 */
create or replace view reporting_safety_rates
with (security_invoker = true) as
with incidents as (
  select
    si.company_id,
    si.project_id,
    date_trunc('month', si.occurred_at)::date                as month_of,
    count(*) filter (where si.is_osha_recordable)            as recordables,
    -- A DART case: recordable, and it cost days away or restricted duty. Counted
    -- once however long it lasted.
    count(*) filter (where si.is_osha_recordable
                       and (si.days_away > 0 or si.days_restricted > 0))
                                                             as dart_cases,
    count(*) filter (where si.is_osha_recordable and si.days_away > 0)
                                                             as lost_time_cases,
    coalesce(sum(si.days_away), 0)                           as days_away,
    coalesce(sum(si.days_restricted), 0)                     as days_restricted
  from safety_incidents si
  group by si.company_id, si.project_id, date_trunc('month', si.occurred_at)
),
hours as (
  select
    te.company_id,
    te.project_id,
    date_trunc('month', te.work_date)::date  as month_of,
    sum(te.total_hours)                      as hours_worked
  from time_entries te
  where te.approval_state = 'approved'
  group by te.company_id, te.project_id, date_trunc('month', te.work_date)
)
select
  coalesce(i.company_id, h.company_id)  as company_id,
  coalesce(i.project_id, h.project_id)  as project_id,
  coalesce(i.month_of, h.month_of)      as month_of,
  coalesce(i.recordables, 0)            as recordables,
  coalesce(i.dart_cases, 0)             as dart_cases,
  coalesce(i.lost_time_cases, 0)        as lost_time_cases,
  coalesce(i.days_away, 0)              as days_away,
  coalesce(i.days_restricted, 0)        as days_restricted,
  coalesce(h.hours_worked, 0)           as hours_worked
from incidents i
full outer join hours h
  on  h.company_id = i.company_id
  -- Overhead time and unassigned incidents both carry a null project. Equality
  -- would drop them; `is not distinct from` pairs them.
  and h.project_id is not distinct from i.project_id
  and h.month_of   = i.month_of;

comment on view reporting_safety_rates is
  'Recordable incidents against approved hours, by company, project and month — the numerator and denominator of TRIR and DART in one row. A month with hours and no incidents appears with a rate of zero; a month with incidents and no approved hours yields no rate, because that is a timekeeping gap rather than a rate.';

grant select on reporting_safety_rates to authenticated;
revoke all on reporting_safety_rates from anon;

-- The old comment claimed a definition was a calculation. It is now true.
comment on view reporting_safety_summary is
  'Incident counts by month. The rate metrics (TRIR, DART) divide these by hours worked and are computed from reporting_safety_rates, which carries incidents and approved hours at one grain; the 200,000-hour OSHA basis is stated in the metric definition rather than buried in a view.';

-- -----------------------------------------------------------------------------
-- Point the rate metrics at a view that can produce them, and correct DART
-- -----------------------------------------------------------------------------
update metric_definitions set
  source_view = 'reporting_safety_rates',
  expression  = 'case when sum(hours_worked) > 0 '
                'then sum(recordables) * 200000.0 / sum(hours_worked) end'
where company_id is null and key = 'trir';

update metric_definitions set
  source_view = 'reporting_safety_rates',
  expression  = 'case when sum(hours_worked) > 0 '
                'then sum(dart_cases) * 200000.0 / sum(hours_worked) end',
  description = 'Days away, restricted or transferred, per 100 full-time workers per year. '
                'Counts recordable cases, not days: a case that cost sixty restricted days '
                'counts once, the same as a case that cost one. Same 200,000-hour basis as TRIR.'
where company_id is null and key = 'dart_rate';

-- Both updates change the calculation, so app.publish_metric_version() records a
-- second version of each. Version 1 is kept rather than rewritten: it is what
-- the platform said before this migration, and a definition history that edits
-- out its own mistakes answers no question worth asking.

select app.assert_security_gates();
