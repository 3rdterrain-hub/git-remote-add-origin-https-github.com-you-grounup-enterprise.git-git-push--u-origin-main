-- =============================================================================
-- GrounUp Enterprise — 0023 Survey, machine control, claims, network and API
--
-- SVC-MARKET (as a subcontractor and vendor network), plus the remaining spec
-- phases: GIS/survey/reality capture (16), machine control (17), contract and
-- claims (19), the semantic layer (29) and the public API.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Surfaces and reality capture (Phase 16)
-- -----------------------------------------------------------------------------
create table surveys (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  project_id          uuid not null references projects(id) on delete cascade,
  name                text not null,
  capture_method      text not null default 'gps_rover'
                        check (capture_method in ('gps_rover', 'total_station', 'drone_photogrammetry',
                                                  'lidar', 'design_model', 'as_built', 'imported')),
  captured_on         date not null,
  captured_by         text,
  -- Datum and units, because a volume computed across two different vertical
  -- datums is wrong by the offset between them and looks perfectly plausible.
  horizontal_datum    text not null default 'NAD83',
  vertical_datum      text not null default 'NAVD88',
  coordinate_system   text,
  units               text not null default 'us_survey_feet'
                        check (units in ('us_survey_feet', 'international_feet', 'meters')),
  point_count         int check (point_count is null or point_count >= 0),
  area_sf             numeric(18,2) check (area_sf is null or area_sf >= 0),
  storage_path        text,
  notes               text,
  status              app.record_status not null default 'active',
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index surveys_project_idx on surveys(project_id, captured_on desc);

create trigger surveys_tenant_parent
  before insert or update on surveys
  for each row execute function app.enforce_tenant_parent('projects', 'project_id', 'id');

comment on column surveys.vertical_datum is
  'A volume computed between two surfaces on different vertical datums is wrong by the offset and looks entirely plausible. The comparison refuses when these disagree.';

create table surfaces (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  survey_id           uuid not null references surveys(id) on delete cascade,
  name                text not null,
  surface_role        text not null
                        check (surface_role in ('existing', 'design', 'as_built', 'stockpile_base', 'stockpile', 'subgrade')),
  cell_size_ft        numeric(8,3) not null check (cell_size_ft > 0),
  grid_rows           int not null check (grid_rows > 0),
  grid_cols           int not null check (grid_cols > 0),
  -- Row-major elevations. Held as jsonb so a modest grid round-trips without a
  -- separate object fetch; larger grids live in storage and carry a path.
  elevations          jsonb,
  storage_path        text,
  min_elevation       numeric(12,4),
  max_elevation       numeric(12,4),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint surfaces_has_data check (elevations is not null or storage_path is not null)
);
create index surfaces_survey_idx on surfaces(survey_id);

create trigger surfaces_tenant_parent
  before insert or update on surfaces
  for each row execute function app.enforce_tenant_parent('surveys', 'survey_id', 'id');

create table surface_comparisons (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  project_id          uuid not null references projects(id) on delete cascade,
  existing_surface_id uuid not null references surfaces(id) on delete cascade,
  design_surface_id   uuid not null references surfaces(id) on delete cascade,
  name                text not null,
  computed_at         timestamptz not null default now(),

  -- Engine output. Bank for cut, compacted for fill, as the engine reports them.
  cut_bcy             numeric(18,4) not null default 0,
  fill_ccy            numeric(18,4) not null default 0,
  net_bcy             numeric(18,4) not null default 0,
  cut_area_sf         numeric(18,2) not null default 0,
  fill_area_sf        numeric(18,2) not null default 0,
  max_cut_depth_ft    numeric(10,3),
  max_fill_depth_ft   numeric(10,3),
  average_cut_depth_ft numeric(10,3),
  average_fill_depth_ft numeric(10,3),
  cells_compared      int not null default 0,
  cells_skipped       int not null default 0,
  coverage            numeric(6,4) not null default 0 check (coverage >= 0 and coverage <= 1),
  engine_version      text,
  warnings            jsonb not null default '[]'::jsonb,
  -- The estimate line this measured volume was carried into, if any.
  applied_line_item_id uuid references estimate_line_items(id) on delete set null,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint surface_comparisons_distinct check (existing_surface_id <> design_surface_id)
);
create index surface_comparisons_project_idx on surface_comparisons(project_id, computed_at desc);

create trigger surface_comparisons_tenant_parent
  before insert or update on surface_comparisons
  for each row execute function app.enforce_tenant_parent('projects', 'project_id', 'id');

/** A volume computed across mismatched datums is wrong and looks plausible. */
create or replace function app.enforce_surface_datum_match()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_a record;
  v_b record;
begin
  select sv.vertical_datum, sv.units, s.cell_size_ft, s.grid_rows, s.grid_cols
  into v_a from surfaces s join surveys sv on sv.id = s.survey_id where s.id = new.existing_surface_id;

  select sv.vertical_datum, sv.units, s.cell_size_ft, s.grid_rows, s.grid_cols
  into v_b from surfaces s join surveys sv on sv.id = s.survey_id where s.id = new.design_surface_id;

  if v_a.vertical_datum is distinct from v_b.vertical_datum then
    raise exception
      'Surfaces are on different vertical datums (% and %). The volume between them would be wrong by the datum offset.',
      v_a.vertical_datum, v_b.vertical_datum
      using errcode = 'check_violation';
  end if;
  if v_a.units is distinct from v_b.units then
    raise exception 'Surfaces use different units (% and %).', v_a.units, v_b.units
      using errcode = 'check_violation';
  end if;
  if v_a.cell_size_ft is distinct from v_b.cell_size_ft
     or v_a.grid_rows is distinct from v_b.grid_rows
     or v_a.grid_cols is distinct from v_b.grid_cols then
    raise exception 'Surfaces must share a grid; resample one onto the other before comparing.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger enforce_surface_datum_match
  before insert or update on surface_comparisons
  for each row execute function app.enforce_surface_datum_match();

-- -----------------------------------------------------------------------------
-- Machine control (Phase 17)
-- -----------------------------------------------------------------------------
create table machine_control_files (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  project_id          uuid not null references projects(id) on delete cascade,
  surface_id          uuid references surfaces(id) on delete set null,
  name                text not null,
  file_format         text not null
                        check (file_format in ('ttm', 'dxf', 'xml_landxml', 'gc3', 'svd', 'csv_points')),
  vendor              text check (vendor in ('trimble', 'topcon', 'leica', 'komatsu', 'caterpillar', 'other')),
  version             int not null default 1 check (version >= 1),
  storage_path        text not null,
  checksum_sha256     text check (checksum_sha256 is null or checksum_sha256 ~ '^[a-f0-9]{64}$'),
  -- Publishing sends a design to the machines. A superseded file left live on a
  -- dozer is how a crew builds last week's grade.
  published_at        timestamptz,
  published_by        uuid references auth.users(id) on delete set null,
  superseded_by_id    uuid references machine_control_files(id) on delete set null,
  status              text not null default 'draft'
                        check (status in ('draft', 'published', 'superseded', 'withdrawn')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint mc_published check (status <> 'published' or (published_at is not null and published_by is not null)),
  constraint mc_superseded check (status <> 'superseded' or superseded_by_id is not null)
);
create index mc_files_project_idx on machine_control_files(project_id, status);

create trigger mc_files_tenant_parent
  before insert or update on machine_control_files
  for each row execute function app.enforce_tenant_parent('projects', 'project_id', 'id');

comment on constraint mc_superseded on machine_control_files is
  'A superseded design must name its replacement, so an operator can always be told which file is current.';

create table machine_assignments (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  asset_id            uuid not null references assets(id) on delete cascade,
  machine_control_file_id uuid not null references machine_control_files(id) on delete cascade,
  assigned_at         timestamptz not null default now(),
  assigned_by         uuid references auth.users(id) on delete set null,
  acknowledged_at     timestamptz,
  is_current          boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index machine_assignments_current_idx on machine_assignments(asset_id) where is_current;

create trigger machine_assignments_tenant_parent
  before insert or update on machine_assignments
  for each row execute function app.enforce_tenant_parent('assets', 'asset_id', 'id');

-- -----------------------------------------------------------------------------
-- Contracts and claims (Phase 19)
-- -----------------------------------------------------------------------------
create table contracts (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  project_id          uuid not null references projects(id) on delete cascade,
  customer_id         uuid references customers(id) on delete set null,
  number              text not null,
  title               text not null,
  contract_type       text not null default 'lump_sum'
                        check (contract_type in ('lump_sum', 'unit_price', 'cost_plus', 'gmp', 'time_and_materials')),
  original_value      numeric(18,2) not null default 0 check (original_value >= 0),
  executed_on         date,
  substantial_completion_on date,
  final_completion_on date,
  -- The clauses a claim will be argued under. Held as dates and days rather
  -- than prose so a notice deadline can actually be computed.
  notice_days         int check (notice_days is null or notice_days >= 0),
  claim_days          int check (claim_days is null or claim_days >= 0),
  liquidated_damages_per_day numeric(14,2) check (liquidated_damages_per_day is null or liquidated_damages_per_day >= 0),
  retainage_percent   numeric(6,4) not null default 0.05 check (retainage_percent >= 0 and retainage_percent < 1),
  status              text not null default 'draft'
                        check (status in ('draft', 'executed', 'active', 'closed', 'terminated')),
  storage_path        text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, number),
  constraint contracts_executed check (status = 'draft' or executed_on is not null)
);
create index contracts_project_idx on contracts(project_id);

create trigger contracts_tenant_parent
  before insert or update on contracts
  for each row execute function app.enforce_tenant_parent('projects', 'project_id', 'id');

create table claims (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  project_id          uuid not null references projects(id) on delete cascade,
  contract_id         uuid references contracts(id) on delete set null,
  number              text not null,
  title               text not null,
  claim_type          text not null
                        check (claim_type in ('differing_site_condition', 'delay', 'acceleration',
                                              'disruption', 'changed_scope', 'suspension',
                                              'defective_documents', 'payment', 'other')),
  description         text not null,

  -- The two dates that decide most construction claims before their merits do.
  event_date          date not null,
  notice_given_on     date,
  notice_due_on       date,
  claim_submitted_on  date,
  claim_due_on        date,

  cost_claimed        numeric(18,2) not null default 0 check (cost_claimed >= 0),
  time_claimed_days   numeric(8,2) not null default 0 check (time_claimed_days >= 0),
  cost_awarded        numeric(18,2) check (cost_awarded is null or cost_awarded >= 0),
  time_awarded_days   numeric(8,2) check (time_awarded_days is null or time_awarded_days >= 0),

  -- The contemporaneous records a claim actually rests on.
  supporting_daily_reports uuid[] not null default '{}',
  supporting_rfis     uuid[] not null default '{}',
  supporting_documents uuid[] not null default '{}',

  status              text not null default 'potential'
                        check (status in ('potential', 'notice_given', 'submitted', 'negotiating',
                                          'settled', 'denied', 'withdrawn', 'litigation')),
  resolution          text,
  resolved_on         date,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, number),
  constraint claims_notice check (status = 'potential' or notice_given_on is not null),
  constraint claims_resolved
    check (status not in ('settled', 'denied') or (resolved_on is not null and resolution is not null)),
  constraint claims_notice_order check (notice_given_on is null or notice_given_on >= event_date)
);
create index claims_project_idx on claims(project_id, status);
create index claims_notice_due_idx on claims(company_id, notice_due_on)
  where status = 'potential' and notice_due_on is not null;

comment on constraint claims_notice on claims is
  'A claim cannot advance past "potential" without a notice date. Most construction claims are lost on the notice clause rather than on their merits, and this is the field that records whether the deadline was met.';

/** Derives the notice and claim deadlines from the contract's own clauses. */
create or replace function app.derive_claim_deadlines()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_notice_days int;
  v_claim_days int;
begin
  if new.contract_id is null then
    return new;
  end if;
  select notice_days, claim_days into v_notice_days, v_claim_days
  from contracts where id = new.contract_id;

  if v_notice_days is not null and new.notice_due_on is null then
    new.notice_due_on := new.event_date + v_notice_days;
  end if;
  if v_claim_days is not null and new.claim_due_on is null then
    new.claim_due_on := new.event_date + v_claim_days;
  end if;
  return new;
end;
$$;

create trigger derive_claim_deadlines
  before insert or update of event_date, contract_id on claims
  for each row execute function app.derive_claim_deadlines();

-- -----------------------------------------------------------------------------
-- GrounUp Network — subcontractor and vendor network
-- -----------------------------------------------------------------------------

/**
 * A vendor's opt-in public profile, discoverable across companies.
 *
 * The listing is separate from the tenant's own `vendors` row on purpose: a
 * company's private notes, rates and performance scores stay private, and only
 * what the vendor itself agreed to publish is visible to anyone else.
 */
create table network_vendors (
  id                  uuid primary key default gen_random_uuid(),
  -- The company that created and maintains this listing.
  owner_company_id    uuid not null references companies(id) on delete cascade,
  vendor_id           uuid references vendors(id) on delete set null,
  legal_name          text not null,
  display_name        text not null,
  trades              text[] not null default '{}',
  service_regions     text[] not null default '{}',
  city                text,
  state_province      text,
  website             text,
  contact_email       text,
  contact_phone       text,
  -- Published only with the vendor's consent; without it the listing is private.
  is_published        boolean not null default false,
  published_at        timestamptz,
  consent_recorded_by uuid references auth.users(id) on delete set null,
  consent_recorded_at timestamptz,
  -- Compliance, which is the reason a contractor looks a sub up at all.
  insurance_expires_on date,
  bonding_capacity    numeric(18,2) check (bonding_capacity is null or bonding_capacity >= 0),
  is_dbe              boolean not null default false,
  is_mbe              boolean not null default false,
  is_wbe              boolean not null default false,
  certifications      text[] not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Publishing another company's details without recorded consent is the one
  -- thing a vendor directory must never do.
  constraint network_vendors_consent
    check (not is_published or (consent_recorded_by is not null and consent_recorded_at is not null))
);
create index network_vendors_published_idx on network_vendors(is_published) where is_published;
create index network_vendors_trades_idx on network_vendors using gin (trades);
create index network_vendors_name_idx on network_vendors using gin (display_name gin_trgm_ops);

comment on constraint network_vendors_consent on network_vendors is
  'A listing cannot be published without a recorded consent and the person who recorded it. Publishing a subcontractor''s details because you happen to have them is not a product feature.';

/**
 * A performance rating one company left for a vendor.
 *
 * Ratings are attributed and immutable once left, because an anonymous or
 * editable rating is worth nothing to the contractor reading it. A company may
 * rate a given vendor once per project.
 */
create table network_ratings (
  id                  uuid primary key default gen_random_uuid(),
  network_vendor_id   uuid not null references network_vendors(id) on delete cascade,
  rating_company_id   uuid not null references companies(id) on delete cascade,
  project_id          uuid references projects(id) on delete set null,
  quality             int not null check (quality between 1 and 5),
  schedule            int not null check (schedule between 1 and 5),
  safety              int not null check (safety between 1 and 5),
  communication       int not null check (communication between 1 and 5),
  would_hire_again    boolean not null,
  overall             numeric(3,2) generated always as
                        ((quality + schedule + safety + communication)::numeric / 4) stored,
  comment             text,
  contract_value      numeric(18,2) check (contract_value is null or contract_value >= 0),
  rated_by            uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  /*
   * One rating per company, per vendor, per project.
   *
   * NULLS NOT DISTINCT matters here: by default PostgreSQL treats two NULL
   * project ids as different values, which would let one company leave
   * unlimited ratings for the same vendor simply by not attaching a project.
   */
  constraint network_ratings_one_per_project
    unique nulls not distinct (network_vendor_id, rating_company_id, project_id)
);
create index network_ratings_vendor_idx on network_ratings(network_vendor_id);

-- A rating is a statement of record. It is not editable after the fact.
create trigger network_ratings_immutable
  before update on network_ratings
  for each row execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Public API keys (Phase 20 / the 19 API domains)
-- -----------------------------------------------------------------------------
create table api_keys (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  name                text not null,
  -- SHA-256 of the key. The key itself is shown once at creation and never
  -- stored, so a database read cannot be replayed against the API.
  key_hash            text not null unique check (key_hash ~ '^[a-f0-9]{64}$'),
  key_prefix          text not null check (key_prefix ~ '^gu_[a-z]{4}_[A-Za-z0-9]{8}$'),
  scopes              text[] not null default '{}',
  -- Requests per minute. A key with no limit is a denial-of-service waiting to
  -- happen against your own database.
  rate_limit_per_minute int not null default 120 check (rate_limit_per_minute between 1 and 10000),
  expires_at          timestamptz,
  last_used_at        timestamptz,
  request_count       bigint not null default 0 check (request_count >= 0),
  revoked_at          timestamptz,
  revoked_by          uuid references auth.users(id) on delete set null,
  revoke_reason       text,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint api_keys_scopes_not_empty check (cardinality(scopes) > 0),
  constraint api_keys_revoked check (revoked_at is null or revoke_reason is not null)
);
create index api_keys_company_idx on api_keys(company_id) where revoked_at is null;

comment on column api_keys.key_hash is
  'SHA-256 only. The key is displayed once at creation and never stored, so reading this table yields nothing that can authenticate.';

create table api_requests (
  id                  bigint generated always as identity primary key,
  company_id          uuid not null references companies(id) on delete cascade,
  api_key_id          uuid references api_keys(id) on delete set null,
  method              text not null,
  path                text not null,
  status_code         int not null,
  duration_ms         int check (duration_ms is null or duration_ms >= 0),
  ip_address          inet,
  user_agent          text,
  error_code          text,
  occurred_at         timestamptz not null default now()
);
create index api_requests_company_time_idx on api_requests(company_id, occurred_at desc);
create index api_requests_key_idx on api_requests(api_key_id, occurred_at desc);

-- -----------------------------------------------------------------------------
-- Semantic layer (Phase 29)
-- -----------------------------------------------------------------------------

/**
 * Named metric definitions.
 *
 * The point of a semantic layer is that "gross margin" means one thing across
 * every dashboard, export and API consumer. A metric defined in three places
 * drifts into three numbers, and then nobody trusts any of them.
 */
create table metric_definitions (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid references companies(id) on delete cascade,
  key                 text not null check (key ~ '^[a-z][a-z0-9_]{2,60}$'),
  name                text not null,
  description         text not null,
  domain              text not null,
  unit                text not null default 'number'
                        check (unit in ('number', 'currency', 'percent', 'hours', 'days', 'count', 'ratio')),
  -- The SQL expression, kept as text and executed only through the reporting
  -- view layer — never interpolated into a user-facing query.
  expression          text not null,
  grain               text not null default 'company'
                        check (grain in ('company', 'division', 'project', 'estimate', 'customer', 'employee', 'asset')),
  higher_is_better    boolean,
  target_value        numeric(18,4),
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index metric_definitions_company_key_idx on metric_definitions(company_id, key) where company_id is not null;
create unique index metric_definitions_global_key_idx on metric_definitions(key) where company_id is null;
