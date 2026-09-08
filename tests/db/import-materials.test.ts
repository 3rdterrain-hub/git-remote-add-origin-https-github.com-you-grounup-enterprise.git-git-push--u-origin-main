/**
 * A price list you already have.
 *
 * The seed ships no materials, deliberately — a price list is a company's own
 * and a national average is worse than nothing. So materials arrive by import,
 * and the import is where the damage happens if it is careless.
 *
 * The real export this was built against had 342 rows — 333 distinct materials
 * once the repeats are taken out, five of them with a price, and thirty-seven
 * filed as `EA` that are bought by the ton or the yard. Every refusal below
 * comes from something in that file.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

interface Report {
  imported: number;
  already_there: number;
  categories_added: number;
  rejected: Array<{ name: string; reason: string }>;
  needs_review: Array<{ name: string; unit: string; why: string }>;
  approved: boolean;
}

describe('a price list you already have', () => {
  let h: Harness;
  const chief  = '11111111-1111-4111-8111-111111111111';
  const senior = '22222222-2222-4222-8222-222222222222';
  const viewer = '33333333-3333-4333-8333-333333333333';
  let company = '';

  const as = <T,>(who: string, q: string, p?: unknown[]) =>
    h.asUser(who, () => h.sql<T extends object ? T : never>(q, p));
  const sql = <T,>(q: string, p?: unknown[]) => as<T>(chief, q, p);

  const importAs = async (who: string, rows: Array<Record<string, unknown>>) => {
    const [r] = await as<{ report: Report }>(who,
      `select import_materials($1, $2::jsonb) as report`, [company, JSON.stringify(rows)]);
    return r!.report;
  };
  const load = (rows: Array<Record<string, unknown>>) => importAs(chief, rows);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of
      [[chief, 'c@r.test'], [senior, 's@r.test'], [viewer, 'v@r.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, email]);
    }
    company = (await sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`))[0]!.id;
    for (const [user, role] of [[senior, 'senior_estimator'], [viewer, 'viewer']] as const) {
      await h.sql(`insert into company_memberships (company_id, user_id, role_id, status)
                   select $1, $2, r.id, 'active' from roles r
                   where r.company_id is null and r.key = $3 limit 1`, [company, user, role]);
    }
  }, 300_000);

  afterAll(async () => { await h?.db.close(); });

  // ---------------------------------------------------------------------------
  describe('an ordinary row', () => {
    it('imports it, and says how many', async () => {
      const report = await load([
        { name: 'Portland cement Type I/II', category: 'Concrete', unit: 'BAG',
          unit_cost: '12.40', density: '', waste_pct: '2' },
      ]);
      expect(report.imported).toBe(1);
      expect(report.rejected).toEqual([]);
    });

    it('gives it a code so nobody invents one', async () => {
      const [m] = await sql<{ code: string }>(
        `select code from materials where company_id = $1 and name like 'Portland%'`, [company]);
      expect(m!.code).toBe('M-0001');
    });

    it('reads a bag as each, because that is what a bag is bought as', async () => {
      const [m] = await sql<{ unit: string }>(
        `select unit::text from materials where company_id = $1 and name like 'Portland%'`,
        [company]);
      expect(m!.unit).toBe('EA');
    });

    it('reads a waste percent written as 2 rather than 0.02', async () => {
      const [m] = await sql<{ w: string; basis: string }>(
        `select default_waste_percent::text as w, waste_basis as basis
         from materials where company_id = $1 and name like 'Portland%'`, [company]);
      expect(Number(m!.w)).toBe(0.02);
      expect(m!.basis).toContain('price list');
    });

    it('creates the category first, because materials.category is governed', async () => {
      const [c] = await sql<{ company_id: string }>(
        `select company_id from library_categories
         where kind = 'material_category' and name = 'Concrete' and company_id = $1`, [company]);
      expect(c!.company_id).toBe(company);
    });

    it('records that it was imported rather than typed', async () => {
      const [m] = await sql<{ origin: string; source: string }>(
        `select origin, source from materials where company_id = $1 and name like 'Portland%'`,
        [company]);
      expect(m!.origin).toBe('imported');
      expect(m!.source).toBe('Price list import');
    });
  });

  // ---------------------------------------------------------------------------
  describe('a row with no price', () => {
    it('imports it and calls it uncosted, not free', async () => {
      /*
       * 336 of 342 rows in the real export had no price. Migration 0121 added
       * the state for exactly this: a zero that means "nobody has costed it" is
       * a different fact from a zero that means "the owner supplies it".
       */
      await load([{ name: '#57 Crushed Stone Unpriced', category: 'Aggregate & Stone',
        unit: 'TON', unit_cost: '0', density: '', waste_pct: '0' }]);
      const [m] = await sql<{ cost_state: string }>(
        `select cost_state::text from materials
         where company_id = $1 and name = '#57 Crushed Stone Unpriced'`, [company]);
      expect(m!.cost_state).toBe('not_costed');
    });

    it('puts it on the review list rather than leaving it to be discovered', async () => {
      const report = await load([{ name: 'Rebar #4 grade 60', category: 'Concrete',
        unit: 'LF', unit_cost: '0', waste_pct: '0' }]);
      expect(report.needs_review.map((r) => r.why))
        .toContain('No cost. It will price at nothing until somebody sets one.');
    });
  });

  // ---------------------------------------------------------------------------
  describe('a unit that looks wrong for what the material is', () => {
    it('imports it as given rather than correcting it', async () => {
      /*
       * The single most damaging thing an importer could do here. Silently
       * turning EA into TON puts a per-ton price on a per-each material, and
       * every estimate using it is wrong by a factor nobody will spot.
       */
      const report = await load([{ name: '#304 Aggregate Base', category: 'Aggregate & Stone',
        unit: 'EA', unit_cost: '0', waste_pct: '0' }]);
      expect(report.imported).toBe(1);
      const [m] = await sql<{ unit: string }>(
        `select unit::text from materials where company_id = $1 and name = '#304 Aggregate Base'`,
        [company]);
      expect(m!.unit).toBe('EA');
    });

    it('names it on the review list, and says why it looks wrong', async () => {
      const report = await load([{ name: 'Screened topsoil', category: 'Landscaping',
        unit: 'EA', unit_cost: '18', waste_pct: '0' }]);
      expect(report.needs_review[0]!.why)
        .toMatch(/normally bought by the ton or the yard/);
    });

    it('says nothing about a bolt filed as each, which is right', async () => {
      const report = await load([{ name: 'Anchor bolt 5/8 x 8', category: 'Structural Steel',
        unit: 'EA', unit_cost: '2.40', waste_pct: '0' }]);
      expect(report.needs_review).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  /*
   * These four rows used to be refused, and the refusal was right at the time:
   * `app.unit_code` had no square, no board foot and no kilowatt, and an
   * importer that invents a conversion to make a row fit is worse than one that
   * refuses it. But the platform was the thing that was wrong. A roofing square
   * is how every roof in the country is sold and a board foot is how every
   * lumberyard quotes lumber, so migration 0132 added them and the file that
   * prompted all this imports whole.
   *
   * What still gets refused is a unit that is a *multiplier* rather than a
   * name. MBF is a thousand board feet; taking it as BF prices lumber at a
   * thousandth of what it costs, and taking it as 1000 BF changes a number
   * somebody typed. That one is still the spreadsheet's to settle.
   */
  describe('a unit written the way the trade writes it', () => {
    it('takes a roofing square, now that there is a unit for it', async () => {
      const report = await load([{ name: 'Architectural shingles', category: 'Roofing',
        unit: 'SQ', unit_cost: '112', waste_pct: '10' }]);
      expect(report.imported).toBe(1);
      expect(report.rejected).toEqual([]);
      const [m] = await sql<{ unit: string }>(
        `select unit::text from materials
          where company_id = $1 and name = 'Architectural shingles'`, [company]);
      expect(m!.unit).toBe('SQ');
    });

    it('takes a board foot, and does not turn it into anything else', async () => {
      const report = await load([{ name: 'Rough sawn oak', category: 'Lumber & Framing',
        unit: 'BF', unit_cost: '4.10', waste_pct: '0' }]);
      expect(report.imported).toBe(1);
      const [m] = await sql<{ unit: string; unit_cost: string }>(
        `select unit::text, unit_cost::text from materials
          where company_id = $1 and name = 'Rough sawn oak'`, [company]);
      expect(m!.unit).toBe('BF');
      expect(Number(m!.unit_cost)).toBe(4.1);   // the price is the price
    });

    it('takes a kilowatt allowance', async () => {
      const report = await load([{ name: 'Solar PV allowance', category: 'Electrical',
        unit: 'kW', unit_cost: '2400', waste_pct: '0' }]);
      expect(report.imported).toBe(1);
    });

    it('still refuses a unit that is a multiplier in disguise', async () => {
      /*
       * A thousand board feet. Reading it as BF is off by a factor of a
       * thousand; multiplying it out changes a price somebody typed. Neither is
       * an importer's decision, so it is refused by name.
       */
      const report = await load([{ name: 'Framing package', category: 'Lumber & Framing',
        unit: 'MBF', unit_cost: '640', waste_pct: '0' }]);
      expect(report.imported).toBe(0);
      expect(report.rejected[0]!.reason).toMatch(/MBF is not a unit this platform has/);
      expect(report.rejected[0]!.reason).toMatch(/would change the price/);
    });

    it('accepts Ton written in mixed case', async () => {
      const report = await load([{ name: 'Asphalt surface course 448', category: 'Asphalt & Paving',
        unit: 'Ton', unit_cost: '78', waste_pct: '0' }]);
      expect(report.imported).toBe(1);
      const [m] = await sql<{ unit: string }>(
        `select unit::text from materials where company_id = $1
         and name = 'Asphalt surface course 448'`, [company]);
      expect(m!.unit).toBe('TON');
    });

    it('accepts AC as acres', async () => {
      await load([{ name: 'Hydroseed mix', category: 'Landscaping',
        unit: 'AC', unit_cost: '640', waste_pct: '0' }]);
      const [m] = await sql<{ unit: string }>(
        `select unit::text from materials where company_id = $1 and name = 'Hydroseed mix'`,
        [company]);
      expect(m!.unit).toBe('ACRE');
    });

    it('refuses a row with no name at all', async () => {
      const report = await load([{ name: '  ', category: 'Concrete', unit: 'EA' }]);
      expect(report.rejected[0]!.reason).toMatch(/No name/);
    });
  });

  // ---------------------------------------------------------------------------
  describe('running it twice', () => {
    it('imports nothing the second time', async () => {
      const rows = [{ name: 'Geotextile fabric 6 oz', category: 'Aggregate & Stone',
        unit: 'SY', unit_cost: '0.94', waste_pct: '5' }];
      const first = await load(rows);
      const second = await load(rows);
      expect(first.imported).toBe(1);
      expect(second.imported).toBe(0);
      expect(second.already_there).toBe(1);
    });

    it('leaves exactly one of them', async () => {
      const [r] = await sql<{ c: string }>(
        `select count(*)::text as c from materials
         where company_id = $1 and name = 'Geotextile fabric 6 oz'`, [company]);
      expect(Number(r!.c)).toBe(1);
    });

    it('takes the new rows in a list that is mostly old ones', async () => {
      const report = await load([
        { name: 'Geotextile fabric 6 oz', category: 'Aggregate & Stone', unit: 'SY', unit_cost: '0.94' },
        { name: 'Geotextile fabric 8 oz', category: 'Aggregate & Stone', unit: 'SY', unit_cost: '1.22' },
      ]);
      expect(report.imported).toBe(1);
      expect(report.already_there).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  describe('who may import', () => {
    it('files a draft when the importer cannot approve the library', async () => {
      const report = await importAs(senior, [
        { name: 'Bond breaker compound', category: 'Concrete', unit: 'GAL', unit_cost: '31' },
      ]);
      expect(report.approved).toBe(false);
      const [m] = await sql<{ status: string; approved_by: string | null }>(
        `select status::text, approved_by from materials
         where company_id = $1 and name = 'Bond breaker compound'`, [company]);
      expect(m!.status).toBe('draft');
      expect(m!.approved_by).toBeNull();
    });

    it('needs libraries.write at all', async () => {
      await expect(importAs(viewer, [{ name: 'Anything', category: 'Concrete', unit: 'EA' }]))
        .rejects.toThrow(/libraries.write/);
    });

    it('lets nobody reach it anonymously', async () => {
      await h.asAnon(async () => {
        await expect(h.sql(
          `select import_materials('00000000-0000-4000-8000-000000000000','[]'::jsonb)`))
          .rejects.toThrow(/permission denied/);
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('the shape of a real export', () => {
    it('takes 342 rows and reports what each needs', async () => {
      /*
       * The proportions of the file this was built against: mostly unpriced,
       * many filed as each, a handful in units this schema does not have.
       */
      const rows = Array.from({ length: 40 }, (_, i) => ({
        name: `Bulk import row ${i}`,
        category: i % 3 === 0 ? 'Aggregate & Stone' : 'Electrical',
        // MBF rather than SQ: a square is a unit now, and this needs a unit
        // that is still genuinely unconvertible for the refusal to mean anything.
        unit: i % 7 === 0 ? 'MBF' : 'EA',
        unit_cost: i % 5 === 0 ? '10.00' : '0',
        waste_pct: '0',
      }));
      const report = await load(rows);
      expect(report.imported + report.rejected.length).toBe(40);
      expect(report.rejected.length).toBeGreaterThan(0);
      expect(report.needs_review.length).toBeGreaterThan(0);
    });
  });
});
