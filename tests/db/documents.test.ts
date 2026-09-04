/**
 * Document control, against real PostgreSQL.
 *
 * Document control is the evidence layer everything else cites — a claim rests
 * on the drawings it names, a change order on the revision that caused it — and
 * it had no tests of its own. What writing them found: the current version was
 * a stored integer nothing maintained, supersession could close a loop, and the
 * extracted text of every sheet was indexed under a comment saying it was used
 * for search, with nothing querying it.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('document control', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  const rival = '22222222-2222-4222-8222-222222222222';
  let company = '';
  let rivalCompany = '';
  let plans = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@r.test'), ($2,'r@k.test')`, [owner, rival]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@r.test'), ($2,'r@k.test') on conflict (id) do nothing`, [owner, rival]);
    company = (await h.asUser(owner, () =>
      h.sql<{ id: string }>(`select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
    rivalCompany = (await h.asUser(rival, () =>
      h.sql<{ id: string }>(`select app.provision_company('Kesler','kesler','enterprise') as id`)))[0]!.id;

    plans = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into documents (company_id, name, document_type, discipline)
       values ($1,'C-210 Utility Plan','plan_set','Civil') returning id`, [company])))[0]!.id;
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  const addVersion = (document: string, n: number, companyId = company, user = owner) =>
    h.asUser(user, () => h.sql<{ id: string }>(
      `insert into document_versions (company_id, document_id, version_number, storage_path, file_name)
       values ($1,$2,$3,$4,$5) returning id`,
      [companyId, document, n, `docs/${document}/v${n}.pdf`, `C-210-r${n}.pdf`]));

  const currentVersion = async (document: string) =>
    Number((await h.sql<{ current_version: number }>(
      `select current_version from documents where id=$1`, [document]))[0]!.current_version);

  // ------------------------------------------------------- current version
  describe('the current version is counted, not typed', () => {
    it('starts a document with no versions at 1', async () => {
      expect(await currentVersion(plans)).toBe(1);
    });

    it('advances when a version is uploaded', async () => {
      // The defect: uploading version 3 did not move this number, and every
      // screen showing "Rev 3" was reading whatever somebody typed.
      await addVersion(plans, 1);
      await addVersion(plans, 2);
      await addVersion(plans, 3);
      expect(await currentVersion(plans)).toBe(3);
    });

    it('falls back when the newest version is removed', async () => {
      const [v] = await addVersion(plans, 4);
      expect(await currentVersion(plans)).toBe(4);
      await h.asUser(owner, () => h.sql(`delete from document_versions where id=$1`, [v!.id]));
      expect(await currentVersion(plans)).toBe(3);
    });

    it('refuses a version number no version row supports', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `update documents set current_version = 7 where id=$1`, [plans])))
        .rejects.toThrow(/is at version 3, not 7.*counted from the versions that exist/);
    });

    it('refuses a number below the versions that exist', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `update documents set current_version = 1 where id=$1`, [plans])))
        .rejects.toThrow(/is at version 3, not 1/);
    });

    it('refuses anything but 1 on a document with no versions', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `insert into documents (company_id, name, document_type, current_version)
         values ($1,'Spec Section 33','specification',4)`, [company])))
        .rejects.toThrow(/has no versions, so its current version is 1/);
    });

    it('leaves the number alone when an unrelated field changes', async () => {
      await h.asUser(owner, () => h.sql(
        `update documents set discipline='Civil/Utilities' where id=$1`, [plans]));
      expect(await currentVersion(plans)).toBe(3);
    });
  });

  // ---------------------------------------------------------- supersession
  describe('supersession is a chain, not a loop', () => {
    let revised = '';

    beforeAll(async () => {
      revised = (await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into documents (company_id, name, document_type)
         values ($1,'C-210 Utility Plan Rev B','plan_set') returning id`, [company])))[0]!.id;
    });

    it('supersedes one document by another', async () => {
      await h.asUser(owner, () => h.sql(
        `update documents set is_superseded=true, superseded_by_id=$2 where id=$1`, [plans, revised]));
      const [d] = await h.sql<{ is_superseded: boolean }>(
        `select is_superseded from documents where id=$1`, [plans]);
      expect(d!.is_superseded).toBe(true);
    });

    it('still requires a superseded document to name its replacement', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `update documents set is_superseded=true, superseded_by_id=null where id=$1`, [revised])))
        .rejects.toThrow(/documents_superseded_requires_target/);
    });

    it('refuses a document that supersedes itself', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `update documents set superseded_by_id=$1 where id=$1`, [revised])))
        .rejects.toThrow(/documents_not_superseded_by_self/);
    });

    it('refuses a loop between two documents', async () => {
      // A superseded by B superseded by A. No constraint can see this one.
      await expect(h.asUser(owner, () => h.sql(
        `update documents set is_superseded=true, superseded_by_id=$2 where id=$1`, [revised, plans])))
        .rejects.toThrow(/would close a loop.*revision chain has to end somewhere/s);
    });

    it('allows a longer chain that terminates', async () => {
      const [third] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into documents (company_id, name, document_type)
         values ($1,'C-210 Utility Plan Rev C','plan_set') returning id`, [company]));
      await h.asUser(owner, () => h.sql(
        `update documents set is_superseded=true, superseded_by_id=$2 where id=$1`,
        [revised, third!.id]));
      const [d] = await h.sql<{ superseded_by_id: string }>(
        `select superseded_by_id from documents where id=$1`, [revised]);
      expect(d!.superseded_by_id).toBe(third!.id);
    });

    it('refuses a loop closed further along the chain', async () => {
      // plans -> revised -> third, so pointing third back at plans loops.
      const [third] = await h.sql<{ id: string }>(
        `select id from documents where name='C-210 Utility Plan Rev C' and company_id=$1`, [company]);
      await expect(h.asUser(owner, () => h.sql(
        `update documents set is_superseded=true, superseded_by_id=$2 where id=$1`,
        [third!.id, plans])))
        .rejects.toThrow(/would close a loop/);
    });
  });

  // ----------------------------------------------------------------- search
  describe('searching what a document says', () => {
    let searchable = '';

    beforeAll(async () => {
      searchable = (await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into documents (company_id, name, document_type, discipline)
         values ($1,'C-400 Water Main Plan','plan_set','Civil') returning id`, [company])))[0]!.id;
      const [v] = await addVersion(searchable, 1);
      await h.asUser(owner, () => h.sql(
        `insert into document_sheets
           (company_id, document_version_id, page_number, sheet_number, sheet_title, extracted_text)
         values ($1,$2,1,'C-400','Water Main Plan',
                 'Ductile iron water main with cathodic protection at all fittings. See detail 4/C-501.'),
                ($1,$2,2,'C-401','Water Main Profile',
                 'Profile stationing 10+00 to 24+00. Cover 5 feet minimum over the crown.')`,
        [company, v!.id]));
    });

    it('finds a sheet by what its body says, not only its name', async () => {
      // The whole point: "cathodic protection" appears nowhere in the file name.
      const rows = await h.asUser(owner, () => h.sql<{ sheet_number: string; snippet: string }>(
        `select sheet_number, snippet from app.search_document_text('cathodic protection')`));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.sheet_number).toBe('C-400');
      expect(rows[0]!.snippet).toContain('cathodic protection');
    });

    it('returns the page and version a match is on', async () => {
      const [row] = await h.asUser(owner, () => h.sql<{ page_number: number; version_number: number }>(
        `select page_number, version_number from app.search_document_text('stationing')`));
      expect(Number(row!.page_number)).toBe(2);
      expect(Number(row!.version_number)).toBe(1);
    });

    it('shows a window around the match rather than the whole sheet', async () => {
      const [row] = await h.asUser(owner, () => h.sql<{ snippet: string }>(
        `select snippet from app.search_document_text('cover 5 feet')`));
      expect(row!.snippet.length).toBeLessThan(200);
      expect(row!.snippet).toContain('…');
    });

    it('returns nothing for an empty query rather than everything', async () => {
      const rows = await h.asUser(owner, () => h.sql(
        `select 1 from app.search_document_text('   ')`));
      expect(rows).toEqual([]);
    });

    it('excludes a superseded document', async () => {
      // Kept for the audit trail, not offered as current information.
      const [replacement] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into documents (company_id, name, document_type)
         values ($1,'C-400 Water Main Plan Rev B','plan_set') returning id`, [company]));
      await h.asUser(owner, () => h.sql(
        `update documents set is_superseded=true, superseded_by_id=$2 where id=$1`,
        [searchable, replacement!.id]));
      const rows = await h.asUser(owner, () => h.sql(
        `select 1 from app.search_document_text('cathodic protection')`));
      expect(rows).toEqual([]);
      await h.asUser(owner, () => h.sql(
        `update documents set is_superseded=false, superseded_by_id=null where id=$1`, [searchable]));
    });

    it('shows another company nothing, because it runs as the caller', async () => {
      // "Permission-filtered search across the plan set" is what the column's
      // comment always promised. SECURITY INVOKER is what makes it true.
      const rows = await h.asUser(rival, () => h.sql(
        `select 1 from app.search_document_text('cathodic protection')`));
      expect(rows).toEqual([]);
      expect(rivalCompany).toBeTruthy();
    });

    it('caps how much it will return', async () => {
      const rows = await h.asUser(owner, () => h.sql(
        `select 1 from app.search_document_text('water', 1)`));
      expect(rows.length).toBeLessThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------- tenancy
  describe('tenancy', () => {
    it('never shows one company another company documents', async () => {
      const rows = await h.asUser(rival, () => h.sql(
        `select id from documents where company_id=$1`, [company]));
      expect(rows).toEqual([]);
    });

    it('refuses a version attached to another company document', async () => {
      await expect(addVersion(plans, 9, rivalCompany, rival)).rejects.toThrow();
    });

    it('shows an anonymous caller nothing', async () => {
      await expect(h.asAnon(() => h.sql(`select id from documents limit 1`))).rejects.toThrow();
    });
  });
});
