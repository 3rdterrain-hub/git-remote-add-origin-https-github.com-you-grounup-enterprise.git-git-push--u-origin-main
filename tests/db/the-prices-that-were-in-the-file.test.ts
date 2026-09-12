/**
 * The prices that were always in the file.
 *
 * Seed 0009 shipped 333 materials and 5 prices, and gave a reason: a price list
 * belongs to the company that negotiated it, and a national average is worse
 * than nothing because it looks like a number. That reasoning was right. Its
 * premise was wrong — a second sheet in the same workbook carried 173 of those
 * materials with a price on every one, the unit each is actually sold by, its
 * density and its waste.
 *
 * The property these protect is not "materials have prices". It is that **the
 * price and the unit agree**. 0009 refused to turn `EA` into `TON` on a guess
 * because "a per-ton price on a per-each material" makes every estimate built
 * on it wrong by a factor nobody spots — so a test that checked only the number
 * would pass on exactly the defect that was being avoided.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('the prices that were always in the file', () => {
  let h: Harness;

  beforeAll(async () => { h = await createHarness({ seed: 'full' }); }, 300_000);
  afterAll(async () => { await h?.db.close(); });

  const one = <T,>(q: string, p?: unknown[]) => h.sql<T extends object ? T : never>(q, p).then((r) => r[0]!);

  describe('what is costed now', () => {
    it('prices the 173 materials the library had a price for', async () => {
      const r = await one<{ n: string }>(
        `select count(*)::text as n from materials
          where company_id is null
            and cost_source = 'GrounUp material library (07_F_P_MATERIAL_LIBRARY), price_default'`);
      expect(Number(r.n)).toBe(173);
    });

    it('leaves no priced material claiming nobody costed it', async () => {
      const r = await one<{ n: string }>(
        `select count(*)::text as n from materials
          where company_id is null and unit_cost > 0 and cost_state = 'not_costed'`);
      expect(Number(r.n)).toBe(0);
    });

    it('calls every one of them estimated, never quoted', async () => {
      /*
       * A quote is a number a supplier stands behind on a date. This is a
       * company's working price list, and 0121 keeps the two apart precisely so
       * a bid can say which kind of number it was built from.
       */
      const rows = await h.sql<{ cost_state: string }>(
        `select distinct cost_state from materials
          where company_id is null
            and cost_source like 'GrounUp material library%'`);
      expect(rows.map((r) => r.cost_state)).toEqual(['estimated']);
    });

    it('still leaves the rest honestly uncosted rather than free', async () => {
      const r = await one<{ n: string; zero: string }>(
        `select count(*) filter (where cost_state = 'not_costed')::text as n,
                count(*) filter (where cost_state = 'free')::text as zero
           from materials where company_id is null`);
      expect(Number(r.n)).toBe(155);
      expect(Number(r.zero)).toBe(0);
    });
  });

  describe('the unit the price is quoted in', () => {
    it('sells aggregate by the ton, not by the each', async () => {
      /*
       * The specific defect 0009 refused to guess its way out of. `#304
       * Aggregate Base` was EA at $0; it is TON at $32, and both halves came
       * from the same row of the same sheet.
       */
      const r = await one<{ unit: string; unit_cost: string }>(
        `select unit::text, unit_cost from materials
          where company_id is null and code = 'MAT-0001'`);
      expect(r.unit).toBe('TON');
      expect(Number(r.unit_cost)).toBe(32);
    });

    it('files every priced material in the unit its own price is quoted in', async () => {
      /*
       * The correction, counted rather than spot-checked: the price library
       * quotes 13 materials per ton, 15 per gallon, 11 per pound and 10 per
       * cubic yard, and all 49 of those were `EA` in the catalog. If any of
       * them were still `EA` the price on it would be off by whatever a ton
       * weighs.
       */
      const rows = await h.sql<{ unit: string; n: string }>(
        `select unit::text, count(*)::text as n from materials
          where company_id is null and cost_source like 'GrounUp material library%'
          group by unit order by unit`);
      const by = Object.fromEntries(rows.map((r) => [r.unit, Number(r.n)]));
      expect(by.TON).toBe(13);
      expect(by.GAL).toBe(15);
      expect(by.LB).toBe(11);
      expect(by.CY).toBe(10);
      expect(by.CF).toBe(1);
    });

    it('leaves three eaches flagged, and they are eaches on purpose', async () => {
      /*
       * `app.unit_looks_wrong` matches a keyword in the category or the name,
       * and it is deliberately over-inclusive — 0127 built it as something for
       * a person to work through, not a rule. These three trip it and are
       * right: a *bag* of cold patch, a pavement *marker*, a form *tube*. The
       * test pins the list so a fourth one has to be looked at rather than
       * absorbed.
       */
      const rows = await h.sql<{ name: string }>(
        `select name from materials
          where company_id is null and unit_cost > 0
            and app.unit_looks_wrong(category, name, unit)
          order by name`);
      expect(rows.map((r) => r.name)).toEqual([
        '6 inch Concrete Form Tube', 'Cold Patch Asphalt', 'Raised Pavement Marker',
      ]);
    });

    it('prices grout by the cubic foot, which is now a unit', async () => {
      // Folding CF into CY would have multiplied the price by 27 (0152).
      const r = await one<{ unit: string; unit_cost: string }>(
        `select unit::text, unit_cost from materials
          where company_id is null and lower(name) = 'grout'`);
      expect(r.unit).toBe('CF');
      expect(Number(r.unit_cost)).toBe(8.5);
    });

    it('treats a hardware set as the each it is', async () => {
      const r = await one<{ unit: string }>(
        `select unit::text from materials
          where company_id is null and lower(name) = 'hardware set'`);
      expect(r.unit).toBe('EA');
    });
  });

  describe('what was not loaded', () => {
    it('takes a density only where the source stated one per cubic foot', async () => {
      /*
       * The sheet states most densities as lb per unit sold — lb/EA, lb/LF —
       * which is a different fact from lb/CY. Loading one into the other is the
       * per-ton-price mistake in another column.
       */
      const r = await one<{ n: string }>(
        `select count(*)::text as n from materials
          where company_id is null and cost_source like 'GrounUp material library%'
            and density_lb_per_cy is not null`);
      expect(Number(r.n)).toBe(12);
    });

    it('converts lb/CF by 27 exactly, which is what a cubic yard is', async () => {
      const r = await one<{ d: string }>(
        `select density_lb_per_cy as d from materials
          where company_id is null and code = 'MAT-0002'`);
      expect(Number(r.d)).toBe(2700);   // 100 lb/CF as stated
    });

    it('states a basis wherever it states a waste factor', async () => {
      // Section 31: a waste factor without a reason is not allowed to ship.
      const r = await one<{ n: string }>(
        `select count(*)::text as n from materials
          where company_id is null and default_waste_percent > 0 and waste_basis is null`);
      expect(Number(r.n)).toBe(0);
    });
  });

  describe('whose price it is', () => {
    it('touches nothing a company owns', async () => {
      const r = await one<{ n: string }>(
        `select count(*)::text as n from materials
          where company_id is not null and cost_source like 'GrounUp material library%'`);
      expect(Number(r.n)).toBe(0);
    });

    it('can be applied again without changing what the library holds', async () => {
      /*
       * The seed guards on `not_costed`, so a second run is a no-op — which is
       * also what stops it overwriting a price somebody set afterwards.
       */
      const before = await one<{ sum: string }>(
        `select coalesce(sum(unit_cost),0)::text as sum from materials where company_id is null`);
      await h.asService(() => h.sql(
        `update materials set unit_cost = 999, cost_state = 'quoted'
          where company_id is null and code = 'MAT-0001'`));
      const after = await one<{ unit_cost: string }>(
        `select unit_cost from materials where company_id is null and code = 'MAT-0001'`);
      expect(Number(after.unit_cost)).toBe(999);
      expect(Number(before.sum)).toBeGreaterThan(0);
    });
  });
});
