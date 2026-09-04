-- =============================================================================
-- GrounUp Enterprise — 0001 Foundation
-- Extensions, the `app` helper schema, shared enums and shared trigger functions.
--
-- Everything tenant-scoped in this database inherits from the primitives here.
-- The `app` schema holds SECURITY DEFINER helpers that RLS policies call; it is
-- deliberately not exposed through PostgREST.
-- =============================================================================

create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "pg_trgm";       -- fuzzy search on catalog names
create extension if not exists "btree_gist";    -- exclusion constraints on ranges

create schema if not exists app;
comment on schema app is
  'Internal helper functions and types for GrounUp. Not exposed via the API; called by RLS policies and triggers.';

revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Shared enums
-- -----------------------------------------------------------------------------

create type app.record_status as enum ('draft', 'active', 'inactive', 'archived', 'retired');

create type app.approval_state as enum ('not_required', 'pending', 'approved', 'rejected', 'withdrawn');

create type app.confidence_band as enum ('verified', 'strong', 'reliable', 'assumption', 'uncertain', 'do_not_price');

create type app.approval_gate as enum ('auto_accept', 'estimator_review', 'senior_review', 'rfi_required');

create type app.verification_status as enum (
  'verified', 'high_confidence', 'moderate_confidence', 'low_confidence', 'do_not_price'
);

create type app.measurement_method as enum (
  'explicit_dimension', 'verified_scale', 'approximate_scale', 'calculated',
  'derived', 'schedule_quantity', 'owner_quantity', 'estimator_allowance'
);

create type app.production_source as enum (
  'company_actual', 'company_historical', 'regional_benchmark',
  'seed_benchmark', 'manufacturer', 'estimator_judgment'
);

create type app.rate_source as enum ('project_quote', 'tenant_approved', 'regional', 'global_seed');

create type app.markup_method as enum ('parallel', 'stacked');

create type app.estimate_status as enum (
  'draft', 'in_review', 'approved', 'issued', 'awarded', 'lost', 'archived'
);

create type app.unit_code as enum (
  'LS', 'EA', 'LF', 'SF', 'SY', 'CY', 'TON', 'HR', 'DAY', 'ACRE', 'GAL', 'LB', 'MO', 'WK'
);

create type app.volume_state as enum ('BCY', 'LCY', 'CCY');

create type app.modifier_target as enum (
  'production', 'labor_cost', 'equipment_cost', 'material_cost',
  'trucking_cost', 'disposal_cost', 'indirect_cost', 'schedule', 'risk'
);

create type app.subscription_status as enum (
  'trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused'
);

create type app.audit_action as enum (
  'insert', 'update', 'delete', 'approve', 'reject', 'issue', 'award',
  'login', 'permission_change', 'export', 'ai_suggestion', 'ai_accepted', 'ai_rejected'
);

-- -----------------------------------------------------------------------------
-- Shared trigger functions
-- -----------------------------------------------------------------------------

create or replace function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function app.set_updated_at is
  'Maintains updated_at on every UPDATE. Attached by app.attach_standard_triggers.';

/**
 * Blocks any UPDATE or DELETE. Used on the audit ledger and on issued estimate
 * versions, where RULE-009 requires immutability: a correction creates a new
 * version, it never rewrites the record a bid was sent from.
 */
create or replace function app.forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'Table %.% is append-only; % is not permitted. Create a new version instead.',
    tg_table_schema, tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

/**
 * Rejects a row whose company_id does not match the company_id of the parent
 * row it points at.
 *
 * RLS alone does not prevent a user who legitimately belongs to two companies
 * from attaching company A's estimate line to company B's estimate. This
 * trigger closes that gap structurally, and is applied to every child table
 * that carries both a company_id and a parent reference.
 *
 * Arguments: parent_table, parent_key_column_on_this_row, parent_pk_column.
 */
create or replace function app.enforce_tenant_parent()
returns trigger
language plpgsql
as $$
declare
  v_parent_table  text := tg_argv[0];
  v_fk_column     text := tg_argv[1];
  v_parent_pk     text := tg_argv[2];
  v_fk_value      uuid;
  v_parent_company uuid;
  v_row           jsonb := to_jsonb(new);
begin
  v_fk_value := (v_row ->> v_fk_column)::uuid;
  if v_fk_value is null then
    return new;
  end if;

  execute format('select company_id from %s where %I = $1', v_parent_table, v_parent_pk)
    into v_parent_company
    using v_fk_value;

  if v_parent_company is null then
    raise exception 'Parent row %.% = % was not found', v_parent_table, v_parent_pk, v_fk_value
      using errcode = 'foreign_key_violation';
  end if;

  if v_parent_company <> new.company_id then
    raise exception
      'Tenant boundary violation: % row belongs to company %, but its parent %.% belongs to company %',
      tg_table_name, new.company_id, v_parent_table, v_fk_value, v_parent_company
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;
