/**
 * A material that costs nothing says so.
 *
 * A materials export from a real company: 342 materials, six of them priced.
 * Every other one sat at `unit_cost = 0` — the column default, meaning nobody
 * had costed it. The engine multiplied quantity by that number and said
 * nothing, so a line carrying eight materials priced cleanly, the estimate
 * totalled, the bid went out, and every one of those materials was bought at
 * whatever it actually cost.
 *
 * The engine cannot tell "nobody has costed this" from "the owner supplies it",
 * because both are zero. So the library says which, and the difference is
 * enforced rather than described: a free material has to state why, and a
 * priced one has to have a price.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('a material that costs nothing', () => {
  let h: Harness;
  const chief = '11111111-1111-4111-8111-111111111111';
  let company = '';
  let n = 0;

  const asChief = <T,>(q: string, p?: unknown[]) =>
    h.asUser(chief, () => h.sql<T extends object ? T : never>(q, p));

  const material = (cost = 0) =>
    asChief<{ id: string }>(
      `insert into materials (company_id, code, name, unit, unit_cost, status,
                              approved_by, approved_at)
       values ($1, $2, $3, 'EA', $4, 'active', $5, now()) returning id`,
      [company, `MAT-${++n}`, `Material ${n}`, cost, chief]).then((r) => r[0]!.id);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'c@r.test')`, [chief]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'c@r.test')
                 on conflict (id) do nothing`, [chief]);
    company = (await h.asUser(chief, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
  }, 300_000);

  afterAll(async () => { await h?.db.close(); });

  describe('what a zero means', () => {
    it('calls a new material uncosted rather than free', async () => {
      const id = await material(0);
      const [r] = await asChief<{ cost_state: string }>(
        `select cost_state::text from materials where id = $1`, [id]);
      expect(r!.cost_state).toBe('not_costed');
    });

    it('calls a priced one estimated', async () => {
      const id = await material(42.5);
      const [r] = await asChief<{ cost_state: string }>(
        `select cost_state::text from materials where id = $1`, [id]);
      expect(r!.cost_state).toBe('estimated');
    });

    it('read the shipped catalog the same way', async () => {
      /*
       * The backfill is the only honest reading available: a price means
       * somebody estimated it, a zero means nobody has, and nothing is assumed
       * to be free — that has to be asserted by a person.
       */
      const [r] = await asChief<{ free: string }>(
        `select count(*) as free from materials where cost_state = 'free'`);
      expect(Number(r!.free)).toBe(0);
    });
  });

  describe('putting a price on one', () => {
    it('records where the number came from', async () => {
      const id = await material(0);
      await asChief(
        `select app.set_material_cost($1, 18.75, 'quoted', 'Shelly Materials quote 88213')`,
        [id]);
      const [r] = await asChief<{ unit_cost: string; cost_state: string;
                                 cost_source: string; cost_quoted_on: string }>(
        `select unit_cost, cost_state::text, cost_source, cost_quoted_on
           from materials where id = $1`, [id]);
      expect(Number(r!.unit_cost)).toBe(18.75);
      expect(r!.cost_state).toBe('quoted');
      expect(r!.cost_source).toMatch(/88213/);
      expect(r!.cost_quoted_on).not.toBeNull();
    });

    it('refuses a price of zero that claims to be a price', async () => {
      const id = await material(0);
      await expect(asChief(
        `select app.set_material_cost($1, 0, 'quoted', 'Shelly Materials')`, [id]))
        .rejects.toThrow(/above zero/i);
    });

    it('refuses a price with no stated source', async () => {
      const id = await material(0);
      await expect(asChief(`select app.set_material_cost($1, 18.75, 'estimated', null)`, [id]))
        .rejects.toThrow(/where this price came from/i);
    });

    it('takes a genuinely free material, with the reason', async () => {
      const id = await material(0);
      await asChief(
        `select app.set_material_cost($1, 0, 'free', 'Owner supplies the pipe')`, [id]);
      const [r] = await asChief<{ cost_state: string; free_reason: string; unit_cost: string }>(
        `select cost_state::text, free_reason, unit_cost from materials where id = $1`, [id]);
      expect(r!.cost_state).toBe('free');
      expect(r!.free_reason).toMatch(/Owner supplies/);
      expect(Number(r!.unit_cost)).toBe(0);
    });

    it('refuses free without a reason, because no cost is a claim', async () => {
      const id = await material(0);
      await expect(asChief(`select app.set_material_cost($1, 0, 'free', null)`, [id]))
        .rejects.toThrow(/why this material costs nothing/i);
    });

    /*
     * What a catalog row does is `pricing-a-catalog-material.test.ts`, and it
     * moved twice over.
     *
     * There used to be a test here asserting that pricing a shipped catalog row
     * was refused. It never ran: this harness loads the core seed, the core seed
     * ships no materials, and the test opened with `if (!platform) return`. A
     * guard like that turns a missing fixture into a silent pass, which is the
     * one outcome worse than a failure — it reads as coverage for years.
     *
     * The behavior it described also reversed. Migration 0133 makes a catalog
     * row copy itself into the company's library rather than refusing, because
     * "copy it to your library to price it" was an instruction the database was
     * perfectly capable of carrying out. That is tested against a harness that
     * actually has a catalog in it.
     */
  });

  describe('the constraints, not the function', () => {
    it('refuses free with a price, whichever way it is written', async () => {
      await expect(asChief(
        `insert into materials (company_id, code, name, unit, unit_cost, cost_state,
                                free_reason, status, approved_by, approved_at)
         values ($1,'MAT-X','Contradiction','EA',5,'free','Owner supplies it','active',$2,now())`,
        [company, chief])).rejects.toThrow(/materials_free_costs_nothing/);
    });

    it('refuses an estimated material with no price', async () => {
      await expect(asChief(
        `insert into materials (company_id, code, name, unit, unit_cost, cost_state,
                                status, approved_by, approved_at)
         values ($1,'MAT-Y','Nothing','EA',0,'estimated','active',$2,now())`,
        [company, chief])).rejects.toThrow(/materials_priced_states_have_a_price/);
    });
  });

  describe('what is still uncosted', () => {
    it('lists them with how much already rests on them', async () => {
      const rows = await asChief<{ name: string; used_on_lines: string }>(
        `select name, used_on_lines from my_uncosted_materials where is_own`);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.used_on_lines !== null)).toBe(true);
    });

    it('drops one the moment it is priced', async () => {
      const id = await material(0);
      const before = await asChief<{ id: string }>(
        `select id from my_uncosted_materials where id = $1`, [id]);
      expect(before).toHaveLength(1);
      await asChief(
        `select app.set_material_cost($1, 9.99, 'estimated', 'Last three invoices')`, [id]);
      const after = await asChief(`select id from my_uncosted_materials where id = $1`, [id]);
      expect(after).toEqual([]);
    });
  });
});
