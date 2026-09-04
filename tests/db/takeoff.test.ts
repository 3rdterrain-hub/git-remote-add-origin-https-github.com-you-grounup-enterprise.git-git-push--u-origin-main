import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * On-screen takeoff, in the database.
 *
 * Two properties this schema exists to hold, and both are enforced by the
 * columns rather than by an application that could forget:
 *
 *   1. **No quantity is stored.** The row holds the geometry, the scale and
 *      the modifiers; the number follows from them by arithmetic the estimating
 *      engine owns. A stored copy could disagree with the shape it came from,
 *      which is the "derive, don't store" rule that already governs library
 *      rate validity, credential standing and the current metric version.
 *   2. **A scale cannot claim to be verified without saying against what.**
 *      `measurement_method` is a generated column, so the claim is computed
 *      from the basis and the reference rather than asserted. It flows into the
 *      line confidence score and the approval gate, which is what stops a
 *      measurement taken off an unverified print quietly becoming a bid.
 */
describe('takeoff', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  let company = '';
  let sheet = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@r.test')`, [owner]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@r.test') on conflict (id) do nothing`, [owner]);
    company = (await h.asUser(owner, () =>
      h.sql<{ id: string }>(`select app.provision_company('Ridgeline','ridgeline','business') as id`)))[0]!.id;

    await h.asUser(owner, async () => {
      const doc = (await h.sql<{ id: string }>(
        `insert into documents (company_id, name, document_type)
         values ($1,'Kingsway plan set','plan_set') returning id`, [company]))[0]!.id;
      const ver = (await h.sql<{ id: string }>(
        `insert into document_versions (company_id, document_id, version_number, storage_path, file_name)
         values ($1,$2,1,'plans/kingsway-v1.pdf','kingsway-v1.pdf') returning id`,
        [company, doc]))[0]!.id;
      sheet = (await h.sql<{ id: string }>(
        `insert into document_sheets (company_id, document_version_id, page_number,
           sheet_number, sheet_title, drawing_scale)
         values ($1,$2,4,'C-301','Storm plan','1" = 20''') returning id`,
        [company, ver]))[0]!.id;
    });
  });

  afterAll(async () => { await h?.db.close(); });

  const calibrate = (over: Record<string, unknown> = {}) => h.asUser(owner, () =>
    h.sql<{ id: string; measurement_method: string; span_points: string }>(
      `insert into takeoff_calibrations
         (company_id, document_sheet_id, from_x, from_y, to_x, to_y,
          known_distance_feet, basis, reference)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       returning id, measurement_method, span_points`,
      [company, sheet, over.from_x ?? 0, over.from_y ?? 0, over.to_x ?? 100, over.to_y ?? 0,
       over.known_distance_feet ?? 20, over.basis ?? 'known_dimension',
       over.reference === undefined ? "Dimension string 20'-0\" on C-301" : over.reference]));

  // ------------------------------------------------------------ the scale
  describe('the scale', () => {
    it('derives the span from the two points rather than storing a ratio', async () => {
      // 3-4-5, so the span is 100 whatever the axis.
      const [c] = await calibrate({ to_x: 60, to_y: 80 });
      expect(Number(c!.span_points)).toBeCloseTo(100, 6);
    });

    it('earns verified_scale from a named known dimension', async () => {
      const [c] = await calibrate();
      expect(c!.measurement_method).toBe('verified_scale');
    });

    it('refuses the claim when the calibration cannot say what it checked', async () => {
      /*
       * "I verified it" without naming the dimension is not a verification, and
       * this is a generated column so the application cannot assert otherwise.
       */
      const [c] = await calibrate({ reference: null });
      expect(c!.measurement_method).toBe('approximate_scale');
    });

    it('treats a graphic scale bar as approximate', async () => {
      // It is drawn on the sheet and reduces with it: it proves the print is
      // internally consistent, never that it is at the scale it claims.
      const [c] = await calibrate({ basis: 'graphic_scale_bar' });
      expect(c!.measurement_method).toBe('approximate_scale');
    });

    it('treats the title block as approximate', async () => {
      const [c] = await calibrate({ basis: 'stated_scale', reference: null });
      expect(c!.measurement_method).toBe('approximate_scale');
    });

    it('cannot be told it is verified directly', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `insert into takeoff_calibrations
           (company_id, document_sheet_id, from_x, from_y, to_x, to_y,
            known_distance_feet, basis, measurement_method)
         values ($1,$2,0,0,100,0,20,'stated_scale','verified_scale')`, [company, sheet])))
        // PostgreSQL's own words for it: a generated column takes no supplied value.
        .rejects.toThrow(/non-DEFAULT value/);
    });

    it('refuses two identical points, which span nothing', async () => {
      await expect(calibrate({ to_x: 0, to_y: 0 })).rejects.toThrow(/takeoff_calibrations_span/);
    });

    it('refuses a known distance of zero', async () => {
      await expect(calibrate({ known_distance_feet: 0 }))
        .rejects.toThrow(/known_distance_feet/);
    });
  });

  // ------------------------------------------------------ the measurement
  describe('a measurement', () => {
    let calibration = '';
    beforeAll(async () => { calibration = (await calibrate())[0]!.id; });

    const measure = (over: Record<string, unknown> = {}) => h.asUser(owner, () =>
      h.sql<{ id: string }>(
        `insert into takeoff_measurements
           (company_id, document_sheet_id, calibration_id, name, trade, kind, unit,
            geometry, deductions, is_closed, depth_feet, width_feet, count_per, multiplier)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,coalesce($9::jsonb,'[]'::jsonb),
                 coalesce($10,false),$11,$12,coalesce($13,1),coalesce($14,1))
         returning id`,
        [company, sheet, over.calibration_id === null ? null : calibration,
         over.name ?? 'Storm main', over.trade ?? 'Utilities',
         over.kind ?? 'linear', over.unit ?? 'LF',
         over.geometry ?? JSON.stringify([{ x: 0, y: 0 }, { x: 500, y: 0 }]),
         over.deductions ?? null, over.is_closed ?? null,
         over.depth_feet ?? null, over.width_feet ?? null,
         over.count_per ?? null, over.multiplier ?? null]));

    it('stores the shape and no quantity at all', async () => {
      /*
       * The whole design decision, asserted. If a quantity column ever appears
       * it will be a second copy of a number that already follows from the
       * geometry, and the two will eventually disagree.
       */
      await measure();
      const cols = await h.sql<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_name = 'takeoff_measurements' and column_name like '%quantity%'`);
      // Only the figure actually written onto an estimate line is stored, and
      // it is named for exactly that.
      expect(cols.map((c) => c.column_name)).toEqual(['applied_quantity']);
    });

    it('needs two points for a run', async () => {
      await expect(measure({ geometry: JSON.stringify([{ x: 0, y: 0 }]) }))
        .rejects.toThrow(/enough_points/);
    });

    it('needs three points for an outline', async () => {
      await expect(measure({
        kind: 'area', unit: 'SF',
        geometry: JSON.stringify([{ x: 0, y: 0 }, { x: 100, y: 0 }]),
      })).rejects.toThrow(/enough_points/);
    });

    it('accepts a single marker for a count', async () => {
      const [m] = await measure({
        kind: 'count', unit: 'EA', calibration_id: null,
        geometry: JSON.stringify([{ x: 10, y: 10 }]),
      });
      expect(m!.id).toBeTruthy();
    });

    it('lets a count stand without a scale, because counting does not use one', async () => {
      const [m] = await measure({
        kind: 'count', unit: 'EA', calibration_id: null,
        geometry: JSON.stringify([{ x: 1, y: 1 }, { x: 2, y: 2 }]),
      });
      expect(m!.id).toBeTruthy();
    });

    it('refuses a measured shape with no scale', async () => {
      // A traced line with no calibration is a number of pixels.
      await expect(measure({ calibration_id: null }))
        .rejects.toThrow(/takeoff_measurements_scale/);
    });

    it('refuses a volume with no depth rather than assuming one', async () => {
      await expect(measure({
        kind: 'volume', unit: 'CY',
        geometry: JSON.stringify([{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 300 }]),
      })).rejects.toThrow(/volume_depth/);
    });

    it('refuses half a pitch', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `insert into takeoff_measurements
           (company_id, document_sheet_id, calibration_id, name, kind, unit, geometry, pitch_rise)
         values ($1,$2,$3,'Roof','area','SF','[{"x":0,"y":0},{"x":1,"y":0},{"x":1,"y":1}]'::jsonb,6)`,
        [company, sheet, calibration]))).rejects.toThrow(/takeoff_measurements_pitch/);
    });

    it('refuses geometry that is not an array of points', async () => {
      /*
       * Two constraints cover this and PostgreSQL evaluates them in no
       * guaranteed order, so the assertion accepts either — what matters is
       * that a single object where an array of points belongs is refused.
       */
      await expect(measure({ geometry: JSON.stringify({ x: 1, y: 2 }) }))
        .rejects.toThrow(/takeoff_measurements_(geometry|enough_points)/);
    });
  });

  // --------------------------------------------------------------- status
  describe('what was applied to an estimate', () => {
    let calibration = '';
    let lineItem = '';
    let measurement = '';

    beforeAll(async () => {
      calibration = (await calibrate())[0]!.id;
      await h.asUser(owner, async () => {
        const est = (await h.sql<{ id: string }>(
          `insert into estimates (company_id, number, name) values ($1,'EST-T1','Kingsway')
           returning id`, [company]))[0]!.id;
        const ver = (await h.sql<{ id: string }>(
          `insert into estimate_versions (company_id, estimate_id, version_number)
           values ($1,$2,1) returning id`, [company, est]))[0]!.id;
        lineItem = (await h.sql<{ id: string }>(
          `insert into estimate_line_items (company_id, estimate_version_id, description,
             measured_quantity, unit, measurement_method)
           values ($1,$2,'Storm main',100,'LF','verified_scale') returning id`,
          [company, ver]))[0]!.id;
        measurement = (await h.sql<{ id: string }>(
          `insert into takeoff_measurements
             (company_id, document_sheet_id, calibration_id, name, kind, unit, geometry)
           values ($1,$2,$3,'Storm main','linear','LF',
                   '[{"x":0,"y":0},{"x":500,"y":0}]'::jsonb) returning id`,
          [company, sheet, calibration]))[0]!.id;
      });
    });

    it('refuses to record an application with no figure or no time', async () => {
      // "Applied" with nothing recorded about what or when is not a record.
      await expect(h.asUser(owner, () => h.sql(
        `update takeoff_measurements set applied_line_item_id = $2 where id = $1`,
        [measurement, lineItem]))).rejects.toThrow(/takeoff_measurements_applied/);
    });

    it('records what was written onto the line and when', async () => {
      await h.asUser(owner, () => h.sql(
        `update takeoff_measurements
            set applied_line_item_id = $2, applied_quantity = 100,
                applied_at = now(), applied_engine_version = '1.0.0'
          where id = $1`, [measurement, lineItem]));
      const [r] = await h.asUser(owner, () => h.sql<{ stale_on_line: boolean }>(
        `select stale_on_line from reporting_takeoff_status where measurement_id = $1`,
        [measurement]));
      expect(r!.stale_on_line).toBe(false);
    });

    it('notices when a measurement is retraced after it was applied', async () => {
      /*
       * The estimate line no longer reflects the shape on the drawing. Derived
       * from the two timestamps rather than flagged, so it cannot be left set
       * after somebody fixes the line.
       */
      await h.asUser(owner, () => h.sql(
        `update takeoff_measurements
            set geometry = '[{"x":0,"y":0},{"x":900,"y":0}]'::jsonb, updated_at = now() + interval '1 minute'
          where id = $1`, [measurement]));
      const [r] = await h.asUser(owner, () => h.sql<{ stale_on_line: boolean }>(
        `select stale_on_line from reporting_takeoff_status where measurement_id = $1`,
        [measurement]));
      expect(r!.stale_on_line).toBe(true);
    });

    it('reports the standing of the scale beside the measurement', async () => {
      const [r] = await h.asUser(owner, () => h.sql<{
        measurement_method: string; sheet_number: string; stated_scale: string;
      }>(`select measurement_method, sheet_number, stated_scale
            from reporting_takeoff_status where measurement_id = $1`, [measurement]));
      expect(r!.measurement_method).toBe('verified_scale');
      expect(r!.sheet_number).toBe('C-301');
      expect(r!.stated_scale).toBe(`1" = 20'`);
    });
  });

  // ------------------------------------------------------------- tenancy
  it('shows one company nothing of another company takeoff', async () => {
    const stranger = '22222222-2222-4222-8222-222222222222';
    await h.sql(`insert into auth.users (id, email) values ($1,'s@r.test')`, [stranger]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'s@r.test') on conflict (id) do nothing`, [stranger]);
    await h.asUser(stranger, () => h.sql(`select app.provision_company('Other','other','business')`));
    const rows = await h.asUser(stranger, () => h.sql(
      `select 1 from takeoff_measurements where company_id = $1`, [company]));
    expect(rows).toEqual([]);
  });
});
