-- =============================================================================
-- 0035 — Safety controls that actually control something
--
-- The safety schema is good at recording. An incident cannot be closed without
-- a root cause and a corrective action; a recordable one cannot exist without
-- an OSHA case number; a punch item cannot be closed without a named verifier
-- and a note. Every one of those is a real guarantee.
--
-- Two things it could not do, and they are the two that separate a safety
-- system from a filing cabinet:
--
--   * **Nothing blocked.** `credentials.required_for` has always carried "work
--     this credential is a prerequisite for, e.g. CDL for a truck driver", and
--     nothing anywhere read it. An employee whose CDL expired last month could
--     be assigned to drive, and the platform recorded the expiry and the
--     assignment side by side without connecting them.
--   * **Nothing notified.** The `notifications` table has a `safety` category
--     and, across the entire codebase, no producer at all — only tests insert
--     into it. A recordable injury generated no notice to anybody.
--
-- Both are fixed here for the cases that matter most, and both follow the rule
-- this build has used throughout: a company that has configured no requirement
-- is not running a policy, and the platform does not invent one for it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- What work demands what credential
-- -----------------------------------------------------------------------------

/*
 * `credentials.required_for` says what a credential a person holds enables.
 * That is the wrong direction to enforce from: it can catch a lapsed
 * credential, and it can never catch one the person never had. This table
 * states the requirement from the work's side, which is the direction a safety
 * rule is actually written in.
 */
create table work_credential_requirements (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,

  -- The work, named the same way `credentials.required_for` names it.
  work_type           text not null check (work_type ~ '^[a-z][a-z0-9_]{1,60}$'),
  -- Matched against `credentials.name`, because that is what a certificate
  -- actually says. Case-insensitive, so "CDL Class A" and "CDL class A" are
  -- the same requirement.
  credential_name     text not null check (length(trim(credential_name)) > 0),
  credential_type     text check (credential_type in ('license', 'certification', 'training', 'medical', 'clearance')),

  -- A recommended credential is recorded and warned about; a mandatory one
  -- blocks. Both are useful and they are not the same rule.
  is_mandatory        boolean not null default true,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (company_id, work_type, credential_name)
);
create index work_credential_requirements_lookup_idx
  on work_credential_requirements(company_id, work_type);

comment on table work_credential_requirements is
  'What credential a kind of work requires. ENTITY. Stated from the work''s side, because a requirement written on the credential can only ever catch a lapse, never an absence.';

-- The work an assignment is for. Null means the assignment declares no
-- particular work, and nothing is checked — the same permissive default as an
-- unconfigured plan limit or an undefined accounting period.
alter table resource_assignments
  add column work_type text check (work_type is null or work_type ~ '^[a-z][a-z0-9_]{1,60}$');

comment on column resource_assignments.work_type is
  'What this assignment is for, matched against work_credential_requirements. Null means unspecified, and nothing is required.';

/**
 * Credentials a person is missing or has let lapse for a kind of work.
 *
 * Returns one row per unmet requirement, with why it is unmet, so a caller can
 * show a person what to fix rather than only that something is wrong.
 */
create or replace function app.credential_gaps(p_employee uuid, p_work_type text)
returns table (credential_name text, is_mandatory boolean, reason text)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select r.credential_name,
         r.is_mandatory,
         case
           when c.id is null then 'not held'
           when c.status = 'revoked' then 'revoked'
           when c.status = 'expired' then 'expired ' || coalesce(c.expires_on::text, '')
           when c.status = 'pending' then 'not yet issued'
           else 'held'
         end as reason
  from work_credential_requirements r
  join employees e on e.id = p_employee and e.company_id = r.company_id
  left join lateral (
    select c.* from credentials c
    where c.employee_id = p_employee
      and lower(c.name) = lower(r.credential_name)
    order by case c.status when 'valid' then 0 when 'expiring' then 1 else 2 end,
             c.expires_on desc nulls last
    limit 1
  ) c on true
  where r.work_type = p_work_type
    and (c.id is null or c.status in ('revoked', 'expired', 'pending'));
$$;

grant execute on function app.credential_gaps(uuid, text) to authenticated, service_role;

comment on function app.credential_gaps(uuid, text) is
  'Unmet credential requirements for a person and a kind of work, each with its reason. An expiring credential is not a gap — it is still valid, and warning about it is the notification''s job.';

/**
 * Refuse assigning somebody to work they are not credentialed for.
 *
 * Mandatory requirements block. Recommended ones do not, because a rule that
 * blocks on everything gets switched off, and a company that marked a
 * credential recommended has already made that call.
 *
 * This is the platform's first blocking safety control, and it is deliberately
 * narrow: it fires on an employee assignment with a declared work type, at a
 * company that has configured a requirement for it.
 */
create or replace function app.enforce_assignment_credentials()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_blocking text;
  v_name     text;
begin
  if new.resource_kind <> 'employee' or new.employee_id is null or new.work_type is null then
    return new;
  end if;

  select string_agg(g.credential_name || ' (' || g.reason || ')', ', ' order by g.credential_name)
    into v_blocking
  from app.credential_gaps(new.employee_id, new.work_type) g
  where g.is_mandatory;

  if v_blocking is not null then
    select first_name || ' ' || last_name into v_name from employees where id = new.employee_id;
    raise exception
      '% cannot be assigned to % : %.',
      coalesce(v_name, 'This employee'), new.work_type, v_blocking
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger resource_assignments_credentialed
  before insert or update on resource_assignments
  for each row execute function app.enforce_assignment_credentials();

comment on function app.enforce_assignment_credentials() is
  'Refuses an employee assignment where a mandatory credential for the declared work is missing, expired, revoked or not yet issued. Recommended requirements do not block, because a control that blocks on everything gets turned off.';

-- -----------------------------------------------------------------------------
-- Notifications that somebody actually sends
--
-- The notifications table has existed with a `safety` category and no producer
-- anywhere in the codebase. These are its first two.
-- -----------------------------------------------------------------------------

/**
 * A recordable injury notifies the company.
 *
 * Company-wide rather than targeted: a recordable incident is not one person's
 * business, and the OSHA log is a company obligation. Severity maps from the
 * incident's own, so a fatality does not arrive looking like a paper cut.
 */
create or replace function app.notify_recordable_incident()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Only on becoming recordable, so an edit to an already-recordable incident
  -- does not re-notify.
  if not new.is_osha_recordable
     or (tg_op = 'UPDATE' and old.is_osha_recordable) then
    return new;
  end if;

  insert into notifications (company_id, category, severity, title, body,
                             action_path, action_label, entity_table, entity_id)
  values (
    new.company_id, 'safety',
    case when new.incident_type in ('fatality', 'lost_time') or new.severity = 'critical'
         then 'critical' else 'warning' end,
    'OSHA recordable incident ' || new.number,
    replace(new.incident_type, '_', ' ') || ' on ' || to_char(new.occurred_at, 'YYYY-MM-DD')
      || '. Case ' || coalesce(new.osha_case_number, 'not yet assigned')
      || '. An investigation must record a root cause and a corrective action before it can be closed.',
    '/app/safety', 'Open the incident', 'public.safety_incidents', new.id::text);

  return new;
end;
$$;

create trigger safety_incidents_notify
  after insert or update of is_osha_recordable on safety_incidents
  for each row execute function app.notify_recordable_incident();

/**
 * A credential entering its expiry window notifies the company.
 *
 * On the transition only. `refresh_credential_status` recomputes status on
 * every touch, and a notice on every touch is how people learn to ignore
 * notices.
 */
create or replace function app.notify_credential_expiry()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_name text;
begin
  if new.status not in ('expiring', 'expired')
     or (tg_op = 'UPDATE' and old.status = new.status) then
    return new;
  end if;

  select first_name || ' ' || last_name into v_name from employees where id = new.employee_id;

  insert into notifications (company_id, category, severity, title, body,
                             action_path, action_label, entity_table, entity_id)
  values (
    new.company_id, 'safety',
    case when new.status = 'expired' then 'critical' else 'warning' end,
    coalesce(v_name, 'An employee') || ': ' || new.name || ' ' || new.status,
    new.name || ' ' ||
      case when new.status = 'expired' then 'expired on ' else 'expires on ' end ||
      coalesce(new.expires_on::text, 'an unrecorded date') ||
      case when array_length(new.required_for, 1) is null then '.'
           else '. Required for: ' || array_to_string(new.required_for, ', ') || '.' end,
    '/app/workforce', 'Open the record', 'public.credentials', new.id::text);

  return new;
end;
$$;

create trigger credentials_notify_expiry
  after insert or update of status on credentials
  for each row execute function app.notify_credential_expiry();

comment on function app.notify_credential_expiry() is
  'Notifies on the transition into expiring or expired, not on every recomputation. A notice on every touch is how people learn to ignore notices.';

-- -----------------------------------------------------------------------------
-- RLS, audit and grants
-- -----------------------------------------------------------------------------
select app.apply_tenant_rls('work_credential_requirements', null, 'safety.write');
select app.attach_standard_triggers('public.work_credential_requirements'::regclass);

select app.assert_security_gates();
