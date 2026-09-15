-- =============================================================================
-- 0185 — A baseline somebody took
--
-- Migration 0029 built baselines carefully. `schedule_baselines` records why
-- one exists and the date it was approved as data rather than from a clock, so
-- importing last March's baseline records last March.
-- `schedule_baseline_activities` deliberately carries no foreign key to the
-- activity, so a baseline survives the deletion of what it recorded and dropped
-- work shows as removed rather than vanishing. `reporting_schedule_variance`
-- reads both and reports every activity against the current baseline, which is
-- derived from the most recent one rather than flagged.
--
-- All of it correct, and nothing could take a baseline. The variance report
-- returned no rows at all, because it inner-joins the current baseline and
-- there was never one to join to.
--
-- Two things here, and the second is the one that matters:
--
--   * `take_schedule_baseline` snapshots every activity as it stands, in one
--     statement, and records which calculation the dates came from.
--   * **A baseline may only be taken from a calculated schedule.** Planned
--     dates somebody typed are a proposal; a baseline is the thing variance is
--     measured against for the rest of the job. Baselining an uncalculated
--     schedule would freeze a set of dates that no logic supports, and every
--     variance figure afterwards would be measured against a guess.
--
-- A baseline is append-only by design — 0029 says so, and the derived "current
-- baseline" depends on it — so there is no update here. A baseline taken in
-- error is superseded by taking another, which is what a recovery schedule is.
--
-- WORKFLOW.
-- =============================================================================

/**
 * Take a baseline: the schedule as approved, kept so today can be read
 * against it.
 *
 * `reason` is required and must say something — 0029 asks for at least eight
 * characters — because "why is there a second baseline on this job" is the
 * first question anybody asks six months later, and the answer belongs beside
 * the baseline rather than in somebody's memory.
 */
create or replace function app.take_schedule_baseline(
  p_project  uuid,
  p_name     text,
  p_reason   text,
  p_taken_on date default current_date)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_calc    uuid;
  v_id      uuid;
  v_count   int;
begin
  select company_id into v_company from projects where id = p_project;
  if v_company is null then
    raise exception 'No such project' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'projects.write') then
    raise exception 'You do not have permission to baseline this schedule'
      using errcode = 'insufficient_privilege';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'A baseline needs a name' using errcode = 'check_violation';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 8 then
    raise exception 'Say why this baseline is being taken'
      using errcode = 'check_violation',
            hint = 'Original award, a change order, a recovery schedule. Six '
                 || 'months from now this is the only record of the reason.';
  end if;

  select count(*) into v_count from schedule_activities where project_id = p_project;
  if v_count = 0 then
    raise exception 'There is nothing on this schedule to baseline'
      using errcode = 'no_data_found';
  end if;

  /*
   * The most recent run on this project. Not optional: a baseline is what
   * variance is measured against for the rest of the job, and dates nobody
   * calculated are a proposal rather than a plan. Freezing them would make
   * every variance figure afterwards a comparison against a guess.
   */
  select id into v_calc
    from schedule_calculations
   where project_id = p_project
   order by calculated_at desc
   limit 1;

  if v_calc is null then
    raise exception 'Calculate the schedule before baselining it'
      using errcode = 'check_violation',
            hint = 'Float and the critical path come from the method. A baseline '
                 || 'of dates nobody calculated would be a guess to measure against.';
  end if;

  insert into schedule_baselines (
    company_id, project_id, name, taken_on, reason, calculation_id, approved_by)
  values (v_company, p_project, btrim(p_name), coalesce(p_taken_on, current_date),
          btrim(p_reason), v_calc, auth.uid())
  returning id into v_id;

  /*
   * Every activity as it stands, in one statement. A baseline written a row at
   * a time could be interrupted halfway and leave a partial record of an
   * approved schedule, which is worse than none.
   */
  insert into schedule_baseline_activities (
    company_id, baseline_id, schedule_activity_id, wbs_code, name,
    planned_start, planned_finish, duration_days, total_float_days,
    is_critical, is_milestone)
  select v_company, v_id, a.id, a.wbs_code, a.name,
         coalesce(a.early_start, a.planned_start),
         coalesce(a.early_finish, a.planned_finish),
         a.duration_days, a.total_float_days, a.is_critical, a.is_milestone
    from schedule_activities a
   where a.project_id = p_project;

  return v_id;
end;
$$;

comment on function app.take_schedule_baseline(uuid, text, text, date) is
  'Snapshots the schedule as approved. The first writer of schedule_baselines, which 0029 built along with the variance report that reads it. Refuses an uncalculated schedule: a baseline of dates nobody computed is a guess to measure against. WORKFLOW.';

/**
 * The baselines on a project, newest first, with what each one holds.
 *
 * `is_current` is computed here from the ordering rather than stored, for the
 * reason 0029 gave: a stored current flag and an append-only table cannot both
 * be true.
 */
create or replace view my_schedule_baselines
with (security_invoker = true) as
select b.id, b.company_id, b.project_id, b.name, b.taken_on, b.reason,
       b.calculation_id, b.created_at,
       coalesce(u.full_name, u.email)              as approved_by,
       c.calculated_at, c.engine_version,
       c.project_finish                            as baselined_finish,
       (select count(*) from schedule_baseline_activities ba
         where ba.baseline_id = b.id)              as activity_count,
       (b.id = app.current_schedule_baseline(b.project_id)) as is_current
  from schedule_baselines b
  left join schedule_calculations c on c.id = b.calculation_id
  left join user_profiles u on u.id = b.approved_by;

comment on view my_schedule_baselines is
  'Baselines with who approved each, what it holds and which one is current. ENTITY. Current is derived, because an append-only table cannot carry a maintained flag.';

revoke all on my_schedule_baselines from public, anon;
grant select on my_schedule_baselines to authenticated, service_role;

create or replace function public.take_schedule_baseline(
  p_project uuid, p_name text, p_reason text, p_taken_on date default current_date)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.take_schedule_baseline(p_project, p_name, p_reason, p_taken_on); $$;

revoke all on function public.take_schedule_baseline(uuid, text, text, date) from public, anon;
grant execute on function public.take_schedule_baseline(uuid, text, text, date) to authenticated;
