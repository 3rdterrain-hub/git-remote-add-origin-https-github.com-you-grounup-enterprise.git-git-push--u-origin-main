/**
 * What a machine is cutting to, against real PostgreSQL.
 *
 * `machine_control_files` is the last link in the chain that starts at a survey
 * and ends at a blade, and it was well modeled: versioned, typed by format and
 * vendor, published with an actor and a moment, superseded rather than
 * replaced, checksummed, assigned to a machine one file at a time.
 *
 * Five things were not enforced, all reproduced before migration 0048 was
 * written: a file could be published with no digest, the surface it was cut
 * from could be edited afterwards, a draft file could be sent to a machine, a
 * superseded file could be sent to a machine, and a supersession chain could
 * close a loop. Each one ends with somebody building to a design nobody can
 * account for.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('a machine runs a published design or none', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  let company = '';
  let project = '';
  let surface = '';
  let dozer = '';
  let n = 0;

  const digest = (c: string) => c.repeat(64).slice(0, 64);

  const file = (opts: Partial<{ status: string; surface: string | null; sum: string | null }> = {}) =>
    h.asUser(owner, () => h.sql<{ id: string; name: string }>(
      `insert into machine_control_files (company_id, project_id, surface_id, name, file_format,
         storage_path, status, published_at, published_by, checksum_sha256)
       values ($1,$2,$3,$4,'ttm','mc/'||$4,$5,
               case when $5 = 'published' then now() end,
               case when $5 = 'published' then $6::uuid end,
               $7)
       returning id, name`,
      [company, project, opts.surface === undefined ? surface : opts.surface,
       `MC-${++n}`, opts.status ?? 'published', owner,
       opts.sum === undefined ? digest('a') : opts.sum])).then(([r]) => r!);

  const assign = (fileId: string, asset = dozer) =>
    h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into machine_assignments (company_id, asset_id, machine_control_file_id)
       values ($1,$2,$3) returning id`, [company, asset, fileId]));

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@r.test')`, [owner]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@r.test') on conflict (id) do nothing`, [owner]);
    company = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
    project = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name, status)
       values ($1,'PRJ-M1','Vale Cut','active') returning id`, [company])))[0]!.id;
    const sv = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into surveys (company_id, project_id, name, captured_on)
       values ($1,$2,'Design model','2026-04-01') returning id`, [company, project])))[0]!.id;
    surface = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into surfaces (company_id, survey_id, name, surface_role, cell_size_ft,
         grid_rows, grid_cols, elevations, origin_easting, origin_northing)
       values ($1,$2,'Subgrade','design',25,10,10,'[1,2,3]'::jsonb,1500000,700000)
       returning id`, [company, sv])))[0]!.id;
    dozer = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into assets (company_id, asset_number, name) values ($1,'DZ-1','D6 Dozer')
       returning id`, [company])))[0]!.id;
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  describe('a published file can be verified', () => {
    it('refuses to publish without a digest', async () => {
      await expect(file({ sum: null })).rejects.toThrow(/mc_published/);
    });

    it('publishes with one', async () => {
      expect((await file()).id).toBeTruthy();
    });

    it('still lets a draft exist without one', async () => {
      // A digest is what publication means, not what a file means.
      expect((await file({ status: 'draft', sum: null })).id).toBeTruthy();
    });
  });

  describe('the surface a published file was cut from stops moving', () => {
    it('refuses a change to its elevations', async () => {
      await file();
      await expect(h.asUser(owner, () => h.sql(
        `update surfaces set elevations='[99,99,99]'::jsonb where id=$1`, [surface])))
        .rejects.toThrow(/was published to machines/);
    });

    it('refuses a change to its georeference', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `update surfaces set origin_easting=1500500 where id=$1`, [surface])))
        .rejects.toThrow(/geometry is fixed/);
    });

    it('refuses a change to its grid', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `update surfaces set cell_size_ft=50 where id=$1`, [surface])))
        .rejects.toThrow(/geometry is fixed/);
    });

    it('still allows a name to be corrected', async () => {
      // What is frozen is what the file was generated from, not the row.
      await h.asUser(owner, () => h.sql(
        `update surfaces set name='Subgrade (rev A)' where id=$1`, [surface]));
      const [s] = await h.asUser(owner, () => h.sql<{ name: string }>(
        `select name from surfaces where id=$1`, [surface]));
      expect(s!.name).toBe('Subgrade (rev A)');
    });

    it('leaves a surface nobody published alone', async () => {
      const sv = (await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into surveys (company_id, project_id, name, captured_on)
         values ($1,$2,'Working','2026-04-02') returning id`, [company, project])))[0]!.id;
      const free = (await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into surfaces (company_id, survey_id, name, surface_role, cell_size_ft,
           grid_rows, grid_cols, elevations, origin_easting, origin_northing)
         values ($1,$2,'Draft surface','design',25,10,10,'[1]'::jsonb,1500000,700000)
         returning id`, [company, sv])))[0]!.id;
      await h.asUser(owner, () => h.sql(
        `update surfaces set elevations='[7]'::jsonb where id=$1`, [free]));
      const [s] = await h.asUser(owner, () => h.sql<{ elevations: unknown }>(
        `select elevations from surfaces where id=$1`, [free]));
      expect(s!.elevations).toEqual([7]);
    });
  });

  describe('what may be sent to a machine', () => {
    it('refuses a draft file', async () => {
      const f = await file({ status: 'draft', sum: null });
      await expect(assign(f.id)).rejects.toThrow(/is draft and cannot be sent/);
    });

    it('refuses a withdrawn file', async () => {
      const f = await file({ status: 'withdrawn', sum: null });
      await expect(assign(f.id)).rejects.toThrow(/is withdrawn and cannot be sent/);
    });

    it('names the machine it refused to send to', async () => {
      const f = await file({ status: 'draft', sum: null });
      await expect(assign(f.id)).rejects.toThrow(/DZ-1 D6 Dozer/);
    });

    it('accepts a published file', async () => {
      const f = await file();
      expect((await assign(f.id))[0]!.id).toBeTruthy();
    });
  });

  describe('a revision chain has to end somewhere', () => {
    it('refuses a supersession loop', async () => {
      const a = await file();
      const b = await file();
      await h.asUser(owner, () => h.sql(
        `update machine_control_files set status='superseded', superseded_by_id=$2 where id=$1`,
        [a.id, b.id]));
      await expect(h.asUser(owner, () => h.sql(
        `update machine_control_files set status='superseded', superseded_by_id=$1 where id=$2`,
        [a.id, b.id]))).rejects.toThrow(/would close a loop/);
    });

    it('allows a straight chain', async () => {
      const a = await file();
      const b = await file();
      const c = await file();
      await h.asUser(owner, () => h.sql(
        `update machine_control_files set status='superseded', superseded_by_id=$2 where id=$1`,
        [a.id, b.id]));
      await h.asUser(owner, () => h.sql(
        `update machine_control_files set status='superseded', superseded_by_id=$2 where id=$1`,
        [b.id, c.id]));
      const [row] = await h.asUser(owner, () => h.sql<{ status: string }>(
        `select status from machine_control_files where id=$1`, [b.id]));
      expect(row!.status).toBe('superseded');
    });
  });

  describe('machines still running a design that was replaced', () => {
    it('says which ones, loudly', async () => {
      const excavator = (await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into assets (company_id, asset_number, name) values ($1,'EX-1','345 Excavator')
         returning id`, [company])))[0]!.id;
      const old = await file();
      const replacement = await file();
      await assign(old.id, excavator);

      await h.asUser(owner, () => h.sql(
        `update machine_control_files set status='superseded', superseded_by_id=$2 where id=$1`,
        [old.id, replacement.id]));

      const [note] = await h.asUser(owner, () => h.sql<{ severity: string; body: string }>(
        `select severity, body from notifications
         where entity_table='public.machine_control_files' and entity_id=$1`, [old.id]));
      expect(note!.severity).toBe('critical');
      expect(note!.body).toContain('EX-1 345 Excavator');
    });

    it('says nothing when no machine was on it', async () => {
      // A notice on every supersession is how people learn to ignore notices.
      const a = await file();
      const b = await file();
      await h.asUser(owner, () => h.sql(
        `update machine_control_files set status='superseded', superseded_by_id=$2 where id=$1`,
        [a.id, b.id]));
      expect(await h.asUser(owner, () => h.sql(
        `select 1 from notifications where entity_id=$1`, [a.id]))).toEqual([]);
    });
  });
});
