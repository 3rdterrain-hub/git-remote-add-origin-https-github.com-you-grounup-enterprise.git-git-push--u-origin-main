/**
 * Takeoff quantity chain.
 *
 * Formula_Guide.csv: "Measured Qty -> Adjusted Qty -> Waste/Loss -> Gross Qty".
 *
 * Each step is retained on the result. An estimator auditing the line must be
 * able to see the number that was measured off the drawing, every adjustment
 * applied to it, and why — not just the number that got priced.
 */

import { assertFinite, assertNonNegative, qty, factor } from './numeric.js';
import type { Unit } from './units.js';

/** How the measured quantity was obtained. Drives the confidence engine. */
export type MeasurementMethod =
  | 'explicit_dimension'      // read directly off a dimensioned drawing
  | 'verified_scale'          // scaled, and the scale was tested against a known dimension
  | 'approximate_scale'       // scaled without independent scale verification
  | 'calculated'              // derived from other explicit dimensions
  | 'derived'                 // derived from a schedule, station range or count
  | 'schedule_quantity'       // taken from a drawing/bid schedule
  | 'owner_quantity'          // taken from the owner/engineer bid quantity
  | 'estimator_allowance';    // no measurable basis; an allowance

/** Confidence contribution of each measurement method, 0-1. */
export const METHOD_RELIABILITY: Readonly<Record<MeasurementMethod, number>> = {
  explicit_dimension: 1.0,
  calculated: 0.97,
  schedule_quantity: 0.94,
  owner_quantity: 0.92,
  verified_scale: 0.9,
  derived: 0.86,
  approximate_scale: 0.72,
  estimator_allowance: 0.5,
};

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
  appliedAdjustments: readonly (QuantityAdjustment & { effect: number })[];
  sources: readonly string[];
  /** Full derivation string for the audit panel. */
  derivation: string;
  /** Non-blocking issues the estimator must see (e.g. waste with no basis). */
  warnings: readonly string[];
}

const MAX_REASONABLE_WASTE = 0.5;

/**
 * Run the measured quantity through the full chain.
 *
 * Waste and loss are kept as separate percentages and applied additively to
 * the adjusted quantity, not compounded. They describe two independent
 * physical causes (material cut/trim waste, and handling/placement loss);
 * compounding them would overstate purchase quantity for no physical reason.
 */
export function resolveQuantity(input: QuantityInput): QuantityResult {
  assertNonNegative(input.measured, 'measured');
  const wastePercent = assertNonNegative(input.wastePercent ?? 0, 'wastePercent');
  const lossPercent = assertNonNegative(input.lossPercent ?? 0, 'lossPercent');

  const warnings: string[] = [];
  const steps: string[] = [`measured ${qty(input.measured)} ${input.unit} (${input.method})`];

  let adjusted = input.measured;
  const appliedAdjustments: (QuantityAdjustment & { effect: number })[] = [];

  for (const adj of input.adjustments ?? []) {
    if (adj.percent === undefined && adj.amount === undefined) {
      throw new RangeError(`Adjustment ${adj.code} must define percent or amount`);
    }
    if (!adj.reason || adj.reason.trim() === '') {
      throw new RangeError(`Adjustment ${adj.code} must state a reason (no silent adjustments)`);
    }
    let effect = 0;
    if (adj.percent !== undefined) {
      assertFinite(adj.percent, `adjustment ${adj.code} percent`);
      effect += input.measured * adj.percent;
    }
    if (adj.amount !== undefined) {
      assertFinite(adj.amount, `adjustment ${adj.code} amount`);
      effect += adj.amount;
    }
    adjusted += effect;
    appliedAdjustments.push({ ...adj, effect: qty(effect) });
    steps.push(`${adj.label} ${effect >= 0 ? '+' : ''}${qty(effect)} (${adj.reason})`);
  }

  if (adjusted < 0) {
    warnings.push(
      `Adjustments reduced the quantity below zero (${qty(adjusted)}); clamped to 0. Review the adjustment set.`,
    );
    adjusted = 0;
  }

  const wasteQuantity = adjusted * wastePercent;
  const lossQuantity = adjusted * lossPercent;
  const gross = adjusted + wasteQuantity + lossQuantity;

  if (wastePercent > 0 && !input.wasteBasis) {
    warnings.push(
      `A ${factor(wastePercent * 100)}% waste factor was applied with no stated basis. ` +
        `Section 31 requires every waste factor to record its reason and whether it is project-specific.`,
    );
  }
  if (wastePercent > MAX_REASONABLE_WASTE) {
    warnings.push(
      `Waste factor of ${factor(wastePercent * 100)}% exceeds ${MAX_REASONABLE_WASTE * 100}% and is almost certainly a data-entry error.`,
    );
  }
  if (input.method === 'approximate_scale') {
    warnings.push('Quantity was scaled without independent scale verification; not an explicit plan dimension.');
  }
  if (input.method === 'estimator_allowance') {
    warnings.push('Quantity is an estimator allowance with no measurable basis on the documents.');
  }
  if ((input.sources ?? []).length === 0 && input.method !== 'estimator_allowance') {
    warnings.push('No drawing or specification reference is recorded for this quantity.');
  }

  if (wastePercent > 0 || lossPercent > 0) {
    steps.push(
      `adjusted ${qty(adjusted)} x (1 + ${factor(wastePercent)} waste + ${factor(lossPercent)} loss) = ${qty(gross)} gross`,
    );
  }

  return {
    measured: qty(input.measured),
    unit: input.unit,
    method: input.method,
    adjusted: qty(adjusted),
    gross: qty(gross),
    wastePercent: factor(wastePercent),
    lossPercent: factor(lossPercent),
    wasteQuantity: qty(wasteQuantity),
    lossQuantity: qty(lossQuantity),
    appliedAdjustments,
    sources: input.sources ?? [],
    derivation: steps.join(' -> '),
    warnings,
  };
}

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

export function reconcileBidQuantity(
  bidItem: string,
  unit: Unit,
  ownerQuantity: number,
  calculatedQuantity: number,
  reviewThreshold = 0.05,
  materialThreshold = 0.1,
): BidReconciliation {
  assertNonNegative(ownerQuantity, 'ownerQuantity');
  assertNonNegative(calculatedQuantity, 'calculatedQuantity');
  const variance = calculatedQuantity - ownerQuantity;
  const variancePercent = ownerQuantity === 0 ? (calculatedQuantity === 0 ? 0 : 1) : variance / ownerQuantity;
  const magnitude = Math.abs(variancePercent);

  let severity: BidReconciliation['severity'] = 'aligned';
  if (magnitude > materialThreshold) severity = 'material';
  else if (magnitude > reviewThreshold) severity = 'review';

  const recommendation =
    severity === 'aligned'
      ? 'Independent takeoff agrees with the bid quantity within tolerance. Price the bid quantity.'
      : severity === 'review'
        ? 'Variance exceeds the review threshold. Re-measure before pricing; do not adopt the bid quantity to close the gap.'
        : 'Material variance. Senior review required, and an RFI is likely needed to resolve the quantity basis before final pricing.';

  return {
    bidItem,
    unit,
    ownerQuantity: qty(ownerQuantity),
    calculatedQuantity: qty(calculatedQuantity),
    variance: qty(variance),
    variancePercent: factor(variancePercent),
    severity,
    recommendation,
  };
}
