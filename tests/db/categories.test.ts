/**
 * A category you can add to.
 *
 * Nine columns across the master libraries grouped things by free text, and
 * free text is how a library fragments: "Site Work", "Sitework" and "Site work"
 * are three categories to a database and one to a person, so every report that
 * groups by category quietly splits.
 *
 * The two properties that matter here are opposites of each other, and a design
 * that got either alone would be worse than what it replaced. A category not in
 * the list has to be refused — otherwise the picker is a suggestion and typing
 * still fragments the library. And a company has to be able to add one — a
 * fixed list would leave a contractor whose word for the work is not in the
 * shipped catalog unable to file it at all.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('a category you can add to', () => {
  let h: Harness;
  const chief = '11111111-1111-4111-8111-111111111111';
  const rival = '22222222-2222-4222-8222-222222222222';
  let company = '';
  let rivalCompany = '';
  let n = 0;

  const asChief = <T,>(q: string, p?: unknown[]) =>
    h.asUser(chief, () => h.sql<T extends object ? T : never>(q, p));

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, mail] of [[chief, 'chief@ridge.test'], [rival, 'r@kesler.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, mail]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, mail]);
    }
    company = (await h.asUser(chief, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
    rivalCompany = (await h.asUser(rival, () => h.sql<{ id: string }>(
      `select app.provision_company('Kesler','kesler','enterprise') as id`)))[0]!.id;
  }, 300_000);

  afterAll(async () => { await h?.db.close(); });

  /* Draft, because an active service needs an approver and that is not what
     is under test here. The category guard is a trigger and fires either way. */
  const service = (fields: Record<string, unknown>) =>
    asChief<{ id: string }>(
      `insert into services (company_id, code, name, default_unit, supported_units,
                             status, category, subcategory, industry)
       values ($1,$2,$3,'CY',array['CY']::app.unit_code[],'draft',$4,$5,$6) returning id`,
      [company, `SVC-T-${++n}`, 'Trial service',
       fields.category ?? null, fields.subcategory ?? null, fields.industry ?? null]);

  describe('the shipped catalog', () => {
    it('files exactly the categories the catalog actually uses', async () => {
      /*
       * Equality rather than a threshold. A count would drift every time a
       * trade pack is added; what has to hold is that the list and the catalog
       * describe the same set — one category record per distinct category in
       * the shipped services, no more and no fewer.
       */
      const [r] = await asChief<{ filed: string; used: string }>(
        `select (select count(*) from library_categories
                  where company_id is null and kind = 'service_category') as filed,
                (select count(distinct trim(category)) from services
                  where company_id is null and category is not null) as used`);
      expect(Number(r!.filed)).toBe(Number(r!.used));
      expect(Number(r!.used)).toBeGreaterThan(20);
    });

    it('covers every list the platform keeps, not only services', async () => {
      const rows = await asChief<{ kind: string }>(
        `select distinct kind from library_categories where company_id is null order by kind`);
      const kinds = rows.map((r) => r.kind);
      for (const expected of ['industry', 'service_category', 'task_category',
                              'labor_group', 'crew_discipline', 'equipment_class']) {
        expect(kinds).toContain(expected);
      }
    });

    it('leaves nothing in the catalog carrying a category nobody filed', async () => {
      /*
       * The property the guard exists for, checked against the shipped data
       * rather than a fixture: every value in every categorized column of every
       * catalog row resolves to a category record. Driven from
       * `app.categorized_columns()`, so a tenth column is covered on the day it
       * is added rather than when somebody remembers this file.
       */
      const columns = await asChief<{ kind: string; table_name: string; column_name: string }>(
        `select kind, table_name, column_name from app.categorized_columns()`);
      expect(columns.length).toBeGreaterThan(5);

      const orphans: string[] = [];
      for (const c of columns) {
        const rows = await asChief<{ value: string }>(
          `select distinct trim(x.${c.column_name}) as value
             from ${c.table_name} x
            where x.${c.column_name} is not null
              and length(trim(x.${c.column_name})) > 0
              and not exists (
                select 1 from library_categories lc
                 where lc.kind = $1
                   and lower(trim(lc.name)) = lower(trim(x.${c.column_name}))
                   and (lc.company_id is null or lc.company_id is not distinct from x.company_id))`,
          [c.kind]);
        orphans.push(...rows.map((r) => `${c.table_name}.${c.column_name} = ${r.value}`));
      }
      expect(orphans).toEqual([]);
    });
  });

  describe('refusing one that is not in the list', () => {
    it('refuses a service category nobody filed', async () => {
      await expect(service({ category: 'Invented On The Spot' }))
        .rejects.toThrow(/not one of your service category options/i);
    });

    it('names the value it refused, so it can be fixed rather than guessed at', async () => {
      await expect(service({ category: 'Sitework Deluxe' }))
        .rejects.toThrow(/Sitework Deluxe/);
    });

    it('accepts one the platform ships', async () => {
      const [existing] = await asChief<{ name: string }>(
        `select name from library_categories
          where company_id is null and kind = 'service_category' limit 1`);
      await expect(service({ category: existing!.name })).resolves.toBeDefined();
    });

    it('accepts it whatever the case or spacing, since it is the same category', async () => {
      const [existing] = await asChief<{ name: string }>(
        `select name from library_categories
          where company_id is null and kind = 'service_category' limit 1`);
      await expect(service({ category: `  ${existing!.name.toUpperCase()}  ` }))
        .resolves.toBeDefined();
    });

    it('allows no category at all, because ungrouped is a real answer', async () => {
      await expect(service({})).resolves.toBeDefined();
    });

    it('guards every categorized column, not only the one it was written for', async () => {
      await expect(service({ subcategory: 'Not A Subcategory' }))
        .rejects.toThrow(/not one of your service subcategory options/i);
      await expect(service({ industry: 'Not An Industry' }))
        .rejects.toThrow(/not one of your industry options/i);
      await expect(asChief(
        `insert into tasks (company_id, code, name, default_unit, status, category)
         values ($1,'TSK-T-1','Trial','CY','draft','Not A Task Category')`, [company]))
        .rejects.toThrow(/not one of your task category options/i);
    });
  });

  describe('adding your own', () => {
    it('files it against the company and lets a row use it', async () => {
      await asChief(`select app.add_library_category('service_category','Marine works',null,$1)`,
        [company]);
      await expect(service({ category: 'Marine works' })).resolves.toBeDefined();
    });

    it('hands back the one that exists rather than refusing a repeat', async () => {
      const a = (await asChief<{ id: string }>(
        `select app.add_library_category('service_category','Marine works',null,$1) as id`,
        [company]))[0]!.id;
      const b = (await asChief<{ id: string }>(
        `select app.add_library_category('service_category','  marine WORKS ',null,$1) as id`,
        [company]))[0]!.id;
      expect(b).toBe(a);
    });

    it("hands back the platform one when the name is already the catalog's", async () => {
      const [existing] = await asChief<{ id: string; name: string }>(
        `select id, name from library_categories
          where company_id is null and kind = 'service_category' limit 1`);
      const got = (await asChief<{ id: string }>(
        `select app.add_library_category('service_category',$1,null,$2) as id`,
        [existing!.name, company]))[0]!.id;
      expect(got).toBe(existing!.id);
    });

    it('refuses a list the platform does not keep', async () => {
      await expect(asChief(
        `select app.add_library_category('color_of_the_truck','Red',null,$1)`, [company]))
        .rejects.toThrow(/not a category list/i);
    });

    it('refuses a category with no name', async () => {
      await expect(asChief(
        `select app.add_library_category('service_category','   ',null,$1)`, [company]))
        .rejects.toThrow(/needs a name/i);
    });
  });

  describe('whose category is whose', () => {
    it("does not let one company use another company's category", async () => {
      await h.asUser(rival, () => h.sql(
        `select app.add_library_category('service_category','Kesler special',null,$1)`,
        [rivalCompany]));
      await expect(service({ category: 'Kesler special' }))
        .rejects.toThrow(/not one of your service category options/i);
    });

    it("does not show one company another company's categories", async () => {
      const rows = await asChief<{ name: string }>(
        `select name from my_library_categories where name = 'Kesler special'`);
      expect(rows).toEqual([]);
    });

    it('shows the platform list to everybody', async () => {
      const [a] = await asChief<{ n: string }>(
        `select count(*) as n from my_library_categories where kind = 'industry'`);
      const [b] = await h.asUser(rival, () => h.sql<{ n: string }>(
        `select count(*) as n from my_library_categories where kind = 'industry'`));
      expect(Number(a!.n)).toBe(Number(b!.n));
      expect(Number(a!.n)).toBeGreaterThan(5);
    });
  });

  describe('putting one away', () => {
    it('stops offering it, and stops a new row taking it', async () => {
      const id = (await asChief<{ id: string }>(
        `select app.add_library_category('service_category','Temporary works',null,$1) as id`,
        [company]))[0]!.id;
      await asChief(`select app.retire_library_category($1)`, [id]);
      const rows = await asChief(
        `select id from my_library_categories where id = $1`, [id]);
      expect(rows).toEqual([]);
      await expect(service({ category: 'Temporary works' }))
        .rejects.toThrow(/not one of your service category options/i);
    });

    it("refuses to retire one of the platform's, which is everyone's vocabulary", async () => {
      const [platform] = await asChief<{ id: string }>(
        `select id from library_categories
          where company_id is null and kind = 'service_category' limit 1`);
      await expect(asChief(`select app.retire_library_category($1)`, [platform!.id]))
        .rejects.toThrow(/belong to the platform/i);
    });
  });

  describe('the one list everything reads', () => {
    it('names a real table and column for every kind', async () => {
      const [r] = await asChief<{ bad: string[] }>(
        `select coalesce(array_agg(format('%s.%s', c.table_name, c.column_name)) filter (
                  where not exists (
                    select 1 from information_schema.columns ic
                     where ic.table_schema = 'public'
                       and ic.table_name = c.table_name
                       and ic.column_name = c.column_name)), '{}') as bad
           from app.categorized_columns() c`);
      expect(r!.bad).toEqual([]);
    });

    it('has a guard attached for every column it names', async () => {
      const [r] = await asChief<{ unguarded: string[] }>(
        `select coalesce(array_agg(format('%s.%s', c.table_name, c.column_name)) filter (
                  where not exists (
                    select 1 from pg_trigger t
                     where t.tgrelid = format('public.%I', c.table_name)::regclass
                       and not t.tgisinternal
                       and pg_get_triggerdef(t.oid) like '%enforce_library_category%'
                       and pg_get_triggerdef(t.oid) like '%' || c.column_name || '%')), '{}') as unguarded
           from app.categorized_columns() c`);
      expect(r!.unguarded).toEqual([]);
    });
  });
});
