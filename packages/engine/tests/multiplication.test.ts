/**
 * Does everything multiply correctly?
 *
 * The golden line in `estimate.test.ts` proves the happy path arithmetic. This
 * asks the adversarial version of the same question — the places where a
 * multiplication can be wrong and *look* right, because the number it produces
 * is plausible and nothing throws:
 *
 *   * waste applied twice, or compounded with loss;
 *   * production run against the purchase quantity instead of the work
 *     quantity, which slows every line carrying waste;
 *   * fuel charged inside an equipment rate and again in the fuel bucket;
 *   * a unit cost divided by the wrong quantity;
 *   * markup stacked when it should be parallel, which is a real difference in
 *     money rather than a naming preference;
 *   * a total that no longer equals the sum of its parts once everything has
 *     been rounded.
 *
 * Every expected number below is written out as arithmetic so it can be checked
 * on paper without running anything.
 */
import { describe, expect, it } from 'vitest';
import { calculateEstimateLine, calculateEstimate, type EstimateLineInput } from '../src/estimate.js';
import { resolveQuantity } from '../src/quantity.js';
import { calculatePrice, totalDirectCost, type PricingProfile } from '../src/pricing.js';
import { money } from '../src/numeric.js';
import { resolveEquipmentRate, type LaborClassification } from '../src/resources.js';
import type { ProductionRate } from '../src/production.js';

const OP: LaborClassification = {
  id: 'LAB-OP', classification: 'Operator', group: 'Operator',
  baseWagePerHour: 50, burdenPercent: 0.4, overtimeMultiplier: 1.5, doubletimeMultiplier: 2,
};

const rate = (perHour: number): ProductionRate => ({
  id: 'PR', ratePerHour: perHour, unit: 'CY', utilizationFactor: 1, shiftHours: 8,
  sourceType: 'company_actual', confidence: 0.95, approvalStatus: 'approved',
});

const machine = (hourly: number, gph: number) => ({
  id: 'EQ', name: 'Excavator', equipmentClass: 'Excavator',
  rate: resolveEquipmentRate([{ source: 'tenant_approved' as const, hourlyRate: hourly }], '2026-06-01'),
  count: 1, fuelGallonsPerHour: gph, operatorRequired: true,
});

// ---------------------------------------------------------------- quantity
describe('waste and loss', () => {
  it('adds them to the work quantity rather than compounding them', () => {
    // 1,000 + (1,000 x 10%) + (1,000 x 5%) = 1,150.
    // Compounded would be 1,000 x 1.10 x 1.05 = 1,155 — five yards of nobody's
    // material, and the error grows with every percentage point.
    const q = resolveQuantity({
      measured: 1000, unit: 'CY', method: 'explicit_dimension',
      wastePercent: 0.10, lossPercent: 0.05, wasteBasis: 'Trim and cut on a 1,000 CY pour',
    });
    expect(q.adjusted).toBe(1000);
    expect(q.gross).toBe(1150);
    expect(q.gross).not.toBe(1155);
  });

  it('keeps what is produced apart from what is purchased', () => {
    const q = resolveQuantity({
      measured: 500, unit: 'SY', method: 'explicit_dimension',
      wastePercent: 0.2, wasteBasis: 'Sheet goods, stated in the takeoff',
    });
    expect(q.adjusted).toBe(500);   // the work
    expect(q.gross).toBe(600);      // the buy
  });

  it('applies an adjustment to the measured quantity, then waste to the result', () => {
    // 1,000 measured, +10% overdig = 1,100 to excavate.
    // Waste of 10% is then 110 of the 1,100, not 100 of the 1,000.
    const q = resolveQuantity({
      measured: 1000, unit: 'CY', method: 'explicit_dimension',
      adjustments: [{ code: 'OVERDIG', label: 'Overdig', percent: 0.1, reason: 'Sheeting clearance' }],
      wastePercent: 0.1, wasteBasis: 'Stated',
    });
    expect(q.adjusted).toBe(1100);
    expect(q.wasteQuantity).toBe(110);
    expect(q.gross).toBe(1210);
  });
});

// -------------------------------------------------------------- production
describe('production runs against the work, not the purchase', () => {
  const line: EstimateLineInput = {
    id: 'L', description: 'Excavate with waste on the line',
    quantity: {
      measured: 1000, unit: 'CY', method: 'explicit_dimension',
      wastePercent: 0.15, wasteBasis: 'Stated on the takeoff',
    },
    productionRate: rate(100),
    crew: { id: 'C', name: 'Crew', shiftHours: 8, members: [{ classification: OP, count: 1 }] },
    equipment: [machine(120, 6)],
    fuelPricePerGallon: 5,
  };
  const r = calculateEstimateLine(line);

  it('takes ten hours, not eleven and a half', () => {
    // 1,000 CY of work / 100 CY per hour = 10 hr.
    // Against the 1,150 purchase quantity it would be 11.5 hr, and every line
    // carrying waste would quietly cost fifteen percent more labor.
    expect(r.duration!.productiveHours).toBe(10);
    expect(r.laborHours).toBe(10);
    expect(r.equipmentHours).toBe(10);
  });

  it('costs labor, burden, ownership and fuel as four separate products', () => {
    expect(r.directCost.laborWage).toBe(500);          // 10 hr x $50
    expect(r.directCost.laborBurden).toBe(200);        // $500 x 40%
    expect(r.directCost.equipmentOwnership).toBe(1200); // 10 hr x $120
    expect(r.fuelGallons).toBe(60);                    // 10 hr x 6 gal
    expect(r.directCost.fuel).toBe(300);               // 60 gal x $5
  });

  it('never folds fuel into the equipment rate', () => {
    // RULE-001. If ownership were fuel-inclusive the two would not be
    // separable, and a company whose rate already includes fuel would pay for
    // it twice with nothing on screen to say so.
    expect(r.directCost.equipmentOwnership + r.directCost.fuel).toBe(1500);
    expect(r.directCost.equipmentOwnership).not.toBe(1500);
  });

  it('charges no fuel for a machine that burns none', () => {
    // Every machine from the published rate schedule ships this way: the rate
    // already includes fuel, so the fuel bucket must stay at zero.
    const dry = calculateEstimateLine({ ...line, equipment: [machine(120, 0)] });
    expect(dry.fuelGallons).toBe(0);
    expect(dry.directCost.fuel).toBe(0);
    expect(dry.directCost.equipmentOwnership).toBe(1200);
  });

  it('divides the unit cost by the work quantity', () => {
    // 500 + 200 + 1,200 + 300 = 2,200 over 1,000 CY of work = $2.20 a yard.
    // Over the 1,150 purchase quantity it would read $1.9130, which is a rate
    // for a yard nobody excavates.
    expect(r.totalDirectCost).toBe(2200);
    expect(r.unitCost).toBe(2.2);
  });

  it('totals to the sum of its buckets, exactly', () => {
    expect(totalDirectCost(r.directCost)).toBe(r.totalDirectCost);
  });
});

// ------------------------------------------------------------------ markup
describe('markup', () => {
  const profile = (method: 'parallel' | 'stacked'): PricingProfile => ({
    id: 'P', name: 'Test', method,
    components: [
      { code: 'OH', label: 'Overhead', percent: 0.10, basis: 'profile_default', sequence: 1 },
      { code: 'PR', label: 'Profit', percent: 0.10, basis: 'profile_default', sequence: 2 },
    ],
  });

  it('parallel takes each percentage off the same base', () => {
    // $10,000 direct. 10% + 10% of the same $10,000 = $2,000. Price $12,000.
    const r = calculatePrice(10_000, 0, profile('parallel'));
    expect(r.totalMarkup).toBe(2000);
    expect(r.totalPrice).toBe(12_000);
  });

  it('stacked takes the second percentage off the first result', () => {
    // $10,000 x 1.10 = $11,000, x 1.10 = $12,100. A hundred dollars more than
    // parallel on ten thousand, and the gap widens with every component.
    const r = calculatePrice(10_000, 0, profile('stacked'));
    expect(r.totalPrice).toBe(12_100);
    expect(r.totalMarkup).toBe(2100);
  });

  it('is the difference between the two methods, not a naming preference', () => {
    const p = calculatePrice(10_000, 0, profile('parallel')).totalPrice;
    const s = calculatePrice(10_000, 0, profile('stacked')).totalPrice;
    expect(s - p).toBe(100);
  });

  it('pins a component to direct cost when it says so, in either method', () => {
    // The two methods differ only for components on the profile default. A
    // component that names its own basis keeps it, which is what lets a bond
    // on direct cost sit inside a stacked profile without being stacked.
    const pinned = { code: 'OH', label: 'Overhead', percent: 0.1,
                     basis: 'direct_cost' as const, sequence: 1 };
    const par = calculatePrice(10_000, 2_000, {
      id: 'P', name: 'T', method: 'parallel', components: [pinned] });
    const st = calculatePrice(10_000, 2_000, {
      id: 'P', name: 'T', method: 'stacked', components: [pinned] });
    expect(par.totalMarkup).toBe(1000);   // 10% of the 10,000 direct, not of 12,000
    expect(st.totalMarkup).toBe(1000);
  });

  it('marks up indirect cost when the component says direct plus indirect', () => {
    // Direct 10,000 + indirect 2,000 = 12,000 base. 10% of 12,000 = 1,200.
    const r = calculatePrice(10_000, 2_000, {
      id: 'P', name: 'T', method: 'parallel',
      components: [{ code: 'OH', label: 'Overhead', percent: 0.1, basis: 'direct_plus_indirect', sequence: 1 }],
    });
    expect(r.totalMarkup).toBe(1200);
    expect(r.totalPrice).toBe(13_200);
  });

  it('leaves the price at cost when there is no markup at all', () => {
    const r = calculatePrice(10_000, 2_000, {
      id: 'P', name: 'T', method: 'parallel', components: [],
    });
    expect(r.totalPrice).toBe(12_000);
    expect(r.totalMarkup).toBe(0);
  });

  it('compounds escalation by year rather than multiplying it', () => {
    // Two years at 4% is 8.16%, not 8%. $10,000 -> $10,816.
    const r = calculatePrice(10_000, 0, {
      id: 'P', name: 'T', method: 'parallel', components: [],
      escalationPercent: 0.04, escalationYears: 2,
    });
    expect(r.totalPrice).toBe(10_816);
  });
});

// ------------------------------------------------------------ the whole bid
describe('an estimate is the sum of its lines', () => {
  const one = (id: string, measured: number): EstimateLineInput => ({
    id, description: `Line ${id}`,
    quantity: { measured, unit: 'CY', method: 'explicit_dimension' },
    productionRate: rate(100),
    crew: { id: 'C', name: 'Crew', shiftHours: 8, members: [{ classification: OP, count: 1 }] },
    equipment: [machine(120, 6)],
    fuelPricePerGallon: 5,
  });

  it('adds the lines to the direct cost with nothing lost to rounding', () => {
    // Three lines of 1,000 CY: each 10 hr, each 500 + 200 + 1,200 + 300 = 2,200.
    const e = calculateEstimate({
      id: 'E', number: 'E-1', name: 'Sum check', version: 1, status: 'draft',
      lines: [one('a', 1000), one('b', 1000), one('c', 1000)],
      pricingProfile: { id: 'P', name: 'T', method: 'parallel', components: [] },
    });
    expect(e.lines.map((l) => l.totalDirectCost)).toEqual([2200, 2200, 2200]);
    expect(e.totalDirectCost).toBe(6600);

    /*
     * The price is above the cost even with an empty profile, and that is the
     * point: `calculateEstimate` adds the contingency the confidence band
     * justifies rather than letting a profile that names none ship at zero. It
     * says which, so the number is arguable rather than mysterious.
     */
    expect(e.contingencySource).toBe('confidence_band');
    expect(e.price.totalPrice).toBe(money(6600 * (1 + e.appliedContingency)));
    expect(e.price.totalPrice).toBeGreaterThan(6600);
  });

  it('survives quantities that do not divide evenly', () => {
    // 333 CY at 100 CY/hr = 3.33 hr. Labor 3.33 x 50 = 166.50, burden 66.60,
    // ownership 3.33 x 120 = 399.60, fuel 3.33 x 6 x 5 = 99.90. Sum 732.60.
    const r = calculateEstimateLine(one('x', 333));
    expect(r.duration!.productiveHours).toBe(3.33);
    expect(r.directCost.laborWage).toBe(166.5);
    expect(r.directCost.laborBurden).toBe(66.6);
    expect(r.directCost.equipmentOwnership).toBe(399.6);
    expect(r.directCost.fuel).toBe(99.9);
    expect(r.totalDirectCost).toBe(732.6);
    expect(totalDirectCost(r.directCost)).toBe(732.6);
  });

  it('prices a zero-quantity line at zero rather than dividing by it', () => {
    const r = calculateEstimateLine(one('z', 0));
    expect(r.totalDirectCost).toBe(0);
    expect(r.unitCost).toBe(0);
    expect(Number.isFinite(r.unitCost)).toBe(true);
  });
});
