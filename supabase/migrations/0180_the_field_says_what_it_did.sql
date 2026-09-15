/**
 * The field says what it did.
 *
 * Migration 0179 made a task's progress real: `production_actuals` rolls up
 * onto `project_tasks`, and the earned-value view stays silent until somebody
 * has reported something. It left the loop open at the top. **Nothing anywhere
 * inserts a `production_actuals` row** — not a migration, not a function, not a
 * screen — so the rollup has no source and every project stays unreported
 * forever.
 *
 * `record_production_actual` (0115) looks like the writer and is not. Despite
 * the name it records a *production rate into the library* — quantity per hour,
 * sample size, utilization — which is a different act by a different person for
 * a different purpose. A superintendent closing out a day is not calibrating a
 * library.
 *
 * So this is the writer: one crew, one task, one day. Quantity installed and
 * the hours it took, which is all a production figure is — and between them
 * they give the engine the one thing it has never had, which is what this
 * company's own crews actually achieve.
 *
 * The unit is taken from the task, never from the caller. A day reported in
 * feet against a task budgeted in cubic yards would roll up into a percentage
 * that means nothing, and the person typing has no reason to be the one who
 * gets that right.
 *
 * WORKFLOW.
 */

/*
 * One report per task per day, which the upsert below depends on. A second
 * entry for a day is an amendment rather than an addition: somebody
 * remembering another forty feet at five o'clock is correcting the day.
 */
create unique index if not exists production_actuals_one_per_task_per_day
  on production_actuals(project_task_id, work_date)
  where project_task_id is not null;

/**
 * Report a day's production against a budgeted task.
 *
 * `p_work_date` defaults to today because that is when it is usually entered,
 * and is accepted for any day because it usually is not.
 *
 * One report per task per day. A second is an amendment, not an addition —
 * somebody remembering another forty feet at five o'clock is correcting the
 * day, not having a second one — so it replaces rather than stacking. The 0179
 * trigger recomputes the task either way.
 */
create or replace function app.report_production(
  p_task            uuid,
  p_quantity        numeric,
  p_crew_hours      numeric,
  p_work_date       date default current_date,
  p_equipment_hours numeric default 0,
  p_crew_size       int default null,
  p_daily_report    uuid default null,
  p_notes           text default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_t       project_tasks%rowtype;
  v_company uuid;
  v_id      uuid;
begin
  select * into v_t from project_tasks where id = p_task;
  if v_t.id is null then
    raise exception 'No such task' using errcode = 'no_data_found';
  end if;
  v_company := v_t.company_id;

  if not app.has_permission(v_company, 'projects.write') then
    raise exception 'You do not have permission to report on this project'
      using errcode = 'insufficient_privilege';
  end if;

  if p_quantity is null or p_quantity < 0 then
    raise exception 'A quantity installed is zero or more'
      using errcode = 'check_violation';
  end if;
  if p_crew_hours is null or p_crew_hours < 0 then
    raise exception 'Say how many crew hours it took'
      using errcode = 'check_violation',
            hint = 'A quantity with no hours against it cannot become a production rate.';
  end if;
  if p_work_date > current_date then
    raise exception 'That day has not happened yet'
      using errcode = 'check_violation';
  end if;
  if v_t.status = 'canceled' then
    raise exception 'That task was canceled; nothing can be reported against it'
      using errcode = 'check_violation';
  end if;

  /*
   * The unit comes from the task. A day reported in the wrong one rolls up into
   * a percentage that means nothing, and the person typing has no reason to be
   * the one who gets that right.
   */
  insert into production_actuals (
    company_id, project_id, project_task_id, daily_report_id, work_date,
    quantity_installed, unit, crew_hours, equipment_hours, crew_size, notes,
    recorded_by)
  values (
    v_company, v_t.project_id, p_task, p_daily_report, p_work_date,
    p_quantity, v_t.unit, p_crew_hours, coalesce(p_equipment_hours, 0),
    p_crew_size, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid())
  /*
   * The predicate is repeated because the index is partial: Postgres will not
   * match `on conflict (a, b)` to `create unique index ... where ...` unless
   * the inference says the same thing the index does.
   */
  on conflict (project_task_id, work_date) where project_task_id is not null
  do update
    set quantity_installed = excluded.quantity_installed,
        crew_hours         = excluded.crew_hours,
        equipment_hours    = excluded.equipment_hours,
        crew_size          = excluded.crew_size,
        notes              = excluded.notes,
        daily_report_id    = coalesce(excluded.daily_report_id,
                                      production_actuals.daily_report_id),
        recorded_by        = auth.uid()
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.report_production(uuid, numeric, numeric, date, numeric, int, uuid, text) is
  'One crew, one task, one day: what was installed and the hours it took. The only writer of production_actuals — before 0180 nothing wrote one, so the progress rollup in 0179 had no source. WORKFLOW.';

/** Take a day back — a report filed against the wrong task, or a day that was rained out. */
create or replace function app.withdraw_production_report(p_report uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  select company_id into v_company from production_actuals where id = p_report;
  if v_company is null then
    raise exception 'No such production report' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'projects.write') then
    raise exception 'You do not have permission to change this report'
      using errcode = 'insufficient_privilege';
  end if;
  delete from production_actuals where id = p_report;
end;
$$;

comment on function app.withdraw_production_report(uuid) is
  'Removes a day''s production report. The 0179 trigger corrects the task without anybody remembering to. WORKFLOW.';

/**
 * What has been reported against a project, day by day.
 *
 * `achieved_per_hour` is generated on the row, so the rate a crew actually hit
 * cannot disagree with the quantity and hours it came from. Against the task's
 * budgeted rate it is the whole of production reporting: whether the crew is
 * going faster or slower than the estimate said, on this job, this week.
 */
create or replace view my_production_reports as
select a.id,
       a.company_id,
       a.project_id,
       a.project_task_id,
       a.work_date,
       a.quantity_installed,
       a.unit,
       a.crew_hours,
       a.equipment_hours,
       a.crew_size,
       a.actual_per_hour,
       a.notes,
       a.recorded_by,
       a.created_at,
       t.name as task_name,
       t.budgeted_quantity,
       t.installed_quantity,
       t.percent_complete,
       case when t.budgeted_hours > 0 and t.budgeted_quantity > 0
            then round(t.budgeted_quantity / t.budgeted_hours, 4) end as budgeted_per_hour
  from production_actuals a
  join project_tasks t on t.id = a.project_task_id;

revoke all on my_production_reports from public, anon;
grant select on my_production_reports to authenticated;
alter view my_production_reports set (security_invoker = on);

comment on view my_production_reports is
  'What the field reported, day by day, with the rate achieved against the rate budgeted.';

create or replace function public.report_production(
  p_task uuid, p_quantity numeric, p_crew_hours numeric,
  p_work_date date default current_date, p_equipment_hours numeric default 0,
  p_crew_size int default null, p_daily_report uuid default null,
  p_notes text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.report_production(p_task, p_quantity, p_crew_hours, p_work_date,
       p_equipment_hours, p_crew_size, p_daily_report, p_notes); $$;

create or replace function public.withdraw_production_report(p_report uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.withdraw_production_report(p_report); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.report_production(uuid, numeric, numeric, date, numeric, int, uuid, text)',
    'public.withdraw_production_report(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
