import { describe, expect, it } from 'vitest';
import {
  buildEstimateInput, priceEstimate, toEnginePayload,
  type EstimateSnapshot, type LineRow, type ResourceRow,
} from '../../supabase/functions/_shared/estimate-pricing.ts';

/**
 * Database rows into the estimating engine.
 *
 * Since migration 0058 this is the whole of the pricing path: nothing else may
 * write a price, so a mistake here is not a display bug — it is a wrong number
 * on a bid, produced by the one component permitted to produce numbers.
 *
 * Two properties the tests hold:
 *
 *   1. **This file computes nothing.** Every figure it emits is one the engine
 *      returned. The tests check the mapping, never the arithmetic — the engine
 *      has its own suite for that, and duplicating it here would create a
 *      second opinion about what a cost is.
 *   2. **A missing input is reported, never defaulted.** An equipment item with
 *      no rate in force, a version with no pricing profile, a line with nothing
 *      on it — each becomes a problem the handler refuses on, because pricing
 *      around a hole puts a confident number on a page nothing supports.
 */
const ASOF = '2026-06-01';

const laborRate = {
  id: 'lr-1', classification: 'Operator', labor_group: 'Operating Engineers',
  base_wage_per_hour: '38.50', burden_percent: '0.42',
  overtime_multiplier: '1.5', doubletime_multiplier: '2',
  region: 'OH', effective_date: '2026-01-01', status: 'active',
};

const line = (over: Partial<LineRow> = {}): LineRow => ({
  id: 'line-1', description: 'Trench excavation', sort_order: 0,
  service_id: null, assembly_id: null, discipline: 'Sitework',
  measured_quantity: '1200', unit: 'CY', measurement_method: 'explicit_dimension',
  waste_percent: '0', loss_percent: '0', waste_basis: null,
  quantity_adjustments: [], source_references: ['C-301'],
  production_modifier: '1',
  check_primary_source: true, check_cross_source: true, check_reconciliation: true,
  conflict_count: 0, has_open_rfi: false, documents_cannot_resolve: false,
  material_geotech_assumption: false, major_earthwork_decision: false,
  origin: 'human', notes: null,
  cost_codes: { code: 'CC-0310' },
  production_rates: {
    id: 'pr-1', task_id: null, rate_per_hour: '60', rate_unit: 'CY',
    utilization_factor: '0.83', shift_hours: '8', source_type: 'company_actual',
    confidence_score: '88', sample_size: '12', effective_date: '2026-01-01',
    region: 'OH', approval_state: 'approved', status: 'active',
  },
  crews: {
    id: 'crew-1', name: 'Pipe crew', shift_hours: '8',
    crew_members: [{
      headcount: 2, straight_hours_per_shift: '8',
      overtime_hours_per_shift: '0', doubletime_hours_per_shift: '0',
      labor_rates: laborRate,
    }],
  },
  estimate_line_modifiers: [],
  ...over,
});

const equipmentResource = (over: Partial<ResourceRow> = {}): ResourceRow => ({
  id: 'res-1', line_item_id: 'line-1', resource_kind: 'equipment',
  description: null, quantity: '1', unit: 'HR', unit_rate: '0', hours: '0',
  headcount: null, quote_reference: null,
  sort_order: 0, role: null, drives_hours: null, production_per_hour: null,
  base_rate: null, burden_rate: null, rate_basis: 'hour',
  mobilization_cost: '0', standby_days: '0', minimum_hours: null, is_owned: true,
  haul_mode: 'hours', round_trip_miles: null, average_speed_mph: null,
  truck_capacity: null, tons_per_load: null, load_minutes: null,
  dump_minutes: null, queue_minutes: null, includes_disposal: false,
  equipment: {
    id: 'eq-1', name: 'Excavator 20-25 ton', equipment_class: 'excavator',
    fuel_gallons_per_hour: '6.2', def_percent_of_fuel: '0.03',
    operator_required: true, mobilization_required: true, mobilization_cost: '850',
    equipment_rates: [
      { source: 'global_seed', hourly_rate: '92', daily_rate: null, weekly_rate: null,
        monthly_rate: null, effective_date: '2025-01-01', expires_on: null, reference: null },
      { source: 'tenant_approved', hourly_rate: '104.50', daily_rate: null, weekly_rate: null,
        monthly_rate: null, effective_date: '2026-01-01', expires_on: null, reference: 'RATE-2026' },
    ],
  },
  materials: null, labor_rates: null,
  ...over,
});

const snapshot = (over: Partial<EstimateSnapshot> = {}): EstimateSnapshot => ({
  estimate: { id: 'est-1', number: 'EST-2026-0001', name: 'Kingsway Sitework' },
  version: {
    id: 'ver-1', version_number: 1, status: 'draft',
    shift_hours: '8', calendar_efficiency: '0.85',
    fuel_price_per_gallon: '4.19', def_price_per_gallon: '3.10',
    bid_rounding_increment: '100',
    contingency_source: 'confidence_band', applied_contingency: '0.12',
    contingency_override_reason: null, contingency_approved_by: null,
    pricing_profiles: {
      id: 'pp-1', name: 'Company Default', method: 'parallel', region: 'OH',
      regional_factor: '1.02', escalation_percent: '0', escalation_years: '0',
      markup_components: [
        { code: 'OH', label: 'Overhead', percent: '0.10', basis: 'adjusted_cost', sequence: 10, disclosed: true },
        { code: 'PROFIT', label: 'Profit', percent: '0.12', basis: 'adjusted_cost', sequence: 20, disclosed: false },
      ],
    },
  },
  lines: [line()],
  resources: [equipmentResource()],
  indirects: [],
  ...over,
});

describe('mapping an estimate into the engine', () => {
  it('produces a priced estimate from database rows', () => {
    const { result, problems } = priceEstimate(snapshot(), ASOF);
    expect(problems).toEqual([]);
    expect(result.totalDirectCost).toBeGreaterThan(0);
    expect(result.bidPrice).toBeGreaterThan(result.totalDirectCost);
    expect(result.lines).toHaveLength(1);
  });

  it('reads numeric columns that arrive as strings', () => {
    /*
     * PostgREST returns `numeric` as a string to preserve precision, and
     * JavaScript would happily concatenate one. A wage of "38.50" read as text
     * is a silent multiplication by nothing.
     */
    const { input } = buildEstimateInput(snapshot(), ASOF);
    const crew = input.lines[0]!.crew!;
    expect(crew.members[0]!.classification.baseWagePerHour).toBe(38.5);
    expect(crew.members[0]!.classification.burdenPercent).toBe(0.42);
    expect(input.lines[0]!.quantity.measured).toBe(1200);
  });

  it('lets the engine choose which equipment rate wins', () => {
    // RULE-003 precedence is the engine's, applied by the engine's own
    // function. A tenant-approved rate outranks the shipped seed.
    const { input } = buildEstimateInput(snapshot(), ASOF);
    const rate = input.lines[0]!.equipment![0]!.rate;
    expect(rate.source).toBe('tenant_approved');
    expect(rate.hourlyRate).toBe(104.5);
    expect(rate.consideredSources).toContain('global_seed');
  });

  it('treats a rate quoted on the line as a project quote', () => {
    /*
     * The most specific thing anybody said about what this machine costs on
     * this job, which is exactly what RULE-003 ranks first.
     */
    const { input } = buildEstimateInput(
      snapshot({ resources: [equipmentResource({ unit_rate: '118.75', quote_reference: 'Q-88' })] }),
      ASOF);
    const rate = input.lines[0]!.equipment![0]!.rate;
    expect(rate.source).toBe('project_quote');
    expect(rate.hourlyRate).toBe(118.75);
  });

  it('reports an equipment item with no rate in force instead of pricing it at nothing', () => {
    const bare = equipmentResource();
    bare.equipment!.equipment_rates = [];
    const { problems } = buildEstimateInput(snapshot({ resources: [bare] }), ASOF);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.field).toBe('equipment_rate');
    expect(problems[0]!.detail).toMatch(/Excavator 20-25 ton/);
  });

  it('reports a version with no pricing profile', () => {
    /*
     * Without markup the engine returns cost as if it were price. Writing that
     * would put a number on a bid with no overhead and no profit in it.
     */
    const s = snapshot();
    s.version.pricing_profiles = null;
    const { problems } = buildEstimateInput(s, ASOF);
    expect(problems.map((p) => p.field)).toContain('pricing_profile');
  });

  it('reports a line with nothing on it to price', () => {
    const empty = line({
      id: 'line-2', production_rates: null, crews: null, estimate_line_modifiers: [],
    });
    const { problems } = buildEstimateInput(
      snapshot({ lines: [empty], resources: [] }), ASOF);
    expect(problems.map((p) => p.field)).toContain('resources');
  });

  it('collects every problem in one run rather than stopping at the first', () => {
    // An estimator fixing holes one exception at a time stops using the button.
    const bare = equipmentResource();
    bare.equipment!.equipment_rates = [];
    const s = snapshot({ resources: [bare] });
    s.version.pricing_profiles = null;
    const { problems } = buildEstimateInput(s, ASOF);
    expect(problems.length).toBeGreaterThanOrEqual(2);
  });

  it('builds a crew from line labor when no library crew is named', () => {
    /*
     * Both shapes are legitimate in the schema. Synthesizing one means labor is
     * costed by the same code either way rather than by two paths that can
     * disagree.
     */
    const { input } = buildEstimateInput(snapshot({
      lines: [line({ crews: null })],
      resources: [{
        id: 'res-2', line_item_id: 'line-1', resource_kind: 'labor',
        description: 'Operator', quantity: '2', unit: 'HR', unit_rate: '0', hours: '8',
        headcount: 2, quote_reference: null,
        equipment: null, materials: null, labor_rates: laborRate,
      }],
    }), ASOF);
    expect(input.lines[0]!.crew!.members[0]!.count).toBe(2);
    expect(input.lines[0]!.crew!.id).toBe('line:line-1');
  });

  it('carries the verification checks that decide whether the estimate may issue', () => {
    const { input } = buildEstimateInput(snapshot({
      lines: [line({ check_cross_source: false, check_reconciliation: false })],
    }), ASOF);
    expect(input.lines[0]!.verification).toEqual({
      primarySource: true, crossSource: false, mathematicalReconciliation: false,
    });
  });

  it('marks an AI-suggested line as one, because the gate depends on it', () => {
    const { input } = buildEstimateInput(
      snapshot({ lines: [line({ origin: 'ai_suggested' })] }), ASOF);
    expect(input.lines[0]!.aiGenerated).toBe(true);
  });

  it('passes an approved contingency override through and ignores an unapproved one', () => {
    /*
     * `estimate_versions_contingency_override` already refuses an override with
     * no reason and no approver at the database. This is the same rule read
     * from the other side: an override missing either is not one.
     */
    const approved = snapshot();
    approved.version.contingency_source = 'override';
    approved.version.applied_contingency = '0.06';
    approved.version.contingency_override_reason = 'Known site, repeat customer';
    approved.version.contingency_approved_by = 'user-1';
    expect(buildEstimateInput(approved, ASOF).input.contingencyOverride).toEqual({
      percent: 0.06, approvedBy: 'user-1', reason: 'Known site, repeat customer',
    });

    const unapproved = snapshot();
    unapproved.version.contingency_source = 'override';
    unapproved.version.contingency_override_reason = 'Feels fine';
    expect(buildEstimateInput(unapproved, ASOF).input.contingencyOverride).toBeUndefined();
  });

  it('sorts lines by their stored order, not by however they arrived', () => {
    const a = line({ id: 'l-a', description: 'Second', sort_order: 20 });
    const b = line({ id: 'l-b', description: 'First', sort_order: 10 });
    const { input } = buildEstimateInput(snapshot({
      lines: [a, b],
      resources: [equipmentResource({ line_item_id: 'l-a' }), equipmentResource({ id: 'r2', line_item_id: 'l-b' })],
    }), ASOF);
    expect(input.lines.map((l) => l.description)).toEqual(['First', 'Second']);
  });
});

describe('the result on its way back to the database', () => {
  it('names every column the one permitted writer accepts', () => {
    const { result } = priceEstimate(snapshot(), ASOF);
    const payload = toEnginePayload(result);
    expect(payload.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    for (const key of ['direct_cost', 'total_price', 'bid_price', 'confidence_band',
                       'blocked_from_issue', 'executive_decision', 'calculation_warnings']) {
      expect(Object.keys(payload.version)).toContain(key);
    }
    expect(payload.lines[0]).toHaveProperty('total_direct_cost');
    expect(payload.lines[0]).toHaveProperty('approval_gate');
  });

  it('reports exactly what the engine computed and nothing of its own', () => {
    /*
     * The whole reason this file is allowed near a price: it carries numbers,
     * it does not make them. If these ever disagree there are two estimating
     * engines, which is the one thing the architecture forbids.
     */
    const { result } = priceEstimate(snapshot(), ASOF);
    const payload = toEnginePayload(result);
    expect(payload.version.total_price).toBe(result.price.totalPrice);
    expect(payload.version.bid_price).toBe(result.bidPrice);
    expect(payload.version.direct_cost).toBe(result.totalDirectCost);
    expect(payload.lines[0]!.total_direct_cost).toBe(result.lines[0]!.totalDirectCost);
    expect(payload.lines[0]!.unit_cost).toBe(result.lines[0]!.unitCost);
  });

  it('carries the engine version, because a price with no provenance is the old defect', () => {
    const payload = toEnginePayload(priceEstimate(snapshot(), ASOF).result);
    expect(payload.engineVersion).toBeTruthy();
  });
});


/**
 * What the estimator typed.
 *
 * An estimate is built out of a crew and a fleet somebody names on the spot at
 * least as often as out of library rows: two operators at forty and fifteen, a
 * D5 on a weekly rate, a quad axle running a twelve mile round trip. Until
 * migration 0107 every one of those was dropped — a labor row with no library
 * classification was filtered out of the crew, a machine with no catalog entry
 * was refused, and a truck was flattened to rate times quantity whatever the
 * haul distance was.
 */
describe('resources an estimator typed rather than picked', () => {
  const typed = (over: Partial<ResourceRow>): ResourceRow => ({
    ...equipmentResource(), equipment: null, ...over,
  });

  it('puts a hand-entered crew member on the line', () => {
    /*
     * The old filter required a joined labor_rates row, so this priced as no
     * labor at all — a line that looked complete and cost nothing.
     */
    const input = buildEstimateInput(snapshot({
      // No crew assigned to the line, so the loose labor rows are the crew.
      lines: [line({ crews: null })],
      resources: [typed({
        id: 'r-crew', resource_kind: 'labor', role: 'Operator',
        description: 'Excavator Operator', headcount: 2,
        base_rate: '40', burden_rate: '15', unit_rate: '0',
      })],
    }), ASOF);
    const crew = input.input.lines[0]!.crew!;
    expect(crew.members).toHaveLength(1);
    expect(crew.members[0]!.count).toBe(2);
    expect(crew.members[0]!.classification.baseWagePerHour).toBe(40);
    // Burden is entered in dollars beside the wage, as it reads on a rate
    // sheet; the engine takes a fraction. 15 on 40 is 0.375.
    expect(crew.members[0]!.classification.burdenPercent).toBeCloseTo(0.375, 6);
    expect(crew.members[0]!.classification.classification).toBe('Excavator Operator');
  });

  it('takes the library classification when there is one', () => {
    const input = buildEstimateInput(snapshot({
      lines: [line({ crews: null })],
      resources: [typed({
        id: 'r-crew', resource_kind: 'labor', headcount: 3,
        base_rate: '99', burden_rate: '99', labor_rates: laborRate,
      })],
    }), ASOF);
    const member = input.input.lines[0]!.crew!.members[0]!;
    // The library wins over what was typed beside it: an approved rate is not
    // overridden by a number in a form.
    expect(member.classification.baseWagePerHour).toBe(38.5);
    expect(member.classification.burdenPercent).toBe(0.42);
  });

  it('skips a crew row with no wage rather than pricing it at nothing', () => {
    const input = buildEstimateInput(snapshot({
      lines: [line({ crews: null })],
      resources: [
        typed({ id: 'r-empty', resource_kind: 'labor', role: 'Labor', unit_rate: '0' }),
        typed({ id: 'r-real', resource_kind: 'labor', base_rate: '30', headcount: 1 }),
      ],
    }), ASOF);
    expect(input.input.lines[0]!.crew!.members).toHaveLength(1);
  });

  it('lets a crew assigned to the line beat loose labor rows', () => {
    /*
     * A crew is a governed library record with an approved composition. Rows
     * typed on the line are what somebody put together for this scope, and
     * they are the fallback rather than an override.
     */
    const input = buildEstimateInput(snapshot({
      resources: [typed({
        id: 'r-crew', resource_kind: 'labor', description: 'Somebody else',
        base_rate: '1', burden_rate: '0', headcount: 9,
      })],
    }), ASOF);
    expect(input.input.lines[0]!.crew!.name).not.toBe('Line labor');
  });

  it('bills a hand-entered machine on the basis it was quoted at', () => {
    /*
     * $2,650 a week is not $2,650 an hour. Treating an entered figure as
     * hourly because that is the field the engine reads first would be wrong
     * by a factor of forty.
     */
    const input = buildEstimateInput(snapshot({
      resources: [typed({
        id: 'r-dozer', resource_kind: 'equipment', description: 'Dozer D5',
        unit_rate: '2650', rate_basis: 'week', mobilization_cost: '600',
      })],
    }), ASOF);
    const item = input.input.lines[0]!.equipment![0]!;
    expect(item.name).toBe('Dozer D5');
    expect(item.rate.weeklyRate).toBe(2650);
    expect(item.rate.hourlyRate).toBe(0);
    expect(item.mobilizationCost).toBe(600);
  });

  it('takes an hourly quote as hourly', () => {
    const input = buildEstimateInput(snapshot({
      resources: [typed({
        id: 'r-roller', resource_kind: 'equipment', description: 'Roller',
        unit_rate: '87.50', rate_basis: 'hour',
      })],
    }), ASOF);
    expect(input.input.lines[0]!.equipment![0]!.rate.hourlyRate).toBe(87.5);
  });

  it('reports a machine with neither a catalog entry nor a rate', () => {
    const input = buildEstimateInput(snapshot({
      resources: [typed({
        id: 'r-none', resource_kind: 'equipment', description: 'Something', unit_rate: '0',
      })],
    }), ASOF);
    expect(input.problems.some((p) =>
      p.field === 'equipment' && /nothing to price it at/.test(p.detail))).toBe(true);
  });

  it('prices a trip haul as a haul cycle rather than rate times quantity', () => {
    /*
     * The gap this closes: every truck row was flattened into otherDirectCost
     * as rate x quantity, so a twelve mile haul and a two mile haul cost the
     * same. The engine has had `analyzeHaulCycle` from the start and the
     * pricing path never called it.
     */
    const input = buildEstimateInput(snapshot({
      resources: [typed({
        id: 'r-truck', resource_kind: 'trucking', description: 'Quad-Axle Dump Truck',
        haul_mode: 'trip', round_trip_miles: '12', average_speed_mph: '25',
        truck_capacity: '22', load_minutes: '7', dump_minutes: '4',
        queue_minutes: '10', unit_rate: '135', quantity: '1', unit: 'CY',
      })],
    }), ASOF);
    const haul = input.input.lines[0]!.haul!;
    // Round trip halved, because the number on the plan is the round trip.
    expect(haul.oneWayMiles).toBe(6);
    expect(haul.truckCapacity).toBe(22);
    expect(haul.loadedSpeedMph).toBe(25);
    expect(haul.emptySpeedMph).toBe(25);
    expect(haul.dumpMinutes).toBe(4);
    expect(haul.delayMinutes).toBe(10);
    expect(haul.truckHourlyRate).toBe(135);
    // And it is not silently double-counted as a flat direct cost.
    expect(input.input.lines[0]!.otherDirectCost ?? 0).toBe(0);
  });

  it('leaves an hourly truck as an hourly cost', () => {
    const input = buildEstimateInput(snapshot({
      resources: [typed({
        id: 'r-truck', resource_kind: 'trucking', description: 'Tri-axle',
        haul_mode: 'hours', unit_rate: '135', hours: '12', quantity: '1',
      })],
    }), ASOF);
    expect(input.input.lines[0]!.haul).toBeUndefined();
    expect(input.input.lines[0]!.otherDirectCost).toBe(135 * 12);
  });

  it('counts a trip haul as something to price, so the line is not called empty', () => {
    const input = buildEstimateInput(snapshot({
      lines: [line({ production_rates: null, crews: null })],
      resources: [typed({
        id: 'r-truck', resource_kind: 'trucking', haul_mode: 'trip',
        round_trip_miles: '12', average_speed_mph: '25', truck_capacity: '22',
        dump_minutes: '4', unit_rate: '135',
      })],
    }), ASOF);
    expect(input.problems.some((p) => p.field === 'resources')).toBe(false);
  });
});
