/**
 * The drawings nobody could search.
 *
 * `document_sheets.extracted_text` has carried a GIN trigram index since
 * migration 0005 and a snippet-building search function since 0036, and was
 * given a public wrapper and a screen in 0147. The column has never held a
 * value — nothing in the repository writes it — so the "Search the drawings"
 * tab could only ever return nothing, on every company, for every term. Four
 * layers, all tested, all green, and nothing tested the joint.
 *
 * `document_extractions` (0019) is the other half: RLS, a tenant-parent
 * trigger, a supersede trigger and two indexes, and not one row since it was
 * created.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '8b8b8b8b-8b8b-4b8b-8b8b-8b8b8b8b8b8b';

describe('reading what a plan set says', () => {
  let h: Harness;
  let company = '';
  let document = '';
  let version = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@srch.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@srch.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Search Civil','search-civil','enterprise') as id`)))[0]!.id;

    document = (await h.asService(() => h.sql<{ id: string }>(
      `insert into documents (company_id, name, document_type)
       values ($1,'kingsway-civil.pdf','plan_set') returning id`, [company])))[0]!.id;
    version = (await h.asService(() => h.sql<{ id: string }>(
      `insert into document_versions (company_id, document_id, version_number, storage_path,
         file_name, page_count)
       values ($1,$2,1,'x/kingsway.pdf','kingsway-civil.pdf',3) returning id`,
      [company, document])))[0]!.id;
    await h.asUser(OWNER, () => h.sql(
      `select public.set_document_page_count($1, 3)`, [version]));
  });

  it('finds nothing before anything has been read', async () => {
    const rows = await h.asUser(OWNER, () => h.sql(
      `select * from public.search_document_text('silt fence', 25)`));
    expect(rows).toHaveLength(0);
  });

  it('records a whole set in one call, and then finds it', async () => {
    const [{ n }] = await h.asUser(OWNER, () => h.sql<{ n: number }>(
      `select public.record_plan_set_text($1, $2::jsonb) as n`, [document, JSON.stringify([
        { page: 1, text: 'SITE PLAN — install silt fence along the north property line' },
        { page: 2, text: 'GRADING PLAN — finish grade 1,184.50' },
        /* A scan in the middle of a CAD set — no text layer, and that is a fact. */
        { page: 3, text: '' },
      ])]));
    expect(Number(n)).toBe(3);

    const hits = await h.asUser(OWNER, () => h.sql<{ page_number: number; snippet: string }>(
      `select page_number, snippet from public.search_document_text('silt fence', 25)`));
    expect(hits).toHaveLength(1);
    expect(hits[0]!.page_number).toBe(1);
    expect(hits[0]!.snippet).toMatch(/silt fence/i);
  });

  it('keeps the run as well as the text, so a better reading can be compared', async () => {
    const [row] = await h.asUser(OWNER, () => h.sql<{
      model: string; is_current: boolean; extracted_text: string;
    }>(`select e.model, e.is_current, e.extracted_text
          from document_extractions e
          join document_sheets s on s.id = e.document_sheet_id
         where s.document_version_id = $1 and s.page_number = 1`, [version]));
    expect(row!.model).toBe('pdf_text_layer');
    expect(row!.is_current).toBe(true);
    expect(row!.extracted_text).toMatch(/silt fence/i);
  });

  it('supersedes the earlier reading rather than destroying it', async () => {
    /*
     * The whole reason `document_extractions` is a separate table, in its own
     * words: a re-extraction with a better model is written and compared
     * without losing what the previous run found.
     */
    const [sheet] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from document_sheets where document_version_id = $1 and page_number = 1`,
      [version]));
    await h.asUser(OWNER, () => h.sql(
      `select app.record_sheet_extraction($1,
         'SITE PLAN — install silt fence along the north property line, 340 LF',
         'claude-opus-5', 'site_plan', 0.94)`, [sheet!.id]));

    const rows = await h.asUser(OWNER, () => h.sql<{ model: string; is_current: boolean }>(
      `select model, is_current from document_extractions
        where document_sheet_id = $1 order by created_at`, [sheet!.id]));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.is_current).toBe(false);
    expect(rows[1]!.is_current).toBe(true);
    expect(rows[1]!.model).toBe('claude-opus-5');

    /* And the current text is the one the search reads. */
    const [s] = await h.asUser(OWNER, () => h.sql<{ extracted_text: string }>(
      `select extracted_text from document_sheets where id = $1`, [sheet!.id]));
    expect(s!.extracted_text).toMatch(/340 LF/);
  });

  it('refuses a page the set does not have, rather than skipping it', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.record_plan_set_text($1, $2::jsonb)`,
      [document, JSON.stringify([{ page: 9, text: 'nothing' }])])))
      .rejects.toThrow(/has no page 9/i);
  });

  it('refuses a field it does not recognize, rather than ignoring it', async () => {
    // Migrations 0136 and 0139: a key nobody reads is a value silently lost.
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.record_plan_set_text($1, $2::jsonb)`,
      [document, JSON.stringify([{ page: 1, txt: 'typo' }])])))
      .rejects.toThrow(/Unknown field/i);
  });

  it('refuses a reading that will not say what produced it', async () => {
    const [sheet] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from document_sheets where document_version_id = $1 and page_number = 2`,
      [version]));
    await expect(h.asUser(OWNER, () => h.sql(
      `select app.record_sheet_extraction($1, 'text', '  ')`, [sheet!.id])))
      .rejects.toThrow(/what read this sheet/i);
  });

  it('records an empty page rather than pretending it was never read', async () => {
    /*
     * A sheet with no text layer is a scan. That is a fact about the sheet, and
     * it is the difference between "needs OCR" and "nobody has looked yet".
     */
    const [sheet] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from document_sheets where document_version_id = $1 and page_number = 3`,
      [version]));
    const [row] = await h.asUser(OWNER, () => h.sql<{ extracted_text: string | null }>(
      `select extracted_text from document_sheets where id = $1`, [sheet!.id]));
    expect(row!.extracted_text).toBeNull();
    const [e] = await h.asUser(OWNER, () => h.sql<{ n: string }>(
      `select count(*) as n from document_extractions where document_sheet_id = $1`,
      [sheet!.id]));
    expect(Number(e!.n)).toBe(1);
  });

  it('will not blank a good reading with a failed one', async () => {
    /*
     * An OCR pass that fails, or a model that times out on one sheet of three
     * hundred, must not wipe text the PDF's own layer read exactly. A sheet
     * that was searchable yesterday and is not today, with nothing on screen
     * saying why, is the worst version of this defect rather than a fix.
     */
    const [sheet] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from document_sheets where document_version_id = $1 and page_number = 2`,
      [version]));
    await h.asUser(OWNER, () => h.sql(
      `select app.record_sheet_extraction($1, '', 'ocr-that-failed')`, [sheet!.id]));

    const [row] = await h.asUser(OWNER, () => h.sql<{ extracted_text: string }>(
      `select extracted_text from document_sheets where id = $1`, [sheet!.id]));
    expect(row!.extracted_text).toMatch(/1,184.50/);

    /* But the failure is in the history, which is the point of keeping runs. */
    const [last] = await h.asUser(OWNER, () => h.sql<{ model: string }>(
      `select model from document_extractions
        where document_sheet_id = $1 and is_current`, [sheet!.id]));
    expect(last!.model).toBe('ocr-that-failed');
  });

  it('says how much of a set can be searched', async () => {
    const [row] = await h.asUser(OWNER, () => h.sql<{
      sheets: string; sheets_with_text: string; sheets_without_text: string;
      document_name: string; last_read_by: string;
    }>(`select sheets, sheets_with_text, sheets_without_text, document_name, last_read_by
          from my_sheet_text_coverage where document_version_id = $1`, [version]));
    expect(Number(row!.sheets)).toBe(3);
    expect(Number(row!.sheets_with_text)).toBe(2);
    expect(Number(row!.sheets_without_text)).toBe(1);
    expect(row!.document_name).toBe('kingsway-civil.pdf');
  });

  it('refuses somebody with no permission to change the document', async () => {
    const STRANGER = '8c8c8c8c-8c8c-4c8c-8c8c-8c8c8c8c8c8c';
    await h.sql(`insert into auth.users (id, email) values ($1,'s@srch.test')`, [STRANGER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'s@srch.test')
                 on conflict (id) do nothing`, [STRANGER]);
    await expect(h.asUser(STRANGER, () => h.sql(
      `select public.record_plan_set_text($1, '[]'::jsonb)`, [document]))).rejects.toThrow();
  });
});
