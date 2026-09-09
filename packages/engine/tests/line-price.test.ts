/**
 * What a line sells for.
 *
 * Two things were missing and they were the same thing. A line had a cost and
 * no price, so the screen could show what the work costs and never what it is
 * being sold for. And `markup_override` — a column since migration 0107, an
 * editor on every line, a value the estimator types — was read by nothing: the
 * engine priced the whole estimate from the profile and the override moved a
 * number on the screen and not one cent of the bid.
 *
 * The schema says what it means: "this line's own markup as a fraction, or null
 * to use the pricing profile". So an overridden line is priced at its own rate
 * and comes out of the profile's base entirely — anything else applies two
 * markups to one line.
 *
 * The property that matters most is the last one here: the lines add up to the
 * bid, exactly, to the cent. A bid that disagrees with the lines it is made of
 * is the one thing an estimator cannot explain to a customer.
 */
import { describe, expect, it } from 'vitest';
import { calculateEstimate, type EstimateLineInput } from '../src/estimate.js';
import { resolveEquipmentRate, type LaborClassification } from '../src/resources.js';
import type { PricingProfile } from '../src/pricing.js';
import type { ProductionRate } from '../src/production.js';

const OP: LaborClassification = {
  id: 'L', classification: 'Op', group: 'Operator',
  baseWagePerHour: 50, burdenPercent: 0, overtimeMultiplier: 1.5, doubletimeMultiplier: 2,
};
const rate: ProductionRate = {
  id: 'PR', ratePerHour: 100, unit: 'CY', utilizationFactor: 1, shiftHours: 8,
  sourceType: 'company_actual', confidence: 0.95, approvalStatus: 'approved',
};
const machine = {
  id: 'E', name: 'Ex', equipmentClass: 'Ex',
  rate: resolveEquipmentRate([{ source: 'tenant_approved' as const, hourlyRate: 150 }], '2026-06-01'),
  count: 1, fuelGallonsPerHour: 0, operatorRequired: true,
};

/** 1,000 CY at 100 CY/hr = 10 hr. 10x50 labor + 10x150 machine = $2,000. */
const line = (id: string, over: Partial<EstimateLineInput> = {}): EstimateLineInput => ({
  id, description: `Line ${id}`,
  quantity: { measured: 1000, unit: 'CY', method: 'explicit_dimension' },
  productionRate: rate,
  crew: { id: 'C', name: 'C', shiftHours: 8, members: [{ classification: OP, count: 1 }] },
  equipment: [machine],
  verification: { primarySource: true, crossSource: true, mathematicalReconciliation: true },
  ...over,
});

const flat = (percent: number): PricingProfile => ({
  id: 'P', name: 'Flat', method: 'parallel',
  components: percent > 0
    ? [{ code: 'OH', label: 'Overhead and profit', percent, basis: 'profile_default', sequence: 1 }]
    : [],
});

const build = (lines: EstimateLineInput[], profile: PricingProfile) =>
  calculateEstimate({
    id: 'E', number: 'E-1', name: 'Bid', version: 1, status: 'draft', lines, pricingProfile: profile,
  });

describe('a line carries a price, not only a cost', () => {
  const r = build([line('a'), line('b')], flat(0.2));

  it('costs each line what its resources cost', () => {
    expect(r.lines.map((l) => l.totalDirectCost)).toEqual([2000, 2000]);
  });

  it('gives each line a price above its cost', () => {
    for (const l of r.lines) expect(l.price).toBeGreaterThan(l.totalDirectCost);
  });

  it('says the markup inside the price, in money and as a rate', () => {
    for (const l of r.lines) {
      expect(l.markupAmount).toBe(Number((l.price - l.totalDirectCost).toFixed(2)));
      expect(l.markupRate).toBeGreaterThan(0);
    }
  });

  it('gives a unit price beside the unit cost', () => {
    for (const l of r.lines) {
      expect(l.unitCost).toBe(2);                       // $2,000 over 1,000 CY
      expect(l.unitPrice).toBeGreaterThan(l.unitCost);
    }
  });

  it('adds the lines up to the bid, to the cent', () => {
    const sum = r.lines.reduce((a, l) => a + l.price, 0);
    expect(Number(sum.toFixed(2))).toBe(r.price.totalPrice);
  });
});

describe('a line the estimator priced by hand', () => {
  it('is marked up at its own rate rather than the profile', () => {
    // 50% on a $2,000 line is $1,000, whatever the profile says.
    const r = build([line('a', { markupOverride: 0.5 }), line('b')], flat(0.2));
    const a = r.lines.find((l) => l.id === 'a')!;
    expect(a.markupAmount).toBe(1000);
    expect(a.price).toBe(3000);
    expect(a.markupRate).toBe(0.5);
  });

  it('leaves the other lines on the profile', () => {
    const r = build([line('a', { markupOverride: 0.5 }), line('b')], flat(0.2));
    const b = r.lines.find((l) => l.id === 'b')!;
    expect(b.markupRate).not.toBe(0.5);
    expect(b.price).toBeLessThan(3000);
  });

  it('changes the bid, which is the whole point of typing it', () => {
    // The number was read by nothing before this: the same two lines priced
    // identically whatever was typed on them.
    const without = build([line('a'), line('b')], flat(0.2)).price.totalPrice;
    const with50 = build([line('a', { markupOverride: 0.5 }), line('b')], flat(0.2))
      .price.totalPrice;
    expect(with50).toBeGreaterThan(without);
  });

  it('is not marked up twice', () => {
    // Out of the profile's base entirely: 2,000 x 1.5 and nothing further.
    const r = build([line('a', { markupOverride: 0.5 })], flat(0.2));
    expect(r.lines[0]!.price).toBe(3000);
  });

  it('takes a zero as a real answer, not as "use the profile"', () => {
    const r = build([line('a', { markupOverride: 0 }), line('b')], flat(0.2));
    const a = r.lines.find((l) => l.id === 'a')!;
    expect(a.markupAmount).toBe(0);
    expect(a.price).toBe(2000);
  });

  it('says the contingency does not reach it', () => {
    const r = build([line('a', { markupOverride: 0.5 }), line('b')], flat(0.2));
    expect(r.warnings.join(' ')).toMatch(/own markup.*contingency does not cover/s);
  });

  it('still adds up to the bid exactly', () => {
    const r = build([line('a', { markupOverride: 0.5 }), line('b')], flat(0.2));
    const sum = r.lines.reduce((a, l) => a + l.price, 0);
    expect(Number(sum.toFixed(2))).toBe(r.price.totalPrice);
  });
});

describe('the cents go somewhere', () => {
  it('adds up exactly across three lines that do not divide evenly', () => {
    /*
     * Three equal lines and a price that does not divide by three is the case
     * that loses a cent to rounding. Largest remainder hands it to a line
     * rather than dropping it, so the bid equals its own lines.
     */
    const r = build([line('a'), line('b'), line('c')], flat(0.1));
    const sum = r.lines.reduce((a, l) => a + l.price, 0);
    expect(Number(sum.toFixed(2))).toBe(r.price.totalPrice);
  });

  it('adds up with no markup at all', () => {
    const r = build([line('a'), line('b'), line('c')], flat(0));
    const sum = r.lines.reduce((a, l) => a + l.price, 0);
    expect(Number(sum.toFixed(2))).toBe(r.price.totalPrice);
  });

  it('adds up when every line was priced by hand', () => {
    const r = build([
      line('a', { markupOverride: 0.15 }),
      line('b', { markupOverride: 0.4 }),
    ], flat(0.2));
    const sum = r.lines.reduce((a, l) => a + l.price, 0);
    expect(Number(sum.toFixed(2))).toBe(r.price.totalPrice);
    expect(r.price.totalPrice).toBe(2300 + 2800);
  });

  it('prices a zero-cost line at zero rather than dividing by it', () => {
    const r = build([line('a'), line('z', {
      quantity: { measured: 0, unit: 'CY', method: 'explicit_dimension' },
    })], flat(0.2));
    const z = r.lines.find((l) => l.id === 'z')!;
    expect(z.price).toBe(0);
    expect(Number.isFinite(z.unitPrice)).toBe(true);
  });
});
