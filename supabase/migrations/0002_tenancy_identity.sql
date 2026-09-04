-- =============================================================================
-- GrounUp Enterprise — 0002 Tenancy and identity
--
-- The tenant boundary is `companies.id`, carried as `company_id` on every
-- business table. Enterprise groups (multi-company holdings) sit above it, and
-- divisions/offices/regions sit below it, so a contractor can grow from one
-- crew to a multi-company holding without a data migration.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enterprise group: an optional parent over several companies
-- -----------------------------------------------------------------------------
create table enterprise_groups (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) between 1 and 200),
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table enterprise_groups is
  'Optional holding entity above companies. Enables corporate standard libraries with local company overrides.';

-- -----------------------------------------------------------------------------
-- Companies — the tenant boundary
-- -----------------------------------------------------------------------------
create table companies (
  id                    uuid primary key default gen_random_uuid(),
  enterprise_group_id   uuid references enterprise_groups(id) on delete set null,
  name                  text not null check (length(trim(name)) between 1 and 200),
  slug                  text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  legal_name            text,
  tax_id                text,
  phone                 text,
  email                 text check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  website               text,
  address_line1         text,
  address_line2         text,
  city                  text,
  state_province        text,
  postal_code           text,
  country               text not null default 'US',
  timezone              text not null default 'America/New_York',
  currency              char(3) not null default 'USD',

  -- Branding (white-label): stored as storage object paths, never as blobs.
  logo_path             text,
  primary_color         text not null default '#111827' check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color          text not null default '#F6C101' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),

  -- Estimating defaults, configurable per company (the configurability principle).
  default_shift_hours          numeric(5,2) not null default 8 check (default_shift_hours > 0 and default_shift_hours <= 24),
  default_calendar_efficiency  numeric(6,4) not null default 0.85 check (default_calendar_efficiency > 0 and default_calendar_efficiency <= 1),
  default_swell_percent        numeric(6,4) not null default 0.25 check (default_swell_percent >= 0),
  default_shrink_percent       numeric(6,4) not null default 0.10 check (default_shrink_percent >= 0 and default_shrink_percent < 1),
  default_fuel_price           numeric(10,4) not null default 4.25 check (default_fuel_price >= 0),
  default_pricing_profile_id   uuid,
  bid_rounding_increment       numeric(12,2) not null default 0 check (bid_rounding_increment >= 0),

  -- Terminology overrides, e.g. {"estimate":"Bid","customer":"Client"}.
  terminology           jsonb not null default '{}'::jsonb,
  settings              jsonb not null default '{}'::jsonb,

  status                app.record_status not null default 'active',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid
);

comment on table companies is
  'The tenant boundary. Every protected business record carries company_id and is isolated by RLS.';
comment on column companies.terminology is
  'Per-company label overrides so GrounUp adapts to the company vocabulary rather than the reverse.';

create index companies_group_idx on companies(enterprise_group_id) where enterprise_group_id is not null;
create index companies_status_idx on companies(status);

-- -----------------------------------------------------------------------------
-- Divisions / offices / regions inside a company
-- -----------------------------------------------------------------------------
create table divisions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  parent_id     uuid references divisions(id) on delete set null,
  name          text not null check (length(trim(name)) between 1 and 200),
  code          text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,30}$'),
  kind          text not null default 'division'
                  check (kind in ('division', 'office', 'region', 'business_unit')),
  region_code   text,
  status        app.record_status not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, code)
);

create index divisions_company_idx on divisions(company_id);

-- -----------------------------------------------------------------------------
-- User profiles — mirrors auth.users, holds application-level identity
-- -----------------------------------------------------------------------------
create table user_profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  email             text not null,
  full_name         text,
  phone             text,
  avatar_path       text,
  job_title         text,
  default_company_id uuid references companies(id) on delete set null,
  locale            text not null default 'en-US',
  timezone          text not null default 'America/New_York',
  preferences       jsonb not null default '{}'::jsonb,
  last_seen_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table user_profiles is
  'Application profile for an authenticated user. A user is global; their access to data is granted per company through company_memberships.';

-- -----------------------------------------------------------------------------
-- Roles and permissions
-- -----------------------------------------------------------------------------
create table roles (
  id            uuid primary key default gen_random_uuid(),
  -- NULL company_id = a GrounUp system role available to every tenant.
  company_id    uuid references companies(id) on delete cascade,
  key           text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name          text not null,
  description   text,
  -- Permission keys such as 'estimates.write'. '*' grants everything.
  permissions   text[] not null default '{}',
  -- Highest approval tier this role may exercise.
  approval_tier int not null default 0 check (approval_tier between 0 and 4),
  is_system     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- A system role's key is globally unique; a company role's key is unique per company.
create unique index roles_system_key_idx on roles(key) where company_id is null;
create unique index roles_company_key_idx on roles(company_id, key) where company_id is not null;

comment on column roles.approval_tier is
  '0 none, 1 estimator, 2 senior estimator, 3 chief estimator, 4 executive. Gates which approval routing a user may satisfy.';

-- -----------------------------------------------------------------------------
-- Membership: the join that grants a user access to a company
-- -----------------------------------------------------------------------------
create table company_memberships (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role_id       uuid not null references roles(id) on delete restrict,
  division_id   uuid references divisions(id) on delete set null,
  -- Optional narrowing: when non-empty the member only sees these projects.
  project_scope uuid[] not null default '{}',
  status        text not null default 'active' check (status in ('invited', 'active', 'suspended', 'removed')),
  is_owner      boolean not null default false,
  invited_by    uuid references auth.users(id) on delete set null,
  invited_at    timestamptz,
  joined_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, user_id)
);

create index company_memberships_user_idx on company_memberships(user_id) where status = 'active';
create index company_memberships_company_idx on company_memberships(company_id) where status = 'active';

comment on table company_memberships is
  'Grants a user access to a company under exactly one role. This table is the sole source of tenant access; RLS reads it through app.current_company_ids().';

-- Every company must keep at least one owner, or it becomes unadministrable.
create or replace function app.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_company uuid := coalesce(old.company_id, new.company_id);
  v_remaining int;
begin
  select count(*) into v_remaining
  from company_memberships
  where company_id = v_company
    and is_owner
    and status = 'active'
    and id <> old.id;

  if v_remaining = 0 and (tg_op = 'DELETE' or new.is_owner = false or new.status <> 'active') then
    raise exception 'Company % must retain at least one active owner', v_company
      using errcode = 'restrict_violation';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

create trigger protect_last_owner
  before update or delete on company_memberships
  for each row when (old.is_owner)
  execute function app.protect_last_owner();

-- -----------------------------------------------------------------------------
-- Invitations
-- -----------------------------------------------------------------------------
create table company_invitations (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  email         text not null check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role_id       uuid not null references roles(id) on delete restrict,
  token_hash    text not null unique,
  invited_by    uuid not null references auth.users(id) on delete cascade,
  expires_at    timestamptz not null,
  accepted_at   timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  check (expires_at > created_at)
);

create index company_invitations_company_idx on company_invitations(company_id);
create unique index company_invitations_pending_idx
  on company_invitations(company_id, lower(email))
  where accepted_at is null and revoked_at is null;

comment on column company_invitations.token_hash is
  'SHA-256 of the invitation token. The raw token is emailed and never stored, so a database read cannot be replayed into account access.';
