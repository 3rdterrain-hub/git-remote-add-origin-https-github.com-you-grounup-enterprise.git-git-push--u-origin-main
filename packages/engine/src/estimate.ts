/**
 * Estimate line and estimate rollup — the orchestrator.
 *
 * This is the only entry point the application layer calls to price work. It
 * threads quantity -> conditions -> production -> duration -> crew / equipment /
 * fuel / material / haul -> direct cost -> markup -> price, and returns every
 * intermediate value, because RULE-001 and Section 23 both require the
 * calculation to be inspectable rather than merely correct.
 */

import { assertNonNegative, factor, money, roundTo, safeDivide, sumMoney, unitRate } from './numeric.js';
import { resolveQuantity, type QuantityInput, type QuantityResult } from './quantity.js';
import {
  analyzeBottleneck,
  analyzeProduction,
  calculateDuration,
  resolveModifiers,
  type BottleneckAnalysis,
  type ConditionModifier,
  type DurationResult,
  type ProductionAnalysis,
  type ProductionRate,
  type ResourceCapacity,
} from './production.js';
import {
  calculateCrewCost,
  calculateEquipmentCost,
  type Crew,
  type CrewCostResult,
  type EquipmentCostResult,
  type EquipmentItem,
} from './resources.js';
import { analyzeHaulCycle, type HaulCycleInput, type HaulCycleResult } from './trucking.js';
import {
  addDirectCost,
  applyCostModifiers,
  calculatePrice,
  EMPTY_DIRECT_COST,
  totalDirectCost,
  unitPrice,
  type DirectCostBreakdown,
  type PriceResult,
  type PricingProfile,
} from './pricing.js';
import {
  evaluateApprovalGate,
  scoreConfidence,
  type ApprovalGateResult,
  type ConfidenceResult,
  type VerificationChecks,
} from './confidence.js';

export interface MaterialRequirement {
  id: string;
  name: string;
  /** Quantity in the material's own unit, already grossed for waste. */
  quantity: number;
  unit: string;
  unitCost: number;
  /** Delivery/freight, kept out of the unit cost so it stays comparable. */
  deliveryCost?: number;
  supplier?: string;
  quoteReference?: string;
}

export interface EstimateLineInput {
  id: string;
  description: string;
  serviceId?: string;
  assemblyId?: string;
  costCode?: string;
  discipline?: string;

  quantity: QuantityInput;

  /** Condition modifiers with the estimator's justification for each. */
  modifiers?: readonly { modifier: ConditionModifier; justification: string }[];

  productionRate?: ProductionRate;
  /** Additional resources that may govern production (RULE-005). */
  constrainingResources?: readonly ResourceCapacity[];

  crew?: Crew;
  equipment?: readonly EquipmentItem[];
  materials?: readonly MaterialRequirement[];
  haul?: Omit<HaulCycleInput, 'loaderProductionPerHour' | 'shiftHours'> &
    Partial<Pick<HaulCycleInput, 'loaderProductionPerHour' | 'shiftHours'>>;
  subcontractCost?: number;
  otherDirectCost?: number;

  /**
   * A rate the estimator typed, per unit, instead of building the line up.
   *
   * Not every line is built up. A subcontract quote, an allowance, a number
   * somebody simply knows — before this existed the only way to price one was
   * to invent resources until the arithmetic came out right, which is worse
   * than typing the number and saying where it came from.
   *
   * The column has existed since migration 0120 and the engine never read it.
   * A line priced this way was reported by the pricing path as having "no crew,
   * equipment, material, subcontract or production rate on it. There is nothing
   * to price" — and because that is a refusal rather than a warning, one such
   * line returned a 422 and stopped the whole estimate from pricing. The rate
   * was on the screen, on the record, and in none of the arithmetic.
   *
   * It is multiplied here rather than by the caller so it uses the same
   * adjusted quantity as everything else on the line: waste and loss apply to a
   * quoted rate exactly as they apply to a built-up one, and a caller doing its
   * own multiplication would silently use the measured quantity instead.
   */
  parametricCostPerUnit?: number;
  /**
   * Where that rate came from, and why it is required.
   *
   * "Sub quote, Delaney Bros, 14 Aug" and "roughly what we got last year" are
   * different claims, and an estimate that cannot tell them apart cannot be
   * reviewed. The database refuses a rate without one; the engine refuses to
   * price one, for the same reason.
   */
  parametricBasis?: string;

  fuelPricePerGallon?: number;
  defPricePerGallon?: number;

  /**
   * This line's own markup as a fraction, or null to use the pricing profile.
   *
   * The column has existed since migration 0107 and the engine never read it,
   * so a markup typed on a line changed the number on screen and nothing about
   * the price. A line that differs from the company standard is the estimator's
   * judgment about that scope, and the estimate has to reflect it.
   */
  markupOverride?: number | null;

  /** Fixed hours that do not scale with quantity. */
  fixedHours?: number;
  calendarEfficiency?: number;
  parallelCrews?: number;

  verification?: VerificationChecks;
  conflictCount?: number;
  assumptionCount?: number;
  hasOpenRfi?: boolean;
  documentsCannotResolve?: boolean;
  materialGeotechnicalAssumption?: boolean;
  majorEarthworkDecision?: boolean;
  aiGenerated?: boolean;

  assumptions?: readonly string[];
  exclusions?: readonly string[];
  notes?: string;
}

export interface EstimateLineResult {
  id: string;
  description: string;
  serviceId?: string;
  assemblyId?: string;
  costCode?: string;
  discipline?: string;

  quantity: QuantityResult;
  modifiers: ReturnType<typeof resolveModifiers>;
  production?: ProductionAnalysis;
  bottleneck?: BottleneckAnalysis;
  duration?: DurationResult;
  crew?: CrewCostResult;
  equipment?: EquipmentCostResult;
  haul?: HaulCycleResult;

  laborHours: number;
  equipmentHours: number;
  fuelGallons: number;

  /** Before cost modifiers. */
  rawDirectCost: DirectCostBreakdown;
  /** After cost modifiers — the figure that rolls up. */
  directCost: DirectCostBreakdown;
  totalDirectCost: number;
  unitCost: number;

  /**
   * What this line sells for, and the markup inside it.
   *
   * Filled in by `calculateEstimate`, which is the only place that knows the
   * profile — a line on its own has a cost and no price. The prices of every
   * line sum exactly to the estimate's price: the last cent is allocated rather
   * than rounded away, so a bid never disagrees with the lines it is made of.
   */
  markupRate: number;
  markupAmount: number;
  price: number;
  unitPrice: number;

  confidence: ConfidenceResult;
  approval: ApprovalGateResult;

  assumptions: readonly string[];
  exclusions: readonly string[];
  notes?: string;
  derivation: readonly string[];
  warnings: readonly string[];
}

const DEFAULT_VERIFICATION: VerificationChecks = {
  primarySource: true,
  crossSource: false,
  mathematicalReconciliation: false,
};

/**
 * Price one estimate line end to end.
 *
 * Production is resolved *before* cost, because duration drives crew and
 * equipment hours, which drive labor, ownership and fuel. Any line without a
 * production rate falls back to explicitly supplied hours; it never guesses a
 * rate, because an invented production rate is the fastest way to a confidently
 * wrong estimate.
 */
export function calculateEstimateLine(input: EstimateLineInput): EstimateLineResult {
  const warnings: string[] = [];
  const derivation: string[] = [];

  // 1. Quantity chain -------------------------------------------------------
  const quantity = resolveQuantity(input.quantity);
  warnings.push(...quantity.warnings);
  derivation.push(`QUANTITY: ${quantity.derivation}`);

  // 2. Condition modifiers --------------------------------------------------
  const modifiers = resolveModifiers(input.modifiers ?? []);
  warnings.push(...modifiers.warnings);
  if (modifiers.derivation.length) derivation.push(`MODIFIERS: ${modifiers.derivation.join(' | ')}`);

  // 3. Production and the resource that actually governs it -----------------
  let production: ProductionAnalysis | undefined;
  let bottleneck: BottleneckAnalysis | undefined;
  let effectiveProductionPerHour = 0;
  const shiftHours = input.productionRate?.shiftHours ?? input.crew?.shiftHours ?? 8;

  if (input.productionRate) {
    production = analyzeProduction(input.productionRate, modifiers.combined.production);
    warnings.push(...production.warnings);
    derivation.push(`PRODUCTION: ${production.derivation}`);
    effectiveProductionPerHour = production.recommendedPerHour;

    const resources: ResourceCapacity[] = [
      {
        id: input.productionRate.id,
        name: 'Primary production spread',
        kind: 'equipment',
        capacityPerHour: production.recommendedPerHour,
      },
      ...(input.constrainingResources ?? []),
    ];
    if (resources.length > 1) {
      bottleneck = analyzeBottleneck(resources);
      effectiveProductionPerHour = bottleneck.operationCapacityPerHour;
      derivation.push(
        `CONTROLLING RESOURCE: ${bottleneck.controllingResourceName} at ${bottleneck.operationCapacityPerHour}/hr — ${bottleneck.improvementNote}`,
      );
      if (bottleneck.controllingResourceId !== input.productionRate.id) {
        warnings.push(
          `Production is governed by ${bottleneck.controllingResourceName}, not the primary spread. ` +
            `The catalog production rate overstates this operation.`,
        );
      }
    }
  }

  // 4. Duration and hours ---------------------------------------------------
  let duration: DurationResult | undefined;
  if (effectiveProductionPerHour > 0) {
    duration = calculateDuration({
      quantity: quantity.adjusted,
      productionPerHour: effectiveProductionPerHour,
      shiftHours,
      fixedHours: input.fixedHours ?? 0,
      calendarEfficiency: input.calendarEfficiency ?? 1,
      parallelCrews: input.parallelCrews ?? 1,
    });
    derivation.push(`DURATION: ${duration.derivation}`);
  } else if (input.crew || input.equipment?.length) {
    warnings.push(
      'No production rate is attached, so crew and equipment hours cannot be derived from quantity. ' +
        'Attach a production rate or the line will price at zero hours.',
    );
  }

  /*
   * Crew cost is charged on the unrounded shift count, not the rounded one a
   * schedule shows. `practicalDays` is rounded to two decimals for reading;
   * pricing labor from it and multiplying back up by the shift length made a
   * line's labor hours disagree with its own equipment hours and with anybody's
   * calculator. See `DurationResult.paidShifts`.
   */
  const shifts = duration ? duration.paidShifts : 0;
  const operatingHoursPerUnit = duration ? duration.totalHours : 0;

  // 5. Crew -----------------------------------------------------------------
  let crew: CrewCostResult | undefined;
  if (input.crew) {
    crew = calculateCrewCost(input.crew, shifts);
    warnings.push(...crew.warnings);
    derivation.push(`CREW: ${crew.derivation}`);
  }

  // 6. Equipment and fuel ---------------------------------------------------
  let equipment: EquipmentCostResult | undefined;
  if (input.equipment?.length) {
    equipment = calculateEquipmentCost(
      input.equipment,
      operatingHoursPerUnit,
      input.fuelPricePerGallon ?? 0,
      input.defPricePerGallon ?? 0,
    );
    warnings.push(...equipment.warnings);
    derivation.push(`EQUIPMENT: ${equipment.derivation}`);
    if ((input.fuelPricePerGallon ?? 0) === 0 && equipment.fuelGallons > 0) {
      warnings.push(
        `${equipment.fuelGallons} gallons of fuel are consumed but no fuel price is set; fuel cost is zero.`,
      );
    }
  }

  // 7. Materials ------------------------------------------------------------
  let materialCost = 0;
  for (const m of input.materials ?? []) {
    assertNonNegative(m.quantity, `material ${m.id} quantity`);
    assertNonNegative(m.unitCost, `material ${m.id} unitCost`);
    materialCost += m.quantity * m.unitCost + (m.deliveryCost ?? 0);
    if (!m.quoteReference) {
      warnings.push(`Material "${m.name}" carries no quote reference; the unit cost is unsourced.`);
    }
  }
  if (materialCost > 0) {
    derivation.push(`MATERIAL: ${(input.materials ?? []).length} item(s) = ${money(materialCost)}`);
  }

  // 8. Haul and disposal ----------------------------------------------------
  let haul: HaulCycleResult | undefined;
  if (input.haul) {
    const loaderProduction =
      input.haul.loaderProductionPerHour ?? (effectiveProductionPerHour > 0 ? effectiveProductionPerHour : undefined);
    if (loaderProduction === undefined) {
      warnings.push(
        'A haul was defined but no loading production is available to size the fleet against; haul not priced.',
      );
    } else {
      haul = analyzeHaulCycle({
        ...input.haul,
        loaderProductionPerHour: loaderProduction,
        shiftHours: input.haul.shiftHours ?? shiftHours,
      });
      warnings.push(...haul.warnings);
      derivation.push(`HAUL: ${haul.derivation}`);
      derivation.push(`HAUL BALANCE: ${haul.balanceNote}`);
    }
  }

  /*
   * 8b. A rate somebody typed, times the quantity it is a rate for.
   *
   * Filed under `other` rather than `subcontract`, because the platform scores
   * a typed rate as an allowance and that is what decides the review it faces.
   * Calling it a subcontract would understate the review a guess needs and
   * overstate what a quote is (RULE-001: the buckets are not interchangeable).
   */
  const parametricRate = input.parametricCostPerUnit ?? 0;
  if (parametricRate < 0) {
    warnings.push(
      `A typed rate cannot be negative; ${parametricRate} per ${input.quantity.unit} `
      + 'was ignored.');
  }
  if (parametricRate > 0 && !input.parametricBasis?.trim()) {
    warnings.push(
      'A typed rate has to say where it came from. A quote and a guess are different '
      + 'claims and a reviewer cannot tell them apart without one.');
  }
  const parametricCost = parametricRate > 0
    ? money(parametricRate * quantity.adjusted)
    : 0;
  if (parametricCost > 0) {
    derivation.push(
      `PARAMETRIC: ${parametricRate} per ${input.quantity.unit} x ${quantity.adjusted} `
      + `= ${parametricCost}`
      + (input.parametricBasis ? ` (${input.parametricBasis})` : ''));
  }

  // 9. Direct cost, before and after cost modifiers --------------------------
  const rawDirectCost: DirectCostBreakdown = {
    laborWage: crew?.baseWageCost ?? 0,
    laborBurden: money((crew?.burdenCost ?? 0) + (crew?.overtimePremiumCost ?? 0)),
    equipmentOwnership: equipment?.ownershipCost ?? 0,
    equipmentMobilization: equipment?.mobilizationCost ?? 0,
    fuel: money((equipment?.fuelCost ?? 0) + (equipment?.defCost ?? 0)),
    material: money(materialCost),
    trucking: haul?.truckingCost ?? 0,
    disposal: haul?.disposalCost ?? 0,
    subcontract: money(input.subcontractCost ?? 0),
    other: money((input.otherDirectCost ?? 0) + parametricCost),
  };

  const directCost = applyCostModifiers(rawDirectCost, {
    labor_cost: modifiers.combined.labor_cost,
    equipment_cost: modifiers.combined.equipment_cost,
    material_cost: modifiers.combined.material_cost,
    trucking_cost: modifiers.combined.trucking_cost,
    disposal_cost: modifiers.combined.disposal_cost,
  });

  const total = totalDirectCost(directCost);
  derivation.push(`DIRECT COST: ${total} (${describeBreakdown(directCost)})`);

  // 10. Confidence and approval routing -------------------------------------
  const confidence = scoreConfidence({
    measurementMethod: quantity.method,
    checks: input.verification ?? DEFAULT_VERIFICATION,
    ...(input.productionRate ? { dataSource: input.productionRate.sourceType } : {}),
    conflictCount: input.conflictCount ?? 0,
    assumptionCount: input.assumptionCount ?? (input.assumptions ?? []).length,
    sourceCount: quantity.sources.length,
    warningCount: warnings.length,
    hasOpenRfi: input.hasOpenRfi ?? false,
  });

  const approval = evaluateApprovalGate({
    confidence: confidence.score,
    measurementMethod: quantity.method,
    hasConflict: (input.conflictCount ?? 0) > 0,
    documentsCannotResolve: input.documentsCannotResolve ?? false,
    materialGeotechnicalAssumption: input.materialGeotechnicalAssumption ?? false,
    majorEarthworkDecision: input.majorEarthworkDecision ?? false,
    aiGenerated: input.aiGenerated ?? false,
  });

  return {
    id: input.id,
    description: input.description,
    ...(input.serviceId ? { serviceId: input.serviceId } : {}),
    ...(input.assemblyId ? { assemblyId: input.assemblyId } : {}),
    ...(input.costCode ? { costCode: input.costCode } : {}),
    ...(input.discipline ? { discipline: input.discipline } : {}),
    quantity,
    modifiers,
    ...(production ? { production } : {}),
    ...(bottleneck ? { bottleneck } : {}),
    ...(duration ? { duration } : {}),
    ...(crew ? { crew } : {}),
    ...(equipment ? { equipment } : {}),
    ...(haul ? { haul } : {}),
    laborHours: crew?.totalLaborHours ?? 0,
    equipmentHours: equipment?.totalEquipmentHours ?? 0,
    fuelGallons: equipment?.fuelGallons ?? 0,
    rawDirectCost,
    directCost,
    totalDirectCost: total,
    unitCost: unitRate(safeDivide(total, quantity.adjusted)),
    /* A line on its own has a cost. `calculateEstimate` fills these in, because
       the price needs the profile and the profile belongs to the estimate. */
    markupRate: 0,
    markupAmount: 0,
    price: total,
    unitPrice: unitRate(safeDivide(total, quantity.adjusted)),
    confidence,
    approval,
    assumptions: input.assumptions ?? [],
    exclusions: input.exclusions ?? [],
    ...(input.notes ? { notes: input.notes } : {}),
    derivation,
    warnings,
  };
}

function describeBreakdown(d: DirectCostBreakdown): string {
  return Object.entries(d)
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ') || 'no cost';
}

// ---------------------------------------------------------------------------
// Estimate rollup
// ---------------------------------------------------------------------------

export interface IndirectCostItem {
  code: string;
  label: string;
  /** Fixed amount, or a percentage of direct cost when `percentOfDirect` is set. */
  amount?: number;
  percentOfDirect?: number;
  /** Duration-driven general conditions: amount per day x project days. */
  perDay?: number;
  days?: number;
}

export type EstimateStatus = 'draft' | 'in_review' | 'approved' | 'issued' | 'awarded' | 'lost' | 'archived';

export interface EstimateInput {
  id: string;
  number: string;
  name: string;
  version: number;
  status: EstimateStatus;
  lines: readonly EstimateLineInput[];
  indirects?: readonly IndirectCostItem[];
  pricingProfile: PricingProfile;
  /** Round the final bid up to this increment. 0 disables. */
  bidRoundingIncrement?: number;
  /** Override the confidence-derived contingency with an explicit decision. */
  contingencyOverride?: { percent: number; approvedBy: string; reason: string };
}

export interface EstimateResult {
  id: string;
  number: string;
  name: string;
  version: number;
  status: EstimateStatus;
  lines: readonly EstimateLineResult[];

  directCost: DirectCostBreakdown;
  totalDirectCost: number;
  indirectCost: number;
  indirectDetail: readonly { code: string; label: string; amount: number; basis: string }[];

  price: PriceResult;
  bidPrice: number;
  bidRoundingAdjustment: number;

  totalLaborHours: number;
  totalEquipmentHours: number;
  totalFuelGallons: number;
  totalDurationDays: number;

  /** Cost-weighted confidence across all lines. */
  weightedConfidence: number;
  confidenceBand: ConfidenceResult['band'];
  recommendedContingency: number;
  appliedContingency: number;
  contingencySource: 'confidence_band' | 'profile' | 'override';

  /** Lines routed to each gate. */
  approvalSummary: Record<ApprovalGateResult['gate'], readonly string[]>;
  blockedFromIssue: boolean;
  /** Section 59 executive decision. */
  executiveDecision:
    | 'ready_for_estimating'
    | 'ready_with_assumptions'
    | 'senior_review_required'
    | 'rfi_resolution_required'
    | 'document_set_incomplete';
  executiveDecisionReason: string;

  assumptions: readonly string[];
  exclusions: readonly string[];
  warnings: readonly string[];
}

/**
 * Roll a set of lines into a priced estimate.
 *
 * Contingency is resolved from the *weighted* confidence of the whole estimate,
 * not from a per-line average: a 60-confidence item worth $2,000 should not drag
 * a $2M estimate into a 12% contingency, and a 60-confidence item worth $800,000
 * absolutely should.
 */
export function calculateEstimate(input: EstimateInput): EstimateResult {
  const lines = input.lines.map(calculateEstimateLine);
  const warnings: string[] = [];

  let directCost = { ...EMPTY_DIRECT_COST };
  for (const l of lines) directCost = addDirectCost(directCost, l.directCost);
  const totalDirect = totalDirectCost(directCost);

  // Indirects -------------------------------------------------------------
  const indirectDetail: { code: string; label: string; amount: number; basis: string }[] = [];
  for (const item of input.indirects ?? []) {
    let amount = 0;
    let basis = '';
    if (item.amount !== undefined) {
      amount += item.amount;
      basis = `fixed ${money(item.amount)}`;
    }
    if (item.percentOfDirect !== undefined) {
      const v = totalDirect * item.percentOfDirect;
      amount += v;
      basis = `${factor(item.percentOfDirect * 100)}% of direct cost ${totalDirect} = ${money(v)}`;
    }
    if (item.perDay !== undefined && item.days !== undefined) {
      const v = item.perDay * item.days;
      amount += v;
      basis = `${money(item.perDay)}/day x ${item.days} days = ${money(v)}`;
    }
    indirectDetail.push({ code: item.code, label: item.label, amount: money(amount), basis });
  }
  const indirectCost = sumMoney(indirectDetail.map((i) => i.amount));

  // Confidence, weighted by the money at stake ------------------------------
  const totalForWeighting = lines.reduce((a, l) => a + l.totalDirectCost, 0);
  const weightedConfidence =
    totalForWeighting > 0
      ? roundTo(
          lines.reduce((a, l) => a + l.confidence.score * l.totalDirectCost, 0) / totalForWeighting,
          1,
        )
      : lines.length > 0
        ? roundTo(lines.reduce((a, l) => a + l.confidence.score, 0) / lines.length, 1)
        : 0;

  const band = confidenceBandOf(weightedConfidence);
  /** What the caller said about this line, by id. */
  const overrideFor = (id: string): number | null => {
    const found = input.lines.find((l) => l.id === id);
    const v = found?.markupOverride;
    return v === null || v === undefined ? null : assertNonNegative(v, 'markupOverride');
  };

  const recommendedContingency = contingencyFor(weightedConfidence);

  const profileContingency =
    input.pricingProfile.components.find((c) => c.code === 'CONT')?.percent ?? null;

  let appliedContingency: number;
  let contingencySource: EstimateResult['contingencySource'];
  if (input.contingencyOverride) {
    appliedContingency = input.contingencyOverride.percent;
    contingencySource = 'override';
    warnings.push(
      `Contingency overridden to ${factor(appliedContingency * 100)}% by ${input.contingencyOverride.reason} ` +
        `(approved by ${input.contingencyOverride.approvedBy}); the confidence band recommends ` +
        `${factor(recommendedContingency * 100)}%.`,
    );
  } else if (profileContingency !== null && profileContingency >= recommendedContingency) {
    appliedContingency = profileContingency;
    contingencySource = 'profile';
  } else {
    appliedContingency = recommendedContingency;
    contingencySource = 'confidence_band';
    if (profileContingency !== null) {
      warnings.push(
        `Profile contingency of ${factor(profileContingency * 100)}% is below the ` +
          `${factor(recommendedContingency * 100)}% justified by a weighted confidence of ${weightedConfidence}; ` +
          `the higher figure was applied.`,
      );
    }
  }

  // Price -------------------------------------------------------------------
  const effectiveProfile: PricingProfile = {
    ...input.pricingProfile,
    components: [
      ...input.pricingProfile.components.filter((c) => c.code !== 'CONT'),
      ...(appliedContingency > 0
        ? [{ code: 'CONT', label: 'Contingency', percent: appliedContingency, basis: 'profile_default' as const, sequence: 30 }]
        : []),
    ],
  };
  /*
   * Lines the estimator has priced by hand, and lines the profile prices.
   *
   * `markup_override` has existed since migration 0107 and nothing ever read
   * it, so a markup typed on a line moved a number on the screen and left the
   * bid exactly where it was. The schema says what it means — "this line's own
   * markup as a fraction, or null to use the pricing profile" — so an
   * overridden line is priced at its own rate and taken out of the profile's
   * base entirely. Anything else would apply two markups to one line.
   */
  const overridden = lines.filter((l) => overrideFor(l.id) !== null);
  const overriddenDirect = sumMoney(overridden.map((l) => l.totalDirectCost));
  const profiledDirect = money(totalDirect - overriddenDirect);

  const price = calculatePrice(profiledDirect, indirectCost, effectiveProfile);
  warnings.push(...price.warnings);

  const overriddenMarkup = sumMoney(
    overridden.map((l) => money(l.totalDirectCost * (overrideFor(l.id) ?? 0))));

  if (overridden.length > 0) {
    warnings.push(
      `${overridden.length} line${overridden.length === 1 ? ' carries its' : 's carry their'} own `
        + `markup and ${overridden.length === 1 ? 'is' : 'are'} priced outside the profile, so the `
        + `${factor(appliedContingency * 100)}% contingency does not cover `
        + `${overridden.length === 1 ? 'it' : 'them'}. Their cost is `
        + `${money(overriddenDirect)} of ${money(totalDirect)}.`,
    );
  }

  /*
   * What each line sells for.
   *
   * An overridden line is exact: its cost times its own rate. The rest share
   * the profile's price in proportion to their cost — and the last cents are
   * handed out by largest remainder rather than rounded away, so the lines add
   * up to the bid exactly. A bid that disagrees with the lines it is made of is
   * the one thing an estimator cannot explain to a customer.
   */
  const totalPrice = money(price.totalPrice + overriddenDirect + overriddenMarkup);
  const profiledPrice = price.totalPrice;

  const shares = lines.map((l) => {
    const rate = overrideFor(l.id);
    if (rate !== null) {
      const amount = money(l.totalDirectCost * rate);
      return { id: l.id, rate, amount, price: money(l.totalDirectCost + amount), exact: true };
    }
    const share = profiledDirect === 0 ? 0 : l.totalDirectCost / profiledDirect;
    return { id: l.id, rate: 0, amount: 0, price: profiledPrice * share, exact: false };
  });

  /* Largest remainder, over the lines the profile priced. */
  const allocated = new Map<string, number>();
  const flexible = shares.filter((x) => !x.exact);
  let handedOut = 0;
  for (const x of flexible) {
    const down = Math.floor(x.price * 100) / 100;
    allocated.set(x.id, down);
    handedOut = money(handedOut + down);
  }
  let remainder = Math.round((profiledPrice - handedOut) * 100);
  const byRemainder = [...flexible].sort((a, b) =>
    (b.price * 100 - Math.floor(b.price * 100)) - (a.price * 100 - Math.floor(a.price * 100)));
  for (let i = 0; remainder > 0 && byRemainder.length > 0; i += 1, remainder -= 1) {
    const x = byRemainder[i % byRemainder.length]!;
    allocated.set(x.id, money((allocated.get(x.id) ?? 0) + 0.01));
  }

  const priced: EstimateLineResult[] = lines.map((l) => {
    const x = shares.find((y) => y.id === l.id)!;
    const linePrice = x.exact ? x.price : (allocated.get(l.id) ?? 0);
    const amount = x.exact ? x.amount : money(linePrice - l.totalDirectCost);
    return {
      ...l,
      markupRate: x.exact ? x.rate
        : factor(safeDivide(amount, l.totalDirectCost)),
      markupAmount: amount,
      price: linePrice,
      unitPrice: unitRate(safeDivide(linePrice, l.quantity.adjusted)),
    };
  });

  const increment = input.bidRoundingIncrement ?? 0;
  /*
   * The bid is the whole estimate: what the profile priced, plus the lines the
   * estimator priced by hand. `price` describes the profiled part and is kept
   * as the audit of how that part was built.
   */
  const rounded =
    increment > 0
      ? money(Math.ceil(totalPrice / increment - 1e-9) * increment)
      : totalPrice;

  // Approval routing --------------------------------------------------------
  const approvalSummary: Record<ApprovalGateResult['gate'], string[]> = {
    auto_accept: [],
    estimator_review: [],
    senior_review: [],
    rfi_required: [],
  };
  for (const l of priced) approvalSummary[l.approval.gate].push(l.id);

  const blockedFromIssue = lines.some((l) => l.approval.blocksIssue);
  const { decision, reason } = executiveDecision(lines, approvalSummary, weightedConfidence);

  for (const l of lines) {
    if (l.warnings.length) warnings.push(`Line ${l.id}: ${l.warnings.length} warning(s)`);
  }
  if (input.status === 'issued' || input.status === 'approved') {
    if (blockedFromIssue) {
      warnings.push(
        `Estimate is marked "${input.status}" while ${approvalSummary.senior_review.length + approvalSummary.rfi_required.length} ` +
          `line(s) still block issue. RULE-009 requires issued versions to be complete and immutable.`,
      );
    }
  }

  return {
    id: input.id,
    number: input.number,
    name: input.name,
    version: input.version,
    status: input.status,
    lines: priced,
    directCost,
    totalDirectCost: totalDirect,
    indirectCost,
    indirectDetail,
    price: { ...price, totalPrice },
    bidPrice: rounded,
    bidRoundingAdjustment: money(rounded - price.totalPrice),
    totalLaborHours: roundTo(lines.reduce((a, l) => a + l.laborHours, 0), 2),
    totalEquipmentHours: roundTo(lines.reduce((a, l) => a + l.equipmentHours, 0), 2),
    totalFuelGallons: roundTo(lines.reduce((a, l) => a + l.fuelGallons, 0), 2),
    totalDurationDays: roundTo(lines.reduce((a, l) => a + (l.duration?.practicalDays ?? 0), 0), 2),
    weightedConfidence,
    confidenceBand: band,
    recommendedContingency,
    appliedContingency: factor(appliedContingency),
    contingencySource,
    approvalSummary,
    blockedFromIssue,
    executiveDecision: decision,
    executiveDecisionReason: reason,
    assumptions: lines.flatMap((l) => l.assumptions),
    exclusions: lines.flatMap((l) => l.exclusions),
    warnings,
  };
}

function confidenceBandOf(score: number): ConfidenceResult['band'] {
  if (score >= 95) return 'verified';
  if (score >= 90) return 'strong';
  if (score >= 80) return 'reliable';
  if (score >= 70) return 'assumption';
  if (score >= 50) return 'uncertain';
  return 'do_not_price';
}

function contingencyFor(score: number): number {
  if (score <= 69) return 0.12;
  if (score <= 79) return 0.08;
  if (score <= 89) return 0.05;
  return 0.03;
}

/** Section 59 final executive decision. */
function executiveDecision(
  lines: readonly EstimateLineResult[],
  summary: Record<ApprovalGateResult['gate'], readonly string[]>,
  weightedConfidence: number,
): { decision: EstimateResult['executiveDecision']; reason: string } {
  if (lines.length === 0) {
    return {
      decision: 'document_set_incomplete',
      reason: 'The estimate has no lines; there is nothing to price.',
    };
  }
  if (summary.rfi_required.length > 0) {
    return {
      decision: 'rfi_resolution_required',
      reason:
        `${summary.rfi_required.length} line(s) depend on information the supplied documents cannot resolve ` +
        `(${summary.rfi_required.join(', ')}). Those RFIs must be answered before final pricing.`,
    };
  }
  if (summary.senior_review.length > 0) {
    return {
      decision: 'senior_review_required',
      reason:
        `${summary.senior_review.length} line(s) carry a document conflict, a material assumption, a major ` +
        `earthwork decision or sub-80 confidence (${summary.senior_review.join(', ')}) and require senior estimator sign-off.`,
    };
  }
  if (summary.estimator_review.length > 0 || weightedConfidence < 95) {
    const assumptionCount = lines.reduce((a, l) => a + l.assumptions.length, 0);
    return {
      decision: 'ready_with_assumptions',
      reason:
        `Weighted confidence is ${weightedConfidence}. ${summary.estimator_review.length} line(s) required ` +
        `interpretation and ${assumptionCount} assumption(s) are recorded. The estimate can be priced with those ` +
        `assumptions stated on the proposal.`,
    };
  }
  return {
    decision: 'ready_for_estimating',
    reason: `All ${lines.length} line(s) are dimensioned, referenced, conflict-free and scored at or above 95 (weighted ${weightedConfidence}).`,
  };
}

export { unitPrice };
