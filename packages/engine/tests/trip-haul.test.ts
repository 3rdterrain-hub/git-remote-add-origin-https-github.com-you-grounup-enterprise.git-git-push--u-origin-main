import { describe, expect, it } from 'vitest';
import { tripHaulCost, preliminaryHaulCost } from '../src/trucking.js';

/**
 * Haul priced by the trip.
 *
 * The commonest way a trucker actually quotes, and the platform had no way to
 * express it: there was a cycle analysis and a per-unit shortcut, and per-trip
 * is neither.
 *
 * The distinction that matters is not arithmetic pedantry. **You pay for the
 * truck that arrives, not the dirt in it**, so a partial load costs a whole
 * trip. Pricing that as a rate per cubic yard understates it on every job, and
 * badly on a small one.
 */
describe('pricing a haul by the trip', () => {
  it('pays for the truck that arrives, not the dirt in it', () => {
    // 1,200 CY at 14 CY a truck is 85.71 loads. You pay for 86.
    const r = tripHaulCost({ quantity: 1200, truckCapacity: 14, ratePerTrip: 85 });
    expect(r.loads).toBeCloseTo(85.7143, 4);
    expect(r.tripsPaid).toBe(86);
    expect(r.truckingCost).toBe(7310);
  });

  it('differs from a per-unit rate, which is the whole point', () => {
    /*
     * The same haul priced both ways. A per-unit quote that looks equivalent is
     * not, and the gap is a whole trip — more on a small haul.
     */
    const byTrip = tripHaulCost({ quantity: 1200, truckCapacity: 14, ratePerTrip: 85 });
    const perUnit = preliminaryHaulCost(1200, 85 / 14, 'CY');
    expect(byTrip.truckingCost).toBeGreaterThan(perUnit.truckingCost);
    expect(byTrip.truckingCost - perUnit.truckingCost).toBeCloseTo(24.29, 1);
  });

  it('costs a small haul disproportionately, and says so', () => {
    // 20 CY in a 14 CY truck is two trips: the second is 6 CY of dirt at full
    // price. On a job this size that is most of a trip wasted.
    const r = tripHaulCost({ quantity: 20, truckCapacity: 14, ratePerTrip: 85 });
    expect(r.tripsPaid).toBe(2);
    expect(r.truckingCost).toBe(170);
    expect(r.unusedCapacity).toBe(8);
    expect(r.warnings.join(' ')).toMatch(/last truck runs 8 short/);
    expect(r.effectiveRatePerUnit).toBe(8.5);
  });

  it('reports the effective unit rate so quotes can be compared', () => {
    /*
     * An estimator holding a per-trip quote and a per-ton quote needs one number
     * to compare them on, and it is not the headline rate.
     */
    const r = tripHaulCost({ quantity: 1200, truckCapacity: 14, ratePerTrip: 85 });
    expect(r.effectiveRatePerUnit).toBeCloseTo(6.0917, 3);
  });

  it('handles a quantity that fills trucks exactly', () => {
    const r = tripHaulCost({ quantity: 140, truckCapacity: 14, ratePerTrip: 85 });
    expect(r.tripsPaid).toBe(10);
    expect(r.unusedCapacity).toBe(0);
    expect(r.warnings.join(' ')).not.toMatch(/short/);
  });

  it('honors a minimum billable quantity written into the quote', () => {
    /*
     * "$12 a ton, 22-ton minimum" is the same idea from the other side: the
     * trucker is paid for capacity whether or not it is filled.
     */
    const r = tripHaulCost({
      quantity: 50, truckCapacity: 25, ratePerTrip: 264,
      minimumBillableQuantity: 22,
    });
    expect(r.tripsPaid).toBe(2);
    // Billed on 44 tons of minimum against 50 moved, so nothing is unused here.
    expect(r.unusedCapacity).toBe(0);
  });

  it('prorates the last load only when the quote actually says so', () => {
    // Rare, and worth stating explicitly rather than assuming.
    const r = tripHaulCost({
      quantity: 1200, truckCapacity: 14, ratePerTrip: 85, chargeWholeTrips: false,
    });
    expect(r.tripsPaid).toBeCloseTo(85.7143, 4);
    // 85.7143 rounded trips x 85: the rounding of the trip count is visible in
    // the cent, which is exactly why whole trips is the default.
    expect(r.truckingCost).toBeCloseTo(7285.72, 2);
  });

  it('says plainly that it is a price and not a haul analysis', () => {
    /*
     * A trip rate is defensible as a cost and tells you nothing about duration
     * or how many trucks the loader needs. Silence there would let a schedule
     * be built on a number that contains no schedule.
     */
    const r = tripHaulCost({ quantity: 100, truckCapacity: 14, ratePerTrip: 85 });
    expect(r.warnings.join(' ')).toMatch(/says nothing about/);
    expect(r.warnings.join(' ')).toMatch(/RULE-004/);
  });

  it('shows its working', () => {
    const r = tripHaulCost({ quantity: 1200, truckCapacity: 14, ratePerTrip: 85 });
    expect(r.derivation.join(' | ')).toMatch(/85\.7143 loads/);
    expect(r.derivation.join(' | ')).toMatch(/rounded up to 86 trips/);
  });

  it('refuses a truck that holds nothing', () => {
    expect(() => tripHaulCost({ quantity: 100, truckCapacity: 0, ratePerTrip: 85 }))
      .toThrow(/positive truck capacity/);
  });

  it('refuses a negative rate', () => {
    expect(() => tripHaulCost({ quantity: 100, truckCapacity: 14, ratePerTrip: -1 }))
      .toThrow();
  });

  it('costs nothing to move nothing', () => {
    const r = tripHaulCost({ quantity: 0, truckCapacity: 14, ratePerTrip: 85 });
    expect(r.tripsPaid).toBe(0);
    expect(r.truckingCost).toBe(0);
  });
});
