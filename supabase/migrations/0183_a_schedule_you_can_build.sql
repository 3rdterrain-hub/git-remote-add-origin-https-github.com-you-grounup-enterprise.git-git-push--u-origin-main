-- =============================================================================
-- 0183 — A schedule you can build
--
-- This section is the largest instance of the defect this repository keeps
-- producing. Everything downstream of the plan is finished:
--
--   * `calculateSchedule` in the engine does a forward pass, a backward pass,
--     total and free float, the critical path, all four dependency types, lag,
--     constraints, calendars and cycle detection — under fifty tests
--   * `recalculate-schedule` is compiled, deployed and wired to a button
--   * 0029 governs it: float cannot be asserted, only computed
--   * 0158 closed the last door: only the engine's own role may write float
--   * the Schedule page is real, reads live data, and says honestly that there
--     is nothing on it
--
-- And nothing could create a single activity. No migration, no function and no
-- screen inserts into `work_calendars`, `schedule_activities`,
-- `schedule_dependencies` or `resource_assignments`. The engine has never run
-- on real data. The "Calculate the schedule" button is disabled on
-- `activities.length === 0`, which could never be false, and the Edge Function
-- would have refused with `no_calendar` anyway, because nothing could create
-- one of those either.
--
-- Three things are added, and they are the minimum that makes the rest live:
--
--   * a working week, because a duration in days is not a span of dates until
--     something says which days are worked
--   * activities from the work that was won, because `award_estimate_version`
--     already produces one `project_tasks` row per priced line, with its hours
--     and its crew, and `schedule_activities.project_task_id` has referenced
--     that table since 0015 without ever being filled in
--   * dependencies, because a list of activities with no order between them is
--     a list, and the critical path of a list is all of it
--
-- One activity per task. `project_tasks` is the cost object — budget, actual,
-- percent complete — and `schedule_activities` is the time object — dates,
-- float, critical path. They are joined by the key that has always been there.
-- `task_dependencies` (0007) duplicates `schedule_dependencies` field for field
-- and is read and written by nothing; it is left unused rather than given a
-- second writer, so there is one dependency table and not two.
--
-- What is deliberately NOT here: any write to `early_start`, `late_finish`,
-- either float, `is_critical` or `calculation_id`. 0158 guards those, and this
-- migration respects the guard rather than working around it — including where
-- that is inconvenient, which is noted at `update_schedule_activity` below.
--
-- WORKFLOW.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A working week
-- -----------------------------------------------------------------------------

/**
 * Give a company a working week if it has none.
 *
 * Monday to Friday, eight hours, because that is what a day rate on an estimate
 * already assumes — and a company that works Saturdays says so by editing it.
 * Seeded rather than invented at calculation time: the Edge Function refuses
 * without a calendar on purpose, and it is right to, because dates produced
 * from a week nobody agreed to are dates nobody can be held to.
 */
create or replace function app.ensure_work_calendar(p_company uuid)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_id uuid;
begin
  select id into v_id from work_calendars
   where company_id = p_company
   order by is_default desc, created_at
   limit 1;
  if v_id is not null then return v_id; end if;

  if not app.has_permission(p_company, 'projects.write') then
    raise exception 'You do not have permission to set up a working week'
      using errcode = 'insufficient_privilege';
  end if;

  insert into work_calendars (company_id, code, name, description,
                              working_weekdays, hours_per_day, is_default)
  values (p_company, 'STANDARD', 'Monday to Friday',
          'The company''s normal working week. Change it here and every '
          || 'schedule calculated afterwards uses it.',
          array[1,2,3,4,5]::smallint[], 8, true)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.ensure_work_calendar(uuid) is
  'Gives a company a Monday-to-Friday calendar if it has none. work_calendars has existed since 0029 with no writer anywhere, so recalculate-schedule refused every request with no_calendar. WORKFLOW.';

/**
 * Change a working week.
 *
 * Null leaves a field alone. Making one calendar the default clears the flag on
 * the others first, because the unique index in 0029 allows exactly one and a
 * caller should not have to know that to answer "use this one".
 */
create or replace function app.update_work_calendar(
  p_calendar    uuid,
  p_name        text default null,
  p_description text default null,
  p_weekdays    smallint[] default null,
  p_hours       numeric default null,
  p_is_default  boolean default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  select company_id into v_company from work_calendars where id = p_calendar;
  if v_company is null then
    raise exception 'No such calendar' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'projects.write') then
    raise exception 'You do not have permission to change the working week'
      using errcode = 'insufficient_privilege';
  end if;
  if p_weekdays is not null and cardinality(p_weekdays) = 0 then
    raise exception 'A working week needs at least one working day'
      using errcode = 'check_violation',
            hint = 'A calendar with no working days makes every schedule on it run forever looking for the next day somebody works.';
  end if;

  if p_is_default then
    update work_calendars set is_default = false, updated_at = now()
     where company_id = v_company and id <> p_calendar and is_default;
  end if;

  update work_calendars
     set name             = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
         description      = coalesce(p_description, description),
         working_weekdays = coalesce(p_weekdays, working_weekdays),
         hours_per_day    = coalesce(p_hours, hours_per_day),
         is_default       = coalesce(p_is_default, is_default),
         updated_at       = now()
   where id = p_calendar;
end;
$$;

comment on function app.update_work_calendar(uuid, text, text, smallint[], numeric, boolean) is
  'Edits a working week, clearing the previous default when a new one is named. WORKFLOW.';

/**
 * A company's calendars, with what is scheduled on each.
 *
 * The count matters because changing the hours in a day changes how long every
 * activity on that calendar takes, and a person should see how much work they
 * are about to move before they move it.
 */
create or replace view my_work_calendars
with (security_invoker = true) as
select c.id, c.company_id, c.code, c.name, c.description,
       c.working_weekdays, c.hours_per_day, c.is_default,
       c.created_at, c.updated_at,
       (select count(*) from schedule_activities a where a.calendar_id = c.id)
         as activity_count
  from work_calendars c;

comment on view my_work_calendars is
  'Working weeks with the number of activities scheduled on each. ENTITY.';

-- -----------------------------------------------------------------------------
-- Activities from the work that was won
-- -----------------------------------------------------------------------------

/**
 * Build a project's schedule from its budgeted tasks.
 *
 * One activity per task, carrying the task's own name, WBS code, crew and cost
 * line, and a duration derived from the hours the estimate priced: budgeted
 * hours over the calendar's working day, rounded up to a whole day and never
 * less than one. That is a starting position, not a plan — it assumes one crew
 * working straight through with no overlap — which is exactly what a scheduler
 * then drags into shape. Producing it is the difference between starting from
 * the work you sold and starting from an empty page.
 *
 * Dates are laid end to end from `p_start` because a duration with no dates
 * cannot be stored: `planned_start` and `planned_finish` are `not null`. The
 * engine replaces them as soon as there is logic between the activities and
 * somebody calculates.
 *
 * Idempotent. A task that already has an activity is left alone, so running it
 * again after a change order adds what is new without disturbing what a
 * scheduler has already moved.
 */
create or replace function app.build_schedule_from_tasks(
  p_project uuid,
  p_start   date default null)
returns int
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company  uuid;
  v_calendar uuid;
  v_hours    numeric;
  v_cursor   date;
  v_made     int := 0;
  v_sort     int;
  v_days     int;
  t          record;
begin
  select company_id, coalesce(p_start, planned_start, current_date)
    into v_company, v_cursor
    from projects where id = p_project;
  if v_company is null then
    raise exception 'No such project' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'projects.write') then
    raise exception 'You do not have permission to schedule this project'
      using errcode = 'insufficient_privilege';
  end if;

  v_calendar := app.ensure_work_calendar(v_company);
  select hours_per_day into v_hours from work_calendars where id = v_calendar;
  v_hours := greatest(coalesce(v_hours, 8), 1);
  v_cursor := coalesce(v_cursor, current_date);

  select coalesce(max(sort_order), -1) + 1 into v_sort
    from schedule_activities where project_id = p_project;

  for t in
    select pt.id, pt.name, pt.wbs_code, pt.crew_id, pt.source_line_item_id,
           pt.budgeted_hours, pt.percent_complete
      from project_tasks pt
     where pt.project_id = p_project
       and pt.status <> 'canceled'
       and not exists (
             select 1 from schedule_activities a where a.project_task_id = pt.id)
     order by pt.sort_order, pt.name
  loop
    /*
     * The hours the estimate priced, spread over working days. A task with no
     * hours on it is a milestone-shaped thing rather than a duration, and gets
     * one day rather than a zero-length bar nobody can see or take hold of.
     */
    v_days := greatest(1, ceil(coalesce(t.budgeted_hours, 0) / v_hours)::int);

    insert into schedule_activities (
      company_id, project_id, project_task_id, source_line_item_id, wbs_code,
      name, planned_start, planned_finish, duration_days, crew_id,
      calendar_id, sort_order, percent_complete)
    values (
      v_company, p_project, t.id, t.source_line_item_id, t.wbs_code,
      t.name, v_cursor, v_cursor + (v_days - 1), v_days, t.crew_id,
      v_calendar, v_sort, coalesce(t.percent_complete, 0));

    v_cursor := v_cursor + v_days;
    v_sort   := v_sort + 1;
    v_made   := v_made + 1;
  end loop;

  return v_made;
end;
$$;

comment on function app.build_schedule_from_tasks(uuid, date) is
  'Creates one schedule activity per budgeted task, with a duration from the hours the estimate priced. The first writer of schedule_activities: the FK to project_tasks has existed since 0015 and was never filled in. WORKFLOW.';

/**
 * Add one activity by hand.
 *
 * Not everything on a schedule comes from a priced line. Mobilization, a
 * permit, an inspection, a concrete cure, a milestone the owner named — these
 * have duration and logic and no cost of their own, and a schedule that cannot
 * hold them is not a schedule.
 */
create or replace function app.add_schedule_activity(
  p_project   uuid,
  p_name      text,
  p_start     date,
  p_duration  numeric default 1,
  p_milestone boolean default false,
  p_wbs_code  text default null,
  p_crew      uuid default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_days    int;
  v_id      uuid;
begin
  select company_id into v_company from projects where id = p_project;
  if v_company is null then
    raise exception 'No such project' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'projects.write') then
    raise exception 'You do not have permission to schedule this project'
      using errcode = 'insufficient_privilege';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'An activity needs a name' using errcode = 'check_violation';
  end if;

  /* A milestone is a moment, so it is one day long and says so. */
  v_days := case when p_milestone then 1
                 else greatest(1, ceil(coalesce(p_duration, 1))::int) end;

  insert into schedule_activities (
    company_id, project_id, name, wbs_code, planned_start, planned_finish,
    duration_days, is_milestone, crew_id, calendar_id, sort_order)
  values (
    v_company, p_project, btrim(p_name), nullif(btrim(coalesce(p_wbs_code,'')),''),
    p_start, p_start + (v_days - 1), v_days, coalesce(p_milestone, false), p_crew,
    app.ensure_work_calendar(v_company),
    (select coalesce(max(sort_order), -1) + 1
       from schedule_activities where project_id = p_project))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.add_schedule_activity(uuid, text, date, numeric, boolean, text, uuid) is
  'Adds an activity that did not come from a priced line — mobilization, a permit, a cure, a milestone. WORKFLOW.';

/**
 * Change an activity — what a scheduler actually spends the day doing.
 *
 * Null leaves a field alone. Dates and duration are separate arguments on
 * purpose: moving a bar and stretching it are different decisions, and a caller
 * that sets only a start should not find the finish recomputed underneath it.
 *
 * Note what this does NOT do. Moving dates by hand makes the stored float and
 * the critical flag stale, and the obvious thing would be to clear them here.
 * It does not, because 0158 guards those columns and clearing one is still
 * writing one — the trigger is right to refuse, and a function that talked its
 * way past the guard would be the hole the guard exists to close. Staleness is
 * shown instead: `updated_at` on the activity against `calculated_at` on the
 * calculation it points at. A float with a date on it can be read as old. A
 * float somebody silently blanked cannot be read as anything.
 */
create or replace function app.update_schedule_activity(
  p_activity        uuid,
  p_name            text default null,
  p_start           date default null,
  p_finish          date default null,
  p_duration        numeric default null,
  p_crew            uuid default null,
  p_milestone       boolean default null,
  p_wbs_code        text default null,
  p_percent         numeric default null,
  p_actual_start    date default null,
  p_actual_finish   date default null,
  p_constraint_type text default null,
  p_constraint_date date default null,
  p_clear_constraint boolean default false)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_a      schedule_activities%rowtype;
  v_start  date;
  v_finish date;
begin
  select * into v_a from schedule_activities where id = p_activity;
  if v_a.id is null then
    raise exception 'No such activity' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_a.company_id, 'projects.write') then
    raise exception 'You do not have permission to change this schedule'
      using errcode = 'insufficient_privilege';
  end if;
  if p_constraint_type is not null
     and p_constraint_type not in ('start_no_earlier','finish_no_later',
                                   'must_start_on','must_finish_on') then
    raise exception 'Unknown constraint %', p_constraint_type
      using errcode = 'check_violation';
  end if;
  if p_percent is not null and (p_percent < 0 or p_percent > 1) then
    raise exception 'Percent complete is a fraction between zero and one'
      using errcode = 'check_violation';
  end if;

  v_start  := coalesce(p_start, v_a.planned_start);
  v_finish := coalesce(p_finish, v_a.planned_finish);
  /* Given a duration and no explicit finish, the finish follows from the start. */
  if p_duration is not null and p_finish is null then
    v_finish := v_start + (greatest(1, ceil(p_duration)::int) - 1);
  elsif p_start is not null and p_finish is null and p_duration is null then
    /* Dragging a bar moves it; it does not stretch it. */
    v_finish := v_start + (v_a.planned_finish - v_a.planned_start);
  end if;
  if v_finish < v_start then
    raise exception 'An activity cannot finish before it starts'
      using errcode = 'check_violation';
  end if;

  update schedule_activities
     set name            = coalesce(nullif(btrim(coalesce(p_name,'')),''), name),
         wbs_code        = coalesce(nullif(btrim(coalesce(p_wbs_code,'')),''), wbs_code),
         planned_start   = v_start,
         planned_finish  = v_finish,
         duration_days   = coalesce(p_duration, (v_finish - v_start) + 1),
         crew_id         = coalesce(p_crew, crew_id),
         is_milestone    = coalesce(p_milestone, is_milestone),
         percent_complete = coalesce(p_percent, percent_complete),
         actual_start    = coalesce(p_actual_start, actual_start),
         actual_finish   = coalesce(p_actual_finish, actual_finish),
         constraint_type = case when p_clear_constraint then null
                                else coalesce(p_constraint_type, constraint_type) end,
         constraint_date = case when p_clear_constraint then null
                                else coalesce(p_constraint_date, constraint_date) end,
         updated_at      = now()
   where id = p_activity;
end;
$$;

comment on function app.update_schedule_activity(uuid, text, date, date, numeric, uuid, boolean, text, numeric, date, date, text, date, boolean) is
  'Moves, stretches, renames or progresses an activity. Touches no engine output: 0158 owns float and the critical flag, and staleness is shown by date rather than by blanking them. WORKFLOW.';

/**
 * Remove an activity.
 *
 * Its dependencies go with it — `schedule_dependencies` cascades on both ends,
 * because a link to an activity that no longer exists is not a link.
 */
create or replace function app.remove_schedule_activity(p_activity uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  select company_id into v_company from schedule_activities where id = p_activity;
  if v_company is null then
    raise exception 'No such activity' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'projects.write') then
    raise exception 'You do not have permission to change this schedule'
      using errcode = 'insufficient_privilege';
  end if;
  delete from schedule_activities where id = p_activity;
end;
$$;

comment on function app.remove_schedule_activity(uuid) is
  'Removes an activity and, by cascade, the logic tied to it. The task it was built from is untouched: a schedule is a plan for the work, not the work. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- Order between them
-- -----------------------------------------------------------------------------

/**
 * Say that one activity follows another.
 *
 * The four types are the ones the engine already implements. Lag is in days and
 * may be negative, which is how an overlap is written.
 *
 * A dependency on itself is refused here; a longer cycle is not. The engine
 * detects one and reports it as a warning, which is the better place for it —
 * refusing each link in turn would stop somebody re-ordering a schedule through
 * a state that is briefly circular.
 */
create or replace function app.add_schedule_dependency(
  p_predecessor uuid,
  p_successor   uuid,
  p_type        text default 'finish_to_start',
  p_lag_days    numeric default 0)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_project uuid;
  v_other   uuid;
  v_id      uuid;
begin
  if p_predecessor = p_successor then
    raise exception 'An activity cannot follow itself'
      using errcode = 'check_violation';
  end if;
  if p_type not in ('finish_to_start','start_to_start',
                    'finish_to_finish','start_to_finish') then
    raise exception 'Unknown dependency type %', p_type
      using errcode = 'check_violation';
  end if;

  select company_id, project_id into v_company, v_project
    from schedule_activities where id = p_predecessor;
  select project_id into v_other
    from schedule_activities where id = p_successor;
  if v_company is null or v_other is null then
    raise exception 'No such activity' using errcode = 'no_data_found';
  end if;
  if v_project is distinct from v_other then
    raise exception 'Those two activities are on different projects'
      using errcode = 'check_violation',
            hint = 'A critical path is calculated one project at a time.';
  end if;
  if not app.has_permission(v_company, 'projects.write') then
    raise exception 'You do not have permission to change this schedule'
      using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from schedule_dependencies
              where predecessor_id = p_predecessor
                and successor_id = p_successor) then
    raise exception 'Those two are already linked'
      using errcode = 'unique_violation',
            hint = 'Change the existing link''s type or lag rather than adding a second one.';
  end if;

  insert into schedule_dependencies (
    company_id, predecessor_id, successor_id, dependency_type, lag_days)
  values (v_company, p_predecessor, p_successor, p_type, coalesce(p_lag_days, 0))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.add_schedule_dependency(uuid, uuid, text, numeric) is
  'Links one activity to another. The first writer of schedule_dependencies, which the engine has read since it was written. WORKFLOW.';

/** Change a link's type or its lag without removing and re-adding it. */
create or replace function app.update_schedule_dependency(
  p_link     uuid,
  p_type     text default null,
  p_lag_days numeric default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  select company_id into v_company from schedule_dependencies where id = p_link;
  if v_company is null then
    raise exception 'No such dependency' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'projects.write') then
    raise exception 'You do not have permission to change this schedule'
      using errcode = 'insufficient_privilege';
  end if;
  if p_type is not null and p_type not in ('finish_to_start','start_to_start',
                                           'finish_to_finish','start_to_finish') then
    raise exception 'Unknown dependency type %', p_type
      using errcode = 'check_violation';
  end if;

  update schedule_dependencies
     set dependency_type = coalesce(p_type, dependency_type),
         lag_days        = coalesce(p_lag_days, lag_days)
   where id = p_link;
end;
$$;

comment on function app.update_schedule_dependency(uuid, text, numeric) is
  'Changes the type or the lag of an existing link. WORKFLOW.';

/** Unlink two activities. */
create or replace function app.remove_schedule_dependency(p_link uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  select company_id into v_company from schedule_dependencies where id = p_link;
  if v_company is null then
    raise exception 'No such dependency' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'projects.write') then
    raise exception 'You do not have permission to change this schedule'
      using errcode = 'insufficient_privilege';
  end if;
  delete from schedule_dependencies where id = p_link;
end;
$$;

comment on function app.remove_schedule_dependency(uuid) is
  'Removes a link between two activities. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- Who and what is on it
-- -----------------------------------------------------------------------------

/**
 * Put a crew, a person, a machine or a subcontractor on an activity.
 *
 * `resource_assignments` had five readers and no writer. Two of them matter
 * more than the schedule page does: `my_assignments` is what the field app
 * shows a person when they sign in, and `my_project_tasks` gates on an
 * assignment existing. So every crew's phone was empty, permanently, and
 * nothing in the platform could make it otherwise.
 *
 * Dates default to the activity's own, because the common case is "this crew,
 * this activity" and asking for the dates again invites them to disagree with
 * the bar they were read from.
 */
create or replace function app.assign_resource(
  p_activity   uuid,
  p_kind       text,
  p_crew       uuid default null,
  p_employee   uuid default null,
  p_asset      uuid default null,
  p_vendor     uuid default null,
  p_starts_on  date default null,
  p_ends_on    date default null,
  p_allocation numeric default 1,
  p_notes      text default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_a  schedule_activities%rowtype;
  v_id uuid;
  v_from date;
  v_to   date;
begin
  select * into v_a from schedule_activities where id = p_activity;
  if v_a.id is null then
    raise exception 'No such activity' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_a.company_id, 'projects.write') then
    raise exception 'You do not have permission to staff this project'
      using errcode = 'insufficient_privilege';
  end if;
  if p_kind not in ('crew','employee','asset','subcontractor') then
    raise exception 'Unknown kind of resource %', p_kind
      using errcode = 'check_violation';
  end if;
  if p_allocation is not null and (p_allocation <= 0 or p_allocation > 1) then
    raise exception 'An allocation is a fraction greater than zero and at most one'
      using errcode = 'check_violation';
  end if;

  /*
   * One reference, matching the kind. The table's own constraint says the same,
   * but it reports a constraint name and this reports what to do about it.
   */
  if (p_kind = 'crew' and p_crew is null)
     or (p_kind = 'employee' and p_employee is null)
     or (p_kind = 'asset' and p_asset is null)
     or (p_kind = 'subcontractor' and p_vendor is null) then
    raise exception 'A % assignment needs a % to be chosen', p_kind,
      case p_kind when 'subcontractor' then 'vendor' else p_kind end
      using errcode = 'check_violation';
  end if;

  v_from := coalesce(p_starts_on, v_a.planned_start);
  v_to   := coalesce(p_ends_on, v_a.planned_finish);
  if v_to < v_from then
    raise exception 'An assignment cannot end before it starts'
      using errcode = 'check_violation';
  end if;

  insert into resource_assignments (
    company_id, project_id, schedule_activity_id, resource_kind,
    crew_id, employee_id, asset_id, vendor_id,
    starts_on, ends_on, allocation, notes)
  values (
    v_a.company_id, v_a.project_id, p_activity, p_kind,
    case when p_kind = 'crew' then p_crew end,
    case when p_kind = 'employee' then p_employee end,
    case when p_kind = 'asset' then p_asset end,
    case when p_kind = 'subcontractor' then p_vendor end,
    v_from, v_to, coalesce(p_allocation, 1), nullif(btrim(coalesce(p_notes,'')),''))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.assign_resource(uuid, text, uuid, uuid, uuid, uuid, date, date, numeric, text) is
  'Puts a crew, a person, a machine or a subcontractor on an activity. The first writer of resource_assignments, which had five readers and none — including the one the field app reads, so every crew phone was empty. WORKFLOW.';

/** Change the dates, the share or the note on an assignment. */
create or replace function app.update_resource_assignment(
  p_assignment uuid,
  p_starts_on  date default null,
  p_ends_on    date default null,
  p_allocation numeric default null,
  p_notes      text default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_r resource_assignments%rowtype;
  v_from date;
  v_to   date;
begin
  select * into v_r from resource_assignments where id = p_assignment;
  if v_r.id is null then
    raise exception 'No such assignment' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_r.company_id, 'projects.write') then
    raise exception 'You do not have permission to staff this project'
      using errcode = 'insufficient_privilege';
  end if;
  if p_allocation is not null and (p_allocation <= 0 or p_allocation > 1) then
    raise exception 'An allocation is a fraction greater than zero and at most one'
      using errcode = 'check_violation';
  end if;

  v_from := coalesce(p_starts_on, v_r.starts_on);
  v_to   := coalesce(p_ends_on, v_r.ends_on);
  if v_to < v_from then
    raise exception 'An assignment cannot end before it starts'
      using errcode = 'check_violation';
  end if;

  update resource_assignments
     set starts_on  = v_from,
         ends_on    = v_to,
         allocation = coalesce(p_allocation, allocation),
         notes      = coalesce(nullif(btrim(coalesce(p_notes,'')),''), notes),
         updated_at = now()
   where id = p_assignment;
end;
$$;

comment on function app.update_resource_assignment(uuid, date, date, numeric, text) is
  'Changes the dates, the share or the note on an assignment. WORKFLOW.';

/** Take a resource back off an activity. */
create or replace function app.release_resource(p_assignment uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  select company_id into v_company from resource_assignments where id = p_assignment;
  if v_company is null then
    raise exception 'No such assignment' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'projects.write') then
    raise exception 'You do not have permission to staff this project'
      using errcode = 'insufficient_privilege';
  end if;
  delete from resource_assignments where id = p_assignment;
end;
$$;

comment on function app.release_resource(uuid) is
  'Takes a crew, a person or a machine back off an activity. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- What a schedule looks like once it can be built
-- -----------------------------------------------------------------------------

/**
 * Whether a project has work waiting to be scheduled.
 *
 * The Schedule page needs this to offer the one button that matters: "build the
 * schedule from the eleven tasks on this job" rather than an empty page and a
 * disabled control. Counted here rather than in the browser so that the offer
 * and the function that fulfills it read the same rows through the same rules.
 */
create or replace view my_schedulable_projects
with (security_invoker = true) as
select p.id                          as project_id,
       p.company_id,
       p.number,
       p.name,
       p.planned_start,
       count(distinct t.id) filter (where t.status <> 'canceled')
         as task_count,
       count(distinct t.id) filter (where t.status <> 'canceled' and a.id is null)
         as unscheduled_task_count,
       /*
        * Every activity on the project, not only the ones a task produced — a
        * schedule holds permits and cures and milestones too, and a count that
        * missed them would offer to build a schedule that already exists.
        */
       (select count(*) from schedule_activities sa where sa.project_id = p.id)
         as activity_count
  from projects p
  left join project_tasks t on t.project_id = p.id
  left join schedule_activities a on a.project_task_id = t.id
 group by p.id, p.company_id, p.number, p.name, p.planned_start;

comment on view my_schedulable_projects is
  'Per project: how many budgeted tasks exist, how many have no activity yet, and how many activities there are. ENTITY. The Schedule page reads it to offer building a schedule instead of showing an empty one.';

-- -----------------------------------------------------------------------------
-- The doors
--
-- Thin `public` wrappers, because PostgREST only sees this schema, and grants
-- to `authenticated` only. Every one is `security invoker`: the permission
-- check inside each function is the real gate, and row level security still
-- applies underneath it.
-- -----------------------------------------------------------------------------

create or replace function public.ensure_work_calendar(p_company uuid)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.ensure_work_calendar(p_company); $$;

create or replace function public.update_work_calendar(
  p_calendar uuid, p_name text default null, p_description text default null,
  p_weekdays smallint[] default null, p_hours numeric default null,
  p_is_default boolean default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.update_work_calendar(p_calendar, p_name, p_description,
       p_weekdays, p_hours, p_is_default); $$;

create or replace function public.build_schedule_from_tasks(
  p_project uuid, p_start date default null)
returns int language sql security invoker set search_path = public, pg_catalog
as $$ select app.build_schedule_from_tasks(p_project, p_start); $$;

create or replace function public.add_schedule_activity(
  p_project uuid, p_name text, p_start date, p_duration numeric default 1,
  p_milestone boolean default false, p_wbs_code text default null,
  p_crew uuid default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.add_schedule_activity(p_project, p_name, p_start, p_duration,
       p_milestone, p_wbs_code, p_crew); $$;

create or replace function public.update_schedule_activity(
  p_activity uuid, p_name text default null, p_start date default null,
  p_finish date default null, p_duration numeric default null,
  p_crew uuid default null, p_milestone boolean default null,
  p_wbs_code text default null, p_percent numeric default null,
  p_actual_start date default null, p_actual_finish date default null,
  p_constraint_type text default null, p_constraint_date date default null,
  p_clear_constraint boolean default false)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.update_schedule_activity(p_activity, p_name, p_start, p_finish,
       p_duration, p_crew, p_milestone, p_wbs_code, p_percent, p_actual_start,
       p_actual_finish, p_constraint_type, p_constraint_date, p_clear_constraint); $$;

create or replace function public.remove_schedule_activity(p_activity uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.remove_schedule_activity(p_activity); $$;

create or replace function public.add_schedule_dependency(
  p_predecessor uuid, p_successor uuid, p_type text default 'finish_to_start',
  p_lag_days numeric default 0)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.add_schedule_dependency(p_predecessor, p_successor, p_type, p_lag_days); $$;

create or replace function public.update_schedule_dependency(
  p_link uuid, p_type text default null, p_lag_days numeric default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.update_schedule_dependency(p_link, p_type, p_lag_days); $$;

create or replace function public.remove_schedule_dependency(p_link uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.remove_schedule_dependency(p_link); $$;

create or replace function public.assign_resource(
  p_activity uuid, p_kind text, p_crew uuid default null,
  p_employee uuid default null, p_asset uuid default null,
  p_vendor uuid default null, p_starts_on date default null,
  p_ends_on date default null, p_allocation numeric default 1,
  p_notes text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.assign_resource(p_activity, p_kind, p_crew, p_employee, p_asset,
       p_vendor, p_starts_on, p_ends_on, p_allocation, p_notes); $$;

create or replace function public.update_resource_assignment(
  p_assignment uuid, p_starts_on date default null, p_ends_on date default null,
  p_allocation numeric default null, p_notes text default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.update_resource_assignment(p_assignment, p_starts_on, p_ends_on,
       p_allocation, p_notes); $$;

create or replace function public.release_resource(p_assignment uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.release_resource(p_assignment); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.ensure_work_calendar(uuid)',
    'public.update_work_calendar(uuid, text, text, smallint[], numeric, boolean)',
    'public.build_schedule_from_tasks(uuid, date)',
    'public.add_schedule_activity(uuid, text, date, numeric, boolean, text, uuid)',
    'public.update_schedule_activity(uuid, text, date, date, numeric, uuid, boolean, text, numeric, date, date, text, date, boolean)',
    'public.remove_schedule_activity(uuid)',
    'public.add_schedule_dependency(uuid, uuid, text, numeric)',
    'public.update_schedule_dependency(uuid, text, numeric)',
    'public.remove_schedule_dependency(uuid)',
    'public.assign_resource(uuid, text, uuid, uuid, uuid, uuid, date, date, numeric, text)',
    'public.update_resource_assignment(uuid, date, date, numeric, text)',
    'public.release_resource(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

/*
 * Explicitly, both ways. A view does not pick up the default privileges a table
 * does, and `anon` must not pick up either of these — the privilege gate in
 * 0012 fails the migration if it can, which is how this was caught rather than
 * shipped.
 */
revoke all on my_work_calendars from public, anon;
revoke all on my_schedulable_projects from public, anon;
grant select on my_work_calendars to authenticated, service_role;
grant select on my_schedulable_projects to authenticated, service_role;
