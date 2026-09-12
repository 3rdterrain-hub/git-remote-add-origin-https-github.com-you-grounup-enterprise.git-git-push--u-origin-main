/**
 * A category you can manage.
 *
 * Migration 0113 made categories records and gave a person one thing to do with
 * them: add. You could put a name on the list; you could not correct it, could
 * not take it off, and could not see what was filed under it. The catalog this
 * build shipped with is what that costs — `COMPACTION` beside `Compactors`,
 * forty-two material categories where the source file had twenty-five — and the
 * only way to tidy it was to write a migration.
 *
 * 0150 adds the other three verbs. The property worth protecting is not that
 * they work, it is what they refuse: a rename that leaves the rows behind, and
 * a removal that leaves them nowhere. Both would produce exactly the mess the
 * category list exists to prevent, so both are tested from the failing side
 * first.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('a category you can manage', () => {
  let h: Harness;
  const chief = '11111111-1111-4111-8111-111111111111';
  const rival = '22222222-2222-4222-8222-222222222222';
  const clerk = '33333333-3333-4333-8333-333333333333';
  let mine = '';
  let theirs = '';
  let n = 0;

  const as = <T,>(who: string, q: string, p?: unknown[]) =>
    h.asUser(who, () => h.sql<T extends object ? T : never>(q, p));
  const asChief = <T,>(q: string, p?: unknown[]) => as<T>(chief, q, p);

  /* Draft, because an active company row needs an approver (migration 0028)
     and approval is not what any of this is about. The category guard is a
     trigger and fires either way. */
  const material = (company: string, category: string, who = chief) =>
    as<{ id: string }>(who,
      `insert into materials (company_id, code, name, category, unit, status)
       values ($1,$2,$3,$4,'EA','draft') returning id`,
      [company, `MAT-T-${++n}`, `Trial material ${n}`, category]);

  /** A category the platform ships, and a catalog row filed under it. */
  const SHIPPED = 'Shipped Aggregate';

  const categories = (company: string) =>
    asChief<{ name: string }>(
      `select name from library_categories
        where kind = 'material_category' and company_id = $1 order by name`, [company]);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, mail] of [
      [chief, 'chief@ridge.test'], [rival, 'r@kesler.test'], [clerk, 'clerk@ridge.test'],
    ] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, mail]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, mail]);
    }
    mine = (await asChief<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`))[0]!.id;
    theirs = (await as<{ id: string }>(rival,
      `select app.provision_company('Kesler','kesler','enterprise') as id`))[0]!.id;

    /*
     * One shipped category and one catalog material under it, written as the
     * service role because that is who publishes the catalog. The core seed
     * scope does not carry materials, and loading the whole catalog to get a
     * single platform row would cost this suite three minutes.
     */
    await h.asService(() => h.sql(
      `insert into library_categories (company_id, kind, name)
       values (null, 'material_category', $1)`, [SHIPPED]));
    await h.asService(() => h.sql(
      `insert into materials (company_id, code, name, category, unit, status)
       values (null, 'MAT-CATALOG-1', 'Catalog crushed stone', $1, 'EA', 'active')`, [SHIPPED]));

    /* Estimator holds `libraries.read` and not `libraries.write`, which is the
       case every one of these doors has to refuse. */
    await h.asService(() => h.sql(
      `insert into company_memberships (company_id, user_id, role_id, status)
       select $1, $2, r.id, 'active' from roles r where r.key = 'estimator'
       on conflict do nothing`, [mine, clerk]));
  }, 300_000);

  afterAll(async () => { await h?.db.close(); });

  describe('seeing what is filed under each', () => {
    it('counts the rows rather than remembering a number', async () => {
      await asChief(`select app.add_library_category('material_category','Aggregate',null,$1)`, [mine]);
      await material(mine, 'Aggregate');
      await material(mine, 'Aggregate');

      const rows = await asChief<{ name: string; in_use: string; mine: string }>(
        `select * from app.library_category_counts('material_category',$1)`, [mine]);
      const agg = rows.find((r) => r.name === 'Aggregate');
      expect(agg).toBeDefined();
      expect(Number(agg!.mine)).toBe(2);
    });

    it('separates what the catalog contributes from what a rename would move', async () => {
      /*
       * The distinction the screen needs. A shipped category with five hundred
       * catalog materials under it and none of this company's own is a category
       * a rename would move nothing in — and the button has to say so rather
       * than promise a change it cannot make.
       */
      const rows = await asChief<{ name: string; in_use: string; mine: string }>(
        `select * from app.library_category_counts('material_category',$1)`, [mine]);
      const shipped = rows.filter((r) => Number(r.in_use) > 0 && Number(r.mine) === 0);
      expect(shipped.length).toBeGreaterThan(0);
      for (const r of rows) expect(Number(r.in_use)).toBeGreaterThanOrEqual(Number(r.mine));
    });

    it('refuses a kind the platform does not keep', async () => {
      await expect(asChief(
        `select * from app.library_category_counts('favorite_color',$1)`, [mine]))
        .rejects.toThrow(/not a category list/i);
    });
  });

  describe('renaming one', () => {
    it('moves the rows with the name, in one transaction', async () => {
      await asChief(`select app.add_library_category('material_category','Agregate Base',null,$1)`, [mine]);
      const m = (await material(mine, 'Agregate Base'))[0]!.id;

      const [r] = await asChief<{ moved: string }>(
        `select app.rename_library_category('material_category','Agregate Base','Aggregate Base',$1) as moved`,
        [mine]);
      expect(Number(r!.moved)).toBe(1);

      const [row] = await asChief<{ category: string }>(
        `select category from materials where id = $1`, [m]);
      expect(row!.category).toBe('Aggregate Base');

      const names = (await categories(mine)).map((c) => c.name);
      expect(names).toContain('Aggregate Base');
      expect(names).not.toContain('Agregate Base');
    });

    it('leaves no row pointing at a name that is no longer on the list', async () => {
      /*
       * The failure mode a list-only rename produces. It does not announce
       * itself: the row keeps working until somebody edits it, and then the
       * 0113 guard refuses a category the person never touched.
       */
      const [r] = await asChief<{ stranded: string }>(
        `select count(*)::text as stranded from materials m
          where m.company_id = $1 and m.category is not null
            and not exists (select 1 from library_categories c
                             where c.kind = 'material_category'
                               and lower(trim(c.name)) = lower(trim(m.category))
                               and (c.company_id = $1 or c.company_id is null))`, [mine]);
      expect(Number(r!.stranded)).toBe(0);
    });

    it('refuses a name already taken, and says which door merges', async () => {
      await asChief(`select app.add_library_category('material_category','Fasteners',null,$1)`, [mine]);
      await asChief(`select app.add_library_category('material_category','Hardware',null,$1)`, [mine]);
      await expect(asChief(
        `select app.rename_library_category('material_category','Fasteners','Hardware',$1)`, [mine]))
        .rejects.toThrow(/already a category called Hardware/i);
    });

    it('allows a change of capitalization, which is not a collision', async () => {
      await asChief(`select app.add_library_category('material_category','geotextile',null,$1)`, [mine]);
      await material(mine, 'geotextile');
      const [r] = await asChief<{ moved: string }>(
        `select app.rename_library_category('material_category','geotextile','Geotextile',$1) as moved`,
        [mine]);
      expect(Number(r!.moved)).toBe(1);
    });

    it('refuses a category the platform ships, which every company reads', async () => {
      await expect(asChief(
        `select app.rename_library_category('material_category',$2,'Renamed By One Tenant',$1)`,
        [mine, SHIPPED])).rejects.toThrow(/no category of your own/i);
    });

    it('refuses a name that is not on this company list at all', async () => {
      await expect(asChief(
        `select app.rename_library_category('material_category','Never Existed','Something',$1)`, [mine]))
        .rejects.toThrow(/no category of your own called Never Existed/i);
    });

    it('refuses a member without permission to change the library', async () => {
      await expect(as(clerk,
        `select app.rename_library_category('material_category','Aggregate','Aggregates',$1)`, [mine]))
        .rejects.toThrow(/permission/i);
    });
  });

  describe('removing one', () => {
    it('will not remove a category without being told where its items go', async () => {
      await asChief(`select app.add_library_category('material_category','Sundries',null,$1)`, [mine]);
      await material(mine, 'Sundries');
      await expect(asChief(
        `select app.delete_library_category('material_category','Sundries',null,$1)`, [mine]))
        .rejects.toThrow(/move the items into/i);
    });

    it('re-files what was in it, then takes the name off the list', async () => {
      await asChief(`select app.add_library_category('material_category','Consumables',null,$1)`, [mine]);
      const m = (await material(mine, 'Sundries'))[0]!.id;

      const [r] = await asChief<{ moved: string }>(
        `select app.delete_library_category('material_category','Sundries','Consumables',$1) as moved`,
        [mine]);
      expect(Number(r!.moved)).toBe(2);

      const [row] = await asChief<{ category: string }>(
        `select category from materials where id = $1`, [m]);
      expect(row!.category).toBe('Consumables');
      expect((await categories(mine)).map((c) => c.name)).not.toContain('Sundries');
    });

    it('is the merge tool: two names become one and nothing is lost', async () => {
      /*
       * The shipped catalog's actual defect — `Compaction` beside `Compactors`,
       * two words for one idea, arrived from two sources. Moving everything out
       * of one and dropping the emptied name is how a person undoes it without
       * writing a migration.
       */
      await asChief(`select app.add_library_category('material_category','Compaction',null,$1)`, [mine]);
      await asChief(`select app.add_library_category('material_category','Compactors',null,$1)`, [mine]);
      await material(mine, 'Compaction');
      await material(mine, 'Compactors');

      await asChief(
        `select app.delete_library_category('material_category','Compaction','Compactors',$1)`, [mine]);

      const [r] = await asChief<{ in_use: string; mine: string }>(
        `select in_use, mine from app.library_category_counts('material_category',$1)
          where name = 'Compactors'`, [mine]);
      expect(Number(r!.mine)).toBe(2);
      expect((await categories(mine)).map((c) => c.name)).not.toContain('Compaction');
    });

    it('never had two casings of one name to merge, because 0113 refuses them', async () => {
      /*
       * Worth stating where somebody will find it. `COMPACTION` and
       * `Compaction` cannot both be on one company's list — the unique index is
       * on `lower(trim(name))` — so adding the second hands back the first.
       * The merge tool is for two different words, not two spellings.
       */
      const [a] = await asChief<{ id: string }>(
        `select app.add_library_category('material_category','Shotcrete',null,$1) as id`, [mine]);
      const [b] = await asChief<{ id: string }>(
        `select app.add_library_category('material_category','SHOTCRETE',null,$1) as id`, [mine]);
      expect(b!.id).toBe(a!.id);
    });

    it('refuses a destination that is not a category', async () => {
      await asChief(`select app.add_library_category('material_category','Shoring',null,$1)`, [mine]);
      await expect(asChief(
        `select app.delete_library_category('material_category','Shoring','Nowhere At All',$1)`, [mine]))
        .rejects.toThrow(/no category called Nowhere At All/i);
    });

    it('refuses to move a category into itself', async () => {
      await expect(asChief(
        `select app.delete_library_category('material_category','Shoring','Shoring',$1)`, [mine]))
        .rejects.toThrow(/other than the category being removed/i);
    });

    it('leaves the category alone when the move is refused', async () => {
      // A refusal that had already moved the rows would be worse than no door.
      expect((await categories(mine)).map((c) => c.name)).toContain('Shoring');
    });

    it('refuses a category the platform ships', async () => {
      await expect(asChief(
        `select app.delete_library_category('material_category',$2,'Consumables',$1)`,
        [mine, SHIPPED])).rejects.toThrow(/no category of your own/i);
    });

    it('may file its items under a shipped category, which is reading not editing', async () => {
      await asChief(`select app.add_library_category('material_category','Temporary',null,$1)`, [mine]);
      const m = (await material(mine, 'Temporary'))[0]!.id;
      await asChief(
        `select app.delete_library_category('material_category','Temporary',$2,$1)`,
        [mine, SHIPPED]);
      const [row] = await asChief<{ category: string }>(
        `select category from materials where id = $1`, [m]);
      expect(row!.category).toBe(SHIPPED);
    });

    it('refuses a member without permission to change the library', async () => {
      await expect(as(clerk,
        `select app.delete_library_category('material_category','Shoring','Consumables',$1)`, [mine]))
        .rejects.toThrow(/permission/i);
    });
  });

  describe('one company cannot tidy another', () => {
    it('refuses to rename a category that belongs to someone else', async () => {
      await as(rival, `select app.add_library_category('material_category','Kesler Only',null,$1)`, [theirs]);
      await expect(asChief(
        `select app.rename_library_category('material_category','Kesler Only','Taken',$1)`, [theirs]))
        .rejects.toThrow(/permission|no category of your own/i);
    });

    it('leaves the other company row untouched', async () => {
      const [r] = await as<{ n: string }>(rival,
        `select count(*)::text as n from library_categories
          where company_id = $1 and kind = 'material_category' and name = 'Kesler Only'`, [theirs]);
      expect(Number(r!.n)).toBe(1);
    });

    it('does not move another company materials when a name is shared', async () => {
      /*
       * Both companies file materials under `Aggregate`. Ridgeline renaming
       * theirs must not touch Kesler's, which is the isolation the whole
       * platform rests on and the one a generic UPDATE is easiest to lose.
       */
      await as(rival, `select app.add_library_category('material_category','Aggregate',null,$1)`, [theirs]);
      const m = (await material(theirs, 'Aggregate', rival))[0]!.id;
      await asChief(
        `select app.rename_library_category('material_category','Aggregate','Aggregate Stone',$1)`, [mine]);
      const [row] = await as<{ category: string }>(rival,
        `select category from materials where id = $1`, [m]);
      expect(row!.category).toBe('Aggregate');
    });
  });

  describe('a kind that governs more than one table', () => {
    /*
     * `lead_source` is carried by `leads.source` and by
     * `lead_intake_forms.source_label` — a form's label and the lead's source
     * are the same fact written twice (0124). A rename that resolved the kind
     * to one table would tidy half the list and report success, which is worse
     * than refusing, so it is checked from both sides.
     */
    it('counts both tables under one name', async () => {
      /* A source of this company's own: `Trade show` is one the platform ships,
         and a shipped category is nobody's to rename. */
      await asChief(`select app.add_library_category('lead_source','County fair',null,$1)`, [mine]);
      await asChief(
        `insert into leads (company_id, source, company_name) values ($1,'County fair','Bell Paving')`,
        [mine]);
      await asChief(
        `insert into lead_intake_forms (company_id, name, source_label)
         values ($1,'Booth tablet','County fair')`, [mine]);

      const [r] = await asChief<{ in_use: string; mine: string }>(
        `select in_use, mine from app.library_category_counts('lead_source',$1)
          where name = 'County fair'`, [mine]);
      expect(Number(r!.in_use)).toBe(2);
      expect(Number(r!.mine)).toBe(2);
    });

    it('renames across both of them', async () => {
      const [r] = await asChief<{ moved: string }>(
        `select app.rename_library_category('lead_source','County fair','County fairs',$1) as moved`,
        [mine]);
      expect(Number(r!.moved)).toBe(2);

      const [lead] = await asChief<{ source: string }>(
        `select source from leads where company_id = $1`, [mine]);
      const [form] = await asChief<{ source_label: string }>(
        `select source_label from lead_intake_forms where company_id = $1`, [mine]);
      expect(lead!.source).toBe('County fairs');
      expect(form!.source_label).toBe('County fairs');
    });

    it('re-files both of them when the name is removed', async () => {
      const [r] = await asChief<{ moved: string }>(
        `select app.delete_library_category('lead_source','County fairs','Referral',$1) as moved`,
        [mine]);
      expect(Number(r!.moved)).toBe(2);

      const [lead] = await asChief<{ source: string }>(
        `select source from leads where company_id = $1`, [mine]);
      const [form] = await asChief<{ source_label: string }>(
        `select source_label from lead_intake_forms where company_id = $1`, [mine]);
      expect(lead!.source).toBe('Referral');
      expect(form!.source_label).toBe('Referral');
    });
  });

  describe('opening one', () => {
    it('lists what is filed under it, by whatever names a row in that table', async () => {
      await asChief(`select app.add_library_category('material_category','Rebar',null,$1)`, [mine]);
      const m = (await material(mine, 'Rebar'))[0]!.id;
      const rows = await asChief<{ source_table: string; id: string; label: string; is_mine: boolean }>(
        `select * from app.library_category_members('material_category','Rebar',$1)`, [mine]);
      expect(rows.map((r) => r.id)).toContain(m);
      expect(rows[0]!.source_table).toBe('materials');
      expect(rows[0]!.label).toMatch(/Trial material/);
    });

    it('reaches across every table the kind governs', async () => {
      /*
       * `Referral` carries two leads by now and the intake form moved there,
       * and a person opening it means both — the lead is named by its company
       * and the form by its own name, which is why the label column is on the
       * same list as the category column.
       */
      const rows = await asChief<{ source_table: string; label: string }>(
        `select * from app.library_category_members('lead_source','Referral',$1)`, [mine]);
      const tables = [...new Set(rows.map((r) => r.source_table))].sort();
      expect(tables).toEqual(['lead_intake_forms', 'leads']);
      expect(rows.map((r) => r.label)).toContain('Bell Paving');
      expect(rows.map((r) => r.label)).toContain('Booth tablet');
    });

    it('shows another company nothing, because it runs as the caller', async () => {
      const rows = await as<{ id: string }>(rival,
        `select * from app.library_category_members('material_category','Rebar',$1)`, [theirs]);
      expect(rows).toHaveLength(0);
    });
  });

  describe('the doors a browser uses', () => {
    it('exposes all three under public, to authenticated only', async () => {
      const rows = await h.sql<{ proname: string; acl: string }>(
        `select p.proname,
                coalesce(array_to_string(p.proacl, ','), '') as acl
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('library_category_counts','rename_library_category',
                              'delete_library_category')
          order by p.proname`);
      expect(rows.map((r) => r.proname)).toEqual([
        'delete_library_category', 'library_category_counts', 'rename_library_category',
      ]);
      for (const r of rows) {
        expect(r.acl).toContain('authenticated=X');
        expect(r.acl).not.toMatch(/(^|,)=X/);
        expect(r.acl).not.toContain('anon=X');
      }
    });

    it('runs as the caller, so row level security still decides', async () => {
      const rows = await h.sql<{ proname: string; sec: boolean }>(
        `select p.proname, p.prosecdef as sec
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where p.proname in ('library_category_counts','library_category_members',
                              'rename_library_category','delete_library_category',
                              'category_company','assert_category_kind')`);
      for (const r of rows) expect(r.sec).toBe(false);
    });
  });
});
