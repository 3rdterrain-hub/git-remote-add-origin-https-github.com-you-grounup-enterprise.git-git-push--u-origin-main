-- =============================================================================
-- 0058 — The engine's outputs belong to the engine
--
-- `estimate_versions` carries this comment above its cost columns:
--
--     -- Engine outputs. Written only by the deterministic engine, never by hand.
--
-- Nothing enforced it. A user holding ordinary estimate permissions could run:
--
--     update estimate_versions
--        set total_price = 9999999, bid_price = 9999999,
--            engine_version = 'made up', calculated_at = now()
--      where id = ...;
--
-- and the database accepted every word of it. Proven by test before this
-- migration was written; the same test now proves the refusal.
--
-- This is the deepest instance of the pattern this build keeps finding — the
-- platform asserting a property nothing enforces — and it sits under the one
-- rule the whole product is built on. RULE-008 says AI may not supply the
-- authoritative estimating arithmetic where deterministic logic exists. Until
-- now *any* arithmetic could, from any source, because a priced estimate and a
-- typed number were the same row with the same provenance columns filled in.
--
-- The fix is a boundary rather than a permission. Pricing is not a privilege
-- some roles have and others do not: it is an operation only one piece of code
-- may perform, however senior the person asking.
--
--   * **On update**, a change to any engine-output column is refused unless the
--     transaction is inside `app.record_engine_result()`. Refused, not ignored,
--     because an update is a deliberate act on an existing record and silence
--     would leave the caller believing it worked.
--   * **On insert**, the engine-output columns are forced to their unpriced
--     state. A new version is unpriced by definition — `revise_estimate_version`
--     already declines to copy them forward — so there is nothing to refuse,
--     only a forged starting position to discard. A test asserts the forced
--     state matches the column defaults, so the two cannot drift.
--   * **`app.record_engine_result()`** is the only door, and it is granted to
--     `service_role` alone. The Edge Function that hosts the engine holds that
--     role; a browser never does. A signed-in user cannot call it directly, so
--     they cannot hand it numbers of their own.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Is the engine writing?
-- -----------------------------------------------------------------------------
/**
 * True only inside `app.record_engine_result()`.
 *
 * A transaction-local setting, following `app.request_context()` from 0050. It
 * cannot leak past the transaction that set it, and `set local` inside a
 * security-definer function cannot be forged by the caller.
 */
create or replace function app.engine_is_writing()
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select coalesce(current_setting('app.engine_write', true), '') = 'on';
$$;

comment on function app.engine_is_writing() is
  'Whether the current transaction is inside app.record_engine_result(). The single fact the engine-output guard turns on.';

-- -----------------------------------------------------------------------------
-- The guard
-- -----------------------------------------------------------------------------
/**
 * Refuse a hand-written engine output.
 *
 * Generic over the guarded column list, which arrives in TG_ARGV, so the two
 * tables share one implementation and a column added to either is guarded by
 * naming it in the trigger rather than by writing more PL/pgSQL.
 *
 * On insert the guarded columns are reset rather than refused; see the header.
 * The reset values come from the column defaults read out of the catalog, so
 * this function holds no second opinion about what "unpriced" means — there is
 * exactly one definition, in the schema, and it is the one enforced.
 */
create or replace function app.guard_engine_outputs()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_col     text;
  v_old     jsonb;
  v_new     jsonb := to_jsonb(new);
  v_default text;
  v_reset   jsonb := '{}'::jsonb;
  v_changed text[] := '{}';
begin
  if app.engine_is_writing() then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    foreach v_col in array tg_argv loop
      if v_new -> v_col is distinct from v_old -> v_col then
        v_changed := v_changed || v_col;
      end if;
    end loop;

    if array_length(v_changed, 1) > 0 then
      raise exception
        'Engine outputs on % may not be written by hand: %. Price the estimate through the estimating engine.',
        tg_table_name, array_to_string(v_changed, ', ')
        using errcode = 'insufficient_privilege',
              hint = 'These columns are written only by app.record_engine_result(), which the estimating engine calls.';
    end if;
    return new;
  end if;

  -- INSERT: force the unpriced state, read from the column defaults so this
  -- function cannot disagree with the schema about what unpriced means.
  foreach v_col in array tg_argv loop
    select pg_get_expr(d.adbin, d.adrelid) into v_default
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = tg_relid and a.attname = v_col and not a.attisdropped;

    v_reset := v_reset || jsonb_build_object(
      v_col,
      case when v_default is null then null
           else to_jsonb(app.eval_default(v_default)) end);
  end loop;

  new := jsonb_populate_record(new, v_new || v_reset);
  return new;
end;
$$;

/**
 * Evaluate a column default expression to text.
 *
 * Only ever called with an expression PostgreSQL itself produced from
 * `pg_attrdef`, never with anything a caller supplied, so there is no injection
 * surface here — the input is a catalog value, not user input.
 */
create or replace function app.eval_default(p_expr text)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare v_out text;
begin
  execute format('select (%s)::text', p_expr) into v_out;
  return v_out;
exception when others then
  -- A default that cannot be evaluated out of context (a sequence, say) is not
  -- one of the guarded columns; leaving it untouched is correct.
  return null;
end;
$$;

comment on function app.guard_engine_outputs() is
  'Refuses a hand-written change to an engine output, and discards a forged one supplied at insert. The columns it guards are named in the trigger; the values it resets to are the column defaults, read from the catalog.';

-- -----------------------------------------------------------------------------
-- What each table's engine owns
-- -----------------------------------------------------------------------------
-- Deliberately NOT guarded, because they are the estimator's inputs and the
-- engine reads them: measured_quantity, waste_percent, loss_percent,
-- production_modifier, applied_contingency, the check_* verification booleans,
-- shift_hours and the other version-level assumptions. The line between the
-- two lists is the line between what a person decides and what follows from it.
drop trigger if exists estimate_versions_engine_outputs on estimate_versions;
create trigger estimate_versions_engine_outputs
  before insert or update on estimate_versions
  for each row execute function app.guard_engine_outputs(
    'direct_cost', 'cost_labor_wage', 'cost_labor_burden', 'cost_equipment',
    'cost_equipment_mob', 'cost_fuel', 'cost_material', 'cost_trucking',
    'cost_disposal', 'cost_subcontract', 'cost_other', 'indirect_cost',
    'total_markup', 'total_price', 'bid_price',
    'total_labor_hours', 'total_equipment_hours', 'total_fuel_gallons',
    'total_duration_days', 'weighted_confidence', 'confidence_band',
    'recommended_contingency', 'executive_decision', 'blocked_from_issue',
    'engine_version', 'calculated_at', 'calculation_warnings');

drop trigger if exists estimate_line_items_engine_outputs on estimate_line_items;
create trigger estimate_line_items_engine_outputs
  before insert or update on estimate_line_items
  for each row execute function app.guard_engine_outputs(
    'adjusted_quantity', 'gross_quantity',
    'theoretical_production', 'practical_production', 'recommended_production',
    'productive_hours', 'practical_days',
    'cost_labor_wage', 'cost_labor_burden', 'cost_equipment', 'cost_equipment_mob',
    'cost_fuel', 'cost_material', 'cost_trucking', 'cost_disposal',
    'cost_subcontract', 'cost_other', 'total_direct_cost', 'unit_cost',
    'labor_hours', 'equipment_hours', 'fuel_gallons',
    'confidence_score', 'confidence_band', 'verification_status',
    'approval_gate', 'blocks_issue', 'derivation', 'warnings');

drop trigger if exists estimate_line_resources_engine_outputs on estimate_line_resources;
create trigger estimate_line_resources_engine_outputs
  before insert or update on estimate_line_resources
  for each row execute function app.guard_engine_outputs(
    'extended_cost', 'fuel_gallons', 'rate_source', 'rate_effective_date');

-- -----------------------------------------------------------------------------
-- The only door
-- -----------------------------------------------------------------------------
/**
 * Record what the deterministic engine computed.
 *
 * Takes the whole result at once — version totals, per-line costs, per-resource
 * extensions — because a priced estimate is one consistent object and writing
 * it in pieces would allow a half-priced version to be read between statements.
 *
 * `security definer` so it may set the guard's flag, and granted to
 * `service_role` only. The browser holds the anon key and a user's JWT; neither
 * can reach this. That is the whole boundary: pricing is not a permission a
 * senior role can hold, it is an operation only the engine host performs.
 *
 * The caller's identity still matters and is still checked — the Edge Function
 * verifies the requester may write this estimate before it calls here, and the
 * actor is recorded on the audit row through the usual request context.
 */
create or replace function app.record_engine_result(
  p_version_id    uuid,
  p_engine_version text,
  p_version        jsonb,
  p_lines          jsonb default '[]'::jsonb,
  p_resources      jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
begin
  if p_engine_version is null or length(trim(p_engine_version)) = 0 then
    raise exception 'A pricing result must record which engine produced it'
      using errcode = 'check_violation';
  end if;

  select company_id into v_company from estimate_versions where id = p_version_id;
  if v_company is null then
    raise exception 'Estimate version % not found', p_version_id using errcode = 'no_data_found';
  end if;

  -- Everything below this line is the engine writing.
  perform set_config('app.engine_write', 'on', true);

  update estimate_versions v
     set direct_cost            = coalesce((p_version->>'direct_cost')::numeric, v.direct_cost),
         cost_labor_wage        = coalesce((p_version->>'cost_labor_wage')::numeric, v.cost_labor_wage),
         cost_labor_burden      = coalesce((p_version->>'cost_labor_burden')::numeric, v.cost_labor_burden),
         cost_equipment         = coalesce((p_version->>'cost_equipment')::numeric, v.cost_equipment),
         cost_equipment_mob     = coalesce((p_version->>'cost_equipment_mob')::numeric, v.cost_equipment_mob),
         cost_fuel              = coalesce((p_version->>'cost_fuel')::numeric, v.cost_fuel),
         cost_material          = coalesce((p_version->>'cost_material')::numeric, v.cost_material),
         cost_trucking          = coalesce((p_version->>'cost_trucking')::numeric, v.cost_trucking),
         cost_disposal          = coalesce((p_version->>'cost_disposal')::numeric, v.cost_disposal),
         cost_subcontract       = coalesce((p_version->>'cost_subcontract')::numeric, v.cost_subcontract),
         cost_other             = coalesce((p_version->>'cost_other')::numeric, v.cost_other),
         indirect_cost          = coalesce((p_version->>'indirect_cost')::numeric, v.indirect_cost),
         total_markup           = coalesce((p_version->>'total_markup')::numeric, v.total_markup),
         total_price            = coalesce((p_version->>'total_price')::numeric, v.total_price),
         bid_price              = coalesce((p_version->>'bid_price')::numeric, v.bid_price),
         total_labor_hours      = coalesce((p_version->>'total_labor_hours')::numeric, v.total_labor_hours),
         total_equipment_hours  = coalesce((p_version->>'total_equipment_hours')::numeric, v.total_equipment_hours),
         total_fuel_gallons     = coalesce((p_version->>'total_fuel_gallons')::numeric, v.total_fuel_gallons),
         total_duration_days    = coalesce((p_version->>'total_duration_days')::numeric, v.total_duration_days),
         weighted_confidence    = coalesce((p_version->>'weighted_confidence')::numeric, v.weighted_confidence),
         confidence_band        = coalesce((p_version->>'confidence_band')::app.confidence_band, v.confidence_band),
         recommended_contingency = coalesce((p_version->>'recommended_contingency')::numeric, v.recommended_contingency),
         executive_decision     = coalesce(p_version->>'executive_decision', v.executive_decision),
         blocked_from_issue     = coalesce((p_version->>'blocked_from_issue')::boolean, v.blocked_from_issue),
         calculation_warnings   = coalesce(p_version->'calculation_warnings', v.calculation_warnings),
         engine_version         = p_engine_version,
         calculated_at          = now(),
         updated_at             = now()
   where v.id = p_version_id;

  update estimate_line_items l
     set adjusted_quantity      = coalesce((r->>'adjusted_quantity')::numeric, l.adjusted_quantity),
         gross_quantity         = coalesce((r->>'gross_quantity')::numeric, l.gross_quantity),
         theoretical_production = (r->>'theoretical_production')::numeric,
         practical_production   = (r->>'practical_production')::numeric,
         recommended_production = (r->>'recommended_production')::numeric,
         productive_hours       = coalesce((r->>'productive_hours')::numeric, l.productive_hours),
         practical_days         = coalesce((r->>'practical_days')::numeric, l.practical_days),
         cost_labor_wage        = coalesce((r->>'cost_labor_wage')::numeric, l.cost_labor_wage),
         cost_labor_burden      = coalesce((r->>'cost_labor_burden')::numeric, l.cost_labor_burden),
         cost_equipment         = coalesce((r->>'cost_equipment')::numeric, l.cost_equipment),
         cost_equipment_mob     = coalesce((r->>'cost_equipment_mob')::numeric, l.cost_equipment_mob),
         cost_fuel              = coalesce((r->>'cost_fuel')::numeric, l.cost_fuel),
         cost_material          = coalesce((r->>'cost_material')::numeric, l.cost_material),
         cost_trucking          = coalesce((r->>'cost_trucking')::numeric, l.cost_trucking),
         cost_disposal          = coalesce((r->>'cost_disposal')::numeric, l.cost_disposal),
         cost_subcontract       = coalesce((r->>'cost_subcontract')::numeric, l.cost_subcontract),
         cost_other             = coalesce((r->>'cost_other')::numeric, l.cost_other),
         total_direct_cost      = coalesce((r->>'total_direct_cost')::numeric, l.total_direct_cost),
         unit_cost              = coalesce((r->>'unit_cost')::numeric, l.unit_cost),
         labor_hours            = coalesce((r->>'labor_hours')::numeric, l.labor_hours),
         equipment_hours        = coalesce((r->>'equipment_hours')::numeric, l.equipment_hours),
         fuel_gallons           = coalesce((r->>'fuel_gallons')::numeric, l.fuel_gallons),
         confidence_score       = coalesce((r->>'confidence_score')::numeric, l.confidence_score),
         confidence_band        = coalesce((r->>'confidence_band')::app.confidence_band, l.confidence_band),
         verification_status    = coalesce((r->>'verification_status')::app.verification_status, l.verification_status),
         approval_gate          = coalesce((r->>'approval_gate')::app.approval_gate, l.approval_gate),
         blocks_issue           = coalesce((r->>'blocks_issue')::boolean, l.blocks_issue),
         derivation             = coalesce(r->'derivation', l.derivation),
         warnings               = coalesce(r->'warnings', l.warnings),
         updated_at             = now()
    from jsonb_array_elements(p_lines) r
   where l.id = (r->>'id')::uuid
     and l.estimate_version_id = p_version_id;

  update estimate_line_resources er
     set extended_cost        = coalesce((r->>'extended_cost')::numeric, er.extended_cost),
         fuel_gallons         = coalesce((r->>'fuel_gallons')::numeric, er.fuel_gallons),
         rate_source          = coalesce((r->>'rate_source')::app.rate_source, er.rate_source),
         rate_effective_date  = coalesce((r->>'rate_effective_date')::date, er.rate_effective_date),
         updated_at           = now()
    from jsonb_array_elements(p_resources) r
   join estimate_line_items l2 on l2.id = (r->>'line_item_id')::uuid
   where er.id = (r->>'id')::uuid
     and l2.estimate_version_id = p_version_id
     and er.line_item_id = l2.id;
end;
$$;

-- The browser must never reach this. `authenticated` is deliberately absent.
revoke all on function app.record_engine_result(uuid, text, jsonb, jsonb, jsonb) from public;
revoke all on function app.record_engine_result(uuid, text, jsonb, jsonb, jsonb) from anon;
revoke all on function app.record_engine_result(uuid, text, jsonb, jsonb, jsonb) from authenticated;
grant execute on function app.record_engine_result(uuid, text, jsonb, jsonb, jsonb) to service_role;

comment on function app.record_engine_result(uuid, text, jsonb, jsonb, jsonb) is
  'The only writer of engine outputs. Granted to service_role alone, because the engine runs in an Edge Function and a browser must not be able to hand the platform a price of its own.';

comment on column estimate_versions.total_price is
  'Written only by app.record_engine_result(), enforced by the estimate_versions_engine_outputs trigger. Before migration 0058 this was a comment rather than a rule, and any holder of estimate write permission could type a price the engine never computed.';

select app.assert_security_gates();
