-- =============================================================================
-- 0044 — Labor never reached the job, and every margin the platform reported
--        was too high because of it
--
-- `project_costs` has always carried a `cost_type` of `labor` and
-- `labor_burden`, an `hours` column, and a `source` of `timecard`. The
-- financial view sums those two types into `labor_cost` and reasons carefully
-- about why burden belongs with wages — "reporting it separately makes labor
-- look cheaper than it is, which is how a crew that is losing money looks fine
-- on a dashboard."
--
-- **Nothing ever wrote a labor row.** Before this migration the only insert into
-- `project_costs` anywhere in the schema was the fuel posting added for P12. So:
--
--   * `labor_cost` was always zero;
--   * `actual_cost` omitted the largest cost category on a construction job;
--   * `gross_profit_to_date` — contract value minus actual cost — was therefore
--     **systematically overstated**, and the more people a job had on it the
--     more it flattered;
--   * `labor_cost_ratio`, a governed metric shipped in the semantic layer,
--     could only ever return zero.
--
-- This is the same defect as the fuel posting in P12 and the same defect P29
-- found in the metric layer — a capability the schema anticipates in detail and
-- nothing performs — except that here it silently inflated reported profit.
--
-- Approved time only. Unapproved time is a claim about what happened rather
-- than a record of it, which is the rule `reporting_labor_productivity` and the
-- safety rates already follow; a job cost that moves every time somebody edits
-- a timesheet is not a job cost. Withdrawing an approval removes the cost
-- again, so the two never disagree.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A job cost can name the person who incurred it
-- -----------------------------------------------------------------------------
/*
 * `project_costs.employee_id` pointed at `auth.users`, so it could only name
 * somebody with a login — and field staff mostly do not have one, which is
 * stated in the `employees` schema itself. The column was written by nothing,
 * so repointing it at the table it was always meant to reference costs nothing
 * and makes labor cost attributable to the person who worked the hours.
 */
alter table project_costs drop constraint if exists project_costs_employee_id_fkey;
alter table project_costs
  add constraint project_costs_employee_id_fkey
  foreign key (employee_id) references employees(id) on delete set null;

comment on column project_costs.employee_id is
  'The employee who incurred this cost, for labor posted from a timecard. References employees rather than auth.users, because field staff commonly have no login and a cost nobody can be attributed to is a cost nobody can question.';

-- The posting deletes by reference before it re-inserts, on every touch.
create index if not exists project_costs_reference_idx
  on project_costs(company_id, reference) where reference is not null;

-- -----------------------------------------------------------------------------
-- What an hour of this person costs
-- -----------------------------------------------------------------------------
/**
 * The loaded rate for an employee, and the premium multipliers that go with it.
 *
 * The governed labor rate wins where one is assigned: it is the library row the
 * estimating engine prices with, so estimated and actual labor cost are
 * reconcilable against the same number instead of against two numbers that
 * happen to be close. The employee's own wage is the fallback for somebody with
 * no classification yet, and the statutory 1.5 and 2.0 are the last resort —
 * stated once here rather than assumed at each call site.
 */
create or replace function app.labor_rate_for(p_employee uuid)
returns table (base numeric, burden_percent numeric,
               overtime_multiplier numeric, doubletime_multiplier numeric)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    coalesce(lr.base_wage_per_hour, e.hourly_rate, 0)::numeric,
    coalesce(lr.burden_percent, e.burden_percent, 0)::numeric,
    coalesce(lr.overtime_multiplier, 1.5)::numeric,
    coalesce(lr.doubletime_multiplier, 2.0)::numeric
  from employees e
  left join labor_rates lr
    on lr.id = e.labor_rate_id and lr.status = 'active'
  where e.id = p_employee;
$$;

grant execute on function app.labor_rate_for(uuid) to authenticated, service_role;

comment on function app.labor_rate_for(uuid) is
  'The loaded wage and premium multipliers for an employee: the assigned governed labor rate where there is one, the employee record otherwise. One resolution order, so a screen and the job cost posting cannot price the same hour differently.';

-- -----------------------------------------------------------------------------
-- Posting a timecard to the job
-- -----------------------------------------------------------------------------
/**
 * Write one time entry's cost onto its project, or remove it.
 *
 * Kept in sync rather than posted once: every touch deletes what this entry
 * posted before and writes it again from what the entry now says, so a
 * corrected hour count corrects the job cost and a withdrawn approval takes the
 * cost back off. The same idempotent shape as the fuel posting.
 *
 * Wages and burden are separate rows. The financial view sums both into labor
 * cost — burden is labor cost — and keeping them distinct in the ledger lets
 * somebody see the split without letting a report show wages alone.
 */
create or replace function app.post_time_entry(p_entry time_entries)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r          record;
  v_ref      text := 'time_entry:' || p_entry.id::text;
  v_hours    numeric;
  v_wages    numeric;
  v_burden   numeric;
  v_who      text;
begin
  delete from project_costs
   where company_id = p_entry.company_id and reference = v_ref;

  -- No project to charge, or time nobody has approved yet. Both are reasons to
  -- post nothing, and both must also *un*post, which the delete above did.
  if p_entry.project_id is null or p_entry.approval_state <> 'approved' then
    return;
  end if;

  select * into r from app.labor_rate_for(p_entry.employee_id);

  v_hours := coalesce(p_entry.straight_hours, 0)
           + coalesce(p_entry.overtime_hours, 0)
           + coalesce(p_entry.doubletime_hours, 0);

  v_wages := round(
      coalesce(p_entry.straight_hours, 0)   * r.base
    + coalesce(p_entry.overtime_hours, 0)   * r.base * r.overtime_multiplier
    + coalesce(p_entry.doubletime_hours, 0) * r.base * r.doubletime_multiplier, 2);

  v_burden := round(v_wages * r.burden_percent, 2);

  select coalesce(full_name, 'Employee') into v_who from employees where id = p_entry.employee_id;

  if v_hours > 0 and v_wages > 0 then
    insert into project_costs (
      company_id, project_id, project_task_id, cost_code_id, cost_date, cost_type,
      description, quantity, unit, unit_cost, amount, hours, employee_id,
      reference, source, posted_at)
    values (
      p_entry.company_id, p_entry.project_id, p_entry.project_task_id, p_entry.cost_code_id,
      p_entry.work_date, 'labor',
      v_who || ' — ' || v_hours || ' hr',
      v_hours, 'HR', round(v_wages / v_hours, 4), v_wages, v_hours, p_entry.employee_id,
      v_ref, 'timecard', now());
  end if;

  if v_burden > 0 then
    insert into project_costs (
      company_id, project_id, project_task_id, cost_code_id, cost_date, cost_type,
      description, quantity, unit, unit_cost, amount, hours, employee_id,
      reference, source, posted_at)
    values (
      p_entry.company_id, p_entry.project_id, p_entry.project_task_id, p_entry.cost_code_id,
      p_entry.work_date, 'labor_burden',
      v_who || ' — burden at ' || round(r.burden_percent * 100, 2) || '%',
      v_hours, 'HR', round(v_burden / nullif(v_hours, 0), 4), v_burden, 0, p_entry.employee_id,
      v_ref, 'timecard', now());
  end if;

  -- Per diem is a cost of having that person on that job, and leaving it out
  -- would repeat in miniature the omission this migration exists to fix. Not
  -- burdened: it is a reimbursement, not a wage.
  if coalesce(p_entry.per_diem, 0) > 0 then
    insert into project_costs (
      company_id, project_id, project_task_id, cost_code_id, cost_date, cost_type,
      description, quantity, unit, unit_cost, amount, hours, employee_id,
      reference, source, posted_at)
    values (
      p_entry.company_id, p_entry.project_id, p_entry.project_task_id, p_entry.cost_code_id,
      p_entry.work_date, 'labor',
      v_who || ' — per diem',
      1, 'DAY', p_entry.per_diem, p_entry.per_diem, 0, p_entry.employee_id,
      v_ref, 'timecard', now());
  end if;
end;
$$;

comment on function app.post_time_entry(time_entries) is
  'Writes one approved timecard onto its job as wages, burden and per diem, or removes what it wrote. Idempotent by reference, so corrections and withdrawn approvals keep the job cost in step with the timesheet.';

create or replace function app.post_labor_to_job_cost()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    delete from project_costs where company_id = old.company_id
      and reference = 'time_entry:' || old.id::text;
    return old;
  end if;

  -- A moved entry leaves nothing behind on the project it was charged to.
  if tg_op = 'UPDATE' and old.project_id is distinct from new.project_id then
    delete from project_costs where company_id = old.company_id
      and reference = 'time_entry:' || old.id::text;
  end if;

  perform app.post_time_entry(new);
  return new;
end;
$$;

create trigger post_labor_to_job_cost
  after insert or update or delete on time_entries
  for each row execute function app.post_labor_to_job_cost();

comment on function app.post_labor_to_job_cost() is
  'Keeps a job cost in step with the timecard behind it. Approved time only, and the posting is a project cost like any other — so the financial period cutoff refuses one dated into a closed period, and a timesheet cannot route around the accounting control.';

-- Everything already approved, posted now.
do $$
declare t time_entries;
begin
  for t in select * from time_entries where approval_state = 'approved' and project_id is not null
  loop
    perform app.post_time_entry(t);
  end loop;
end;
$$;

select app.assert_security_gates();

-- -----------------------------------------------------------------------------
-- The same day's hours, recorded twice, compared nowhere
-- -----------------------------------------------------------------------------
/**
 * Daily report hours against timecard hours, by project and day.
 *
 * The platform records the same work twice and always has: the foreman writes
 * crew hours on the daily report, and the timecards are entered separately.
 * `time_entries.daily_report_id` exists to tie them together and nothing ever
 * compared the totals — so a daily report claiming forty hours and timecards
 * claiming thirty-two could sit side by side indefinitely, with the job costed
 * off one and the production rate read off the other.
 *
 * This is the oldest labor control on a construction job and it is a
 * subtraction. It reports rather than refuses, deliberately: the two legitimately
 * differ during the day, and a control that blocks a foreman's report because
 * payroll has not caught up is a control that gets worked around by not filing
 * the report.
 *
 * Approved timecards only, matching every other labor figure in the platform.
 */
create or replace view reporting_labor_reconciliation
with (security_invoker = true) as
select
  coalesce(d.company_id, t.company_id)      as company_id,
  coalesce(d.project_id, t.project_id)      as project_id,
  coalesce(d.work_date, t.work_date)        as work_date,
  coalesce(d.reported_hours, 0)             as daily_report_hours,
  coalesce(t.timecard_hours, 0)             as timecard_hours,
  coalesce(d.reported_hours, 0) - coalesce(t.timecard_hours, 0) as variance_hours,
  coalesce(d.headcount, 0)                  as reported_headcount,
  coalesce(t.people, 0)                     as timecard_people,
  -- Named rather than left to a reader to work out, because the direction is
  -- the whole meaning: hours worked and never paid, or hours paid and never
  -- reported as worked.
  case
    when d.reported_hours is null then 'no daily report'
    when t.timecard_hours is null then 'no approved timecards'
    when abs(coalesce(d.reported_hours,0) - coalesce(t.timecard_hours,0)) < 0.01 then 'agreed'
    when coalesce(d.reported_hours,0) > coalesce(t.timecard_hours,0) then 'hours reported not on a timecard'
    else 'hours on a timecard not reported'
  end                                       as finding
from (
  select dr.company_id, dr.project_id, dr.report_date as work_date,
         sum(l.straight_hours + l.overtime_hours) as reported_hours,
         sum(l.headcount)                         as headcount
  from daily_reports dr
  join daily_report_labor l on l.daily_report_id = dr.id
  group by dr.company_id, dr.project_id, dr.report_date
) d
full outer join (
  select te.company_id, te.project_id, te.work_date,
         sum(te.total_hours)              as timecard_hours,
         count(distinct te.employee_id)   as people
  from time_entries te
  where te.approval_state = 'approved' and te.project_id is not null
  group by te.company_id, te.project_id, te.work_date
) t
  on  t.company_id = d.company_id
  and t.project_id = d.project_id
  and t.work_date  = d.work_date;

comment on view reporting_labor_reconciliation is
  'Daily report hours against approved timecard hours, by project and day, with the direction of any difference named. Reports rather than refuses: the two legitimately differ while a day is still being entered, and a control that blocks the foreman because payroll is behind is a control that stops being used.';

grant select on reporting_labor_reconciliation to authenticated;
revoke all on reporting_labor_reconciliation from anon;

select app.assert_security_gates();
