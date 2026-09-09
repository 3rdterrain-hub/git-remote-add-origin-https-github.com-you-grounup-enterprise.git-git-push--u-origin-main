/**
 * A rate the estimator typed, and the engine that never read it.
 *
 * Not every line is built up. A subcontract quote, an allowance, a number
 * somebody simply knows — `parametric_cost_per_unit` has existed since
 * migration 0120 for exactly that, with a required basis so a reviewer can tell
 * a quote from a guess, its own editor on every line, and nineteen database
 * tests behind it.
 *
 * The engine had never heard of it. A line priced at $42.50 per LF on 500 LF
 * reached the pricing path carrying nothing, was reported as having "no crew,
 * equipment, material, subcontract or production rate on it. There is nothing
 * to price" — and because that is a refusal rather than a warning, that one
 * line returned a 422 and stopped the entire estimate from pricing. Found by
 * typing a rate into the running application and pressing the button.
 *
 * The multiplication belongs here rather than in the caller, and that is the
 * point of the second test: waste and loss apply to a quoted rate exactly as
 * they apply to a built-up one, and a caller doing its own arithmetic would
 * reach for the measured quantity and be quietly wrong.
 */
import { describe, expect, it } from 'vitest';
import { calculateEstimate, type EstimateLineInput } from '../src/estimate.js';
import type { PricingProfile } from '../src/pricing.js';

const flat = (percent: number): PricingProfile => ({
  id: 'P', name: 'Flat', method: 'parallel',
  components: percent > 0
    ? [{ code: 'OH', label: 'Overhead and profit', percent, basis: 'profile_default', sequence: 1 }]
    : [],
});

/** 500 LF at a rate somebody typed, and nothing else on the line at all. */
const typed = (over: Partial<EstimateLineInput> = {}): EstimateLineInput => ({
  id: 'L1', description: 'Electrical duct bank installation',
  quantity: { measured: 500, unit: 'LF', method: 'explicit_dimension' },
  parametricCostPerUnit: 42.5,
  parametricBasis: 'Sub quote, Delaney Bros, 9 Sep',
  verification: { primarySource: true, crossSource: false, mathematicalReconciliation: false },
  ...over,
});

const build = (lines: EstimateLineInput[], profile = flat(0)) =>
  calculateEstimate({
    id: 'E', number: 'E-1', name: 'Bid', version: 1, status: 'draft', lines, pricingProfile: profile,
  });

describe('a line priced at a rate somebody typed', () => {
  it('costs the rate times the quantity', () => {
    const [l] = build([typed()]).lines;
    // 500 LF x $42.50 = $21,250.00
    expect(l!.totalDirectCost).toBe(21_250);
  });

  it('gives the line a unit cost equal to the rate that was typed', () => {
    const [l] = build([typed()]).lines;
    expect(l!.unitCost).toBe(42.5);
  });

  it('files it as an allowance rather than as a subcontract', () => {
    /*
     * RULE-001: the buckets are not interchangeable. The platform scores a
     * typed rate as an allowance, and that is what decides the review the line
     * faces — calling it a subcontract would overstate what a guess is and
     * understate the review it needs.
     */
    const [l] = build([typed()]).lines;
    expect(l!.directCost.other).toBe(21_250);
    expect(l!.directCost.subcontract).toBe(0);
    expect(l!.directCost.laborWage).toBe(0);
    expect(l!.directCost.material).toBe(0);
  });

  it('shows the multiplication and the basis in the derivation', () => {
    const [l] = build([typed()]).lines;
    const line = l!.derivation.find((d) => d.startsWith('PARAMETRIC:'));
    expect(line).toContain('42.5 per LF x 500');
    expect(line).toContain('21250');
    expect(line).toContain('Sub quote, Delaney Bros, 9 Sep');
  });

  it('prices the quantity to be produced, adjustments included', () => {
    /*
     * The reason the multiplication belongs to the engine rather than to the
     * caller. A caller would reach for the measured quantity, and the number a
     * rate is owed on is the *adjusted* one — measured plus every adjustment
     * somebody justified. 40 LF of overdig at $42.50 is $1,700 that would
     * otherwise have gone missing without anybody seeing it happen.
     */
    const [l] = build([typed({
      quantity: {
        measured: 500, unit: 'LF', method: 'explicit_dimension',
        adjustments: [{
          code: 'OVERDIG', label: 'Overdig', percent: 0.08,
          reason: 'Trench box clearance either side of the duct bank.',
        }],
      },
    })]).lines;
    // 500 + 8% = 540 LF to install, x $42.50 = $22,950.00
    expect(l!.totalDirectCost).toBe(22_950);
  });

  it('does not add waste to a rate that already includes it', () => {
    /*
     * Waste is the difference between what is produced and what is *purchased*,
     * and a quoted rate is for the work: the subcontractor eats their own
     * offcuts and has already priced them. Charging the customer waste on top
     * of a quote bills the same material twice.
     */
    const [l] = build([typed({
      quantity: {
        measured: 500, unit: 'LF', method: 'explicit_dimension',
        wastePercent: 0.05, wasteBasis: 'Cut lengths on a 20 ft stick.',
      },
    })]).lines;
    expect(l!.totalDirectCost).toBe(21_250);
  });

  it('prices and marks up like any other line', () => {
    const result = build([typed()], flat(0.15));
    const [l] = result.lines;
    expect(l!.markupAmount).toBeGreaterThan(0);
    expect(l!.price).toBeGreaterThan(l!.totalDirectCost);
  });

  it('adds up to the bid beside lines that were built up', () => {
    // The property that matters most: a bid that disagrees with the lines it is
    // made of is the one thing an estimator cannot explain to a customer.
    const result = build([
      typed(),
      typed({ id: 'L2', parametricCostPerUnit: 17.25, quantity: { measured: 340, unit: 'LF', method: 'explicit_dimension' } }),
      typed({ id: 'L3', parametricCostPerUnit: 3.1, quantity: { measured: 977, unit: 'LF', method: 'explicit_dimension' } }),
    ], flat(0.18));
    const summed = result.lines.reduce((a, l) => a + l.price, 0);
    expect(Math.round(summed * 100)).toBe(Math.round(result.price.totalPrice * 100));
  });

  it('is nothing at all when no rate was typed', () => {
    const [l] = build([typed({ parametricCostPerUnit: undefined, parametricBasis: undefined })]).lines;
    expect(l!.totalDirectCost).toBe(0);
    expect(l!.derivation.some((d) => d.startsWith('PARAMETRIC:'))).toBe(false);
  });
});

describe('a typed rate the estimate should not stand behind', () => {
  it('says so when the rate does not say where it came from', () => {
    const [l] = build([typed({ parametricBasis: undefined })]).lines;
    expect(l!.warnings.join(' ')).toMatch(/where it came from/);
    // It still prices: refusing here would lose the number the estimator typed.
    // The refusal belongs at the gate before issue, not in the arithmetic.
    expect(l!.totalDirectCost).toBe(21_250);
  });

  it('treats whitespace as no basis at all', () => {
    const [l] = build([typed({ parametricBasis: '   ' })]).lines;
    expect(l!.warnings.join(' ')).toMatch(/where it came from/);
  });

  it('refuses to subtract money on a negative rate', () => {
    const [l] = build([typed({ parametricCostPerUnit: -5 })]).lines;
    expect(l!.warnings.join(' ')).toMatch(/cannot be negative/);
    expect(l!.totalDirectCost).toBe(0);
  });
});
