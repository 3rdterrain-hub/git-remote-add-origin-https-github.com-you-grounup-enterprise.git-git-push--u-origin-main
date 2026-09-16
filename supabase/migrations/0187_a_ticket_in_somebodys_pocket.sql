-- =============================================================================
-- 0187 — A ticket in somebody's pocket
--
-- Workforce holds this repository's most serious instance of its own defect,
-- because this one is a safety control.
--
-- Migration 0043 built `app.enforce_assignment_credentials`: a trigger that
-- refuses to put somebody on declared work when a mandatory credential is
-- missing, expired, revoked or not yet issued. Its own comment calls it "the
-- platform's first blocking safety control". Behind it sit
-- `app.credential_gaps`, `app.credential_standing`,
-- `app.refresh_credential_status`, `app.notify_credential_expiry`,
-- `app.notify_credential_lapse` and `reporting_credential_expiry`.
--
-- It reads `work_credential_requirements`, which had no writer. So no company
-- could ever say "a truck driver needs a CDL", the requirement set was empty on
-- every company, `credential_gaps` returned nothing, and **the trigger has
-- never once fired**. Underneath that, `credentials` had no writer either:
-- nobody could record that a person holds anything, so the expiry report was
-- empty and both notifications have never been sent.
--
-- The rest of the section is the same shape one layer down:
--
--   * `create_employee` (0161) was the whole write side. A person could be
--     hired and never corrected, never put on leave, and never terminated —
--     and `employees_terminated_date` requires a date that nothing could set.
--   * **`crews` and `crew_members` have no function at all.** Not one. The 42
--     seeded crews exist and a company cannot make its own or change one, while
--     a crew is what the estimator prices labor with and what
--     `schedule_activities.crew_id` and `resource_assignments.crew_id` point
--     at. "Categories are user-addable" is a standing rule here and this
--     library was never addable.
--
-- WORKFLOW.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- What somebody holds
-- -----------------------------------------------------------------------------

/**
 * Record a credential.
 *
 * `status` is computed by `refresh_credential_status` (0015) from the expiry
 * date, so it is not an argument: valid, expiring within thirty days, or
 * expired. A caller may only assert `pending`, which means applied for and not
 * yet issued — the one state a date cannot tell you.
 *
 * `required_for` names the work this credential is a prerequisite for, in the
 * same vocabulary `work_credential_requirements.work_type` uses, because the
 * two are matched against each other and two vocabularies for one idea is how
 * a safety control silently stops matching.
 */
create or replace function app.record_credential(
  p_employee     uuid,
  p_name         text,
  p_type         text default 'certification',
  p_issuing_body text default null,
  p_identifier   text default null,
  p_issued_on    date default null,
  p_expires_on   date default null,
  p_required_for text[] default '{}',
  p_pending      boolean default false)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_id      uuid;
begin
  select company_id into v_company from employees where id = p_employee;
  if v_company is null then
    raise exception 'No such employee' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'hr.write') then
    raise exception 'You do not have permission to record credentials'
      using errcode = 'insufficient_privilege';
  end if;
  if v_name is null then
    raise exception 'A credential needs a name'
      using errcode = 'check_violation',
            hint = 'What the certificate actually says: CDL Class A, OSHA 30, MSHA Part 46.';
  end if;
  if p_type not in ('license','certification','training','medical','clearance') then
    raise exception 'Unknown kind of credential %', p_type using errcode = 'check_violation';
  end if;
  if p_expires_on is not null and p_issued_on is not null and p_expires_on <= p_issued_on then
    raise exception 'A credential cannot expire before it was issued'
      using errcode = 'check_violation';
  end if;

  /*
   * `lifecycle`, not a stored standing. Migration 0043 dropped
   * `credentials.status` because a state derived from a date and then written
   * down goes stale the day the date passes and nothing rewrites the row — a
   * CDL that lapsed last month kept saying 'valid', and the safety gate failed
   * open on exactly the case it exists to catch. Whether a held credential has
   * lapsed is `app.credential_standing()`, asked fresh every time.
   */
  insert into credentials (
    company_id, employee_id, credential_type, name, issuing_body, identifier,
    issued_on, expires_on, required_for, lifecycle)
  values (
    v_company, p_employee, p_type, v_name,
    nullif(btrim(coalesce(p_issuing_body,'')),''),
    nullif(btrim(coalesce(p_identifier,'')),''),
    p_issued_on, p_expires_on,
    coalesce(p_required_for, '{}'),
    case when p_pending then 'pending' else 'active' end)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.record_credential(uuid, text, text, text, text, date, date, text[], boolean) is
  'Records that somebody holds a ticket. The first writer of credentials, on which the platform''s only blocking safety control, two notifications and the expiry report all depend — so before this, none of them could ever have run. Writes lifecycle, never a standing: 0043 removed the stored one because it failed open. WORKFLOW.';

/**
 * Renew or correct a credential.
 *
 * A renewal is an update rather than a second row on purpose: the gap analysis
 * picks the best-standing credential of a given name, so two rows would work,
 * and would leave an expired one sitting in the record looking like a lapse
 * that was never fixed.
 */
create or replace function app.update_credential(
  p_credential   uuid,
  p_name         text default null,
  p_issuing_body text default null,
  p_identifier   text default null,
  p_issued_on    date default null,
  p_expires_on   date default null,
  p_required_for text[] default null,
  p_issued       boolean default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_c credentials%rowtype;
begin
  select * into v_c from credentials where id = p_credential;
  if v_c.id is null then
    raise exception 'No such credential' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_c.company_id, 'hr.write') then
    raise exception 'You do not have permission to change credentials'
      using errcode = 'insufficient_privilege';
  end if;
  if v_c.lifecycle = 'revoked' then
    raise exception 'That credential was revoked'
      using errcode = 'check_violation',
            hint = 'Record the new one rather than editing the revoked record.';
  end if;

  update credentials
     set name         = coalesce(nullif(btrim(coalesce(p_name,'')),''), name),
         issuing_body = coalesce(nullif(btrim(coalesce(p_issuing_body,'')),''), issuing_body),
         identifier   = coalesce(nullif(btrim(coalesce(p_identifier,'')),''), identifier),
         issued_on    = coalesce(p_issued_on, issued_on),
         expires_on   = coalesce(p_expires_on, expires_on),
         required_for = coalesce(p_required_for, required_for),
         /*
          * Only the administrative state is settable by hand. Whether a held
          * credential has lapsed is the expiry date's to say, every time it is
          * asked — never written down here (0043).
          */
         lifecycle    = case when p_issued is true then 'active'
                             when p_issued is false then 'pending'
                             else lifecycle end,
         updated_at   = now()
   where id = p_credential;
end;
$$;

comment on function app.update_credential(uuid, text, text, text, date, date, text[], boolean) is
  'Renews or corrects a credential. A renewal edits the row rather than adding a second one, so an expired record does not sit in the file looking like a lapse nobody fixed. WORKFLOW.';

/**
 * Revoke a credential.
 *
 * Distinct from expiry and from deletion. An expired ticket lapsed; a revoked
 * one was taken away, and that is a different fact about the person which the
 * record must keep. Revoked is the one status the expiry trigger will not
 * overwrite — 0015 wrote it that way — so it stands until somebody records a
 * new credential.
 */
create or replace function app.revoke_credential(p_credential uuid, p_reason text)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  select company_id into v_company from credentials where id = p_credential;
  if v_company is null then
    raise exception 'No such credential' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'hr.write') then
    raise exception 'You do not have permission to change credentials'
      using errcode = 'insufficient_privilege';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say why it was revoked'
      using errcode = 'check_violation',
            hint = 'Revoking a ticket can stop somebody working. The reason belongs beside it.';
  end if;

  update credentials
     set lifecycle = 'revoked',
         updated_at = now()
   where id = p_credential;

  /* The reason lives where it can be read beside the person, not in a log. */
  update credentials set name = name || ' — revoked: ' || btrim(p_reason)
   where id = p_credential and name not like '% — revoked: %';
end;
$$;

comment on function app.revoke_credential(uuid, text) is
  'Takes a ticket away, with the reason. Revoked is an administrative fact and is stored; whether a held credential has lapsed is derived from its date (0043), because lapsed and taken away are different things about a person. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- What the work requires
-- -----------------------------------------------------------------------------

/**
 * Say what a kind of work requires.
 *
 * This is the function that makes the blocking control live. Until a company
 * has one of these rows, `enforce_assignment_credentials` has nothing to check
 * against and lets every assignment through — which is the correct behavior for
 * a company that has not configured anything, and was the *only* behavior
 * available to any company at all.
 *
 * Mandatory blocks; recommended warns. Both are useful and they are not the
 * same rule: a control that blocks on everything is a control somebody turns
 * off.
 */
create or replace function app.set_work_credential_requirement(
  p_company     uuid,
  p_work_type   text,
  p_credential  text,
  p_mandatory   boolean default true,
  p_type        text default null,
  p_notes       text default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'hr.write');
  v_work    text := lower(btrim(coalesce(p_work_type, '')));
  v_cred    text := btrim(coalesce(p_credential, ''));
  v_id      uuid;
begin
  if v_work !~ '^[a-z][a-z0-9_]{1,60}$' then
    raise exception 'A kind of work is named in lower case with underscores, like truck_driving'
      using errcode = 'check_violation';
  end if;
  if v_cred = '' then
    raise exception 'Name the credential the work requires' using errcode = 'check_violation';
  end if;
  if p_type is not null and p_type not in
     ('license','certification','training','medical','clearance') then
    raise exception 'Unknown kind of credential %', p_type using errcode = 'check_violation';
  end if;

  insert into work_credential_requirements (
    company_id, work_type, credential_name, credential_type, is_mandatory, notes)
  values (v_company, v_work, v_cred, p_type, coalesce(p_mandatory, true),
          nullif(btrim(coalesce(p_notes,'')),''))
  on conflict (company_id, work_type, credential_name) do update
     set is_mandatory = excluded.is_mandatory,
         credential_type = coalesce(excluded.credential_type,
                                    work_credential_requirements.credential_type),
         notes = coalesce(excluded.notes, work_credential_requirements.notes),
         updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.set_work_credential_requirement(uuid, text, text, boolean, text, text) is
  'Says what a kind of work requires. The first writer of work_credential_requirements, which app.enforce_assignment_credentials has read since 0043 — so the platform''s only blocking safety control had never had a rule to enforce. WORKFLOW.';

/** Stop requiring a credential for a kind of work. */
create or replace function app.remove_work_credential_requirement(p_requirement uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  select company_id into v_company from work_credential_requirements where id = p_requirement;
  if v_company is null then
    raise exception 'No such requirement' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'hr.write') then
    raise exception 'You do not have permission to change work requirements'
      using errcode = 'insufficient_privilege';
  end if;
  delete from work_credential_requirements where id = p_requirement;
end;
$$;

comment on function app.remove_work_credential_requirement(uuid) is
  'Stops requiring a credential for a kind of work. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- The person
-- -----------------------------------------------------------------------------

/**
 * Correct a person's record, or change where they stand.
 *
 * Termination is refused here and has its own door below, because the schema
 * requires a date with it and a status changed without one would be rejected by
 * a constraint naming a constraint rather than saying what is missing.
 */
create or replace function app.update_employee(
  p_employee       uuid,
  p_first_name     text default null,
  p_last_name      text default null,
  p_email          text default null,
  p_phone          text default null,
  p_classification text default null,
  p_employment_type text default null,
  p_is_union       boolean default null,
  p_union_local    text default null,
  p_hire_date      date default null,
  p_hourly_rate    numeric default null,
  p_burden_percent numeric default null,
  p_labor_rate     uuid default null,
  p_emergency_contact text default null,
  p_emergency_phone text default null,
  p_status         text default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  select company_id into v_company from employees where id = p_employee;
  if v_company is null then
    raise exception 'No such employee' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'hr.write') then
    raise exception 'You do not have permission to change people'
      using errcode = 'insufficient_privilege';
  end if;
  if p_status is not null and p_status not in
     ('applicant','onboarding','active','on_leave') then
    raise exception 'Ending somebody''s employment is its own action, because it needs a date'
      using errcode = 'check_violation';
  end if;
  if p_employment_type is not null and p_employment_type not in
     ('full_time','part_time','seasonal','temporary','subcontract') then
    raise exception 'Unknown employment type %', p_employment_type
      using errcode = 'check_violation';
  end if;
  if p_labor_rate is not null and not exists (
       select 1 from labor_rates r where r.id = p_labor_rate) then
    raise exception 'That labor rate does not exist' using errcode = 'no_data_found';
  end if;

  update employees
     set first_name = coalesce(nullif(btrim(coalesce(p_first_name,'')),''), first_name),
         last_name  = coalesce(nullif(btrim(coalesce(p_last_name,'')),''), last_name),
         email      = coalesce(nullif(btrim(coalesce(p_email,'')),''), email),
         phone      = coalesce(nullif(btrim(coalesce(p_phone,'')),''), phone),
         classification = coalesce(nullif(btrim(coalesce(p_classification,'')),''), classification),
         employment_type = coalesce(p_employment_type, employment_type),
         is_union   = coalesce(p_is_union, is_union),
         union_local = coalesce(nullif(btrim(coalesce(p_union_local,'')),''), union_local),
         hire_date  = coalesce(p_hire_date, hire_date),
         hourly_rate = coalesce(p_hourly_rate, hourly_rate),
         burden_percent = coalesce(p_burden_percent, burden_percent),
         labor_rate_id = coalesce(p_labor_rate, labor_rate_id),
         emergency_contact = coalesce(nullif(btrim(coalesce(p_emergency_contact,'')),''), emergency_contact),
         emergency_phone = coalesce(nullif(btrim(coalesce(p_emergency_phone,'')),''), emergency_phone),
         status     = coalesce(p_status, status),
         updated_at = now()
   where id = p_employee;
end;
$$;

comment on function app.update_employee(uuid, text, text, text, text, text, text, boolean, text, date, numeric, numeric, uuid, text, text, text) is
  'Corrects a person''s record or puts them on leave. create_employee (0161) was the whole write side, so nobody could be corrected, put on leave or ended. WORKFLOW.';

/**
 * End somebody's employment.
 *
 * The date is required because the schema requires it, and the schema requires
 * it because payroll and an access review cannot tell an active worker from a
 * stale record without one.
 *
 * Open assignments are ended at the same date rather than left behind: a person
 * who has left is not on next week's crew, and a schedule that still shows them
 * is a schedule somebody staffs from.
 */
create or replace function app.end_employment(
  p_employee uuid,
  p_on       date default current_date,
  p_reason   text default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid; v_hired date; v_on date := coalesce(p_on, current_date);
begin
  select company_id, hire_date into v_company, v_hired from employees where id = p_employee;
  if v_company is null then
    raise exception 'No such employee' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'hr.write') then
    raise exception 'You do not have permission to change people'
      using errcode = 'insufficient_privilege';
  end if;
  if v_hired is not null and v_on < v_hired then
    raise exception 'That is before they were hired' using errcode = 'check_violation';
  end if;

  update employees
     set status = 'terminated',
         termination_date = v_on,
         updated_at = now()
   where id = p_employee;

  /* Still booked on work they will not be there for. */
  update resource_assignments
     set ends_on = least(ends_on, v_on), updated_at = now()
   where employee_id = p_employee and ends_on > v_on;

  if btrim(coalesce(p_reason,'')) <> '' then
    update employees set classification = classification where id = p_employee;
  end if;
end;
$$;

comment on function app.end_employment(uuid, date, text) is
  'Ends somebody''s employment on a date, and ends the assignments that run past it so nobody staffs a crew from a person who has left. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- The crew
--
-- Not one function in this repository touches `crews` or `crew_members`. The
-- catalog ships forty-two crews and a company could neither make its own nor
-- change one — while a crew is what the estimator prices labor with, what
-- `schedule_activities.crew_id` points at, and what `resource_assignments`
-- books onto an activity. "Categories are user-addable" is a standing rule
-- here; this library was the one that never was.
-- -----------------------------------------------------------------------------

/**
 * The next crew code for a company.
 *
 * `crews_company_code_idx` is unique on (company_id, code), so a screen must
 * not pick one — the same shape and the same reasoning as
 * `app.next_company_material_code` in 0127.
 */
create or replace function app.next_company_crew_code(p_company uuid)
returns text
language sql stable security definer set search_path = public, pg_catalog
as $$
  select 'CRW-' || lpad((coalesce(max(substring(c.code from '^CRW-(\d+)$')::int), 0) + 1)::text, 4, '0')
  from crews c
  where c.company_id = p_company and c.code ~ '^CRW-\d+$';
$$;

comment on function app.next_company_crew_code(uuid) is
  'The next CRW-nnnn for a company. Codes are unique per company, so the database issues them rather than a screen guessing. LIBRARY.';

/**
 * Add a crew.
 *
 * The person adding it is the person approving it — migration 0028 refuses a
 * live company library row that does not name who made it live, and refuses
 * half an approval. Building a crew in your own library *is* approving it for
 * use on an estimate, and the record has to say who did that and when.
 *
 * A crew with no members is allowed and is the normal first state: a crew is
 * named, then built up. It prices at nothing until it has members, which is
 * honest — and `my_crews` below says so rather than showing a zero that reads
 * as free labor.
 */
create or replace function app.create_crew(
  p_company     uuid,
  p_name        text,
  p_discipline  text default null,
  p_shift_hours numeric default 8)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'libraries.write');
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_id      uuid;
begin
  if v_name is null then
    raise exception 'A crew needs a name' using errcode = 'check_violation';
  end if;
  if coalesce(p_shift_hours, 8) <= 0 or coalesce(p_shift_hours, 8) > 24 then
    raise exception 'A shift is between zero and twenty-four hours'
      using errcode = 'check_violation';
  end if;

  insert into crews (
    company_id, code, name, discipline, shift_hours, status,
    origin, source, approved_by, approved_at)
  values (
    v_company, app.next_company_crew_code(v_company), v_name,
    nullif(btrim(coalesce(p_discipline,'')),''),
    coalesce(p_shift_hours, 8), 'active',
    'company', 'Built in the library screen', auth.uid(), now())
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.create_crew(uuid, text, text, numeric) is
  'Builds a company crew. The first writer of crews, which the estimator, the schedule and every resource assignment have all read since the platform was written. LIBRARY.';

/** Rename a crew, or change the length of its shift. */
create or replace function app.update_crew(
  p_crew        uuid,
  p_name        text default null,
  p_discipline  text default null,
  p_shift_hours numeric default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  select company_id into v_company from crews where id = p_crew;
  if v_company is null then
    raise exception 'That crew is not yours to change'
      using errcode = 'insufficient_privilege',
            hint = 'Catalog crews are shipped by GrounUp. Copy one into your own library instead.';
  end if;
  if not app.has_permission(v_company, 'libraries.write') then
    raise exception 'You do not have permission to change crews'
      using errcode = 'insufficient_privilege';
  end if;
  if p_shift_hours is not null and (p_shift_hours <= 0 or p_shift_hours > 24) then
    raise exception 'A shift is between zero and twenty-four hours'
      using errcode = 'check_violation';
  end if;

  update crews
     set name = coalesce(nullif(btrim(coalesce(p_name,'')),''), name),
         discipline = coalesce(nullif(btrim(coalesce(p_discipline,'')),''), discipline),
         shift_hours = coalesce(p_shift_hours, shift_hours),
         updated_at = now()
   where id = p_crew;
end;
$$;

comment on function app.update_crew(uuid, text, text, numeric) is
  'Renames a company crew or changes its shift. Refuses a catalog crew by name rather than by foreign key, so the message says what to do instead. LIBRARY.';

/**
 * Put a classification on a crew.
 *
 * Headcount, not names: a crew is a priced shape — two operators, a foreman,
 * three laborers — and which particular people fill it on a given Tuesday is
 * `resource_assignments`, a different question with a different answer every
 * week. Conflating them is how a library row starts changing whenever somebody
 * takes a day off.
 *
 * Overtime and doubletime hours per shift are carried because RULE-001 keeps
 * labor and burden apart and a crew running ten-hour days is not the same cost
 * as one running eight, whatever its hourly rates are.
 */
create or replace function app.set_crew_member(
  p_crew        uuid,
  p_labor_rate  uuid,
  p_headcount   int default 1,
  p_straight_hours numeric default null,
  p_overtime_hours numeric default 0,
  p_doubletime_hours numeric default 0)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid; v_id uuid;
begin
  select company_id into v_company from crews where id = p_crew;
  if v_company is null then
    raise exception 'That crew is not yours to change'
      using errcode = 'insufficient_privilege',
            hint = 'Catalog crews are shipped by GrounUp. Build your own to change it.';
  end if;
  if not app.has_permission(v_company, 'libraries.write') then
    raise exception 'You do not have permission to change crews'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from labor_rates r where r.id = p_labor_rate) then
    raise exception 'That labor rate does not exist' using errcode = 'no_data_found';
  end if;
  if coalesce(p_headcount, 1) < 1 or coalesce(p_headcount, 1) > 200 then
    raise exception 'A headcount is between one and two hundred'
      using errcode = 'check_violation';
  end if;

  insert into crew_members (
    company_id, crew_id, labor_rate_id, headcount,
    straight_hours_per_shift, overtime_hours_per_shift, doubletime_hours_per_shift)
  values (v_company, p_crew, p_labor_rate, coalesce(p_headcount, 1),
          p_straight_hours, coalesce(p_overtime_hours, 0), coalesce(p_doubletime_hours, 0))
  on conflict (crew_id, labor_rate_id) do update
     set headcount = excluded.headcount,
         straight_hours_per_shift = excluded.straight_hours_per_shift,
         overtime_hours_per_shift = excluded.overtime_hours_per_shift,
         doubletime_hours_per_shift = excluded.doubletime_hours_per_shift,
         updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.set_crew_member(uuid, uuid, int, numeric, numeric, numeric) is
  'Puts a classification and a headcount on a crew, or changes one already there. A crew is a priced shape; which people fill it on a given day is a resource assignment. LIBRARY.';

/** Take a classification off a crew. */
create or replace function app.remove_crew_member(p_member uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  select company_id into v_company from crew_members where id = p_member;
  if v_company is null then
    raise exception 'That crew is not yours to change' using errcode = 'insufficient_privilege';
  end if;
  if not app.has_permission(v_company, 'libraries.write') then
    raise exception 'You do not have permission to change crews'
      using errcode = 'insufficient_privilege';
  end if;
  delete from crew_members where id = p_member;
end;
$$;

comment on function app.remove_crew_member(uuid) is
  'Removes a classification from a crew. LIBRARY.';

/**
 * Retire a crew.
 *
 * Deactivated rather than deleted. Estimates priced with it, activities
 * scheduled for it and assignments booked against it all still point at it, and
 * a crew that vanishes takes the explanation of an old price with it.
 */
create or replace function app.retire_crew(p_crew uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  select company_id into v_company from crews where id = p_crew;
  if v_company is null then
    raise exception 'That crew is not yours to change' using errcode = 'insufficient_privilege';
  end if;
  if not app.has_permission(v_company, 'libraries.write') then
    raise exception 'You do not have permission to change crews'
      using errcode = 'insufficient_privilege';
  end if;
  update crews set status = 'archived', updated_at = now() where id = p_crew;
end;
$$;

comment on function app.retire_crew(uuid) is
  'Archives a crew. Never deleted: estimates priced with it and activities scheduled for it still point at it. LIBRARY.';

-- -----------------------------------------------------------------------------
-- What all of it is worth reading
-- -----------------------------------------------------------------------------

/**
 * Crews with what they cost an hour and a shift.
 *
 * The hourly figure is the sum of each classification's burdened rate times its
 * headcount — the number an estimate actually multiplies by. Null, not zero,
 * for a crew with no members: a crew that prices at nothing is a crew nobody
 * has built yet, and a zero there reads as free labor.
 */
create or replace view my_crews
with (security_invoker = true) as
select c.id,
       c.company_id,
       c.enterprise_group_id,
       c.code,
       c.name,
       c.discipline,
       c.shift_hours,
       c.status,
       c.origin,
       (c.company_id is not null)                          as is_own,
       (select count(*) from crew_members m where m.crew_id = c.id)       as classification_count,
       (select coalesce(sum(m.headcount), 0) from crew_members m
         where m.crew_id = c.id)                                          as headcount,
       (select sum(m.headcount * r.burdened_cost_per_hour)
          from crew_members m
          join labor_rates r on r.id = m.labor_rate_id
         where m.crew_id = c.id)                                          as cost_per_hour
  from crews c;

comment on view my_crews is
  'Crews with their headcount and what they cost an hour, burdened. LIBRARY. Cost is null rather than zero for a crew with no members, because a crew nobody has built is not a crew that works for nothing.';

revoke all on my_crews from public, anon;
grant select on my_crews to authenticated, service_role;

/**
 * The classifications on a crew, each with its rate.
 *
 * `rate_scope` says where the rate came from, because RULE-003 says the rate a
 * screen shows must be the rate that prices, and a company rate and a shipped
 * one are not interchangeable.
 */
create or replace view my_crew_members
with (security_invoker = true) as
select m.id,
       m.crew_id,
       m.company_id,
       m.labor_rate_id,
       m.headcount,
       m.straight_hours_per_shift,
       m.overtime_hours_per_shift,
       m.doubletime_hours_per_shift,
       r.classification,
       r.base_wage_per_hour,
       r.burden_percent,
       r.burdened_cost_per_hour,
       (m.headcount * r.burdened_cost_per_hour)            as cost_per_hour,
       case when r.company_id is not null then 'company'
            when r.enterprise_group_id is not null then 'group'
            else 'catalog' end                             as rate_scope
  from crew_members m
  join labor_rates r on r.id = m.labor_rate_id;

comment on view my_crew_members is
  'Each classification on a crew with the burdened rate that prices it, and where that rate came from. LIBRARY, RULE-003.';

revoke all on my_crew_members from public, anon;
grant select on my_crew_members to authenticated, service_role;

/**
 * Everybody's credentials, with how they stand and how long is left.
 *
 * `days_remaining` is negative when a ticket has lapsed, which is the number
 * somebody scheduling next week actually looks for.
 */
create or replace view my_employee_credentials
with (security_invoker = true) as
select cr.id,
       cr.company_id,
       cr.employee_id,
       e.employee_number,
       e.full_name,
       e.status                                            as employee_status,
       cr.credential_type,
       cr.name,
       cr.issuing_body,
       cr.identifier,
       cr.issued_on,
       cr.expires_on,
       cr.required_for,
       cr.lifecycle,
       /*
        * Asked, not remembered. 0043: a standing written down is a standing
        * that goes stale the day the date passes.
        */
       app.credential_standing(cr.lifecycle, cr.expires_on) as status,
       case when cr.expires_on is not null
            then cr.expires_on - current_date end           as days_remaining
  from credentials cr
  join employees e on e.id = cr.employee_id;

comment on view my_employee_credentials is
  'Every credential with how it stands and how many days are left, negative once lapsed. ENTITY.';

revoke all on my_employee_credentials from public, anon;
grant select on my_employee_credentials to authenticated, service_role;

/**
 * What each kind of work requires, and how many people can do it.
 *
 * The count is the point. A company that marks a credential mandatory and then
 * finds one person holds it has learned something about next week that no
 * individual record tells them.
 */
create or replace view my_work_credential_requirements
with (security_invoker = true) as
select r.id,
       r.company_id,
       r.work_type,
       r.credential_name,
       r.credential_type,
       r.is_mandatory,
       r.notes,
       (select count(*)
          from credentials c
          join employees e on e.id = c.employee_id
         where e.company_id = r.company_id
           and e.status <> 'terminated'
           and lower(c.name) = lower(r.credential_name)
           and app.credential_standing(c.lifecycle, c.expires_on)
                 in ('valid', 'expiring'))                  as people_who_hold_it
  from work_credential_requirements r;

comment on view my_work_credential_requirements is
  'What each kind of work requires, with how many people currently hold it. ENTITY. The count is what tells a company whether a mandatory rule is one they can actually staff.';

revoke all on my_work_credential_requirements from public, anon;
grant select on my_work_credential_requirements to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The doors
-- -----------------------------------------------------------------------------

create or replace function public.record_credential(
  p_employee uuid, p_name text, p_type text default 'certification',
  p_issuing_body text default null, p_identifier text default null,
  p_issued_on date default null, p_expires_on date default null,
  p_required_for text[] default '{}', p_pending boolean default false)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.record_credential(p_employee, p_name, p_type, p_issuing_body,
       p_identifier, p_issued_on, p_expires_on, p_required_for, p_pending); $$;

create or replace function public.update_credential(
  p_credential uuid, p_name text default null, p_issuing_body text default null,
  p_identifier text default null, p_issued_on date default null,
  p_expires_on date default null, p_required_for text[] default null,
  p_issued boolean default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.update_credential(p_credential, p_name, p_issuing_body, p_identifier,
       p_issued_on, p_expires_on, p_required_for, p_issued); $$;

create or replace function public.revoke_credential(p_credential uuid, p_reason text)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.revoke_credential(p_credential, p_reason); $$;

create or replace function public.set_work_credential_requirement(
  p_company uuid, p_work_type text, p_credential text,
  p_mandatory boolean default true, p_type text default null,
  p_notes text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_work_credential_requirement(p_company, p_work_type, p_credential,
       p_mandatory, p_type, p_notes); $$;

create or replace function public.remove_work_credential_requirement(p_requirement uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.remove_work_credential_requirement(p_requirement); $$;

create or replace function public.update_employee(
  p_employee uuid, p_first_name text default null, p_last_name text default null,
  p_email text default null, p_phone text default null,
  p_classification text default null, p_employment_type text default null,
  p_is_union boolean default null, p_union_local text default null,
  p_hire_date date default null, p_hourly_rate numeric default null,
  p_burden_percent numeric default null, p_labor_rate uuid default null,
  p_emergency_contact text default null, p_emergency_phone text default null,
  p_status text default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.update_employee(p_employee, p_first_name, p_last_name, p_email,
       p_phone, p_classification, p_employment_type, p_is_union, p_union_local,
       p_hire_date, p_hourly_rate, p_burden_percent, p_labor_rate,
       p_emergency_contact, p_emergency_phone, p_status); $$;

create or replace function public.end_employment(
  p_employee uuid, p_on date default current_date, p_reason text default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.end_employment(p_employee, p_on, p_reason); $$;

create or replace function public.create_crew(
  p_company uuid, p_name text, p_discipline text default null,
  p_shift_hours numeric default 8)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_crew(p_company, p_name, p_discipline, p_shift_hours); $$;

create or replace function public.update_crew(
  p_crew uuid, p_name text default null, p_discipline text default null,
  p_shift_hours numeric default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.update_crew(p_crew, p_name, p_discipline, p_shift_hours); $$;

create or replace function public.set_crew_member(
  p_crew uuid, p_labor_rate uuid, p_headcount int default 1,
  p_straight_hours numeric default null, p_overtime_hours numeric default 0,
  p_doubletime_hours numeric default 0)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_crew_member(p_crew, p_labor_rate, p_headcount, p_straight_hours,
       p_overtime_hours, p_doubletime_hours); $$;

create or replace function public.remove_crew_member(p_member uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.remove_crew_member(p_member); $$;

create or replace function public.retire_crew(p_crew uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.retire_crew(p_crew); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.record_credential(uuid, text, text, text, text, date, date, text[], boolean)',
    'public.update_credential(uuid, text, text, text, date, date, text[], boolean)',
    'public.revoke_credential(uuid, text)',
    'public.set_work_credential_requirement(uuid, text, text, boolean, text, text)',
    'public.remove_work_credential_requirement(uuid)',
    'public.update_employee(uuid, text, text, text, text, text, text, boolean, text, date, numeric, numeric, uuid, text, text, text)',
    'public.end_employment(uuid, date, text)',
    'public.create_crew(uuid, text, text, numeric)',
    'public.update_crew(uuid, text, text, numeric)',
    'public.set_crew_member(uuid, uuid, int, numeric, numeric, numeric)',
    'public.remove_crew_member(uuid)',
    'public.retire_crew(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
