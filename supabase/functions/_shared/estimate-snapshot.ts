/**
 * What an estimate version looks like when it is read out of the database.
 *
 * Extracted from `price-estimate` so a second caller cannot drift from it. The
 * risk this file exists to remove is specific and recent: adding
 * `fringe_per_hour` meant editing two PostgREST selects by hand in the same
 * file, and missing one would have priced a crew's fringe in one code path and
 * not in the other — a difference of twenty dollars an hour a worker, visible
 * nowhere.
 *
 * So the selects live here once. `price-estimate` writes a price from this;
 * `compare-scenarios` reads one and writes nothing. They must be looking at the
 * same estimate or the comparison is against a different job.
 */
import type {
  EstimateSnapshot, LineRow, ResourceRow, IndirectRow, VersionRow,
} from './estimate-pricing.ts';

const VERSION_SELECT =
  'id, version_number, status, shift_hours, calendar_efficiency, fuel_price_per_gallon, ' +
  'def_price_per_gallon, bid_rounding_increment, contingency_source, applied_contingency, ' +
  'contingency_override_reason, contingency_approved_by, estimate_id, company_id, ' +
  'wage_schedule_id, ' +
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
  'crews(id, name, shift_hours, crew_members(id, headcount, straight_hours_per_shift, ' +
  'overtime_hours_per_shift, doubletime_hours_per_shift, ' +
  'labor_rates(id, classification, labor_group, base_wage_per_hour, burden_percent, ' +
  'fringe_per_hour, fringe_is_taxable, ' +
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
  'fringe_per_hour, fringe_is_taxable, ' +
  'overtime_multiplier, doubletime_multiplier, region, effective_date, status)';

/** A PostgREST client, as `getCaller` hands one over. */
type Client = {
  from: (t: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => any;
};

export interface SnapshotFailure {
  code: string;
  message: string;
  status: number;
}

export type SnapshotLoad =
  | { ok: true; snapshot: EstimateSnapshot; version: Record<string, unknown> }
  | { ok: false; failure: SnapshotFailure };

/**
 * Read one version, its lines, resources and indirects.
 *
 * Read through the **caller's** client, never the admin one: a caller who
 * cannot see a version cannot cause it to be priced, and cannot compare it
 * either. The service role is for writing a result and for nothing else.
 *
 * Wage resolution is included, because a scenario priced against the shop rate
 * while the bid is priced against a union sheet would be a comparison of two
 * different jobs.
 */
export async function loadEstimateSnapshot(
  client: Client, versionId: string,
): Promise<SnapshotLoad> {
  const fail = (code: string, message: string, status = 400): SnapshotLoad =>
    ({ ok: false, failure: { code, message, status } });

  const { data: version, error: versionError } = await client
    .from('estimate_versions').select(VERSION_SELECT).eq('id', versionId).maybeSingle();
  if (versionError) return fail('read_failed', versionError.message);
  if (!version) return fail('not_found', 'That estimate version does not exist.', 404);

  const row = version as unknown as Record<string, unknown>;

  const { data: estimate, error: estimateError } = await client
    .from('estimates').select('id, number, name').eq('id', String(row.estimate_id)).maybeSingle();
  if (estimateError) return fail('read_failed', estimateError.message);
  if (!estimate) return fail('not_found', 'That estimate does not exist.', 404);

  const { data: lines, error: linesError } = await client
    .from('estimate_line_items').select(LINE_SELECT).eq('estimate_version_id', versionId);
  if (linesError) return fail('read_failed', linesError.message);

  const lineIds = (lines ?? []).map((l: unknown) => String((l as Record<string, unknown>).id));
  const { data: resources, error: resourcesError } = lineIds.length
    ? await client.from('estimate_line_resources').select(RESOURCE_SELECT).in('line_item_id', lineIds)
    : { data: [], error: null };
  if (resourcesError) return fail('read_failed', resourcesError.message);

  /*
   * Which wage prices each crew member. One statement of that rule, in
   * `app.resolve_labor_rate`, asked of the database rather than restated here.
   * Skipped entirely when the version names no sheet, which is every open-shop
   * estimate.
   */
  if (row.wage_schedule_id) {
    const { data: resolved, error: resolveError } = await client
      .rpc('resolved_labor_rates', { p_version: versionId });
    if (resolveError) return fail('wage_not_resolved', resolveError.message, 422);

    const resolvedRates = new Map<string, string>(
      ((resolved ?? []) as Array<Record<string, unknown>>)
        .filter((r) => r.labor_rate_id)
        .map((r) => [String(r.crew_member_id), String(r.labor_rate_id)]),
    );

    const wanted = [...new Set(resolvedRates.values())];
    const { data: sheetRates, error: sheetError } = wanted.length
      ? await client.from('labor_rates')
          .select('id, classification, labor_group, base_wage_per_hour, burden_percent, '
            + 'fringe_per_hour, fringe_is_taxable, overtime_multiplier, '
            + 'doubletime_multiplier, region, effective_date, status')
          .in('id', wanted)
      : { data: [], error: null };
    if (sheetError) return fail('read_failed', sheetError.message);

    const byId = new Map(
      ((sheetRates ?? []) as unknown as Array<Record<string, unknown>>)
        .map((r) => [String(r.id), r]),
    );

    for (const line of (lines ?? []) as unknown as Array<Record<string, unknown>>) {
      const crew = line.crews as Record<string, unknown> | null;
      const members = (crew?.crew_members ?? []) as Array<Record<string, unknown>>;
      for (const m of members) {
        const resolvedId = resolvedRates.get(String(m.id));
        const rate = resolvedId ? byId.get(resolvedId) : undefined;
        if (rate) m.labor_rates = rate;
      }
    }
  }

  const { data: indirects, error: indirectsError } = await client
    .from('estimate_indirects')
    .select('code, label, amount, percent_of_direct, per_day, days')
    .eq('estimate_version_id', versionId);
  if (indirectsError) return fail('read_failed', indirectsError.message);

  if ((lines ?? []).length === 0) {
    return fail('nothing_to_price',
      'This version has no line items. Add scope before pricing it.', 422);
  }

  const e = estimate as unknown as Record<string, unknown>;
  return {
    ok: true,
    version: row,
    snapshot: {
      estimate: { id: String(e.id), number: String(e.number), name: String(e.name) },
      version: version as unknown as VersionRow,
      lines: (lines ?? []) as unknown as LineRow[],
      resources: (resources ?? []) as unknown as ResourceRow[],
      indirects: (indirects ?? []) as unknown as IndirectRow[],
    },
  };
}
