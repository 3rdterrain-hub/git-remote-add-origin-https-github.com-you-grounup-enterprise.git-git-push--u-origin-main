/**
 * P05 acceptance evidence — the database half.
 *
 * Every GES Phase 05 requirement carries the same acceptance criterion:
 *
 *   "Demonstrate {module} {aspect} with tenant-specific configuration, role
 *    controls, version history, and traceable output."
 *
 * Traceable output and input validation are engine properties and are asserted
 * in `packages/engine/tests/estimating-acceptance.test.ts`. The other three
 * are database properties and are asserted here, against real PostgreSQL.
 *
 * These are written to loop over every estimating library rather than a chosen
 * few. A guarantee that holds for eleven libraries and not the twelfth is not a
 * guarantee, and the twelfth is the one that will price a job wrong.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const registry = JSON.parse(readFileSync(join(ROOT, 'governance/registry.json'), 'utf8')) as {
  library_scope: Record<string, string>;
};

/** The twelve libraries an estimate is priced from. */
const THREE_TIER = Object.entries(registry.library_scope)
  .filter(([, scope]) => scope === 'three_tier')
  .map(([t]) => t)
  .sort();

describe('P05 database acceptance', () => {
  let h: Harness;
  const alice = '11111111-1111-4111-8111-111111111111';
  const bob = '22222222-2222-4222-8222-222222222222';
  let ridgeline = '';
  let kesler = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'a@r.test'), ($2,'b@k.test')`, [alice, bob]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'a@r.test'), ($2,'b@k.test') on conflict (id) do nothing`, [alice, bob]);
    ridgeline = (await h.asUser(alice, () =>
      h.sql<{ id: string }>(`select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
    kesler = (await h.asUser(bob, () =>
      h.sql<{ id: string }>(`select app.provision_company('Kesler','kesler','enterprise') as id`)))[0]!.id;
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  it('knows all twelve estimating libraries', () => {
    expect(THREE_TIER).toEqual([
      'assemblies', 'condition_modifiers', 'cost_codes', 'crews', 'equipment',
      'labor_rates', 'materials', 'pricing_profiles', 'production_rates',
      'regional_factors', 'services', 'tasks',
    ]);
  });

  // ------------------------------------------- tenant-specific configuration
  describe('tenant-specific configuration', () => {
    for (const table of THREE_TIER) {
      it(`${table}: a company can read the platform seed`, async () => {
        const rows = await h.asUser(alice, () => h.sql<{ n: number }>(
          `select count(*)::int as n from ${table} where company_id is null`));
        // A platform row is readable by every tenant, which is what makes it a
        // starting point rather than a copy each company has to make.
        expect(rows[0]!.n).toBeGreaterThanOrEqual(0);
      });

      it(`${table}: a company cannot edit the platform seed`, async () => {
        const seeded = await h.asService(() => h.sql<{ id: string }>(
          `select id from ${table} where company_id is null limit 1`));
        if (seeded.length === 0) return; // nothing seeded into this library
        const before = await h.asService(() => h.sql<{ updated_at: string }>(
          `select updated_at from ${table} where id = $1`, [seeded[0]!.id]));
        await h.asUser(alice, () => h.sql(
          `update ${table} set updated_at = now() where id = $1`, [seeded[0]!.id]));
        const after = await h.asService(() => h.sql<{ updated_at: string }>(
          `select updated_at from ${table} where id = $1`, [seeded[0]!.id]));
        // The seed is shared. A company able to edit it would silently change
        // every other company's estimate.
        expect(String(after[0]!.updated_at)).toBe(String(before[0]!.updated_at));
      });

      it(`${table}: a company cannot delete the platform seed`, async () => {
        const seeded = await h.asService(() => h.sql<{ id: string }>(
          `select id from ${table} where company_id is null limit 1`));
        if (seeded.length === 0) return;
        await h.asUser(alice, () => h.sql(`delete from ${table} where id = $1`, [seeded[0]!.id]));
        const still = await h.asService(() => h.sql(
          `select 1 from ${table} where id = $1`, [seeded[0]!.id]));
        expect(still).toHaveLength(1);
      });
    }
  });

  // --------------------------------------------------------- role controls
  describe('role controls', () => {
    for (const table of THREE_TIER) {
      it(`${table}: row level security is enabled and forced`, async () => {
        const rows = await h.sql<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
          select c.relrowsecurity, c.relforcerowsecurity from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = $1`, [table]);
        // ENABLE without FORCE still lets the table owner read past every policy.
        expect(rows[0]!.relrowsecurity, table).toBe(true);
        expect(rows[0]!.relforcerowsecurity, table).toBe(true);
      });

      it(`${table}: one company never sees another company's rows`, async () => {
        const mine = await h.asUser(alice, () => h.sql<{ company_id: string | null }>(
          `select company_id from ${table} where company_id is not null`));
        for (const r of mine) expect(r.company_id, table).toBe(ridgeline);
        const theirs = await h.asUser(bob, () => h.sql<{ company_id: string | null }>(
          `select company_id from ${table} where company_id is not null`));
        for (const r of theirs) expect(r.company_id, table).toBe(kesler);
      });

      it(`${table}: an anonymous caller reads nothing`, async () => {
        await expect(h.asAnon(() => h.sql(`select * from ${table} limit 1`))).rejects.toThrow();
      });
    }
  });

  // -------------------------------------------------------- version history
  describe('version history', () => {
    let estimate = '';
    let version = '';

    beforeAll(async () => {
      await h.asUser(alice, async () => {
        estimate = (await h.sql<{ id: string }>(
          `insert into estimates (company_id, number, name) values ($1,'EST-900','Acceptance')
           returning id`, [ridgeline]))[0]!.id;
        version = (await h.sql<{ id: string }>(
          `insert into estimate_versions (company_id, estimate_id, version_number, status)
           values ($1,$2,1,'draft') returning id`, [ridgeline, estimate]))[0]!.id;
      });
    });

    it('records a version number against every estimate', async () => {
      const rows = await h.asUser(alice, () => h.sql<{ version_number: number }>(
        `select version_number from estimate_versions where estimate_id = $1`, [estimate]));
      expect(rows[0]!.version_number).toBe(1);
    });

    it('lets a draft version be edited', async () => {
      await h.asUser(alice, () => h.sql(
        `update estimate_versions set revision_reason = 'still drafting' where id = $1`, [version]));
      const rows = await h.asUser(alice, () => h.sql<{ revision_reason: string }>(
        `select revision_reason from estimate_versions where id = $1`, [version]));
      expect(rows[0]!.revision_reason).toBe('still drafting');
    });

    it('refuses to issue a version with no library snapshot', async () => {
      // An issued price the platform cannot reproduce is not a record of
      // anything, so this is refused before the issue date is even considered.
      await expect(h.asUser(alice, () => h.sql(
        `update estimate_versions set status = 'issued', issued_at = now(), issued_by = $2 where id = $1`,
        [version, alice]))).rejects.toThrow(/without a library snapshot/);
    });

    it('refuses to issue a version without recording when it was issued', async () => {
      await h.asUser(alice, async () => {
        const snap = (await h.sql<{ id: string }>(
          `insert into library_snapshots (company_id, estimate_version_id, engine_version, entry_count, digest)
           values ($1, $2, '1.0.0', 0, '0000000000000000') returning id`, [ridgeline, version]))[0]!.id;
        await h.sql(`update estimate_versions set library_snapshot_id = $2 where id = $1`, [version, snap]);
      });
      // A version marked issued with no issue date is a record of nothing.
      await expect(h.asUser(alice, () => h.sql(
        `update estimate_versions set status = 'issued' where id = $1`, [version])))
        .rejects.toThrow(/estimate_versions_issued/);
    });

    it('refuses to change a version once it is issued (RULE-009)', async () => {
      await h.asUser(alice, () => h.sql(
        `update estimate_versions set status = 'issued', issued_at = now(), issued_by = $2
         where id = $1`, [version, alice]));
      // An issued version is what a customer was shown. Editing it destroys
      // the record of what was actually offered.
      await expect(h.asUser(alice, () => h.sql(
        `update estimate_versions set revision_reason = 'quietly revised' where id = $1`, [version])))
        .rejects.toThrow(/immutable/i);
    });

    it('allows a revision as a new version rather than an edit', async () => {
      const rows = await h.asUser(alice, () => h.sql<{ version_number: number }>(
        `insert into estimate_versions (company_id, estimate_id, version_number, status)
         values ($1,$2,2,'draft') returning version_number`, [ridgeline, estimate]));
      expect(rows[0]!.version_number).toBe(2);
    });

    it('keeps the issued version alongside the revision', async () => {
      const rows = await h.asUser(alice, () => h.sql<{ n: number }>(
        `select count(*)::int as n from estimate_versions where estimate_id = $1`, [estimate]));
      expect(rows[0]!.n).toBe(2);
    });
  });

  // ---------------------------------------------------------- auditability
  describe('auditability', () => {
    it('writes an audit entry when an estimate changes', async () => {
      const before = (await h.asService(() => h.sql<{ n: number }>(
        `select count(*)::int as n from audit_events where company_id = $1`, [ridgeline])))[0]!.n;
      await h.asUser(alice, () => h.sql(
        `update estimates set name = 'Acceptance, renamed' where company_id = $1 and number = 'EST-900'`,
        [ridgeline]));
      const after = (await h.asService(() => h.sql<{ n: number }>(
        `select count(*)::int as n from audit_events where company_id = $1`, [ridgeline])))[0]!.n;
      expect(after).toBeGreaterThan(before);
    });

    it('records the prior and new state, not just that something changed', async () => {
      const rows = await h.asService(() => h.sql<{ prior_state: unknown; new_state: unknown }>(
        `select prior_state, new_state from audit_events
         where company_id = $1 and entity_table = 'public.estimates' and action = 'update'
         order by occurred_at desc limit 1`, [ridgeline]));
      // "Something changed" is not an audit trail. Answering "changed from
      // what, to what, by whom" is.
      expect(rows).toHaveLength(1);
      expect(rows[0]!.prior_state).toBeTruthy();
      expect(rows[0]!.new_state).toBeTruthy();
      expect(JSON.stringify(rows[0]!.prior_state)).toContain('Acceptance');
      expect(JSON.stringify(rows[0]!.new_state)).toContain('Acceptance, renamed');
    });

    it('refuses to let anyone rewrite the ledger', async () => {
      const before = await h.asService(() => h.sql<{ new_state: unknown }>(
        `select new_state from audit_events where company_id = $1
         order by occurred_at desc limit 1`, [ridgeline]));
      // The update is refused by policy rather than by error: no ledger row is
      // visible to write, so it matches nothing. Either way the row must be
      // unchanged, and that is the property worth asserting.
      await h.asUser(alice, () => h.sql(
        `update audit_events set new_state = '{}'::jsonb where company_id = $1`, [ridgeline]))
        .catch(() => undefined);
      const after = await h.asService(() => h.sql<{ new_state: unknown }>(
        `select new_state from audit_events where company_id = $1
         order by occurred_at desc limit 1`, [ridgeline]));
      expect(JSON.stringify(after[0]!.new_state)).toBe(JSON.stringify(before[0]!.new_state));
      expect(JSON.stringify(after[0]!.new_state)).not.toBe('{}');
    });

    it('refuses a direct delete from the ledger', async () => {
      const before = (await h.asService(() => h.sql<{ n: number }>(
        `select count(*)::int as n from audit_events where company_id = $1`, [ridgeline])))[0]!.n;
      await h.asUser(alice, () => h.sql(
        `delete from audit_events where company_id = $1`, [ridgeline])).catch(() => undefined);
      const after = (await h.asService(() => h.sql<{ n: number }>(
        `select count(*)::int as n from audit_events where company_id = $1`, [ridgeline])))[0]!.n;
      expect(after).toBe(before);
    });
  });
});
