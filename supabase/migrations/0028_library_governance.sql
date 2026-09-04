-- =============================================================================
-- 0028 — Library governance
--
-- P25 verification found the governance shape this platform needs was designed
-- and implemented on exactly one library. `services` carries a version, a
-- source, an origin, and the person who approved it with the time they did.
-- The other eleven three-tier libraries an estimate is priced from carried a
-- lifecycle status and nothing else, so "who published this rate", "when did it
-- take effect" and "where did it come from" could not be answered from the row.
--
-- This migration carries that shape to the rest, and adds the one thing no
-- library had: history. `services.version` is a free-text label, not a record
-- of what the row used to say.
--
-- Library snapshots (0026) already make an *estimate* reproducible by copying
-- the rows that priced it. That answers "what priced this estimate". It does
-- not answer "what did this rate say in March", which is a different question
-- and the one this migration closes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The governance columns, carried to the eleven libraries that lacked them
--
-- Added conditionally, because four of the twelve already carry part of the
-- shape and re-adding a column would fail. The names follow what is already
-- here — `effective_date` and `expires_on` are the house convention on
-- labor_rates and equipment_rates — rather than inventing a second vocabulary
-- for the same idea, which is the inconsistency this migration exists to end.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  v_libraries constant text[] := array[
    'assemblies', 'condition_modifiers', 'cost_codes', 'crews', 'equipment',
    'labor_rates', 'materials', 'pricing_profiles', 'production_rates',
    'regional_factors', 'services', 'tasks'
  ];
begin
  foreach t in array v_libraries loop
    execute format('alter table %I add column if not exists version text not null default ''1.0''', t);
    execute format('alter table %I add column if not exists source text', t);
    execute format('alter table %I add column if not exists origin text not null default ''catalog''', t);
    execute format('alter table %I add column if not exists approved_by uuid references auth.users(id) on delete set null', t);
    execute format('alter table %I add column if not exists approved_at timestamptz', t);
    execute format('alter table %I add column if not exists effective_date date not null default current_date', t);
    execute format('alter table %I add column if not exists expires_on date', t);

    -- Origin is a closed set: a row is seeded, entered by a company, proposed
    -- by an agent, or imported. Anything else is unaccounted provenance.
    execute format($f$
      alter table %I drop constraint if exists %I;
      alter table %I add constraint %I
        check (origin in ('catalog', 'company', 'ai_discovered', 'imported'))
    $f$, t, t || '_origin_known', t, t || '_origin_known');

    execute format($f$
      alter table %I drop constraint if exists %I;
      alter table %I add constraint %I
        check (expires_on is null or expires_on > effective_date)
    $f$, t, t || '_effective_window', t, t || '_effective_window');

    -- A company row that is live must name who made it live. A platform
    -- catalog row is published by GrounUp and has no company approver, which
    -- is why the rule is scoped to company-owned rows rather than applied
    -- flatly and then worked around.
    execute format($f$
      alter table %I drop constraint if exists %I;
      alter table %I add constraint %I
        check (company_id is null or status <> 'active' or approved_by is not null)
    $f$, t, t || '_active_needs_approver', t, t || '_active_needs_approver');

    -- An approval is a decision by somebody at a moment; half of one is not a
    -- record.
    execute format($f$
      alter table %I drop constraint if exists %I;
      alter table %I add constraint %I
        check ((approved_by is null) = (approved_at is null))
    $f$, t, t || '_approval_complete', t, t || '_approval_complete');
  end loop;
end $$;

-- Everything already in the platform catalog came from the seeded GrounUp
-- library. Recording that is the difference between a rate whose provenance is
-- known and one whose provenance is merely absent.
do $$
declare
  t text;
  v_libraries constant text[] := array[
    'assemblies', 'condition_modifiers', 'cost_codes', 'crews', 'equipment',
    'labor_rates', 'materials', 'pricing_profiles', 'production_rates',
    'regional_factors', 'services', 'tasks'
  ];
begin
  foreach t in array v_libraries loop
    execute format(
      'update %I set source = coalesce(source, ''GrounUp v2.0 seed library''), origin = ''catalog''
       where company_id is null and enterprise_group_id is null', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- History
--
-- The audit ledger records that a library row changed, but its read policy
-- requires a company: `audit_events_select` is `company_id is not null and
-- has_permission(...)`. Platform library rows have no company, so their audit
-- entries are readable by nobody, and an as-of question about a seeded rate
-- could not be answered from it. Hence a purpose-built history with its own
-- policy, indexed for the question it exists to answer.
-- -----------------------------------------------------------------------------
create table library_row_versions (
  id                  uuid primary key default gen_random_uuid(),
  -- Mirrors the library row: null for a platform row, which is exactly the
  -- case the audit ledger cannot serve.
  company_id          uuid references companies(id) on delete cascade,
  source_table        text not null check (source_table ~ '^[a-z_]+$'),
  source_id           uuid not null,
  version_number      int not null check (version_number >= 1),
  valid_from          timestamptz not null default now(),
  /*
   * There is no valid_to column, deliberately.
   *
   * A version ends when the next one begins, so storing the end would mean
   * updating the previous row every time — and a history that gets updated is
   * append-only only by convention. Deriving it keeps the table genuinely
   * immutable: the close-out is a window function, not a write.
   */
  operation           text not null check (operation in ('insert', 'update', 'delete')),
  payload             jsonb not null check (jsonb_typeof(payload) = 'object'),
  changed_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),

  -- A race that produced two version 3s would make the history ambiguous.
  -- Refusing one of them is better than keeping both.
  unique (source_table, source_id, version_number)
);

create index library_row_versions_asof_idx
  on library_row_versions(source_table, source_id, valid_from desc);
create index library_row_versions_current_idx
  on library_row_versions(source_table, source_id, version_number desc);

comment on table library_row_versions is
  'What every library row used to say, and when. Answers "what did this rate look like in March", which library snapshots do not: those make an estimate reproducible, this makes the library itself answerable.';

create trigger library_row_versions_immutable
  before update or delete on library_row_versions
  for each row execute function app.forbid_mutation();

/**
 * Records a new version of a library row and closes the previous one.
 *
 * Runs AFTER the write, so a rejected write leaves no history behind.
 */
create or replace function app.record_library_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row jsonb;
  v_id uuid;
  v_company uuid;
  v_next int;
  v_op text;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old); v_op := 'delete';
  else
    v_row := to_jsonb(new); v_op := lower(tg_op);
  end if;

  v_id := (v_row ->> 'id')::uuid;
  v_company := nullif(v_row ->> 'company_id', '')::uuid;

  select coalesce(max(version_number), 0) + 1 into v_next
  from library_row_versions
  where source_table = tg_table_name and source_id = v_id;

  -- A delete is recorded as a version carrying the row as it last stood, so
  -- the history says what was removed rather than merely stopping.
  insert into library_row_versions
    (company_id, source_table, source_id, version_number, valid_from, operation, payload, changed_by)
  values (v_company, tg_table_name, v_id, v_next, clock_timestamp(), v_op, v_row, auth.uid());

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

do $$
declare
  t text;
  v_libraries constant text[] := array[
    'assemblies', 'condition_modifiers', 'cost_codes', 'crews', 'equipment',
    'labor_rates', 'materials', 'pricing_profiles', 'production_rates',
    'regional_factors', 'services', 'tasks'
  ];
begin
  foreach t in array v_libraries loop
    execute format('drop trigger if exists library_version on %I', t);
    execute format(
      'create trigger library_version after insert or update or delete on %I
       for each row execute function app.record_library_version()', t);
  end loop;
end $$;

-- Everything already in the libraries becomes version 1, valid from when the
-- row was created. Without this, history would start at the next edit and the
-- current state of a seeded rate would have no version at all.
do $$
declare
  t text;
  v_libraries constant text[] := array[
    'assemblies', 'condition_modifiers', 'cost_codes', 'crews', 'equipment',
    'labor_rates', 'materials', 'pricing_profiles', 'production_rates',
    'regional_factors', 'services', 'tasks'
  ];
begin
  foreach t in array v_libraries loop
    execute format($f$
      insert into library_row_versions
        (company_id, source_table, source_id, version_number, valid_from, operation, payload)
      select r.company_id, %L, r.id, 1, coalesce(r.created_at, clock_timestamp()), 'insert', to_jsonb(r)
      from %I r
      where not exists (
        select 1 from library_row_versions v
        where v.source_table = %L and v.source_id = r.id)
    $f$, t, t, t);
  end loop;
end $$;

/**
 * What a library row said at a moment.
 *
 * The question library snapshots do not answer. SECURITY INVOKER, so it reads
 * only what the caller could read anyway.
 */
create or replace function app.library_row_as_of(
  p_table text,
  p_id uuid,
  p_at timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  -- The latest version that had begun by then. A delete version means the row
  -- said nothing at that instant, so it resolves to null rather than to the
  -- state it held before being removed.
  select case when v.operation = 'delete' then null else v.payload end
  from library_row_versions v
  where v.source_table = p_table
    and v.source_id = p_id
    and v.valid_from <= p_at
  order by v.version_number desc
  limit 1;
$$;

comment on function app.library_row_as_of(text, uuid, timestamptz) is
  'What a library row said at a given instant. Returns null when the row did not yet exist or had been deleted, which is the honest answer rather than the nearest surviving version.';

/**
 * Every version of a library row, newest first.
 */
create or replace function app.library_row_history(p_table text, p_id uuid)
returns table (
  version_number int,
  valid_from timestamptz,
  valid_to timestamptz,
  operation text,
  changed_by uuid,
  payload jsonb
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  -- valid_to is derived from the next version rather than stored, which is
  -- what lets the table stay genuinely append-only.
  select v.version_number, v.valid_from,
         lead(v.valid_from) over (order by v.version_number) as valid_to,
         v.operation, v.changed_by, v.payload
  from library_row_versions v
  where v.source_table = p_table and v.source_id = p_id
  order by v.version_number desc;
$$;

-- -----------------------------------------------------------------------------
-- RLS
--
-- A platform library row is readable by every tenant, so its history must be
-- too — otherwise the seeded rates an estimate is priced from would have a past
-- nobody could see. That is precisely the gap in the audit ledger this table
-- exists to fill, so the policy is written by hand rather than generated.
-- -----------------------------------------------------------------------------
alter table library_row_versions enable row level security;
alter table library_row_versions force row level security;

create policy library_row_versions_select on library_row_versions
  for select to authenticated
  using (company_id is null or app.is_member(company_id));

-- Written only by the trigger, which runs as definer. No tenant role inserts
-- history directly: a history somebody can write by hand is not a history.
create policy library_row_versions_no_insert on library_row_versions
  for insert to authenticated with check (false);

grant select on library_row_versions to authenticated;
revoke all on library_row_versions from anon;


-- -----------------------------------------------------------------------------
-- Provisioning
--
-- `app.provision_company` creates a company's default pricing profile, which is
-- now subject to the rule that a live company row names its approver. The
-- definition below is the one from migration 0011 with a single insert changed;
-- it is restated here rather than edited in place because the columns it now
-- sets do not exist until this migration has run.
-- -----------------------------------------------------------------------------
create or replace function app.provision_company(
  p_name text,
  p_slug text,
  p_plan_id text default 'starter'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_user    uuid := auth.uid();
  v_owner_role uuid;
  v_profile uuid;
  v_trial_days int;
begin
  if v_user is null then
    raise exception 'provision_company requires an authenticated user'
      using errcode = 'insufficient_privilege';
  end if;

  select id into v_owner_role from roles where company_id is null and key = 'owner';
  if v_owner_role is null then
    raise exception 'System role "owner" is missing; migrations are incomplete';
  end if;

  insert into companies (name, slug, created_by) values (p_name, p_slug, v_user)
  returning id into v_company;

  insert into company_memberships (company_id, user_id, role_id, status, is_owner, joined_at)
  values (v_company, v_user, v_owner_role, 'active', true, now());

  -- Default pricing profile, so the first estimate can be priced immediately.
  --
  -- The founding user is recorded as its approver. A live company row must name
  -- who made it live (migration 0028), and for this row that person is the one
  -- who created the company with these defaults — which is accurate, not a way
  -- around the constraint.
  insert into pricing_profiles (company_id, code, name, method, is_default, region,
                                origin, approved_by, approved_at)
  values (v_company, 'PP-DEFAULT', 'Company Default', 'parallel', true, null,
          'company', v_user, now());

  insert into markup_components (company_id, pricing_profile_id, code, label, percent, basis, sequence)
  select v_company, p.id, c.code, c.label, c.percent, 'profile_default', c.sequence
  from pricing_profiles p,
       (values ('OH', 'Overhead', 0.10, 10),
               ('PROFIT', 'Profit', 0.12, 20),
               ('CONT', 'Contingency', 0.03, 30)) as c(code, label, percent, sequence)
  where p.company_id = v_company and p.code = 'PP-DEFAULT';

  update companies
  set default_pricing_profile_id = (select id from pricing_profiles where company_id = v_company and code = 'PP-DEFAULT')
  where id = v_company;

  -- Start the plan's trial. Entitlement is provisional until Stripe confirms,
  -- and `valid_until` bounds it so an unpaid trial cannot run forever.
  select trial_days into v_trial_days from plans where id = p_plan_id;
  insert into entitlements (company_id, plan_id, is_active, features, max_seats,
                            max_active_estimates, max_active_projects, storage_gb,
                            ai_credits_per_month, valid_until, source)
  select v_company, pl.id, coalesce(v_trial_days, 0) > 0, pl.features, pl.max_seats,
         pl.max_active_estimates, pl.max_active_projects, pl.storage_gb,
         pl.ai_credits_per_month,
         case when coalesce(v_trial_days, 0) > 0 then now() + (v_trial_days || ' days')::interval end,
         'trial'
  from plans pl where pl.id = p_plan_id;

  select id into v_profile from user_profiles where id = v_user;
  if v_profile is not null then
    update user_profiles set default_company_id = v_company where id = v_user and default_company_id is null;
  end if;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id, new_state, reason)
  values (v_company, v_user, 'insert', 'public.companies', v_company::text,
          jsonb_build_object('name', p_name, 'slug', p_slug, 'plan', p_plan_id),
          'Company provisioned');

  return v_company;
end;
$$;

select app.assert_security_gates();
