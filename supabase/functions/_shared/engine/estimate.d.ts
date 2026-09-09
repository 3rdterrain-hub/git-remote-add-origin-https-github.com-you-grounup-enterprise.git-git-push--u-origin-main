/**
 * Estimate line and estimate rollup — the orchestrator.
 *
 * This is the only entry point the application layer calls to price work. It
 * threads quantity -> conditions -> production -> duration -> crew / equipment /
 * fuel / material / haul -> direct cost -> markup -> price, and returns every
 * intermediate value, because RULE-001 and Section 23 both require the
 * calculation to be inspectable rather than merely correct.
 */
import { type QuantityInput, type QuantityResult } from './quantity.js';
import { resolveModifiers, type BottleneckAnalysis, type ConditionModifier, type DurationResult, type ProductionAnalysis, type ProductionRate, type ResourceCapacity } from './production.js';
import { type Crew, type CrewCostResult, type EquipmentCostResult, type EquipmentItem } from './resources.js';
import { type HaulCycleInput, type HaulCycleResult } from './trucking.js';
import { unitPrice, type DirectCostBreakdown, type PriceResult, type PricingProfile } from './pricing.js';
import { type ApprovalGateResult, type ConfidenceResult, type VerificationChecks } from './confidence.js';
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
    modifiers?: readonly {
        modifier: ConditionModifier;
        justification: string;
    }[];
    productionRate?: ProductionRate;
    /** Additional resources that may govern production (RULE-005). */
    constrainingResources?: readonly ResourceCapacity[];
    crew?: Crew;
    equipment?: readonly EquipmentItem[];
    materials?: readonly MaterialRequirement[];
    haul?: Omit<HaulCycleInput, 'loaderProductionPerHour' | 'shiftHours'> & Partial<Pick<HaulCycleInput, 'loaderProductionPerHour' | 'shiftHours'>>;
    subcontractCost?: number;
    otherDirectCost?: number;
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
/**
 * Price one estimate line end to end.
 *
 * Production is resolved *before* cost, because duration drives crew and
 * equipment hours, which drive labor, ownership and fuel. Any line without a
 * production rate falls back to explicitly supplied hours; it never guesses a
 * rate, because an invented production rate is the fastest way to a confidently
 * wrong estimate.
 */
export declare function calculateEstimateLine(input: EstimateLineInput): EstimateLineResult;
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
    contingencyOverride?: {
        percent: number;
        approvedBy: string;
        reason: string;
    };
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
    indirectDetail: readonly {
        code: string;
        label: string;
        amount: number;
        basis: string;
    }[];
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
    executiveDecision: 'ready_for_estimating' | 'ready_with_assumptions' | 'senior_review_required' | 'rfi_resolution_required' | 'document_set_incomplete';
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
export declare function calculateEstimate(input: EstimateInput): EstimateResult;
export { unitPrice };
