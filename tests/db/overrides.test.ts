/**
 * Value overrides, against real PostgreSQL.
 *
 * The engine half proves the record is well-formed. This half proves the
 * database will not let the control be bypassed: no self-approval, no silent
 * edit, no override that crosses a tenant boundary.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('value overrides', () => {
  let h: Harness;
  const alice = '11111111-1111-4111-8111-111111111111';
  const dana = '33333333-3333-4333-8333-333333333333';
  const bob = '22222222-2222-4222-8222-222222222222';
  let ridgeline = '';
  let kesler = '';
  let version = '';
  let keslerVersion = '';

  const REASON = 'Superintendent reports the haul road is single-lane, so the crew works short-handed.';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(
      `insert into auth.users (id, email) values ($1,'a@r.test'), ($2,'d@r.test'), ($3,'b@k.test')`,
      [alice, dana, bob]);
    await h.sql(
      `insert into user_profiles (id, email) values ($1,'a@r.test'), ($2,'d@r.test'), ($3,'b@k.test') on conflict (id) do nothing`,
      [alice, dana, bob]);
    ridgeline = (await h.asUser(alice, () =>
      h.sql<{ id: string }>(`select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
    kesler = (await h.asUser(bob, () =>
      h.sql<{ id: string }>(`select app.provision_company('Kesler','kesler','enterprise') as id`)))[0]!.id;

    // Dana is the approver. No membership row is needed: approved_by
    // references auth.users, and inserting one here would evaluate the roles
    // policy, which itself reads company_memberships.

    version = (await h.asUser(alice, async () => {
      const e = (await h.sql<{ id: string }>(
        `insert into estimates (company_id, number, name) values ($1,'EST-800','Override test')
         returning id`, [ridgeline]))[0]!.id;
      return h.sql<{ id: string }>(
        `insert into estimate_versions (company_id, estimate_id, version_number, status)
         values ($1,$2,1,'draft') returning id`, [ridgeline, e]);
    }))[0]!.id;

    keslerVersion = (await h.asUser(bob, async () => {
      const e = (await h.sql<{ id: string }>(
        `insert into estimates (company_id, number, name) values ($1,'K-800','Theirs') returning id`,
        [kesler]))[0]!.id;
      return h.sql<{ id: string }>(
        `insert into estimate_versions (company_id, estimate_id, version_number, status)
         values ($1,$2,1,'draft') returning id`, [kesler, e]);
    }))[0]!.id;
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  const record = (over: Record<string, unknown> = {}) => {
    const v = {
      company_id: ridgeline, entity_table: 'estimate_versions', entity_id: version,
      field_path: 'lines.L-001.directCost.labor', value_kind: 'money',
      original_value: '12800', override_value: '14200', reason: REASON,
      requested_by: alice, approved_by: dana, ...over,
    };
    return h.asUser(alice, () => h.sql<{ id: string }>(
      `insert into value_overrides
         (company_id, entity_table, entity_id, field_path, value_kind,
          original_value, override_value, reason, requested_by, approved_by)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10) returning id`,
      [v.company_id, v.entity_table, v.entity_id, v.field_path, v.value_kind,
       v.original_value, v.override_value, v.reason, v.requested_by, v.approved_by]));
  };

  describe('the control cannot be bypassed', () => {
    it('records a well-formed override', async () => {
      const rows = await record();
      expect(rows).toHaveLength(1);
    });

    it('refuses self-approval', async () => {
      // An override the requester can approve is not a control.
      await expect(record({ field_path: 'a.b', approved_by: alice }))
        .rejects.toThrow(/not_self_approved/);
    });

    it('refuses a reason too short to be one', async () => {
      await expect(record({ field_path: 'a.c', reason: 'because' })).rejects.toThrow();
    });

    it('refuses an override that changes nothing', async () => {
      await expect(record({ field_path: 'a.d', override_value: '12800' }))
        .rejects.toThrow(/changes_something/);
    });

    it('refuses a second override on the same value', async () => {
      // Two would make it arbitrary which governs a number somebody is bidding.
      await expect(record()).rejects.toThrow();
    });

    it('allows the same field path on a different record', async () => {
      const other = await h.asUser(alice, async () => {
        const e = (await h.sql<{ id: string }>(
          `insert into estimates (company_id, number, name) values ($1,'EST-801','Second') returning id`,
          [ridgeline]))[0]!.id;
        return (await h.sql<{ id: string }>(
          `insert into estimate_versions (company_id, estimate_id, version_number, status)
           values ($1,$2,1,'draft') returning id`, [ridgeline, e]))[0]!.id;
      });
      const rows = await record({ entity_id: other });
      expect(rows).toHaveLength(1);
    });
  });

  describe('the record cannot be rewritten', () => {
    it('refuses to change an override after the fact', async () => {
      const id = (await h.asUser(alice, () => h.sql<{ id: string }>(
        `select id from value_overrides where entity_id = $1 limit 1`, [version])))[0]!.id;
      // Changing it rewrites the record of a decision somebody made. A
      // different decision is a new override.
      await expect(h.asUser(alice, () => h.sql(
        `update value_overrides set override_value = '99999'::jsonb where id = $1`, [id])))
        .rejects.toThrow(/append-only/);
    });

    it('keeps the engine figure beside the override', async () => {
      const rows = await h.asUser(alice, () => h.sql<{ original_value: number; override_value: number }>(
        `select original_value, override_value from value_overrides where entity_id = $1`, [version]));
      // Overwriting the original destroys the evidence of what the platform
      // actually computed.
      expect(Number(rows[0]!.original_value)).toBe(12800);
      expect(Number(rows[0]!.override_value)).toBe(14200);
    });
  });

  describe('tenancy', () => {
    it('refuses an override against a row this table does not own', async () => {
      await expect(record({ entity_id: keslerVersion, field_path: 'cross.tenant' }))
        .rejects.toThrow(/does not match the owner|does not exist/);
    });

    it('refuses an override against a table that is not company-owned', async () => {
      await expect(record({ entity_table: 'plans', field_path: 'x.y' }))
        .rejects.toThrow(/not a company-owned table/);
    });

    it('refuses an override against a row that does not exist', async () => {
      await expect(record({
        entity_id: '00000000-0000-4000-8000-000000000000', field_path: 'x.z',
      })).rejects.toThrow(/does not exist/);
    });

    it('forces row level security', async () => {
      const rows = await h.sql<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
        select c.relrowsecurity, c.relforcerowsecurity from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname='public' and c.relname='value_overrides'`);
      expect(rows[0]!.relrowsecurity).toBe(true);
      expect(rows[0]!.relforcerowsecurity).toBe(true);
    });

    it('never shows one company another company overrides', async () => {
      expect(await h.asUser(bob, () => h.sql(`select id from value_overrides`))).toEqual([]);
      const mine = await h.asUser(alice, () => h.sql<{ company_id: string }>(
        `select company_id from value_overrides`));
      expect(mine.length).toBeGreaterThan(0);
      for (const r of mine) expect(r.company_id).toBe(ridgeline);
    });

    it('shows an anonymous caller nothing', async () => {
      await expect(h.asAnon(() => h.sql(`select * from value_overrides limit 1`))).rejects.toThrow();
    });
  });

  describe('reading them back', () => {
    it('lists the overrides on a record', async () => {
      const rows = await h.asUser(alice, () => h.sql<{ field_path: string; reason: string }>(
        `select field_path, reason from app.overrides_for('estimate_versions', $1)`, [version]));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.field_path).toBe('lines.L-001.directCost.labor');
      expect(rows[0]!.reason).toContain('haul road');
    });

    it('shows another company nothing through the same function', async () => {
      // SECURITY INVOKER, so bob reads only what bob could read anyway.
      expect(await h.asUser(bob, () => h.sql(
        `select * from app.overrides_for('estimate_versions', $1)`, [version]))).toEqual([]);
    });
  });
});
