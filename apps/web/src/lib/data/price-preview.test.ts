/**
 * The number moving while somebody types.
 *
 * On bid day an estimator moves a markup and needs the total to move with them.
 * Every price is written by the pricing Edge Function, which is correct and is
 * a network round trip, so the screen showed a stale number in between.
 *
 * The property that makes this safe rather than a second opinion: it calls
 * `calculatePrice` from `@grounup/engine` — the same module the Edge Function
 * runs, vendored with a fingerprint the build refuses to let drift. So these
 * tests are not checking arithmetic. They are checking that the preview is
 * the engine, that it previews only what markup is a function of, and that it
 * refuses to show a number when there is nothing to price against.
 */
import { describe, expect, it } from 'vitest';
import { calculatePrice } from '@grounup/engine';
import { previewPrice, previewDiffersFromStored } from './price-preview';
import type { EstimateMarkup, Discount } from './estimates';

const markup = (over: Partial<EstimateMarkup> = {}): EstimateMarkup => ({
  code: 'OH', label: 'Overhead', percent: 0.10, basis: 'profile_default',
  sequence: 10, disclosed: false, enabled: true, ...over,
});

const none: Discount = { percent: 0, amount: 0, reason: null };

describe('previewing a price', () => {
  it('agrees with the engine exactly, because it is the engine', () => {
    const markups = [markup(), markup({ code: 'PROFIT', label: 'Profit', percent: 0.15, sequence: 20 })];
    const preview = previewPrice({
      directCost: 100_000, indirectCost: 0, markups, discount: none,
    })!;
    const direct = calculatePrice(100_000, 0, {
      id: 'x', name: 'x', method: 'parallel',
      components: markups.map((m) => ({
        code: m.code, label: m.label, percent: m.percent,
        basis: m.basis, sequence: m.sequence, disclosed: m.disclosed,
      })),
    });
    expect(preview.totalPrice).toBe(direct.totalPrice);
    expect(preview.totalMarkup).toBe(direct.totalMarkup);
  });

  it('leaves a switched-off adjustment out', () => {
    const on = previewPrice({
      directCost: 100_000, indirectCost: 0, discount: none,
      markups: [markup(), markup({ code: 'BOND', label: 'Bond', percent: 0.05,
        basis: 'marked_up_total', sequence: 40 })],
    })!;
    const off = previewPrice({
      directCost: 100_000, indirectCost: 0, discount: none,
      markups: [markup(), markup({ code: 'BOND', label: 'Bond', percent: 0.05,
        basis: 'marked_up_total', sequence: 40, enabled: false })],
    })!;
    expect(on.totalPrice).toBeGreaterThan(off.totalPrice);
    expect(off.components.map((c) => c.code)).toEqual(['OH']);
  });

  it('keeps bond on the marked-up total, where it is actually charged', () => {
    // The distinction the panel exists to make. Overhead applies against cost;
    // bond applies to the price after it, in a second pass.
    const p = previewPrice({
      directCost: 100_000, indirectCost: 0, discount: none,
      markups: [
        markup({ percent: 0.20 }),
        markup({ code: 'BOND', label: 'Bond', percent: 0.05,
          basis: 'marked_up_total', sequence: 40 }),
      ],
    })!;
    // 100,000 + 20% = 120,000, then 5% of 120,000 = 6,000.
    expect(p.components.find((c) => c.code === 'BOND')!.amount).toBe(6_000);
    expect(p.totalPrice).toBe(126_000);
  });

  it('takes the discount off the price and reports it apart from markup', () => {
    const p = previewPrice({
      directCost: 100_000, indirectCost: 0,
      markups: [markup({ percent: 0.25 })],
      discount: { percent: 0.05, amount: 0, reason: 'Repeat customer' },
    })!;
    expect(p.totalMarkup).toBe(25_000);
    expect(p.discountAmount).toBe(6_250);
    expect(p.totalPrice).toBe(118_750);
  });

  it('carries the engine\'s warnings through', () => {
    // A discount below cost is the engine's judgment, not the screen's, and
    // the estimator needs to see it while they are still moving the number.
    const p = previewPrice({
      directCost: 100_000, indirectCost: 0,
      markups: [markup({ percent: 0.10 })],
      discount: { percent: 0.30, amount: 0, reason: 'Wanted the work' },
    })!;
    expect(p.warnings.join(' ')).toMatch(/loses money at the number quoted/);
  });

  it('shows nothing at all when there is no cost to price against', () => {
    /*
     * An unpriced estimate has no direct cost. Previewing markup on zero would
     * put a confident total in front of somebody who has not priced anything,
     * which is the exact failure this platform spends its time preventing.
     */
    expect(previewPrice({
      directCost: 0, indirectCost: 0, markups: [markup()], discount: none,
    })).toBeNull();
  });

  it('shows nothing rather than throwing on a half-typed number', () => {
    // The engine refuses a negative percentage. A preview that threw would
    // take the screen down while somebody was still typing.
    expect(previewPrice({
      directCost: 100_000, indirectCost: 0, discount: none,
      markups: [markup({ percent: -0.5 })],
    })).toBeNull();
  });

  it('does not recompute what the work costs', () => {
    /*
     * Direct and indirect cost come from the last engine run. Moving a markup
     * does not change what the work costs, which is why this preview is exact
     * rather than an approximation — and why changing a quantity or a crew
     * still needs the engine, since those rates come from the library.
     */
    const a = previewPrice({
      directCost: 100_000, indirectCost: 5_000,
      markups: [markup()], discount: none,
    })!;
    const b = previewPrice({
      directCost: 100_000, indirectCost: 5_000,
      markups: [markup({ percent: 0.40 })], discount: none,
    })!;
    // Only the markup moved; the cost underneath both is identical.
    expect(b.totalPrice - b.totalMarkup).toBe(a.totalPrice - a.totalMarkup);
  });

  it('knows when the preview has drifted from what is recorded', () => {
    // A screen showing a preview that differs from the stored price has to say
    // so, or somebody reads the preview as the bid.
    expect(previewDiffersFromStored(118_750, 125_000)).toBe(true);
    expect(previewDiffersFromStored(125_000, 125_000)).toBe(false);
    // A cent is rounding, not a change.
    expect(previewDiffersFromStored(125_000.004, 125_000)).toBe(false);
  });
});
