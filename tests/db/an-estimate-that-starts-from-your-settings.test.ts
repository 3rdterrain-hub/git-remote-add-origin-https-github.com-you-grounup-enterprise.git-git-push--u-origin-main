/**
 * An estimate that starts from your settings.
 *
 * `companies` has carried six estimating defaults since 0002 and Company
 * Settings has offered them since that screen was made live. `create_estimate`
 * read one of them — the pricing profile — and let the other five fall to their
 * own table defaults.
 *
 * Two of those disagree with a company's, and both in the direction that
 * flatters a bid: fuel defaults to 0 against 4.25, and calendar efficiency to 1
 * against 0.85. So every estimate this platform ever made priced fuel at
 * nothing and assumed no day was ever lost to weather, breakdown or access.
 *
 * It went unnoticed because four of the six happened to agree, and the two that
 * did not were the two nobody reads back off the version.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('an estimate that starts from your settings', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  let company = '';

  const as = (q: string, p?: unknown[]) =>
    h.asUser(owner, () => h.sql<Record<string, unknown>>(q, p));

  const versionOf = async (estimate: string) =>
    (await as(`select v.* from estimate_versions v where v.estimate_id = $1`, [estimate]))[0]!;

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@r.test')`, [owner]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@r.test')
                 on conflict (id) do nothing`, [owner]);
    company = String((await as(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`))[0]!.id);
  }, 240_000);

  afterAll(async () => { await h?.db.close(); });

  it('prices fuel at the company figure, not at nothing', async () => {
    await h.asService(() => h.sql(
      `update companies set default_fuel_price = 4.85 where id = $1`, [company]));
    const id = String((await as(`select app.create_estimate('Fuel test') as id`))[0]!.id);
    const v = await versionOf(id);
    expect(Number(v.fuel_price_per_gallon)).toBeCloseTo(4.85, 4);
  });

  it('starts at the company calendar efficiency, not at a perfect year', async () => {
    await h.asService(() => h.sql(
      `update companies set default_calendar_efficiency = 0.78 where id = $1`, [company]));
    const id = String((await as(`select app.create_estimate('Calendar test') as id`))[0]!.id);
    const v = await versionOf(id);
    expect(Number(v.calendar_efficiency)).toBeCloseTo(0.78, 4);
    // 1.0 is "no day is ever lost", which is the figure this replaces.
    expect(Number(v.calendar_efficiency)).toBeLessThan(1);
  });

  it('carries the shift, the swell, the shrink and the rounding across too', async () => {
    await h.asService(() => h.sql(
      `update companies
          set default_shift_hours = 10,
              default_swell_percent = 0.31,
              default_shrink_percent = 0.14,
              bid_rounding_increment = 500
        where id = $1`, [company]));
    const id = String((await as(`select app.create_estimate('Everything test') as id`))[0]!.id);
    const v = await versionOf(id);
    expect(Number(v.shift_hours)).toBeCloseTo(10, 2);
    expect(Number(v.swell_percent)).toBeCloseTo(0.31, 4);
    expect(Number(v.shrink_percent)).toBeCloseTo(0.14, 4);
    expect(Number(v.bid_rounding_increment)).toBeCloseTo(500, 2);
  });

  it('reads them at the moment of creation, so a later change does not reach back', async () => {
    await h.asService(() => h.sql(
      `update companies set default_fuel_price = 3.00 where id = $1`, [company]));
    const id = String((await as(`select app.create_estimate('Frozen test') as id`))[0]!.id);
    await h.asService(() => h.sql(
      `update companies set default_fuel_price = 9.99 where id = $1`, [company]));
    const v = await versionOf(id);
    /* An estimate is priced under the settings it was made with. Changing a
       company default must not silently reprice an open bid. */
    expect(Number(v.fuel_price_per_gallon)).toBeCloseTo(3.00, 4);
  });

  /*
   * The repair in 0164 touches only drafts the engine has never seen, and that
   * rule is not directly testable from here — `calculated_at` is an engine
   * output, 0058 refuses one written by hand, and the engine announces itself
   * with a transaction-local setting that does not survive between statements
   * in this harness.
   *
   * Which is the guarantee, stated the other way round: a test cannot forge a
   * priced version, so nothing else can either. What is covered above is the
   * half that matters for an open bid — a company changing its fuel price does
   * not reach back into an estimate somebody has already started.
   */
});
