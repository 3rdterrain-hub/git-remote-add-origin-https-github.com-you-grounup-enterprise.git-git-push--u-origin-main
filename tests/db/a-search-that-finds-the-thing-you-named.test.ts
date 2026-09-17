/**
 * A search that finds the thing you named.
 *
 * `app.search` has been reached by the shell's search bar since migration 0019
 * and had no test of any kind, which is how it shipped gating every branch on
 * the trigram operator `%`. That operator compares whole strings, so the longer
 * a record's title, the less any single word inside it resembles it. Measured
 * against the live database before 0214:
 *
 *     "Sandusky"  1 hit      "Auburn"  0 hits      "San"  0 hits
 *
 * while `E-2026-0005 Auburn Ave site package — mass grading and storm` sat in
 * the company's own estimates. A person typing the name of their own bid got an
 * empty dropdown, which looks exactly like not having the bid.
 *
 * The tenancy test at the bottom is the one that matters most: search is the
 * one screen that reads nine tables at once, and autocomplete is the classic
 * way a platform hands one tenant another's record names.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const MINE = '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b';
const THEIRS = '2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c2c';

interface Hit { kind: string; title: string; rank: number }

describe('a search that finds the thing you named', () => {
  let h: Harness;
  let mine = '';
  let theirs = '';

  const asMe = <T>(fn: () => Promise<T>) => h.asUser(MINE, fn);
  const find = (term: string, limit = 20) =>
    asMe(() => h.sql<Hit>(`select kind, title, rank from app.search($1, $2)`, [term, limit]));
  const titles = async (term: string) => (await find(term)).map((r) => r.title);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [[MINE, 'me@search.test'], [THEIRS, 'them@search.test']]) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, email]);
    }
    mine = (await asMe(() => h.sql<{ id: string }>(
      `select app.provision_company('Find Civil','find-civil','enterprise') as id`)))[0]!.id;
    theirs = (await h.asUser(THEIRS, () => h.sql<{ id: string }>(
      `select app.provision_company('Rival Civil','rival-find','enterprise') as id`)))[0]!.id;

    /* The record the old function could not find. */
    await asMe(() => h.sql(
      `insert into estimates (company_id, number, name, created_by)
       values ($1,'E-2026-0005','Auburn Ave site package — mass grading and storm',$2)`,
      [mine, MINE]));
    await asMe(() => h.sql(
      `insert into estimates (company_id, number, name, created_by)
       values ($1,'E-2026-0009','Sandusky transfer station',$2)`, [mine, MINE]));
    await asMe(() => h.sql(
      `insert into assets (company_id, asset_number, name, make, model)
       values ($1,'EX-4412','Excavator 4412','Komatsu','PC210')`, [mine]));

    /* The other company's, which must never appear in mine. */
    await h.asUser(THEIRS, () => h.sql(
      `insert into estimates (company_id, number, name, created_by)
       values ($1,'E-2026-0777','Auburn Ave — rival bid',$2)`, [theirs, THEIRS]));
    await h.asUser(THEIRS, () => h.sql(
      `insert into assets (company_id, asset_number, name, make, model)
       values ($1,'EX-9999','Rival Excavator','Komatsu','PC210')`, [theirs]));
  }, 180_000);

  describe('finding a record by what it is called', () => {
    it('finds a word in the middle of a title', async () => {
      /* The defect, exactly: "Auburn" is the fourth token of that estimate's
         name, and whole-string similarity put it under the threshold. */
      expect(await titles('Auburn')).toContain(
        'E-2026-0005 — Auburn Ave site package — mass grading and storm');
    });

    it('finds a record from the first few letters of a word in it', async () => {
      expect(await titles('San')).toContain('E-2026-0009 — Sandusky transfer station');
    });

    it('does not care about case', async () => {
      expect(await titles('auburn')).toEqual(await titles('AUBURN'));
      expect((await titles('sandusky')).length).toBeGreaterThan(0);
    });

    it('finds an asset by its number, which is what a reference is for', async () => {
      const hits = await find('EX-4412');
      expect(hits.map((x) => x.kind)).toContain('asset');
      expect(hits.find((x) => x.kind === 'asset')!.title).toBe('EX-4412 — Excavator 4412');
    });

    it('finds an asset by its make, not only its number', async () => {
      expect((await find('Komatsu')).some((x) => x.kind === 'asset')).toBe(true);
    });

    it('answers nothing for a term that is genuinely absent', async () => {
      expect(await find('zzzznotathing')).toHaveLength(0);
    });
  });

  describe('the order they come back in', () => {
    it('puts what a title starts with above what it merely contains', async () => {
      const [first] = await find('E-2026-0005');
      expect(first!.title).toBe(
        'E-2026-0005 — Auburn Ave site package — mass grading and storm');
      expect(Number(first!.rank)).toBeCloseTo(1, 2);
    });

    it('ranks a word inside a title below one that starts it', async () => {
      const auburn = (await find('Auburn')).find((x) => x.kind === 'estimate')!;
      /* Start of a word, not of the string: 0.9 rather than 1.0. */
      expect(Number(auburn.rank)).toBeCloseTo(0.9, 2);
    });

    it('puts your own work above the shipped catalog', async () => {
      /*
       * The second defect, which 0214 exposed by fixing the first: the catalog
       * ships 2,820 services, so any ordinary construction word filled the
       * whole dropdown and a live bid never appeared. Weighting is what keeps
       * the estimate above them (0215).
       */
      const hits = await find('grading', 12);
      const firstService = hits.findIndex((x) => x.kind === 'service');
      const firstEstimate = hits.findIndex((x) => x.kind === 'estimate');
      expect(firstEstimate).toBeGreaterThanOrEqual(0);
      if (firstService >= 0) expect(firstEstimate).toBeLessThan(firstService);
    });

    it('returns the same order for the same query', async () => {
      /* A dropdown whose entries move between identical searches is unusable,
         which is what an unstable sort on equal ranks produces. */
      expect(await titles('grading')).toEqual(await titles('grading'));
    });

    it('honors the limit it is given', async () => {
      expect((await find('a', 3)).length).toBeLessThanOrEqual(3);
    });
  });

  describe('what it will never return', () => {
    it('never returns another company’s record, on a term that matches both', async () => {
      const found = await titles('Auburn');
      expect(found).toContain('E-2026-0005 — Auburn Ave site package — mass grading and storm');
      expect(found.join(' ')).not.toContain('rival bid');
      expect(found.join(' ')).not.toContain('E-2026-0777');
    });

    it('never returns another company’s asset, on an identical make', async () => {
      const found = await titles('Komatsu');
      expect(found.join(' ')).not.toContain('Rival Excavator');
      expect(found.join(' ')).not.toContain('EX-9999');
    });

    it('shows each company only its own side of the same search', async () => {
      const ours = await titles('Auburn');
      const theirsSide = (await h.asUser(THEIRS, () => h.sql<Hit>(
        `select kind, title, rank from app.search($1, 20)`, ['Auburn']))).map((r) => r.title);
      expect(theirsSide.join(' ')).toContain('rival bid');
      expect(theirsSide.join(' ')).not.toContain('E-2026-0005');
      expect(ours.some((t) => theirsSide.includes(t))).toBe(false);
    });

    it('answers nothing rather than everything for an empty term', async () => {
      expect(await find('')).toHaveLength(0);
      expect(await find('   ')).toHaveLength(0);
    });
  });
});
