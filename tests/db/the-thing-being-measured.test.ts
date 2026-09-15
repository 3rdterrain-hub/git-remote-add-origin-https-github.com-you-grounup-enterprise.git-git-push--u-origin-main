/**
 * The thing being measured, as opposed to the shape that measures it.
 *
 * A site plan is not forty estimate lines. It is eight or ten things — six-inch
 * sidewalk, curb and gutter, light-duty pavement — each traced in several
 * places. Every takeoff product estimators use has an object in between the
 * shape and the line, and all of them make you pick it before you trace,
 * because it owns the color that keeps forty traces legible and the depth a
 * drawing does not supply.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '8f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';

describe('a thing measured in many places', () => {
  let h: Harness;
  let company = '';
  let version = '';
  let sheet = '';
  let calibration = '';
  let n = 0;

  const shape = async (name: string, unit = 'SF', kind = 'area'): Promise<string> => {
    const [m] = await h.asService(() => h.sql<{ id: string }>(
      `insert into takeoff_measurements (company_id, document_sheet_id, calibration_id,
         name, kind, unit, geometry, is_closed, depth_feet)
       values ($1,$2,$3,$4,$5::text,$6::app.unit_code,
               '[{"x":0,"y":0},{"x":40,"y":0},{"x":40,"y":31},{"x":0,"y":31}]'::jsonb,
               true, case when $5::text = 'volume' then 2 else null end) returning id`,
      [company, sheet, calibration, name, kind, unit]));
    return m!.id;
  };

  const condition = async (name: string, style = 'area', unit = 'SF'): Promise<string> =>
    (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.create_takeoff_condition($1,$2,$3,$4::app.unit_code) as id`,
      [version, name, style, unit])))[0]!.id;

  const trace = (c: string, m: string, q: number) => h.asUser(OWNER, () => h.sql(
    `select public.record_condition_takeoff($1,$2,$3,'grounup-engine@test')`, [c, m, q]));

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@cnd.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@cnd.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Condition Civil','condition-civil','enterprise') as id`)))[0]!.id;
    const [est] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.create_estimate('Kingsway', null, null, null, $1) as id`, [company]));
    version = (await h.asUser(OWNER, () => h.sql<{ v: string }>(
      `select current_version_id as v from estimates where id = $1`, [est!.id])))[0]!.v;

    const [doc] = await h.asService(() => h.sql<{ id: string }>(
      `insert into documents (company_id, name, document_type)
       values ($1,'site.pdf','plan_set') returning id`, [company]));
    const [ver] = await h.asService(() => h.sql<{ id: string }>(
      `insert into document_versions (company_id, document_id, version_number, storage_path,
         file_name, page_count) values ($1,$2,1,'x/site.pdf','site.pdf',1) returning id`,
      [company, doc!.id]));
    await h.asUser(OWNER, () => h.sql(`select public.set_document_page_count($1, 1)`, [ver!.id]));
    sheet = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from document_sheets where document_version_id = $1`, [ver!.id])))[0]!.id;
    calibration = (await h.asService(() => h.sql<{ id: string }>(
      `insert into takeoff_calibrations (company_id, document_sheet_id, from_x, from_y,
         to_x, to_y, known_distance_feet, basis)
       values ($1,$2,0,0,100,0,100,'known_dimension') returning id`, [company, sheet])))[0]!.id;
  });

  it('makes the line to price on, so there is somewhere to add up', async () => {
    const c = await condition('6 inch concrete sidewalk');
    const [row] = await h.asUser(OWNER, () => h.sql<{
      line_item_id: string; quantity: string; traced: string; color: string;
    }>(`select line_item_id, quantity, traced, color from my_takeoff_conditions
          where id = $1`, [c]));
    expect(row!.line_item_id).not.toBeNull();
    expect(Number(row!.traced)).toBe(0);
    expect(row!.color).toMatch(/^#[0-9A-F]{6}$/i);

    const [line] = await h.asUser(OWNER, () => h.sql<{ description: string; unit: string }>(
      `select description, unit from estimate_line_items where id = $1`, [row!.line_item_id]));
    expect(line!.description).toBe('6 inch concrete sidewalk');
    expect(line!.unit).toBe('SF');
  });

  it('gives each one a different color without being asked', async () => {
    /* Forty traces are unreadable if they are all the same violet. */
    const made = [];
    for (let i = 0; i < 4; i += 1) made.push(await condition(`Colored ${++n}`));
    const rows = await h.asUser(OWNER, () => h.sql<{ color: string }>(
      `select color from my_takeoff_conditions where id = any($1::uuid[])`, [made]));
    expect(new Set(rows.map((r) => r.color)).size).toBe(4);
  });

  it('adds up twelve runs of one thing onto one line', async () => {
    const c = await condition(`Sidewalk ${++n}`);
    for (let i = 0; i < 12; i += 1) {
      await trace(c, await shape(`Run ${++n}`), 100);
    }
    const [row] = await h.asUser(OWNER, () => h.sql<{
      quantity: string; traced: string; line_item_id: string;
    }>(`select quantity, traced, line_item_id from my_takeoff_conditions where id = $1`, [c]));
    expect(Number(row!.traced)).toBe(12);
    expect(Number(row!.quantity)).toBe(1200);

    const [line] = await h.asUser(OWNER, () => h.sql<{ q: string }>(
      `select measured_quantity as q from estimate_line_items where id = $1`,
      [row!.line_item_id]));
    expect(Number(line!.q)).toBe(1200);
  });

  it('files each shape under the thing it measures', async () => {
    const c = await condition(`Filed ${++n}`);
    const m = await shape(`Filed shape ${++n}`);
    await trace(c, m, 55);
    const [row] = await h.asUser(OWNER, () => h.sql<{ condition_id: string }>(
      `select condition_id from takeoff_measurements where id = $1`, [m]));
    expect(row!.condition_id).toBe(c);
  });

  it('moves a shape to a different thing, correcting both lines', async () => {
    /* Estimators trace the wrong item; this is the correction, not the flow. */
    const a = await condition(`From ${++n}`);
    const b = await condition(`To ${++n}`);
    const m = await shape(`Misfiled ${++n}`);
    await trace(a, m, 640);

    await h.asUser(OWNER, () => h.sql(
      `select public.reassign_measurement($1,$2,$3,'grounup-engine@test')`, [m, b, 640]));

    const rows = await h.asUser(OWNER, () => h.sql<{ id: string; quantity: string }>(
      `select id, quantity from my_takeoff_conditions where id = any($1::uuid[])`, [[a, b]]));
    const byId = Object.fromEntries(rows.map((r) => [r.id, Number(r.quantity)]));
    expect(byId[a]).toBe(0);
    expect(byId[b]).toBe(640);
  });

  it('counts the sheets a thing appears on', async () => {
    const [row] = await h.asUser(OWNER, () => h.sql<{ sheets: string }>(
      `select sheets from my_takeoff_conditions where name like 'Sidewalk%' limit 1`));
    expect(Number(row!.sheets)).toBe(1);
  });

  it('renames the line when the thing is renamed', async () => {
    const c = await condition(`Old name ${++n}`);
    await h.asUser(OWNER, () => h.sql(
      `select public.update_takeoff_condition($1, 'Heavy duty pavement')`, [c]));
    const [row] = await h.asUser(OWNER, () => h.sql<{ line_item_id: string; name: string }>(
      `select line_item_id, name from my_takeoff_conditions where id = $1`, [c]));
    expect(row!.name).toBe('Heavy duty pavement');
    const [line] = await h.asUser(OWNER, () => h.sql<{ description: string }>(
      `select description from estimate_line_items where id = $1`, [row!.line_item_id]));
    expect(line!.description).toBe('Heavy duty pavement');
  });

  it('refuses two things with the same name on one estimate', async () => {
    // One name for one thing — the rule from CLAUDE.md.
    await condition('Curb and gutter');
    await expect(condition('Curb and gutter')).rejects.toThrow();
  });

  it('refuses one with no name, because the name is what you pick it by', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.create_takeoff_condition($1,'   ','area','SF'::app.unit_code)`,
      [version]))).rejects.toThrow(/needs a name/i);
  });

  it('refuses a kind of thing nobody defined', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.create_takeoff_condition($1,'Guesswork','telepathy','SF'::app.unit_code)`,
      [version]))).rejects.toThrow(/count, a length, an area, a volume or a pond/i);
  });

  it('refuses to start one on an estimate that has been signed off', async () => {
    const [est] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.create_estimate('Frozen job', null, null, null, $1) as id`, [company]));
    const v2 = (await h.asUser(OWNER, () => h.sql<{ v: string }>(
      `select current_version_id as v from estimates where id = $1`, [est!.id])))[0]!.v;
    /* Approval needs a snapshot, because a price nobody can reproduce is not one. */
    const [snap] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `insert into library_snapshots (company_id, estimate_version_id, engine_version,
         entry_count, digest) values ($1,$2,'1.0.0',1,'0123456789abcdef') returning id`,
      [company, v2]));
    await h.asService(() => h.sql(
      `update estimate_versions set status='approved', library_snapshot_id=$1
         where id = $2`, [snap!.id, v2]));
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.create_takeoff_condition($1,'Too late','area','SF'::app.unit_code)`,
      [v2]))).rejects.toThrow(/make a new version/i);
  });

  it('carries the depth a drawing does not supply', async () => {
    const c = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select public.create_takeoff_condition($1,'Topsoil strip','volume','CY'::app.unit_code,
         null, 0.5) as id`, [version])))[0]!.id;
    const [row] = await h.asUser(OWNER, () => h.sql<{ depth_feet: string; unit: string }>(
      `select depth_feet, unit from my_takeoff_conditions where id = $1`, [c]));
    expect(Number(row!.depth_feet)).toBe(0.5);
    expect(row!.unit).toBe('CY');
  });

  it('refuses somebody who may not change the estimate', async () => {
    const STRANGER = '8f1f1f1f-1f1f-4f1f-8f1f-1f1f1f1f1f1f';
    await h.sql(`insert into auth.users (id, email) values ($1,'s@cnd.test')`, [STRANGER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'s@cnd.test')
                 on conflict (id) do nothing`, [STRANGER]);
    await expect(h.asUser(STRANGER, () => h.sql(
      `select public.create_takeoff_condition($1,'Not mine','area','SF'::app.unit_code)`,
      [version]))).rejects.toThrow();
  });
});
