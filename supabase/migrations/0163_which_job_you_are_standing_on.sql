-- =============================================================================
-- 0163 — Which job you are standing on
--
-- `time_punches` has carried `latitude`, `longitude` and `accuracy_meters`
-- since 0122, under the comment "where it was punched, when the device offered
-- to say", and `punch_in` has taken all three as arguments. Projects have
-- carried coordinates since 0007. Nothing ever put the two together, so a
-- foreman standing on a job still had to find it in a list and pick it.
--
-- Two things here.
--
-- **A fence, per project.** `geofence_radius_meters` is null by default, which
-- means the job has no fence and is never suggested by distance — a yard, an
-- office, a project whose coordinates are a city centroid rather than a gate.
-- Opting in per project is the honest default: a radius invented for every job
-- would put people on the wrong one.
--
-- **A question, not an action.** `my_jobs_nearby` answers "which of my jobs am
-- I near, and am I inside its fence" and writes nothing. It deliberately does
-- not punch anybody in.
--
-- That last point is the whole design and it is worth writing down. A phone
-- crossing a fence is not a person starting work — a truck driving past a site,
-- a supervisor dropping off fuel, somebody parking across the road at lunch.
-- Payroll built on a radius produces disputes nobody can settle afterwards,
-- because the record says the fence fired and not that the work began. So the
-- fence proposes and the person accepts, which is the same rule this platform
-- already applies to its AI: RULE-008, agents draft and humans accept.
--
-- Distance is computed with the haversine formula rather than PostGIS, which
-- this schema does not install. Over the distances a geofence deals in — tens
-- to hundreds of meters — the error against a proper geodesic is centimeters.
--
-- Entity and Workflow: the job a person is standing on, and the work they were
-- assigned to do on it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A fence, where somebody has drawn one
-- -----------------------------------------------------------------------------

alter table projects
  add column if not exists geofence_radius_meters int;

do $$
begin
  alter table projects drop constraint if exists projects_geofence_radius;
  alter table projects add constraint projects_geofence_radius
    check (geofence_radius_meters is null
           or (geofence_radius_meters >= 25 and geofence_radius_meters <= 5000));
end $$;

comment on column projects.geofence_radius_meters is
  'How near counts as being on this job, in meters. Null means no fence has been drawn and the job is never suggested by distance. Floored at 25m because consumer GPS is not better than that, and capped at 5km because past that it is not a job site.';

-- -----------------------------------------------------------------------------
-- How far apart two points are
-- -----------------------------------------------------------------------------

/**
 * Meters between two coordinates, by the haversine formula.
 *
 * Immutable and arithmetic only: no PostGIS, which this schema does not
 * install, and no network. Over the distances a geofence deals in the error
 * against a proper geodesic calculation is centimeters, and a geofence that
 * cared about centimeters would be a geofence built on the wrong idea.
 */
create or replace function app.meters_between(
  p_lat_a numeric, p_lon_a numeric, p_lat_b numeric, p_lon_b numeric)
returns numeric
language sql
immutable
as $$
  select case
    when p_lat_a is null or p_lon_a is null or p_lat_b is null or p_lon_b is null
      then null
    else 2 * 6371000 * asin(sqrt(
      power(sin(radians(p_lat_b - p_lat_a) / 2), 2)
      + cos(radians(p_lat_a)) * cos(radians(p_lat_b))
        * power(sin(radians(p_lon_b - p_lon_a) / 2), 2)))
  end;
$$;

comment on function app.meters_between(numeric, numeric, numeric, numeric) is
  'Great-circle meters between two coordinates. ENGINE support: haversine, because this schema has no PostGIS and a geofence does not need one.';

-- -----------------------------------------------------------------------------
-- Which of my jobs am I near
-- -----------------------------------------------------------------------------

/**
 * The caller's company's live jobs, nearest first, with the fence applied.
 *
 * Writes nothing. It answers a question a screen asks on the worker's behalf —
 * "am I on a job" — so that clocking in can offer the right one instead of
 * making somebody find it in a list with cold hands.
 *
 * `assigned` is carried separately from `inside`, because they are different
 * facts and the screen should be able to say so. Somebody sent to cover a job
 * they are not scheduled on is standing on it all the same, and refusing to
 * offer it would be the system arguing with where the person is.
 *
 * A job with no fence is returned with `inside` false however near it is. That
 * is the opt-in: distance alone never suggests a job.
 */
create or replace function app.my_jobs_nearby(
  p_latitude numeric,
  p_longitude numeric,
  p_limit int default 5)
returns table (
  project_id uuid,
  number text,
  name text,
  distance_meters numeric,
  geofence_radius_meters int,
  inside boolean,
  assigned boolean)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select
    p.id,
    p.number,
    p.name,
    round(app.meters_between(p_latitude, p_longitude, p.latitude, p.longitude), 1),
    p.geofence_radius_meters,
    p.geofence_radius_meters is not null
      and app.meters_between(p_latitude, p_longitude, p.latitude, p.longitude)
          <= p.geofence_radius_meters,
    exists (
      select 1
      from resource_assignments ra
      join employees e on e.id = ra.employee_id
      where ra.project_id = p.id
        and e.user_id = auth.uid()
        and current_date between ra.starts_on and ra.ends_on)
  from projects p
  where p.latitude is not null
    and p.longitude is not null
    and p.status not in ('closed', 'canceled')
    and p_latitude is not null
    and p_longitude is not null
  order by app.meters_between(p_latitude, p_longitude, p.latitude, p.longitude)
  limit greatest(coalesce(p_limit, 5), 1);
$$;

comment on function app.my_jobs_nearby(numeric, numeric, int) is
  'The live jobs nearest a point, with the fence applied and whether the caller is assigned. WORKFLOW: it proposes and never punches — a phone crossing a fence is not a person starting work.';

-- -----------------------------------------------------------------------------
-- What I was asked to do
-- -----------------------------------------------------------------------------

/**
 * The caller's own assignments, today and ahead.
 *
 * A field employee signing in has one question before any other: where am I
 * meant to be and what am I meant to be doing. Row level security already lets
 * a member read their company's projects; what did not exist was the join from
 * a login to the work it was given.
 *
 * Scoped to the caller's own employee record rather than to a permission: this
 * is a person's own schedule, and needing `hr.read` to see where you are
 * working tomorrow would be the wrong rule.
 */
create or replace view my_assignments as
  select
    ra.id                as assignment_id,
    ra.project_id,
    p.number             as project_number,
    p.name               as project_name,
    p.site_address,
    p.site_city,
    p.site_state,
    p.latitude,
    p.longitude,
    p.geofence_radius_meters,
    ra.schedule_activity_id,
    sa.name              as activity_name,
    ra.starts_on,
    ra.ends_on,
    ra.allocation,
    ra.notes,
    (current_date between ra.starts_on and ra.ends_on) as today
  from resource_assignments ra
  join employees e  on e.id = ra.employee_id
  join projects  p  on p.id = ra.project_id
  left join schedule_activities sa on sa.id = ra.schedule_activity_id
  where e.user_id = auth.uid()
    and ra.resource_kind = 'employee';

comment on view my_assignments is
  'Where the signed-in person is assigned and when, with the site and its fence. ENTITY: their own schedule, scoped to their own employee record rather than to an HR permission.';

/**
 * The tasks on a job, as somebody working it needs them.
 *
 * `project_tasks` arrives from the awarded estimate — every priced line becomes
 * a budgeted activity — so this is the estimate read back to the person doing
 * the work. Budget figures are deliberately not here: what a line was priced at
 * is not a foreman's business and putting it on a phone in a trench is how it
 * ends up in a conversation with a customer.
 */
create or replace view my_project_tasks as
  select
    t.id             as task_id,
    t.project_id,
    p.number         as project_number,
    t.name,
    t.unit,
    t.budgeted_quantity,
    t.status,
    t.sort_order
  from project_tasks t
  join projects p on p.id = t.project_id
  where exists (
    select 1
    from resource_assignments ra
    join employees e on e.id = ra.employee_id
    where ra.project_id = t.project_id
      and e.user_id = auth.uid());

comment on view my_project_tasks is
  'The tasks on the jobs the signed-in person is assigned to, without the money. ENTITY: the awarded estimate read back to the person doing the work.';

-- -----------------------------------------------------------------------------
-- The doors a browser uses
-- -----------------------------------------------------------------------------

create or replace function public.my_jobs_nearby(
  p_latitude numeric, p_longitude numeric, p_limit int default 5)
returns table (
  project_id uuid, number text, name text, distance_meters numeric,
  geofence_radius_meters int, inside boolean, assigned boolean)
language sql security invoker set search_path = public, pg_catalog
as $$ select * from app.my_jobs_nearby(p_latitude, p_longitude, p_limit); $$;

/**
 * Draw or move a job's fence.
 *
 * Separate from the ordinary project update because it is the one field that
 * changes whether the platform will suggest clocking somebody in, and because
 * it needs saying that null removes the fence rather than setting it to zero.
 */
create or replace function app.set_project_geofence(
  p_project uuid, p_radius_meters int)
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  perform app.project_company_for_write(p_project, 'projects.write');
  if p_radius_meters is not null
     and (p_radius_meters < 25 or p_radius_meters > 5000) then
    raise exception 'A fence is between 25 and 5000 meters'
      using errcode = 'check_violation',
            hint = 'Below 25m is finer than consumer GPS; above 5km is not a job site.';
  end if;
  update projects
     set geofence_radius_meters = p_radius_meters, updated_at = now()
   where id = p_project;
end;
$$;

comment on function app.set_project_geofence(uuid, int) is
  'Draws, moves or removes a job fence. WORKFLOW: null removes it, and a job with no fence is never suggested by distance.';

create or replace function public.set_project_geofence(p_project uuid, p_radius_meters int)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_project_geofence(p_project, p_radius_meters); $$;

grant select on my_assignments to authenticated;
grant select on my_project_tasks to authenticated;
revoke all on my_assignments from anon;
revoke all on my_project_tasks from anon;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'app.meters_between(numeric, numeric, numeric, numeric)',
    'app.my_jobs_nearby(numeric, numeric, int)',
    'app.set_project_geofence(uuid, int)',
    'public.my_jobs_nearby(numeric, numeric, int)',
    'public.set_project_geofence(uuid, int)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

select app.assert_security_gates();
