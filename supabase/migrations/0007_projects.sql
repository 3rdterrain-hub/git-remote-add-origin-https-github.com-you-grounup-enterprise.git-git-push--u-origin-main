-- =============================================================================
-- GrounUp Enterprise — 0007 Projects and operations
--
-- Award converts an estimate version into a project without re-entering
-- anything: the estimate's line items become the budget baseline, and the
-- production actuals recorded against them flow back as calibration candidates
-- for the production rate library (RULE-008 — candidates, never silent writes).
-- =============================================================================

create table projects (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  division_id         uuid references divisions(id) on delete set null,
  customer_id         uuid references customers(id) on delete set null,
  opportunity_id      uuid references opportunities(id) on delete set null,
  -- The exact priced version this project was awarded from.
  source_estimate_version_id uuid references estimate_versions(id) on delete set null,
  number              text not null,
  name                text not null,
  description         text,
  status              text not null default 'preconstruction'
                        check (status in ('preconstruction', 'active', 'on_hold', 'substantially_complete', 'closed', 'canceled')),
  contract_type       text check (contract_type in ('lump_sum', 'unit_price', 'cost_plus', 'gmp', 'time_and_materials')),
  contract_value      numeric(18,2) check (contract_value is null or contract_value >= 0),
  original_budget     numeric(18,2) not null default 0,
  approved_budget     numeric(18,2) not null default 0,
  site_address        text,
  site_city           text,
  site_state          text,
  latitude            numeric(9,6) check (latitude is null or (latitude between -90 and 90)),
  longitude           numeric(9,6) check (longitude is null or (longitude between -180 and 180)),
  planned_start       date,
  planned_finish      date,
  actual_start        date,
  actual_finish       date,
  project_manager_id  uuid references auth.users(id) on delete set null,
  superintendent_id   uuid references auth.users(id) on delete set null,
  retainage_percent   numeric(6,4) not null default 0 check (retainage_percent >= 0 and retainage_percent < 1),
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, number),
  constraint projects_dates check (planned_finish is null or planned_start is null or planned_finish >= planned_start)
);
create index projects_company_status_idx on projects(company_id, status);
create index projects_customer_idx on projects(customer_id) where customer_id is not null;

alter table documents add constraint documents_project_fk foreign key (project_id) references projects(id) on delete set null;
alter table rfis add constraint rfis_project_fk foreign key (project_id) references projects(id) on delete set null;
alter table production_rates add constraint production_rates_derived_project_fk
  foreign key (derived_from_project_id) references projects(id) on delete set null;

-- -----------------------------------------------------------------------------
-- Work breakdown and schedule
-- -----------------------------------------------------------------------------
create table project_tasks (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  project_id          uuid not null references projects(id) on delete cascade,
  parent_task_id      uuid references project_tasks(id) on delete cascade,
  -- The estimate line this activity was budgeted from.
  source_line_item_id uuid references estimate_line_items(id) on delete set null,
  cost_code_id        uuid references cost_codes(id) on delete set null,
  wbs_code            text,
  name                text not null,
  description         text,
  sort_order          int not null default 0,
  status              text not null default 'not_started'
                        check (status in ('not_started', 'in_progress', 'blocked', 'complete', 'canceled')),
  budgeted_quantity   numeric(18,4) not null default 0,
  unit                app.unit_code,
  installed_quantity  numeric(18,4) not null default 0,
  percent_complete    numeric(5,4) not null default 0 check (percent_complete >= 0 and percent_complete <= 1),
  budgeted_hours      numeric(14,2) not null default 0,
  actual_hours        numeric(14,2) not null default 0,
  budgeted_cost       numeric(16,2) not null default 0,
  actual_cost         numeric(16,2) not null default 0,
  planned_start       date,
  planned_finish      date,
  actual_start        date,
  actual_finish       date,
  crew_id             uuid references crews(id) on delete set null,
  is_critical_path    boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint project_tasks_no_self_parent check (parent_task_id is null or parent_task_id <> id)
);
create index project_tasks_project_idx on project_tasks(project_id, sort_order);
create index project_tasks_status_idx on project_tasks(project_id, status);

create trigger project_tasks_tenant_parent
  before insert or update on project_tasks
  for each row execute function app.enforce_tenant_parent('projects', 'project_id', 'id');

create table task_dependencies (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  predecessor_id    uuid not null references project_tasks(id) on delete cascade,
  successor_id      uuid not null references project_tasks(id) on delete cascade,
  dependency_type   text not null default 'finish_to_start'
                      check (dependency_type in ('finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish')),
  lag_days          numeric(8,2) not null default 0,
  created_at        timestamptz not null default now(),
  unique (predecessor_id, successor_id),
  constraint task_dependencies_no_self check (predecessor_id <> successor_id)
);

-- -----------------------------------------------------------------------------
-- Job cost
-- -----------------------------------------------------------------------------
create table project_costs (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  project_id          uuid not null references projects(id) on delete cascade,
  project_task_id     uuid references project_tasks(id) on delete set null,
  cost_code_id        uuid references cost_codes(id) on delete set null,
  cost_date           date not null default current_date,
  cost_type           text not null
                        check (cost_type in ('labor', 'labor_burden', 'equipment', 'fuel', 'material',
                                             'trucking', 'disposal', 'subcontract', 'indirect', 'other')),
  description         text,
  quantity            numeric(18,4) not null default 0,
  unit                app.unit_code,
  unit_cost           numeric(16,4) not null default 0,
  amount              numeric(16,2) not null,
  hours               numeric(14,4) not null default 0,
  vendor_id           uuid references vendors(id) on delete set null,
  employee_id         uuid references auth.users(id) on delete set null,
  equipment_id        uuid references equipment(id) on delete set null,
  reference           text,
  -- Where this cost came from, so imported accounting rows are distinguishable.
  source              text not null default 'manual'
                        check (source in ('manual', 'timecard', 'accounting_import', 'purchase_order', 'fuel_card', 'telematics')),
  is_committed        boolean not null default false,
  posted_at           timestamptz,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index project_costs_project_date_idx on project_costs(project_id, cost_date desc);
create index project_costs_task_idx on project_costs(project_task_id) where project_task_id is not null;
create index project_costs_type_idx on project_costs(project_id, cost_type);

create trigger project_costs_tenant_parent
  before insert or update on project_costs
  for each row execute function app.enforce_tenant_parent('projects', 'project_id', 'id');

-- -----------------------------------------------------------------------------
-- Field production — the measured truth the platform learns from
-- -----------------------------------------------------------------------------
create table daily_reports (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  project_id          uuid not null references projects(id) on delete cascade,
  report_date         date not null,
  weather_summary     text,
  temperature_f       int,
  precipitation_in    numeric(6,2) check (precipitation_in is null or precipitation_in >= 0),
  work_performed      text,
  delays              text,
  delay_hours         numeric(8,2) not null default 0 check (delay_hours >= 0),
  visitors            text,
  safety_notes        text,
  crew_count          int not null default 0 check (crew_count >= 0),
  submitted_by        uuid references auth.users(id) on delete set null,
  submitted_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (project_id, report_date)
);
create index daily_reports_project_date_idx on daily_reports(project_id, report_date desc);

/**
 * Measured production. This is the input to calibration: when actual output
 * repeatedly differs from the estimated rate under stated conditions, the
 * platform proposes a revised rate as a *candidate* for human approval.
 */
create table production_actuals (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  project_id          uuid not null references projects(id) on delete cascade,
  project_task_id     uuid references project_tasks(id) on delete set null,
  daily_report_id     uuid references daily_reports(id) on delete set null,
  -- The catalog rate this work was estimated with, so variance is computable.
  production_rate_id  uuid references production_rates(id) on delete set null,
  work_date           date not null,
  quantity_installed  numeric(18,4) not null check (quantity_installed >= 0),
  unit                app.unit_code not null,
  crew_hours          numeric(14,4) not null check (crew_hours >= 0),
  equipment_hours     numeric(14,4) not null default 0 check (equipment_hours >= 0),
  crew_size           int check (crew_size is null or crew_size > 0),
  -- Achieved rate, generated so it cannot disagree with its own inputs.
  actual_per_hour     numeric(18,6)
    generated always as (case when crew_hours > 0 then quantity_installed / crew_hours else null end) stored,
  -- Conditions, so calibration compares like with like.
  material_condition  text,
  access_condition    text,
  weather_condition   text,
  haul_distance_miles numeric(10,2),
  notes               text,
  recorded_by         uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index production_actuals_project_idx on production_actuals(project_id, work_date desc);
create index production_actuals_rate_idx on production_actuals(production_rate_id) where production_rate_id is not null;

comment on table production_actuals is
  'Measured field production. Feeds the calibration engine, which proposes revised catalog rates as approval candidates — it never edits a rate directly (RULE-008).';

-- -----------------------------------------------------------------------------
-- Change orders
-- -----------------------------------------------------------------------------
create table change_orders (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  project_id          uuid not null references projects(id) on delete cascade,
  number              text not null,
  title               text not null,
  description         text,
  reason              text not null,
  origin              text not null default 'owner_request'
                        check (origin in ('owner_request', 'design_change', 'differing_site_condition', 'error_omission', 'weather', 'other')),
  status              text not null default 'potential'
                        check (status in ('potential', 'submitted', 'approved', 'rejected', 'withdrawn', 'executed')),
  -- Priced by the same deterministic engine as the base estimate.
  estimate_version_id uuid references estimate_versions(id) on delete set null,
  cost_impact         numeric(16,2) not null default 0,
  price_impact        numeric(16,2) not null default 0,
  schedule_impact_days numeric(8,2) not null default 0,
  submitted_at        timestamptz,
  decided_at          timestamptz,
  decided_by          uuid references auth.users(id) on delete set null,
  executed_at         timestamptz,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (project_id, number),
  constraint change_orders_decision check (status not in ('approved', 'rejected') or decided_at is not null)
);
create index change_orders_project_status_idx on change_orders(project_id, status);

-- -----------------------------------------------------------------------------
-- Award: estimate version -> project
-- -----------------------------------------------------------------------------

/**
 * Converts an awarded estimate version into a project, carrying the priced
 * lines across as the budget baseline.
 *
 * Runs as SECURITY INVOKER so the caller's RLS still applies: a user who cannot
 * read the estimate version cannot award it into a project either.
 */
create or replace function app.award_estimate_version(
  p_version_id uuid,
  p_project_number text,
  p_project_name text
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_version   estimate_versions%rowtype;
  v_estimate  estimates%rowtype;
  v_project   uuid;
begin
  select * into v_version from estimate_versions where id = p_version_id;
  if not found then
    raise exception 'Estimate version % not found or not visible', p_version_id
      using errcode = 'no_data_found';
  end if;

  if v_version.status not in ('approved', 'issued', 'awarded') then
    raise exception 'Estimate version % is %; only an approved or issued version may be awarded', p_version_id, v_version.status
      using errcode = 'restrict_violation';
  end if;

  if v_version.blocked_from_issue then
    raise exception 'Estimate version % still has lines blocking issue and cannot be awarded', p_version_id
      using errcode = 'restrict_violation';
  end if;

  select * into v_estimate from estimates where id = v_version.estimate_id;

  insert into projects (
    company_id, division_id, customer_id, opportunity_id, source_estimate_version_id,
    number, name, status, contract_value, original_budget, approved_budget,
    site_address, site_city, site_state, created_by
  )
  values (
    v_version.company_id, v_estimate.division_id, v_estimate.customer_id, v_estimate.opportunity_id,
    p_version_id, p_project_number, p_project_name, 'preconstruction',
    v_version.bid_price, v_version.direct_cost + v_version.indirect_cost,
    v_version.direct_cost + v_version.indirect_cost,
    v_estimate.site_address, v_estimate.site_city, v_estimate.site_state, auth.uid()
  )
  returning id into v_project;

  -- Every priced line becomes a budgeted activity, keyed back to its source.
  insert into project_tasks (
    company_id, project_id, source_line_item_id, cost_code_id, name,
    sort_order, budgeted_quantity, unit, budgeted_hours, budgeted_cost, crew_id
  )
  select
    l.company_id, v_project, l.id, l.cost_code_id, l.description,
    l.sort_order, l.adjusted_quantity, l.unit, l.labor_hours, l.total_direct_cost, l.crew_id
  from estimate_line_items l
  where l.estimate_version_id = p_version_id
  order by l.sort_order;

  update estimates set status = 'awarded', updated_at = now() where id = v_version.estimate_id;
  update estimate_versions set status = 'awarded', updated_at = now() where id = p_version_id;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id, new_state, reason)
  values (v_version.company_id, auth.uid(), 'award', 'public.estimate_versions', p_version_id::text,
          jsonb_build_object('project_id', v_project, 'project_number', p_project_number),
          'Estimate version awarded and converted to a project');

  return v_project;
end;
$$;

grant execute on function app.award_estimate_version(uuid, text, text) to authenticated, service_role;
