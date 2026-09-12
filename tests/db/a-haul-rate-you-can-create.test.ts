/**
 * A haul rate you can create.
 *
 * `trucking_rates` has existed since migration 0004 and has never held a row —
 * not in the catalog, because `company_id` is `not null` and the platform
 * therefore cannot ship one even in principle, and not in any company's
 * library, because nothing on any screen could write one. Six things read it.
 * Zero wrote it.
 *
 * These tests are about the code generator that made the screen possible, and
 * about the rules a haul rate has to satisfy — 0067 gave the table three
 * pricing bases and a constraint that each one carries its own figure, and a
 * form that did not know that would be refused by a CHECK after the fact.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('a haul rate you can create', () => {
  let h: Harness;
  const chief = '11111111-1111-4111-8111-111111111111';
  const rival = '22222222-2222-4222-8222-222222222222';
  let mine = '';
  let theirs = '';

  const asChief = <T,>(q: string, p?: unknown[]) =>
    h.asUser(chief, () => h.sql<T extends object ? T : never>(q, p));

  const add = (company: string, fields: Record<string, unknown>, who = chief) => {
    const cols = Object.keys(fields);
    const ph = cols.map((_, i) => `$${i + 2}`).join(', ');
    return h.asUser(who, () => h.sql<{ id: string }>(
      `insert into trucking_rates (company_id, ${cols.join(', ')})
       values ($1, ${ph}) returning id`,
      [company, ...cols.map((c) => fields[c])]));
  };

  /** A cycle-priced rate, which is the shape with every figure filled in. */
  const cycle = (code: string, over: Record<string, unknown> = {}) => ({
    code, name: 'Quad-axle dump', truck_type: 'quad',
    capacity: 16, capacity_unit: 'CY', hourly_rate: 95,
    load_minutes: 6, dump_minutes: 2, delay_minutes: 3,
    loaded_speed_mph: 30, empty_speed_mph: 35, ...over,
  });

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, mail] of [[chief, 'c@r.test'], [rival, 'r@k.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, mail]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, mail]);
    }
    mine = (await asChief<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`))[0]!.id;
    theirs = (await h.asUser(rival, () => h.sql<{ id: string }>(
      `select app.provision_company('Kesler','kesler','enterprise') as id`)))[0]!.id;
  }, 240_000);

  afterAll(async () => { await h?.db.close(); });

  describe('the code', () => {
    it('starts at one for a company with no haul rates', async () => {
      const [r] = await asChief<{ code: string }>(
        `select app.next_company_haul_code($1) as code`, [mine]);
      expect(r!.code).toBe('HAUL-0001');
    });

    it('counts on from what the company already has', async () => {
      await add(mine, cycle('HAUL-0001'));
      const [r] = await asChief<{ code: string }>(
        `select app.next_company_haul_code($1) as code`, [mine]);
      expect(r!.code).toBe('HAUL-0002');
    });

    it('counts only this company, so two tenants do not share a sequence', async () => {
      const [r] = await h.asUser(rival, () => h.sql<{ code: string }>(
        `select app.next_company_haul_code($1) as code`, [theirs]));
      expect(r!.code).toBe('HAUL-0001');
    });

    it('ignores a code that is not of this shape', async () => {
      // A rate imported under the trucker's own numbering must not break the count.
      await add(mine, cycle('VASQUEZ-QUAD-1'));
      const [r] = await asChief<{ code: string }>(
        `select app.next_company_haul_code($1) as code`, [mine]);
      expect(r!.code).toBe('HAUL-0002');
    });
  });

  describe('what a rate has to carry', () => {
    it('takes a cycle rate with its hourly figure', async () => {
      const [r] = await add(mine, cycle('HAUL-0002'));
      expect(r!.id).toBeTruthy();
    });

    it('refuses a trip-priced rate with no price a trip', async () => {
      /*
       * 0067: "a trip-priced rate with no trip price is not a rate, and finding
       * that out when an estimate fails to price is finding out too late."
       */
      await expect(add(mine, cycle('HAUL-0003', {
        pricing_basis: 'per_trip', rate_per_trip: null, hourly_rate: 0,
      }))).rejects.toThrow(/basis_has_its_figure/i);
    });

    it('takes a trip-priced rate that carries one', async () => {
      const [r] = await add(mine, cycle('HAUL-0004', {
        pricing_basis: 'per_trip', rate_per_trip: 240, hourly_rate: 0,
      }));
      expect(r!.id).toBeTruthy();
    });

    it('refuses a unit-priced rate with no rate per unit', async () => {
      await expect(add(mine, cycle('HAUL-0005', {
        pricing_basis: 'per_unit', preliminary_unit_rate: null, hourly_rate: 0,
      }))).rejects.toThrow(/basis_has_its_figure/i);
    });

    it('refuses a trip-priced rate on a truck that holds nothing', async () => {
      await expect(add(mine, cycle('HAUL-0006', {
        pricing_basis: 'per_trip', rate_per_trip: 240, hourly_rate: 0, capacity: 0,
      }))).rejects.toThrow(/trip_needs_capacity|capacity/i);
    });

    it('refuses two rates under one code in one company', async () => {
      await expect(add(mine, cycle('HAUL-0001'))).rejects.toThrow(/unique|duplicate/i);
    });

    it('lets another company use the same code', async () => {
      const [r] = await add(theirs, cycle('HAUL-0001'), rival);
      expect(r!.id).toBeTruthy();
    });
  });

  describe('whose rate it is', () => {
    it('shows a company only its own', async () => {
      const rows = await h.asUser(rival, () => h.sql<{ id: string }>(
        `select id from trucking_rates`));
      const ours = await asChief<{ id: string }>(`select id from trucking_rates`);
      expect(rows.length).toBe(1);
      expect(ours.length).toBeGreaterThan(1);
    });

    it('refuses a member without permission to change the library', async () => {
      const clerk = '33333333-3333-4333-8333-333333333333';
      await h.sql(`insert into auth.users (id, email) values ($1,'k@r.test')`, [clerk]);
      await h.sql(`insert into user_profiles (id, email) values ($1,'k@r.test')
                   on conflict (id) do nothing`, [clerk]);
      await h.asService(() => h.sql(
        `insert into company_memberships (company_id, user_id, role_id, status)
         select $1, $2, r.id, 'active' from roles r where r.key = 'estimator'
         on conflict do nothing`, [mine, clerk]));
      await expect(add(mine, cycle('HAUL-0009'), clerk))
        .rejects.toThrow(/policy|permission|violates/i);
    });
  });

  describe('the door a browser uses', () => {
    it('is granted to authenticated and to nobody else', async () => {
      const rows = await h.sql<{ proname: string; acl: string }>(
        `select p.proname, coalesce(array_to_string(p.proacl, ','), '') as acl
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'next_company_haul_code'`);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.acl).toContain('authenticated=X');
      expect(rows[0]!.acl).not.toContain('anon=X');
    });
  });
});
