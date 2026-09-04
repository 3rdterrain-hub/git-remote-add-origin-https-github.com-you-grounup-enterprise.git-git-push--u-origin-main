-- =============================================================================
-- GrounUp Enterprise — 0021 Safety, quality and the connector runtime
--
-- SVC-SAFETY, SVC-QUALITY and SVC-INTEGRATION.
--
-- Safety and quality records are evidence. An incident report, a toolbox talk
-- sign-in and a passing compaction test are the documents produced in an OSHA
-- inspection or a defect claim, so the constraints here are about making them
-- complete and contemporaneous rather than merely present.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Safety
-- -----------------------------------------------------------------------------
create table safety_incidents (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  project_id          uuid references projects(id) on delete set null,
  number              text not null,
  occurred_at         timestamptz not null,
  reported_at         timestamptz not null default now(),
  incident_type       text not null
                        check (incident_type in ('near_miss', 'first_aid', 'medical_treatment',
                                                 'restricted_duty', 'lost_time', 'fatality',
                                                 'property_damage', 'environmental', 'utility_strike')),
  severity            text not null default 'low' check (severity in ('low', 'moderate', 'high', 'critical')),
  employee_id         uuid references employees(id) on delete set null,
  description         text not null,
  immediate_action    text,
  location            text,
  -- OSHA recordability drives the 300 log; a recordable with no case number
  -- is a compliance gap, not a data-entry preference.
  is_osha_recordable  boolean not null default false,
  osha_case_number    text,
  days_away           int not null default 0 check (days_away >= 0),
  days_restricted     int not null default 0 check (days_restricted >= 0),

  root_cause          text,
  corrective_action   text,
  investigation_state text not null default 'open'
                        check (investigation_state in ('open', 'investigating', 'corrective_action', 'closed')),
  closed_at           timestamptz,
  reported_by         uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, number),
  constraint safety_incidents_recordable check (not is_osha_recordable or osha_case_number is not null),
  -- Closing an investigation without a root cause and a corrective action is
  -- closing a ticket, not preventing a recurrence.
  constraint safety_incidents_closed
    check (investigation_state <> 'closed'
           or (root_cause is not null and corrective_action is not null and closed_at is not null)),
  constraint safety_incidents_reported_after check (reported_at >= occurred_at)
);
create index safety_incidents_company_idx on safety_incidents(company_id, occurred_at desc);
create index safety_incidents_open_idx on safety_incidents(company_id) where investigation_state <> 'closed';

comment on constraint safety_incidents_closed on safety_incidents is
  'An incident closed with no root cause and no corrective action has been filed, not investigated.';

create table toolbox_talks (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  project_id          uuid references projects(id) on delete set null,
  held_on             date not null,
  topic               text not null,
  presenter_id        uuid references employees(id) on delete set null,
  notes               text,
  attendee_count      int not null default 0 check (attendee_count >= 0),
  -- Signatures are the evidence the talk happened; a talk with no attendees
  -- recorded proves nothing in an inspection.
  storage_path        text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index toolbox_talks_project_idx on toolbox_talks(project_id, held_on desc);

create table safety_observations (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  project_id          uuid references projects(id) on delete set null,
  observed_at         timestamptz not null default now(),
  observer_id         uuid references employees(id) on delete set null,
  category            text not null
                        check (category in ('ppe', 'excavation', 'fall_protection', 'traffic',
                                            'equipment', 'housekeeping', 'utilities', 'environmental', 'other')),
  is_positive         boolean not null default false,
  description         text not null,
  -- An unsafe condition must be corrected or have a plan; recording it and
  -- walking away is worse than not looking.
  corrected_on_site   boolean not null default false,
  corrective_action   text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint safety_observations_unsafe
    check (is_positive or corrected_on_site or corrective_action is not null)
);
create index safety_observations_project_idx on safety_observations(project_id, observed_at desc);

-- -----------------------------------------------------------------------------
-- Quality
-- -----------------------------------------------------------------------------
create table inspections (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  project_id          uuid not null references projects(id) on delete cascade,
  project_task_id     uuid references project_tasks(id) on delete set null,
  number              text not null,
  inspection_type     text not null
                        check (inspection_type in ('compaction', 'concrete', 'asphalt', 'pipe_test',
                                                   'proof_roll', 'survey', 'material', 'punch_list', 'other')),
  title               text not null,
  spec_reference      text,
  location            text,
  station             text,
  inspected_at        timestamptz not null default now(),
  inspector_name      text,
  inspecting_agency   text,
  -- Test values, e.g. {"required":95,"achieved":97.2,"unit":"% Proctor"}.
  result_values       jsonb not null default '{}'::jsonb,
  result              text not null default 'pending'
                        check (result in ('pending', 'pass', 'fail', 'conditional')),
  -- A failed test without a retest reference leaves the work unaccepted.
  retest_of_id        uuid references inspections(id) on delete set null,
  notes               text,
  storage_path        text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, number),
  constraint inspections_failed check (result <> 'fail' or notes is not null)
);
create index inspections_project_idx on inspections(project_id, inspected_at desc);
create index inspections_failed_idx on inspections(company_id) where result = 'fail';

create table deficiencies (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  project_id          uuid not null references projects(id) on delete cascade,
  inspection_id       uuid references inspections(id) on delete set null,
  number              text not null,
  description         text not null,
  location            text,
  trade               text,
  responsible_vendor_id uuid references vendors(id) on delete set null,
  identified_on       date not null default current_date,
  due_on              date,
  status              text not null default 'open'
                        check (status in ('open', 'in_progress', 'ready_for_review', 'closed', 'void')),
  closed_on           date,
  closed_by           uuid references auth.users(id) on delete set null,
  verification_note   text,
  storage_path        text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, number),
  -- Closing a punch item requires someone to say they verified it.
  constraint deficiencies_closed
    check (status <> 'closed' or (closed_on is not null and closed_by is not null and verification_note is not null))
);
create index deficiencies_project_idx on deficiencies(project_id, status);

comment on constraint deficiencies_closed on deficiencies is
  'A punch item closed without a named verifier and a note is a checkbox, not an acceptance.';

-- -----------------------------------------------------------------------------
-- Connector runtime (SVC-INTEGRATION)
-- -----------------------------------------------------------------------------
create table connectors (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  connector_type      text not null
                        check (connector_type in ('accounting', 'payroll', 'telematics', 'fuel_card',
                                                  'machine_control', 'weather', 'storage', 'esignature', 'webhook')),
  provider            text not null,
  name                text not null,
  -- Credentials live in the platform secret store; only its handle is here, so
  -- a database read can never yield a usable credential.
  credential_ref      text,
  config              jsonb not null default '{}'::jsonb,
  field_mapping       jsonb not null default '{}'::jsonb,
  schedule_cron       text,
  is_enabled          boolean not null default false,
  last_run_at         timestamptz,
  last_success_at     timestamptz,
  consecutive_failures int not null default 0 check (consecutive_failures >= 0),
  status              text not null default 'not_connected'
                        check (status in ('not_connected', 'connected', 'degraded', 'failed', 'disabled')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, connector_type, provider),
  -- A connector cannot be enabled without a credential to run as.
  constraint connectors_enabled_needs_credential check (not is_enabled or credential_ref is not null)
);
create index connectors_company_idx on connectors(company_id, connector_type);

comment on column connectors.credential_ref is
  'A handle into the platform secret store, never the secret. Reading this table yields nothing an attacker can authenticate with.';

create table connector_runs (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  connector_id        uuid not null references connectors(id) on delete cascade,
  direction           text not null default 'inbound' check (direction in ('inbound', 'outbound')),
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  records_read        int not null default 0 check (records_read >= 0),
  records_written     int not null default 0 check (records_written >= 0),
  records_skipped     int not null default 0 check (records_skipped >= 0),
  -- Idempotency: a rerun of the same window must not double-post.
  idempotency_key     text,
  status              text not null default 'running'
                        check (status in ('running', 'succeeded', 'partial', 'failed', 'skipped')),
  error_message       text,
  created_at          timestamptz not null default now(),
  constraint connector_runs_failed check (status not in ('failed', 'partial') or error_message is not null)
);
create index connector_runs_connector_idx on connector_runs(connector_id, started_at desc);
create unique index connector_runs_idempotency_idx on connector_runs(connector_id, idempotency_key)
  where idempotency_key is not null;

/** Keeps connector health honest against its own run history. */
create or replace function app.apply_connector_run()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.status = 'running' then
    return new;
  end if;
  update connectors
  set last_run_at = coalesce(new.finished_at, now()),
      last_success_at = case when new.status = 'succeeded' then coalesce(new.finished_at, now())
                             else last_success_at end,
      consecutive_failures = case when new.status in ('failed', 'partial') then consecutive_failures + 1 else 0 end,
      status = case
        when new.status = 'succeeded' then 'connected'
        when consecutive_failures + 1 >= 3 then 'failed'
        else 'degraded'
      end,
      updated_at = now()
  where id = new.connector_id;
  return new;
end;
$$;

create trigger apply_connector_run
  after insert or update of status on connector_runs
  for each row execute function app.apply_connector_run();
