/**
 * One name for one thing.
 *
 * The catalog was assembled from more than one source and the category
 * vocabularies were never reconciled, so the same idea was filed under several
 * names at once: `Paint & Finishes` beside `Paint & Coating`, `Masonry` beside
 * `Tile & Masonry`, `Access` beside `Access Equipment`, `Misc` beside `Other`.
 * On the services it was not even synonyms — `category` held a verbatim copy of
 * `industry` for 860 of 2,819 rows.
 *
 * Migration 0149 files every row under one name. These tests hold that down and,
 * more usefully, hold down the *shape* of the rule so it cannot come back: no
 * category offered that nothing carries, none carried that is not offered, and
 * no two names that differ only by a decorative suffix or by case.
 *
 * The last of those is the one that matters. A catalog grows by import, and the
 * next import will bring its own words for things that already have words.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/** Words that decorate a category without distinguishing it. */
const NOISE = /\s+(equipment|tools|devices|vehicles|services)$/i;

/** `Tile & Masonry` and `Tile & masonry` are one category typed twice. */
const canonical = (name: string) =>
  name.toLowerCase().replace(NOISE, '').replace(/[^a-z0-9]+/g, ' ').trim();

describe('one name for one thing', () => {
  let h: Harness;

  beforeAll(async () => { h = await createHarness({ seed: 'full' }); }, 180_000);
  afterAll(async () => { await h?.db.close(); });

  describe('the service category stopped being a copy of the industry', () => {
    it('files every catalog service under one of the five', async () => {
      const rows = await h.sql<{ category: string; n: string }>(
        `select category, count(*)::text as n from services
          where company_id is null group by category order by count(*) desc`);
      expect(rows.map((r) => r.category).sort()).toEqual([
        'Building Shell & Structure', 'Interiors & Specialty', 'MEP & Systems',
        'Project Controls', 'Site, Civil & Transportation',
      ]);
    });

    it('leaves no service whose category merely repeats its industry', async () => {
      /*
       * The bug itself: 860 rows where the two columns held the same string, so
       * the category axis carried no information the industry axis did not.
       */
      const [row] = await h.sql<{ n: string }>(
        `select count(*)::text as n from services
          where company_id is null and category = industry`);
      expect(Number(row!.n)).toBe(0);
    });

    it('keeps the industry, which is where that detail belongs', async () => {
      // Nothing was thrown away: the finer split is still readable.
      const [row] = await h.sql<{ n: string }>(
        `select count(distinct industry)::text as n from services where company_id is null`);
      expect(Number(row!.n)).toBeGreaterThan(20);
    });

    it('keeps the subcategory beneath it', async () => {
      const [row] = await h.sql<{ n: string }>(
        `select count(distinct subcategory)::text as n from services
          where company_id is null and subcategory is not null`);
      expect(Number(row!.n)).toBeGreaterThan(90);
    });
  });

  describe('materials are filed under the vocabulary the source file uses', () => {
    it('has no category that is a synonym of another', async () => {
      const rows = await h.sql<{ category: string }>(
        `select distinct category from materials
          where company_id is null and category is not null`);
      const seen = new Map<string, string>();
      const clashes: string[] = [];
      for (const { category } of rows) {
        const key = canonical(category);
        if (seen.has(key) && seen.get(key) !== category) {
          clashes.push(`${seen.get(key)} / ${category}`);
        } else seen.set(key, category);
      }
      expect(clashes).toEqual([]);
    });

    it('has dropped the junk drawers', async () => {
      // `Misc` and `Other` beside each other, and beside a real `Specialty`.
      const rows = await h.sql<{ category: string }>(
        `select distinct category from materials where company_id is null`);
      const names = rows.map((r) => r.category);
      expect(names).not.toContain('Misc');
      expect(names).not.toContain('Other');
      expect(names).not.toContain('Allowances');
    });

    it('files a cable tray as electrical and a drain pipe as plumbing', async () => {
      /*
       * The reason the mapping is by code and not by category name: `Pipe &
       * Utilities` held both, and a blanket rename would have put the cable
       * tray under plumbing.
       */
      const [tray] = await h.sql<{ category: string }>(
        `select category from materials where code = 'MAT-0239'`);
      expect(tray!.category).toBe('Electrical');
      const [drain] = await h.sql<{ category: string }>(
        `select category from materials where code = 'MAT-0223'`);
      expect(drain!.category).toBe('Plumbing');
    });

    it('files the fiberglass batt that was under "Other" as insulation', async () => {
      const rows = await h.sql<{ category: string }>(
        `select category from materials where code in ('MAT-0221','MAT-0222')`);
      expect(rows.map((r) => r.category)).toEqual(['Insulation', 'Insulation']);
    });

    it('loses nothing — every material still has a name, a unit and its cost', async () => {
      const [row] = await h.sql<{ n: string; costed: string }>(
        `select count(*)::text as n,
                count(*) filter (where unit_cost > 0)::text as costed
           from materials where company_id is null`);
      expect(Number(row!.n)).toBe(333);
      expect(Number(row!.costed)).toBeGreaterThan(0);
    });
  });

  describe('equipment keeps its useful classes and loses the strays', () => {
    it('has no class that is a synonym of another', async () => {
      const rows = await h.sql<{ equipment_class: string }>(
        `select distinct equipment_class from equipment
          where company_id is null and equipment_class is not null`);
      const seen = new Map<string, string>();
      const clashes: string[] = [];
      for (const { equipment_class: c } of rows) {
        const key = canonical(c);
        if (seen.has(key) && seen.get(key) !== c) clashes.push(`${seen.get(key)} / ${c}`);
        else seen.set(key, c);
      }
      expect(clashes).toEqual([]);
    });

    it('keeps the classes a person actually searches by', async () => {
      /*
       * Deliberately not flattened to the source file's five groups. Somebody
       * hunting a machine is served by `Earthmoving Equipment`, not by
       * `Site / Civil / Transportation` — "no duplicates" is not "fewer
       * categories".
       */
      const rows = await h.sql<{ equipment_class: string }>(
        `select distinct equipment_class from equipment where company_id is null`);
      const names = rows.map((r) => r.equipment_class);
      expect(names).toContain('Earthmoving Equipment');
      expect(names).toContain('Hauling Vehicles');
      expect(names).toContain('Small Tools');
      expect(names.length).toBeGreaterThan(10);
    });

    it('loses no machine', async () => {
      const [row] = await h.sql<{ n: string }>(
        `select count(*)::text as n from equipment where company_id is null`);
      expect(Number(row!.n)).toBe(700);
    });
  });

  describe('the dropdown and the rows cannot disagree', () => {
    it('offers no material category that nothing carries', async () => {
      const rows = await h.sql<{ name: string }>(
        `select c.name from library_categories c
          where c.company_id is null and c.kind = 'material_category'
            and not exists (select 1 from materials m
                             where m.company_id is null and m.category = c.name)`);
      expect(rows.map((r) => r.name)).toEqual([]);
    });

    it('offers every material category that something carries', async () => {
      const rows = await h.sql<{ category: string }>(
        `select distinct m.category from materials m
          where m.company_id is null and m.category is not null
            and not exists (select 1 from library_categories c
                             where c.company_id is null and c.kind = 'material_category'
                               and c.name = m.category)`);
      expect(rows.map((r) => r.category)).toEqual([]);
    });

    it('does the same for services', async () => {
      const unused = await h.sql<{ name: string }>(
        `select c.name from library_categories c
          where c.company_id is null and c.kind = 'service_category'
            and not exists (select 1 from services s
                             where s.company_id is null and s.category = c.name)`);
      const unlisted = await h.sql<{ category: string }>(
        `select distinct s.category from services s
          where s.company_id is null and s.category is not null
            and not exists (select 1 from library_categories c
                             where c.company_id is null and c.kind = 'service_category'
                               and c.name = s.category)`);
      expect({ unused: unused.map((r) => r.name), unlisted: unlisted.map((r) => r.category) })
        .toEqual({ unused: [], unlisted: [] });
    });

    it('does the same for equipment', async () => {
      const unused = await h.sql<{ name: string }>(
        `select c.name from library_categories c
          where c.company_id is null and c.kind = 'equipment_class'
            and not exists (select 1 from equipment e
                             where e.company_id is null and e.equipment_class = c.name)`);
      const unlisted = await h.sql<{ equipment_class: string }>(
        `select distinct e.equipment_class from equipment e
          where e.company_id is null and e.equipment_class is not null
            and not exists (select 1 from library_categories c
                             where c.company_id is null and c.kind = 'equipment_class'
                               and c.name = e.equipment_class)`);
      expect({ unused: unused.map((r) => r.name),
               unlisted: unlisted.map((r) => r.equipment_class) })
        .toEqual({ unused: [], unlisted: [] });
    });
  });
});
