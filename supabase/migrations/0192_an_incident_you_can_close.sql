-- =============================================================================
-- 0192 — An incident you can close, a near miss you can record, a test that
--        counts
--
-- Safety records are legal records, and this section had the worst version of
-- the defect in the repository.
--
--   * **An incident could be opened and never closed.** `create_safety_incident`
--     (0162) writes a row with `investigation_state = 'open'`, and nothing
--     anywhere could move it to investigating, corrective action or closed;
--     `closed_at` could never be set. `notify_recordable_incident` (0035) works,
--     so a company was told about a recordable it could then never resolve. The
--     OSHA 300 log is built from these rows, and every one of them said the
--     investigation was still open — forever.
--
--   * **`safety_observations` had no writer.** The schema is careful: an unsafe
--     observation must be either corrected on site or carry a corrective action,
--     so a hazard cannot be noted and abandoned. Nothing could write one, so the
--     near misses and good catches — the leading indicators, the ones that stop
--     the recordable happening — could not be captured at all.
--
--   * **`inspections` had no writer.** Compaction, concrete breaks, pipe tests,
--     proof rolls, asphalt density. The table carries `retest_of_id` under the
--     comment "a failed test without a retest reference leaves the work
--     unaccepted", and a constraint that a failed test must say why. All of it,
--     and no way to record a single test.
--
-- What is deliberately kept: every refusal the schema already makes. A
-- recordable needs a case number, a failed test needs a note, an unsafe
-- observation needs either a fix on the spot or an action. Those are not
-- obstacles to work around — they are the reason the record is worth anything.
--
-- WORKFLOW.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The investigation
-- -----------------------------------------------------------------------------

/**
 * Move an incident's investigation along.
 *
 * The state machine the schema already describes, given the transitions it
 * never had. Closing is separate, below, because closing without a root cause
 * and a corrective action is how an incident gets filed rather than fixed — and
 * the next one has the same cause.
 */
create or replace function app.update_safety_incident(
  p_incident uuid,
  p_investigation_state text default null,
  p_severity text default null,
  p_root_cause text default null,
  p_corrective_action text default null,
  p_immediate_action text default null,
  p_is_osha_recordable boolean default null,
  p_osha_case_number text default null,
  p_days_away int default null,
  p_days_restricted int default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_i safety_incidents%rowtype;
begin
  select * into v_i from safety_incidents where id = p_incident;
  if v_i.id is null then
    raise exception 'No such incident' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_i.company_id, 'safety.write') then
    raise exception 'You do not have permission to change safety records'
      using errcode = 'insufficient_privilege';
  end if;
  if v_i.investigation_state = 'closed' then
    raise exception 'That investigation is closed'
      using errcode = 'check_violation',
            hint = 'A closed investigation is the record of what was decided. Raise a new one if something has changed.';
  end if;
  if p_investigation_state is not null
     and p_investigation_state not in ('open', 'investigating', 'corrective_action') then
    raise exception 'Closing an investigation is its own action, because it needs a cause and an action'
      using errcode = 'check_violation';
  end if;
  if p_severity is not null and p_severity not in ('low','moderate','high','critical') then
    raise exception 'Unknown severity %', p_severity using errcode = 'check_violation';
  end if;
  /*
   * Named here rather than left to the constraint, which reports a constraint.
   * A recordable with no case number cannot go on the 300 log, and the log is
   * the reason recordability is tracked at all.
   */
  if coalesce(p_is_osha_recordable, v_i.is_osha_recordable)
     and coalesce(nullif(btrim(coalesce(p_osha_case_number, '')), ''), v_i.osha_case_number) is null then
    raise exception 'A recordable incident needs its OSHA case number'
      using errcode = 'check_violation',
            hint = 'It is what ties this record to the 300 log.';
  end if;

  update safety_incidents
     set investigation_state = coalesce(p_investigation_state, investigation_state),
         severity = coalesce(p_severity, severity),
         root_cause = coalesce(nullif(btrim(coalesce(p_root_cause,'')),''), root_cause),
         corrective_action = coalesce(nullif(btrim(coalesce(p_corrective_action,'')),''), corrective_action),
         immediate_action = coalesce(nullif(btrim(coalesce(p_immediate_action,'')),''), immediate_action),
         is_osha_recordable = coalesce(p_is_osha_recordable, is_osha_recordable),
         osha_case_number = coalesce(nullif(btrim(coalesce(p_osha_case_number,'')),''), osha_case_number),
         days_away = coalesce(p_days_away, days_away),
         days_restricted = coalesce(p_days_restricted, days_restricted),
         updated_at = now()
   where id = p_incident;
end;
$$;

comment on function app.update_safety_incident(uuid, text, text, text, text, text, boolean, text, int, int) is
  'Moves an incident investigation along. create_safety_incident (0162) was the whole write side, so every incident this platform recorded stayed open forever — including the recordables notify_recordable_incident told the company about. WORKFLOW.';

/**
 * Close an investigation.
 *
 * A root cause and a corrective action are both required. An incident closed
 * without them is an incident filed rather than fixed, and the next one has the
 * same cause — which is the entire argument for investigating at all.
 *
 * Deliberately not a status somebody can set in a dropdown.
 */
create or replace function app.close_safety_incident(
  p_incident uuid,
  p_root_cause text,
  p_corrective_action text,
  p_closed_at timestamptz default now())
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_i safety_incidents%rowtype;
begin
  select * into v_i from safety_incidents where id = p_incident;
  if v_i.id is null then
    raise exception 'No such incident' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_i.company_id, 'safety.write') then
    raise exception 'You do not have permission to close safety records'
      using errcode = 'insufficient_privilege';
  end if;
  if v_i.investigation_state = 'closed' then
    raise exception 'That investigation is already closed' using errcode = 'check_violation';
  end if;
  if length(btrim(coalesce(p_root_cause, ''))) < 10 then
    raise exception 'Say what actually caused it'
      using errcode = 'check_violation',
            hint = 'Not "operator error". What about the work let it happen.';
  end if;
  if length(btrim(coalesce(p_corrective_action, ''))) < 10 then
    raise exception 'Say what was changed so it does not happen again'
      using errcode = 'check_violation',
            hint = 'An incident closed with no corrective action is one filed rather than fixed.';
  end if;
  if v_i.is_osha_recordable and v_i.osha_case_number is null then
    raise exception 'A recordable incident needs its OSHA case number before it closes'
      using errcode = 'check_violation';
  end if;

  update safety_incidents
     set investigation_state = 'closed',
         closed_at = coalesce(p_closed_at, now()),
         root_cause = btrim(p_root_cause),
         corrective_action = btrim(p_corrective_action),
         updated_at = now()
   where id = p_incident;
end;
$$;

comment on function app.close_safety_incident(uuid, text, text, timestamptz) is
  'Closes an investigation, requiring a root cause and a corrective action. Its own door rather than a status somebody sets, because an incident closed without them is one filed rather than fixed — and the next one has the same cause. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- The near miss
-- -----------------------------------------------------------------------------

/**
 * Record what somebody saw.
 *
 * A near miss, a good catch, a hazard corrected on the spot. These are the
 * leading indicators: the observations a company records are the incidents it
 * does not have, and `safety_observations` could not hold one.
 *
 * The schema insists an unsafe observation is either fixed on the spot or
 * carries an action — a hazard noted and left is a record of somebody walking
 * past it. That refusal is kept and stated in words a person can act on.
 */
create or replace function app.record_safety_observation(
  p_company uuid,
  p_category text,
  p_description text,
  p_is_positive boolean default false,
  p_corrected_on_site boolean default false,
  p_corrective_action text default null,
  p_project uuid default null,
  p_observer uuid default null,
  p_observed_at timestamptz default now())
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'safety.write');
  v_id uuid;
begin
  if p_category not in ('ppe','excavation','fall_protection','traffic','equipment',
                        'housekeeping','utilities','environmental','other') then
    raise exception 'Unknown category %', p_category using errcode = 'check_violation';
  end if;
  if length(btrim(coalesce(p_description, ''))) < 5 then
    raise exception 'Say what was seen' using errcode = 'check_violation';
  end if;
  if not coalesce(p_is_positive, false)
     and not coalesce(p_corrected_on_site, false)
     and btrim(coalesce(p_corrective_action, '')) = '' then
    raise exception 'An unsafe observation needs a fix on the spot or an action'
      using errcode = 'check_violation',
            hint = 'A hazard written down and left is a record of somebody walking past it.';
  end if;

  insert into safety_observations (
    company_id, project_id, observed_at, observer_id, category,
    is_positive, description, corrected_on_site, corrective_action)
  values (
    v_company, p_project, coalesce(p_observed_at, now()), p_observer, p_category,
    coalesce(p_is_positive, false), btrim(p_description),
    coalesce(p_corrected_on_site, false),
    nullif(btrim(coalesce(p_corrective_action,'')),''))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.record_safety_observation(uuid, text, text, boolean, boolean, text, uuid, uuid, timestamptz) is
  'Records a near miss, a good catch or a hazard corrected on the spot. The first writer of safety_observations: the leading indicators — the observations a company records are the incidents it does not have — could not be captured at all. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- The test
-- -----------------------------------------------------------------------------

/**
 * The next inspection number for a company.
 *
 * `inspections` is unique on (company_id, number), so a screen must not pick
 * one — the same reasoning as every other numbered record here.
 */
create or replace function app.next_inspection_number(p_company uuid)
returns text
language sql stable security definer set search_path = public, pg_catalog
as $$
  select 'INS-' || to_char(now(), 'YYYY') || '-'
         || lpad((coalesce(max(substring(i.number from '(\d+)$')::int), 0) + 1)::text, 4, '0')
  from inspections i
  where i.company_id = p_company;
$$;

comment on function app.next_inspection_number(uuid) is
  'The next INS-YYYY-nnnn for a company. ENTITY.';

/**
 * Record a test.
 *
 * Compaction, a concrete break, a pipe test, a proof roll. `result_values`
 * carries what the test actually measured — a dry density and a percentage, a
 * break strength at seven days — because a pass with no numbers behind it is a
 * word, and the numbers are what an owner's engineer asks for.
 *
 * A failing test must say why: that is the schema's rule and it is right. The
 * work stays unaccepted until a retest names this one.
 */
create or replace function app.record_inspection(
  p_project uuid,
  p_inspection_type text,
  p_title text,
  p_result text default 'pending',
  p_result_values jsonb default '{}'::jsonb,
  p_spec_reference text default null,
  p_location text default null,
  p_station text default null,
  p_inspector_name text default null,
  p_inspecting_agency text default null,
  p_task uuid default null,
  p_notes text default null,
  p_inspected_at timestamptz default now(),
  p_retest_of uuid default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid; v_id uuid;
begin
  select company_id into v_company from projects where id = p_project;
  if v_company is null then
    raise exception 'No such project' using errcode = 'no_data_found';
  end if;
  /* `inspections` is governed by quality.write (0022), not safety.write. */
  if not app.has_permission(v_company, 'quality.write') then
    raise exception 'You do not have permission to record inspections'
      using errcode = 'insufficient_privilege';
  end if;
  if p_inspection_type not in ('compaction','concrete','asphalt','pipe_test',
                               'proof_roll','survey','material','punch_list','other') then
    raise exception 'Unknown kind of inspection %', p_inspection_type
      using errcode = 'check_violation';
  end if;
  if p_result not in ('pending','pass','fail','conditional') then
    raise exception 'A result is pending, pass, fail or conditional'
      using errcode = 'check_violation';
  end if;
  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'An inspection needs a title' using errcode = 'check_violation';
  end if;
  if p_result = 'fail' and btrim(coalesce(p_notes, '')) = '' then
    raise exception 'A failing test has to say why'
      using errcode = 'check_violation',
            hint = 'The work stays unaccepted until a retest names this one, and the next person needs to know what to fix.';
  end if;
  if p_retest_of is not null and not exists (
       select 1 from inspections i where i.id = p_retest_of and i.company_id = v_company) then
    raise exception 'No such earlier inspection to retest' using errcode = 'no_data_found';
  end if;

  insert into inspections (
    company_id, project_id, project_task_id, number, inspection_type, title,
    spec_reference, location, station, inspected_at, inspector_name,
    inspecting_agency, result_values, result, retest_of_id, notes)
  values (
    v_company, p_project, p_task, app.next_inspection_number(v_company),
    p_inspection_type, btrim(p_title),
    nullif(btrim(coalesce(p_spec_reference,'')),''),
    nullif(btrim(coalesce(p_location,'')),''),
    nullif(btrim(coalesce(p_station,'')),''),
    coalesce(p_inspected_at, now()),
    nullif(btrim(coalesce(p_inspector_name,'')),''),
    nullif(btrim(coalesce(p_inspecting_agency,'')),''),
    coalesce(p_result_values, '{}'::jsonb), p_result, p_retest_of,
    nullif(btrim(coalesce(p_notes,'')),''))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.record_inspection(uuid, text, text, text, jsonb, text, text, text, text, text, uuid, text, timestamptz, uuid) is
  'Records a test with what it measured. The first writer of inspections: compaction, concrete breaks, pipe tests and proof rolls could not be recorded at all, while the table carried retest_of_id and a rule that a failed test must say why. WORKFLOW.';

/** Record the result of a test that was pending. */
create or replace function app.set_inspection_result(
  p_inspection uuid, p_result text, p_result_values jsonb default null,
  p_notes text default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_i inspections%rowtype;
begin
  select * into v_i from inspections where id = p_inspection;
  if v_i.id is null then
    raise exception 'No such inspection' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_i.company_id, 'quality.write') then
    raise exception 'You do not have permission to record inspections'
      using errcode = 'insufficient_privilege';
  end if;
  if p_result not in ('pending','pass','fail','conditional') then
    raise exception 'A result is pending, pass, fail or conditional'
      using errcode = 'check_violation';
  end if;
  if p_result = 'fail'
     and coalesce(nullif(btrim(coalesce(p_notes,'')),''), v_i.notes) is null then
    raise exception 'A failing test has to say why' using errcode = 'check_violation';
  end if;

  update inspections
     set result = p_result,
         result_values = coalesce(p_result_values, result_values),
         notes = coalesce(nullif(btrim(coalesce(p_notes,'')),''), notes),
         updated_at = now()
   where id = p_inspection;
end;
$$;

comment on function app.set_inspection_result(uuid, text, jsonb, text) is
  'Records the result of a test that was pending, keeping the rule that a failure says why. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- What safety looks like when it can be recorded
-- -----------------------------------------------------------------------------

/**
 * Incidents with where the investigation stands and how long it has stood there.
 *
 * `days_open` is the number that matters. An investigation open for ninety days
 * is not an investigation, and until now every one of them was.
 */
create or replace view my_safety_incidents
with (security_invoker = true) as
select i.id, i.company_id, i.project_id, i.number, i.occurred_at, i.reported_at,
       i.incident_type, i.severity, i.description, i.location,
       i.is_osha_recordable, i.osha_case_number, i.days_away, i.days_restricted,
       i.root_cause, i.corrective_action, i.investigation_state, i.closed_at,
       p.number                                            as project_number,
       e.full_name                                         as employee_name,
       case when i.closed_at is null
            then (current_date - i.occurred_at::date) end  as days_open,
       (i.investigation_state <> 'closed')                 as is_open
  from safety_incidents i
  left join projects p on p.id = i.project_id
  left join employees e on e.id = i.employee_id;

comment on view my_safety_incidents is
  'Incidents with where the investigation stands and how long it has been open. ENTITY. Every incident was permanently open before 0192, so days_open had no meaning.';

revoke all on my_safety_incidents from public, anon;
grant select on my_safety_incidents to authenticated, service_role;

/** What was seen, positive and otherwise. */
create or replace view my_safety_observations
with (security_invoker = true) as
select o.id, o.company_id, o.project_id, o.observed_at, o.category,
       o.is_positive, o.description, o.corrected_on_site, o.corrective_action,
       p.number                                            as project_number,
       e.full_name                                         as observer_name
  from safety_observations o
  left join projects p on p.id = o.project_id
  left join employees e on e.id = o.observer_id;

comment on view my_safety_observations is
  'Near misses, good catches and hazards corrected on the spot. ENTITY. The leading indicator: what a company records here is what it does not have to record as an incident.';

revoke all on my_safety_observations from public, anon;
grant select on my_safety_observations to authenticated, service_role;

/**
 * Tests, with whether a failure was ever retested.
 *
 * `retested_by` is the point. A failed test with nothing naming it leaves the
 * work unaccepted, and that is a fact somebody should be able to see on a list
 * rather than discover at closeout.
 */
create or replace view my_inspections
with (security_invoker = true) as
select i.id, i.company_id, i.project_id, i.number, i.inspection_type, i.title,
       i.spec_reference, i.location, i.station, i.inspected_at,
       i.inspector_name, i.inspecting_agency, i.result_values, i.result,
       i.retest_of_id, i.notes,
       p.number                                            as project_number,
       (select r.number from inspections r where r.retest_of_id = i.id
         order by r.inspected_at limit 1)                  as retested_by,
       (i.result = 'fail' and not exists (
          select 1 from inspections r where r.retest_of_id = i.id))
                                                           as failed_and_not_retested
  from inspections i
  left join projects p on p.id = i.project_id;

comment on view my_inspections is
  'Tests with what they measured, and whether a failure was ever retested. ENTITY. A failed test nothing has retested leaves the work unaccepted — visible on the list rather than discovered at closeout.';

revoke all on my_inspections from public, anon;
grant select on my_inspections to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The doors
-- -----------------------------------------------------------------------------

create or replace function public.update_safety_incident(
  p_incident uuid, p_investigation_state text default null, p_severity text default null,
  p_root_cause text default null, p_corrective_action text default null,
  p_immediate_action text default null, p_is_osha_recordable boolean default null,
  p_osha_case_number text default null, p_days_away int default null,
  p_days_restricted int default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.update_safety_incident(p_incident, p_investigation_state, p_severity,
       p_root_cause, p_corrective_action, p_immediate_action, p_is_osha_recordable,
       p_osha_case_number, p_days_away, p_days_restricted); $$;

create or replace function public.close_safety_incident(
  p_incident uuid, p_root_cause text, p_corrective_action text,
  p_closed_at timestamptz default now())
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.close_safety_incident(p_incident, p_root_cause, p_corrective_action,
       p_closed_at); $$;

create or replace function public.record_safety_observation(
  p_company uuid, p_category text, p_description text, p_is_positive boolean default false,
  p_corrected_on_site boolean default false, p_corrective_action text default null,
  p_project uuid default null, p_observer uuid default null,
  p_observed_at timestamptz default now())
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.record_safety_observation(p_company, p_category, p_description,
       p_is_positive, p_corrected_on_site, p_corrective_action, p_project, p_observer,
       p_observed_at); $$;

create or replace function public.record_inspection(
  p_project uuid, p_inspection_type text, p_title text, p_result text default 'pending',
  p_result_values jsonb default '{}'::jsonb, p_spec_reference text default null,
  p_location text default null, p_station text default null,
  p_inspector_name text default null, p_inspecting_agency text default null,
  p_task uuid default null, p_notes text default null,
  p_inspected_at timestamptz default now(), p_retest_of uuid default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.record_inspection(p_project, p_inspection_type, p_title, p_result,
       p_result_values, p_spec_reference, p_location, p_station, p_inspector_name,
       p_inspecting_agency, p_task, p_notes, p_inspected_at, p_retest_of); $$;

create or replace function public.set_inspection_result(
  p_inspection uuid, p_result text, p_result_values jsonb default null,
  p_notes text default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_inspection_result(p_inspection, p_result, p_result_values, p_notes); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.update_safety_incident(uuid, text, text, text, text, text, boolean, text, int, int)',
    'public.close_safety_incident(uuid, text, text, timestamptz)',
    'public.record_safety_observation(uuid, text, text, boolean, boolean, text, uuid, uuid, timestamptz)',
    'public.record_inspection(uuid, text, text, text, jsonb, text, text, text, text, text, uuid, text, timestamptz, uuid)',
    'public.set_inspection_result(uuid, text, jsonb, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
