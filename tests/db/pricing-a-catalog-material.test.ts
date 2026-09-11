/**
 * A price you can click.
 *
 * The materials catalog ships 333 materials and prices five of them, which is
 * the honest state of a catalog: the platform knows what a material *is* and
 * has no business claiming to know what it costs you. So the library shows a
 * screen of `$0.00`, and row level security locks every one of them, because a
 * catalog row is the same row every tenant reads.
 *
 * The lock is right and the dead end it creates is not. Clicking the price of a
 * catalog material copies it into the company's own library and puts the price
 * on the copy — the same copy-on-write the templates use — so the rule holds
 * and the estimator never has to know it was there.
 *
 * This is `set_material_cost` from migration 0121 with one branch changed. What
 * that migration insisted on still holds and is tested below: a price called
 * estimated or quoted has to be above zero and has to say where it came from,
 * and a material called free has to say why. The branch that changed is the one
 * that used to refuse a catalog row with "copy it to your library to price it",
 * which is now the sentence the function carries out rather than prints.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('pricing a catalog material', () => {
  let h: Harness;
  const chief  = '11111111-1111-4111-8111-111111111111';
  const other  = '22222222-2222-4222-8222-222222222222';
  const senior = '33333333-3333-4333-8333-333333333333';
  const clerk  = '44444444-4444-4444-8444-444444444444';
  let company = '', rival = '';

  const as = <T,>(who: string, q: string, p?: unknown[]) =>
    h.asUser(who, () => h.sql<T extends object ? T : never>(q, p));
  const sql = <T,>(q: string, p?: unknown[]) => as<T>(chief, q, p);

  /** A catalog material, by the name the export gave it. */
  const catalog = (name: string) =>
    sql<{ id: string; code: string; unit: string; unit_cost: string; cost_state: string }>(
      `select id, code, unit::text as unit, unit_cost::text as unit_cost,
              cost_state::text as cost_state
         from materials where company_id is null and name = $1`, [name])
      .then((r) => r[0]!);

  const join = (who: string, role: string) =>
    h.sql(`insert into company_memberships (company_id, user_id, role_id, status)
           select $1, $2, r.id, 'active' from roles r
           where r.company_id is null and r.key = $3 limit 1`, [company, who, role]);

  beforeAll(async () => {
    h = await createHarness({ seed: 'full' });
    for (const [id, email] of [[chief, 'c@r.test'], [other, 'o@r.test'],
                               [senior, 's@r.test'], [clerk, 'k@r.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, email]);
    }
    company = (await sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`))[0]!.id;
    rival = (await as<{ id: string }>(other,
      `select app.provision_company('Other','other','enterprise') as id`))[0]!.id;
    await join(senior, 'senior_estimator');   // libraries.write, no approve
    await join(clerk, 'estimator');           // libraries.read only
  }, 300_000);

  afterAll(async () => { await h?.db.close(); });

  // ---------------------------------------------------------------- the catalog
  describe('what ships', () => {
    it('loads the whole export rather than the part that fit', async () => {
      const [r] = await sql<{ n: string }>(
        `select count(*)::text as n from materials
          where company_id is null and source = 'GrounUp material catalog v1'`);
      expect(Number(r!.n)).toBe(333);
    });

    it('prices almost none of them, and says so rather than saying free', async () => {
      const [r] = await sql<{ uncosted: string; free: string }>(
        `select count(*) filter (where cost_state = 'not_costed')::text as uncosted,
                count(*) filter (where cost_state = 'free')::text      as free
           from materials where company_id is null
            and source = 'GrounUp material catalog v1'`);
      expect(Number(r!.uncosted)).toBe(328);
      expect(Number(r!.free)).toBe(0);
    });

    it('keeps the lumber the old importer refused, in board feet', async () => {
      const lumber = await catalog('Framing Lumber');
      expect(lumber.unit).toBe('BF');
      const shingles = await catalog('Architectural Shingles');
      expect(shingles.unit).toBe('SQ');
    });

    it('leaves aggregate filed as each rather than guessing a ton', async () => {
      const [r] = await sql<{ n: string }>(
        `select count(*)::text as n from materials m
          where m.company_id is null
            and m.source = 'GrounUp material catalog v1'
            and app.unit_looks_wrong(m.category, m.name, m.unit)`);
      expect(Number(r!.n)).toBe(37);
    });

    it('files every category it used so the picker offers them', async () => {
      const [r] = await sql<{ missing: string }>(
        `select count(*)::text as missing from (
           select distinct m.category from materials m
            where m.company_id is null and m.category is not null
              and m.source = 'GrounUp material catalog v1'
              and not exists (select 1 from library_categories c
                               where c.company_id is null
                                 and c.kind = 'material_category'
                                 and c.name = m.category)) q`);
      expect(Number(r!.missing)).toBe(0);
    });
  });

  // ------------------------------------------------------- the uncosted queue
  describe('the list of what will price at nothing', () => {
    it('does not hand a company 328 catalog rows on their first day', async () => {
      /*
       * The view was written when an uncosted material meant somebody's own
       * library had a gap. A shipped catalog of 328 unpriced materials is not a
       * gap — it is a catalog — and a queue that is full before anybody touches
       * it is a queue nobody works.
       */
      const [r] = await sql<{ n: string }>(
        `select count(*)::text as n from my_uncosted_materials where not is_own`);
      expect(Number(r!.n)).toBe(0);
    });

    it('lists a catalog material the moment somebody puts it on a line', async () => {
      /*
       * The whole point of the narrowing. Before the line it is a name in a
       * catalog; after it, it is a zero about to be multiplied by a quantity,
       * which is exactly what this view was built to catch.
       */
      const src = await catalog('Riprap Stone (erosion control)');
      const [before] = await sql<{ n: string }>(
        `select count(*)::text as n from my_uncosted_materials where id = $1`, [src.id]);
      expect(Number(before!.n)).toBe(0);

      const est = (await sql<{ id: string }>(
        `insert into estimates (company_id, number, name)
         values ($1,'EST-RIP','Bank stabilization') returning id`, [company]))[0]!.id;
      const version = (await sql<{ id: string }>(
        `insert into estimate_versions (company_id, estimate_id, version_number)
         values ($1,$2,1) returning id`, [company, est]))[0]!.id;
      const line = (await sql<{ id: string }>(
        `insert into estimate_line_items (company_id, estimate_version_id, description,
                                          measured_quantity, unit)
         values ($1,$2,'Riprap placement',400,'TON') returning id`, [company, version]))[0]!.id;
      await sql(
        `insert into estimate_line_resources (company_id, line_item_id, resource_kind,
                                              material_id, quantity, unit_rate)
         values ($1,$2,'material',$3,400,0)`, [company, line, src.id]);

      const [after] = await sql<{ n: string; used_on_lines: string; is_own: boolean }>(
        `select count(*)::text as n, max(used_on_lines)::text as used_on_lines,
                bool_and(is_own) as is_own
           from my_uncosted_materials where id = $1`, [src.id]);
      expect(Number(after!.n)).toBe(1);
      expect(Number(after!.used_on_lines)).toBe(1);
      expect(after!.is_own).toBe(false);
    });

    it('lists the company own uncosted material straight away', async () => {
      const [own] = await sql<{ id: string }>(
        `insert into materials (company_id, code, name, unit, unit_cost, status,
                                approved_by, approved_at)
         values ($1,'M-UNCOSTED','Filter fabric, unpriced','SY', 0, 'active', $2, now())
         returning id`, [company, chief]);
      const [r] = await sql<{ n: string; is_own: boolean }>(
        `select count(*)::text as n, bool_and(is_own) as is_own
           from my_uncosted_materials where id = $1`, [own!.id]);
      expect(Number(r!.n)).toBe(1);
      expect(r!.is_own).toBe(true);
    });

    it('reads the exact column list the card selects, and counts estimates apart from lines', async () => {
      /*
       * `used_on_estimates` is what makes the list orderable by damage rather
       * than alphabetically — two lines on one estimate is one estimate priced
       * wrong, and two lines on two estimates is two. The view counted both
       * from the day it was written and nothing read either, so nothing ever
       * proved the distinction held.
       */
      const src = await catalog('Geotextile Fabric (non-woven)');
      const put = async (number: string, lines: number) => {
        const est = (await sql<{ id: string }>(
          `insert into estimates (company_id, number, name)
           values ($1,$2,'Separation layer') returning id`, [company, number]))[0]!.id;
        const version = (await sql<{ id: string }>(
          `insert into estimate_versions (company_id, estimate_id, version_number)
           values ($1,$2,1) returning id`, [company, est]))[0]!.id;
        for (let i = 0; i < lines; i += 1) {
          const line = (await sql<{ id: string }>(
            `insert into estimate_line_items (company_id, estimate_version_id, description,
                                              measured_quantity, unit)
             values ($1,$2,$3,100,'SY') returning id`,
            [company, version, `Fabric run ${i + 1}`]))[0]!.id;
          await sql(
            `insert into estimate_line_resources (company_id, line_item_id, resource_kind,
                                                  material_id, quantity, unit_rate)
             values ($1,$2,'material',$3,100,0)`, [company, line, src.id]);
        }
      };
      await put('EST-GEO-1', 2);
      await put('EST-GEO-2', 1);

      const [row] = await sql<Record<string, unknown>>(
        `select id, code, name, category, unit, is_own, used_on_lines, used_on_estimates
           from my_uncosted_materials where id = $1`, [src.id]);
      expect(row).toBeDefined();
      expect(Number(row!.used_on_lines)).toBe(3);
      expect(Number(row!.used_on_estimates)).toBe(2);
      expect(row!.is_own).toBe(false);
      expect(row!.unit).toBeTruthy();
    });
  });

  // ------------------------------------------------------------------- the units
  describe('units a lumberyard uses', () => {
    it('names board feet, squares and kilowatts rather than converting them', async () => {
      const [r] = await sql<{ bf: string; sq: string; kw: string }>(
        `select app.unit_synonym('bdft')::text as bf,
                app.unit_synonym('Square')::text as sq,
                app.unit_synonym('KW')::text as kw`);
      expect(r).toEqual({ bf: 'BF', sq: 'SQ', kw: 'KW' });
    });

    it('still refuses a unit that is a multiplier in disguise', async () => {
      const [r] = await sql<{ u: string | null }>(
        `select app.unit_synonym('MBF')::text as u`);
      expect(r!.u).toBeNull();
    });
  });

  // ------------------------------------------------------------- copy on write
  describe('clicking the price on a catalog row', () => {
    it('gives the company its own material and leaves the catalog one alone', async () => {
      const src = await catalog('#57 Stone');
      const [copy] = await sql<{ id: string; company_id: string; unit_cost: string;
                                cost_state: string; unit: string; name: string }>(
        `select id, company_id, unit_cost::text as unit_cost, cost_state::text as cost_state,
                unit::text as unit, name
           from public.set_material_cost($1, 172.50, 'estimated', 'Shelly Materials, last invoice',
                                         null, $2)`, [src.id, company]);

      expect(copy!.id).not.toBe(src.id);
      expect(copy!.company_id).toBe(company);
      expect(Number(copy!.unit_cost)).toBe(172.5);
      expect(copy!.cost_state).toBe('estimated');
      expect(copy!.unit).toBe(src.unit);            // the unit came with it
      expect(copy!.name).toBe('#57 Stone');

      const after = await catalog('#57 Stone');
      expect(Number(after.unit_cost)).toBe(Number(src.unit_cost));
      expect(after.cost_state).toBe(src.cost_state);
    });

    it('says where the copy came from', async () => {
      const src = await catalog('Crusher Run');
      const [copy] = await sql<{ source: string; origin: string }>(
        `select source, origin from public.set_material_cost(
           $1, 0.94, 'estimated', 'Last three invoices', null, $2)`, [src.id, company]);
      expect(copy!.source).toBe(`Priced from catalog material ${src.code}`);
      expect(copy!.origin).toBe('company');
    });

    it('edits the one copy when the price is set again', async () => {
      const src = await catalog('Gabion Stone');
      const [first] = await sql<{ id: string }>(
        `select id from public.set_material_cost($1, 1.10, 'estimated', 'A supplier',
                                                 null, $2)`, [src.id, company]);
      const [second] = await sql<{ id: string; unit_cost: string }>(
        `select id, unit_cost::text as unit_cost
           from public.set_material_cost($1, 1.35, 'estimated', 'A supplier',
                                         null, $2)`, [src.id, company]);

      expect(second!.id).toBe(first!.id);
      expect(Number(second!.unit_cost)).toBe(1.35);
      const [r] = await sql<{ n: string }>(
        `select count(*)::text as n from materials
          where company_id = $1 and name = 'Gabion Stone'`, [company]);
      expect(Number(r!.n)).toBe(1);
    });

    it('gives two companies pricing the same material a row each', async () => {
      const src = await catalog('Pea Gravel');
      const [mine] = await sql<{ id: string }>(
        `select id from public.set_material_cost($1, 14.00, 'estimated', 'Our yard',
                                                 null, $2)`, [src.id, company]);
      const [theirs] = await as<{ id: string }>(other,
        `select id from public.set_material_cost($1, 15.75, 'estimated', 'Their yard',
                                                 null, $2)`, [src.id, rival]);
      expect(mine!.id).not.toBe(theirs!.id);

      const [r] = await sql<{ cost: string }>(
        `select unit_cost::text as cost from materials where id = $1`, [mine!.id]);
      expect(Number(r!.cost)).toBe(14);          // their price did not reach mine
    });

    it('changes the company own row in place rather than copying it again', async () => {
      const [own] = await sql<{ id: string }>(
        `insert into materials (company_id, code, name, unit, unit_cost, status,
                                approved_by, approved_at)
         values ($1,'M-OWN','Geotextile fabric','SY', 1.20, 'active', $2, now())
         returning id`, [company, chief]);
      const [after] = await sql<{ id: string; unit_cost: string }>(
        `select id, unit_cost::text as unit_cost
           from public.set_material_cost($1, 1.45, 'estimated', 'Invoice 4412',
                                         null, $2)`, [own!.id, company]);
      expect(after!.id).toBe(own!.id);
      expect(Number(after!.unit_cost)).toBe(1.45);
    });
  });

  // -------------------------------------------------------------- who may price
  describe('who may put a price on one', () => {
    it('refuses somebody who may only read the library', async () => {
      const src = await catalog('Riprap Stone');
      await expect(as(clerk,
        `select id from public.set_material_cost($1, 22.00, 'estimated', 'A supplier',
                                                 null, $2)`, [src.id, company]))
        .rejects.toThrow(/permission to change the libraries/);
    });

    it('takes the price from somebody who cannot approve, and holds it as a draft', async () => {
      const src = await catalog('Sand Bedding');
      const [copy] = await as<{ status: string; unit_cost: string; approved_by: string | null }>(
        senior, `select status::text as status, unit_cost::text as unit_cost, approved_by
                   from public.set_material_cost($1, 19.25, 'estimated', 'A supplier',
                                                 null, $2)`, [src.id, company]);
      expect(copy!.status).toBe('draft');
      expect(Number(copy!.unit_cost)).toBe(19.25);
      expect(copy!.approved_by).toBeNull();
    });

    it('will not let one company reprice another company material', async () => {
      const [theirs] = await as<{ id: string }>(other,
        `insert into materials (company_id, code, name, unit, unit_cost, status,
                                approved_by, approved_at)
         values ($1,'M-THEIRS','Their mix','CY', 100, 'active', $2, now())
         returning id`, [rival, other]);
      await expect(sql(`select id from public.set_material_cost(
        $1, 1.00, 'estimated', 'A supplier', null, $2)`,
        [theirs!.id, company])).rejects.toThrow(/another company/);
    });
  });

  // ------------------------------------------------------- the number and its story
  describe('a price and what it claims', () => {
    it('refuses free without a reason', async () => {
      const src = await catalog('Structural Fill (import)');
      await expect(sql(
        `select id from public.set_material_cost($1, 0, 'free', null, null, $2)`,
        [src.id, company])).rejects.toThrow(/why this material costs nothing/);
    });

    it('takes free with one, and keeps the reason', async () => {
      const src = await catalog('411');
      const [copy] = await sql<{ cost_state: string; free_reason: string; unit_cost: string }>(
        `select cost_state::text as cost_state, free_reason, unit_cost::text as unit_cost
           from public.set_material_cost($1, 0, 'free', 'Owner supplies from the site hydrant',
                                         null, $2)`, [src.id, company]);
      expect(copy!.cost_state).toBe('free');
      expect(copy!.free_reason).toBe('Owner supplies from the site hydrant');
      expect(Number(copy!.unit_cost)).toBe(0);
    });

    it('refuses a costed material with no cost', async () => {
      const src = await catalog('Aggregate Base 304');
      await expect(sql(
        `select id from public.set_material_cost($1, 0, 'estimated', 'A supplier', null, $2)`,
        [src.id, company])).rejects.toThrow(/has to be above zero/);
    });

    it('refuses a negative one', async () => {
      const src = await catalog('Recycled Aggregate Base');
      await expect(sql(
        `select id from public.set_material_cost($1, -5, 'estimated', 'A supplier', null, $2)`,
        [src.id, company])).rejects.toThrow(/has to be above zero/);
    });

    it('dates a quote it was given', async () => {
      const src = await catalog('Open-Graded Paver Base');
      const [copy] = await sql<{ cost_state: string; cost_quoted_on: string; cost_source: string }>(
        `select cost_state::text as cost_state, cost_quoted_on::text as cost_quoted_on, cost_source
           from public.set_material_cost($1, 88.00, 'quoted', 'Gerken GK-5520', null, $2)`,
        [src.id, company]);
      expect(copy!.cost_state).toBe('quoted');
      expect(copy!.cost_source).toBe('Gerken GK-5520');
      expect(copy!.cost_quoted_on).not.toBeNull();
    });

    it('refuses a price that does not say where it came from', async () => {
      /*
       * The rule migration 0121 set, and copy-on-write does not get to skip it:
       * a quote and a guess are different claims, and a number with neither
       * attached is the thing that migration exists to stop.
       */
      const src = await catalog('Stone Veneer');
      await expect(sql(
        `select id from public.set_material_cost($1, 8.40, 'estimated', null, null, $2)`,
        [src.id, company])).rejects.toThrow(/Say where this price came from/);
    });

    it('says so when the material does not exist', async () => {
      await expect(sql(
        `select id from public.set_material_cost($1, 5, 'estimated', 'A supplier', null, $2)`,
        ['55555555-5555-4555-8555-555555555555', company]))
        .rejects.toThrow(/No such material/);
    });
  });
});
