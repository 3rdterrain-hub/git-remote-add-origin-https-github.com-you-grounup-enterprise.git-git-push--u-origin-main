/**
 * What a line sells for, and the field names that were being dropped.
 *
 * Two silences, one shape. `update_estimate_line` read `markup_override` while
 * the markup cell sent `markupOverride`, so the value never landed and the call
 * reported success. And the engine read the column not at all, so even a value
 * that landed changed nothing about the bid.
 *
 * The columns here hold what the engine now returns, and the guard makes the
 * next misspelled key fail at the write instead of at the bid.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('what a line sells for', () => {
  let h: Harness;
  const chief = '11111111-1111-4111-8111-111111111111';
  let company = '', line = '';

  const sql = <T,>(q: string, p?: unknown[]) =>
    h.asUser(chief, () => h.sql<T extends object ? T : never>(q, p));

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id,email) values ($1,'c@r.test')`, [chief]);
    await h.sql(`insert into user_profiles (id,email) values ($1,'c@r.test')
                 on conflict (id) do nothing`, [chief]);
    company = (await sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`))[0]!.id;
    line = await h.asUser(chief, async () => {
      const e = (await h.sql<{ id: string }>(
        `insert into estimates (company_id,number,name) values ($1,'E-1','Kingsway')
         returning id`, [company]))[0]!.id;
      const v = (await h.sql<{ id: string }>(
        `insert into estimate_versions (company_id,estimate_id,version_number)
         values ($1,$2,1) returning id`, [company, e]))[0]!.id;
      return (await h.sql<{ id: string }>(
        `insert into estimate_line_items (company_id,estimate_version_id,description,
                                          measured_quantity,unit)
         values ($1,$2,'Mass excavation',1000,'CY') returning id`, [company, v]))[0]!.id;
    });
  }, 300_000);

  afterAll(async () => { await h?.db.close(); });

  describe('the columns the engine fills', () => {
    it('starts every line at zero rather than at a made-up price', async () => {
      const [r] = await sql<{ rate: string; amount: string; price: string; unit: string }>(
        `select markup_rate::text as rate, markup_amount::text as amount,
                total_price::text as price, unit_price::text as unit
           from estimate_line_items where id = $1`, [line]);
      expect(Number(r!.rate)).toBe(0);
      expect(Number(r!.price)).toBe(0);
    });

    it('refuses a price written by hand, like every other engine output', async () => {
      /*
       * Migration 0058's rule, extended to the four new columns. A price
       * somebody typed is a price nobody can reproduce, and an estimate whose
       * numbers cannot be reproduced is not an estimate.
       */
      await expect(sql(
        `update estimate_line_items set total_price = 9999 where id = $1`, [line]))
        .rejects.toThrow(/may not be written by hand/);
    });

    it('refuses a hand-written markup amount too', async () => {
      await expect(sql(
        `update estimate_line_items set markup_amount = 500 where id = $1`, [line]))
        .rejects.toThrow(/may not be written by hand/);
    });

    it('still takes the markup rate the estimator sets, which is an input', async () => {
      // `markup_override` is the estimator's; `markup_rate` is what the engine
      // priced at. Only the second is guarded.
      await sql(`select update_estimate_line($1, '{"markup_override": 0.3}'::jsonb)`, [line]);
      const [r] = await sql<{ m: string }>(
        `select markup_override::text as m from estimate_line_items where id = $1`, [line]);
      expect(Number(r!.m)).toBe(0.3);
    });
  });

  describe('a field name nobody recognizes', () => {
    it('is refused on a line, by name', async () => {
      await expect(sql(`select update_estimate_line($1, '{"markupOverride": 0.2}'::jsonb)`, [line]))
        .rejects.toThrow(/markupOverride/);
    });

    it('is refused on the build-up too, by name', async () => {
      await expect(sql(
        `select save_line_resource($1, 'labor', '{"headCount": 2}'::jsonb, null)`, [line]))
        .rejects.toThrow(/headCount/);
    });

    it('lists what the build-up does take, so the fix is one word', async () => {
      await expect(sql(
        `select save_line_resource($1, 'labor', '{"nope": 1}'::jsonb, null)`, [line]))
        .rejects.toThrow(/base_rate/);
    });

    it('still takes every field the wrench panel actually sends', async () => {
      /*
       * Checked field by field rather than assumed: crew, equipment, materials,
       * hauling and subs, as the screens send them.
       */
      const sends: Record<string, Record<string, unknown>> = {
        labor: { role: 'Operator', description: 'Excavator operator', headcount: 2,
                 base_rate: 40, burden_rate: 15, hours: 8 },
        equipment: { description: 'Dozer D6', quantity: 1, unit_rate: 150,
                     rate_basis: 'hour', is_owned: true, mobilization_cost: 600,
                     standby_days: 0, minimum_hours: 4 },
        material: { description: 'Aggregate base', quantity: 100, unit: 'TON', unit_rate: 22 },
        subcontract: { description: 'Striping', quantity: 1, unit_rate: 4500 },
        trucking: { description: 'Haul spoil', quantity: 400, unit_rate: 95, hours: 10,
                    haul_mode: 'trip', round_trip_miles: 12, average_speed_mph: 35,
                    truck_capacity: 16, load_minutes: 6, dump_minutes: 4,
                    queue_minutes: 3, includes_disposal: false },
      };
      for (const [kind, fields] of Object.entries(sends)) {
        await expect(
          sql(`select save_line_resource($1, $2, $3::jsonb, null)`,
            [line, kind, JSON.stringify(fields)]),
          `${kind} was refused`,
        ).resolves.toBeDefined();
      }
    });
  });
});
