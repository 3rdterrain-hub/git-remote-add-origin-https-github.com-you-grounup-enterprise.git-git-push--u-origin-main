/**
 * A line is the sum of what fed it.
 *
 * `apply_takeoff_to_line` wrote `measured_quantity = p_quantity`. It
 * overwrote. Trace a sidewalk in twelve runs, apply each to the sidewalk line,
 * and the line held the twelfth — silently. The function's own author knew a
 * line takes several measurements: the comment above `source_references` says
 * so, and the citations accumulated while the quantity did not.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '8e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e';

describe('what a line adds up to', () => {
  let h: Harness;
  let company = '';
  let version = '';
  let line = '';
  let sheet = '';
  let calibration = '';
  let n = 0;

  /** A traced shape on the sheet, already measured. */
  const measure = async (name: string, unit = 'SF', kind = 'area'): Promise<string> => {
    const [m] = await h.asService(() => h.sql<{ id: string }>(
      `insert into takeoff_measurements (company_id, document_sheet_id, calibration_id,
         name, kind, unit, geometry, is_closed, depth_feet)
       values ($1,$2,$3,$4,$5::text,$6::app.unit_code,
               /* A real ring: the schema refuses a shape that is not one. */
               '[{"x":0,"y":0},{"x":40,"y":0},{"x":40,"y":31},{"x":0,"y":31}]'::jsonb,
               true, case when $5::text = 'volume' then 2 else null end) returning id`,
      [company, sheet, calibration, name, kind, unit]));
    return m!.id;
  };

  const apply = (m: string, qty: number) => h.asUser(OWNER, () => h.sql(
    `select app.apply_takeoff_to_line($1,$2,$3,'grounup-engine@test')`, [m, line, qty]));

  const lineQuantity = async (): Promise<number> => Number(
    (await h.asUser(OWNER, () => h.sql<{ q: string }>(
      `select measured_quantity as q from estimate_line_items where id = $1`, [line])))[0]!.q);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@sum.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@sum.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Sum Civil','sum-civil','enterprise') as id`)))[0]!.id;

    const [est] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.create_estimate('Kingsway', null, null, null, $1) as id`, [company]));
    version = (await h.asUser(OWNER, () => h.sql<{ v: string }>(
      `select current_version_id as v from estimates where id = $1`, [est!.id])))[0]!.v;
    line = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.add_estimate_line($1, null, '6 inch concrete sidewalk', 0, 'SF') as id`,
      [version])))[0]!.id;

    const [doc] = await h.asService(() => h.sql<{ id: string }>(
      `insert into documents (company_id, name, document_type)
       values ($1,'site.pdf','plan_set') returning id`, [company]));
    const [ver] = await h.asService(() => h.sql<{ id: string }>(
      `insert into document_versions (company_id, document_id, version_number, storage_path,
         file_name, page_count) values ($1,$2,1,'x/site.pdf','site.pdf',1) returning id`,
      [company, doc!.id]));
    await h.asUser(OWNER, () => h.sql(
      `select public.set_document_page_count($1, 1)`, [ver!.id]));
    sheet = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from document_sheets where document_version_id = $1`, [ver!.id])))[0]!.id;
    calibration = (await h.asService(() => h.sql<{ id: string }>(
      /* `measurement_method` is generated from the basis — the database decides. */
      `insert into takeoff_calibrations (company_id, document_sheet_id, from_x, from_y,
         to_x, to_y, known_distance_feet, basis)
       values ($1,$2,0,0,100,0,100,'known_dimension') returning id`,
      [company, sheet])))[0]!.id;
  });

  it('adds a second run to the first rather than replacing it', async () => {
    /* The bug, stated as the thing it should do. */
    await apply(await measure(`Sidewalk run ${++n}`), 420);
    expect(await lineQuantity()).toBe(420);

    await apply(await measure(`Sidewalk run ${++n}`), 380);
    expect(await lineQuantity()).toBe(800);
  });

  it('adds up a sidewalk traced in twelve runs', async () => {
    const before = await lineQuantity();
    for (let i = 0; i < 12; i += 1) {
      await apply(await measure(`Run ${++n}`), 100);
    }
    expect(await lineQuantity()).toBe(before + 1200);
  });

  it('falls again when a measurement is taken back off', async () => {
    const m = await measure(`Removable ${++n}`);
    await apply(m, 250);
    const withIt = await lineQuantity();
    await h.asUser(OWNER, () => h.sql(`select public.unapply_takeoff($1)`, [m]));
    expect(await lineQuantity()).toBe(withIt - 250);

    /* And the tracing is still there — it was unapplied, not deleted. */
    const [still] = await h.asUser(OWNER, () => h.sql<{ n: string }>(
      `select count(*) as n from takeoff_measurements where id = $1`, [m]));
    expect(Number(still!.n)).toBe(1);
  });

  it('falls when a measurement is deleted outright', async () => {
    /*
     * Recomputed, never incremented — so a delete corrects the line without
     * anybody remembering to, and no writer can go round it.
     */
    const m = await measure(`Deletable ${++n}`);
    await apply(m, 500);
    const withIt = await lineQuantity();
    await h.asUser(OWNER, () => h.sql(
      `delete from takeoff_measurements where id = $1`, [m]));
    expect(await lineQuantity()).toBe(withIt - 500);
  });

  it('does not count the same measurement twice when it is applied again', async () => {
    const m = await measure(`Reapplied ${++n}`);
    await apply(m, 300);
    const once = await lineQuantity();
    await apply(m, 300);
    expect(await lineQuantity()).toBe(once);
  });

  it('follows a measurement moved from one line to another', async () => {
    const other = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.add_estimate_line($1, null, 'Curb and gutter', 0, 'SF') as id`,
      [version])))[0]!.id;
    const m = await measure(`Movable ${++n}`);
    await apply(m, 175);
    const before = await lineQuantity();

    await h.asUser(OWNER, () => h.sql(
      `select app.apply_takeoff_to_line($1,$2,$3,'grounup-engine@test')`, [m, other, 175]));

    expect(await lineQuantity()).toBe(before - 175);
    const [o] = await h.asUser(OWNER, () => h.sql<{ q: string }>(
      `select measured_quantity as q from estimate_line_items where id = $1`, [other]));
    expect(Number(o!.q)).toBe(175);
  });

  it('refuses to add square feet to cubic yards', async () => {
    /* A line holding the sum of two units is worse than a line holding neither. */
    const cy = await measure(`Excavation ${++n}`, 'CY', 'volume');
    await expect(apply(cy, 90)).rejects.toThrow(/a line adds up one unit/i);
  });

  it('keeps every citation, so the total can be argued with', async () => {
    const [row] = await h.asUser(OWNER, () => h.sql<{ n: number }>(
      `select array_length(source_references, 1) as n
         from estimate_line_items where id = $1`, [line]));
    expect(row!.n).toBeGreaterThan(5);
  });

  it('says what the total is made of, sheet by sheet', async () => {
    const rows = await h.asUser(OWNER, () => h.sql<{
      name: string; applied_quantity: string; sheet_label: string;
    }>(`select name, applied_quantity, sheet_label from my_line_measurements
          where line_item_id = $1 order by applied_at`, [line]));
    expect(rows.length).toBeGreaterThan(5);
    expect(rows[0]!.sheet_label).toBe('p.1');

    const summed = rows.reduce((a, r) => a + Number(r.applied_quantity), 0);
    expect(summed).toBeCloseTo(await lineQuantity(), 4);
  });
});
