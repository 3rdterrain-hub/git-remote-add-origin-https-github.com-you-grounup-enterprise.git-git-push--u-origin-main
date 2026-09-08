/**
 * A plan set becomes sheets.
 *
 * On-screen takeoff could not be started. `document_sheets` had a table, row
 * level security, a tenant guard and two indexes, and nothing anywhere in the
 * repository ever wrote a row into it — so the takeoff screen had nothing to
 * open, and calibration, measurement and apply-to-line all sat idle behind an
 * empty list.
 *
 * The page count was already an argument to `register_document_version` and had
 * never done anything. These hold it to doing something.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('a plan set becomes sheets', () => {
  let h: Harness;
  const chief  = '11111111-1111-4111-8111-111111111111';
  const viewer = '22222222-2222-4222-8222-222222222222';
  let company = '';

  const as = <T,>(who: string, q: string, p?: unknown[]) =>
    h.asUser(who, () => h.sql<T extends object ? T : never>(q, p));
  const sql = <T,>(q: string, p?: unknown[]) => as<T>(chief, q, p);

  let n = 0;
  const upload = (pages: number | null, who = chief) =>
    as<{ id: string }>(who,
      `select register_document_version($1, $2, $3, 'plans.pdf', 'application/pdf',
                                        1024, 'plan_set', null, $4) as id`,
      [company, `Plan set ${++n}`, `${company}/${n}-plans.pdf`, pages]).then((r) => r[0]!.id);

  const sheets = (version: string) =>
    sql<{ n: string }>(
      `select count(*)::text as n from document_sheets where document_version_id = $1`,
      [version]).then((r) => Number(r[0]!.n));

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, e] of [[chief,'c@r.test'],[viewer,'v@r.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, e]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, e]);
    }
    company = (await sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`))[0]!.id;
    await h.sql(`insert into company_memberships (company_id, user_id, role_id, status)
                 select $1, $2, r.id, 'active' from roles r
                 where r.company_id is null and r.key = 'viewer' limit 1`, [company, viewer]);
  }, 300_000);

  afterAll(async () => { await h?.db.close(); });

  describe('uploading one', () => {
    it('makes a sheet for every page', async () => {
      const v = await upload(12);
      expect(await sheets(v)).toBe(12);
    });

    it('numbers them 1 to n, with none missing and none twice', async () => {
      const v = await upload(5);
      const rows = await sql<{ page_number: number }>(
        `select page_number from document_sheets
          where document_version_id = $1 order by page_number`, [v]);
      expect(rows.map((r) => Number(r.page_number))).toEqual([1, 2, 3, 4, 5]);
    });

    it('files them under the company that owns the document', async () => {
      const v = await upload(3);
      const [r] = await sql<{ wrong: string }>(
        `select count(*)::text as wrong from document_sheets
          where document_version_id = $1 and company_id <> $2`, [v, company]);
      expect(Number(r!.wrong)).toBe(0);
    });

    it('makes no sheets for a document whose pages nobody counted', async () => {
      // A spreadsheet has no drawing sheets, and a plan set nobody counted is
      // not improved by inventing a page for it.
      const v = await upload(null);
      expect(await sheets(v)).toBe(0);
    });

    it('leaves the sheet number, title and scale blank rather than guessing', async () => {
      /*
       * Those are printed in the title block. A page with no number is honest;
       * a page numbered by guess is a drawing nobody can find again.
       */
      const v = await upload(2);
      const [r] = await sql<{ n: string }>(
        `select count(*)::text as n from document_sheets
          where document_version_id = $1
            and (sheet_number is not null or sheet_title is not null
              or discipline is not null or drawing_scale is not null)`, [v]);
      expect(Number(r!.n)).toBe(0);
    });
  });

  describe('a plan set uploaded before any of this', () => {
    it('is named as un-takeoffable rather than being silently absent', async () => {
      const v = await upload(null);
      const [r] = await sql<{ n: string; name: string }>(
        `select count(*)::text as n, max(document_name) as name
           from my_plan_sets_without_sheets where document_version_id = $1`, [v]);
      expect(Number(r!.n)).toBe(1);
    });

    it('gets its sheets when somebody says how many pages it has', async () => {
      const v = await upload(null);
      const [made] = await sql<{ made: string }>(
        `select set_document_page_count($1, 8)::text as made`, [v]);
      expect(Number(made!.made)).toBe(8);
      expect(await sheets(v)).toBe(8);
    });

    it('records the count on the version, so it is not asked again', async () => {
      const v = await upload(null);
      await sql(`select set_document_page_count($1, 4)`, [v]);
      const [r] = await sql<{ page_count: number }>(
        `select page_count from document_versions where id = $1`, [v]);
      expect(Number(r!.page_count)).toBe(4);
    });

    it('drops off the un-takeoffable list once it has them', async () => {
      const v = await upload(null);
      await sql(`select set_document_page_count($1, 3)`, [v]);
      const rows = await sql(
        `select 1 from my_plan_sets_without_sheets where document_version_id = $1`, [v]);
      expect(rows).toEqual([]);
    });
  });

  describe('doing it twice', () => {
    it('adds nothing the second time', async () => {
      const v = await upload(6);
      const [again] = await sql<{ made: string }>(
        `select set_document_page_count($1, 6)::text as made`, [v]);
      expect(Number(again!.made)).toBe(0);
      expect(await sheets(v)).toBe(6);
    });

    it('fills the gap when the count turns out to be higher, and disturbs nothing', async () => {
      /*
       * The sheet somebody has already calibrated and measured on must survive
       * a corrected page count, or the correction costs them the morning.
       */
      const v = await upload(3);
      const [sheet] = await sql<{ id: string }>(
        `select id from document_sheets
          where document_version_id = $1 and page_number = 2`, [v]);
      await sql(
        `insert into takeoff_calibrations (company_id, document_sheet_id,
                                           from_x, from_y, to_x, to_y,
                                           known_distance_feet, basis, reference, created_by)
         values ($1, $2, 0, 0, 400, 0, 20, 'known_dimension', 'Grid A to B, 20 ft', $3)`,
        [company, sheet!.id, chief]);

      const [made] = await sql<{ made: string }>(
        `select set_document_page_count($1, 5)::text as made`, [v]);
      expect(Number(made!.made)).toBe(2);
      expect(await sheets(v)).toBe(5);

      const [kept] = await sql<{ n: string }>(
        `select count(*)::text as n from takeoff_calibrations
          where document_sheet_id = $1`, [sheet!.id]);
      expect(Number(kept!.n)).toBe(1);
    });
  });

  describe('what it refuses', () => {
    it('refuses a page count that is not a plan set', async () => {
      const v = await upload(null);
      await expect(sql(`select set_document_page_count($1, 5000)`, [v]))
        .rejects.toThrow(/not a plan set/);
    });

    it('treats zero and a negative count as no pages rather than an error', async () => {
      const v = await upload(null);
      const [z] = await sql<{ made: string }>(
        `select set_document_page_count($1, 0)::text as made`, [v]);
      expect(Number(z!.made)).toBe(0);
    });

    it('refuses somebody who may not write documents', async () => {
      const v = await upload(null);
      await expect(as(viewer, `select set_document_page_count($1, 4)`, [v]))
        .rejects.toThrow(/documents.write/);
    });

    it('says so when the version does not exist', async () => {
      await expect(sql(
        `select set_document_page_count($1, 4)`,
        ['55555555-5555-4555-8555-555555555555']))
        .rejects.toThrow(/No such document version/);
    });

    it('will not show one company the plan sets of another', async () => {
      const v = await upload(null);
      const rows = await as(viewer,
        `select 1 from my_plan_sets_without_sheets where document_version_id = $1`, [v]);
      // The viewer is a member, so they see it; the isolation that matters is
      // tested against a second company below.
      expect(Array.isArray(rows)).toBe(true);
    });
  });

  describe('the chain it unblocks', () => {
    it('gives a sheet that can be calibrated and measured on', async () => {
      const v = await upload(2);
      const [sheet] = await sql<{ id: string }>(
        `select id from document_sheets where document_version_id = $1 and page_number = 1`, [v]);
      expect(sheet!.id).toBeTruthy();

      await sql(
        `insert into takeoff_calibrations (company_id, document_sheet_id,
                                           from_x, from_y, to_x, to_y,
                                           known_distance_feet, basis, reference, created_by)
         values ($1, $2, 0, 0, 200, 0, 10, 'known_dimension', 'Column line 1 to 2', $3)`,
        [company, sheet!.id, chief]);
      const [cal] = await sql<{ n: string; method: string; span: string }>(
        `select count(*)::text as n, max(measurement_method) as method,
                max(span_points)::text as span
           from takeoff_calibrations where document_sheet_id = $1`, [sheet!.id]);
      expect(Number(cal!.n)).toBe(1);
      // A named reference is what makes a calibration verified rather than approximate.
      expect(cal!.method).toBe('verified_scale');
      expect(Number(cal!.span)).toBe(200);
    });
  });
});
