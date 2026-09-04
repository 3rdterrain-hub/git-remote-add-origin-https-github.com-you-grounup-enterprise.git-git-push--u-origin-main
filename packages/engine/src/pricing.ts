/**
 * Markup, indirect cost and final price (RULE-007).
 *
 * "Parallel and stacked profiles are supported; basis, sequence and dollar
 * effect must be shown." Both methods are implemented exactly, and every
 * component reports the base it was applied to and the dollars it added, so a
 * customer or auditor can reconstruct the price by hand.
 */

import { assertNonNegative, factor, money, roundTo, safeDivide, sumMoney, unitRate } from './numeric.js';

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

export const EMPTY_DIRECT_COST: Readonly<DirectCostBreakdown> = Object.freeze({
  laborWage: 0,
  laborBurden: 0,
  equipmentOwnership: 0,
  equipmentMobilization: 0,
  fuel: 0,
  material: 0,
  trucking: 0,
  disposal: 0,
  subcontract: 0,
  other: 0,
});

export function addDirectCost(a: DirectCostBreakdown, b: DirectCostBreakdown): DirectCostBreakdown {
  return {
    laborWage: money(a.laborWage + b.laborWage),
    laborBurden: money(a.laborBurden + b.laborBurden),
    equipmentOwnership: money(a.equipmentOwnership + b.equipmentOwnership),
    equipmentMobilization: money(a.equipmentMobilization + b.equipmentMobilization),
    fuel: money(a.fuel + b.fuel),
    material: money(a.material + b.material),
    trucking: money(a.trucking + b.trucking),
    disposal: money(a.disposal + b.disposal),
    subcontract: money(a.subcontract + b.subcontract),
    other: money(a.other + b.other),
  };
}

export function totalDirectCost(d: DirectCostBreakdown): number {
  return sumMoney([
    d.laborWage, d.laborBurden, d.equipmentOwnership, d.equipmentMobilization,
    d.fuel, d.material, d.trucking, d.disposal, d.subcontract, d.other,
  ]);
}

/** Apply per-bucket cost modifiers resolved by `resolveModifiers`. */
export function applyCostModifiers(
  d: DirectCostBreakdown,
  m: { labor_cost: number; equipment_cost: number; material_cost: number; trucking_cost: number; disposal_cost: number },
): DirectCostBreakdown {
  return {
    laborWage: money(d.laborWage * m.labor_cost),
    laborBurden: money(d.laborBurden * m.labor_cost),
    equipmentOwnership: money(d.equipmentOwnership * m.equipment_cost),
    equipmentMobilization: money(d.equipmentMobilization * m.equipment_cost),
    // Fuel follows equipment: the same machine running the same hours in the
    // same conditions burns proportionally more diesel.
    fuel: money(d.fuel * m.equipment_cost),
    material: money(d.material * m.material_cost),
    trucking: money(d.trucking * m.trucking_cost),
    disposal: money(d.disposal * m.disposal_cost),
    subcontract: d.subcontract,
    other: d.other,
  };
}

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

/** What a markup component is calculated on. */
export type MarkupBasis =
  /**
   * The profile's own convention: in a parallel profile this is the adjusted
   * cost, and in a stacked profile it is the running total. This is the basis
   * overhead, profit and contingency normally use, and it is what makes the
   * two markup methods actually differ.
   */
  | 'profile_default'
  | 'direct_cost'          // direct cost only, whatever else the profile does
  | 'direct_plus_indirect' // direct + indirect, pinned regardless of method
  | 'running_total'        // explicitly chain on the previous component
  | 'marked_up_total';     // applied after overhead, profit and contingency

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
export function calculatePrice(
  directCost: number,
  indirectCost: number,
  profile: PricingProfile,
): PriceResult {
  assertNonNegative(directCost, 'directCost');
  assertNonNegative(indirectCost, 'indirectCost');

  const warnings: string[] = [];
  const derivation: string[] = [];

  const baseCost = money(directCost + indirectCost);
  derivation.push(`direct ${money(directCost)} + indirect ${money(indirectCost)} = ${baseCost} base cost`);

  const regionalFactor = profile.regionalFactor ?? 1;
  assertNonNegative(regionalFactor, 'regionalFactor');
  const regionalAdjustment = money(baseCost * (regionalFactor - 1));
  const afterRegional = money(baseCost + regionalAdjustment);
  if (regionalFactor !== 1) {
    derivation.push(
      `x ${factor(regionalFactor)} regional factor (${profile.region ?? 'unspecified region'}) = ${afterRegional}`,
    );
  }
  if (regionalFactor === 1 && profile.region) {
    warnings.push(
      `Pricing profile names region "${profile.region}" but carries a regional factor of 1.0; ` +
        `confirm the factor is intentional rather than unset.`,
    );
  }

  const escalationPercent = profile.escalationPercent ?? 0;
  const escalationYears = profile.escalationYears ?? 0;
  assertNonNegative(escalationPercent, 'escalationPercent');
  assertNonNegative(escalationYears, 'escalationYears');
  // Compounded: escalation is an annual rate, and two years of 4% is 8.16%.
  const escalationMultiplier = (1 + escalationPercent) ** escalationYears;
  const escalationAdjustment = money(afterRegional * (escalationMultiplier - 1));
  const adjustedCost = money(afterRegional + escalationAdjustment);
  if (escalationAdjustment !== 0) {
    derivation.push(
      `x (1 + ${factor(escalationPercent)})^${escalationYears} escalation = ${adjustedCost}`,
    );
  }

  const components = [...profile.components].sort((a, b) => a.sequence - b.sequence);
  for (const c of components) assertNonNegative(c.percent, `markup ${c.code} percent`);

  // Regional factor and escalation move the real cost basis, so a component
  // pinned to "direct cost" is pinned to the *adjusted* direct cost — not to a
  // pre-adjustment figure that no longer describes what the work costs.
  const costAdjustment = baseCost === 0 ? 1 : adjustedCost / baseCost;
  const pinnedBasis = (b: MarkupBasis): number =>
    b === 'direct_cost' ? money(directCost * costAdjustment) : money((directCost + indirectCost) * costAdjustment);

  const appliedMarkups: AppliedMarkup[] = [];
  let runningTotal = adjustedCost;

  // Bond, tax and anything else declared on the marked-up total is applied in a
  // second pass, because "1% of the bid price" genuinely means the price after
  // overhead, profit and contingency — in either markup method.
  const primary = components.filter((c) => c.basis !== 'marked_up_total');
  const onMarkedUpTotal = components.filter((c) => c.basis === 'marked_up_total');

  for (const c of primary) {
    const appliedTo =
      c.basis === 'profile_default'
        ? profile.method === 'stacked'
          ? runningTotal
          : adjustedCost
        : c.basis === 'running_total'
          ? runningTotal
          : pinnedBasis(c.basis);
    const amount = money(appliedTo * c.percent);
    runningTotal = money(runningTotal + amount);
    appliedMarkups.push({
      code: c.code,
      label: c.label,
      percent: factor(c.percent),
      basis: c.basis,
      sequence: c.sequence,
      appliedTo,
      amount,
      runningTotal,
      derivation:
        `${c.label}: ${appliedTo} x ${factor(c.percent)} = ${amount} ` +
        `(${profile.method}, on ${c.basis === 'profile_default' ? (profile.method === 'stacked' ? 'running total' : 'adjusted cost') : c.basis})`,
    });
  }

  for (const c of onMarkedUpTotal) {
    const appliedTo = runningTotal;
    const amount = money(appliedTo * c.percent);
    runningTotal = money(runningTotal + amount);
    appliedMarkups.push({
      code: c.code,
      label: c.label,
      percent: factor(c.percent),
      basis: c.basis,
      sequence: c.sequence,
      appliedTo,
      amount,
      runningTotal,
      derivation: `${c.label}: ${appliedTo} x ${factor(c.percent)} = ${amount} (on marked-up total)`,
    });
  }

  for (const m of appliedMarkups) derivation.push(m.derivation);

  const totalPrice = runningTotal;
  const totalMarkup = money(totalPrice - adjustedCost);
  derivation.push(`total price ${totalPrice} (markup ${totalMarkup})`);

  const totalMarkupPercent = components.reduce((a, c) => a + c.percent, 0);
  if (totalMarkupPercent > 1) {
    warnings.push(
      `Markup components total ${factor(totalMarkupPercent * 100)}%, which more than doubles the cost. ` +
        `Verify the profile before issuing.`,
    );
  }
  if (components.length === 0) {
    warnings.push(`Pricing profile ${profile.id} has no markup components; the estimate sells at cost.`);
  }

  return {
    directCost: money(directCost),
    indirectCost: money(indirectCost),
    baseCost,
    regionalFactor: factor(regionalFactor),
    regionalAdjustment,
    escalationPercent: factor(escalationPercent),
    escalationAdjustment,
    adjustedCost,
    method: profile.method,
    appliedMarkups,
    totalMarkup,
    totalPrice,
    effectiveMarkupPercent: factor(safeDivide(totalMarkup, adjustedCost)),
    grossMarginPercent: factor(safeDivide(totalPrice - adjustedCost, totalPrice)),
    derivation,
    warnings,
  };
}

/** Unit price = total price / quantity produced. */
export function unitPrice(totalPrice: number, quantity: number): number {
  return unitRate(safeDivide(totalPrice, quantity));
}

/**
 * Compare the two markup methods on identical inputs.
 *
 * Used by the estimate review screen so an estimator sees, in dollars, what
 * switching profiles would do before a bid is issued.
 */
export function compareMarkupMethods(
  directCost: number,
  indirectCost: number,
  profile: PricingProfile,
): { parallel: number; stacked: number; difference: number; differencePercent: number } {
  const parallel = calculatePrice(directCost, indirectCost, { ...profile, method: 'parallel' }).totalPrice;
  const stacked = calculatePrice(directCost, indirectCost, { ...profile, method: 'stacked' }).totalPrice;
  return {
    parallel,
    stacked,
    difference: money(stacked - parallel),
    differencePercent: factor(safeDivide(stacked - parallel, parallel)),
  };
}

/** Build the standard OH / profit / contingency / tax profile from four percentages. */
export function standardProfile(
  id: string,
  name: string,
  method: MarkupMethod,
  p: { overhead?: number; profit?: number; contingency?: number; tax?: number; bond?: number },
  extras: Partial<Pick<PricingProfile, 'region' | 'regionalFactor' | 'escalationPercent' | 'escalationYears'>> = {},
): PricingProfile {
  const components: MarkupComponent[] = [];
  if (p.overhead) components.push({ code: 'OH', label: 'Overhead', percent: p.overhead, basis: 'profile_default', sequence: 10 });
  if (p.profit) components.push({ code: 'PROFIT', label: 'Profit', percent: p.profit, basis: 'profile_default', sequence: 20 });
  if (p.contingency) components.push({ code: 'CONT', label: 'Contingency', percent: p.contingency, basis: 'profile_default', sequence: 30 });
  if (p.bond) components.push({ code: 'BOND', label: 'Bond', percent: p.bond, basis: 'marked_up_total', sequence: 40, disclosed: true });
  if (p.tax) components.push({ code: 'TAX', label: 'Tax', percent: p.tax, basis: 'marked_up_total', sequence: 50, disclosed: true });
  return { id, name, method, components, ...extras };
}

/** Round a bid to a presentation increment without ever rounding *down*. */
export function bidRounding(price: number, increment: number): { rounded: number; adjustment: number } {
  assertNonNegative(price, 'price');
  if (increment <= 0) return { rounded: money(price), adjustment: 0 };
  const rounded = money(Math.ceil(price / increment - 1e-9) * increment);
  return { rounded, adjustment: money(rounded - price) };
}

/** Total price the classic way: direct x (1 + oh + profit + contingency + tax). */
export function parallelTotalPrice(
  directCost: number,
  overhead = 0,
  profit = 0,
  contingency = 0,
  tax = 0,
): number {
  assertNonNegative(directCost, 'directCost');
  return money(directCost * (1 + overhead + profit + contingency + tax));
}

/** Break-even quantity: fixed cost / (unit price - unit variable cost). */
export function breakEvenQuantity(fixedCost: number, unitPriceValue: number, unitVariableCost: number): number {
  const contribution = unitPriceValue - unitVariableCost;
  if (contribution <= 0) return Number.POSITIVE_INFINITY;
  return roundTo(safeDivide(fixedCost, contribution), 2);
}
