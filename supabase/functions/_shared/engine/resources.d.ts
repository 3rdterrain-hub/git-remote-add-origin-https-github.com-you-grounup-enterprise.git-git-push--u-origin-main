/**
 * Labor, crew, equipment and fuel.
 *
 * Governing rules:
 *  - RULE-001  Labor, burden, equipment, fuel, material, trucking, disposal and
 *              subcontract cost stay separately visible; nothing is blended.
 *  - RULE-003  Equipment rate hierarchy: project quote > approved tenant rate >
 *              regional rate > global seed. The winning source and its effective
 *              date are retained on the result.
 *  - RULE-010  Every non-company-actual rate carries source, confidence and
 *              review state.
 */
export interface LaborClassification {
    id: string;
    classification: string;
    group: string;
    baseWagePerHour: number;
    /** Fringe, taxes, insurance and company burden as a fraction of base wage. */
    burdenPercent: number;
    overtimeMultiplier: number;
    doubletimeMultiplier: number;
    region?: string;
    effectiveDate?: string;
    status?: 'active' | 'draft' | 'retired';
}
export interface LoadedLaborRate {
    classificationId: string;
    classification: string;
    baseWagePerHour: number;
    burdenPercent: number;
    burdenPerHour: number;
    /** Base + burden. This is the rate the cost engine multiplies by hours. */
    loadedPerHour: number;
    derivation: string;
}
/** Loaded rate = base x (1 + burden). Burden is reported separately per RULE-001. */
export declare function loadedLaborRate(labor: LaborClassification): LoadedLaborRate;
export interface CrewMember {
    classification: LaborClassification;
    count: number;
    /** Straight-time hours per shift for this member. */
    straightHoursPerShift?: number;
    overtimeHoursPerShift?: number;
    doubletimeHoursPerShift?: number;
}
export interface Crew {
    id: string;
    name: string;
    members: readonly CrewMember[];
    shiftHours: number;
}
export interface CrewCostResult {
    crewId: string;
    crewName: string;
    headcount: number;
    /** Total man-hours the crew delivers across the priced duration. */
    totalLaborHours: number;
    baseWageCost: number;
    burdenCost: number;
    overtimePremiumCost: number;
    /** baseWage + burden + overtime premium. */
    totalLaborCost: number;
    costPerCrewHour: number;
    lines: readonly {
        classificationId: string;
        classification: string;
        count: number;
        hoursEach: number;
        totalHours: number;
        baseWageCost: number;
        burdenCost: number;
        overtimePremiumCost: number;
        totalCost: number;
    }[];
    derivation: string;
    warnings: readonly string[];
}
/**
 * Cost a crew over `shifts` shifts.
 *
 * Overtime is priced as a *premium* on top of straight time rather than as a
 * separate full rate, so the base wage and burden buckets stay comparable
 * across estimates whether or not overtime was worked. Burden applies to the
 * premium as well, because fringe and payroll tax follow gross pay.
 */
export declare function calculateCrewCost(crew: Crew, shifts: number): CrewCostResult;
/** Rate sources in descending precedence. Index 0 wins. */
export declare const EQUIPMENT_RATE_PRECEDENCE: readonly ["project_quote", "tenant_approved", "regional", "global_seed"];
export type EquipmentRateSource = (typeof EQUIPMENT_RATE_PRECEDENCE)[number];
export interface EquipmentRateCandidate {
    source: EquipmentRateSource;
    hourlyRate: number;
    dailyRate?: number;
    weeklyRate?: number;
    monthlyRate?: number;
    effectiveDate?: string;
    expiresOn?: string;
    reference?: string;
}
export interface ResolvedEquipmentRate {
    hourlyRate: number;
    dailyRate?: number;
    weeklyRate?: number;
    monthlyRate?: number;
    source: EquipmentRateSource;
    effectiveDate?: string;
    reference?: string;
    /** Every candidate considered, so the estimator can see what was overridden. */
    consideredSources: readonly EquipmentRateSource[];
    derivation: string;
    warnings: readonly string[];
}
/**
 * Apply the RULE-003 rate hierarchy.
 *
 * `asOf` is required, not optional. It lets a historical estimate re-resolve to
 * the rate that was actually in force when it was priced — and a default of
 * "today" would defeat exactly that: reopening a two-year-old estimate would
 * silently reprice it against the current rate sheet, and the caller would have
 * no indication it had happened. Reading the clock here would also make the
 * engine non-deterministic, which every other guarantee depends on.
 */
export declare function resolveEquipmentRate(candidates: readonly EquipmentRateCandidate[], asOf: string): ResolvedEquipmentRate;
export interface EquipmentItem {
    id: string;
    name: string;
    equipmentClass: string;
    rate: ResolvedEquipmentRate;
    count: number;
    /** Gallons of diesel per operating hour. */
    fuelGallonsPerHour: number;
    /** DEF consumption as a fraction of diesel volume. */
    defPercentOfFuel?: number;
    operatorRequired: boolean;
    mobilizationRequired?: boolean;
    mobilizationCost?: number;
}
export interface EquipmentCostResult {
    totalEquipmentHours: number;
    ownershipCost: number;
    mobilizationCost: number;
    fuelGallons: number;
    defGallons: number;
    fuelCost: number;
    defCost: number;
    /** Ownership + mobilization. Fuel is reported separately per RULE-001. */
    totalEquipmentCost: number;
    lines: readonly {
        equipmentId: string;
        name: string;
        count: number;
        operatingHours: number;
        hourlyRate: number;
        rateSource: EquipmentRateSource;
        ownershipCost: number;
        mobilizationCost: number;
        fuelGallons: number;
        fuelCost: number;
    }[];
    derivation: string;
    warnings: readonly string[];
}
/**
 * Cost an equipment spread over `operatingHoursPerUnit` hours.
 *
 * Fuel is computed from operating hours and burn rate (Section 29) and kept out
 * of `totalEquipmentCost` so that RULE-001's separation survives into the
 * rollup — a reader can always see what the iron cost and what the diesel cost.
 */
export declare function calculateEquipmentCost(items: readonly EquipmentItem[], operatingHoursPerUnit: number, fuelPricePerGallon: number, defPricePerGallon?: number): EquipmentCostResult;
/** Fuel gallons = operating hours x burn rate (Section 29). */
export declare function fuelGallons(operatingHours: number, gallonsPerHour: number): number;
