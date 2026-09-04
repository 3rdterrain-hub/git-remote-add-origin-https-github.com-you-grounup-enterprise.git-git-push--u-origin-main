-- =============================================================================
-- GrounUp Enterprise — 0006 Estimating core
--
-- RULE-009 governs this file: an issued or approved estimate version is
-- immutable, and a revision creates a new version rather than editing the one a
-- bid went out from. That is enforced by trigger, not by convention.
-- =============================================================================

create table estimates (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  division_id       uuid references divisions(id) on delete set null,
  opportunity_id    uuid references opportunities(id) on delete set null,
  customer_id       uuid references customers(id) on delete set null,
  number            text not null,
  name              text not null check (length(trim(name)) between 1 and 300),
  description       text,
  -- Points at the version currently treated as authoritative.
  current_version_id uuid,
  status            app.estimate_status not null default 'draft',
  estimator_id      uuid references auth.users(id) on delete set null,
  bid_due_at        timestamptz,
  site_address      text,
  site_city         text,
  site_state        text,
  region_code       text,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, number)
);
create index estimates_company_status_idx on estimates(company_id, status);
create index estimates_opportunity_idx on estimates(opportunity_id) where opportunity_id is not null;
create index estimates_customer_idx on estimates(customer_id) where customer_id is not null;

-- -----------------------------------------------------------------------------
-- Estimate versions — the immutable unit of record
-- -----------------------------------------------------------------------------
create table estimate_versions (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  estimate_id           uuid not null references estimates(id) on delete cascade,
  version_number        int not null check (version_number >= 1),
  status                app.estimate_status not null default 'draft',
  pricing_profile_id    uuid references pricing_profiles(id) on delete set null,

  -- Estimate-level inputs.
  shift_hours           numeric(5,2) not null default 8 check (shift_hours > 0),
  calendar_efficiency   numeric(6,4) not null default 1 check (calendar_efficiency > 0 and calendar_efficiency <= 1),
  fuel_price_per_gallon numeric(10,4) not null default 0 check (fuel_price_per_gallon >= 0),
  def_price_per_gallon  numeric(10,4) not null default 0 check (def_price_per_gallon >= 0),
  swell_percent         numeric(6,4) not null default 0.25 check (swell_percent >= 0),
  shrink_percent        numeric(6,4) not null default 0.10 check (shrink_percent >= 0 and shrink_percent < 1),
  bid_rounding_increment numeric(12,2) not null default 0 check (bid_rounding_increment >= 0),

  -- Engine outputs. Written only by the deterministic engine, never by hand.
  direct_cost           numeric(18,2) not null default 0,
  cost_labor_wage       numeric(18,2) not null default 0,
  cost_labor_burden     numeric(18,2) not null default 0,
  cost_equipment        numeric(18,2) not null default 0,
  cost_equipment_mob    numeric(18,2) not null default 0,
  cost_fuel             numeric(18,2) not null default 0,
  cost_material         numeric(18,2) not null default 0,
  cost_trucking         numeric(18,2) not null default 0,
  cost_disposal         numeric(18,2) not null default 0,
  cost_subcontract      numeric(18,2) not null default 0,
  cost_other            numeric(18,2) not null default 0,
  indirect_cost         numeric(18,2) not null default 0,
  total_markup          numeric(18,2) not null default 0,
  total_price           numeric(18,2) not null default 0,
  bid_price             numeric(18,2) not null default 0,

  total_labor_hours     numeric(16,2) not null default 0,
  total_equipment_hours numeric(16,2) not null default 0,
  total_fuel_gallons    numeric(16,2) not null default 0,
  total_duration_days   numeric(12,2) not null default 0,

  weighted_confidence   numeric(5,1) not null default 0 check (weighted_confidence between 0 and 100),
  confidence_band       app.confidence_band not null default 'do_not_price',
  recommended_contingency numeric(6,4) not null default 0.12,
  applied_contingency   numeric(6,4) not null default 0.12,
  contingency_source    text not null default 'confidence_band'
                          check (contingency_source in ('confidence_band', 'profile', 'override')),
  contingency_override_reason text,
  contingency_approved_by uuid references auth.users(id) on delete set null,

  executive_decision    text not null default 'document_set_incomplete'
                          check (executive_decision in ('ready_for_estimating', 'ready_with_assumptions',
                                                        'senior_review_required', 'rfi_resolution_required',
                                                        'document_set_incomplete')),
  executive_decision_reason text,
  blocked_from_issue    boolean not null default true,

  -- Engine provenance, so a reopened estimate can be re-verified.
  engine_version        text,
  calculated_at         timestamptz,
  calculation_warnings  jsonb not null default '[]'::jsonb,

  revision_reason       text,
  issued_at             timestamptz,
  issued_by             uuid references auth.users(id) on delete set null,
  approved_at           timestamptz,
  approved_by           uuid references auth.users(id) on delete set null,
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (estimate_id, version_number),
  constraint estimate_versions_contingency_override
    check (contingency_source <> 'override' or (contingency_override_reason is not null and contingency_approved_by is not null)),
  constraint estimate_versions_issued check (status <> 'issued' or issued_at is not null)
);
create index estimate_versions_estimate_idx on estimate_versions(estimate_id, version_number desc);
create index estimate_versions_company_status_idx on estimate_versions(company_id, status);

alter table estimates
  add constraint estimates_current_version_fk
  foreign key (current_version_id) references estimate_versions(id) on delete set null;

alter table documents
  add constraint documents_estimate_fk
  foreign key (estimate_id) references estimates(id) on delete set null;

/**
 * RULE-009. Once a version is approved, issued, awarded or lost, its content is
 * frozen. Only the fields that record what happened *to* it afterwards may
 * still change, so that awarding or archiving does not require rewriting the
 * priced record.
 */
create or replace function app.enforce_version_immutability()
returns trigger
language plpgsql
as $$
declare
  v_locked   constant text[] := array['approved', 'issued', 'awarded', 'lost'];
  v_old      jsonb := to_jsonb(old);
  v_new      jsonb := to_jsonb(new);
  v_mutable  constant text[] := array[
    'status', 'updated_at', 'issued_at', 'issued_by', 'approved_at', 'approved_by',
    'awarded_at', 'lost_at'
  ];
  v_generated text[];
  k text;
begin
  if not (old.status::text = any (v_locked)) then
    return new;
  end if;

  -- PostgreSQL leaves generated columns unpopulated in a BEFORE trigger, so
  -- comparing them would report a spurious change. They cannot move on their
  -- own anyway: only their source columns can, and those are checked.
  select coalesce(array_agg(a.attname::text), '{}')
  into v_generated
  from pg_attribute a
  where a.attrelid = tg_relid and a.attnum > 0 and not a.attisdropped
    and a.attgenerated <> '';

  for k in select jsonb_object_keys(v_old) loop
    if k = any (v_mutable) or k = any (v_generated) then
      continue;
    end if;
    if (v_old -> k) is distinct from (v_new -> k) then
      raise exception
        'Estimate version % is % and immutable (RULE-009); field "%" cannot change. Create a new version instead.',
        old.id, old.status, k
        using errcode = 'restrict_violation';
    end if;
  end loop;

  -- An issued version may only move forward to a terminal commercial state.
  if new.status::text <> old.status::text
     and new.status not in ('awarded', 'lost', 'archived') then
    raise exception 'Estimate version % cannot move from % back to %', old.id, old.status, new.status
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger enforce_version_immutability
  before update on estimate_versions
  for each row execute function app.enforce_version_immutability();

-- -----------------------------------------------------------------------------
-- Estimate line items
-- -----------------------------------------------------------------------------
create table estimate_line_items (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  estimate_version_id   uuid not null references estimate_versions(id) on delete cascade,
  parent_line_id        uuid references estimate_line_items(id) on delete cascade,
  sort_order            int not null default 0,
  line_number           text,

  description           text not null check (length(trim(description)) between 1 and 500),
  service_id            uuid references services(id) on delete set null,
  assembly_id           uuid references assemblies(id) on delete set null,
  cost_code_id          uuid references cost_codes(id) on delete set null,
  discipline            text,
  bid_item_number       text,

  -- Quantity chain (Formula_Guide: measured -> adjusted -> waste/loss -> gross).
  measured_quantity     numeric(18,4) not null default 0 check (measured_quantity >= 0),
  unit                  app.unit_code not null,
  measurement_method    app.measurement_method not null default 'explicit_dimension',
  adjusted_quantity     numeric(18,4) not null default 0,
  gross_quantity        numeric(18,4) not null default 0,
  waste_percent         numeric(6,4) not null default 0 check (waste_percent >= 0 and waste_percent <= 1),
  loss_percent          numeric(6,4) not null default 0 check (loss_percent >= 0 and loss_percent <= 1),
  waste_basis           text,
  quantity_adjustments  jsonb not null default '[]'::jsonb,
  volume_state          app.volume_state,

  -- Production and duration.
  production_rate_id    uuid references production_rates(id) on delete set null,
  crew_id               uuid references crews(id) on delete set null,
  theoretical_production numeric(16,6),
  practical_production   numeric(16,6),
  recommended_production numeric(16,6),
  production_modifier   numeric(8,6) not null default 1 check (production_modifier > 0),
  controlling_resource  text,
  productive_hours      numeric(14,4) not null default 0,
  practical_days        numeric(12,2) not null default 0,

  -- Cost buckets, kept separately visible (RULE-001).
  cost_labor_wage       numeric(16,2) not null default 0,
  cost_labor_burden     numeric(16,2) not null default 0,
  cost_equipment        numeric(16,2) not null default 0,
  cost_equipment_mob    numeric(16,2) not null default 0,
  cost_fuel             numeric(16,2) not null default 0,
  cost_material         numeric(16,2) not null default 0,
  cost_trucking         numeric(16,2) not null default 0,
  cost_disposal         numeric(16,2) not null default 0,
  cost_subcontract      numeric(16,2) not null default 0,
  cost_other            numeric(16,2) not null default 0,
  total_direct_cost     numeric(16,2) not null default 0,
  unit_cost             numeric(16,4) not null default 0,

  labor_hours           numeric(14,4) not null default 0,
  equipment_hours       numeric(14,4) not null default 0,
  fuel_gallons          numeric(14,2) not null default 0,

  -- Governance.
  confidence_score      numeric(5,1) not null default 0 check (confidence_score between 0 and 100),
  confidence_band       app.confidence_band not null default 'do_not_price',
  verification_status   app.verification_status not null default 'do_not_price',
  check_primary_source  boolean not null default false,
  check_cross_source    boolean not null default false,
  check_reconciliation  boolean not null default false,
  approval_gate         app.approval_gate not null default 'estimator_review',
  approval_reasons      jsonb not null default '[]'::jsonb,
  blocks_issue          boolean not null default false,
  conflict_count        int not null default 0 check (conflict_count >= 0),
  has_open_rfi          boolean not null default false,
  documents_cannot_resolve boolean not null default false,
  material_geotech_assumption boolean not null default false,
  major_earthwork_decision boolean not null default false,

  -- Provenance.
  origin                text not null default 'human'
                          check (origin in ('human', 'ai_suggested', 'assembly', 'imported', 'copied')),
  ai_agent_id           text,
  ai_accepted_by        uuid references auth.users(id) on delete set null,
  ai_accepted_at        timestamptz,
  source_references     text[] not null default '{}',
  derivation            jsonb not null default '[]'::jsonb,
  warnings              jsonb not null default '[]'::jsonb,
  notes                 text,

  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint eli_no_self_parent check (parent_line_id is null or parent_line_id <> id),
  -- Section 31: a waste factor must carry a stated basis.
  constraint eli_waste_basis check (waste_percent = 0 or waste_basis is not null),
  -- RULE-008: an AI-suggested line cannot sit in an estimate unaccepted by a human.
  constraint eli_ai_acceptance check (origin <> 'ai_suggested' or ai_accepted_by is not null or approval_gate <> 'auto_accept')
);
create index eli_version_idx on estimate_line_items(estimate_version_id, sort_order);
create index eli_company_idx on estimate_line_items(company_id);
create index eli_service_idx on estimate_line_items(service_id) where service_id is not null;
create index eli_gate_idx on estimate_line_items(estimate_version_id, approval_gate) where blocks_issue;

-- Structural tenant guard: a line cannot attach to another company's version.
create trigger eli_tenant_parent
  before insert or update on estimate_line_items
  for each row execute function app.enforce_tenant_parent('estimate_versions', 'estimate_version_id', 'id');

-- -----------------------------------------------------------------------------
-- Line resources: the crew, equipment, material and haul attached to a line
-- -----------------------------------------------------------------------------
create table estimate_line_resources (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  line_item_id      uuid not null references estimate_line_items(id) on delete cascade,
  resource_kind     text not null check (resource_kind in ('labor', 'equipment', 'material', 'trucking', 'disposal', 'subcontract')),
  labor_rate_id     uuid references labor_rates(id) on delete set null,
  equipment_id      uuid references equipment(id) on delete set null,
  material_id       uuid references materials(id) on delete set null,
  trucking_rate_id  uuid references trucking_rates(id) on delete set null,
  disposal_site_id  uuid references disposal_sites(id) on delete set null,
  vendor_id         uuid references vendors(id) on delete set null,

  description       text,
  quantity          numeric(18,4) not null default 0 check (quantity >= 0),
  unit              app.unit_code,
  unit_rate         numeric(16,4) not null default 0 check (unit_rate >= 0),
  hours             numeric(14,4) not null default 0 check (hours >= 0),
  headcount         int check (headcount is null or headcount > 0),
  -- Which rate source won under RULE-003, retained for audit.
  rate_source       app.rate_source,
  rate_effective_date date,
  quote_reference   text,
  extended_cost     numeric(16,2) not null default 0,
  fuel_gallons      numeric(14,2) not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index elr_line_idx on estimate_line_resources(line_item_id);

create trigger elr_tenant_parent
  before insert or update on estimate_line_resources
  for each row execute function app.enforce_tenant_parent('estimate_line_items', 'line_item_id', 'id');

-- -----------------------------------------------------------------------------
-- Applied condition modifiers, with the estimator's justification
-- -----------------------------------------------------------------------------
create table estimate_line_modifiers (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  line_item_id          uuid not null references estimate_line_items(id) on delete cascade,
  condition_modifier_id uuid not null references condition_modifiers(id) on delete restrict,
  -- RULE-006 / the library's application rule: selection requires an explanation.
  justification         text not null check (length(trim(justification)) >= 10),
  applied_factors       jsonb not null default '{}'::jsonb,
  applied_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  unique (line_item_id, condition_modifier_id)
);
create index elm_line_idx on estimate_line_modifiers(line_item_id);

comment on constraint estimate_line_modifiers_justification_check on estimate_line_modifiers is
  'A condition modifier changes the price. The estimator must say why it applies, in more than a word.';

-- -----------------------------------------------------------------------------
-- Indirect cost / general conditions
-- -----------------------------------------------------------------------------
create table estimate_indirects (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  estimate_version_id uuid not null references estimate_versions(id) on delete cascade,
  code                text not null,
  label               text not null,
  amount              numeric(16,2) check (amount is null or amount >= 0),
  percent_of_direct   numeric(8,6) check (percent_of_direct is null or (percent_of_direct >= 0 and percent_of_direct <= 2)),
  per_day             numeric(14,2) check (per_day is null or per_day >= 0),
  days                numeric(10,2) check (days is null or days >= 0),
  computed_amount     numeric(16,2) not null default 0,
  basis               text,
  sort_order          int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint estimate_indirects_has_basis
    check (amount is not null or percent_of_direct is not null or (per_day is not null and days is not null))
);
create index estimate_indirects_version_idx on estimate_indirects(estimate_version_id, sort_order);

-- -----------------------------------------------------------------------------
-- Assumptions, exclusions, conflicts and RFIs
-- -----------------------------------------------------------------------------
create table estimate_assumptions (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  estimate_version_id uuid not null references estimate_versions(id) on delete cascade,
  line_item_id        uuid references estimate_line_items(id) on delete cascade,
  code                text,
  assumption          text not null,
  reason              text not null,
  supporting_reference text,
  quantity_affected   text,
  cost_impact         text,
  schedule_impact     text,
  confidence          numeric(5,1) check (confidence is null or confidence between 0 and 100),
  confirmation_method text,
  is_disclosed_to_customer boolean not null default true,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index estimate_assumptions_version_idx on estimate_assumptions(estimate_version_id);

create table estimate_exclusions (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  estimate_version_id uuid not null references estimate_versions(id) on delete cascade,
  exclusion           text not null,
  category            text,
  reason              text not null,
  sort_order          int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index estimate_exclusions_version_idx on estimate_exclusions(estimate_version_id, sort_order);

comment on column estimate_exclusions.reason is
  'Section 49: an item may not be excluded merely because it is inconvenient to estimate. The reason is required.';

create table document_conflicts (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  estimate_version_id uuid references estimate_versions(id) on delete cascade,
  line_item_id        uuid references estimate_line_items(id) on delete cascade,
  title               text not null,
  description         text not null,
  source_a            text not null,
  source_a_says       text not null,
  source_b            text not null,
  source_b_says       text not null,
  discipline          text,
  severity            text not null default 'moderate' check (severity in ('low', 'moderate', 'high', 'critical')),
  quantity_impact     boolean not null default false,
  cost_impact         boolean not null default false,
  schedule_impact     boolean not null default false,
  resolution          text,
  resolved_at         timestamptz,
  resolved_by         uuid references auth.users(id) on delete set null,
  detected_by         text not null default 'human' check (detected_by in ('human', 'ai_agent')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index document_conflicts_version_idx on document_conflicts(estimate_version_id) where resolved_at is null;

create table rfis (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  estimate_version_id uuid references estimate_versions(id) on delete set null,
  project_id          uuid,
  line_item_id        uuid references estimate_line_items(id) on delete set null,
  conflict_id         uuid references document_conflicts(id) on delete set null,
  number              text not null,
  title               text not null,
  discipline          text,
  drawing_reference   text,
  detail_reference    text,
  specification_reference text,
  existing_information text,
  question            text not null,
  recommended_clarification text,
  cost_impact         text,
  schedule_impact     text,
  construction_impact text,
  priority            text not null default 'normal' check (priority in ('low', 'normal', 'high', 'critical')),
  status              text not null default 'open' check (status in ('draft', 'open', 'answered', 'closed', 'withdrawn')),
  submitted_at        timestamptz,
  due_at              timestamptz,
  answered_at         timestamptz,
  answer              text,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, number),
  constraint rfis_answered check (status <> 'answered' or (answer is not null and answered_at is not null))
);
create index rfis_company_status_idx on rfis(company_id, status);

-- -----------------------------------------------------------------------------
-- Bid quantity reconciliation (Section 24)
-- -----------------------------------------------------------------------------
create table bid_reconciliations (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  estimate_version_id uuid not null references estimate_versions(id) on delete cascade,
  line_item_id        uuid references estimate_line_items(id) on delete set null,
  bid_item_number     text not null,
  description         text not null,
  unit                app.unit_code not null,
  owner_quantity      numeric(18,4) not null check (owner_quantity >= 0),
  calculated_quantity numeric(18,4) not null check (calculated_quantity >= 0),
  variance            numeric(18,4) not null,
  variance_percent    numeric(10,6) not null,
  severity            text not null check (severity in ('aligned', 'review', 'material')),
  explanation         text,
  recommendation      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index bid_reconciliations_version_idx on bid_reconciliations(estimate_version_id, severity);

-- -----------------------------------------------------------------------------
-- Proposals
-- -----------------------------------------------------------------------------
create table proposals (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  estimate_version_id uuid not null references estimate_versions(id) on delete cascade,
  customer_id         uuid references customers(id) on delete set null,
  number              text not null,
  title               text not null,
  template_key        text not null default 'standard',
  cover_letter        text,
  commercial_terms    text,
  payment_terms       text,
  validity_days       int not null default 30 check (validity_days > 0),
  show_line_detail    boolean not null default false,
  show_unit_prices    boolean not null default true,
  total_price         numeric(18,2) not null default 0,
  status              text not null default 'draft'
                        check (status in ('draft', 'issued', 'accepted', 'declined', 'expired', 'withdrawn')),
  storage_path        text,
  issued_at           timestamptz,
  accepted_at         timestamptz,
  accepted_by_name    text,
  declined_at         timestamptz,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, number)
);
create index proposals_company_status_idx on proposals(company_id, status);
