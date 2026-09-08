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
/**
 * Every bucket a modifier is allowed to touch. A modifier that does not
 * declare a target cannot affect it — there is no implicit spillover.
 */
export type ModifierTarget = 'production' | 'labor_cost' | 'equipment_cost' | 'material_cost' | 'trucking_cost' | 'disposal_cost' | 'indirect_cost' | 'schedule' | 'risk';
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
export declare function resolveModifiers(selections: readonly {
    modifier: ConditionModifier;
    justification: string;
}[]): ModifierResolution;
export type ProductionSourceType = 'company_actual' | 'company_historical' | 'regional_benchmark' | 'seed_benchmark' | 'manufacturer' | 'estimator_judgment';
/** Trust weighting used by the confidence engine (RULE-010). */
export declare const SOURCE_RELIABILITY: Readonly<Record<ProductionSourceType, number>>;
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
export declare function analyzeProduction(rate: ProductionRate, productionModifier?: number): ProductionAnalysis;
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
    utilization: readonly {
        id: string;
        name: string;
        capacityPerHour: number;
        utilization: number;
        slackPerHour: number;
    }[];
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
export declare function analyzeBottleneck(resources: readonly ResourceCapacity[]): BottleneckAnalysis;
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
    /** Days a superintendent should actually plan for. Rounded, for reading. */
    practicalDays: number;
    /**
     * The same figure unrounded, which is what crew cost is computed from.
     *
     * `practicalDays` is a schedule number and is rounded to two decimals so a
     * superintendent reads "1.54 days" rather than fourteen digits. Crew cost was
     * being taken from that rounded figure and multiplied back up by the shift
     * length, so a line of 333 CY at 100 CY/hr — 3.33 productive hours — was
     * billing 3.36 labor hours, while the excavator on the same line billed 3.33.
     * One line, two different hour counts, and the labor one could not be
     * reproduced by anybody checking it with a calculator.
     *
     * The drift went both ways (250 CY billed 2.48 against 2.5 productive), so it
     * was not a systematic overcharge — it was noise in the one number an
     * estimate has to be able to defend.
     */
    paidShifts: number;
    /** Planning range: optimistic (raw) to pessimistic (practical + 20%). */
    rangeDays: {
        low: number;
        high: number;
    };
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
export declare function calculateDuration(input: DurationInput): DurationResult;
