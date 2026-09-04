/**
 * Library snapshots, against real PostgreSQL.
 *
 * The engine half proves a snapshotted estimate reproduces its price. This
 * half proves the database will not let the guarantee be broken: a snapshot
 * cannot be edited, an issued version cannot exist without one, and a snapshot
 * outlives the library rows it captured.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('library snapshots', () => {
  let h: Harness;
  const alice = '11111111-1111-4111-8111-111111111111';
  const bob = '22222222-2222-4222-8222-222222222222';
  let ridgeline = '';
  let kesler = '';
  let estimate = '';
  let version = '';
  let laborRateId = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'a@r.test'), ($2,'b@k.test')`, [alice, bob]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'a@r.test'), ($2,'b@k.test')`, [alice, bob]);
    ridgeline = (await h.asUser(alice, () =>
      h.sql<{ id: string }>(`select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
    kesler = (await h.asUser(bob, () =>
      h.sql<{ id: string }>(`select app.provision_company('Kesler','kesler','enterprise') as id`)))[0]!.id;

    await h.asUser(alice, async () => {
      laborRateId = (await h.sql<{ id: string }>(
        // Draft: a live company library row must name its approver (0028).
        `insert into labor_rates (company_id, code, classification, base_wage_per_hour, burden_percent, status)
         values ($1,'OP1','Operator I',40,0.35,'draft') returning id`, [ridgeline]))[0]!.id;
      estimate = (await h.sql<{ id: string }>(
        `insert into estimates (company_id, number, name) values ($1,'EST-700','Snapshot test')
         returning id`, [ridgeline]))[0]!.id;
      version = (await h.sql<{ id: string }>(
        `insert into estimate_versions (company_id, estimate_id, version_number, status)
         values ($1,$2,1,'draft') returning id`, [ridgeline, estimate]))[0]!.id;
    });
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  const capture = (versionId: string, company = ridgeline, digest = '0123456789abcdef') =>
    h.asUser(alice, () => h.sql<{ id: string }>(
      `insert into library_snapshots (company_id, estimate_version_id, engine_version, entry_count, digest)
       values ($1,$2,'1.0.0',1,$3) returning id`, [company, versionId, digest]));

  // ------------------------------------------------------------ the guarantee
  describe('an issued version must carry the snapshot that priced it', () => {
    it('refuses to issue a version with no snapshot', async () => {
      // An issued price the platform cannot reproduce is not a record of
      // anything.
      await expect(h.asUser(alice, () => h.sql(
        `update estimate_versions set status='issued', issued_at=now(), issued_by=$2 where id=$1`,
        [version, alice]))).rejects.toThrow(/without a library snapshot/);
    });

    it('allows a draft version with no snapshot', async () => {
      const rows = await h.asUser(alice, () => h.sql<{ status: string }>(
        `select status from estimate_versions where id = $1`, [version]));
      expect(rows[0]!.status).toBe('draft');
    });

    it('issues once the snapshot exists', async () => {
      const snap = (await capture(version))[0]!.id;
      await h.asUser(alice, () => h.sql(
        `update estimate_versions set library_snapshot_id=$2 where id=$1`, [version, snap]));
      await h.asUser(alice, () => h.sql(
        `update estimate_versions set status='issued', issued_at=now(), issued_by=$2 where id=$1`,
        [version, alice]));
      const rows = await h.asUser(alice, () => h.sql<{ status: string }>(
        `select status from estimate_versions where id = $1`, [version]));
      expect(rows[0]!.status).toBe('issued');
    });

    it('refuses a snapshot that belongs to another version', async () => {
      const other = await h.asUser(alice, async () => {
        const v = (await h.sql<{ id: string }>(
          `insert into estimate_versions (company_id, estimate_id, version_number, status)
           values ($1,$2,2,'draft') returning id`, [ridgeline, estimate]))[0]!.id;
        return v;
      });
      const foreign = (await capture(other))[0]!.id;
      const third = await h.asUser(alice, () => h.sql<{ id: string }>(
        `insert into estimate_versions (company_id, estimate_id, version_number, status)
         values ($1,$2,3,'draft') returning id`, [ridgeline, estimate]));
      // Pointing a version at another version's snapshot would reproduce the
      // wrong estimate.
      await expect(h.asUser(alice, () => h.sql(
        `update estimate_versions set library_snapshot_id=$2 where id=$1`,
        [third[0]!.id, foreign]))).rejects.toThrow(/does not belong to estimate version/);
    });

    it('allows only one snapshot per version', async () => {
      await expect(capture(version)).rejects.toThrow();
    });
  });

  // ------------------------------------------------------------- immutability
  describe('a snapshot cannot be edited', () => {
    let snapshot = '';
    let entry = '';

    beforeAll(async () => {
      snapshot = (await h.asUser(alice, () => h.sql<{ id: string }>(
        `select id from library_snapshots where estimate_version_id = $1`, [version])))[0]!.id;
      entry = (await h.asUser(alice, () => h.sql<{ id: string }>(
        `insert into library_snapshot_entries
           (company_id, snapshot_id, kind, source_id, source_updated_at, scope, payload)
         values ($1,$2,'labor_rate',$3, now(), 'company', $4::jsonb) returning id`,
        [ridgeline, snapshot, laborRateId, JSON.stringify({ base_wage_per_hour: 40 })])))[0]!.id;
    });

    it('refuses to update a snapshot header', async () => {
      await expect(h.asUser(alice, () => h.sql(
        `update library_snapshots set digest='ffffffffffffffff' where id=$1`, [snapshot])))
        .rejects.toThrow(/append-only/);
    });

    it('refuses to update a captured row', async () => {
      // A snapshot that can be edited is not a snapshot.
      await expect(h.asUser(alice, () => h.sql(
        `update library_snapshot_entries set payload='{"base_wage_per_hour":99}'::jsonb where id=$1`, [entry])))
        .rejects.toThrow(/append-only/);
    });

    it('refuses to delete a captured row', async () => {
      await expect(h.asUser(alice, () => h.sql(
        `delete from library_snapshot_entries where id=$1`, [entry])))
        .rejects.toThrow(/append-only/);
    });

    it('refuses a payload that is not an object', async () => {
      await expect(h.asUser(alice, () => h.sql(
        `insert into library_snapshot_entries
           (company_id, snapshot_id, kind, source_id, source_updated_at, scope, payload)
         values ($1,$2,'task',gen_random_uuid(), now(), 'platform', '"not an object"'::jsonb)`,
        [ridgeline, snapshot]))).rejects.toThrow(/payload_object/);
    });

    it('refuses the same library row captured twice in one snapshot', async () => {
      await expect(h.asUser(alice, () => h.sql(
        `insert into library_snapshot_entries
           (company_id, snapshot_id, kind, source_id, source_updated_at, scope, payload)
         values ($1,$2,'labor_rate',$3, now(), 'company', '{}'::jsonb)`,
        [ridgeline, snapshot, laborRateId]))).rejects.toThrow();
    });
  });

  // --------------------------------------------------- outliving the library
  describe('a snapshot outlives the rows it captured', () => {
    it('keeps the captured payload after the library row is deleted', async () => {
      const before = await h.asUser(alice, () => h.sql<{ payload: unknown }>(
        `select payload from library_snapshot_entries where source_id = $1`, [laborRateId]));
      expect(before).toHaveLength(1);

      await h.asService(() => h.sql(`delete from labor_rates where id = $1`, [laborRateId]));

      const after = await h.asUser(alice, () => h.sql<{ payload: Record<string, unknown> }>(
        `select payload from library_snapshot_entries where source_id = $1`, [laborRateId]));
      // Copying rather than referencing is the whole point: a deleted rate
      // would otherwise make an old estimate unreproducible exactly when
      // somebody needs to defend it.
      expect(after).toHaveLength(1);
      expect(after[0]!.payload).toEqual({ base_wage_per_hour: 40 });
    });

    it('reports the deleted row as drift rather than skipping it', async () => {
      const snapshot = (await h.asUser(alice, () => h.sql<{ id: string }>(
        `select id from library_snapshots where estimate_version_id = $1`, [version])))[0]!.id;
      const drift = await h.asUser(alice, () => h.sql<{ kind: string; status: string }>(
        `select kind, status from app.snapshot_drift($1)`, [snapshot]));
      expect(drift).toHaveLength(1);
      expect(drift[0]!.status).toBe('deleted');
    });
  });

  // ------------------------------------------------------------- drift report
  describe('drift against the live library', () => {
    let snapshot = '';
    let rateId = '';

    beforeAll(async () => {
      await h.asUser(alice, async () => {
        rateId = (await h.sql<{ id: string }>(
          `insert into labor_rates (company_id, code, classification, base_wage_per_hour, burden_percent, status)
           values ($1,'OP2','Operator II',42,0.35,'draft') returning id`, [ridgeline]))[0]!.id;
        const v = (await h.sql<{ id: string }>(
          `insert into estimate_versions (company_id, estimate_id, version_number, status)
           values ($1,$2,10,'draft') returning id`, [ridgeline, estimate]))[0]!.id;
        snapshot = (await h.sql<{ id: string }>(
          `insert into library_snapshots (company_id, estimate_version_id, engine_version, entry_count, digest)
           values ($1,$2,'1.0.0',1,'abcdef0123456789') returning id`, [ridgeline, v]))[0]!.id;
        const updatedAt = (await h.sql<{ updated_at: string }>(
          `select updated_at from labor_rates where id = $1`, [rateId]))[0]!.updated_at;
        await h.sql(
          `insert into library_snapshot_entries
             (company_id, snapshot_id, kind, source_id, source_updated_at, scope, payload)
           values ($1,$2,'labor_rate',$3,$4,'company',$5::jsonb)`,
          [ridgeline, snapshot, rateId, updatedAt, JSON.stringify({ base_wage_per_hour: 42 })]);
      });
    });

    it('reports unchanged when the library has not moved', async () => {
      const drift = await h.asUser(alice, () => h.sql<{ status: string }>(
        `select status from app.snapshot_drift($1)`, [snapshot]));
      expect(drift[0]!.status).toBe('unchanged');
    });

    it('reports changed once the rate is edited', async () => {
      await h.asUser(alice, () => h.sql(
        `update labor_rates set base_wage_per_hour = 44 where id = $1`, [rateId]));
      const drift = await h.asUser(alice, () => h.sql<{ status: string }>(
        `select status from app.snapshot_drift($1)`, [snapshot]));
      // Before re-issuing an old estimate, somebody has to be told the wage
      // it was priced with has moved.
      expect(drift[0]!.status).toBe('changed');
    });

    it('leaves the captured payload alone when the live rate changes', async () => {
      const rows = await h.asUser(alice, () => h.sql<{ payload: Record<string, number> }>(
        `select payload from library_snapshot_entries where snapshot_id = $1`, [snapshot]));
      expect(rows[0]!.payload.base_wage_per_hour).toBe(42);
      const live = await h.asUser(alice, () => h.sql<{ base_wage_per_hour: string }>(
        `select base_wage_per_hour from labor_rates where id = $1`, [rateId]));
      expect(Number(live[0]!.base_wage_per_hour)).toBe(44);
    });
  });

  // ----------------------------------------------------------------- tenancy
  describe('tenancy', () => {
    it('forces row level security on both snapshot tables', async () => {
      const rows = await h.sql<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
        select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname='public' and c.relname in ('library_snapshots','library_snapshot_entries')`);
      expect(rows).toHaveLength(2);
      for (const r of rows) {
        expect(r.relrowsecurity, r.relname).toBe(true);
        expect(r.relforcerowsecurity, r.relname).toBe(true);
      }
    });

    it('never shows one company another company snapshots', async () => {
      const theirs = await h.asUser(bob, () => h.sql(`select id from library_snapshots`));
      expect(theirs).toEqual([]);
      const mine = await h.asUser(alice, () => h.sql<{ company_id: string }>(
        `select company_id from library_snapshots`));
      expect(mine.length).toBeGreaterThan(0);
      for (const r of mine) expect(r.company_id).toBe(ridgeline);
    });

    it('shows an anonymous caller nothing', async () => {
      await expect(h.asAnon(() => h.sql(`select * from library_snapshots limit 1`))).rejects.toThrow();
    });

    it('keeps kesler out of the drift report for a ridgeline snapshot', async () => {
      const snapshot = (await h.asUser(alice, () => h.sql<{ id: string }>(
        `select id from library_snapshots limit 1`)))[0]!.id;
      // SECURITY INVOKER, so bob reads only what bob could read anyway.
      const drift = await h.asUser(bob, () => h.sql(`select * from app.snapshot_drift($1)`, [snapshot]));
      expect(drift).toEqual([]);
      expect(kesler).not.toBe(ridgeline);
    });
  });
});
