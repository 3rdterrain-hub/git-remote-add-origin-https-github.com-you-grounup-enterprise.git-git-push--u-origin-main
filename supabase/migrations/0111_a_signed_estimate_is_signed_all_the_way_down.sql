-- =============================================================================
-- 0111 — A signed estimate is signed all the way down
--
-- RULE-009 freezes an approved version, and migration 0006 enforces it with a
-- trigger on `estimate_versions`. Its children have been protected by
-- convention: `app.add_estimate_line`, `app.update_estimate_line` and
-- `app.save_line_resource` each check the version's status, and each of them
-- checks it because somebody remembered to write the check.
--
-- Two paths never did.
--
--   * **`app.apply_takeoff_to_line`** has no status check at all. A measurement
--     retraced on a drawing could land a new quantity on a line of an approved
--     estimate — changing what was signed off without changing its status.
--
--   * **A direct update.** `measured_quantity` is not an engine-owned column,
--     so row level security lets a member write it through PostgREST. The
--     estimating screen does exactly that when somebody edits a quantity; it
--     hides the field on a frozen version, and hiding a field is a decision
--     made by display code.
--
-- Enforcement belongs in the database, where every path meets. This is the same
-- correction 0108 made for resources, applied to the two tables it left out and
-- to the direct route that goes around all of them.
-- =============================================================================

/**
 * Refuse a change to a version that has been signed off.
 *
 * Reads the version's status rather than taking it as an argument, so it can
 * be attached to anything that hangs off a version and cannot be told the
 * wrong answer.
 *
 * `security definer` because the caller may hold no direct select on
 * `estimate_versions` in every path that reaches here, and a guard that
 * silently passes when it cannot read is not a guard.
 */
create or replace function app.refuse_when_version_frozen()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_version uuid;
  v_status  app.estimate_status;
begin
  /*
   * The version this row belongs to. Named by the trigger argument so one
   * function serves the line table, its resources and its modifiers — each of
   * which reaches the version by a different column.
   */
  if tg_argv[0] = 'estimate_version_id' then
    v_version := (to_jsonb(new) ->> 'estimate_version_id')::uuid;
  else
    execute format(
      'select l.estimate_version_id from estimate_line_items l where l.id = $1.%I',
      tg_argv[0])
      into v_version using new;
  end if;

  if v_version is null then return new; end if;

  select status into v_status from estimate_versions where id = v_version;

  if v_status in ('approved', 'issued', 'awarded', 'lost') then
    raise exception
      'Estimate version % is % (RULE-009); % cannot change. Make a new version instead.',
      v_version, v_status, tg_table_name
      using errcode = 'restrict_violation',
            hint = 'app.revise_estimate_version copies it forward with a reason.';
  end if;

  return new;
end;
$$;

comment on function app.refuse_when_version_frozen is
  'RULE-009 for everything hanging off an estimate version. The version row has been frozen by trigger since 0006 and its children only by convention — every governed function checked the status because somebody remembered to, and app.apply_takeoff_to_line never did. A retraced measurement could land a new quantity on a signed estimate.';

/*
 * The line itself. Not DELETE: a version being deleted takes its lines with it,
 * and refusing that would leave a company unable to remove an estimate they
 * abandoned.
 */
drop trigger if exists estimate_line_items_frozen on estimate_line_items;
create trigger estimate_line_items_frozen
  before update on estimate_line_items
  for each row execute function app.refuse_when_version_frozen('estimate_version_id');

drop trigger if exists estimate_line_resources_frozen on estimate_line_resources;
create trigger estimate_line_resources_frozen
  before insert or update on estimate_line_resources
  for each row execute function app.refuse_when_version_frozen('line_item_id');

drop trigger if exists estimate_line_modifiers_frozen on estimate_line_modifiers;
create trigger estimate_line_modifiers_frozen
  before insert or update on estimate_line_modifiers
  for each row execute function app.refuse_when_version_frozen('line_item_id');

/*
 * A line may still be inserted onto a frozen version by nothing at all: the
 * insert path is `app.add_estimate_line`, which refuses, and a direct insert
 * would fail `enforce_tenant_parent` only on tenancy. Guarded here so the two
 * ways in agree.
 */
drop trigger if exists estimate_line_items_frozen_insert on estimate_line_items;
create trigger estimate_line_items_frozen_insert
  before insert on estimate_line_items
  for each row execute function app.refuse_when_version_frozen('estimate_version_id');

/**
 * And the takeoff path says so itself.
 *
 * The trigger above would refuse it anyway, with a message about a table. This
 * says what the person was actually trying to do, which is what they need in
 * order to know that revising the estimate is the way forward.
 */
create or replace function app.assert_line_open(p_line uuid)
returns void
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
declare v_status app.estimate_status;
begin
  select v.status into v_status
  from estimate_line_items l
  join estimate_versions v on v.id = l.estimate_version_id
  where l.id = p_line;

  if v_status is null then
    raise exception 'Estimate line % not found', p_line using errcode = 'no_data_found';
  end if;
  if v_status not in ('draft', 'in_review') then
    raise exception
      'That estimate is %; a measurement cannot change a quantity that has been signed off',
      v_status
      using errcode = 'check_violation',
            hint = 'Revise the estimate, then apply the measurement to the new version.';
  end if;
end;
$$;

revoke all on function app.assert_line_open(uuid) from public, anon;
grant execute on function app.assert_line_open(uuid) to authenticated;

select app.assert_security_gates();
