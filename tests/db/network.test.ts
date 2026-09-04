import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * Survey, machine control, claims, the vendor network and the API surface.
 *
 * The network tests matter most: these are the first tables in the platform
 * that are deliberately readable across tenants, so the boundary has to be
 * exactly where consent and publication put it — and nowhere else.
 */
describe('survey, claims, network and API', () => {
  let h: Harness;
  const alice = '11111111-1111-4111-8111-111111111111';
  const bob = '22222222-2222-4222-8222-222222222222';
  let ridgeline = '';
  let kesler = '';
  let project = '';
  let survey = '';
  let existingSurface = '';
  let designSurface = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'a@r.test'), ($2,'b@k.test')`, [alice, bob]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'a@r.test'), ($2,'b@k.test')`, [alice, bob]);
    ridgeline = (await h.asUser(alice, () =>
      h.sql<{ id: string }>(`select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
    kesler = (await h.asUser(bob, () =>
      h.sql<{ id: string }>(`select app.provision_company('Kesler','kesler','enterprise') as id`)))[0]!.id;

    await h.asUser(alice, async () => {
      project = (await h.sql<{ id: string }>(
        `insert into projects (company_id, number, name) values ($1,'PRJ-1','Test') returning id`,
        [ridgeline]))[0]!.id;
      survey = (await h.sql<{ id: string }>(
        `insert into surveys (company_id, project_id, name, captured_on, vertical_datum)
         values ($1,$2,'Pre-construction topo','2026-05-01','NAVD88') returning id`,
        [ridgeline, project]))[0]!.id;
      existingSurface = (await h.sql<{ id: string }>(
        `insert into surfaces (company_id, survey_id, name, surface_role, cell_size_ft, grid_rows, grid_cols,
           elevations, origin_easting, origin_northing)
         values ($1,$2,'Existing ground','existing',25,10,10,'[]'::jsonb,1500000,700000) returning id`,
        [ridgeline, survey]))[0]!.id;
      designSurface = (await h.sql<{ id: string }>(
        `insert into surfaces (company_id, survey_id, name, surface_role, cell_size_ft, grid_rows, grid_cols,
           elevations, origin_easting, origin_northing)
         values ($1,$2,'Design subgrade','design',25,10,10,'[]'::jsonb,1500000,700000) returning id`,
        [ridgeline, survey]))[0]!.id;
    });
  });

  afterAll(async () => { await h?.db.close(); });

  // ------------------------------------------------------------------ surfaces
  describe('surface comparison', () => {
    it('accepts a comparison of two surfaces on the same grid and datum', async () => {
      const rows = await h.asUser(alice, () =>
        h.sql<{ id: string }>(
          `insert into surface_comparisons (company_id, project_id, existing_surface_id, design_surface_id, name, cut_bcy, fill_ccy)
           values ($1,$2,$3,$4,'Mass earthwork',43054,31600) returning id`,
          [ridgeline, project, existingSurface, designSurface]));
      expect(rows).toHaveLength(1);
    });

    it('refuses to compare a surface with itself', async () => {
      await expect(
        h.asUser(alice, () =>
          h.sql(`insert into surface_comparisons (company_id, project_id, existing_surface_id, design_surface_id, name)
                 values ($1,$2,$3,$3,'Self')`, [ridgeline, project, existingSurface])),
      ).rejects.toThrow(/surface_comparisons_distinct/);
    });

    it('refuses a comparison across mismatched vertical datums', async () => {
      // A volume computed across two datums is wrong by the offset and looks
      // entirely plausible — which is exactly why it must be refused.
      const other = await h.asUser(alice, async () => {
        const sv = await h.sql<{ id: string }>(
          `insert into surveys (company_id, project_id, name, captured_on, vertical_datum)
           values ($1,$2,'Drone flight','2026-08-01','NGVD29') returning id`, [ridgeline, project]);
        return (await h.sql<{ id: string }>(
          `insert into surfaces (company_id, survey_id, name, surface_role, cell_size_ft, grid_rows, grid_cols,
             elevations, origin_easting, origin_northing)
           values ($1,$2,'As-built','as_built',25,10,10,'[]'::jsonb,1500000,700000) returning id`,
          [ridgeline, sv[0]!.id]))[0]!.id;
      });
      await expect(
        h.asUser(alice, () =>
          h.sql(`insert into surface_comparisons (company_id, project_id, existing_surface_id, design_surface_id, name)
                 values ($1,$2,$3,$4,'Cross-datum')`, [ridgeline, project, other, designSurface])),
      ).rejects.toThrow(/different vertical datums \(NGVD29 and NAVD88\)/);
    });

    it('refuses a comparison across mismatched grids', async () => {
      const coarse = await h.asUser(alice, () =>
        h.sql<{ id: string }>(
          `insert into surfaces (company_id, survey_id, name, surface_role, cell_size_ft, grid_rows, grid_cols,
             elevations, origin_easting, origin_northing)
           values ($1,$2,'Coarse','design',50,10,10,'[]'::jsonb,1500000,700000) returning id`,
          [ridgeline, survey]));
      await expect(
        h.asUser(alice, () =>
          h.sql(`insert into surface_comparisons (company_id, project_id, existing_surface_id, design_surface_id, name)
                 values ($1,$2,$3,$4,'Mismatched grid')`, [ridgeline, project, existingSurface, coarse[0]!.id])),
      ).rejects.toThrow(/must share a grid/);
    });

    it('requires a surface to carry either inline data or a storage path', async () => {
      await expect(
        h.asUser(alice, () =>
          h.sql(`insert into surfaces (company_id, survey_id, name, surface_role, cell_size_ft, grid_rows, grid_cols)
                 values ($1,$2,'Empty','design',25,10,10)`, [ridgeline, survey])),
      ).rejects.toThrow(/surfaces_has_data/);
    });
  });

  // ------------------------------------------------------------ machine control
  describe('machine control', () => {
    let file = '';
    it('requires a publisher on a published design', async () => {
      await expect(
        h.asUser(alice, () =>
          h.sql(`insert into machine_control_files (company_id, project_id, name, file_format, storage_path, status)
                 values ($1,$2,'Subgrade v1','ttm','mc/subgrade-v1.ttm','published')`, [ridgeline, project])),
      ).rejects.toThrow(/mc_published/);
    });

    it('requires a digest on a published design', async () => {
      // Since migration 0048. Without it there is no way to show that the file
      // on the machine is the file that was approved, which is the only reason
      // to record a checksum at all.
      await expect(
        h.asUser(alice, () =>
          h.sql(`insert into machine_control_files (company_id, project_id, name, file_format, storage_path, status, published_at, published_by)
                 values ($1,$2,'No digest','ttm','mc/nodigest.ttm','published', now(), $3)`,
            [ridgeline, project, alice])),
      ).rejects.toThrow(/mc_published/);
    });

    it('publishes with the person who did it and the digest recorded', async () => {
      const rows = await h.asUser(alice, () =>
        h.sql<{ id: string }>(
          `insert into machine_control_files (company_id, project_id, name, file_format, storage_path,
             status, published_at, published_by, checksum_sha256)
           values ($1,$2,'Subgrade v1','ttm','mc/subgrade-v1.ttm','published', now(), $3,
                   repeat('a',64)) returning id`,
          [ridgeline, project, alice]));
      file = rows[0]!.id;
      expect(file).toBeTruthy();
    });

    it('requires a superseded design to name its replacement', async () => {
      // Otherwise an operator cannot be told which file is current, and builds
      // last week's grade.
      await expect(
        h.asUser(alice, () =>
          h.sql(`update machine_control_files set status='superseded' where id=$1`, [file])),
      ).rejects.toThrow(/mc_superseded/);
    });

    it('allows only one current assignment per machine', async () => {
      const asset = (await h.asUser(alice, () =>
        h.sql<{ id: string }>(
          `insert into assets (company_id, asset_number, name) values ($1,'DZ-1','Dozer') returning id`,
          [ridgeline])))[0]!.id;
      await h.asUser(alice, () =>
        h.sql(`insert into machine_assignments (company_id, asset_id, machine_control_file_id)
               values ($1,$2,$3)`, [ridgeline, asset, file]));
      await expect(
        h.asUser(alice, () =>
          h.sql(`insert into machine_assignments (company_id, asset_id, machine_control_file_id)
                 values ($1,$2,$3)`, [ridgeline, asset, file])),
      ).rejects.toThrow(/duplicate key/);
    });
  });

  // -------------------------------------------------------------------- claims
  describe('claims', () => {
    let contract = '';
    let claim = '';

    it('derives the notice deadline from the contract clause', async () => {
      contract = (await h.asUser(alice, () =>
        h.sql<{ id: string }>(
          `insert into contracts (company_id, project_id, number, title, status, executed_on, notice_days, claim_days)
           values ($1,$2,'C-1','Prime contract','executed','2026-04-15',7,30) returning id`,
          [ridgeline, project])))[0]!.id;

      const [c] = await h.asUser(alice, () =>
        h.sql<{ id: string; notice_due_on: string; claim_due_on: string }>(
          `insert into claims (company_id, project_id, contract_id, number, title, claim_type, description, event_date)
           values ($1,$2,$3,'CL-1','Differing site condition','differing_site_condition','Saturated clay','2026-08-20')
           returning id, notice_due_on, claim_due_on`, [ridgeline, project, contract]));
      claim = c!.id;
      // 20 August + 7 days, and + 30 days. The driver returns `date` columns as
      // Date objects, so compare the calendar day rather than a string.
      const iso = (d: unknown) => new Date(d as string).toISOString().slice(0, 10);
      expect(iso(c!.notice_due_on)).toBe('2026-08-27');
      expect(iso(c!.claim_due_on)).toBe('2026-09-19');
    });

    it('refuses to advance a claim past potential without a notice date', async () => {
      // Most construction claims are lost on the notice clause, not the merits.
      await expect(
        h.asUser(alice, () => h.sql(`update claims set status='submitted' where id=$1`, [claim])),
      ).rejects.toThrow(/claims_notice/);
    });

    it('accepts a claim once notice is recorded', async () => {
      await h.asUser(alice, () =>
        h.sql(`update claims set status='notice_given', notice_given_on='2026-08-25' where id=$1`, [claim]));
      const [c] = await h.sql<{ status: string }>(`select status from claims where id=$1`, [claim]);
      expect(c!.status).toBe('notice_given');
    });

    it('refuses a notice dated before the event it concerns', async () => {
      await expect(
        h.asUser(alice, () =>
          h.sql(`update claims set notice_given_on='2026-08-01' where id=$1`, [claim])),
      ).rejects.toThrow(/claims_notice_order/);
    });

    it('requires a resolution when a claim is settled or denied', async () => {
      await expect(
        h.asUser(alice, () => h.sql(`update claims set status='settled' where id=$1`, [claim])),
      ).rejects.toThrow(/claims_resolved/);
    });
  });

  // ------------------------------------------------------------------- network
  describe('the vendor network', () => {
    let listing = '';

    it('refuses to publish a listing with no recorded consent', async () => {
      // Publishing a subcontractor's details because you happen to have them is
      // not a product feature.
      await expect(
        h.asUser(alice, () =>
          h.sql(`insert into network_vendors (owner_company_id, legal_name, display_name, is_published)
                 values ($1,'Buckeye Dewatering LLC','Buckeye Dewatering', true)`, [ridgeline])),
      ).rejects.toThrow(/network_vendors_consent/);
    });

    it('keeps an unpublished draft private to the owning company', async () => {
      const rows = await h.asUser(alice, () =>
        h.sql<{ id: string }>(
          `insert into network_vendors (owner_company_id, legal_name, display_name, trades)
           values ($1,'Buckeye Dewatering LLC','Buckeye Dewatering', array['Dewatering']) returning id`,
          [ridgeline]));
      listing = rows[0]!.id;
      const mine = await h.asUser(alice, () => h.sql(`select id from network_vendors where id=$1`, [listing]));
      const theirs = await h.asUser(bob, () => h.sql(`select id from network_vendors where id=$1`, [listing]));
      expect(mine).toHaveLength(1);
      expect(theirs).toEqual([]);
    });

    it('makes a published listing visible to another company', async () => {
      await h.asUser(alice, () =>
        h.sql(`update network_vendors set is_published=true, published_at=now(),
               consent_recorded_by=$1, consent_recorded_at=now() where id=$2`, [alice, listing]));
      const theirs = await h.asUser(bob, () =>
        h.sql<{ display_name: string }>(`select display_name from network_vendors where id=$1`, [listing]));
      expect(theirs).toHaveLength(1);
      expect(theirs[0]!.display_name).toBe('Buckeye Dewatering');
    });

    it('does not let another company edit a listing it does not own', async () => {
      await h.asUser(bob, () =>
        h.sql(`update network_vendors set display_name='Hijacked' where id=$1`, [listing]));
      const [row] = await h.sql<{ display_name: string }>(
        `select display_name from network_vendors where id=$1`, [listing]);
      expect(row!.display_name).toBe('Buckeye Dewatering');
    });

    it('lets another company rate a published listing', async () => {
      const rows = await h.asUser(bob, () =>
        h.sql<{ overall: string }>(
          `insert into network_ratings (network_vendor_id, rating_company_id, quality, schedule, safety, communication, would_hire_again, rated_by)
           values ($1,$2,5,4,5,4,true,$3) returning overall`, [listing, kesler, bob]));
      expect(Number(rows[0]!.overall)).toBe(4.5);
    });

    it('refuses a rating left on behalf of another company', async () => {
      await expect(
        h.asUser(bob, () =>
          h.sql(`insert into network_ratings (network_vendor_id, rating_company_id, quality, schedule, safety, communication, would_hire_again)
                 values ($1,$2,1,1,1,1,false)`, [listing, ridgeline])),
      ).rejects.toThrow(/row-level security/i);
    });

    it('refuses a second rating from the same company, even with no project attached', async () => {
      // Without NULLS NOT DISTINCT a company could leave unlimited ratings for
      // one vendor simply by never attaching a project.
      await expect(
        h.asUser(bob, () =>
          h.sql(`insert into network_ratings (network_vendor_id, rating_company_id, quality, schedule, safety, communication, would_hire_again)
                 values ($1,$2,3,3,3,3,true)`, [listing, kesler])),
      ).rejects.toThrow(/duplicate key|network_ratings_one_per_project/);
    });

    it('allows the same company to rate the same vendor once per project', async () => {
      const p1 = (await h.asUser(bob, () =>
        h.sql<{ id: string }>(
          `insert into projects (company_id, number, name) values ($1,'K-1','Kesler job') returning id`,
          [kesler])))[0]!.id;
      const rows = await h.asUser(bob, () =>
        h.sql<{ id: string }>(
          `insert into network_ratings (network_vendor_id, rating_company_id, project_id, quality, schedule, safety, communication, would_hire_again)
           values ($1,$2,$3,4,4,4,4,true) returning id`, [listing, kesler, p1]));
      expect(rows).toHaveLength(1);
    });

    it('makes a rating immutable once left', async () => {
      // An editable rating is worth nothing to the contractor reading it.
      await expect(
        h.sql(`update network_ratings set quality=1 where rating_company_id=$1`, [kesler]),
      ).rejects.toThrow(/append-only/);
    });

    it('bounds every rating dimension to 1-5', async () => {
      await expect(
        h.asUser(bob, () =>
          h.sql(`insert into network_ratings (network_vendor_id, rating_company_id, project_id, quality, schedule, safety, communication, would_hire_again)
                 values ($1,$2,null,9,3,3,3,true)`, [listing, kesler])),
      ).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------- API keys
  describe('API keys', () => {
    const hash = 'a'.repeat(64);
    let key = '';

    it('requires at least one scope', async () => {
      await expect(
        h.asUser(alice, () =>
          h.sql(`insert into api_keys (company_id, name, key_hash, key_prefix)
                 values ($1,'CI',$2,'gu_live_AbCdEfGh')`, [ridgeline, hash])),
      ).rejects.toThrow(/api_keys_scopes_not_empty/);
    });

    it('stores only a hash and a display prefix', async () => {
      const rows = await h.asUser(alice, () =>
        h.sql<{ id: string; key_prefix: string }>(
          `insert into api_keys (company_id, name, key_hash, key_prefix, scopes)
           values ($1,'CI',$2,'gu_live_AbCdEfGh', array['estimates.read','projects.read'])
           returning id, key_prefix`, [ridgeline, hash]));
      key = rows[0]!.id;
      expect(rows[0]!.key_prefix).toBe('gu_live_AbCdEfGh');
    });

    it('refuses a malformed prefix', async () => {
      await expect(
        h.asUser(alice, () =>
          h.sql(`insert into api_keys (company_id, name, key_hash, key_prefix, scopes)
                 values ($1,'Bad',$2,'not-a-prefix', array['estimates.read'])`, [ridgeline, 'b'.repeat(64)])),
      ).rejects.toThrow();
    });

    it('cannot be rewritten in place — rotation issues a new key', async () => {
      await expect(
        h.asUser(alice, () =>
          h.sql(`update api_keys set key_hash=$1 where id=$2`, ['c'.repeat(64), key])),
      ).rejects.toThrow(/cannot be rewritten in place/);
    });

    it('requires a reason when revoked', async () => {
      await expect(
        h.asUser(alice, () => h.sql(`update api_keys set revoked_at=now() where id=$1`, [key])),
      ).rejects.toThrow(/api_keys_revoked/);

      await h.asUser(alice, () =>
        h.sql(`update api_keys set revoked_at=now(), revoked_by=$1, revoke_reason='Rotated for the quarterly review'
               where id=$2`, [alice, key]));
      const [k] = await h.sql<{ revoke_reason: string }>(`select revoke_reason from api_keys where id=$1`, [key]);
      expect(k!.revoke_reason).toContain('Rotated');
    });

    it('is not visible to another company', async () => {
      const seen = await h.asUser(bob, () => h.sql(`select id from api_keys where company_id=$1`, [ridgeline]));
      expect(seen).toEqual([]);
    });
  });
});
