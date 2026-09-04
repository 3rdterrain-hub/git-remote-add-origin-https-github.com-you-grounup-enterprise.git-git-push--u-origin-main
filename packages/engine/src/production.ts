/**
 * Production, condition modifiers, controlling resource and duration.
 *
 * Governing rules:
 *  - RULE-002  Duration = normalized quantity / effective contextual production,
 *              adjusted for shift and calendar.
 *  - RULE-005  Production is limited by the slowest dependent resource unless
 *              buffering is intentionally modeled.
 *  - RULE-006  Modifiers apply only to their explicit declared targets.
 *  - Section 25 Theoretical, practical and recommended estimating production are
 *              three different numbers and must be reported separately.
 */

import { assertNonNegative, assertPositive, factor, hours, qty, roundTo, safeDivide } from './numeric.js';

// ---------------------------------------------------------------------------
// Condition modifiers (RULE-006)
// ---------------------------------------------------------------------------

/**
 * Every bucket a modifier is allowed to touch. A modifier that does not
 * declare a target cannot affect it — there is no implicit spillover.
 */
export type ModifierTarget =
  | 'production'
  | 'labor_cost'
  | 'equipment_cost'
  | 'material_cost'
  | 'trucking_cost'
  | 'disposal_cost'
  | 'indirect_cost'
  | 'schedule'
  | 'risk';

export interface ConditionModifier {
  id: string;
  name: string;
  /**
   * Explicit factor per target.
   *
   * `production` is a *rate* multiplier: 0.75 means the crew produces 75% of
   * the base rate, i.e. the work takes longer. Cost targets are *cost*
   * multipliers: 1.15 means that bucket costs 15% more.
   *
   * Keeping these as an explicit map — rather than one number plus a target
   * label — removes the ambiguity in the source library, where a single
   * "0.88 / Labor+Production" entry could mean either 12% slower or 12%
   * cheaper labor. It can only mean what it is written to mean here.
   */
  factors: Partial<Record<ModifierTarget, number>>;
  /** Why this modifier is on the line. Required by the application layer. */
  applicationRule: string;
  category?: string;
  status?: 'active' | 'draft' | 'retired';
}

export interface AppliedModifier {
  id: string;
  name: string;
  target: ModifierTarget;
  factor: number;
  /** Estimator's stated justification for selecting this modifier on this line. */
  justification: string;
}

export interface ModifierResolution {
  /** Combined multiplier per target. Targets with no modifier resolve to 1. */
  combined: Record<ModifierTarget, number>;
  applied: readonly AppliedModifier[];
  /** Ordered, human-readable derivation per affected target. */
  derivation: readonly string[];
  warnings: readonly string[];
}

const ALL_TARGETS: readonly ModifierTarget[] = [
  'production', 'labor_cost', 'equipment_cost', 'material_cost',
  'trucking_cost', 'disposal_cost', 'indirect_cost', 'schedule', 'risk',
];

/** Production impediments compound; cost causes add. See `resolveModifiers`. */
const MULTIPLICATIVE_TARGETS: ReadonlySet<ModifierTarget> = new Set<ModifierTarget>([
  'production', 'schedule', 'risk',
]);

/** Below this combined production factor the estimate is almost certainly mis-configured. */
const IMPLAUSIBLE_PRODUCTION_FLOOR = 0.15;

/**
 * Combine every selected modifier into one multiplier per target.
 *
 * Production factors are combined multiplicatively because two physical
 * impediments genuinely compound: a crew with restricted access (0.75) working
 * in adverse weather (0.80) does not produce 55% of base (additive), it
 * produces 60% — the weather slows down whatever the restricted-access crew
 * was managing to do.
 *
 * Cost factors are combined additively over their surcharges, matching the
 * locked-in Section 7.1 behavior: rock (+35%) and winter (+12%) each describe
 * an independent real cost cause, and 1.35 x 1.12 = +51% would invent a
 * cross-term that nothing in the field produces.
 */
export function resolveModifiers(
  selections: readonly { modifier: ConditionModifier; justification: string }[],
): ModifierResolution {
  const combined = Object.fromEntries(ALL_TARGETS.map((t) => [t, 1])) as Record<ModifierTarget, number>;
  const surchargeByTarget = new Map<ModifierTarget, number>();
  const applied: AppliedModifier[] = [];
  const derivationParts = new Map<ModifierTarget, string[]>();
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const { modifier, justification } of selections) {
    if (seen.has(modifier.id)) {
      warnings.push(`Modifier ${modifier.id} (${modifier.name}) was selected more than once; applied once.`);
      continue;
    }
    seen.add(modifier.id);
    if (!justification || justification.trim() === '') {
      throw new RangeError(
        `Modifier ${modifier.id} requires an explicit justification (application rule: ${modifier.applicationRule})`,
      );
    }
    if (modifier.status === 'retired') {
      warnings.push(`Modifier ${modifier.id} (${modifier.name}) is retired and should not be used on new estimates.`);
    }

    for (const target of ALL_TARGETS) {
      const f = modifier.factors[target];
      if (f === undefined) continue;
      assertPositive(f, `modifier ${modifier.id} factor for ${target}`);
      applied.push({ id: modifier.id, name: modifier.name, target, factor: factor(f), justification });

      const parts = derivationParts.get(target) ?? [];
      if (MULTIPLICATIVE_TARGETS.has(target)) {
        combined[target] *= f;
        parts.push(`x ${factor(f)} (${modifier.name})`);
      } else {
        surchargeByTarget.set(target, (surchargeByTarget.get(target) ?? 0) + (f - 1));
        parts.push(`${f >= 1 ? '+' : ''}${factor((f - 1) * 100)}% (${modifier.name})`);
      }
      derivationParts.set(target, parts);
    }
  }

  for (const [target, surcharge] of surchargeByTarget) {
    combined[target] = 1 + surcharge;
    if (combined[target] <= 0) {
      warnings.push(
        `Combined ${target} modifiers reduce the bucket to ${factor(combined[target])}x, which is not physical; clamped to 0.`,
      );
      combined[target] = 0;
    }
  }

  for (const target of ALL_TARGETS) {
    combined[target] = factor(combined[target]);
  }

  if (combined.production > 0 && combined.production < IMPLAUSIBLE_PRODUCTION_FLOOR) {
    warnings.push(
      `Combined production factor of ${combined.production} means the crew produces under ` +
        `${IMPLAUSIBLE_PRODUCTION_FLOOR * 100}% of base rate. Verify the modifier selection before pricing.`,
    );
  }

  const derivation = [...derivationParts.entries()].map(
    ([target, parts]) => `${target}: 1 ${parts.join(' ')} = ${combined[target]}`,
  );

  return { combined, applied, derivation, warnings };
}

// ---------------------------------------------------------------------------
// Production rates (Section 25)
// ---------------------------------------------------------------------------

export type ProductionSourceType =
  | 'company_actual'        // measured on this company's own completed work
  | 'company_historical'    // this company's historical average
  | 'regional_benchmark'
  | 'seed_benchmark'        // GrounUp shipped default
  | 'manufacturer'
  | 'estimator_judgment';

/** Trust weighting used by the confidence engine (RULE-010). */
export const SOURCE_RELIABILITY: Readonly<Record<ProductionSourceType, number>> = {
  company_actual: 1.0,
  company_historical: 0.92,
  regional_benchmark: 0.8,
  manufacturer: 0.78,
  seed_benchmark: 0.6,
  estimator_judgment: 0.5,
};

export interface ProductionRate {
  id: string;
  taskId?: string;
  /** Quantity per hour at 100% utilization, in the line's unit. */
  ratePerHour: number;
  unit: string;
  /** Fraction of the shift the controlling resource is actually producing. */
  utilizationFactor: number;
  shiftHours: number;
  sourceType: ProductionSourceType;
  /** 0-1 confidence recorded on the catalog rate itself. */
  confidence: number;
  sampleSize?: number;
  effectiveDate?: string;
  region?: string;
  approvalStatus?: 'draft' | 'approved' | 'retired';
}

export interface ProductionAnalysis {
  /** Catalog rate, ignoring utilization and site conditions. */
  theoreticalPerHour: number;
  /** Theoretical x utilization: what the machine does across a real shift. */
  practicalPerHour: number;
  /** Practical x condition modifiers: what this estimate should be priced at. */
  recommendedPerHour: number;
  recommendedPerShift: number;
  utilizationFactor: number;
  productionModifier: number;
  shiftHours: number;
  sourceType: ProductionSourceType;
  derivation: string;
  warnings: readonly string[];
}

/**
 * Produce the three distinct production numbers Section 25 requires.
 *
 * Section 25 is explicit that an unadjusted theoretical rate must never be the
 * estimating rate, so `recommendedPerHour` — the only one the cost engine
 * consumes — always carries utilization and site conditions.
 */
export function analyzeProduction(rate: ProductionRate, productionModifier = 1): ProductionAnalysis {
  assertPositive(rate.ratePerHour, 'ratePerHour');
  assertPositive(rate.shiftHours, 'shiftHours');
  assertPositive(rate.utilizationFactor, 'utilizationFactor');
  assertNonNegative(productionModifier, 'productionModifier');

  const warnings: string[] = [];
  if (rate.utilizationFactor > 1) {
    warnings.push(
      `Utilization factor of ${rate.utilizationFactor} exceeds 1.0, which claims the machine produces more than ` +
        `its own rate for the whole shift. Verify the catalog rate.`,
    );
  }
  if (rate.shiftHours > 16) {
    warnings.push(`Shift of ${rate.shiftHours} hours exceeds 16; verify the shift calendar.`);
  }
  if (rate.approvalStatus === 'draft') {
    warnings.push(
      `Production rate ${rate.id} is a draft catalog rate (source: ${rate.sourceType}). ` +
        `Approve it, or substitute a company actual, before this estimate is issued.`,
    );
  }
  if (rate.sourceType === 'seed_benchmark') {
    warnings.push(
      `Production rate ${rate.id} is a GrounUp seed benchmark, not a company-measured rate. ` +
        `It is a starting point, not a company production standard.`,
    );
  }

  const theoreticalPerHour = roundTo(rate.ratePerHour, 4);
  const practicalPerHour = roundTo(theoreticalPerHour * rate.utilizationFactor, 4);
  const recommendedPerHour = roundTo(practicalPerHour * productionModifier, 4);
  const recommendedPerShift = roundTo(recommendedPerHour * rate.shiftHours, 4);

  return {
    theoreticalPerHour,
    practicalPerHour,
    recommendedPerHour,
    recommendedPerShift,
    utilizationFactor: factor(rate.utilizationFactor),
    productionModifier: factor(productionModifier),
    shiftHours: rate.shiftHours,
    sourceType: rate.sourceType,
    derivation:
      `theoretical ${theoreticalPerHour} ${rate.unit}/hr x ${factor(rate.utilizationFactor)} utilization = ` +
      `${practicalPerHour} practical; x ${factor(productionModifier)} conditions = ${recommendedPerHour} ` +
      `recommended ${rate.unit}/hr; x ${rate.shiftHours} hr shift = ${recommendedPerShift} ${rate.unit}/shift`,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Controlling resource / bottleneck (RULE-005, Section 36)
// ---------------------------------------------------------------------------

export interface ResourceCapacity {
  id: string;
  name: string;
  kind: 'equipment' | 'crew' | 'trucking' | 'material_supply' | 'inspection' | 'subcontract';
  /** What this resource can deliver per hour, in the operation's unit. */
  capacityPerHour: number;
}

export interface BottleneckAnalysis {
  /** The operation runs at the slowest resource's capacity. */
  controllingResourceId: string;
  controllingResourceName: string;
  controllingKind: ResourceCapacity['kind'];
  operationCapacityPerHour: number;
  /** Utilization of each resource against the controlling rate, 0-1. */
  utilization: readonly { id: string; name: string; capacityPerHour: number; utilization: number; slackPerHour: number }[];
  /** Resources within 5% of controlling — improving only one will not help much. */
  coControllingIds: readonly string[];
  improvementNote: string;
}

/**
 * Identify the resource that actually governs production.
 *
 * The operation cannot go faster than its slowest dependent resource, so the
 * controlling capacity is the minimum — not the average, and not the primary
 * machine's rate. Everything faster than the controlling resource is running
 * with slack, and buying more of it changes nothing.
 */
export function analyzeBottleneck(resources: readonly ResourceCapacity[]): BottleneckAnalysis {
  if (resources.length === 0) {
    throw new RangeError('analyzeBottleneck requires at least one resource');
  }
  for (const r of resources) assertPositive(r.capacityPerHour, `resource ${r.id} capacityPerHour`);

  let controlling = resources[0]!;
  for (const r of resources) {
    if (r.capacityPerHour < controlling.capacityPerHour) controlling = r;
  }
  const operationCapacityPerHour = roundTo(controlling.capacityPerHour, 4);

  const utilization = resources.map((r) => ({
    id: r.id,
    name: r.name,
    capacityPerHour: roundTo(r.capacityPerHour, 4),
    utilization: factor(safeDivide(operationCapacityPerHour, r.capacityPerHour)),
    slackPerHour: roundTo(r.capacityPerHour - operationCapacityPerHour, 4),
  }));

  const coControllingIds = resources
    .filter((r) => r.capacityPerHour <= controlling.capacityPerHour * 1.05)
    .map((r) => r.id);

  const improvementNote =
    coControllingIds.length > 1
      ? `${coControllingIds.length} resources are within 5% of the controlling rate ` +
        `(${coControllingIds.join(', ')}). Adding capacity to only one of them will not increase production.`
      : `Production is governed by ${controlling.name}. Adding capacity there raises the operation rate until ` +
        `the next resource (${
          [...resources].sort((a, b) => a.capacityPerHour - b.capacityPerHour)[1]?.name ?? 'none'
        }) becomes controlling.`;

  return {
    controllingResourceId: controlling.id,
    controllingResourceName: controlling.name,
    controllingKind: controlling.kind,
    operationCapacityPerHour,
    utilization,
    coControllingIds,
    improvementNote,
  };
}

// ---------------------------------------------------------------------------
// Duration (RULE-002, Section 37)
// ---------------------------------------------------------------------------

export interface DurationInput {
  quantity: number;
  /** Effective production per hour, already modified for conditions. */
  productionPerHour: number;
  shiftHours: number;
  /** Fixed hours that do not scale with quantity: setup, layout, mobilization. */
  fixedHours?: number;
  /** Fraction of calendar days lost to weather, inspection and interruption. */
  calendarEfficiency?: number;
  /** Crews or spreads working the operation in parallel. */
  parallelCrews?: number;
}

export interface DurationResult {
  productiveHours: number;
  fixedHours: number;
  totalHours: number;
  /** Pure production days, before calendar allowance. */
  rawDays: number;
  /** Days a superintendent should actually plan for. */
  practicalDays: number;
  /** Planning range: optimistic (raw) to pessimistic (practical + 20%). */
  rangeDays: { low: number; high: number };
  calendarEfficiency: number;
  parallelCrews: number;
  derivation: string;
}

/**
 * Duration from quantity and production.
 *
 * `practicalDays` divides by calendar efficiency rather than multiplying by
 * its inverse-as-a-discount: losing 15% of available days to weather means the
 * work stretches over days/0.85, not days x 1.15. The two differ by ~2.6% at
 * 0.85 and the difference grows, so the division is the correct form.
 */
export function calculateDuration(input: DurationInput): DurationResult {
  assertNonNegative(input.quantity, 'quantity');
  /*
   * A production rate of zero is not a duration of zero.
   *
   * Without this, `safeDivide` turns 100 / 0 into 0 and the operation reports
   * zero hours and zero days — so a line whose production rate is missing
   * costs nothing, takes no time, and nothing flags it. That is how a missing
   * rate reaches a bid.
   */
  assertPositive(input.productionPerHour, 'productionPerHour');
  assertPositive(input.shiftHours, 'shiftHours');
  if (input.shiftHours > 24) {
    throw new RangeError(`shiftHours must be at most 24, received ${input.shiftHours}`);
  }
  const fixedHrs = assertNonNegative(input.fixedHours ?? 0, 'fixedHours');
  const calendarEfficiency = input.calendarEfficiency ?? 1;
  const parallelCrews = input.parallelCrews ?? 1;
  assertPositive(parallelCrews, 'parallelCrews');
  if (calendarEfficiency <= 0 || calendarEfficiency > 1) {
    throw new RangeError(`calendarEfficiency must be in (0, 1], received ${calendarEfficiency}`);
  }

  const productiveHours =
    input.productionPerHour > 0 ? hours(safeDivide(input.quantity, input.productionPerHour)) : 0;
  const totalHours = hours((productiveHours + fixedHrs) / parallelCrews);
  const rawDays = roundTo(safeDivide(totalHours, input.shiftHours), 2);
  const practicalDays = roundTo(safeDivide(rawDays, calendarEfficiency), 2);

  return {
    productiveHours,
    fixedHours: hours(fixedHrs),
    totalHours,
    rawDays,
    practicalDays,
    rangeDays: { low: rawDays, high: roundTo(practicalDays * 1.2, 2) },
    calendarEfficiency: factor(calendarEfficiency),
    parallelCrews,
    derivation:
      `${qty(input.quantity)} / ${roundTo(input.productionPerHour, 4)} per hr = ${productiveHours} productive hr` +
      (fixedHrs ? ` + ${hours(fixedHrs)} fixed hr` : '') +
      (parallelCrews > 1 ? ` / ${parallelCrews} crews` : '') +
      ` = ${totalHours} hr / ${input.shiftHours} hr shift = ${rawDays} days` +
      (calendarEfficiency < 1 ? ` / ${factor(calendarEfficiency)} calendar efficiency = ${practicalDays} days` : ''),
  };
}
