import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';
import { tripHaulCost } from '../../packages/engine/src/trucking.js';

/**
 * Haul priced by the trip, in the database.
 *
 * The last test here is the important one. `app.haul_cost` duplicates the trip
 * arithmetic from the estimating engine — a real cost, accepted because the
 * engine cannot be called from SQL and a company comparing three quotes on a
 * screen should not need a round trip per row. Duplication is only tolerable
 * while something proves the two agree, so something does.
 */
describe('haul pricing bases', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  let company = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@r.test')`, [owner]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@r.test') on conflict (id) do nothing`, [owner]);
    company = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','business') as id`)))[0]!.id;
  });

  afterAll(async () => { await h?.db.close(); });

  const rate = (over: Record<string, unknown> = {}) => h.asUser(owner, () =>
    h.sql<{ id: string }>(
      `insert into trucking_rates
         (company_id, code, name, truck_type, capacity, capacity_unit,
          hourly_rate, preliminary_unit_rate, rate_per_trip, pricing_basis,
          minimum_billable_quantity, charges_whole_trips,
          load_minutes, dump_minutes, delay_minutes, loaded_speed_mph, empty_speed_mph)
       values ($1,$2,$3,'tandem',$4,$5::app.unit_code,$6,$7,$8,$9,$10,coalesce($11,true),
               5,3,2,35,45)
       returning id`,
      [company, over.code ?? `TR-${Math.random().toString(36).slice(2, 8)}`,
       over.name ?? 'Tandem haul', over.capacity ?? 14, over.unit ?? 'CY',
       over.hourly ?? 95, over.perUnit ?? null, over.perTrip ?? null,
       over.basis ?? 'cycle', over.minimum ?? null, over.whole ?? null]));

  it('accepts a cycle-priced rate, which is what every rate was before', async () => {
    const [r] = await rate({ basis: 'cycle', hourly: 95 });
    expect(r!.id).toBeTruthy();
  });

  it('accepts a trip-priced rate', async () => {
    const [r] = await rate({ basis: 'per_trip', perTrip: 85 });
    expect(r!.id).toBeTruthy();
  });

  it('refuses a rate that does not carry the figure its own basis needs', async () => {
    /*
     * A trip-priced rate with no trip price is not a rate, and discovering that
     * when an estimate fails to price is discovering it too late.
     */
    await expect(rate({ basis: 'per_trip', perTrip: null }))
      .rejects.toThrow(/trucking_rates_basis_has_its_figure/);
    await expect(rate({ basis: 'per_unit', perUnit: null }))
      .rejects.toThrow(/trucking_rates_basis_has_its_figure/);
  });

  it('pays for the truck that arrives, not the dirt in it', async () => {
    // 1,200 CY at 14 CY a truck is 85.71 loads. You pay for 86.
    const id = (await rate({ basis: 'per_trip', perTrip: 85, capacity: 14 }))[0]!.id;
    const [c] = await h.asUser(owner, () => h.sql<{
      trips_paid: string; cost: string; effective_rate_per_unit: string;
    }>(`select trips_paid, cost, effective_rate_per_unit from app.haul_cost($1, 1200)`, [id]));
    expect(Number(c!.trips_paid)).toBe(86);
    expect(Number(c!.cost)).toBe(7310);
    expect(Number(c!.effective_rate_per_unit)).toBeCloseTo(6.0917, 3);
  });

  it('reports the capacity paid for and not moved', async () => {
    const id = (await rate({ basis: 'per_trip', perTrip: 85, capacity: 14 }))[0]!.id;
    const [c] = await h.asUser(owner, () => h.sql<{ unused_capacity: string }>(
      `select unused_capacity from app.haul_cost($1, 20)`, [id]));
    expect(Number(c!.unused_capacity)).toBe(8);
  });

  it('gives a cycle-priced rate no cost, because it has none without an analysis', async () => {
    /*
     * Deriving a cost from the hourly rate alone would be exactly the shortcut
     * this basis exists to avoid. Null is the honest answer.
     */
    const id = (await rate({ basis: 'cycle', hourly: 95 }))[0]!.id;
    const [c] = await h.asUser(owner, () => h.sql<{ cost: string | null }>(
      `select cost from app.haul_cost($1, 1200)`, [id]));
    expect(c!.cost).toBeNull();
  });

  it('prices a per-unit rate straight through', async () => {
    const id = (await rate({ basis: 'per_unit', perUnit: 6.25 }))[0]!.id;
    const [c] = await h.asUser(owner, () => h.sql<{ cost: string }>(
      `select cost from app.haul_cost($1, 1200)`, [id]));
    expect(Number(c!.cost)).toBe(7500);
  });

  // ---------------------------------------------------------- the guard
  it('agrees with the estimating engine, case for case', async () => {
    /*
     * The duplication guard. Two implementations of the same arithmetic is a
     * real cost, taken knowingly, and it is only tolerable while something
     * proves they have not drifted apart.
     */
    const cases = [
      { quantity: 1200, capacity: 14, perTrip: 85 },
      { quantity: 20, capacity: 14, perTrip: 85 },
      { quantity: 140, capacity: 14, perTrip: 85 },
      { quantity: 1, capacity: 25, perTrip: 264 },
      { quantity: 999.5, capacity: 12.5, perTrip: 72.5 },
    ];

    for (const c of cases) {
      const id = (await rate({
        basis: 'per_trip', perTrip: c.perTrip, capacity: c.capacity,
      }))[0]!.id;
      const [sql] = await h.asUser(owner, () => h.sql<{
        trips_paid: string; cost: string; unused_capacity: string;
      }>(`select trips_paid, cost, unused_capacity from app.haul_cost($1, $2)`,
        [id, c.quantity]));

      const engine = tripHaulCost({
        quantity: c.quantity, truckCapacity: c.capacity, ratePerTrip: c.perTrip,
      });

      expect(Number(sql!.trips_paid), `trips for ${JSON.stringify(c)}`)
        .toBe(engine.tripsPaid);
      expect(Number(sql!.cost), `cost for ${JSON.stringify(c)}`)
        .toBeCloseTo(engine.truckingCost, 2);
      expect(Number(sql!.unused_capacity), `unused for ${JSON.stringify(c)}`)
        .toBeCloseTo(engine.unusedCapacity, 3);
    }
  });
});
