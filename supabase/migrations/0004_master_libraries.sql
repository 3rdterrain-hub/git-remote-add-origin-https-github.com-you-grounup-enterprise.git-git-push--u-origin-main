-- =============================================================================
-- GrounUp Enterprise — 0004 Master libraries
--
-- Library scope is three-tiered, which is what lets a holding company publish a
-- corporate standard while a subsidiary keeps a local override:
--
--   company_id set        -> owned by one company, editable by that company
--   enterprise_group_id set -> corporate standard, shared across the group
--   both null             -> GrounUp global seed, readable by everyone, writable by no tenant
--
-- `app.library_scope_check` enforces that at most one is set. RLS in 0010 grants
-- read across all three tiers and write only to the tiers the user administers.
-- =============================================================================

create or replace function app.library_scope_valid(p_company uuid, p_group uuid)
returns boolean
language sql
immutable
as $$
  select num_nulls(p_company, p_group) >= 1;
$$;

comment on function app.library_scope_valid is
  'True unless a library row claims both a company and an enterprise group, which would make its scope ambiguous.';

-- -----------------------------------------------------------------------------
-- Cost codes
-- -----------------------------------------------------------------------------
create table cost_codes (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid references companies(id) on delete cascade,
  enterprise_group_id uuid references enterprise_groups(id) on delete cascade,
  code                text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,30}$'),
  name                text not null,
  division            text,
  parent_id           uuid references cost_codes(id) on delete set null,
  status              app.record_status not null default 'active',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint cost_codes_scope check (app.library_scope_valid(company_id, enterprise_group_id))
);
create unique index cost_codes_company_code_idx on cost_codes(company_id, code) where company_id is not null;
create unique index cost_codes_global_code_idx on cost_codes(code) where company_id is null and enterprise_group_id is null;

-- -----------------------------------------------------------------------------
-- Services — what the company sells
-- -----------------------------------------------------------------------------
create table services (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid references companies(id) on delete cascade,
  enterprise_group_id   uuid references enterprise_groups(id) on delete cascade,
  code                  text not null,
  name                  text not null check (length(trim(name)) between 1 and 300),
  industry              text,
  industry_pack_id      text,
  category              text,
  subcategory           text,
  description           text,
  default_unit          app.unit_code not null default 'LS',
  supported_units       app.unit_code[] not null default '{LS}',
  pricing_method        text not null default 'Assembly/Task Rollup',
  default_assembly_id   uuid,
  cost_code_id          uuid references cost_codes(id) on delete set null,
  status                app.record_status not null default 'active',
  version               text not null default '1.0',
  source                text,
  -- Provenance for a service an AI agent proposed and a human approved.
  origin                text not null default 'catalog'
                          check (origin in ('catalog', 'company', 'ai_discovered', 'imported')),
  approved_by           uuid references auth.users(id) on delete set null,
  approved_at           timestamptz,
  search_text           text generated always as (coalesce(name,'') || ' ' || coalesce(category,'') || ' ' || coalesce(subcategory,'')) stored,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint services_scope check (app.library_scope_valid(company_id, enterprise_group_id)),
  constraint services_default_unit_supported check (default_unit = any (supported_units))
);
create unique index services_company_code_idx on services(company_id, code) where company_id is not null;
create unique index services_global_code_idx on services(code) where company_id is null and enterprise_group_id is null;
create index services_search_idx on services using gin (search_text gin_trgm_ops);
create index services_category_idx on services(category, subcategory);

comment on column services.origin is
  'A service discovered by AI enters as ai_discovered and must be approved by a human before it can price work (RULE-008).';

-- -----------------------------------------------------------------------------
-- Tasks and methods — the granular work inside a service
-- -----------------------------------------------------------------------------
create table tasks (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid references companies(id) on delete cascade,
  enterprise_group_id   uuid references enterprise_groups(id) on delete cascade,
  code                  text not null,
  name                  text not null,
  category              text,
  default_unit          app.unit_code not null default 'LS',
  default_method_code   text,
  production_required   boolean not null default true,
  crew_required         boolean not null default true,
  equipment_required    boolean not null default true,
  material_required     boolean not null default false,
  safety_review_required boolean not null default false,
  quality_review_required boolean not null default false,
  status                app.record_status not null default 'active',
  version               text not null default '1.0',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint tasks_scope check (app.library_scope_valid(company_id, enterprise_group_id))
);
create unique index tasks_company_code_idx on tasks(company_id, code) where company_id is not null;
create unique index tasks_global_code_idx on tasks(code) where company_id is null and enterprise_group_id is null;
create index tasks_category_idx on tasks(category);

-- -----------------------------------------------------------------------------
-- Labor
-- -----------------------------------------------------------------------------
create table labor_rates (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid references companies(id) on delete cascade,
  enterprise_group_id   uuid references enterprise_groups(id) on delete cascade,
  code                  text not null,
  classification        text not null,
  labor_group           text,
  base_wage_per_hour    numeric(12,4) not null check (base_wage_per_hour >= 0),
  burden_percent        numeric(6,4) not null default 0 check (burden_percent >= 0 and burden_percent <= 3),
  overtime_multiplier   numeric(5,3) not null default 1.5 check (overtime_multiplier >= 1),
  doubletime_multiplier numeric(5,3) not null default 2.0 check (doubletime_multiplier >= 1),
  -- Generated so the loaded rate can never drift from its inputs.
  burdened_cost_per_hour numeric(14,4)
    generated always as (base_wage_per_hour * (1 + burden_percent)) stored,
  pricing_profile       text,
  region                text,
  is_union              boolean not null default false,
  effective_date        date not null default current_date,
  expires_on            date,
  status                app.record_status not null default 'active',
  approval_state        app.approval_state not null default 'not_required',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint labor_rates_scope check (app.library_scope_valid(company_id, enterprise_group_id)),
  constraint labor_rates_dates check (expires_on is null or expires_on > effective_date)
);
create unique index labor_rates_company_code_idx on labor_rates(company_id, code, effective_date) where company_id is not null;
create unique index labor_rates_global_code_idx on labor_rates(code, effective_date) where company_id is null and enterprise_group_id is null;

comment on column labor_rates.burdened_cost_per_hour is
  'Generated column: base x (1 + burden). Stored so it cannot be edited independently of its inputs.';

-- -----------------------------------------------------------------------------
-- Equipment and its rate sheets
-- -----------------------------------------------------------------------------
create table equipment (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid references companies(id) on delete cascade,
  enterprise_group_id   uuid references enterprise_groups(id) on delete cascade,
  code                  text not null,
  name                  text not null,
  equipment_class       text,
  ownership_type        text not null default 'owned'
                          check (ownership_type in ('owned', 'rented', 'leased', 'either')),
  planned_hours_per_day numeric(5,2) not null default 8 check (planned_hours_per_day > 0 and planned_hours_per_day <= 24),
  fuel_gallons_per_hour numeric(8,3) not null default 0 check (fuel_gallons_per_hour >= 0),
  def_percent_of_fuel   numeric(6,4) not null default 0 check (def_percent_of_fuel >= 0 and def_percent_of_fuel <= 1),
  operator_required     boolean not null default true,
  mobilization_required boolean not null default false,
  mobilization_cost     numeric(12,2) check (mobilization_cost is null or mobilization_cost >= 0),
  status                app.record_status not null default 'active',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint equipment_scope check (app.library_scope_valid(company_id, enterprise_group_id))
);
create unique index equipment_company_code_idx on equipment(company_id, code) where company_id is not null;
create unique index equipment_global_code_idx on equipment(code) where company_id is null and enterprise_group_id is null;

/**
 * One row per (equipment, rate source). RULE-003 resolves the winner in
 * precedence order; every candidate is kept so the estimate can show what was
 * overridden and why.
 */
create table equipment_rates (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid references companies(id) on delete cascade,
  equipment_id    uuid not null references equipment(id) on delete cascade,
  source          app.rate_source not null,
  hourly_rate     numeric(12,4) not null check (hourly_rate >= 0),
  daily_rate      numeric(12,2) check (daily_rate is null or daily_rate >= 0),
  weekly_rate     numeric(12,2) check (weekly_rate is null or weekly_rate >= 0),
  monthly_rate    numeric(12,2) check (monthly_rate is null or monthly_rate >= 0),
  region          text,
  vendor_id       uuid,
  reference       text,
  effective_date  date not null default current_date,
  expires_on      date,
  approval_state  app.approval_state not null default 'not_required',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint equipment_rates_dates check (expires_on is null or expires_on > effective_date)
);
create index equipment_rates_lookup_idx on equipment_rates(equipment_id, source, effective_date desc);

-- -----------------------------------------------------------------------------
-- Crews
-- -----------------------------------------------------------------------------
create table crews (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid references companies(id) on delete cascade,
  enterprise_group_id   uuid references enterprise_groups(id) on delete cascade,
  code                  text not null,
  name                  text not null,
  discipline            text,
  shift_hours           numeric(5,2) not null default 8 check (shift_hours > 0 and shift_hours <= 24),
  status                app.record_status not null default 'active',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint crews_scope check (app.library_scope_valid(company_id, enterprise_group_id))
);
create unique index crews_company_code_idx on crews(company_id, code) where company_id is not null;
create unique index crews_global_code_idx on crews(code) where company_id is null and enterprise_group_id is null;

create table crew_members (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid references companies(id) on delete cascade,
  crew_id                  uuid not null references crews(id) on delete cascade,
  labor_rate_id            uuid not null references labor_rates(id) on delete restrict,
  headcount                int not null default 1 check (headcount > 0 and headcount <= 200),
  straight_hours_per_shift numeric(5,2) check (straight_hours_per_shift is null or straight_hours_per_shift >= 0),
  overtime_hours_per_shift numeric(5,2) not null default 0 check (overtime_hours_per_shift >= 0),
  doubletime_hours_per_shift numeric(5,2) not null default 0 check (doubletime_hours_per_shift >= 0),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (crew_id, labor_rate_id)
);
create index crew_members_crew_idx on crew_members(crew_id);

-- -----------------------------------------------------------------------------
-- Assemblies — reusable rollups of tasks and resources
-- -----------------------------------------------------------------------------
create table assemblies (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid references companies(id) on delete cascade,
  enterprise_group_id   uuid references enterprise_groups(id) on delete cascade,
  code                  text not null,
  name                  text not null,
  service_id            uuid references services(id) on delete set null,
  assembly_type         text not null default 'Standard',
  quantity_unit         app.unit_code not null default 'LS',
  description           text,
  supports_nested       boolean not null default true,
  supports_options      boolean not null default true,
  status                app.record_status not null default 'active',
  version               text not null default '1.0',
  origin                text not null default 'catalog'
                          check (origin in ('catalog', 'company', 'ai_discovered', 'imported')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint assemblies_scope check (app.library_scope_valid(company_id, enterprise_group_id))
);
create unique index assemblies_company_code_idx on assemblies(company_id, code) where company_id is not null;
create unique index assemblies_global_code_idx on assemblies(code) where company_id is null and enterprise_group_id is null;

alter table services
  add constraint services_default_assembly_fk
  foreign key (default_assembly_id) references assemblies(id) on delete set null;

create table assembly_components (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid references companies(id) on delete cascade,
  assembly_id       uuid not null references assemblies(id) on delete cascade,
  sort_order        int not null default 0,
  component_kind    text not null
                      check (component_kind in ('task', 'labor', 'equipment', 'material', 'assembly', 'subcontract', 'trucking')),
  task_id           uuid references tasks(id) on delete set null,
  labor_rate_id     uuid references labor_rates(id) on delete set null,
  equipment_id      uuid references equipment(id) on delete set null,
  material_id       uuid,
  nested_assembly_id uuid references assemblies(id) on delete set null,
  -- Quantity of this component per one unit of the parent assembly.
  quantity_per_unit numeric(16,6) not null default 1 check (quantity_per_unit >= 0),
  unit              app.unit_code,
  is_optional       boolean not null default false,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- A component must reference exactly the entity its kind names.
  constraint assembly_components_reference check (
    (component_kind = 'task'        and task_id is not null) or
    (component_kind = 'labor'       and labor_rate_id is not null) or
    (component_kind = 'equipment'   and equipment_id is not null) or
    (component_kind = 'material'    and material_id is not null) or
    (component_kind = 'assembly'    and nested_assembly_id is not null) or
    (component_kind in ('subcontract', 'trucking'))
  ),
  constraint assembly_components_no_self_nest check (nested_assembly_id is null or nested_assembly_id <> assembly_id)
);
create index assembly_components_assembly_idx on assembly_components(assembly_id, sort_order);

-- -----------------------------------------------------------------------------
-- Materials
-- -----------------------------------------------------------------------------
create table materials (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid references companies(id) on delete cascade,
  enterprise_group_id   uuid references enterprise_groups(id) on delete cascade,
  code                  text not null,
  name                  text not null,
  category              text,
  unit                  app.unit_code not null default 'EA',
  unit_cost             numeric(14,4) not null default 0 check (unit_cost >= 0),
  -- Default waste for this material. Section 31 requires a stated basis.
  default_waste_percent numeric(6,4) not null default 0 check (default_waste_percent >= 0 and default_waste_percent <= 1),
  waste_basis           text,
  density_lb_per_cy     numeric(10,3) check (density_lb_per_cy is null or density_lb_per_cy > 0),
  specification         text,
  vendor_id             uuid,
  quote_reference       text,
  quote_date            date,
  status                app.record_status not null default 'active',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint materials_scope check (app.library_scope_valid(company_id, enterprise_group_id)),
  -- Section 31: a waste factor without a reason is not allowed to ship.
  constraint materials_waste_basis check (default_waste_percent = 0 or waste_basis is not null)
);
create unique index materials_company_code_idx on materials(company_id, code) where company_id is not null;
create unique index materials_global_code_idx on materials(code) where company_id is null and enterprise_group_id is null;
create index materials_name_idx on materials using gin (name gin_trgm_ops);

alter table assembly_components
  add constraint assembly_components_material_fk
  foreign key (material_id) references materials(id) on delete set null;

-- -----------------------------------------------------------------------------
-- Production rates
-- -----------------------------------------------------------------------------
create table production_rates (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid references companies(id) on delete cascade,
  enterprise_group_id   uuid references enterprise_groups(id) on delete cascade,
  code                  text not null,
  task_id               uuid references tasks(id) on delete cascade,
  service_id            uuid references services(id) on delete set null,
  crew_id               uuid references crews(id) on delete set null,
  method_code           text,
  rate_per_hour         numeric(16,6) not null check (rate_per_hour > 0),
  rate_unit             app.unit_code not null,
  utilization_factor    numeric(6,4) not null default 0.83 check (utilization_factor > 0 and utilization_factor <= 1.5),
  shift_hours           numeric(5,2) not null default 8 check (shift_hours > 0 and shift_hours <= 24),
  -- Generated so the shift figure the estimator reads always matches the inputs.
  daily_rate            numeric(20,6)
    generated always as (rate_per_hour * utilization_factor * shift_hours) stored,
  equipment_spread      text,
  controlling_resource  text,
  material_condition    text,
  access_condition      text,
  weather_condition     text,
  region                text,
  source_type           app.production_source not null default 'seed_benchmark',
  confidence_score      numeric(4,3) not null default 0.5 check (confidence_score >= 0 and confidence_score <= 1),
  sample_size           int not null default 0 check (sample_size >= 0),
  approval_state        app.approval_state not null default 'not_required',
  status                app.record_status not null default 'active',
  effective_date        date not null default current_date,
  -- Calibration lineage: which measured job produced this rate.
  derived_from_project_id uuid,
  superseded_by_id      uuid references production_rates(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint production_rates_scope check (app.library_scope_valid(company_id, enterprise_group_id)),
  -- RULE-010: anything other than a company actual must carry a real sample or be flagged low confidence.
  constraint production_rates_provenance check (
    source_type <> 'company_actual' or sample_size > 0
  )
);
create unique index production_rates_company_code_idx on production_rates(company_id, code) where company_id is not null;
create unique index production_rates_global_code_idx on production_rates(code) where company_id is null and enterprise_group_id is null;
create index production_rates_task_idx on production_rates(task_id) where status = 'active';
create index production_rates_service_idx on production_rates(service_id) where status = 'active';

comment on constraint production_rates_provenance on production_rates is
  'A rate cannot claim to be a company actual without at least one measured job behind it.';

-- -----------------------------------------------------------------------------
-- Condition modifiers
-- -----------------------------------------------------------------------------
create table condition_modifiers (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid references companies(id) on delete cascade,
  enterprise_group_id   uuid references enterprise_groups(id) on delete cascade,
  code                  text not null,
  name                  text not null,
  category              text,
  -- Explicit factor per target, e.g. {"production":0.75,"labor_cost":1.15}.
  factors               jsonb not null,
  application_rule      text not null,
  status                app.record_status not null default 'active',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint condition_modifiers_scope check (app.library_scope_valid(company_id, enterprise_group_id)),
  constraint condition_modifiers_factors_object check (jsonb_typeof(factors) = 'object' and factors <> '{}'::jsonb)
);
create unique index condition_modifiers_company_code_idx on condition_modifiers(company_id, code) where company_id is not null;
create unique index condition_modifiers_global_code_idx on condition_modifiers(code) where company_id is null and enterprise_group_id is null;

/** Every factor must name a real target and be a positive number. */
create or replace function app.validate_modifier_factors()
returns trigger
language plpgsql
as $$
declare
  k text;
  v jsonb;
begin
  for k, v in select * from jsonb_each(new.factors) loop
    begin
      perform k::app.modifier_target;
    exception when invalid_text_representation then
      raise exception 'Condition modifier % declares unknown target "%"', new.code, k
        using errcode = 'check_violation';
    end;
    if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <= 0 then
      raise exception 'Condition modifier % target "%" must be a positive number, got %', new.code, k, v
        using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end;
$$;

create trigger validate_modifier_factors
  before insert or update of factors on condition_modifiers
  for each row execute function app.validate_modifier_factors();

-- -----------------------------------------------------------------------------
-- Pricing profiles and markup components
-- -----------------------------------------------------------------------------
create table pricing_profiles (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid references companies(id) on delete cascade,
  enterprise_group_id   uuid references enterprise_groups(id) on delete cascade,
  code                  text not null,
  name                  text not null,
  method                app.markup_method not null default 'parallel',
  labor_profile         text,
  equipment_profile     text,
  region                text,
  regional_factor       numeric(8,4) not null default 1 check (regional_factor > 0),
  escalation_percent    numeric(6,4) not null default 0 check (escalation_percent >= 0),
  escalation_years      numeric(5,2) not null default 0 check (escalation_years >= 0),
  is_default            boolean not null default false,
  status                app.record_status not null default 'active',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint pricing_profiles_scope check (app.library_scope_valid(company_id, enterprise_group_id))
);
create unique index pricing_profiles_company_code_idx on pricing_profiles(company_id, code) where company_id is not null;
create unique index pricing_profiles_global_code_idx on pricing_profiles(code) where company_id is null and enterprise_group_id is null;
-- At most one default profile per company.
create unique index pricing_profiles_one_default_idx on pricing_profiles(company_id) where is_default and company_id is not null;

alter table companies
  add constraint companies_default_pricing_profile_fk
  foreign key (default_pricing_profile_id) references pricing_profiles(id) on delete set null;

create table markup_components (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid references companies(id) on delete cascade,
  pricing_profile_id  uuid not null references pricing_profiles(id) on delete cascade,
  code                text not null check (code ~ '^[A-Z][A-Z0-9_]{0,20}$'),
  label               text not null,
  percent             numeric(8,6) not null check (percent >= 0 and percent <= 5),
  basis               text not null default 'profile_default'
                        check (basis in ('profile_default', 'direct_cost', 'direct_plus_indirect', 'running_total', 'marked_up_total')),
  sequence            int not null default 10,
  disclosed           boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (pricing_profile_id, code)
);
create index markup_components_profile_idx on markup_components(pricing_profile_id, sequence);

-- -----------------------------------------------------------------------------
-- Regional factors
-- -----------------------------------------------------------------------------
create table regional_factors (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid references companies(id) on delete cascade,
  enterprise_group_id uuid references enterprise_groups(id) on delete cascade,
  region_code         text not null,
  region_name         text not null,
  labor_factor        numeric(8,4) not null default 1 check (labor_factor > 0),
  equipment_factor    numeric(8,4) not null default 1 check (equipment_factor > 0),
  material_factor     numeric(8,4) not null default 1 check (material_factor > 0),
  overall_factor      numeric(8,4) not null default 1 check (overall_factor > 0),
  effective_date      date not null default current_date,
  status              app.record_status not null default 'active',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint regional_factors_scope check (app.library_scope_valid(company_id, enterprise_group_id))
);
create unique index regional_factors_company_idx on regional_factors(company_id, region_code, effective_date) where company_id is not null;

-- -----------------------------------------------------------------------------
-- Vendors, disposal sites and trucking rates
-- -----------------------------------------------------------------------------
create table vendors (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  code              text not null,
  name              text not null,
  vendor_type       text not null default 'supplier'
                      check (vendor_type in ('supplier', 'subcontractor', 'trucking', 'disposal', 'rental', 'service')),
  contact_name      text,
  email             text,
  phone             text,
  address_line1     text,
  city              text,
  state_province    text,
  postal_code       text,
  tax_id            text,
  insurance_expires_on date,
  is_qualified      boolean not null default false,
  performance_score numeric(4,2) check (performance_score is null or (performance_score >= 0 and performance_score <= 5)),
  notes             text,
  status            app.record_status not null default 'active',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, code)
);
create index vendors_company_type_idx on vendors(company_id, vendor_type) where status = 'active';

alter table materials add constraint materials_vendor_fk foreign key (vendor_id) references vendors(id) on delete set null;
alter table equipment_rates add constraint equipment_rates_vendor_fk foreign key (vendor_id) references vendors(id) on delete set null;

create table disposal_sites (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  code              text not null,
  name              text not null,
  vendor_id         uuid references vendors(id) on delete set null,
  material_types    text[] not null default '{}',
  tipping_fee       numeric(12,4) not null default 0 check (tipping_fee >= 0),
  fee_unit          app.unit_code not null default 'TON',
  address_line1     text,
  city              text,
  state_province    text,
  latitude          numeric(9,6) check (latitude is null or (latitude between -90 and 90)),
  longitude         numeric(9,6) check (longitude is null or (longitude between -180 and 180)),
  accepts_contaminated boolean not null default false,
  status            app.record_status not null default 'active',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, code)
);

create table trucking_rates (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  code              text not null,
  name              text not null,
  truck_type        text not null default 'tandem',
  capacity          numeric(12,4) not null check (capacity > 0),
  capacity_unit     app.unit_code not null default 'CY',
  hourly_rate       numeric(12,4) not null check (hourly_rate >= 0),
  -- Kept for preliminary pricing only; RULE-004 makes the cycle authoritative.
  preliminary_unit_rate numeric(12,4) check (preliminary_unit_rate is null or preliminary_unit_rate >= 0),
  load_minutes      numeric(8,3) check (load_minutes is null or load_minutes >= 0),
  dump_minutes      numeric(8,3) not null default 2 check (dump_minutes >= 0),
  delay_minutes     numeric(8,3) not null default 0 check (delay_minutes >= 0),
  loaded_speed_mph  numeric(6,2) not null default 30 check (loaded_speed_mph > 0),
  empty_speed_mph   numeric(6,2) not null default 35 check (empty_speed_mph > 0),
  vendor_id         uuid references vendors(id) on delete set null,
  status            app.record_status not null default 'active',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, code)
);

comment on column trucking_rates.preliminary_unit_rate is
  'Shortcut $/unit haul rate. RULE-004 marks any estimate priced from this as preliminary until a cycle analysis replaces it.';
