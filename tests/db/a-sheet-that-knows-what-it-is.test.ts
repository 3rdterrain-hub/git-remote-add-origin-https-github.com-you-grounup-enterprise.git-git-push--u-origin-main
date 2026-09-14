/**
 * A sheet that knows what it is.
 *
 * `document_sheets` has carried `sheet_number`, `sheet_title`, `discipline`,
 * `drawing_scale`, `revision` and `revision_date` since migration 0005, with an
 * index on `(company_id, sheet_number)` for finding a sheet by the number
 * printed on it. Nothing ever wrote one.
 *
 * Found by taking a real fourteen sheet civil set off: the picker listed it as
 * "p.1" through "p.14", so an estimator had to remember which page was the site
 * plan. One omission with four consequences — no name, no printed scale to
 * start from, nothing to compare across revisions, and nothing to search.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '89898989-8989-4989-8989-898989898989';

describe('naming a sheet', () => {
  let h: Harness;
  let company = '';
  let sheet = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@prism.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@prism.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Prism Civil','prism-civil','enterprise') as id`)))[0]!.id;

    const [doc] = await h.asService(() => h.sql<{ id: string }>(
      `insert into documents (company_id, name, document_type)
       values ($1,'autozone-5436.pdf','plan_set') returning id`, [company]));
    const [ver] = await h.asService(() => h.sql<{ id: string }>(
      `insert into document_versions (company_id, document_id, version_number, storage_path,
         file_name, page_count)
       values ($1,$2,1,'x/autozone.pdf','autozone-5436.pdf',14) returning id`,
      [company, doc!.id]));
    for (let p = 1; p <= 3; p += 1) {
      const [s] = await h.asService(() => h.sql<{ id: string }>(
        `insert into document_sheets (company_id, document_version_id, page_number)
         values ($1,$2,$3) returning id`, [company, ver!.id, p]));
      if (p === 5 - 4) sheet = s!.id;
    }
  });

  it('calls an unnamed sheet by its page, and says it is unnamed', async () => {
    const rows = await h.asUser(OWNER, () => h.sql<{ label: string; unnamed: boolean }>(
      `select label, unnamed from my_plan_sheets order by page_number`));
    expect(rows[0]!.label).toBe('p.1');
    expect(rows[0]!.unnamed).toBe(true);
  });

  it('takes the name off the title block', async () => {
    await h.asUser(OWNER, () => h.sql(
      `select app.identify_sheet($1,'c1.0','Site Plan','Civil','1 inch = 20 feet','2',
                                 '2021-11-09'::date)`, [sheet]));
    const [row] = await h.asUser(OWNER, () => h.sql<{
      label: string; sheet_number: string; drawing_scale: string;
      revision: string; unnamed: boolean;
    }>(`select label, sheet_number, drawing_scale, revision, unnamed
          from my_plan_sheets where id=$1`, [sheet]));
    // Upper-cased, because "c1.0" and "C1.0" are the same sheet and the index
    // that finds one by number should find it either way.
    expect(row!.sheet_number).toBe('C1.0');
    expect(row!.label).toBe('C1.0 — Site Plan');
    expect(row!.drawing_scale).toBe('1 inch = 20 feet');
    expect(row!.revision).toBe('2');
    expect(row!.unnamed).toBe(false);
  });

  it('leaves alone what it was not asked to change', async () => {
    // Correcting one field must not blank the rest.
    await h.asUser(OWNER, () => h.sql(
      `select app.identify_sheet($1,null,'Overall Site Plan')`, [sheet]));
    const [row] = await h.asUser(OWNER, () => h.sql<{ sheet_number: string; drawing_scale: string }>(
      `select sheet_number, drawing_scale from my_plan_sheets where id=$1`, [sheet]));
    expect(row!.sheet_number).toBe('C1.0');
    expect(row!.drawing_scale).toBe('1 inch = 20 feet');
  });

  it('lets an agent fill a blank and never overwrite a person', async () => {
    /*
     * RULE-008 in the small. The model reads the title block of the sheets
     * nobody has got to; it does not correct somebody who has.
     */
    const [blank] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from my_plan_sheets where unnamed order by page_number limit 1`));
    await h.asUser(OWNER, () => h.sql(
      `select app.identify_sheet($1,'D1.0','Site Demolition Plan',null,null,null,null,'ai_agent')`,
      [blank!.id]));
    const [filled] = await h.asUser(OWNER, () => h.sql<{ label: string }>(
      `select label from my_plan_sheets where id=$1`, [blank!.id]));
    expect(filled!.label).toBe('D1.0 — Site Demolition Plan');

    await h.asUser(OWNER, () => h.sql(
      `select app.identify_sheet($1,'ZZ','Wrong',null,null,null,null,'ai_agent')`, [sheet]));
    const [kept] = await h.asUser(OWNER, () => h.sql<{ label: string }>(
      `select label from my_plan_sheets where id=$1`, [sheet]));
    expect(kept!.label).toBe('C1.0 — Overall Site Plan');
  });

  it('refuses a source that is neither a person nor an agent', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select app.identify_sheet($1,'X',null,null,null,null,null,'guess')`, [sheet])))
      .rejects.toThrow(/by a person or by an agent/i);
  });

  it('counts what has been taken off each sheet', async () => {
    const [row] = await h.asUser(OWNER, () => h.sql<{
      measurement_count: string; calibration_count: string; document_name: string;
    }>(`select measurement_count, calibration_count, document_name
          from my_plan_sheets where id=$1`, [sheet]));
    expect(Number(row!.measurement_count)).toBe(0);
    expect(row!.document_name).toBe('autozone-5436.pdf');
  });

  it('refuses somebody without permission to change the document', async () => {
    const STRANGER = '8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a';
    await h.sql(`insert into auth.users (id, email) values ($1,'s@x.test')`, [STRANGER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'s@x.test')
                 on conflict (id) do nothing`, [STRANGER]);
    await expect(h.asUser(STRANGER, () => h.sql(
      `select app.identify_sheet($1,'X')`, [sheet]))).rejects.toThrow();
  });
});
