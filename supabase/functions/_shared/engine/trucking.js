/**
 * Trip-based haul and disposal engine (Section 28).
 *
 * RULE-004: cycle-based trucking is authoritative. A shortcut unit rate
 * ($/CY hauled) is allowed only as a clearly-labeled preliminary number, and
 * this module marks it as such so it can never be mistaken for a priced haul.
 */
import { assertNonNegative, assertPositive, factor, hours as roundHours, money, roundTo, safeDivide, unitRate, } from './numeric.js';
/** Trucks within this fraction of perfect balance are treated as balanced. */
const BALANCE_TOLERANCE = 0.05;
/**
 * Full trip-based haul analysis.
 *
 * The engine sizes the fleet from the loader, then reports what the *actual*
 * fleet delivers. This matters because both failure modes cost money in
 * opposite ways: too few trucks idles the excavator (the expensive machine),
 * too many puts trucks in a queue being paid to wait.
 */
export function analyzeHaulCycle(input) {
    assertNonNegative(input.quantity, 'quantity');
    assertPositive(input.truckCapacity, 'truckCapacity');
    assertNonNegative(input.oneWayMiles, 'oneWayMiles');
    assertPositive(input.loadedSpeedMph, 'loadedSpeedMph');
    assertPositive(input.emptySpeedMph, 'emptySpeedMph');
    assertNonNegative(input.dumpMinutes, 'dumpMinutes');
    assertPositive(input.loaderProductionPerHour, 'loaderProductionPerHour');
    assertPositive(input.shiftHours, 'shiftHours');
    assertNonNegative(input.truckHourlyRate, 'truckHourlyRate');
    const warnings = [];
    // Load time defaults to the time the loader needs to fill one truck, which
    // is the only value that keeps the cycle self-consistent with the spread.
    const loadMinutes = input.loadMinutes ?? roundTo((input.truckCapacity / input.loaderProductionPerHour) * 60, 4);
    assertNonNegative(loadMinutes, 'loadMinutes');
    const delayMinutes = assertNonNegative(input.delayMinutes ?? 0, 'delayMinutes');
    const haulMinutes = roundTo((input.oneWayMiles / input.loadedSpeedMph) * 60, 4);
    const returnMinutes = roundTo((input.oneWayMiles / input.emptySpeedMph) * 60, 4);
    const cycleMinutes = roundTo(loadMinutes + haulMinutes + input.dumpMinutes + returnMinutes + delayMinutes, 4);
    if (cycleMinutes <= 0) {
        throw new RangeError('Haul cycle time resolved to zero; check distances, speeds and load/dump times.');
    }
    const loads = roundTo(safeDivide(input.quantity, input.truckCapacity), 4);
    const wholeLoads = Math.ceil(loads - 1e-9);
    const cyclesPerTruckPerHour = 60 / cycleMinutes;
    const cyclesPerTruckPerShift = roundTo(cyclesPerTruckPerHour * input.shiftHours, 4);
    const productionPerTruckPerHour = roundTo(cyclesPerTruckPerHour * input.truckCapacity, 4);
    const productionPerTruckPerShift = roundTo(productionPerTruckPerHour * input.shiftHours, 4);
    // Trucks required so the loader never waits (Section 28).
    const exactTrucks = safeDivide(input.loaderProductionPerHour, productionPerTruckPerHour);
    const trucksToBalanceLoader = roundTo(exactTrucks, 4);
    const trucksRequired = Math.max(1, Math.ceil(exactTrucks - 1e-9));
    const trucksUsed = input.availableTrucks ?? trucksRequired;
    assertPositive(trucksUsed, 'availableTrucks');
    const fleetCapacityPerHour = roundTo(trucksUsed * productionPerTruckPerHour, 4);
    const effectiveProductionPerHour = roundTo(Math.min(fleetCapacityPerHour, input.loaderProductionPerHour), 4);
    let balance;
    let balanceNote;
    const ratio = safeDivide(fleetCapacityPerHour, input.loaderProductionPerHour);
    if (ratio < 1 - BALANCE_TOLERANCE) {
        balance = 'loader_starved';
        const idleFraction = 1 - ratio;
        balanceNote =
            `${trucksUsed} trucks deliver ${fleetCapacityPerHour} ${input.unit}/hr against a loader capable of ` +
                `${roundTo(input.loaderProductionPerHour, 4)} ${input.unit}/hr. The loading unit idles ` +
                `${factor(idleFraction * 100)}% of the shift. Add ${trucksRequired - trucksUsed} truck(s) to balance.`;
        warnings.push('Haul fleet is undersized; the loading equipment is the paid resource sitting idle.');
    }
    else if (ratio > 1 + BALANCE_TOLERANCE) {
        balance = 'trucks_queueing';
        const queueFraction = 1 - safeDivide(1, ratio);
        balanceNote =
            `${trucksUsed} trucks deliver ${fleetCapacityPerHour} ${input.unit}/hr against a loader capable of ` +
                `${roundTo(input.loaderProductionPerHour, 4)} ${input.unit}/hr. Each truck waits about ` +
                `${factor(queueFraction * 100)}% of its cycle. ${trucksRequired} truck(s) would match the loader.`;
        warnings.push('Haul fleet exceeds loading capacity; trucks are paid to queue.');
    }
    else {
        balance = 'balanced';
        balanceNote =
            `${trucksUsed} trucks deliver ${fleetCapacityPerHour} ${input.unit}/hr against a loader capable of ` +
                `${roundTo(input.loaderProductionPerHour, 4)} ${input.unit}/hr — balanced within ${BALANCE_TOLERANCE * 100}%.`;
    }
    // Trucks are paid for the whole operation, not only for their own cycles:
    // a truck standing in a queue is still on the clock.
    const operationHours = roundHours(safeDivide(input.quantity, effectiveProductionPerHour));
    const totalTruckHours = roundHours(operationHours * trucksUsed);
    const truckingCost = money(totalTruckHours * input.truckHourlyRate);
    const disposalCost = money(input.quantity * (input.disposalFeePerUnit ?? 0));
    if (input.oneWayMiles === 0) {
        warnings.push('One-way haul distance is zero; this prices an on-site relocation, not an off-site haul.');
    }
    return {
        loads,
        wholeLoads,
        loadMinutes: roundTo(loadMinutes, 4),
        haulMinutes,
        dumpMinutes: roundTo(input.dumpMinutes, 4),
        returnMinutes,
        delayMinutes: roundTo(delayMinutes, 4),
        cycleMinutes,
        cyclesPerTruckPerShift,
        productionPerTruckPerHour,
        productionPerTruckPerShift,
        trucksToBalanceLoader,
        trucksRequired,
        trucksUsed,
        effectiveProductionPerHour,
        balance,
        balanceNote,
        totalTruckHours,
        truckingCost,
        disposalCost,
        costPerUnit: unitRate(safeDivide(truckingCost + disposalCost, input.quantity)),
        derivation: `cycle = ${roundTo(loadMinutes, 2)} load + ${roundTo(haulMinutes, 2)} haul + ${roundTo(input.dumpMinutes, 2)} dump + ` +
            `${roundTo(returnMinutes, 2)} return + ${roundTo(delayMinutes, 2)} delay = ${cycleMinutes} min; ` +
            `${roundTo(cyclesPerTruckPerHour, 4)} cycles/hr x ${input.truckCapacity} ${input.unit} = ` +
            `${productionPerTruckPerHour} ${input.unit}/truck/hr; ` +
            `loader ${roundTo(input.loaderProductionPerHour, 4)} / ${productionPerTruckPerHour} = ${trucksToBalanceLoader} -> ` +
            `${trucksRequired} truck(s); ${loads} loads total`,
        warnings,
    };
}
export function preliminaryHaulCost(quantity, ratePerUnit, unit) {
    assertNonNegative(quantity, 'quantity');
    assertNonNegative(ratePerUnit, 'ratePerUnit');
    return {
        quantity: roundTo(quantity, 4),
        ratePerUnit: unitRate(ratePerUnit),
        truckingCost: money(quantity * ratePerUnit),
        isPreliminary: true,
        warnings: [
            `Haul priced at a shortcut rate of ${unitRate(ratePerUnit)}/${unit}. RULE-004 requires a cycle-based ` +
                `haul analysis before this estimate is issued; this number is preliminary.`,
        ],
    };
}
export function tripHaulCost(input) {
    const { quantity, truckCapacity, ratePerTrip, chargeWholeTrips = true, } = input;
    assertNonNegative(quantity, 'quantity');
    assertNonNegative(ratePerTrip, 'ratePerTrip');
    if (!(truckCapacity > 0)) {
        throw new RangeError('A trip-priced haul needs a positive truck capacity');
    }
    const minimum = input.minimumBillableQuantity ?? truckCapacity;
    if (!(minimum > 0)) {
        throw new RangeError('A minimum billable quantity must be positive');
    }
    const derivation = [];
    const warnings = [];
    const loads = safeDivide(quantity, truckCapacity);
    const tripsPaid = chargeWholeTrips ? Math.ceil(loads) : roundTo(loads, 4);
    const truckingCost = money(tripsPaid * ratePerTrip);
    derivation.push(`${roundTo(quantity, 3)} over ${truckCapacity} per truck = ${roundTo(loads, 4)} loads`);
    derivation.push(chargeWholeTrips
        ? `rounded up to ${tripsPaid} trips, because a partial load is paid as a whole trip`
        : `${tripsPaid} trips, prorated — the quote pays the last load by quantity`);
    derivation.push(`x ${unitRate(ratePerTrip)} per trip = ${money(truckingCost)}`);
    const billedQuantity = tripsPaid * minimum;
    const unusedCapacity = roundTo(Math.max(billedQuantity - quantity, 0), 4);
    if (chargeWholeTrips && unusedCapacity > 0) {
        /*
         * Worth saying out loud rather than leaving in the arithmetic: on a small
         * haul the unfilled part of the last truck can be a large share of what is
         * paid for, and an estimator comparing this against a per-unit quote needs
         * to see it.
         */
        warnings.push(`${unusedCapacity} of billed capacity is not moved: the last truck runs `
            + `${roundTo(unusedCapacity, 2)} short and is paid in full. On a haul this size that `
            + `is ${roundTo(safeDivide(unusedCapacity, billedQuantity) * 100, 1)}% of what is billed.`);
    }
    warnings.push('Priced by the trip. This is a cost and not a haul analysis: it says nothing about '
        + 'how many trucks the loader needs or how long the haul takes. RULE-004 wants a '
        + 'cycle analysis before issue where the schedule depends on the haul.');
    return {
        quantity: roundTo(quantity, 4),
        truckCapacity,
        loads: roundTo(loads, 4),
        tripsPaid,
        ratePerTrip: unitRate(ratePerTrip),
        truckingCost,
        unusedCapacity,
        effectiveRatePerUnit: unitRate(safeDivide(truckingCost, quantity)),
        derivation,
        warnings,
    };
}
/** Within this fraction of the fill requirement, the site is called balanced. */
const CUT_FILL_TOLERANCE = 0.02;
/**
 * Cut/fill balance in the correct volume states.
 *
 * The single most common earthwork estimating error is comparing raw cut to
 * raw fill. Cut is bank, fill is compacted, and the shrink factor between them
 * routinely turns an apparently balanced site into an import job. This function
 * converts before it compares, and never the other way round.
 */
export function analyzeCutFill(input) {
    assertNonNegative(input.cutBcy, 'cutBcy');
    assertNonNegative(input.fillCcy, 'fillCcy');
    assertNonNegative(input.swellPercent, 'swellPercent');
    assertNonNegative(input.shrinkPercent, 'shrinkPercent');
    if (input.shrinkPercent >= 1)
        throw new RangeError('shrinkPercent must be < 1');
    const unsuitablePercent = assertNonNegative(input.unsuitablePercent ?? 0, 'unsuitablePercent');
    if (unsuitablePercent > 1)
        throw new RangeError('unsuitablePercent must be <= 1');
    const warnings = [];
    const topsoilStripBcy = assertNonNegative(input.topsoilStripBcy ?? 0, 'topsoilStripBcy');
    const topsoilReplaceCcy = assertNonNegative(input.topsoilReplaceCcy ?? 0, 'topsoilReplaceCcy');
    const unsuitableBcy = roundTo(input.cutBcy * unsuitablePercent, 4);
    const reusableCutBcy = roundTo(input.cutBcy - unsuitableBcy, 4);
    const reusableAsCompactedCcy = roundTo(reusableCutBcy * (1 - input.shrinkPercent), 4);
    const netCcy = roundTo(reusableAsCompactedCcy - input.fillCcy, 4);
    const reference = Math.max(input.fillCcy, 1);
    let condition;
    let importCcy = 0;
    let exportBcy = 0;
    if (Math.abs(netCcy) / reference <= CUT_FILL_TOLERANCE) {
        condition = 'balanced';
    }
    else if (netCcy < 0) {
        condition = 'import_required';
        importCcy = roundTo(-netCcy, 4);
    }
    else {
        condition = 'export_required';
        // Surplus compacted-equivalent converts back to bank to be excavated and hauled.
        exportBcy = roundTo(netCcy / (1 - input.shrinkPercent), 4);
    }
    // Unsuitable material always leaves the site regardless of the mass balance.
    const totalExportBcy = roundTo(exportBcy + unsuitableBcy, 4);
    const exportLcy = roundTo(totalExportBcy * (1 + input.swellPercent), 4);
    const importBcy = roundTo(importCcy / (1 - input.shrinkPercent), 4);
    const topsoilBalanceBcy = roundTo(topsoilStripBcy - topsoilReplaceCcy / (1 - input.shrinkPercent), 4);
    if (unsuitableBcy > 0) {
        warnings.push(`${unsuitableBcy} BCY of unsuitable material must leave the site in addition to any mass-balance export.`);
    }
    if (topsoilBalanceBcy < 0) {
        warnings.push(`Topsoil replacement exceeds topsoil stripped by ${roundTo(-topsoilBalanceBcy, 2)} BCY; topsoil import is required.`);
    }
    if (input.cutBcy > 0 && input.fillCcy > 0 && input.shrinkPercent === 0) {
        warnings.push('Shrink factor is 0, which claims compacted fill occupies the same volume as bank material. ' +
            'This is not physical for common earth and will understate import.');
    }
    return {
        cutBcy: roundTo(input.cutBcy, 4),
        unsuitableBcy,
        reusableCutBcy,
        reusableAsCompactedCcy,
        fillCcy: roundTo(input.fillCcy, 4),
        importCcy,
        importBcy,
        exportBcy: totalExportBcy,
        exportLcy,
        topsoilStripBcy,
        topsoilReplaceCcy,
        topsoilBalanceBcy,
        condition,
        derivation: `cut ${roundTo(input.cutBcy, 2)} BCY - unsuitable ${unsuitableBcy} BCY = ${reusableCutBcy} BCY reusable; ` +
            `x (1 - ${factor(input.shrinkPercent)} shrink) = ${reusableAsCompactedCcy} CCY available vs ` +
            `${roundTo(input.fillCcy, 2)} CCY required -> ${condition}` +
            (importCcy ? `, import ${importCcy} CCY (${importBcy} BCY to purchase)` : '') +
            (totalExportBcy ? `, export ${totalExportBcy} BCY (${exportLcy} LCY to truck)` : ''),
        warnings,
    };
}
