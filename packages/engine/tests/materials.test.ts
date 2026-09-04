import { describe, expect, it } from 'vitest';
import { calculateMaterialCost, calculateMaterialPackage, type MaterialInput } from '../src/materials.js';
import { money } from '../src/numeric.js';

const BASE: MaterialInput = {
  id: 'M-1', code: 'AGG-304', name: 'Aggregate base, 304',
  unit: 'TON', netQuantity: 500, unitCost: 22.5, source: 'company_price',
};

describe('waste', () => {
  it('adds waste to the net quantity', () => {
    // 500 + 5% = 525 TON; 525 x $22.50 = $11,812.50
    const r = calculateMaterialCost({ ...BASE, wastePercent: 0.05 });
    expect(r.wasteQuantity).toBe(25);
    expect(r.grossQuantity).toBe(525);
    expect(r.materialCost).toBe(11812.5);
  });

  it('says so when there is no waste allowance', () => {
    const r = calculateMaterialCost(BASE);
    expect(r.grossQuantity).toBe(500);
    expect(r.derivation).toContain('no waste allowance');
  });
});

describe('order multiples and supplier minimums', () => {
  it('rounds up to a whole order multiple', () => {
    // 500 TON in 25 TON loads: 20 exactly, no rounding.
    expect(calculateMaterialCost({ ...BASE, orderMultiple: 25 }).orderedQuantity).toBe(500);
    // 505 TON in 25 TON loads: 20.2 -> 21 loads -> 525 TON.
    const r = calculateMaterialCost({ ...BASE, netQuantity: 505, orderMultiple: 25 });
    expect(r.orderedQuantity).toBe(525);
    expect(r.surplusQuantity).toBe(20);
  });

  it('raises a small order to the supplier minimum and warns', () => {
    // The job needs 4 TON; the supplier will not sell less than 10.
    const r = calculateMaterialCost({ ...BASE, netQuantity: 4, minimumOrderQuantity: 10 });
    expect(r.orderedQuantity).toBe(10);
    expect(r.materialCost).toBe(225);
    expect(r.surplusQuantity).toBe(6);
    expect(r.warnings.join(' ')).toContain('supplier minimum');
  });

  it('warns when a large share is bought but never installed', () => {
    const r = calculateMaterialCost({ ...BASE, netQuantity: 4, minimumOrderQuantity: 10 });
    // 6 of 4 net is 150%; that is money spent whether or not it is placed.
    expect(r.warnings.join(' ')).toContain('bought but not installed');
  });

  it('does not warn when the surplus is small', () => {
    const r = calculateMaterialCost({ ...BASE, netQuantity: 498, orderMultiple: 25 });
    expect(r.surplusQuantity).toBe(2);
    expect(r.warnings.join(' ')).not.toContain('bought but not installed');
  });
});

describe('freight', () => {
  it('leaves cost alone when freight is in the unit price', () => {
    const r = calculateMaterialCost(BASE);
    expect(r.freightCost).toBe(0);
    expect(r.derivation).toContain('freight included');
  });

  it('charges freight as a percent of material', () => {
    // $11,250 x 8% = $900
    const r = calculateMaterialCost({ ...BASE, freightBasis: 'percent_of_material', freightAmount: 0.08 });
    expect(r.freightCost).toBe(900);
    expect(r.totalCost).toBe(12150);
  });

  it('charges freight per unit', () => {
    // 500 TON x $3.20 = $1,600
    const r = calculateMaterialCost({ ...BASE, freightBasis: 'per_unit', freightAmount: 3.2 });
    expect(r.freightCost).toBe(1600);
  });

  it('charges a part load in full', () => {
    // 500 TON at 22 TON per load = 22.7 loads -> 23 loads x $475 = $10,925.
    // Half a truck still sends a truck.
    const r = calculateMaterialCost({
      ...BASE, freightBasis: 'per_load', freightAmount: 475, unitsPerLoad: 22,
    });
    expect(r.freightCost).toBe(10925);
    expect(r.derivation).toContain('23 load(s)');
  });

  it('refuses per-load freight with no load size', () => {
    expect(() => calculateMaterialCost({ ...BASE, freightBasis: 'per_load', freightAmount: 475 }))
      .toThrow(/unitsPerLoad must be > 0/);
  });

  it('charges a lump sum', () => {
    const r = calculateMaterialCost({ ...BASE, freightBasis: 'lump_sum', freightAmount: 1250 });
    expect(r.freightCost).toBe(1250);
  });
});

describe('tax and the effective unit cost', () => {
  it('taxes material plus freight, not material alone', () => {
    // ($11,250 + $900) x 7.25% = $880.88
    const r = calculateMaterialCost({
      ...BASE, freightBasis: 'percent_of_material', freightAmount: 0.08, taxPercent: 0.0725,
    });
    expect(r.taxAmount).toBe(880.88);
    expect(r.totalCost).toBe(13030.88);
  });

  it('divides the total by the net quantity, not the ordered quantity', () => {
    // 4 TON needed, 10 bought at $22.50 = $225; $225 / 4 = $56.25 per TON.
    // Dividing by 10 would report $22.50 and hide the minimum-order cost.
    const r = calculateMaterialCost({ ...BASE, netQuantity: 4, minimumOrderQuantity: 10 });
    expect(r.effectiveUnitCost).toBe(56.25);
  });

  it('reports zero effective unit cost for a zero net quantity rather than dividing', () => {
    const r = calculateMaterialCost({ ...BASE, netQuantity: 0 });
    expect(r.effectiveUnitCost).toBe(0);
    expect(Number.isFinite(r.effectiveUnitCost)).toBe(true);
  });
});

describe('source and quotes', () => {
  it('warns that a catalog seed price is not a company price', () => {
    const r = calculateMaterialCost({ ...BASE, source: 'catalog_seed' });
    expect(r.warnings.join(' ')).toContain('catalog seed');
  });

  it('warns on a quote that expired before the pricing date', () => {
    const r = calculateMaterialCost({
      ...BASE, source: 'vendor_quote', quoteExpiresOn: '2026-05-01', asOf: '2026-09-02',
    });
    expect(r.warnings.join(' ')).toContain('expired 2026-05-01');
  });

  it('does not warn on a quote still in force', () => {
    const r = calculateMaterialCost({
      ...BASE, source: 'vendor_quote', quoteExpiresOn: '2026-12-31', asOf: '2026-09-02',
      freightBasis: 'per_unit', freightAmount: 3,
    });
    expect(r.warnings.join(' ')).not.toContain('expired');
  });

  it('asks whether a quote with freight included is delivered or ex-works', () => {
    // Quoting ex-works and pricing delivered is a standard way to lose the
    // margin on a material package.
    const r = calculateMaterialCost({ ...BASE, source: 'vendor_quote' });
    expect(r.warnings.join(' ')).toContain('delivered rather than ex-works');
  });
});

describe('validation', () => {
  it('refuses a negative net quantity', () => {
    expect(() => calculateMaterialCost({ ...BASE, netQuantity: -1 })).toThrow(RangeError);
  });
  it('refuses a negative unit cost', () => {
    expect(() => calculateMaterialCost({ ...BASE, unitCost: -1 })).toThrow(RangeError);
  });
  it('refuses a negative waste percent', () => {
    expect(() => calculateMaterialCost({ ...BASE, wastePercent: -0.1 })).toThrow(RangeError);
  });
});

describe('the derivation', () => {
  it('shows every step from net quantity to effective unit cost', () => {
    const r = calculateMaterialCost({
      ...BASE, netQuantity: 505, wastePercent: 0.05, orderMultiple: 25,
      freightBasis: 'per_load', freightAmount: 475, unitsPerLoad: 22, taxPercent: 0.0725,
    });
    // 505 + 5% = 530.25 -> rounded to 550 (22 multiples of 25)
    expect(r.grossQuantity).toBe(530.25);
    expect(r.orderedQuantity).toBe(550);
    expect(r.derivation).toContain('505 TON net + 5% waste = 530.25 TON');
    expect(r.derivation).toContain('rounded up to a 25 TON order multiple = 550 TON');
    expect(r.derivation).toContain('effective per TON');
  });
});

describe('a material package', () => {
  const pkg = calculateMaterialPackage([
    { ...BASE, freightBasis: 'per_unit', freightAmount: 3.2, taxPercent: 0.0725 },
    { id: 'M-2', code: 'RCP-18', name: '18 in RCP', unit: 'LF', netQuantity: 2340,
      unitCost: 42.8, wastePercent: 0.02, source: 'catalog_seed',
      freightBasis: 'lump_sum', freightAmount: 2200, taxPercent: 0.0725 },
  ]);

  it('keeps material, freight and tax separately visible (RULE-001)', () => {
    // 2,340 LF + 2% = 2,386.8 LF x $42.80 = $102,155.04
    expect(pkg.materialCost).toBe(11250 + 102155.04);
    expect(pkg.freightCost).toBe(1600 + 2200);
    // Rounded to the cent, not summed raw: adding three floats reintroduces
    // exactly the error the money kernel exists to remove.
    expect(pkg.totalCost).toBe(money(pkg.materialCost + pkg.freightCost + pkg.taxAmount));
  });

  it('carries every line warning up to the package', () => {
    expect(pkg.warnings.length).toBeGreaterThan(0);
  });

  it('states the package arithmetic', () => {
    expect(pkg.derivation).toContain('2 material line(s)');
  });
});
