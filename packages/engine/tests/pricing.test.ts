import { describe, expect, it } from 'vitest';
import {
  addDirectCost, applyCostModifiers, bidRounding, breakEvenQuantity, calculatePrice,
  compareMarkupMethods, EMPTY_DIRECT_COST, parallelTotalPrice, standardProfile,
  totalDirectCost, unitPrice, type DirectCostBreakdown, type PricingProfile,
} from '../src/pricing.js';

const avgMarket = standardProfile('PP-AVG', 'Average Market', 'parallel', {
  overhead: 0.1, profit: 0.12, contingency: 0.03,
});
const union = standardProfile('PP-UNION', 'Union', 'stacked', {
  overhead: 0.12, profit: 0.12, contingency: 0.04,
});

describe('direct cost buckets (RULE-001)', () => {
  const a: DirectCostBreakdown = {
    ...EMPTY_DIRECT_COST, laborWage: 1000, laborBurden: 350, equipmentOwnership: 2000, fuel: 500,
  };
  const b: DirectCostBreakdown = { ...EMPTY_DIRECT_COST, material: 750, trucking: 1200, disposal: 300 };

  it('sums to the whole', () => {
    expect(totalDirectCost(a)).toBe(3850);
    expect(totalDirectCost(b)).toBe(2250);
    expect(totalDirectCost(addDirectCost(a, b))).toBe(6100);
  });

  it('keeps every bucket separately visible after addition', () => {
    const sum = addDirectCost(a, b);
    expect(sum.laborWage).toBe(1000);
    expect(sum.laborBurden).toBe(350);
    expect(sum.material).toBe(750);
    expect(sum.trucking).toBe(1200);
  });

  it('starts from a frozen empty breakdown', () => {
    expect(Object.isFrozen(EMPTY_DIRECT_COST)).toBe(true);
    expect(totalDirectCost(EMPTY_DIRECT_COST)).toBe(0);
  });

  it('routes cost modifiers to their declared bucket only', () => {
    const r = applyCostModifiers(a, {
      labor_cost: 1.47, equipment_cost: 1.35, material_cost: 1, trucking_cost: 1, disposal_cost: 1,
    });
    expect(r.laborWage).toBe(1470);
    expect(r.laborBurden).toBe(514.5);
    expect(r.equipmentOwnership).toBe(2700);
    // Fuel follows equipment: same machine, same hours, harder conditions.
    expect(r.fuel).toBe(675);
  });

  it('leaves subcontract and other untouched by condition modifiers', () => {
    const withSub: DirectCostBreakdown = { ...EMPTY_DIRECT_COST, subcontract: 5000, other: 1000 };
    const r = applyCostModifiers(withSub, {
      labor_cost: 2, equipment_cost: 2, material_cost: 2, trucking_cost: 2, disposal_cost: 2,
    });
    // A subcontractor's fixed price does not move because our crew hit rock.
    expect(r.subcontract).toBe(5000);
    expect(r.other).toBe(1000);
  });
});

describe('parallel markup', () => {
  it('applies every component to the same basis and sums', () => {
    // $100,000 x (1 + 0.10 + 0.12 + 0.03) = $125,000
    const r = calculatePrice(100000, 0, avgMarket);
    expect(r.totalPrice).toBe(125000);
    expect(r.totalMarkup).toBe(25000);
    expect(r.effectiveMarkupPercent).toBe(0.25);
  });

  it('reports the basis and dollar effect of each component (RULE-007)', () => {
    const r = calculatePrice(100000, 0, avgMarket);
    const oh = r.appliedMarkups.find((m) => m.code === 'OH')!;
    const profit = r.appliedMarkups.find((m) => m.code === 'PROFIT')!;
    expect(oh.appliedTo).toBe(100000);
    expect(oh.amount).toBe(10000);
    // Profit is applied to the same $100,000, not to $110,000.
    expect(profit.appliedTo).toBe(100000);
    expect(profit.amount).toBe(12000);
  });

  it('includes indirect cost in the markup basis', () => {
    // ($100,000 + $20,000) x 1.25 = $150,000
    const r = calculatePrice(100000, 20000, avgMarket);
    expect(r.baseCost).toBe(120000);
    expect(r.totalPrice).toBe(150000);
  });

  it('computes gross margin on the sell price, not on cost', () => {
    const r = calculatePrice(100000, 0, avgMarket);
    // (125,000 - 100,000) / 125,000 = 20%, not the 25% markup.
    expect(r.grossMarginPercent).toBe(0.2);
  });
});

describe('stacked markup', () => {
  it('compounds each component on the running total', () => {
    // 100,000 x 1.12 = 112,000 x 1.12 = 125,440 x 1.04 = 130,457.60
    const r = calculatePrice(100000, 0, union);
    expect(r.appliedMarkups[0]!.runningTotal).toBe(112000);
    expect(r.appliedMarkups[1]!.runningTotal).toBe(125440);
    expect(r.totalPrice).toBe(130457.6);
  });

  it('respects the declared sequence', () => {
    const profile: PricingProfile = {
      id: 'P', name: 'P', method: 'stacked',
      components: [
        { code: 'B', label: 'Second', percent: 0.1, basis: 'running_total', sequence: 20 },
        { code: 'A', label: 'First', percent: 0.5, basis: 'running_total', sequence: 10 },
      ],
    };
    const r = calculatePrice(1000, 0, profile);
    expect(r.appliedMarkups.map((m) => m.code)).toEqual(['A', 'B']);
    // 1000 x 1.5 = 1500 x 1.1 = 1650
    expect(r.totalPrice).toBe(1650);
  });

  it('differs from parallel by a real, visible amount', () => {
    // 10% + 12% + 3% on $100,000: parallel $125,000, stacked $126,896.
    const cmp = compareMarkupMethods(100000, 0, avgMarket);
    expect(cmp.parallel).toBe(125000);
    expect(cmp.stacked).toBe(126896);
    expect(cmp.difference).toBe(1896);
    expect(cmp.differencePercent).toBe(0.015168);
  });
});

describe('bond and tax applied on the marked-up total', () => {
  it('charges bond and tax after overhead, profit and contingency', () => {
    const p = standardProfile('P', 'P', 'parallel', { overhead: 0.1, profit: 0.1, bond: 0.01 });
    const r = calculatePrice(100000, 0, p);
    const bond = r.appliedMarkups.find((m) => m.code === 'BOND')!;
    // Bond is 1% of the bid price, so it applies after overhead and profit
    // even in a parallel profile: 100,000 + 10,000 + 10,000 = 120,000.
    expect(bond.appliedTo).toBe(120000);
    expect(bond.amount).toBe(1200);
    expect(r.totalPrice).toBe(121200);
  });

  it('stacks bond onto the running total when the profile is stacked', () => {
    const p = standardProfile('P', 'P', 'stacked', { overhead: 0.1, profit: 0.1, bond: 0.01 });
    const r = calculatePrice(100000, 0, p);
    const bond = r.appliedMarkups.find((m) => m.code === 'BOND')!;
    // 100,000 x 1.1 = 110,000 x 1.1 = 121,000; bond applies to 121,000.
    expect(bond.appliedTo).toBe(121000);
    expect(bond.amount).toBe(1210);
    expect(r.totalPrice).toBe(122210);
  });
});

describe('regional factor and escalation', () => {
  it('scales base cost by the regional factor before markup', () => {
    // 100,000 x 1.08 = 108,000 x 1.25 = 135,000
    const r = calculatePrice(100000, 0, { ...avgMarket, region: 'Chicago', regionalFactor: 1.08 });
    expect(r.regionalAdjustment).toBe(8000);
    expect(r.adjustedCost).toBe(108000);
    expect(r.totalPrice).toBe(135000);
  });

  it('compounds escalation annually', () => {
    // 100,000 x 1.04^2 = 108,160
    const r = calculatePrice(100000, 0, { ...avgMarket, escalationPercent: 0.04, escalationYears: 2 });
    expect(r.escalationAdjustment).toBe(8160);
    expect(r.adjustedCost).toBe(108160);
  });

  it('warns when a region is named but the factor was never set', () => {
    const r = calculatePrice(100000, 0, { ...avgMarket, region: 'Chicago' });
    expect(r.warnings.some((w) => w.includes('regional factor of 1.0'))).toBe(true);
  });
});

describe('pricing guards', () => {
  it('warns when a profile has no markup at all', () => {
    const r = calculatePrice(100000, 0, { id: 'P', name: 'At cost', method: 'parallel', components: [] });
    expect(r.totalPrice).toBe(100000);
    expect(r.warnings.some((w) => w.includes('sells at cost'))).toBe(true);
  });

  it('warns when markup more than doubles the cost', () => {
    const r = calculatePrice(100000, 0, standardProfile('P', 'P', 'parallel', { overhead: 0.6, profit: 0.6 }));
    expect(r.warnings.some((w) => w.includes('more than doubles the cost'))).toBe(true);
  });

  it('prices zero cost as zero', () => {
    const r = calculatePrice(0, 0, avgMarket);
    expect(r.totalPrice).toBe(0);
    expect(r.effectiveMarkupPercent).toBe(0);
    expect(r.grossMarginPercent).toBe(0);
  });

  it('rejects negative cost and negative percentages', () => {
    expect(() => calculatePrice(-1, 0, avgMarket)).toThrow(RangeError);
    expect(() => calculatePrice(100, 0, standardProfile('P', 'P', 'parallel', { overhead: -0.1 }))).toThrow(RangeError);
  });
});

describe('pricing helpers', () => {
  it('computes unit price', () => {
    expect(unitPrice(125000, 10000)).toBe(12.5);
    expect(unitPrice(125000, 0)).toBe(0);
  });

  it('rounds a bid up to an increment, never down', () => {
    expect(bidRounding(124_312.44, 500)).toEqual({ rounded: 124500, adjustment: 187.56 });
    // An exact multiple must not be pushed to the next increment.
    expect(bidRounding(124500, 500)).toEqual({ rounded: 124500, adjustment: 0 });
    expect(bidRounding(124_312.44, 0)).toEqual({ rounded: 124312.44, adjustment: 0 });
  });

  it('computes the classic parallel total price', () => {
    expect(parallelTotalPrice(100000, 0.1, 0.12, 0.03)).toBe(125000);
    expect(parallelTotalPrice(100000, 0.1, 0.12, 0.03, 0.07)).toBe(132000);
    expect(parallelTotalPrice(100000)).toBe(100000);
  });

  it('computes break-even quantity and reports impossibility as Infinity', () => {
    // $50,000 fixed / ($12.50 - $7.50) = 10,000 units
    expect(breakEvenQuantity(50000, 12.5, 7.5)).toBe(10000);
    expect(breakEvenQuantity(50000, 7.5, 7.5)).toBe(Number.POSITIVE_INFINITY);
    expect(breakEvenQuantity(50000, 5, 7.5)).toBe(Number.POSITIVE_INFINITY);
  });

  it('builds a standard profile with only the components that were requested', () => {
    const p = standardProfile('P', 'P', 'parallel', { overhead: 0.1 });
    expect(p.components.map((c) => c.code)).toEqual(['OH']);
  });
});

/**
 * Selling for less than the estimate says.
 *
 * A discount is not a negative markup component, and the distinction is
 * deliberate: markup is asserted non-negative because a component that reduced
 * the price would make "what is this job marked up at" unanswerable. A
 * concession is a commercial decision taken after the price is known, and it is
 * reported separately so the margin given away is visible rather than buried in
 * a smaller markup figure that reads like a cheaper job.
 */
describe('a discount', () => {
  const profile = (discount?: {
    percent?: number; amount?: number; reason?: string;
  }): PricingProfile => ({
    id: 'pp-1', name: 'Standard', method: 'parallel',
    components: [
      { code: 'OH', label: 'Overhead', percent: 0.10, basis: 'profile_default', sequence: 10 },
      { code: 'PROFIT', label: 'Profit', percent: 0.15, basis: 'profile_default', sequence: 20 },
    ],
    ...(discount ? { discount } : {}),
  });

  it('changes nothing when there is none', () => {
    const r = calculatePrice(100_000, 0, profile());
    expect(r.totalPrice).toBe(125_000);
    expect(r.discountAmount).toBe(0);
  });

  it('comes off the price, not the cost', () => {
    /*
     * Five percent off means five percent off the number quoted. Discounting
     * before markup would give away more than that: 5% of 100,000 marked up
     * 25% is 6,250, against 6,250 of price — the same here only because the
     * markup is parallel, and different the moment anything is stacked or
     * charged on the marked-up total.
     */
    const r = calculatePrice(100_000, 0, profile({ percent: 0.05, reason: 'Repeat customer' }));
    expect(r.discountAmount).toBe(6_250);
    expect(r.totalPrice).toBe(118_750);
    // The markup itself is untouched: this job is still marked up 25%.
    expect(r.totalMarkup).toBe(25_000);
  });

  it('takes a flat sum off', () => {
    const r = calculatePrice(100_000, 0, profile({ amount: 5_000, reason: 'Goodwill' }));
    expect(r.discountAmount).toBe(5_000);
    expect(r.totalPrice).toBe(120_000);
  });

  it('takes the percentage first, then the flat sum', () => {
    const r = calculatePrice(100_000, 0, profile({
      percent: 0.05, amount: 1_000, reason: 'Negotiated',
    }));
    expect(r.discountAmount).toBe(7_250);
    expect(r.totalPrice).toBe(117_750);
  });

  it('reports the thinner margin the concession actually leaves', () => {
    // Margin against what is being charged, so a discount shows up as the
    // thinner margin it is rather than staying at the markup figure.
    const full = calculatePrice(100_000, 0, profile());
    const cut = calculatePrice(100_000, 0, profile({ percent: 0.10, reason: 'Bid day' }));
    expect(cut.grossMarginPercent).toBeLessThan(full.grossMarginPercent);
    expect(cut.grossMarginPercent).toBeCloseTo((112_500 - 100_000) / 112_500, 4);
  });

  it('says so when nobody recorded why', () => {
    // Somebody reviewing the bid cannot otherwise tell what was given away.
    const r = calculatePrice(100_000, 0, profile({ percent: 0.05 }));
    expect(r.warnings.join(' ')).toMatch(/no reason recorded/);
  });

  it('keeps quiet when the reason is there', () => {
    const r = calculatePrice(100_000, 0, profile({ percent: 0.05, reason: 'Repeat customer' }));
    expect(r.warnings.join(' ')).not.toMatch(/no reason recorded/);
  });

  it('says plainly when the discount sells the job below cost', () => {
    const r = calculatePrice(100_000, 0, profile({ percent: 0.30, reason: 'Wanted the work' }));
    expect(r.totalPrice).toBeLessThan(100_000);
    expect(r.warnings.join(' ')).toMatch(/loses money at the number quoted/);
  });

  it('shows the concession in the derivation', () => {
    const r = calculatePrice(100_000, 0, profile({ percent: 0.05, reason: 'Repeat customer' }));
    expect(r.derivation.join('\n')).toMatch(/discount: 125000 - 6250/);
    expect(r.derivation.join('\n')).toMatch(/Repeat customer/);
    expect(r.derivation.join('\n')).toMatch(/markup 25000, discount 6250/);
  });

  it('refuses a negative discount rather than quietly raising the price', () => {
    expect(() => calculatePrice(100_000, 0, profile({ percent: -0.05 })))
      .toThrow(/discount percent/);
  });
});
