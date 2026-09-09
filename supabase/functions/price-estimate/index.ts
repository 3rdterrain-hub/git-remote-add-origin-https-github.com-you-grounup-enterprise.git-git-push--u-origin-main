/**
 * POST /functions/v1/price-estimate
 *
 * Price an estimate version with the deterministic engine.
 *
 * This is the only path by which a price comes to exist. Since migration 0058
 * the engine-output columns on `estimate_versions`, `estimate_line_items` and
 * `estimate_line_resources` refuse a hand-written value, and the one function
 * permitted to write them is granted to `service_role` alone. A browser holds
 * the anon key and a user's JWT and can reach neither, however senior the
 * person signed in — pricing is not a permission somebody can hold, it is an
 * operation only this function performs.
 *
 * Three checks stand in front of it, in this order:
 *
 *   1. **Authentication.** No caller, no pricing.
 *   2. **Authorization**, asked of the database through the caller's own
 *      client, so the answer is the one row level security would give.
 *   3. **Loading through the caller's client**, not the admin one. The
 *      estimate is read subject to RLS, so a caller who cannot see a version
 *      cannot cause it to be priced — the service role is used for the write
 *      and for nothing else.
 *
 * `asOf` is the estimate's own date rather than today's, so repricing an old
 * version resolves the rates that were in force when it was written instead of
 * silently repricing it against the current rate sheet.
 *
 * Deploy: supabase functions deploy price-estimate
 */
import { getCaller, requirePermission, isUuid, adminClient } from '../_shared/auth.ts';
import { fail, json, preflight } from '../_shared/http.ts';
import {
  priceEstimate,
  type EstimateSnapshot, type LineRow, type ResourceRow, type IndirectRow, type VersionRow,
} from '../_shared/estimate-pricing.ts';

const VERSION_SELECT =
  'id, version_number, status, shift_hours, calendar_efficiency, fuel_price_per_gallon, ' +
  'def_price_per_gallon, bid_rounding_increment, contingency_source, applied_contingency, ' +
  'contingency_override_reason, contingency_approved_by, estimate_id, company_id, ' +
  'discount_percent, discount_amount, discount_reason, ' +
  'pricing_profiles(id, name, method, region, regional_factor, escalation_percent, ' +
  'escalation_years, markup_components(code, label, percent, basis, sequence, disclosed)), ' +
  // This bid's own adjustments. When it carries any they are the markup; when
  // it carries none the profile's stand, so an untouched estimate prices as it
  // always did.
  'estimate_version_markups(code, label, percent, basis, sequence, disclosed, enabled)';

const LINE_SELECT =
  'id, description, sort_order, service_id, assembly_id, discipline, measured_quantity, unit, ' +
  'measurement_method, waste_percent, loss_percent, waste_basis, quantity_adjustments, ' +
  'source_references, production_modifier, markup_override, ' +
  'parametric_cost_per_unit, parametric_basis, ' +
  'check_primary_source, check_cross_source, ' +
  'check_reconciliation, conflict_count, has_open_rfi, documents_cannot_resolve, ' +
  'material_geotech_assumption, major_earthwork_decision, origin, notes, ' +
  'cost_codes(code), ' +
  'production_rates(id, task_id, rate_per_hour, rate_unit, utilization_factor, shift_hours, ' +
  'source_type, confidence_score, sample_size, effective_date, region, approval_state, status), ' +
  'crews(id, name, shift_hours, crew_members(headcount, straight_hours_per_shift, ' +
  'overtime_hours_per_shift, doubletime_hours_per_shift, ' +
  'labor_rates(id, classification, labor_group, base_wage_per_hour, burden_percent, ' +
  'overtime_multiplier, doubletime_multiplier, region, effective_date, status))), ' +
  'estimate_line_modifiers(justification, condition_modifiers(id, name, factors, ' +
  'application_rule, category, status))';

const RESOURCE_SELECT =
  'id, line_item_id, resource_kind, description, quantity, unit, unit_rate, hours, headcount, ' +
  'quote_reference, sort_order, role, drives_hours, production_per_hour, base_rate, ' +
  'burden_rate, rate_basis, mobilization_cost, standby_days, minimum_hours, is_owned, ' +
  'haul_mode, round_trip_miles, average_speed_mph, truck_capacity, tons_per_load, ' +
  'load_minutes, dump_minutes, queue_minutes, includes_disposal, ' +
  'equipment(id, name, equipment_class, fuel_gallons_per_hour, def_percent_of_fuel, ' +
  'operator_required, mobilization_required, mobilization_cost, ' +
  'equipment_rates(source, hourly_rate, daily_rate, weekly_rate, monthly_rate, ' +
  'effective_date, expires_on, reference)), ' +
  'materials(id, name, unit, unit_cost, cost_state, free_reason, vendor_id, quote_reference), ' +
  'labor_rates(id, classification, labor_group, base_wage_per_hour, burden_percent, ' +
  'overtime_multiplier, doubletime_multiplier, region, effective_date, status)';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') return fail('method_not_allowed', 'Use POST.', 405, origin);

  try {
    const caller = await getCaller(req);
    if (!caller) return fail('unauthenticated', 'Sign in to price an estimate.', 401, origin);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const versionId = body.estimateVersionId;
    if (!isUuid(versionId)) {
      return fail('bad_request', 'A valid estimateVersionId is required.', 400, origin);
    }

    // Read through the caller's own client: row level security decides what
    // they can see, and a version they cannot see is a version they cannot
    // cause to be priced.
    const { data: version, error: versionError } = await caller.client
      .from('estimate_versions').select(VERSION_SELECT).eq('id', versionId).maybeSingle();
    if (versionError) return fail('read_failed', versionError.message, 400, origin);
    if (!version) return fail('not_found', 'That estimate version does not exist.', 404, origin);

    const row = version as unknown as Record<string, unknown>;
    const companyId = String(row.company_id);

    const permitted = await requirePermission(caller, companyId, 'estimates.write');
    if (!permitted.ok) return fail('forbidden', permitted.reason, 403, origin);

    /*
     * An issued version is frozen by RULE-009 and repricing it would be refused
     * by the database anyway. Refusing here says why, rather than surfacing a
     * trigger's exception to somebody who pressed a button.
     */
    if (['issued', 'awarded', 'lost', 'archived'].includes(String(row.status))) {
      return fail('conflict',
        `This version is ${row.status} and its price is frozen. Revise it to price again.`,
        409, origin);
    }

    const { data: estimate, error: estimateError } = await caller.client
      .from('estimates').select('id, number, name').eq('id', String(row.estimate_id)).maybeSingle();
    if (estimateError) return fail('read_failed', estimateError.message, 400, origin);
    if (!estimate) return fail('not_found', 'That estimate does not exist.', 404, origin);

    const { data: lines, error: linesError } = await caller.client
      .from('estimate_line_items').select(LINE_SELECT).eq('estimate_version_id', versionId);
    if (linesError) return fail('read_failed', linesError.message, 400, origin);

    const lineIds = (lines ?? []).map((l) => String((l as unknown as Record<string, unknown>).id));
    const { data: resources, error: resourcesError } = lineIds.length
      ? await caller.client
          .from('estimate_line_resources').select(RESOURCE_SELECT).in('line_item_id', lineIds)
      : { data: [], error: null };
    if (resourcesError) return fail('read_failed', resourcesError.message, 400, origin);

    const { data: indirects, error: indirectsError } = await caller.client
      .from('estimate_indirects')
      .select('code, label, amount, percent_of_direct, per_day, days')
      .eq('estimate_version_id', versionId);
    if (indirectsError) return fail('read_failed', indirectsError.message, 400, origin);

    if ((lines ?? []).length === 0) {
      return fail('nothing_to_price',
        'This version has no line items. Add scope before pricing it.', 422, origin);
    }

    const snapshot: EstimateSnapshot = {
      estimate: {
        id: String((estimate as unknown as Record<string, unknown>).id),
        number: String((estimate as unknown as Record<string, unknown>).number),
        name: String((estimate as unknown as Record<string, unknown>).name),
      },
      version: version as unknown as VersionRow,
      lines: (lines ?? []) as unknown as LineRow[],
      resources: (resources ?? []) as unknown as ResourceRow[],
      indirects: (indirects ?? []) as unknown as IndirectRow[],
    };

    // The estimate's own date, not today's. Repricing a two-year-old version
    // must resolve the rates that were in force when it was written.
    const asOf = typeof body.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.asOf)
      ? body.asOf
      : new Date().toISOString().slice(0, 10);

    let priced;
    try {
      priced = priceEstimate(snapshot, asOf);
    } catch (err) {
      /*
       * The engine refusing to compute is a real answer about the estimate, not
       * a server fault: a rate resolved as of a date with no candidates in
       * force, a quantity that cannot be reconciled. Reported as such.
       */
      return json({ error: {
        code: 'cannot_price',
        message: err instanceof Error ? err.message : 'The estimate could not be priced.',
      } }, 422, origin);
    }

    /*
     * A hole in the estimate stops the write. Pricing around a missing
     * equipment rate would put a confident number on a page that nothing
     * supports, which is the failure this whole boundary exists to prevent.
     */
    if (priced.problems.length > 0) {
      // The standard error envelope, so `callFunction` surfaces the code and
      // message like every other failure — with the problem list carried along
      // so the workspace can point at the lines rather than say "something".
      return json({ error: {
        code: 'incomplete',
        message: `This estimate is missing information the engine needs (${priced.problems.length}).`,
        problems: priced.problems,
      } }, 422, origin);
    }

    // The one writer. Service role, because nothing else may write a price.
    const { error: writeError } = await adminClient().rpc('record_engine_result', {
      p_version_id: versionId,
      p_engine_version: priced.payload.engineVersion,
      p_version: priced.payload.version,
      p_lines: priced.payload.lines,
    });
    if (writeError) return fail('write_failed', writeError.message, 400, origin);

    return json({
      engineVersion: priced.payload.engineVersion,
      directCost: priced.result.totalDirectCost,
      indirectCost: priced.result.indirectCost,
      totalPrice: priced.result.price.totalPrice,
      bidPrice: priced.result.bidPrice,
      grossMarginPercent: priced.result.price.grossMarginPercent,
      weightedConfidence: priced.result.weightedConfidence,
      confidenceBand: priced.result.confidenceBand,
      recommendedContingency: priced.result.recommendedContingency,
      appliedContingency: priced.result.appliedContingency,
      executiveDecision: priced.result.executiveDecision,
      executiveDecisionReason: priced.result.executiveDecisionReason,
      blockedFromIssue: priced.result.blockedFromIssue,
      totalLaborHours: priced.result.totalLaborHours,
      totalDurationDays: priced.result.totalDurationDays,
      warnings: priced.result.warnings,
      lineCount: priced.result.lines.length,
    }, 200, origin);
  } catch (err) {
    return fail('internal_error',
      err instanceof Error ? err.message : 'Pricing failed.', 500, origin);
  }
});
