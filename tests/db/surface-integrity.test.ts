/**
 * What has to agree before a volume between two surfaces means anything.
 *
 * `app.enforce_surface_datum_match()` was written because "a volume computed
 * between two surfaces on different vertical datums is wrong by the offset and
 * looks entirely plausible." That reasoning is right and it stopped three
 * checks short.
 *
 * A surface had no origin at all, so "sharing a grid" meant sharing a *shape*:
 * two 10x10 grids at 25 feet, one over the north end of a site and one over the
 * south, passed every check and produced a fictitious cut and fill. The
 * horizontal datum and coordinate system were never compared though the
 * vertical one was. And neither surface had to belong to the project the
 * comparison was filed under.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('a surface comparison is between comparable surfaces', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  let company = '';
  let project = '';
  let other = '';
  let n = 0;

  const survey = (opts: Partial<{
    project: string; vertical: string; horizontal: string; crs: string | null; units: string }> = {}) =>
    h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into surveys (company_id, project_id, name, captured_on,
         vertical_datum, horizontal_datum, coordinate_system, units)
       values ($1,$2,$3,'2026-04-01',$4,$5,$6,$7) returning id`,
      [company, opts.project ?? project, `SV-${++n}`,
       opts.vertical ?? 'NAVD88', opts.horizontal ?? 'NAD83',
       // Key presence, not `??` — an explicit null is the case under test.
       'crs' in opts ? opts.crs : 'CA83-III',
       opts.units ?? 'us_survey_feet'])).then(([r]) => r!.id);

  const surface = (surveyId: string, opts: Partial<{
    role: string; cell: number; east: number | null; north: number | null }> = {}) =>
    h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into surfaces (company_id, survey_id, name, surface_role, cell_size_ft,
         grid_rows, grid_cols, elevations, origin_easting, origin_northing)
       values ($1,$2,$3,$4,$5,10,10,'[]'::jsonb,$6,$7) returning id`,
      [company, surveyId, `SF-${++n}`, opts.role ?? 'existing', opts.cell ?? 25,
       opts.east === undefined ? 1500000 : opts.east,
       opts.north === undefined ? 700000 : opts.north])).then(([r]) => r!.id);

  const compare = (a: string, b: string, proj = project) =>
    h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into surface_comparisons (company_id, project_id, existing_surface_id,
         design_surface_id, name)
       values ($1,$2,$3,$4,$5) returning id`, [company, proj, a, b, `CMP-${++n}`]));

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@r.test')`, [owner]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@r.test') on conflict (id) do nothing`, [owner]);
    company = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
    const p = await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name, status)
       values ($1,'PRJ-S1','Vale Cut','active'), ($1,'PRJ-S2','North Fork','active')
       returning id`, [company]));
    project = p[0]!.id;
    other = p[1]!.id;
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  it('accepts two surfaces that agree on everything', async () => {
    const sv = await survey();
    const rows = await compare(await surface(sv), await surface(sv, { role: 'design' }));
    expect(rows[0]!.id).toBeTruthy();
  });

  describe('the georeference', () => {
    it('refuses a surface with no origin', async () => {
      // A grid with no origin is a shape rather than a place.
      const sv = await survey();
      const anchored = await surface(sv);
      const floating = await surface(sv, { role: 'design', east: null, north: null });
      await expect(compare(anchored, floating)).rejects.toThrow(/has no georeference/);
    });

    it('refuses two grids of the same shape over different ground', async () => {
      // The defect in one case: same cell size, same rows and columns, five
      // hundred feet apart.
      const sv = await survey();
      const north = await surface(sv);
      const south = await surface(sv, { role: 'design', north: 699500 });
      await expect(compare(north, south)).rejects.toThrow(/start at different places/);
    });

    it('refuses half a georeference on the surface itself', async () => {
      const sv = await survey();
      await expect(surface(sv, { east: 1500000, north: null }))
        .rejects.toThrow(/surfaces_origin_complete/);
    });
  });

  describe('the reference frame', () => {
    it('still refuses different vertical datums', async () => {
      const a = await surface(await survey());
      const b = await surface(await survey({ vertical: 'NGVD29' }), { role: 'design' });
      await expect(compare(a, b)).rejects.toThrow(/different vertical datums/);
    });

    it('refuses different horizontal datums', async () => {
      // NAD27 and NAD83 differ by tens of meters in places, so two grids on
      // them do not cover the same ground even reading the same coordinates.
      const a = await surface(await survey());
      const b = await surface(await survey({ horizontal: 'NAD27' }), { role: 'design' });
      await expect(compare(a, b)).rejects.toThrow(/different horizontal datums/);
    });

    it('refuses different coordinate systems', async () => {
      const a = await surface(await survey());
      const b = await surface(await survey({ crs: 'CA83-IV' }), { role: 'design' });
      await expect(compare(a, b)).rejects.toThrow(/different coordinate systems/);
    });

    it('names an unstated coordinate system rather than printing nothing', async () => {
      const a = await surface(await survey());
      const b = await surface(await survey({ crs: null }), { role: 'design' });
      await expect(compare(a, b)).rejects.toThrow(/unstated/);
    });

    it('still refuses different units', async () => {
      const a = await surface(await survey());
      const b = await surface(await survey({ units: 'meters' }), { role: 'design' });
      await expect(compare(a, b)).rejects.toThrow(/different units/);
    });

    it('still refuses a mismatched grid', async () => {
      const sv = await survey();
      await expect(compare(await surface(sv), await surface(sv, { role: 'design', cell: 50 })))
        .rejects.toThrow(/must share a grid/);
    });
  });

  describe('the project it is filed under', () => {
    it('refuses a surface from another project', async () => {
      // One site's ground differenced against another site's design.
      const mine = await surface(await survey());
      const theirs = await surface(await survey({ project: other }), { role: 'design' });
      await expect(compare(mine, theirs)).rejects.toThrow(/must belong to the project/);
    });

    it('refuses a comparison filed under a third project', async () => {
      const sv = await survey();
      const a = await surface(sv);
      const b = await surface(sv, { role: 'design' });
      await expect(compare(a, b, other)).rejects.toThrow(/must belong to the project/);
    });
  });
});
