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
import { assertNonNegative, assertPositive, factor, hours, qty, roundTo, safeDivide, SCALE } from './numeric.js';
const ALL_TARGETS = [
    'production', 'labor_cost', 'equipment_cost', 'material_cost',
    'trucking_cost', 'disposal_cost', 'indirect_cost', 'schedule', 'risk',
];
/** Production impediments compound; cost causes add. See `resolveModifiers`. */
const MULTIPLICATIVE_TARGETS = new Set([
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
export function resolveModifiers(selections) {
    const combined = Object.fromEntries(ALL_TARGETS.map((t) => [t, 1]));
    const surchargeByTarget = new Map();
    const applied = [];
    const derivationParts = new Map();
    const warnings = [];
    const seen = new Set();
    for (const { modifier, justification } of selections) {
        if (seen.has(modifier.id)) {
            warnings.push(`Modifier ${modifier.id} (${modifier.name}) was selected more than once; applied once.`);
            continue;
        }
        seen.add(modifier.id);
        if (!justification || justification.trim() === '') {
            throw new RangeError(`Modifier ${modifier.id} requires an explicit justification (application rule: ${modifier.applicationRule})`);
        }
        if (modifier.status === 'retired') {
            warnings.push(`Modifier ${modifier.id} (${modifier.name}) is retired and should not be used on new estimates.`);
        }
        for (const target of ALL_TARGETS) {
            const f = modifier.factors[target];
            if (f === undefined)
                continue;
            assertPositive(f, `modifier ${modifier.id} factor for ${target}`);
            applied.push({ id: modifier.id, name: modifier.name, target, factor: factor(f), justification });
            const parts = derivationParts.get(target) ?? [];
            if (MULTIPLICATIVE_TARGETS.has(target)) {
                combined[target] *= f;
                parts.push(`x ${factor(f)} (${modifier.name})`);
            }
            else {
                surchargeByTarget.set(target, (surchargeByTarget.get(target) ?? 0) + (f - 1));
                parts.push(`${f >= 1 ? '+' : ''}${factor((f - 1) * 100)}% (${modifier.name})`);
            }
            derivationParts.set(target, parts);
        }
    }
    for (const [target, surcharge] of surchargeByTarget) {
        combined[target] = 1 + surcharge;
        if (combined[target] <= 0) {
            warnings.push(`Combined ${target} modifiers reduce the bucket to ${factor(combined[target])}x, which is not physical; clamped to 0.`);
            combined[target] = 0;
        }
    }
    for (const target of ALL_TARGETS) {
        combined[target] = factor(combined[target]);
    }
    if (combined.production > 0 && combined.production < IMPLAUSIBLE_PRODUCTION_FLOOR) {
        warnings.push(`Combined production factor of ${combined.production} means the crew produces under ` +
            `${IMPLAUSIBLE_PRODUCTION_FLOOR * 100}% of base rate. Verify the modifier selection before pricing.`);
    }
    const derivation = [...derivationParts.entries()].map(([target, parts]) => `${target}: 1 ${parts.join(' ')} = ${combined[target]}`);
    return { combined, applied, derivation, warnings };
}
/** Trust weighting used by the confidence engine (RULE-010). */
export const SOURCE_RELIABILITY = {
    company_actual: 1.0,
    company_historical: 0.92,
    regional_benchmark: 0.8,
    manufacturer: 0.78,
    seed_benchmark: 0.6,
    estimator_judgment: 0.5,
};
/**
 * Produce the three distinct production numbers Section 25 requires.
 *
 * Section 25 is explicit that an unadjusted theoretical rate must never be the
 * estimating rate, so `recommendedPerHour` — the only one the cost engine
 * consumes — always carries utilization and site conditions.
 */
export function analyzeProduction(rate, productionModifier = 1) {
    assertPositive(rate.ratePerHour, 'ratePerHour');
    assertPositive(rate.shiftHours, 'shiftHours');
    assertPositive(rate.utilizationFactor, 'utilizationFactor');
    assertNonNegative(productionModifier, 'productionModifier');
    const warnings = [];
    if (rate.utilizationFactor > 1) {
        warnings.push(`Utilization factor of ${rate.utilizationFactor} exceeds 1.0, which claims the machine produces more than ` +
            `its own rate for the whole shift. Verify the catalog rate.`);
    }
    if (rate.shiftHours > 16) {
        warnings.push(`Shift of ${rate.shiftHours} hours exceeds 16; verify the shift calendar.`);
    }
    if (rate.approvalStatus === 'draft') {
        warnings.push(`Production rate ${rate.id} is a draft catalog rate (source: ${rate.sourceType}). ` +
            `Approve it, or substitute a company actual, before this estimate is issued.`);
    }
    if (rate.sourceType === 'seed_benchmark') {
        warnings.push(`Production rate ${rate.id} is a GrounUp seed benchmark, not a company-measured rate. ` +
            `It is a starting point, not a company production standard.`);
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
        derivation: `theoretical ${theoreticalPerHour} ${rate.unit}/hr x ${factor(rate.utilizationFactor)} utilization = ` +
            `${practicalPerHour} practical; x ${factor(productionModifier)} conditions = ${recommendedPerHour} ` +
            `recommended ${rate.unit}/hr; x ${rate.shiftHours} hr shift = ${recommendedPerShift} ${rate.unit}/shift`,
        warnings,
    };
}
/**
 * Identify the resource that actually governs production.
 *
 * The operation cannot go faster than its slowest dependent resource, so the
 * controlling capacity is the minimum — not the average, and not the primary
 * machine's rate. Everything faster than the controlling resource is running
 * with slack, and buying more of it changes nothing.
 */
export function analyzeBottleneck(resources) {
    if (resources.length === 0) {
        throw new RangeError('analyzeBottleneck requires at least one resource');
    }
    for (const r of resources)
        assertPositive(r.capacityPerHour, `resource ${r.id} capacityPerHour`);
    let controlling = resources[0];
    for (const r of resources) {
        if (r.capacityPerHour < controlling.capacityPerHour)
            controlling = r;
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
    const improvementNote = coControllingIds.length > 1
        ? `${coControllingIds.length} resources are within 5% of the controlling rate ` +
            `(${coControllingIds.join(', ')}). Adding capacity to only one of them will not increase production.`
        : `Production is governed by ${controlling.name}. Adding capacity there raises the operation rate until ` +
            `the next resource (${[...resources].sort((a, b) => a.capacityPerHour - b.capacityPerHour)[1]?.name ?? 'none'}) becomes controlling.`;
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
/**
 * Duration from quantity and production.
 *
 * `practicalDays` divides by calendar efficiency rather than multiplying by
 * its inverse-as-a-discount: losing 15% of available days to weather means the
 * work stretches over days/0.85, not days x 1.15. The two differ by ~2.6% at
 * 0.85 and the difference grows, so the division is the correct form.
 */
export function calculateDuration(input) {
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
    const productiveHours = input.productionPerHour > 0 ? hours(safeDivide(input.quantity, input.productionPerHour)) : 0;
    const totalHours = hours((productiveHours + fixedHrs) / parallelCrews);
    /*
     * Rounded once, at the end, and only for the figures a person reads.
     *
     * `practicalDays` used to be rounded from an already-rounded `rawDays`, so
     * two roundings compounded before the result was used to price labor.
     */
    const rawDaysExact = safeDivide(totalHours, input.shiftHours);
    const paidShiftsExact = safeDivide(rawDaysExact, calendarEfficiency);
    const rawDays = roundTo(rawDaysExact, 2);
    const practicalDays = roundTo(paidShiftsExact, 2);
    return {
        productiveHours,
        fixedHours: hours(fixedHrs),
        totalHours,
        rawDays,
        practicalDays,
        paidShifts: roundTo(paidShiftsExact, SCALE.FACTOR),
        rangeDays: { low: rawDays, high: roundTo(practicalDays * 1.2, 2) },
        calendarEfficiency: factor(calendarEfficiency),
        parallelCrews,
        derivation: `${qty(input.quantity)} / ${roundTo(input.productionPerHour, 4)} per hr = ${productiveHours} productive hr` +
            (fixedHrs ? ` + ${hours(fixedHrs)} fixed hr` : '') +
            (parallelCrews > 1 ? ` / ${parallelCrews} crews` : '') +
            ` = ${totalHours} hr / ${input.shiftHours} hr shift = ${rawDays} days` +
            (calendarEfficiency < 1 ? ` / ${factor(calendarEfficiency)} calendar efficiency = ${practicalDays} days` : ''),
    };
}
