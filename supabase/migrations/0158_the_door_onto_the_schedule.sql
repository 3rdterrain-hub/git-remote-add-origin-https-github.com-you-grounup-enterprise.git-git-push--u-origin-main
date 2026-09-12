-- =============================================================================
-- 0158 — The door onto the schedule, and the same boundary the estimate has
--
-- Migration 0029 built the governance for critical path scheduling and built it
-- well: calendars with exceptions, an append-only `schedule_calculations` that
-- records one run of the method with its engine version and its warnings, and a
-- constraint saying float cannot exist on an activity that does not name the
-- calculation which produced it — "float cannot be asserted, only computed".
--
-- Five tables, and not one of them had a reader or a writer anywhere in the
-- application. The arithmetic was written (`@grounup/engine`, `schedule.ts`),
-- the governance was written, and there was no way in. The Schedule page read a
-- fixture that ran the real engine over invented activities at module load — a
-- correct calculation of a job that does not exist.
--
-- Two things here.
--
-- **The boundary 0058 drew around a price is drawn around float.** That
-- migration said pricing "is not a privilege some roles have and others do not:
-- it is an operation only one piece of code may perform, however senior the
-- person asking." Everything in that sentence is true of a critical path. The
-- constraint from 0029 already stops float without provenance; it does not stop
-- a caller inserting a calculation row of their own invention and pointing
-- float at it. `app.guard_engine_outputs()` is generic over its column list —
-- 0058 wrote it that way on purpose — so the schedule reuses the trigger rather
-- than growing a second one.
--
-- **`app.record_schedule_calculation()` is the only door**, granted to
-- `service_role` alone, exactly as `record_engine_result` is. The Edge Function
-- that carries the engine holds that role and a browser never does. So a
-- person may plan — planned dates, durations, logic, calendars are all theirs —
-- and may not assert what the plan *implies*.
--
-- Engine: the critical path, and who is allowed to have computed one.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- What the engine owns on an activity
-- -----------------------------------------------------------------------------

/*
 * The planned dates are deliberately *not* guarded. A duration, a logic tie and
 * a constraint date are a person's plan and stay theirs to change; the early
 * and late dates, the two floats, the critical flag and the calculation link
 * are what the method produces from that plan. Guarding the inputs would stop
 * anyone scheduling anything.
 */
drop trigger if exists schedule_activities_engine_outputs on schedule_activities;
create trigger schedule_activities_engine_outputs
  before insert or update on schedule_activities
  for each row execute function app.guard_engine_outputs(
    'early_start', 'early_finish', 'late_start', 'late_finish',
    'total_float_days', 'free_float_days', 'is_critical', 'calculation_id');

/*
 * A calculation is the provenance float points at, so it cannot be something a
 * caller writes either — otherwise the constraint from 0029 is satisfied by
 * naming a row you invented a moment earlier. Reading them stays open: the
 * history of what was calculated, when, by whom and with which engine is
 * exactly what a company should be able to see.
 */
revoke insert, update, delete on schedule_calculations from authenticated;

comment on table schedule_calculations is
  'One run of the critical path method, append-only and written only by app.record_schedule_calculation(). ENTITY. The dates on schedule_activities point back here, so a float figure always names the calculation that produced it — and now the calculation itself cannot be forged either.';

-- -----------------------------------------------------------------------------
-- The one door
-- -----------------------------------------------------------------------------

/**
 * Record one run of the critical path method.
 *
 * Takes the whole result at once — the run and every activity in it — because
 * a schedule that is half updated is not a schedule, and two calls could leave
 * activities pointing at two different calculations of the same project.
 *
 * `security definer` and granted to `service_role` alone. The Edge Function
 * that carries the engine calls this; a signed-in user cannot, however senior,
 * which is the point. The same shape, and the same reasoning, as
 * `app.record_engine_result` in 0058.
 *
 * `p_activities` is `[{id, early_start, early_finish, late_start, late_finish,
 * total_float_days, free_float_days, is_critical}]`. An unknown key is refused
 * rather than ignored, because a key that matches nothing writes nothing and
 * reports success — 0136 and 0139 learned that twice.
 */
create or replace function app.record_schedule_calculation(
  p_company uuid,
  p_project uuid,
  p_data_date date,
  p_engine_version text,
  p_calendar uuid,
  p_project_start date,
  p_project_finish date,
  p_duration_working_days int,
  p_required_finish date,
  p_finish_float_days int,
  p_critical_path uuid[],
  p_warnings text[],
  p_activities jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_known constant text[] := array[
    'id', 'early_start', 'early_finish', 'late_start', 'late_finish',
    'total_float_days', 'free_float_days', 'is_critical'];
  v_unknown text[];
  v_id      uuid;
  v_row     jsonb;
  v_touched int := 0;
begin
  if jsonb_typeof(p_activities) <> 'array' then
    raise exception 'The calculated activities are given as an array.'
      using errcode = 'invalid_parameter_value';
  end if;

  select array_agg(distinct k order by k) into v_unknown
    from jsonb_array_elements(p_activities) e,
         lateral jsonb_object_keys(e.value) k
   where k <> all (v_known);
  if v_unknown is not null then
    raise exception 'A calculated activity has no field called %. It takes: %.',
      array_to_string(v_unknown, ', '), array_to_string(v_known, ', ')
      using errcode = 'undefined_column';
  end if;

  if not exists (select 1 from projects where id = p_project and company_id = p_company) then
    raise exception 'That project does not belong to that company'
      using errcode = 'no_data_found';
  end if;

  /*
   * The marker the guard reads. `set local`, so it cannot outlive this
   * transaction and cannot be set by the caller — the same mechanism 0058 uses.
   */
  perform set_config('app.engine_write', 'on', true);

  insert into schedule_calculations (
    company_id, project_id, data_date, engine_version, calendar_id,
    project_start, project_finish, duration_working_days,
    required_finish, finish_float_days, critical_path, warnings, calculated_by)
  values (
    p_company, p_project, p_data_date, p_engine_version, p_calendar,
    p_project_start, p_project_finish, greatest(coalesce(p_duration_working_days, 0), 0),
    p_required_finish, p_finish_float_days,
    coalesce(p_critical_path, '{}'), coalesce(p_warnings, '{}'), auth.uid())
  returning id into v_id;

  for v_row in select value from jsonb_array_elements(p_activities) loop
    update schedule_activities a
       set early_start      = (v_row->>'early_start')::date,
           early_finish     = (v_row->>'early_finish')::date,
           late_start       = (v_row->>'late_start')::date,
           late_finish      = (v_row->>'late_finish')::date,
           total_float_days = (v_row->>'total_float_days')::numeric,
           free_float_days  = (v_row->>'free_float_days')::numeric,
           is_critical      = coalesce((v_row->>'is_critical')::boolean, false),
           calculation_id   = v_id,
           updated_at       = now()
     where a.id = (v_row->>'id')::uuid
       and a.project_id = p_project;
    if found then v_touched := v_touched + 1; end if;
  end loop;

  /*
   * Every activity or none. A run that quietly skipped an activity would leave
   * it carrying the float of a calculation that no longer describes it, which
   * is worse than no float at all.
   */
  if v_touched <> jsonb_array_length(p_activities) then
    raise exception 'The calculation named % activities and % of them are on this project',
      jsonb_array_length(p_activities), v_touched
      using errcode = 'no_data_found';
  end if;

  return v_id;
end;
$$;

comment on function app.record_schedule_calculation(uuid, uuid, date, text, uuid, date, date, int, date, int, uuid[], text[], jsonb) is
  'Records one run of the critical path method and points every activity at it. ENGINE: the only writer of float, the early and late dates and the critical flag, granted to service_role alone — a person plans, and the method says what the plan implies.';

revoke all on function app.record_schedule_calculation(
  uuid, uuid, date, text, uuid, date, date, int, date, int, uuid[], text[], jsonb)
  from public, anon, authenticated;
grant execute on function app.record_schedule_calculation(
  uuid, uuid, date, text, uuid, date, date, int, date, int, uuid[], text[], jsonb)
  to service_role;

-- -----------------------------------------------------------------------------
-- What a screen reads
-- -----------------------------------------------------------------------------

/**
 * The most recent calculation of a project, if there has been one.
 *
 * Derived rather than flagged, for the reason 0029 gave about baselines: a
 * stored "current" marker and an append-only table cannot both be true.
 */
create or replace view my_latest_schedule_calculation
with (security_invoker = true) as
select distinct on (c.project_id)
       c.id, c.company_id, c.project_id, c.data_date, c.engine_version,
       c.calendar_id, c.project_start, c.project_finish,
       c.duration_working_days, c.required_finish, c.finish_float_days,
       c.critical_path, c.warnings, c.calculated_at
from schedule_calculations c
order by c.project_id, c.calculated_at desc;

revoke all on my_latest_schedule_calculation from public, anon;
grant select on my_latest_schedule_calculation to authenticated;

comment on view my_latest_schedule_calculation is
  'The latest critical path run per project. ENTITY read: a schedule page needs the project finish and the warnings, and null here is the honest state of a schedule nobody has calculated.';

select app.assert_security_gates();
