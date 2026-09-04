/**
 * Takeoff quantity chain.
 *
 * Formula_Guide.csv: "Measured Qty -> Adjusted Qty -> Waste/Loss -> Gross Qty".
 *
 * Each step is retained on the result. An estimator auditing the line must be
 * able to see the number that was measured off the drawing, every adjustment
 * applied to it, and why — not just the number that got priced.
 */
import type { Unit } from './units.js';
/** How the measured quantity was obtained. Drives the confidence engine. */
export type MeasurementMethod = 'explicit_dimension' | 'verified_scale' | 'approximate_scale' | 'calculated' | 'derived' | 'schedule_quantity' | 'owner_quantity' | 'estimator_allowance';
/** Confidence contribution of each measurement method, 0-1. */
export declare const METHOD_RELIABILITY: Readonly<Record<MeasurementMethod, number>>;
export interface QuantityAdjustment {
    /** Stable code, e.g. 'OVERDIG', 'OVERBREAK', 'BID_RECONCILIATION'. */
    code: string;
    label: string;
    /** Additive fraction of the measured quantity. 0.05 = +5%. May be negative. */
    percent?: number;
    /** Absolute quantity added or removed, in the line's unit. */
    amount?: number;
    /** Why this adjustment exists. Required — no silent adjustments. */
    reason: string;
}
export interface QuantityInput {
    measured: number;
    unit: Unit;
    method: MeasurementMethod;
    /** Adjustments applied before waste, e.g. overdig, overbreak, bid reconciliation. */
    adjustments?: readonly QuantityAdjustment[];
    /** Material waste as a fraction. 0.05 = 5%. Applied after adjustments. */
    wastePercent?: number;
    /** Handling/placement loss as a fraction, tracked separately from waste. */
    lossPercent?: number;
    /** Basis for the waste factor. Required whenever wastePercent > 0 (Section 31). */
    wasteBasis?: string;
    /** Drawing/spec references supporting the measurement. */
    sources?: readonly string[];
}
export interface QuantityResult {
    measured: number;
    unit: Unit;
    method: MeasurementMethod;
    /** After adjustments, before waste and loss. This is the quantity to be produced. */
    adjusted: number;
    /** After waste and loss. This is the quantity to be purchased. */
    gross: number;
    wastePercent: number;
    lossPercent: number;
    wasteQuantity: number;
    lossQuantity: number;
    appliedAdjustments: readonly (QuantityAdjustment & {
        effect: number;
    })[];
    sources: readonly string[];
    /** Full derivation string for the audit panel. */
    derivation: string;
    /** Non-blocking issues the estimator must see (e.g. waste with no basis). */
    warnings: readonly string[];
}
/**
 * Run the measured quantity through the full chain.
 *
 * Waste and loss are kept as separate percentages and applied additively to
 * the adjusted quantity, not compounded. They describe two independent
 * physical causes (material cut/trim waste, and handling/placement loss);
 * compounding them would overstate purchase quantity for no physical reason.
 */
export declare function resolveQuantity(input: QuantityInput): QuantityResult;
/**
 * Reconcile an independently measured quantity against an owner/engineer bid
 * quantity (Section 24). The engine never silently adopts the bid quantity.
 */
export interface BidReconciliation {
    bidItem: string;
    unit: Unit;
    ownerQuantity: number;
    calculatedQuantity: number;
    variance: number;
    variancePercent: number;
    /** 'aligned' | 'review' | 'material' — drives the RFI and approval engines. */
    severity: 'aligned' | 'review' | 'material';
    recommendation: string;
}
export declare function reconcileBidQuantity(bidItem: string, unit: Unit, ownerQuantity: number, calculatedQuantity: number, reviewThreshold?: number, materialThreshold?: number): BidReconciliation;
