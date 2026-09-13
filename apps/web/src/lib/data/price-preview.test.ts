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
import {
  calculatePrice, calculateEstimate, standardProfile, type EstimateLineInput,
} from '@grounup/engine';
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

/**
 * The five points the panel was short.
 *
 * Found by pricing a real four-line estimate — E-2026-0005, Auburn Ave — and
 * reconciling every figure on it by hand. Labor, burden, hours and direct cost
 * all agreed to the cent. Markup came to $7,655.37, exactly 30.00% of direct
 * cost, against a panel that read `OH 10% · PROFIT 12% · CONT 3%` and previewed
 * 25%.
 *
 * The recorded number was right and the preview was wrong. `calculateEstimate`
 * derives a contingency from the weighted confidence of the run — 70.6 justifies
 * 8% — and charges the higher of that and the profile's 3%. The preview knew
 * only the profile's, so it came out five points light and then told the
 * estimator the correct recorded price was stale and to price it again. Pricing
 * it again produced the same 30%, because the engine applied the same rule.
 *
 * These lock the preview to the engine on the case that exposed it: not that
 * the arithmetic is right, but that both sides pick the same contingency.
 */
describe('the contingency the engine actually charges', () => {
  const OP1 = {
    id: 'LAB-OP1', classification: 'Heavy Equipment Operator I', group: 'Operator',
    baseWagePerHour: 40, burdenPercent: 0.35, overtimeMultiplier: 1.5, doubletimeMultiplier: 2,
  };
  const profile = standardProfile('PP-AVG', 'Average Market', 'parallel', {
    overhead: 0.10, profit: 0.12, contingency: 0.03,
  });
  /** Nothing verified, so confidence lands in a band that justifies more than 3%. */
  const line: EstimateLineInput = {
    id: 'L-1',
    description: 'Mass excavation',
    quantity: { measured: 800, unit: 'CY', method: 'estimator_allowance' },
    productionRate: {
      id: 'PR-1', ratePerHour: 100, unit: 'CY', utilizationFactor: 1, shiftHours: 8,
      sourceType: 'company_actual', confidence: 0.95, approvalStatus: 'approved',
    },
    crew: {
      id: 'CRW-1', name: 'Excavation crew', shiftHours: 8,
      members: [{ classification: OP1, count: 1 }],
    },
    equipment: [],
    fuelPricePerGallon: 4,
    verification: { primarySource: false, crossSource: false, mathematicalReconciliation: false },
  };
  const engine = calculateEstimate({
    id: 'E-1', number: 'E-2026-0005', name: 'Auburn Ave', version: 1, status: 'draft',
    lines: [line], pricingProfile: profile,
  });

  const panel: EstimateMarkup[] = [
    markup({ code: 'OH', label: 'Overhead', percent: 0.10, sequence: 10 }),
    markup({ code: 'PROFIT', label: 'Profit', percent: 0.12, sequence: 20 }),
    markup({ code: 'CONT', label: 'Contingency', percent: 0.03, sequence: 30 }),
  ];

  it('is the figure the confidence band justifies, not the one on the panel', () => {
    expect(engine.contingencySource).toBe('confidence_band');
    expect(engine.appliedContingency).toBeGreaterThan(0.03);
    expect(engine.recommendedContingency).toBe(engine.appliedContingency);
  });

  it('previews the same total the engine recorded, to the cent', () => {
    const preview = previewPrice({
      directCost: engine.totalDirectCost,
      indirectCost: engine.indirectCost,
      markups: panel,
      discount: none,
      contingency: { recommended: engine.recommendedContingency },
    })!;
    expect(preview.totalPrice).toBe(engine.price.totalPrice);
    expect(preview.totalMarkup).toBe(engine.price.totalMarkup);
    expect(preview.contingency).toEqual({
      applied: engine.appliedContingency,
      source: 'confidence_band',
      recommended: engine.recommendedContingency,
      onPanel: 0.03,
    });
  });

  it('came out short before it knew, which is the defect these tests exist for', () => {
    const blind = previewPrice({
      directCost: engine.totalDirectCost, indirectCost: engine.indirectCost,
      markups: panel, discount: none,
    })!;
    expect(blind.totalPrice).toBeLessThan(engine.price.totalPrice);
    expect(blind.contingency).toBeNull();
  });

  it('leaves a profile figure alone when it is already the higher one', () => {
    const generous = panel.map((m) => (m.code === 'CONT' ? { ...m, percent: 0.20 } : m));
    const preview = previewPrice({
      directCost: 100_000, indirectCost: 0, markups: generous, discount: none,
      contingency: { recommended: 0.08 },
    })!;
    expect(preview.contingency!.source).toBe('profile');
    expect(preview.contingency!.applied).toBe(0.20);
  });

  it('charges an approved override whatever either of the others says', () => {
    const preview = previewPrice({
      directCost: 100_000, indirectCost: 0, markups: panel, discount: none,
      contingency: { recommended: 0.12, override: 0.05 },
    })!;
    expect(preview.contingency!.source).toBe('override');
    expect(preview.contingency!.applied).toBe(0.05);
  });

  it('still charges the confidence band when contingency is switched off entirely', () => {
    // The engine applies its own however the panel is set, so a preview that
    // dropped it would read as a bid nobody is carrying any risk on.
    const off = panel.map((m) => (m.code === 'CONT' ? { ...m, enabled: false } : m));
    const preview = previewPrice({
      directCost: 100_000, indirectCost: 0, markups: off, discount: none,
      contingency: { recommended: 0.12 },
    })!;
    expect(preview.contingency!.source).toBe('confidence_band');
    expect(preview.components.map((c) => c.code)).toContain('CONT');
  });
});
