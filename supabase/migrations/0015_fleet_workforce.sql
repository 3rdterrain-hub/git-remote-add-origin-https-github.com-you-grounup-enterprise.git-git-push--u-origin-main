-- =============================================================================
-- GrounUp Enterprise — 0015 Fleet, workforce and scheduling
--
-- SVC-FLEET, SVC-MAINT, SVC-FUEL, SVC-HRM, SVC-TIME, SVC-TRAIN,
-- SVC-SCHEDULE and SVC-RESOURCE.
--
-- The through-line: an asset's meter reading drives its maintenance due date,
-- its fuel transactions reconcile against its engine hours, and a timecard
-- posts to the same cost code the estimate priced. Nothing here is a standalone
-- register — each table closes a loop back to the estimate or the job cost.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Employees
-- -----------------------------------------------------------------------------
create table employees (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  division_id         uuid references divisions(id) on delete set null,
  -- Set when the employee also has a login. Field staff often do not.
  user_id             uuid references auth.users(id) on delete set null,
  employee_number     text not null,
  first_name          text not null,
  last_name           text not null,
  full_name           text generated always as (first_name || ' ' || last_name) stored,
  email               text,
  phone               text,
  labor_rate_id       uuid references labor_rates(id) on delete set null,
  classification      text,
  employment_type     text not null default 'full_time'
                        check (employment_type in ('full_time', 'part_time', 'seasonal', 'temporary', 'subcontract')),
  is_union            boolean not null default false,
  union_local         text,
  hire_date           date,
  termination_date    date,
  hourly_rate         numeric(12,4) check (hourly_rate is null or hourly_rate >= 0),
  burden_percent      numeric(6,4) check (burden_percent is null or burden_percent >= 0),
  emergency_contact   text,
  emergency_phone     text,
  status              text not null default 'active'
                        check (status in ('applicant', 'onboarding', 'active', 'on_leave', 'terminated')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, employee_number),
  constraint employees_termination check (termination_date is null or hire_date is null or termination_date >= hire_date),
  -- A terminated employee must record when. Otherwise payroll and access
  -- reviews cannot tell an active worker from a stale record.
  constraint employees_terminated_date check (status <> 'terminated' or termination_date is not null)
);
create index employees_company_status_idx on employees(company_id, status);
create index employees_name_idx on employees using gin (full_name gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- Credentials and training
-- -----------------------------------------------------------------------------
create table credentials (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  employee_id         uuid not null references employees(id) on delete cascade,
  credential_type     text not null
                        check (credential_type in ('license', 'certification', 'training', 'medical', 'clearance')),
  name                text not null,
  issuing_body        text,
  identifier          text,
  issued_on           date,
  expires_on          date,
  -- Work this credential is a prerequisite for, e.g. CDL for a truck driver.
  required_for        text[] not null default '{}',
  storage_path        text,
  status              text not null default 'valid'
                        check (status in ('valid', 'expiring', 'expired', 'revoked', 'pending')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint credentials_dates check (expires_on is null or issued_on is null or expires_on > issued_on)
);
create index credentials_employee_idx on credentials(employee_id);
create index credentials_expiry_idx on credentials(company_id, expires_on) where expires_on is not null and status <> 'revoked';

create trigger credentials_tenant_parent
  before insert or update on credentials
  for each row execute function app.enforce_tenant_parent('employees', 'employee_id', 'id');

/**
 * Keeps `status` honest against the calendar.
 *
 * A credential register whose statuses are maintained by hand drifts within
 * weeks, and an expired CDL that still reads "valid" is exactly the record that
 * matters in an audit.
 */
create or replace function app.refresh_credential_status()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'revoked' or new.expires_on is null then
    return new;
  end if;
  new.status := case
    when new.expires_on < current_date then 'expired'
    when new.expires_on < current_date + interval '30 days' then 'expiring'
    else 'valid'
  end;
  return new;
end;
$$;

create trigger refresh_credential_status
  before insert or update of expires_on, status on credentials
  for each row execute function app.refresh_credential_status();

-- -----------------------------------------------------------------------------
-- Time and attendance
-- -----------------------------------------------------------------------------
create table time_entries (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  employee_id         uuid not null references employees(id) on delete cascade,
  project_id          uuid references projects(id) on delete set null,
  project_task_id     uuid references project_tasks(id) on delete set null,
  cost_code_id        uuid references cost_codes(id) on delete set null,
  daily_report_id     uuid references daily_reports(id) on delete set null,
  work_date           date not null,
  straight_hours      numeric(6,2) not null default 0 check (straight_hours >= 0 and straight_hours <= 24),
  overtime_hours      numeric(6,2) not null default 0 check (overtime_hours >= 0 and overtime_hours <= 24),
  doubletime_hours    numeric(6,2) not null default 0 check (doubletime_hours >= 0 and doubletime_hours <= 24),
  total_hours         numeric(7,2) generated always as (straight_hours + overtime_hours + doubletime_hours) stored,
  per_diem            numeric(10,2) not null default 0 check (per_diem >= 0),
  notes               text,
  source              text not null default 'manual'
                        check (source in ('manual', 'mobile', 'kiosk', 'import', 'daily_report')),
  approval_state      app.approval_state not null default 'pending',
  approved_by         uuid references auth.users(id) on delete set null,
  approved_at         timestamptz,
  -- Set once exported to payroll; the row is frozen from then on.
  exported_at         timestamptz,
  payroll_batch       text,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint time_entries_day_total check (straight_hours + overtime_hours + doubletime_hours <= 24),
  constraint time_entries_approved check (approval_state <> 'approved' or (approved_by is not null and approved_at is not null))
);
create index time_entries_employee_date_idx on time_entries(employee_id, work_date desc);
create index time_entries_project_idx on time_entries(project_id, work_date desc) where project_id is not null;
create index time_entries_unapproved_idx on time_entries(company_id, work_date) where approval_state = 'pending';

create trigger time_entries_tenant_parent
  before insert or update on time_entries
  for each row execute function app.enforce_tenant_parent('employees', 'employee_id', 'id');

/** A timecard that has gone to payroll is a financial record and stops changing. */
create or replace function app.enforce_time_entry_lock()
returns trigger
language plpgsql
as $$
begin
  if old.exported_at is not null then
    raise exception
      'Time entry % was exported to payroll batch % on %; it can no longer be edited. Post an adjusting entry instead.',
      old.id, coalesce(old.payroll_batch, 'unknown'), old.exported_at::date
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger enforce_time_entry_lock
  before update on time_entries
  for each row when (old.exported_at is not null)
  execute function app.enforce_time_entry_lock();

-- -----------------------------------------------------------------------------
-- Fleet assets
-- -----------------------------------------------------------------------------
create table assets (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  division_id         uuid references divisions(id) on delete set null,
  -- Links the physical machine to its catalog rate class.
  equipment_id        uuid references equipment(id) on delete set null,
  asset_number        text not null,
  name                text not null,
  asset_class         text,
  make                text,
  model               text,
  model_year          int check (model_year is null or (model_year between 1950 and 2100)),
  serial_number       text,
  vin                 text,
  license_plate       text,
  ownership           text not null default 'owned'
                        check (ownership in ('owned', 'leased', 'rented', 'subcontracted')),
  acquired_on         date,
  acquisition_cost    numeric(14,2) check (acquisition_cost is null or acquisition_cost >= 0),
  disposed_on         date,
  -- Meter type drives how maintenance intervals are measured.
  meter_type          text not null default 'hours' check (meter_type in ('hours', 'miles', 'both', 'none')),
  current_hours       numeric(12,2) not null default 0 check (current_hours >= 0),
  current_miles       numeric(12,2) not null default 0 check (current_miles >= 0),
  fuel_type           text check (fuel_type in ('diesel', 'gasoline', 'electric', 'propane', 'hybrid', 'none')),
  assigned_project_id uuid references projects(id) on delete set null,
  assigned_employee_id uuid references employees(id) on delete set null,
  home_location       text,
  latitude            numeric(9,6) check (latitude is null or (latitude between -90 and 90)),
  longitude           numeric(9,6) check (longitude is null or (longitude between -180 and 180)),
  telematics_device_id text,
  last_telemetry_at   timestamptz,
  status              text not null default 'available'
                        check (status in ('available', 'assigned', 'in_maintenance', 'down', 'rented_out', 'disposed')),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, asset_number),
  constraint assets_disposed check (status <> 'disposed' or disposed_on is not null)
);
create index assets_company_status_idx on assets(company_id, status);
create index assets_project_idx on assets(assigned_project_id) where assigned_project_id is not null;
create index assets_equipment_idx on assets(equipment_id) where equipment_id is not null;

comment on column assets.equipment_id is
  'Ties the physical machine to the catalog rate it is estimated at, so utilization can be read against the rate that priced the work.';

/**
 * Meter readings.
 *
 * Separate from `assets.current_hours` because a meter has a history and can be
 * replaced. The trigger below advances the asset only on a forward reading, so
 * a mistyped or post-replacement value cannot silently roll the machine back.
 */
create table meter_readings (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  asset_id            uuid not null references assets(id) on delete cascade,
  reading_at          timestamptz not null default now(),
  hours               numeric(12,2) check (hours is null or hours >= 0),
  miles               numeric(12,2) check (miles is null or miles >= 0),
  source              text not null default 'manual'
                        check (source in ('manual', 'telematics', 'fuel_card', 'inspection', 'work_order')),
  is_meter_replacement boolean not null default false,
  recorded_by         uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  constraint meter_readings_has_value check (hours is not null or miles is not null)
);
create index meter_readings_asset_idx on meter_readings(asset_id, reading_at desc);

create trigger meter_readings_tenant_parent
  before insert or update on meter_readings
  for each row execute function app.enforce_tenant_parent('assets', 'asset_id', 'id');

create or replace function app.apply_meter_reading()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_hours numeric;
  v_miles numeric;
begin
  select current_hours, current_miles into v_hours, v_miles from assets where id = new.asset_id;

  -- A replacement meter legitimately reads lower; anything else must move forward.
  if not new.is_meter_replacement then
    if new.hours is not null and new.hours < v_hours then
      raise exception
        'Meter reading of %h is below the asset''s current %h. Record a meter replacement if the unit was changed.',
        new.hours, v_hours
        using errcode = 'check_violation';
    end if;
    if new.miles is not null and new.miles < v_miles then
      raise exception 'Odometer reading of % is below the asset''s current %.', new.miles, v_miles
        using errcode = 'check_violation';
    end if;
  end if;

  update assets
  set current_hours = coalesce(new.hours, current_hours),
      current_miles = coalesce(new.miles, current_miles),
      last_telemetry_at = case when new.source = 'telematics' then new.reading_at else last_telemetry_at end,
      updated_at = now()
  where id = new.asset_id;

  return new;
end;
$$;

create trigger apply_meter_reading
  after insert on meter_readings
  for each row execute function app.apply_meter_reading();

-- -----------------------------------------------------------------------------
-- Maintenance
-- -----------------------------------------------------------------------------
create table maintenance_schedules (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  asset_id            uuid not null references assets(id) on delete cascade,
  name                text not null,
  interval_hours      numeric(10,2) check (interval_hours is null or interval_hours > 0),
  interval_miles      numeric(10,2) check (interval_miles is null or interval_miles > 0),
  interval_days       int check (interval_days is null or interval_days > 0),
  last_performed_at   timestamptz,
  last_performed_hours numeric(12,2),
  last_performed_miles numeric(12,2),
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint maintenance_schedules_interval
    check (num_nonnulls(interval_hours, interval_miles, interval_days) >= 1)
);
create index maintenance_schedules_asset_idx on maintenance_schedules(asset_id) where is_active;

create trigger maintenance_schedules_tenant_parent
  before insert or update on maintenance_schedules
  for each row execute function app.enforce_tenant_parent('assets', 'asset_id', 'id');

create table work_orders (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  asset_id            uuid not null references assets(id) on delete cascade,
  schedule_id         uuid references maintenance_schedules(id) on delete set null,
  number              text not null,
  title               text not null,
  work_order_type     text not null default 'preventive'
                        check (work_order_type in ('preventive', 'corrective', 'inspection', 'safety', 'warranty')),
  priority            text not null default 'normal' check (priority in ('low', 'normal', 'high', 'critical')),
  description         text,
  failure_code        text,
  meter_hours_at_open numeric(12,2),
  opened_at           timestamptz not null default now(),
  scheduled_for       date,
  started_at          timestamptz,
  completed_at        timestamptz,
  -- Hours the machine was unavailable, which is what utilization reporting needs.
  downtime_hours      numeric(10,2) not null default 0 check (downtime_hours >= 0),
  labor_hours         numeric(10,2) not null default 0 check (labor_hours >= 0),
  labor_cost          numeric(14,2) not null default 0 check (labor_cost >= 0),
  parts_cost          numeric(14,2) not null default 0 check (parts_cost >= 0),
  outside_cost        numeric(14,2) not null default 0 check (outside_cost >= 0),
  total_cost          numeric(14,2) generated always as (labor_cost + parts_cost + outside_cost) stored,
  vendor_id           uuid references vendors(id) on delete set null,
  assigned_to         uuid references employees(id) on delete set null,
  status              text not null default 'open'
                        check (status in ('open', 'scheduled', 'in_progress', 'awaiting_parts', 'complete', 'canceled')),
  resolution          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, number),
  constraint work_orders_complete
    check (status <> 'complete' or (completed_at is not null and resolution is not null))
);
create index work_orders_asset_idx on work_orders(asset_id, opened_at desc);
create index work_orders_open_idx on work_orders(company_id, status) where status not in ('complete', 'canceled');

create trigger work_orders_tenant_parent
  before insert or update on work_orders
  for each row execute function app.enforce_tenant_parent('assets', 'asset_id', 'id');

comment on constraint work_orders_complete on work_orders is
  'A completed work order must say what was actually done. "Complete" with no resolution tells the next mechanic nothing.';

/** Completing a preventive work order resets its schedule from the asset's meter. */
create or replace function app.close_maintenance_schedule()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.status = 'complete' and old.status <> 'complete' and new.schedule_id is not null then
    update maintenance_schedules s
    set last_performed_at = coalesce(new.completed_at, now()),
        last_performed_hours = a.current_hours,
        last_performed_miles = a.current_miles,
        updated_at = now()
    from assets a
    where s.id = new.schedule_id and a.id = new.asset_id;
  end if;
  return new;
end;
$$;

create trigger close_maintenance_schedule
  after update on work_orders
  for each row execute function app.close_maintenance_schedule();

-- -----------------------------------------------------------------------------
-- Fuel
-- -----------------------------------------------------------------------------
create table fuel_transactions (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  asset_id            uuid references assets(id) on delete set null,
  employee_id         uuid references employees(id) on delete set null,
  project_id          uuid references projects(id) on delete set null,
  transacted_at       timestamptz not null,
  gallons             numeric(10,3) not null check (gallons > 0),
  price_per_gallon    numeric(10,4) not null check (price_per_gallon >= 0),
  total_cost          numeric(12,2) generated always as (gallons * price_per_gallon) stored,
  fuel_type           text not null default 'diesel',
  odometer_hours      numeric(12,2),
  odometer_miles      numeric(12,2),
  card_last4          char(4),
  vendor_name         text,
  location            text,
  source              text not null default 'manual'
                        check (source in ('manual', 'fuel_card', 'onsite_tank', 'import')),
  -- Set when the transaction cannot be matched to an asset or looks anomalous.
  exception_flag      text check (exception_flag in ('no_asset', 'meter_regression', 'volume_outlier', 'duplicate')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index fuel_transactions_asset_idx on fuel_transactions(asset_id, transacted_at desc) where asset_id is not null;
create index fuel_transactions_exceptions_idx on fuel_transactions(company_id, transacted_at desc) where exception_flag is not null;

comment on column fuel_transactions.card_last4 is
  'Last four digits only, for reconciliation against a statement. No full card number is ever stored.';

-- -----------------------------------------------------------------------------
-- Scheduling
-- -----------------------------------------------------------------------------
create table schedule_activities (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  project_id          uuid not null references projects(id) on delete cascade,
  project_task_id     uuid references project_tasks(id) on delete set null,
  wbs_code            text,
  name                text not null,
  -- The estimate line this activity was scheduled from, so duration can be
  -- read against the production rate that produced it.
  source_line_item_id uuid references estimate_line_items(id) on delete set null,
  planned_start       date not null,
  planned_finish      date not null,
  actual_start        date,
  actual_finish       date,
  duration_days       numeric(8,2) not null check (duration_days >= 0),
  percent_complete    numeric(5,4) not null default 0 check (percent_complete >= 0 and percent_complete <= 1),
  total_float_days    numeric(8,2),
  is_critical         boolean not null default false,
  is_milestone        boolean not null default false,
  crew_id             uuid references crews(id) on delete set null,
  constraint_type     text check (constraint_type in ('start_no_earlier', 'finish_no_later', 'must_start_on', 'must_finish_on')),
  constraint_date     date,
  sort_order          int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint schedule_activities_dates check (planned_finish >= planned_start),
  constraint schedule_activities_actual check (actual_finish is null or actual_start is null or actual_finish >= actual_start),
  -- Float is what makes an activity critical; the two must agree.
  constraint schedule_activities_critical
    check (total_float_days is null or (is_critical = (total_float_days <= 0)))
);
create index schedule_activities_project_idx on schedule_activities(project_id, planned_start);
create index schedule_activities_critical_idx on schedule_activities(project_id) where is_critical;

create trigger schedule_activities_tenant_parent
  before insert or update on schedule_activities
  for each row execute function app.enforce_tenant_parent('projects', 'project_id', 'id');

create table schedule_dependencies (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  predecessor_id      uuid not null references schedule_activities(id) on delete cascade,
  successor_id        uuid not null references schedule_activities(id) on delete cascade,
  dependency_type     text not null default 'finish_to_start'
                        check (dependency_type in ('finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish')),
  lag_days            numeric(8,2) not null default 0,
  created_at          timestamptz not null default now(),
  unique (predecessor_id, successor_id),
  constraint schedule_dependencies_no_self check (predecessor_id <> successor_id)
);

-- -----------------------------------------------------------------------------
-- Resource assignments — the demand side of resource planning
-- -----------------------------------------------------------------------------
create table resource_assignments (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  project_id          uuid not null references projects(id) on delete cascade,
  schedule_activity_id uuid references schedule_activities(id) on delete cascade,
  resource_kind       text not null check (resource_kind in ('crew', 'employee', 'asset', 'subcontractor')),
  crew_id             uuid references crews(id) on delete set null,
  employee_id         uuid references employees(id) on delete set null,
  asset_id            uuid references assets(id) on delete set null,
  vendor_id           uuid references vendors(id) on delete set null,
  starts_on           date not null,
  ends_on             date not null,
  -- Fraction of the resource's capacity this assignment consumes.
  allocation          numeric(5,4) not null default 1 check (allocation > 0 and allocation <= 1),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint resource_assignments_dates check (ends_on >= starts_on),
  constraint resource_assignments_reference check (
    (resource_kind = 'crew' and crew_id is not null) or
    (resource_kind = 'employee' and employee_id is not null) or
    (resource_kind = 'asset' and asset_id is not null) or
    (resource_kind = 'subcontractor' and vendor_id is not null)
  )
);
create index resource_assignments_project_idx on resource_assignments(project_id, starts_on);
create index resource_assignments_asset_idx on resource_assignments(asset_id, starts_on) where asset_id is not null;
create index resource_assignments_employee_idx on resource_assignments(employee_id, starts_on) where employee_id is not null;

create trigger resource_assignments_tenant_parent
  before insert or update on resource_assignments
  for each row execute function app.enforce_tenant_parent('projects', 'project_id', 'id');

/**
 * A single machine cannot be in two places at once.
 *
 * An exclusion constraint on the asset and its date range catches the
 * double-booking that a scheduler will otherwise only discover when two
 * superintendents both expect the excavator on Monday. Crews and employees can
 * legitimately split across jobs, so they are checked by allocation instead.
 */
alter table resource_assignments
  add constraint resource_assignments_asset_no_overlap
  exclude using gist (
    asset_id with =,
    daterange(starts_on, ends_on, '[]') with &&
  ) where (asset_id is not null and allocation = 1);
