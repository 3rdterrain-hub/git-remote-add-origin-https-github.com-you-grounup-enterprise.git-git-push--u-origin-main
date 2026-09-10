-- ============================================================================
-- 0140  The four columns the writer forgot
-- ============================================================================
--
-- Migration 0138 gave a line a price: `markup_rate`, `markup_amount`,
-- `total_price` and `unit_price`. It added the columns, it registered them as
-- engine outputs so nobody could type one by hand, and the Edge Function has
-- been putting all four into its payload from the day it was written.
--
-- `app.record_engine_result` — the only writer of engine outputs — never
-- mentioned them. The payload carried the values to the database and the UPDATE
-- dropped them, so on every priced estimate the +MARKUP column read as an em
-- dash and TOTAL fell back to the line's *cost*, displayed where its price
-- belongs. A bid of $28,475 sat above a line that said $21,250, and the screen
-- offered no way to tell that those were two different quantities.
--
-- Found by pricing a real estimate in a browser and reading the row.
--
-- This is the whole function again rather than a patch, because a
-- `create or replace` of a plpgsql body is all-or-nothing: there is no way to
-- add four assignments to an UPDATE without restating it, and restating it is
-- the honest form of the change anyway.
--
-- Entity: Estimate line. Engine: pricing write-back.
-- ============================================================================

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
         /*
          * What the line sells for. Migration 0138 added these four columns,
          * registered them as engine outputs in the guard above, and the Edge
          * Function has been sending them in this very payload ever since —
          * into an UPDATE that did not mention them. The values arrived and
          * were dropped, so `+MARKUP` read as an em dash on every priced line
          * and TOTAL fell back to showing the line's cost as though it were
          * its price.
          */
         markup_rate            = coalesce((r->>'markup_rate')::numeric, l.markup_rate),
         markup_amount          = coalesce((r->>'markup_amount')::numeric, l.markup_amount),
         total_price            = coalesce((r->>'total_price')::numeric, l.total_price),
         unit_price             = coalesce((r->>'unit_price')::numeric, l.unit_price),
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

-- Unchanged from 0058, restated because the function was replaced: the browser
-- must never reach this.
revoke all on function app.record_engine_result(uuid, text, jsonb, jsonb, jsonb) from public;
revoke all on function app.record_engine_result(uuid, text, jsonb, jsonb, jsonb) from anon;
revoke all on function app.record_engine_result(uuid, text, jsonb, jsonb, jsonb) from authenticated;
grant execute on function app.record_engine_result(uuid, text, jsonb, jsonb, jsonb) to service_role;

comment on function app.record_engine_result(uuid, text, jsonb, jsonb, jsonb) is
  'The only writer of engine outputs, line prices included. Granted to service_role alone, because the engine runs in an Edge Function and a browser must not be able to hand the platform a price of its own.';

select app.assert_security_gates();
