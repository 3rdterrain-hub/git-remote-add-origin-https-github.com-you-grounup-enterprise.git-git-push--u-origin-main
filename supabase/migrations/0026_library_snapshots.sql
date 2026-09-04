-- =============================================================================
-- 0026 — Library snapshots
--
-- An estimate is priced from library rows, and those rows keep moving: wages
-- settle, fuel changes, a supplier requotes. Before this migration an estimate
-- referenced them live, and two things went wrong silently.
--
--   * Editing a rate changed what an already *issued* estimate said it cost.
--     The number a customer was shown was no longer the number the system held.
--   * Reopening an old estimate priced it against today's library, with nothing
--     to say it had happened.
--
-- A snapshot fixes both by copying the rows in rather than pointing at them.
-- Copying matters: a referenced row can be edited or deleted, and a deleted
-- rate would leave an old estimate unreproducible at exactly the moment
-- somebody needs to defend it to an owner.
-- =============================================================================

create table library_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  estimate_version_id uuid not null references estimate_versions(id) on delete cascade,
  captured_at         timestamptz not null default now(),
  captured_by         uuid references auth.users(id) on delete set null,
  -- Which build priced with these rows, so a re-price can say whether the
  -- engine changed as well as the library.
  engine_version      text not null,
  entry_count         int not null default 0 check (entry_count >= 0),
  -- Content digest over the entries. A drift check, not a tamper control: the
  -- immutability triggers below are what make tampering impossible.
  digest              text not null check (digest ~ '^[0-9a-f]{16}$'),
  created_at          timestamptz not null default now(),
  -- One snapshot per estimate version. Two would make it ambiguous which one
  -- priced it, which defeats the purpose.
  unique (estimate_version_id)
);
create index library_snapshots_company_idx on library_snapshots(company_id, captured_at desc);

comment on table library_snapshots is
  'The library rows an estimate version was priced from, copied rather than referenced so the estimate stays reproducible when the library moves or a row is deleted.';

create table library_snapshot_entries (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  snapshot_id         uuid not null references library_snapshots(id) on delete cascade,
  kind                text not null
                        check (kind in ('labor_rate', 'equipment', 'equipment_rate', 'crew',
                                        'production_rate', 'material', 'assembly',
                                        'condition_modifier', 'pricing_profile', 'regional_factor',
                                        'cost_code', 'service', 'task', 'trucking_rate',
                                        'disposal_site')),
  -- The library row's id, so drift can be checked against the live row. Not a
  -- foreign key: the whole point is that the snapshot outlives the row.
  source_id           uuid not null,
  -- The row's updated_at when it was captured, so drift is reportable.
  source_updated_at   timestamptz not null,
  -- Which tier the row was read at. A company override and the platform row it
  -- overrode are different rows, and the estimate has to record which priced it.
  scope               text not null check (scope in ('platform', 'group', 'company')),
  payload             jsonb not null,
  created_at          timestamptz not null default now(),
  -- One capture per library row per snapshot.
  unique (snapshot_id, kind, source_id),
  constraint library_snapshot_entries_payload_object check (jsonb_typeof(payload) = 'object')
);
create index library_snapshot_entries_snapshot_idx on library_snapshot_entries(snapshot_id, kind);
create index library_snapshot_entries_source_idx on library_snapshot_entries(kind, source_id);

comment on column library_snapshot_entries.source_id is
  'Deliberately not a foreign key. A snapshot must survive the deletion of the library row it captured, or an old estimate stops being reproducible the moment someone tidies the catalog.';

-- -----------------------------------------------------------------------------
-- Immutability
--
-- A snapshot that can be edited is not a snapshot. Both tables refuse UPDATE
-- and DELETE outright; a re-price captures a new snapshot against a new
-- estimate version rather than rewriting this one.
-- -----------------------------------------------------------------------------
create trigger library_snapshots_immutable
  before update or delete on library_snapshots
  for each row execute function app.forbid_mutation();

create trigger library_snapshot_entries_immutable
  before update or delete on library_snapshot_entries
  for each row execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Binding to the estimate version
-- -----------------------------------------------------------------------------
alter table estimate_versions
  add column library_snapshot_id uuid references library_snapshots(id) on delete restrict;

comment on column estimate_versions.library_snapshot_id is
  'The snapshot this version was priced from. Required before a version may be issued: an issued price the platform cannot reproduce is not a record of anything.';

/**
 * An issued version must carry the snapshot that priced it.
 *
 * Enforced as a trigger rather than a CHECK because the snapshot is created
 * after the version row exists — it references the version — so the constraint
 * has to be evaluated at the moment of issue rather than on every write.
 */
create or replace function app.enforce_issued_version_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.status in ('issued', 'approved', 'awarded') and new.library_snapshot_id is null then
    raise exception
      'Estimate version % cannot be % without a library snapshot. An issued price the platform cannot reproduce is not a record of anything.',
      new.id, new.status
      using errcode = 'check_violation';
  end if;

  -- The snapshot must belong to this version, not merely exist. Pointing a
  -- version at another version's snapshot would reproduce the wrong estimate.
  if new.library_snapshot_id is not null and not exists (
    select 1 from library_snapshots s
    where s.id = new.library_snapshot_id
      and s.estimate_version_id = new.id
      and s.company_id = new.company_id
  ) then
    raise exception
      'Library snapshot % does not belong to estimate version % in this company.',
      new.library_snapshot_id, new.id
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

create trigger estimate_versions_snapshot_required
  before insert or update on estimate_versions
  for each row execute function app.enforce_issued_version_snapshot();

-- -----------------------------------------------------------------------------
-- Drift reporting
-- -----------------------------------------------------------------------------

/**
 * What has changed in the live library since a snapshot was taken.
 *
 * Answers the question somebody asks before re-issuing an old estimate: has
 * anything it was priced with moved, and how. A row the snapshot holds that no
 * longer exists is reported as deleted rather than silently skipped — the
 * estimate is still reproducible, because the row was copied in, but whoever
 * re-prices it should know.
 */
create or replace function app.snapshot_drift(p_snapshot_id uuid)
returns table (
  kind text,
  source_id uuid,
  status text,
  snapshot_updated_at timestamptz,
  live_updated_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = public, pg_catalog
as $$
declare
  r record;
  v_live timestamptz;
  v_exists boolean;
begin
  for r in
    select e.kind, e.source_id, e.source_updated_at
    from library_snapshot_entries e
    where e.snapshot_id = p_snapshot_id
    order by e.kind, e.source_id
  loop
    -- The live row lives in a different table per kind, so the lookup is
    -- dynamic. Only the kind values the CHECK constraint permits reach here.
    execute format(
      'select exists (select 1 from %I where id = $1), (select updated_at from %I where id = $1)',
      case r.kind
        when 'labor_rate' then 'labor_rates'
        when 'equipment' then 'equipment'
        when 'equipment_rate' then 'equipment_rates'
        when 'crew' then 'crews'
        when 'production_rate' then 'production_rates'
        when 'material' then 'materials'
        when 'assembly' then 'assemblies'
        when 'condition_modifier' then 'condition_modifiers'
        when 'pricing_profile' then 'pricing_profiles'
        when 'regional_factor' then 'regional_factors'
        when 'cost_code' then 'cost_codes'
        when 'service' then 'services'
        when 'task' then 'tasks'
        when 'trucking_rate' then 'trucking_rates'
        when 'disposal_site' then 'disposal_sites'
      end,
      case r.kind
        when 'labor_rate' then 'labor_rates'
        when 'equipment' then 'equipment'
        when 'equipment_rate' then 'equipment_rates'
        when 'crew' then 'crews'
        when 'production_rate' then 'production_rates'
        when 'material' then 'materials'
        when 'assembly' then 'assemblies'
        when 'condition_modifier' then 'condition_modifiers'
        when 'pricing_profile' then 'pricing_profiles'
        when 'regional_factor' then 'regional_factors'
        when 'cost_code' then 'cost_codes'
        when 'service' then 'services'
        when 'task' then 'tasks'
        when 'trucking_rate' then 'trucking_rates'
        when 'disposal_site' then 'disposal_sites'
      end)
    into v_exists, v_live
    using r.source_id;

    kind := r.kind;
    source_id := r.source_id;
    snapshot_updated_at := r.source_updated_at;
    live_updated_at := v_live;
    status := case
      when not v_exists then 'deleted'
      when v_live is distinct from r.source_updated_at then 'changed'
      else 'unchanged'
    end;
    return next;
  end loop;
end;
$$;

comment on function app.snapshot_drift(uuid) is
  'Reports which library rows have moved since a snapshot was taken. SECURITY INVOKER, so it can only read rows the caller could read anyway.';

-- -----------------------------------------------------------------------------
-- RLS and grants
-- -----------------------------------------------------------------------------
select app.apply_tenant_rls('library_snapshots', null, 'estimates.write');
select app.apply_tenant_rls('library_snapshot_entries', null, 'estimates.write');

select app.assert_security_gates();
