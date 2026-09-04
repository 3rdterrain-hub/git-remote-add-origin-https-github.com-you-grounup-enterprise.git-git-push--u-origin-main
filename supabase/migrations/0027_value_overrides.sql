-- =============================================================================
-- 0027 — Value overrides
--
-- Every engine in this platform computes a number, and sometimes a person has
-- to change it: a superintendent knows the haul road is worse than the model
-- says, a principal has to hit a number to stay in a bid. That is legitimate.
-- Pretending otherwise does not stop it happening — it pushes the change
-- somewhere the platform cannot see, into a spreadsheet, or into a library rate
-- quietly edited to make one line come out right.
--
-- So an override is a record rather than an edit. The computed value is kept
-- beside the new one, a reason is required, and somebody other than the
-- requester approves it.
-- =============================================================================

create table value_overrides (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,

  -- What was overridden. Not a foreign key, because the same mechanism has to
  -- serve estimate versions, pay applications, schedule activities and
  -- whatever comes next without a column per table.
  entity_table        text not null check (entity_table ~ '^[a-z_]+$'),
  entity_id           uuid not null,
  -- Which value, e.g. `lines.L-001.directCost.labor`.
  field_path          text not null check (length(trim(field_path)) > 0),
  value_kind          text not null
                        check (value_kind in ('money', 'quantity', 'factor', 'hours', 'days', 'text')),

  -- The engine's figure, retained. Overwriting it would destroy the evidence of
  -- what the platform actually computed, which is the only thing that makes the
  -- override reviewable.
  original_value      jsonb not null,
  override_value      jsonb not null,

  reason              text not null check (length(trim(reason)) >= 12),
  requested_by        uuid not null references auth.users(id) on delete restrict,
  approved_by         uuid not null references auth.users(id) on delete restrict,
  approved_at         timestamptz not null default now(),
  created_at          timestamptz not null default now(),

  -- Segregation of duties, the same rule the approval tiers run on. An override
  -- the requester can approve is not a control.
  constraint value_overrides_not_self_approved check (requested_by <> approved_by),
  -- An override that equals the computed value changes nothing and should not
  -- be a record.
  constraint value_overrides_changes_something check (original_value <> override_value),
  -- One override per value. Two would make it arbitrary which governs a number
  -- somebody is bidding.
  unique (entity_table, entity_id, field_path)
);
create index value_overrides_entity_idx on value_overrides(entity_table, entity_id);
create index value_overrides_company_idx on value_overrides(company_id, approved_at desc);

comment on table value_overrides is
  'A person overriding a computed value, recorded rather than applied. The engine figure is retained beside the override, a reason is required, and the requester cannot approve their own.';

comment on constraint value_overrides_not_self_approved on value_overrides is
  'Segregation of duties. An override the requester can approve is not a control, it is a comment.';

-- -----------------------------------------------------------------------------
-- Immutability
--
-- An override is a decision somebody made at a moment. Changing it later
-- rewrites the record of that decision; a different decision is a new override
-- after the old one is withdrawn.
-- -----------------------------------------------------------------------------
create trigger value_overrides_immutable
  before update on value_overrides
  for each row execute function app.forbid_mutation();

/**
 * The overridden value must belong to the same company as the override.
 *
 * RLS keeps a user inside their own company, but a user who legitimately
 * belongs to two could otherwise attach an override to the other company's
 * estimate. This is the same structural guard the rest of the schema uses.
 */
create or replace function app.enforce_override_entity_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_owner uuid;
begin
  -- Only tables that actually exist and carry a company_id may be overridden.
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = new.entity_table
      and column_name = 'company_id'
  ) then
    raise exception
      'Cannot record an override against %, which is not a company-owned table in this schema.',
      new.entity_table
      using errcode = 'foreign_key_violation';
  end if;

  execute format('select company_id from public.%I where id = $1', new.entity_table)
    into v_owner using new.entity_id;

  if v_owner is null then
    raise exception 'Cannot record an override against %.% because that row does not exist.',
      new.entity_table, new.entity_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_owner <> new.company_id then
    raise exception
      'Override company % does not match the owner of %.% (%). An override cannot cross a tenant boundary.',
      new.company_id, new.entity_table, new.entity_id, v_owner
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

create trigger value_overrides_tenant_guard
  before insert on value_overrides
  for each row execute function app.enforce_override_entity_tenant();

/**
 * Every override recorded against a row, for showing an overridden figure with
 * the fact that it was overridden.
 *
 * SECURITY INVOKER, so it can only read what the caller could read anyway.
 */
create or replace function app.overrides_for(p_table text, p_entity uuid)
returns table (
  field_path text,
  value_kind text,
  original_value jsonb,
  override_value jsonb,
  reason text,
  approved_by uuid,
  approved_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select o.field_path, o.value_kind, o.original_value, o.override_value,
         o.reason, o.approved_by, o.approved_at
  from value_overrides o
  where o.entity_table = p_table and o.entity_id = p_entity
  order by o.field_path;
$$;

comment on function app.overrides_for(text, uuid) is
  'The overrides on a row. A number that silently differs from its own derivation is the most dangerous thing an estimate can contain, so the interface reads this alongside the computed figures.';

-- -----------------------------------------------------------------------------
-- RLS and grants
-- -----------------------------------------------------------------------------
select app.apply_tenant_rls('value_overrides', null, 'estimates.approve');

select app.assert_security_gates();
