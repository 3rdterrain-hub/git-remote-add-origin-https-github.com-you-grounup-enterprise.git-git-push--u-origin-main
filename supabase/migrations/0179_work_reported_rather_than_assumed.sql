/**
 * Work reported, rather than work assumed.
 *
 * `project_tasks.percent_complete` is `not null default 0`, and **nothing has
 * ever written it** — no migration, no trigger, no function, no screen. The
 * earned-value view computes `sum(budgeted_cost * percent_complete)` and guards
 * only on `sum(budgeted_cost) > 0`, which is true of every awarded project. So
 * on every job this platform has ever won:
 *
 *   * earned value renders as $0
 *   * progress renders as 0%
 *   * and the moment any cost posts — one timesheet, one fuel burn — the cost
 *     performance index renders 0.00 and the project page raises a red alarm
 *     reading "spending faster than the work is earning… that gap is margin
 *     fade"
 *
 * Permanently, on every job, saying the work is losing money when it is saying
 * nothing at all. A screen that cries wolf on every project teaches the people
 * reading it to stop reading it, which costs more than the missing feature did.
 *
 * Two things are wrong and both are fixed here.
 *
 * **The number had no writer.** The path existed and was never joined up:
 * `production_actuals` records quantity installed and crew hours against a task
 * on a given day, `record_production_actual` writes one, and nothing rolled
 * them up. A trigger now does — recomputed from the actuals, never incremented,
 * the rule from 0170 and D-034 — so a corrected or deleted report corrects the
 * task with it.
 *
 * **Silence was reported as zero.** An index computed from a quantity nobody
 * has reported is not zero, it is unknown, and the difference is the whole
 * alarm. The view now declines to answer until somebody has reported progress.
 *
 * WORKFLOW.
 */

-- -----------------------------------------------------------------------------
-- The number gets a writer
-- -----------------------------------------------------------------------------

/**
 * Roll a task's reported production up onto the task.
 *
 * `installed_quantity` and `actual_hours` are the sums of what the field
 * reported. `percent_complete` is the fraction of the budgeted quantity that
 * represents, capped at 1 — a task can be over its quantity, and a percentage
 * over 100 would break both the check constraint and every chart reading it.
 *
 * A task with no budgeted quantity cannot have a percentage derived from one.
 * It keeps whatever it has rather than being given a fabricated number.
 */
create or replace function app.recompute_task_progress(p_task uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_installed numeric;
  v_hours     numeric;
  v_budgeted  numeric;
begin
  if p_task is null then return; end if;

  select coalesce(sum(a.quantity_installed), 0), coalesce(sum(a.crew_hours), 0)
    into v_installed, v_hours
    from production_actuals a
   where a.project_task_id = p_task;

  select budgeted_quantity into v_budgeted from project_tasks where id = p_task;

  update project_tasks
     set installed_quantity = v_installed,
         actual_hours       = v_hours,
         percent_complete   = case
           when coalesce(v_budgeted, 0) > 0
             then least(1, round(v_installed / v_budgeted, 4))
           else percent_complete
         end,
         /*
          * A task nobody has reported on has not started. One with everything
          * installed is complete. In between it is running — and `status` is
          * not touched once somebody has set it to something deliberate like
          * `on_hold`, because the field saying "we did 40 feet" is not the
          * field saying "carry on".
          */
         status = case
           when status in ('not_started', 'in_progress') and v_installed <= 0
             then 'not_started'
           when status in ('not_started', 'in_progress')
                and coalesce(v_budgeted, 0) > 0 and v_installed >= v_budgeted
             then 'complete'
           when status in ('not_started', 'in_progress') then 'in_progress'
           else status
         end,
         actual_start = case
           when actual_start is null and v_installed > 0
             then (select min(a.work_date) from production_actuals a
                    where a.project_task_id = p_task)
           else actual_start
         end,
         updated_at = now()
   where id = p_task;
end;
$$;

comment on function app.recompute_task_progress(uuid) is
  'Rolls reported production up onto a task: installed quantity, actual hours and percent complete. Recomputed from the reports rather than incremented, so a corrected report corrects the task. Before 0179 percent_complete had no writer at all. WORKFLOW.';

create or replace function app.sync_task_from_production()
returns trigger
language plpgsql security definer set search_path = public, pg_catalog
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.project_task_id is not null then
    perform app.recompute_task_progress(old.project_task_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.project_task_id is not null then
    perform app.recompute_task_progress(new.project_task_id);
  end if;
  return null;
end;
$$;

drop trigger if exists production_actuals_sync_task on production_actuals;
create trigger production_actuals_sync_task
  after insert or update or delete on production_actuals
  for each row execute function app.sync_task_from_production();

comment on function app.sync_task_from_production() is
  'Keeps a task in step with what the field reported against it. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- Silence stops being reported as zero
-- -----------------------------------------------------------------------------

/**
 * Earned value, and what it is worth saying about it.
 *
 * Rebuilt from the 0142 definition with one change that matters: every figure
 * derived from progress is guarded on **progress having been reported**, not on
 * the budget existing. `sum(budgeted_cost) > 0` is true of every awarded
 * project from the moment it is awarded, so the old guard let the view answer
 * "zero" to a question nobody had the information to answer — and a zero flows
 * into a red alarm exactly like a real zero does.
 *
 * The guard is on progress *existing*, not on a quantity having been installed:
 * a day of mobilization is a report with nothing installed, and that is still
 * not a job at zero percent. `tasks_reported` is exposed so a screen can say
 * "nothing reported yet" rather than "0%", which are different sentences and
 * mean different things to a project manager.
 */
create or replace view reporting_project_earned_value
with (security_invoker = true) as
select
  t.company_id,
  t.project_id,
  count(*)::int                                          as tasks,
  count(*) filter (where t.status = 'complete')::int      as tasks_complete,
  sum(t.budgeted_cost)                                    as budgeted_cost,
  sum(t.actual_cost)                                      as task_actual_cost,
  sum(t.budgeted_hours)                                   as budgeted_hours,
  sum(t.actual_hours)                                     as actual_hours,

  -- BCWP: what the budget said the finished part of the work was worth. Null
  -- until somebody has reported some, because no report is not no progress.
  case when sum(t.budgeted_cost) > 0
            and sum(t.percent_complete) > 0
       then round(sum(t.budgeted_cost * t.percent_complete), 2) end as earned_value,

  -- Progress weighted by money rather than by task count, because ten pipe
  -- fittings and one lift station are not one eleventh of the job each.
  case when sum(t.budgeted_cost) > 0
            and sum(t.percent_complete) > 0
       then round(sum(t.budgeted_cost * t.percent_complete) / sum(t.budgeted_cost), 6)
       end                                                as percent_complete,

  -- CPI: earned over spent. Above 1.00 is work delivered for less than it was
  -- budgeted at; below is margin going out of the job. Null while nothing has
  -- been reported — an index of zero is an accusation, and until the field has
  -- said something there is nothing to accuse anybody of.
  case when sum(t.budgeted_cost) > 0 and sum(t.actual_cost) > 0
            and sum(t.percent_complete) > 0
       then round(sum(t.budgeted_cost * t.percent_complete) / sum(t.actual_cost), 4)
       end                                                as cost_performance_index,

  -- The same question asked of hours, which is the one a superintendent feels
  -- first: labor burns before the invoices arrive.
  case when sum(t.budgeted_hours) > 0 and sum(t.actual_hours) > 0
            and sum(t.percent_complete) > 0
       then round(sum(t.budgeted_hours * t.percent_complete) / sum(t.actual_hours), 4)
       end                                                as hours_performance_index,

  /*
   * How much of the work anybody has said anything about. Appended rather than
   * placed where it reads best, because `create or replace view` cannot insert
   * a column into the middle of an existing one — it can only add at the end.
   */
  count(*) filter (where t.percent_complete > 0)::int    as tasks_reported
from project_tasks t
where t.status <> 'canceled'
group by t.company_id, t.project_id;

comment on view reporting_project_earned_value is
  'Earned value against a project''s budget. Every progress figure is null until production has been reported against at least one task: before 0179 they read zero on every awarded job, and the cost performance index of 0.00 raised a permanent margin-fade alarm on work nobody had said anything about.';

-- -----------------------------------------------------------------------------
-- The work that was budgeted, which nothing has ever listed
-- -----------------------------------------------------------------------------

/**
 * The tasks an award created, and how each is going.
 *
 * `award_estimate_version` has copied every priced line onto the project as a
 * budgeted task since migration 0007 — quantity, hours, cost, cost code and
 * crew. Nothing has ever listed them, so the work carried across from the
 * estimate has been invisible on the project it was carried to.
 */
create or replace view my_project_task_progress as
select t.id,
       t.company_id,
       t.project_id,
       t.name,
       t.status,
       t.unit,
       t.budgeted_quantity,
       t.installed_quantity,
       t.percent_complete,
       t.budgeted_hours,
       t.actual_hours,
       t.budgeted_cost,
       t.actual_cost,
       t.actual_start,
       t.actual_finish,
       t.source_line_item_id,
       cc.code as cost_code,
       cc.name as cost_code_name,
       (t.installed_quantity > 0) as reported,
       case when t.budgeted_hours > 0 and t.actual_hours > 0
            then round((t.budgeted_hours * t.percent_complete) / t.actual_hours, 4)
            end as hours_index,
       (select max(a.work_date) from production_actuals a where a.project_task_id = t.id)
         as last_reported_on
  from project_tasks t
  left join cost_codes cc on cc.id = t.cost_code_id
 where t.status <> 'canceled';

revoke all on my_project_task_progress from public, anon;
grant select on my_project_task_progress to authenticated;
alter view my_project_task_progress set (security_invoker = on);

comment on view my_project_task_progress is
  'The budgeted work an award carried onto a project, and how each task is going. project_tasks has been written at award since 0007 and listed by nothing.';
