/**
 * A surface somebody shot.
 *
 * Survey and grade was the last whole section with no writer of any kind: five
 * governed tables, two guards that had never fired in their lives, and nothing
 * anywhere that could put a row into any of them.
 *
 * Three things are worth more than the rest here.
 *
 *   * **An elevation array of the wrong length is refused.** It is the only
 *     mistake in this area that produces a plausible answer rather than a
 *     failure: the cells shift and every depth goes with them.
 *   * **A published design freezes the ground it was cut from.** 0048 has
 *     refused that since it was written, and until now nothing could publish.
 *   * **A yardage cannot be typed.** The comparison columns are engine outputs
 *     from here, and the guard resets them on insert rather than trusting a
 *     caller who means well.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '5d9d9d9d-9d9d-4d9d-9d9d-9d9d9d9d9d9d';
const CELLS = 25;

/** A 5 × 5 grid at a constant elevation: flat ground, exactly measurable. */
const flat = (z: number) => JSON.stringify(Array.from({ length: CELLS }, () => z));

describe('a surface somebody shot', () => {
  let h: Harness;
  let company = '';
  let project = '';
  let survey = '';
  let existing = '';
  let design = '';

  const asOwner = <T>(fn: () => Promise<T>) => h.asUser(OWNER, fn);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@grade.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@grade.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await asOwner(() => h.sql<{ id: string }>(
      `select app.provision_company('Grade Civil','grade-civil','enterprise') as id`)))[0]!.id;
    project = (await asOwner(() => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name, status)
       values ($1,'PRJ-G1','Vale Cut','active') returning id`, [company])))[0]!.id;
  }, 180_000);

  // --------------------------------------------------------------- the capture
  describe('recording a capture', () => {
    it('records a survey with the datum it was shot on', async () => {
      const [row] = await asOwner(() => h.sql<{ id: string }>(
        `select public.record_survey($1,'Rover shot 3 Sep','gps_rover','2026-09-03',
           'T. Myers','NAD83','NAVD88','OH-N','us_survey_feet',1840,142000) as id`, [project]));
      survey = row!.id;
      const [s] = await asOwner(() => h.sql<{
        vertical_datum: string; capture_method: string; point_count: number;
      }>(`select vertical_datum, capture_method, point_count from surveys where id = $1`, [survey]));
      expect(s!.vertical_datum).toBe('NAVD88');
      expect(s!.capture_method).toBe('gps_rover');
      expect(Number(s!.point_count)).toBe(1840);
    });

    it('refuses a capture method nobody uses', async () => {
      await expect(asOwner(() => h.sql(
        `select public.record_survey($1,'Guesswork','dowsing')`, [project])))
        .rejects.toThrow(/Unknown capture method/);
    });

    it('refuses a survey captured in the future', async () => {
      await expect(asOwner(() => h.sql(
        `select public.record_survey($1,'Next year','gps_rover', current_date + 1)`, [project])))
        .rejects.toThrow(/cannot have been captured in the future/);
    });

    it('shows the capture on the screen it belongs to', async () => {
      const [row] = await asOwner(() => h.sql<{
        project_number: string; surface_count: number;
      }>(`select project_number, surface_count from my_surveys where id = $1`, [survey]));
      expect(row!.project_number).toBe('PRJ-G1');
      expect(Number(row!.surface_count)).toBe(0);
    });
  });

  // --------------------------------------------------------------- the surface
  describe('building a surface', () => {
    it('refuses an elevation array that does not fit its grid', async () => {
      // The one mistake here that produces a plausible answer instead of a
      // failure: the cells shift, and every depth shifts with them.
      await expect(asOwner(() => h.sql(
        `select public.create_surface($1,'Short','existing',10,5,5,$2::jsonb)`,
        [survey, JSON.stringify([100, 100, 100])])))
        .rejects.toThrow(/3 elevations for a 5 × 5 grid, which needs 25/);
    });

    it('refuses a surface with neither a grid nor a file', async () => {
      await expect(asOwner(() => h.sql(
        `select public.create_surface($1,'Nothing','existing',10,5,5)`, [survey])))
        .rejects.toThrow(/must say where its file is/);
    });

    it('computes the extent rather than taking it', async () => {
      existing = (await asOwner(() => h.sql<{ id: string }>(
        `select public.create_surface($1,'Existing ground','existing',10,5,5,$2::jsonb,
           null,1500000,700000) as id`, [survey, flat(100)])))[0]!.id;
      const [row] = await asOwner(() => h.sql<{ min_elevation: string; max_elevation: string }>(
        `select min_elevation, max_elevation from surfaces where id = $1`, [existing]));
      expect(Number(row!.min_elevation)).toBe(100);
      expect(Number(row!.max_elevation)).toBe(100);
    });

    it('accepts a second surface on the same grid', async () => {
      design = (await asOwner(() => h.sql<{ id: string }>(
        `select public.create_surface($1,'Design subgrade','design',10,5,5,$2::jsonb,
           null,1500000,700000) as id`, [survey, flat(96)])))[0]!.id;
      expect(design).toBeTruthy();
    });

    it('reads back as a surface a screen can list', async () => {
      const [row] = await asOwner(() => h.sql<{
        cell_count: number; has_grid: boolean; vertical_datum: string; frozen_by_file: string | null;
      }>(`select cell_count, has_grid, vertical_datum, frozen_by_file
            from my_surfaces where id = $1`, [existing]));
      expect(Number(row!.cell_count)).toBe(25);
      expect(row!.has_grid).toBe(true);
      expect(row!.vertical_datum).toBe('NAVD88');
      expect(row!.frozen_by_file).toBeNull();
    });

    it('refuses half a georeference', async () => {
      await expect(asOwner(() => h.sql(
        `select public.update_surface($1,null,null,1500000)`, [existing])))
        .rejects.toThrow(/both an easting and a northing/);
    });
  });

  // --------------------------------------------------------------- the volume
  describe('the volume between them', () => {
    let comparison = '';

    it('refuses a yardage a person typed', async () => {
      // The insert is allowed; the figures are reset to the unpriced state the
      // schema defines, so what comes back is zero rather than the claim.
      const [row] = await asOwner(() => h.sql<{ id: string }>(
        `insert into surface_comparisons (company_id, project_id, existing_surface_id,
           design_surface_id, name, cut_bcy, fill_ccy)
         values ($1,$2,$3,$4,'Typed in',43054,31600) returning id`,
        [company, project, existing, design]));
      const [back] = await asOwner(() => h.sql<{ cut_bcy: string; fill_ccy: string }>(
        `select cut_bcy, fill_ccy from surface_comparisons where id = $1`, [row!.id]));
      expect(Number(back!.cut_bcy)).toBe(0);
      expect(Number(back!.fill_ccy)).toBe(0);
      await h.sql(`delete from surface_comparisons where id = $1`, [row!.id]);
    });

    it('refuses an updated yardage outright', async () => {
      const [row] = await asOwner(() => h.sql<{ id: string }>(
        `insert into surface_comparisons (company_id, project_id, existing_surface_id,
           design_surface_id, name) values ($1,$2,$3,$4,'Blank') returning id`,
        [company, project, existing, design]));
      await expect(asOwner(() => h.sql(
        `update surface_comparisons set cut_bcy = 9999 where id = $1`, [row!.id])))
        .rejects.toThrow(/may not be written by hand/);
      await h.sql(`delete from surface_comparisons where id = $1`, [row!.id]);
    });

    it('records the volume the engine computed', async () => {
      // Four feet of cut over twenty-five hundred square feet is 10,000 cubic
      // feet, which is 370.37 bank cubic yards. Arithmetic anybody can check.
      comparison = (await h.sql<{ id: string }>(
        `select app.record_surface_comparison($1,$2,$3,$4,'Mass earthwork',
           'grounup-engine/surfaces@1', $5::jsonb) as id`,
        [company, project, existing, design, JSON.stringify({
          cut_bcy: 370.3704, fill_ccy: 0, net_bcy: 370.3704,
          cut_area_sf: 2500, fill_area_sf: 0, max_cut_depth_ft: 4,
          average_cut_depth_ft: 4, cells_compared: 25, cells_skipped: 0,
          coverage: 1, warnings: [],
        })]))[0]!.id;
      const [row] = await asOwner(() => h.sql<{ cut_bcy: string; engine_version: string }>(
        `select cut_bcy, engine_version from surface_comparisons where id = $1`, [comparison]));
      expect(Number(row!.cut_bcy)).toBeCloseTo(370.3704, 3);
      expect(row!.engine_version).toBe('grounup-engine/surfaces@1');
    });

    it('refuses a field the comparison does not have', async () => {
      await expect(h.sql(
        `select app.record_surface_comparison($1,$2,$3,$4,'Typo','e@1', $5::jsonb)`,
        [company, project, existing, design, JSON.stringify({ cut_cy: 10 })]))
        .rejects.toThrow(/no field called cut_cy/);
    });

    it('refuses a volume with no engine version', async () => {
      await expect(h.sql(
        `select app.record_surface_comparison($1,$2,$3,$4,'Anonymous','', '{}'::jsonb)`,
        [company, project, existing, design]))
        .rejects.toThrow(/must record which engine produced it/);
    });

    it('will not let the capture change its datum once a volume is on file', async () => {
      await expect(asOwner(() => h.sql(
        `select public.update_survey($1,null,null,null,null,null,'NGVD29')`, [survey])))
        .rejects.toThrow(/datum, coordinate system and units are fixed/);
    });

    it('still lets the capture be renamed', async () => {
      await asOwner(() => h.sql(
        `select public.update_survey($1,'Rover shot, 3 September')`, [survey]));
      const [row] = await asOwner(() => h.sql<{ name: string }>(
        `select name from surveys where id = $1`, [survey]));
      expect(row!.name).toBe('Rover shot, 3 September');
    });

    it('refuses to delete a surface a volume was computed from', async () => {
      await expect(asOwner(() => h.sql(`select public.remove_surface($1)`, [existing])))
        .rejects.toThrow(/volume "Mass earthwork" was computed from this surface/);
    });
  });

  // -------------------------------------------------------- machine control
  describe('sending a design to a machine', () => {
    const DIGEST = 'a'.repeat(64);
    let file = '';
    let asset = '';
    let assignment = '';
    let replacement = '';
    let currentAssignment = '';

    beforeAll(async () => {
      asset = (await asOwner(() => h.sql<{ id: string }>(
        `insert into assets (company_id, asset_number, name, asset_class, status)
         values ($1,'EX-4412','Cat 336','excavator','available') returning id`, [company])))[0]!.id;
    });

    it('records a file as a draft, never as published', async () => {
      file = (await asOwner(() => h.sql<{ id: string }>(
        `select public.record_machine_control_file($1,'Vale subgrade','ttm',
           'machine/vale-subgrade.ttm',$2,'trimble') as id`, [project, design])))[0]!.id;
      const [row] = await asOwner(() => h.sql<{ status: string; version: number }>(
        `select status, version from machine_control_files where id = $1`, [file]));
      expect(row!.status).toBe('draft');
      expect(Number(row!.version)).toBe(1);
    });

    it('refuses a machine a draft', async () => {
      await expect(asOwner(() => h.sql(
        `select public.send_file_to_machine($1,$2)`, [asset, file])))
        .rejects.toThrow(/a machine is only ever sent a published one/);
    });

    it('refuses to publish a file nobody can verify', async () => {
      await expect(asOwner(() => h.sql(
        `select public.publish_machine_control_file($1)`, [file])))
        .rejects.toThrow(/records the digest of what was published/);
    });

    it('publishes with a digest', async () => {
      await asOwner(() => h.sql(
        `select public.publish_machine_control_file($1,$2)`, [file, DIGEST]));
      const [row] = await asOwner(() => h.sql<{
        status: string; published_by: string | null; checksum_sha256: string;
      }>(`select status, published_by, checksum_sha256
            from machine_control_files where id = $1`, [file]));
      expect(row!.status).toBe('published');
      expect(row!.published_by).toBe(OWNER);
      expect(row!.checksum_sha256).toBe(DIGEST);
    });

    it('freezes the ground the machine is cutting to', async () => {
      // 0048 has refused this since it was written. Nothing could publish, so
      // it had never once fired.
      await expect(asOwner(() => h.sql(
        `update surfaces set elevations = $2::jsonb where id = $1`, [design, flat(90)])))
        .rejects.toThrow(/published to machines as "Vale subgrade"/);
    });

    it('still lets the frozen surface be renamed', async () => {
      await asOwner(() => h.sql(
        `select public.update_surface($1,'Design subgrade, rev A')`, [design]));
      const [row] = await asOwner(() => h.sql<{ name: string; frozen_by_file: string }>(
        `select name, frozen_by_file from my_surfaces where id = $1`, [design]));
      expect(row!.name).toBe('Design subgrade, rev A');
      expect(row!.frozen_by_file).toBe('Vale subgrade');
    });

    it('sends the published file to the machine', async () => {
      assignment = (await asOwner(() => h.sql<{ id: string }>(
        `select public.send_file_to_machine($1,$2) as id`, [asset, file])))[0]!.id;
      const [row] = await asOwner(() => h.sql<{
        asset_number: string; file_name: string; awaiting_acknowledgement: boolean;
      }>(`select asset_number, file_name, awaiting_acknowledgement
            from my_machine_assignments where id = $1`, [assignment]));
      expect(row!.asset_number).toBe('EX-4412');
      expect(row!.file_name).toBe('Vale subgrade');
      expect(row!.awaiting_acknowledgement).toBe(true);
    });

    it('stands the old assignment down rather than holding two', async () => {
      // One current file per machine. An operator holding two designs has no
      // way to know which one the office meant.
      replacement = (await asOwner(() => h.sql<{ id: string }>(
        `select public.record_machine_control_file($1,'Vale subgrade','ttm',
           'machine/vale-subgrade-b.ttm',$2,'trimble') as id`, [project, design])))[0]!.id;
      await asOwner(() => h.sql(
        `select public.publish_machine_control_file($1,$2)`, [replacement, 'b'.repeat(64)]));
      currentAssignment = (await asOwner(() => h.sql<{ id: string }>(
        `select public.send_file_to_machine($1,$2) as id`, [asset, replacement])))[0]!.id;

      const rows = await asOwner(() => h.sql<{ n: string }>(
        `select count(*) as n from machine_assignments
          where asset_id = $1 and is_current`, [asset]));
      expect(Number(rows[0]!.n)).toBe(1);

      const [ver] = await asOwner(() => h.sql<{ version: number }>(
        `select version from machine_control_files where id = $1`, [replacement]));
      expect(Number(ver!.version)).toBe(2);

      await asOwner(() => h.sql(
        `select public.supersede_machine_control_file($1,$2)`, [file, replacement]));
      const [old] = await asOwner(() => h.sql<{ status: string; superseded_by_id: string }>(
        `select status, superseded_by_id from machine_control_files where id = $1`, [file]));
      expect(old!.status).toBe('superseded');
      expect(old!.superseded_by_id).toBe(replacement);
    });

    it('records that the operator has it', async () => {
      await asOwner(() => h.sql(
        `select public.acknowledge_machine_file($1)`, [currentAssignment]));
      const [row] = await asOwner(() => h.sql<{ awaiting_acknowledgement: boolean }>(
        `select awaiting_acknowledgement from my_machine_assignments where id = $1`,
        [currentAssignment]));
      expect(row!.awaiting_acknowledgement).toBe(false);
    });

    it('still lets an operator confirm a design the office has since replaced', async () => {
      // 0048 refused every update naming an unpublished file, which is wider
      // than "a machine is only ever sent a published file" — so a confirmation
      // that arrived after the office moved on was thrown away, and the record
      // went on saying the machine had never been heard from.
      await asOwner(() => h.sql(`select public.acknowledge_machine_file($1)`, [assignment]));
      const [row] = await asOwner(() => h.sql<{
        acknowledged_at: string | null; file_withdrawn_or_superseded: boolean;
      }>(`select acknowledged_at, file_withdrawn_or_superseded
            from my_machine_assignments where id = $1`, [assignment]));
      expect(row!.acknowledged_at).not.toBeNull();
      expect(row!.file_withdrawn_or_superseded).toBe(true);
    });

    it('still refuses to send a design that has been replaced', async () => {
      await expect(asOwner(() => h.sql(
        `select public.send_file_to_machine($1,$2)`, [asset, file])))
        .rejects.toThrow(/That file is superseded/);
    });

    it('and the guard beneath it still refuses one written straight in', async () => {
      // The door says it first and says it better; the guard is what holds if
      // anything ever reaches the table without going through the door.
      await expect(asOwner(() => h.sql(
        `insert into machine_assignments (company_id, asset_id, machine_control_file_id)
         values ($1,$2,$3)`, [company, asset, file])))
        .rejects.toThrow(/A machine runs a published design or none/);
    });

    it('takes a withdrawn design off every machine carrying it', async () => {
      const spare = (await asOwner(() => h.sql<{ id: string }>(
        `insert into assets (company_id, asset_number, name, asset_class, status)
         values ($1,'DZ-2201','Cat D6','dozer','available') returning id`, [company])))[0]!.id;
      const doomed = (await asOwner(() => h.sql<{ id: string }>(
        `select public.record_machine_control_file($1,'North slope','ttm',
           'machine/north-slope.ttm') as id`, [project])))[0]!.id;
      await asOwner(() => h.sql(
        `select public.publish_machine_control_file($1,$2)`, [doomed, 'c'.repeat(64)]));
      await asOwner(() => h.sql(`select public.send_file_to_machine($1,$2)`, [spare, doomed]));

      await asOwner(() => h.sql(`select public.withdraw_machine_control_file($1)`, [doomed]));
      const rows = await asOwner(() => h.sql<{ n: string }>(
        `select count(*) as n from machine_assignments
          where asset_id = $1 and is_current`, [spare]));
      expect(Number(rows[0]!.n)).toBe(0);
    });

    it('refuses a digest that is not one', async () => {
      await expect(asOwner(() => h.sql(
        `select public.record_machine_control_file($1,'Bad digest','ttm','x.ttm',null,null,'nope')`,
        [project]))).rejects.toThrow(/64 lowercase hex characters/);
    });

    it('refuses to delete a surface a machine file was cut from', async () => {
      // Its own surface, so what is being tested is the machine file and not
      // the comparison that also holds the design down.
      const shot = (await asOwner(() => h.sql<{ id: string }>(
        `select public.create_surface($1,'Pad subgrade','subgrade',10,5,5,$2::jsonb,
           null,1500000,700000) as id`, [survey, flat(94)])))[0]!.id;
      await asOwner(() => h.sql(
        `select public.record_machine_control_file($1,'Pad subgrade','ttm',
           'machine/pad.ttm',$2) as id`, [project, shot]));
      await expect(asOwner(() => h.sql(`select public.remove_surface($1)`, [shot])))
        .rejects.toThrow(/was cut from this surface/);
    });
  });

  // ------------------------------------------------------------------ tenancy
  describe('another company', () => {
    const STRANGER = '6e8e8e8e-8e8e-4e8e-8e8e-8e8e8e8e8e8e';

    beforeAll(async () => {
      await h.sql(`insert into auth.users (id, email) values ($1,'s@other.test')`, [STRANGER]);
      await h.sql(`insert into user_profiles (id, email) values ($1,'s@other.test')
                   on conflict (id) do nothing`, [STRANGER]);
      await h.asUser(STRANGER, () => h.sql(
        `select app.provision_company('Other Civil','other-civil','enterprise')`));
    });

    it('cannot record a survey on a project it cannot see', async () => {
      await expect(h.asUser(STRANGER, () => h.sql(
        `select public.record_survey($1,'Theirs')`, [project])))
        .rejects.toThrow(/No such project|do not have permission/);
    });

    it('sees none of another company’s captures', async () => {
      const rows = await h.asUser(STRANGER, () => h.sql(`select id from my_surveys`));
      expect(rows).toHaveLength(0);
    });
  });
});
