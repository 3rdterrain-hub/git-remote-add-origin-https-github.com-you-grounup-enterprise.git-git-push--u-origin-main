/**
 * Markup, indirect cost and final price (RULE-007).
 *
 * "Parallel and stacked profiles are supported; basis, sequence and dollar
 * effect must be shown." Both methods are implemented exactly, and every
 * component reports the base it was applied to and the dollars it added, so a
 * customer or auditor can reconstruct the price by hand.
 */
export type MarkupMethod = 'parallel' | 'stacked';
/** Cost buckets kept separately visible for the whole engine (RULE-001). */
export interface DirectCostBreakdown {
    laborWage: number;
    laborBurden: number;
    equipmentOwnership: number;
    equipmentMobilization: number;
    fuel: number;
    material: number;
    trucking: number;
    disposal: number;
    subcontract: number;
    other: number;
}
export declare const EMPTY_DIRECT_COST: Readonly<DirectCostBreakdown>;
export declare function addDirectCost(a: DirectCostBreakdown, b: DirectCostBreakdown): DirectCostBreakdown;
export declare function totalDirectCost(d: DirectCostBreakdown): number;
/** Apply per-bucket cost modifiers resolved by `resolveModifiers`. */
export declare function applyCostModifiers(d: DirectCostBreakdown, m: {
    labor_cost: number;
    equipment_cost: number;
    material_cost: number;
    trucking_cost: number;
    disposal_cost: number;
}): DirectCostBreakdown;
/** What a markup component is calculated on. */
export type MarkupBasis = 
/**
 * The profile's own convention: in a parallel profile this is the adjusted
 * cost, and in a stacked profile it is the running total. This is the basis
 * overhead, profit and contingency normally use, and it is what makes the
 * two markup methods actually differ.
 */
'profile_default' | 'direct_cost' | 'direct_plus_indirect' | 'running_total' | 'marked_up_total';
export interface MarkupComponent {
    code: string;
    label: string;
    /** Fraction. 0.12 = 12%. */
    percent: number;
    basis: MarkupBasis;
    /** Lower sorts first. Only meaningful for the stacked method. */
    sequence: number;
    /** Included in the price but shown to the customer as a separate line. */
    disclosed?: boolean;
}
export interface PricingProfile {
    id: string;
    name: string;
    method: MarkupMethod;
    components: readonly MarkupComponent[];
    region?: string;
    /** Regional cost index. 1.0 = the profile's base region. */
    regionalFactor?: number;
    /** Annual escalation applied over `escalationYears`. */
    escalationPercent?: number;
    escalationYears?: number;
}
export interface AppliedMarkup {
    code: string;
    label: string;
    percent: number;
    basis: MarkupBasis;
    sequence: number;
    /** The dollar figure the percentage was applied to. */
    appliedTo: number;
    /** Dollars this component added. */
    amount: number;
    /** Price after this component. */
    runningTotal: number;
    derivation: string;
}
export interface PriceResult {
    directCost: number;
    indirectCost: number;
    /** Direct + indirect, before regional factor and escalation. */
    baseCost: number;
    regionalFactor: number;
    regionalAdjustment: number;
    escalationPercent: number;
    escalationAdjustment: number;
    /** Cost basis the markups are calculated from. */
    adjustedCost: number;
    method: MarkupMethod;
    appliedMarkups: readonly AppliedMarkup[];
    totalMarkup: number;
    totalPrice: number;
    /** totalMarkup / adjustedCost — what the markup actually came to. */
    effectiveMarkupPercent: number;
    /** (price - cost) / price — the margin on the sell price, not on cost. */
    grossMarginPercent: number;
    derivation: readonly string[];
    warnings: readonly string[];
}
/**
 * Price a cost using a markup profile.
 *
 * Parallel and stacked are genuinely different numbers, not presentation
 * choices. On $100,000 with 10% overhead + 12% profit + 3% contingency,
 * parallel yields $125,000 and stacked yields $126,896 — a $1,896 difference
 * that has to be visible before a bid goes out, which is why every component
 * reports `appliedTo` and `amount` rather than only a final total.
 */
export declare function calculatePrice(directCost: number, indirectCost: number, profile: PricingProfile): PriceResult;
/** Unit price = total price / quantity produced. */
export declare function unitPrice(totalPrice: number, quantity: number): number;
/**
 * Compare the two markup methods on identical inputs.
 *
 * Used by the estimate review screen so an estimator sees, in dollars, what
 * switching profiles would do before a bid is issued.
 */
export declare function compareMarkupMethods(directCost: number, indirectCost: number, profile: PricingProfile): {
    parallel: number;
    stacked: number;
    difference: number;
    differencePercent: number;
};
/** Build the standard OH / profit / contingency / tax profile from four percentages. */
export declare function standardProfile(id: string, name: string, method: MarkupMethod, p: {
    overhead?: number;
    profit?: number;
    contingency?: number;
    tax?: number;
    bond?: number;
}, extras?: Partial<Pick<PricingProfile, 'region' | 'regionalFactor' | 'escalationPercent' | 'escalationYears'>>): PricingProfile;
/** Round a bid to a presentation increment without ever rounding *down*. */
export declare function bidRounding(price: number, increment: number): {
    rounded: number;
    adjustment: number;
};
/** Total price the classic way: direct x (1 + oh + profit + contingency + tax). */
export declare function parallelTotalPrice(directCost: number, overhead?: number, profit?: number, contingency?: number, tax?: number): number;
/** Break-even quantity: fixed cost / (unit price - unit variable cost). */
export declare function breakEvenQuantity(fixedCost: number, unitPriceValue: number, unitVariableCost: number): number;
