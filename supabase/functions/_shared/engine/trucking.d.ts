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
/**
 * Haul priced by the trip.
 *
 * The commonest way a trucker actually quotes, and it is not a per-unit rate
 * wearing different clothes. **You pay for the truck that arrives, not for the
 * dirt in it**, so a partial load costs a whole trip: 1,200 CY at 14 CY a truck
 * is 85.7 loads and 86 trips paid. Pricing that as a rate per cubic yard
 * understates it by most of a trip on every job, and by a great deal more on a
 * small one where a single partial load is a large share of the work.
 *
 * Some hauls carry a minimum billable quantity per trip instead — "$12 a ton,
 * 22-ton minimum" — which is the same idea from the other side: the trucker is
 * paid for capacity whether or not it is filled.
 *
 * This gives a defensible cost and deliberately says nothing about duration.
 * A negotiated trip rate is a real price; it is not a haul analysis, and it
 * cannot tell you how many trucks the loader needs or how long the haul takes.
 * `analyzeHaulCycle` answers those, and RULE-004 still wants it before an
 * estimate is issued on cycle-dependent work.
 */
export interface TripHaulInput {
    /** Quantity to move, in the same unit as the truck capacity. */
    quantity: number;
    /** What one truck carries. */
    truckCapacity: number;
    /** The negotiated price for one trip. */
    ratePerTrip: number;
    /**
     * Minimum quantity billed per trip, where the quote is written that way.
     * Defaults to the truck's capacity, which is the usual arrangement.
     */
    minimumBillableQuantity?: number;
    /**
     * Whether a partial load is paid as a whole trip. True by default, because
     * that is what "per trip" means; set false only where the quote genuinely
     * prorates the last load, which is rare and worth stating explicitly.
     */
    chargeWholeTrips?: boolean;
}
export interface TripHaulResult {
    quantity: number;
    truckCapacity: number;
    /** Loads the quantity actually fills, fractional. */
    loads: number;
    /** Trips paid for, which is what the invoice will say. */
    tripsPaid: number;
    ratePerTrip: number;
    truckingCost: number;
    /** Quantity paid for but not moved, because the last truck was not full. */
    unusedCapacity: number;
    /** The cost per unit this works out to, for comparison against a unit quote. */
    effectiveRatePerUnit: number;
    derivation: readonly string[];
    warnings: readonly string[];
}
export declare function tripHaulCost(input: TripHaulInput): TripHaulResult;
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
