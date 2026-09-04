/**
 * Trip-based haul and disposal engine (Section 28).
 *
 * RULE-004: cycle-based trucking is authoritative. A shortcut unit rate
 * ($/CY hauled) is allowed only as a clearly-labeled preliminary number, and
 * this module marks it as such so it can never be mistaken for a priced haul.
 */
export interface HaulCycleInput {
    /** Quantity to move, in the truck-capacity unit (usually LCY or TON). */
    quantity: number;
    unit: string;
    /** Payload per truck in the same unit. */
    truckCapacity: number;
    /** One-way haul distance in miles. */
    oneWayMiles: number;
    /** Average speed loaded, mph. */
    loadedSpeedMph: number;
    /** Average speed returning empty, mph. */
    emptySpeedMph: number;
    /** Minutes to load one truck. Derived from loader production when omitted. */
    loadMinutes?: number;
    /** Minutes to dump and turn around. */
    dumpMinutes: number;
    /** Minutes lost per cycle to spotting, queueing, scale and traffic. */
    delayMinutes?: number;
    /** Production of the loading unit, in `unit` per hour. Governs truck count. */
    loaderProductionPerHour: number;
    shiftHours: number;
    /** Hourly cost of one truck including driver, or use `truckHourlyRate`. */
    truckHourlyRate: number;
    /** Disposal/tipping fee per unit at the destination. */
    disposalFeePerUnit?: number;
    /** Whole trucks actually available. Omit to size the fleet from the loader. */
    availableTrucks?: number;
}
export interface HaulCycleResult {
    loads: number;
    wholeLoads: number;
    loadMinutes: number;
    haulMinutes: number;
    dumpMinutes: number;
    returnMinutes: number;
    delayMinutes: number;
    cycleMinutes: number;
    cyclesPerTruckPerShift: number;
    /** Output of one truck per hour, in `unit`. */
    productionPerTruckPerHour: number;
    productionPerTruckPerShift: number;
    /** Trucks needed so the loader never waits. */
    trucksToBalanceLoader: number;
    trucksRequired: number;
    trucksUsed: number;
    /** What the haul operation actually delivers per hour with `trucksUsed`. */
    effectiveProductionPerHour: number;
    /** 'balanced' | 'loader_starved' | 'trucks_queueing'. */
    balance: 'balanced' | 'loader_starved' | 'trucks_queueing';
    balanceNote: string;
    totalTruckHours: number;
    truckingCost: number;
    disposalCost: number;
    costPerUnit: number;
    derivation: string;
    warnings: readonly string[];
}
/**
 * Full trip-based haul analysis.
 *
 * The engine sizes the fleet from the loader, then reports what the *actual*
 * fleet delivers. This matters because both failure modes cost money in
 * opposite ways: too few trucks idles the excavator (the expensive machine),
 * too many puts trucks in a queue being paid to wait.
 */
export declare function analyzeHaulCycle(input: HaulCycleInput): HaulCycleResult;
/**
 * Preliminary haul cost from a shortcut unit rate.
 *
 * RULE-004 permits this only as a labeled placeholder, so the result carries
 * `isPreliminary: true` and a warning that survives into the estimate's
 * approval gate.
 */
export interface PreliminaryHaulResult {
    quantity: number;
    ratePerUnit: number;
    truckingCost: number;
    isPreliminary: true;
    warnings: readonly string[];
}
export declare function preliminaryHaulCost(quantity: number, ratePerUnit: number, unit: string): PreliminaryHaulResult;
export interface CutFillInput {
    /** Total cut in bank cubic yards. */
    cutBcy: number;
    /** Compacted fill required, in compacted cubic yards. */
    fillCcy: number;
    /** Fraction of cut that is unsuitable for reuse as structural fill. */
    unsuitablePercent?: number;
    /** Topsoil stripped, in bank cubic yards, tracked separately from mass cut. */
    topsoilStripBcy?: number;
    /** Topsoil to be replaced, in compacted cubic yards. */
    topsoilReplaceCcy?: number;
    swellPercent: number;
    shrinkPercent: number;
}
export interface CutFillResult {
    cutBcy: number;
    unsuitableBcy: number;
    reusableCutBcy: number;
    /** Reusable cut expressed as the compacted fill it will actually make. */
    reusableAsCompactedCcy: number;
    fillCcy: number;
    /** > 0 means import is needed, in compacted cubic yards. */
    importCcy: number;
    /** Import expressed in bank cubic yards to buy and haul. */
    importBcy: number;
    /** > 0 means export is needed, in bank cubic yards. */
    exportBcy: number;
    /** Export expressed in loose cubic yards to truck. */
    exportLcy: number;
    topsoilStripBcy: number;
    topsoilReplaceCcy: number;
    topsoilBalanceBcy: number;
    condition: 'balanced' | 'import_required' | 'export_required';
    derivation: string;
    warnings: readonly string[];
}
/**
 * Cut/fill balance in the correct volume states.
 *
 * The single most common earthwork estimating error is comparing raw cut to
 * raw fill. Cut is bank, fill is compacted, and the shrink factor between them
 * routinely turns an apparently balanced site into an import job. This function
 * converts before it compares, and never the other way round.
 */
export declare function analyzeCutFill(input: CutFillInput): CutFillResult;
