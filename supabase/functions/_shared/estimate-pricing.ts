/**
 * Database rows into the estimating engine, and its result back out.
 *
 * Since migration 0058 the engine's outputs are writable only by
 * `app.record_engine_result()`, which is granted to `service_role` alone. That
 * makes this file the whole of the pricing path: an Edge Function loads the
 * estimate, this maps it into `EstimateInput`, the engine computes, and this
 * maps the result into the payload the one permitted writer accepts.
 *
 * Deliberately pure. No Supabase client, no network, no clock — the loading is
 * the handler's job and the arithmetic is the engine's, so what is left here is
 * a translation that can be tested exhaustively without either. `asOf` is
 * passed in rather than read from the clock for the same reason the engine
 * refuses to read it: repricing a two-year-old estimate must resolve the rates
 * that were in force when it was priced, not today's.
 *
 * Two rules this file exists to keep:
 *
 *   1. **It computes nothing.** Every number it produces is a number it was
 *      given or one the engine returned. The moment this file starts deciding
 *      what a cost is, there are two estimating engines.
 *   2. **A missing input is reported, never defaulted into a price.** A line
 *      with no production rate, an equipment item with no rate candidates, a
 *      version with no pricing profile — each is a hole in an estimate somebody
 *      is about to bid, and quietly substituting a zero would put a confident
 *      number on a page that nothing supports.
 */
import {
  calculateEstimate, resolveEquipmentRate, ENGINE_VERSION,
  type EstimateInput, type EstimateLineInput, type EstimateResult,
  type PricingProfile, type ProductionRate, type Crew, type EquipmentItem,
  type MaterialRequirement, type ConditionModifier, type EquipmentRateCandidate,
  type QuantityInput, type IndirectCostItem,
} from './engine/index.js';

// ---------------------------------------------------------------------------
// The shape the handler loads
// ---------------------------------------------------------------------------
type Num = number | string | null | undefined;

export interface LaborRateRow {
  id: string; classification: string; labor_group: string | null;
  base_wage_per_hour: Num; burden_percent: Num;
  overtime_multiplier: Num; doubletime_multiplier: Num;
  region: string | null; effective_date: string | null; status: string | null;
}

export interface CrewMemberRow {
  headcount: Num;
  straight_hours_per_shift: Num;
  overtime_hours_per_shift: Num;
  doubletime_hours_per_shift: Num;
  labor_rates: LaborRateRow | null;
}

export interface CrewRow {
  id: string; name: string; shift_hours: Num; crew_members: CrewMemberRow[] | null;
}

export interface ProductionRateRow {
  id: string; task_id: string | null; rate_per_hour: Num; rate_unit: string;
  utilization_factor: Num; shift_hours: Num; source_type: string;
  confidence_score: Num; sample_size: Num; effective_date: string | null;
  region: string | null; approval_state: string | null; status: string | null;
}

export interface EquipmentRateRow {
  source: string; hourly_rate: Num; daily_rate: Num; weekly_rate: Num;
  monthly_rate: Num; effective_date: string | null; expires_on: string | null;
  reference: string | null;
}

export interface EquipmentRow {
  id: string; name: string; equipment_class: string;
  fuel_gallons_per_hour: Num; def_percent_of_fuel: Num;
  operator_required: boolean | null; mobilization_required: boolean | null;
  mobilization_cost: Num; equipment_rates: EquipmentRateRow[] | null;
}

export interface MaterialRow {
  id: string; name: string; unit: string; unit_cost: Num;
  vendor_id: string | null; quote_reference: string | null;
}

export interface ResourceRow {
  id: string; line_item_id: string; resource_kind: string;
  description: string | null; quantity: Num; unit: string | null;
  unit_rate: Num; hours: Num; headcount: number | null;
  quote_reference: string | null;
  equipment: EquipmentRow | null;
  materials: MaterialRow | null;
  labor_rates: LaborRateRow | null;
}

export interface ModifierRow {
  justification: string | null;
  condition_modifiers: {
    id: string; name: string; factors: Record<string, number> | null;
    application_rule: string | null; category: string | null; status: string | null;
  } | null;
}

export interface LineRow {
  id: string; description: string; sort_order: number;
  service_id: string | null; assembly_id: string | null; discipline: string | null;
  measured_quantity: Num; unit: string; measurement_method: string;
  waste_percent: Num; loss_percent: Num; waste_basis: string | null;
  quantity_adjustments: unknown; source_references: string[] | null;
  production_modifier: Num;
  check_primary_source: boolean | null;
  check_cross_source: boolean | null;
  check_reconciliation: boolean | null;
  conflict_count: number | null;
  has_open_rfi: boolean | null;
  documents_cannot_resolve: boolean | null;
  material_geotech_assumption: boolean | null;
  major_earthwork_decision: boolean | null;
  origin: string | null;
  notes: string | null;
  cost_codes: { code: string } | null;
  production_rates: ProductionRateRow | null;
  crews: CrewRow | null;
  estimate_line_modifiers: ModifierRow[] | null;
}

export interface IndirectRow {
  code: string; label: string; amount: Num; percent_of_direct: Num;
  per_day: Num; days: Num;
}

export interface MarkupRow {
  code: string; label: string; percent: Num; basis: string;
  sequence: number; disclosed: boolean | null;
}

export interface ProfileRow {
  id: string; name: string; method: string; region: string | null;
  regional_factor: Num; escalation_percent: Num; escalation_years: Num;
  markup_components: MarkupRow[] | null;
}

export interface VersionRow {
  id: string; version_number: number; status: string;
  shift_hours: Num; calendar_efficiency: Num;
  fuel_price_per_gallon: Num; def_price_per_gallon: Num;
  bid_rounding_increment: Num;
  contingency_source: string | null;
  applied_contingency: Num;
  contingency_override_reason: string | null;
  contingency_approved_by: string | null;
  pricing_profiles: ProfileRow | null;
}

export interface EstimateSnapshot {
  estimate: { id: string; number: string; name: string };
  version: VersionRow;
  lines: LineRow[];
  resources: ResourceRow[];
  indirects: IndirectRow[];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
/** A numeric column, which PostgREST returns as a string to preserve precision. */
const n = (v: Num, fallback = 0): number => {
  if (v === null || v === undefined || v === '') return fallback;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : fallback;
};

/** A nullable numeric, kept nullable — zero and "not stated" are different. */
const maybe = (v: Num): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : undefined;
};

/** Embedded rows arrive as an object or a single-element array depending on the join. */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  (Array.isArray(v) ? v[0] : v) ?? null;

/**
 * A problem serious enough that pricing should not proceed silently.
 *
 * Collected rather than thrown, so one run reports every hole in an estimate
 * instead of the first — an estimator fixing them one exception at a time is an
 * estimator who stops using the button.
 */
export interface PricingProblem {
  lineId: string | null;
  field: string;
  detail: string;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------
function toPricingProfile(p: ProfileRow): PricingProfile {
  return {
    id: p.id,
    name: p.name,
    method: p.method === 'stacked' ? 'stacked' : 'parallel',
    components: (p.markup_components ?? [])
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((c) => ({
        code: c.code,
        label: c.label,
        percent: n(c.percent),
        basis: c.basis as PricingProfile['components'][number]['basis'],
        sequence: c.sequence,
        ...(c.disclosed === null ? {} : { disclosed: c.disclosed }),
      })),
    ...(p.region ? { region: p.region } : {}),
    ...(maybe(p.regional_factor) === undefined ? {} : { regionalFactor: n(p.regional_factor) }),
    ...(maybe(p.escalation_percent) === undefined ? {} : { escalationPercent: n(p.escalation_percent) }),
    ...(maybe(p.escalation_years) === undefined ? {} : { escalationYears: n(p.escalation_years) }),
  };
}

function toCrew(c: CrewRow, fallbackShiftHours: number): Crew {
  return {
    id: c.id,
    name: c.name,
    shiftHours: n(c.shift_hours, fallbackShiftHours),
    members: (c.crew_members ?? [])
      .map((m) => {
        const rate = one(m.labor_rates);
        if (!rate) return null;
        return {
          classification: {
            id: rate.id,
            classification: rate.classification,
            group: rate.labor_group ?? rate.classification,
            baseWagePerHour: n(rate.base_wage_per_hour),
            burdenPercent: n(rate.burden_percent),
            overtimeMultiplier: n(rate.overtime_multiplier, 1.5),
            doubletimeMultiplier: n(rate.doubletime_multiplier, 2),
            ...(rate.region ? { region: rate.region } : {}),
            ...(rate.effective_date ? { effectiveDate: rate.effective_date } : {}),
          },
          count: n(m.headcount, 1),
          ...(maybe(m.straight_hours_per_shift) === undefined
            ? {} : { straightHoursPerShift: n(m.straight_hours_per_shift) }),
          ...(maybe(m.overtime_hours_per_shift) === undefined
            ? {} : { overtimeHoursPerShift: n(m.overtime_hours_per_shift) }),
          ...(maybe(m.doubletime_hours_per_shift) === undefined
            ? {} : { doubletimeHoursPerShift: n(m.doubletime_hours_per_shift) }),
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null),
  };
}

/**
 * A crew assembled from the line's own labor resources.
 *
 * A line can carry labor either by naming a crew from the library or by listing
 * classifications directly, and both are legitimate. Synthesizing a crew for
 * the second case means the engine sees one shape and the cost of labor is
 * computed by the same code either way.
 */
function crewFromResources(
  lineId: string, resources: ResourceRow[], shiftHours: number,
): Crew | null {
  const labor = resources.filter((r) => r.resource_kind === 'labor' && one(r.labor_rates));
  if (labor.length === 0) return null;
  return {
    id: `line:${lineId}`,
    name: 'Line labor',
    shiftHours,
    members: labor.map((r) => {
      const rate = one(r.labor_rates)!;
      return {
        classification: {
          id: rate.id,
          classification: rate.classification,
          group: rate.labor_group ?? rate.classification,
          baseWagePerHour: n(rate.base_wage_per_hour),
          burdenPercent: n(rate.burden_percent),
          overtimeMultiplier: n(rate.overtime_multiplier, 1.5),
          doubletimeMultiplier: n(rate.doubletime_multiplier, 2),
          ...(rate.region ? { region: rate.region } : {}),
        },
        count: r.headcount ?? Math.max(1, Math.round(n(r.quantity, 1))),
      };
    }),
  };
}

function toEquipment(
  r: ResourceRow, asOf: string, problems: PricingProblem[],
): EquipmentItem | null {
  const e = one(r.equipment);
  if (!e) {
    problems.push({
      lineId: r.line_item_id, field: 'equipment',
      detail: `An equipment resource on this line names no catalog item, so it has no rate to be priced at.`,
    });
    return null;
  }

  const candidates: EquipmentRateCandidate[] = (e.equipment_rates ?? []).map((x) => ({
    source: x.source as EquipmentRateCandidate['source'],
    hourlyRate: n(x.hourly_rate),
    ...(maybe(x.daily_rate) === undefined ? {} : { dailyRate: n(x.daily_rate) }),
    ...(maybe(x.weekly_rate) === undefined ? {} : { weeklyRate: n(x.weekly_rate) }),
    ...(maybe(x.monthly_rate) === undefined ? {} : { monthlyRate: n(x.monthly_rate) }),
    ...(x.effective_date ? { effectiveDate: x.effective_date } : {}),
    ...(x.expires_on ? { expiresOn: x.expires_on } : {}),
    ...(x.reference ? { reference: x.reference } : {}),
  }));

  // A rate typed onto the estimate line itself is a project quote: it is the
  // most specific thing anybody said about what this machine costs on this job,
  // and RULE-003 ranks it first.
  if (maybe(r.unit_rate) !== undefined && n(r.unit_rate) > 0) {
    candidates.unshift({
      source: 'project_quote',
      hourlyRate: n(r.unit_rate),
      ...(r.quote_reference ? { reference: r.quote_reference } : {}),
    });
  }

  if (candidates.length === 0) {
    problems.push({
      lineId: r.line_item_id, field: 'equipment_rate',
      detail: `${e.name} carries no rate in force. Add a rate to the equipment library, or quote one on the line.`,
    });
    return null;
  }

  return {
    id: e.id,
    name: e.name,
    equipmentClass: e.equipment_class,
    // The engine's own precedence, applied by the engine's own function. This
    // file does not get an opinion about which rate wins.
    rate: resolveEquipmentRate(candidates, asOf),
    count: Math.max(1, Math.round(n(r.quantity, 1))),
    fuelGallonsPerHour: n(e.fuel_gallons_per_hour),
    ...(maybe(e.def_percent_of_fuel) === undefined
      ? {} : { defPercentOfFuel: n(e.def_percent_of_fuel) }),
    operatorRequired: e.operator_required ?? false,
    ...(e.mobilization_required === null ? {} : { mobilizationRequired: e.mobilization_required }),
    ...(maybe(e.mobilization_cost) === undefined
      ? {} : { mobilizationCost: n(e.mobilization_cost) }),
  };
}

function toMaterial(r: ResourceRow, problems: PricingProblem[]): MaterialRequirement | null {
  const m = one(r.materials);
  const unitCost = maybe(r.unit_rate) ?? maybe(m?.unit_cost);
  if (unitCost === undefined) {
    problems.push({
      lineId: r.line_item_id, field: 'material_cost',
      detail: `${m?.name ?? r.description ?? 'A material'} on this line has no unit cost.`,
    });
    return null;
  }
  return {
    id: m?.id ?? r.id,
    name: m?.name ?? r.description ?? 'Material',
    quantity: n(r.quantity),
    unit: r.unit ?? m?.unit ?? 'EA',
    unitCost,
    ...(m?.quote_reference ? { quoteReference: m.quote_reference } : {}),
  };
}

function toProductionRate(p: ProductionRateRow, fallbackShiftHours: number): ProductionRate {
  return {
    id: p.id,
    ...(p.task_id ? { taskId: p.task_id } : {}),
    ratePerHour: n(p.rate_per_hour),
    unit: p.rate_unit,
    utilizationFactor: n(p.utilization_factor, 1),
    shiftHours: n(p.shift_hours, fallbackShiftHours),
    sourceType: p.source_type as ProductionRate['sourceType'],
    confidence: n(p.confidence_score),
    ...(maybe(p.sample_size) === undefined ? {} : { sampleSize: n(p.sample_size) }),
    ...(p.effective_date ? { effectiveDate: p.effective_date } : {}),
    ...(p.region ? { region: p.region } : {}),
    ...(p.status ? { approvalStatus: p.status as ProductionRate['approvalStatus'] } : {}),
  };
}

function toModifiers(rows: ModifierRow[] | null) {
  return (rows ?? [])
    .map((r) => {
      const c = one(r.condition_modifiers);
      if (!c) return null;
      const modifier: ConditionModifier = {
        id: c.id,
        name: c.name,
        factors: (c.factors ?? {}) as ConditionModifier['factors'],
        applicationRule: c.application_rule ?? '',
        ...(c.category ? { category: c.category } : {}),
        ...(c.status ? { status: c.status as ConditionModifier['status'] } : {}),
      };
      // The justification is required by the application layer, and an
      // unjustified modifier on a bid is exactly what that rule exists to stop.
      return { modifier, justification: r.justification ?? '' };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);
}

function toQuantity(l: LineRow): QuantityInput {
  const adjustments = Array.isArray(l.quantity_adjustments)
    ? (l.quantity_adjustments as QuantityInput['adjustments'])
    : undefined;
  return {
    measured: n(l.measured_quantity),
    unit: l.unit as QuantityInput['unit'],
    method: l.measurement_method as QuantityInput['method'],
    ...(adjustments && adjustments.length ? { adjustments } : {}),
    ...(maybe(l.waste_percent) === undefined ? {} : { wastePercent: n(l.waste_percent) }),
    ...(maybe(l.loss_percent) === undefined ? {} : { lossPercent: n(l.loss_percent) }),
    ...(l.waste_basis ? { wasteBasis: l.waste_basis } : {}),
    ...(l.source_references?.length ? { sources: l.source_references } : {}),
  };
}

// ---------------------------------------------------------------------------
// The whole estimate
// ---------------------------------------------------------------------------
export interface BuiltInput {
  input: EstimateInput;
  problems: PricingProblem[];
}

/**
 * Build the engine's input from a loaded snapshot.
 *
 * `asOf` decides which rates were in force, and is the caller's to supply — the
 * estimate's own date, not today's, so reopening an old estimate reproduces the
 * price it was given rather than silently repricing it.
 */
export function buildEstimateInput(s: EstimateSnapshot, asOf: string): BuiltInput {
  const problems: PricingProblem[] = [];
  const v = s.version;
  const shiftHours = n(v.shift_hours, 8);

  const profileRow = one(v.pricing_profiles);
  if (!profileRow) {
    problems.push({
      lineId: null, field: 'pricing_profile',
      detail: 'This estimate version names no pricing profile, so there is no markup to apply. '
        + 'Set one on the version, or make one the company default.',
    });
  }

  const byLine = new Map<string, ResourceRow[]>();
  for (const r of s.resources) {
    const list = byLine.get(r.line_item_id);
    if (list) list.push(r); else byLine.set(r.line_item_id, [r]);
  }

  const lines: EstimateLineInput[] = s.lines
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((l): EstimateLineInput => {
      const rs = byLine.get(l.id) ?? [];
      const crewRow = one(l.crews);
      const crew = crewRow ? toCrew(crewRow, shiftHours) : crewFromResources(l.id, rs, shiftHours);
      const rate = one(l.production_rates);

      const equipment = rs.filter((r) => r.resource_kind === 'equipment')
        .map((r) => toEquipment(r, asOf, problems))
        .filter((e): e is EquipmentItem => e !== null);
      const materials = rs.filter((r) => r.resource_kind === 'material')
        .map((r) => toMaterial(r, problems))
        .filter((m): m is MaterialRequirement => m !== null);

      // Subcontract and disposal are a price, not a build-up: the engine takes
      // them as direct cost rather than resolving resources for them.
      const sum = (kind: string) => rs
        .filter((r) => r.resource_kind === kind)
        .reduce((a, r) => a + (maybe(r.unit_rate) !== undefined
          ? n(r.unit_rate) * n(r.quantity, 1) : 0), 0);
      const subcontractCost = sum('subcontract');
      const otherDirectCost = sum('disposal') + sum('trucking');

      if (!rate && !crew && equipment.length === 0 && materials.length === 0
          && subcontractCost === 0 && otherDirectCost === 0) {
        problems.push({
          lineId: l.id, field: 'resources',
          detail: `"${l.description}" has no crew, equipment, material, subcontract or `
            + 'production rate on it. There is nothing to price.',
        });
      }

      return {
        id: l.id,
        description: l.description,
        ...(l.service_id ? { serviceId: l.service_id } : {}),
        ...(l.assembly_id ? { assemblyId: l.assembly_id } : {}),
        ...(one(l.cost_codes)?.code ? { costCode: one(l.cost_codes)!.code } : {}),
        ...(l.discipline ? { discipline: l.discipline } : {}),
        quantity: toQuantity(l),
        modifiers: toModifiers(l.estimate_line_modifiers),
        ...(rate ? { productionRate: toProductionRate(rate, shiftHours) } : {}),
        ...(crew ? { crew } : {}),
        ...(equipment.length ? { equipment } : {}),
        ...(materials.length ? { materials } : {}),
        ...(subcontractCost ? { subcontractCost } : {}),
        ...(otherDirectCost ? { otherDirectCost } : {}),
        fuelPricePerGallon: n(v.fuel_price_per_gallon),
        defPricePerGallon: n(v.def_price_per_gallon),
        calendarEfficiency: n(v.calendar_efficiency, 1),
        verification: {
          primarySource: l.check_primary_source ?? false,
          crossSource: l.check_cross_source ?? false,
          mathematicalReconciliation: l.check_reconciliation ?? false,
        },
        conflictCount: l.conflict_count ?? 0,
        hasOpenRfi: l.has_open_rfi ?? false,
        documentsCannotResolve: l.documents_cannot_resolve ?? false,
        materialGeotechnicalAssumption: l.material_geotech_assumption ?? false,
        majorEarthworkDecision: l.major_earthwork_decision ?? false,
        aiGenerated: l.origin === 'ai_suggested',
        ...(l.notes ? { notes: l.notes } : {}),
      };
    });

  const indirects: IndirectCostItem[] = s.indirects.map((i) => ({
    code: i.code,
    label: i.label,
    ...(maybe(i.amount) === undefined ? {} : { amount: n(i.amount) }),
    ...(maybe(i.percent_of_direct) === undefined ? {} : { percentOfDirect: n(i.percent_of_direct) }),
    ...(maybe(i.per_day) === undefined ? {} : { perDay: n(i.per_day) }),
    ...(maybe(i.days) === undefined ? {} : { days: n(i.days) }),
  }));

  const input: EstimateInput = {
    id: s.estimate.id,
    number: s.estimate.number,
    name: s.estimate.name,
    version: v.version_number,
    status: v.status as EstimateInput['status'],
    lines,
    ...(indirects.length ? { indirects } : {}),
    // A profile is required by the engine's type. Where there is none, an empty
    // one applies no markup — and the problem above says so plainly, so the
    // handler refuses rather than writing a cost-only price.
    pricingProfile: profileRow
      ? toPricingProfile(profileRow)
      : { id: 'none', name: 'No pricing profile', method: 'parallel', components: [] },
    ...(maybe(v.bid_rounding_increment) === undefined
      ? {} : { bidRoundingIncrement: n(v.bid_rounding_increment) }),
    ...(v.contingency_source === 'override'
      && v.contingency_override_reason && v.contingency_approved_by
      ? {
          contingencyOverride: {
            percent: n(v.applied_contingency),
            approvedBy: v.contingency_approved_by,
            reason: v.contingency_override_reason,
          },
        }
      : {}),
  };

  return { input, problems };
}

// ---------------------------------------------------------------------------
// The result, on its way back
// ---------------------------------------------------------------------------
export interface EnginePayload {
  engineVersion: string;
  version: Record<string, unknown>;
  lines: Record<string, unknown>[];
}

/**
 * The result, in the shape `app.record_engine_result()` accepts.
 *
 * Column names rather than engine names, because the destination is a table.
 * Nothing is computed here — every value is read straight off the result.
 */
export function toEnginePayload(r: EstimateResult): EnginePayload {
  const d = r.directCost;
  return {
    engineVersion: ENGINE_VERSION,
    version: {
      direct_cost: r.totalDirectCost,
      cost_labor_wage: d.laborWage,
      cost_labor_burden: d.laborBurden,
      cost_equipment: d.equipmentOwnership,
      cost_equipment_mob: d.equipmentMobilization,
      cost_fuel: d.fuel,
      cost_material: d.material,
      cost_trucking: d.trucking,
      cost_disposal: d.disposal,
      cost_subcontract: d.subcontract,
      cost_other: d.other,
      indirect_cost: r.indirectCost,
      total_markup: r.price.totalMarkup,
      total_price: r.price.totalPrice,
      bid_price: r.bidPrice,
      total_labor_hours: r.totalLaborHours,
      total_equipment_hours: r.totalEquipmentHours,
      total_fuel_gallons: r.totalFuelGallons,
      total_duration_days: r.totalDurationDays,
      weighted_confidence: r.weightedConfidence,
      confidence_band: r.confidenceBand,
      recommended_contingency: r.recommendedContingency,
      executive_decision: r.executiveDecision,
      blocked_from_issue: r.blockedFromIssue,
      calculation_warnings: r.warnings,
    },
    lines: r.lines.map((l) => ({
      id: l.id,
      adjusted_quantity: l.quantity.adjusted,
      gross_quantity: l.quantity.gross,
      theoretical_production: l.production?.theoreticalPerHour ?? null,
      practical_production: l.production?.practicalPerHour ?? null,
      recommended_production: l.production?.recommendedPerHour ?? null,
      productive_hours: l.duration?.productiveHours ?? 0,
      practical_days: l.duration?.practicalDays ?? 0,
      cost_labor_wage: l.directCost.laborWage,
      cost_labor_burden: l.directCost.laborBurden,
      cost_equipment: l.directCost.equipmentOwnership,
      cost_equipment_mob: l.directCost.equipmentMobilization,
      cost_fuel: l.directCost.fuel,
      cost_material: l.directCost.material,
      cost_trucking: l.directCost.trucking,
      cost_disposal: l.directCost.disposal,
      cost_subcontract: l.directCost.subcontract,
      cost_other: l.directCost.other,
      total_direct_cost: l.totalDirectCost,
      unit_cost: l.unitCost,
      labor_hours: l.laborHours,
      equipment_hours: l.equipmentHours,
      fuel_gallons: l.fuelGallons,
      confidence_score: l.confidence.score,
      confidence_band: l.confidence.band,
      verification_status: l.confidence.verificationStatus,
      approval_gate: l.approval.gate,
      blocks_issue: l.approval.blocksIssue,
      derivation: l.derivation,
      warnings: l.warnings,
    })),
  };
}

/** Build, price, and shape the result. The whole path in one call. */
export function priceEstimate(s: EstimateSnapshot, asOf: string): {
  problems: PricingProblem[];
  result: EstimateResult;
  payload: EnginePayload;
} {
  const { input, problems } = buildEstimateInput(s, asOf);
  const result = calculateEstimate(input);
  return { problems, result, payload: toEnginePayload(result) };
}
