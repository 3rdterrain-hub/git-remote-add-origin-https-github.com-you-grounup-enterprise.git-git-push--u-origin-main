/**
 * The shipped library is readable by every tenant, or it is not shipped.
 *
 * The platform makes this claim on the Master Libraries screen in as many
 * words — "the GrounUp global seed is readable by every tenant and writable by
 * none" — and for four tables it was false.
 *
 * `services`, `assemblies` and `production_rates` use `app.apply_library_rls`,
 * whose read policy admits a row with no company. Their child tables were given
 * `app.apply_tenant_rls`, whose read policy is `app.is_member(company_id)` —
 * and a platform row's `company_id` is null, so `is_member(null)` is not true.
 * 8,159 assembly components, 29 crew members, 9 markup components and 17
 * equipment rates were readable by nobody. Every path that worked, worked
 * through a `security definer` function that bypassed the policy, which is why
 * three thousand tests never noticed.
 *
 * So this checks the property directly, across the whole schema, rather than
 * for the four tables that happened to be wrong: every table holding rows that
 * belong to the platform is either readable by an ordinary member, or named
 * below with the reason it is not.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * Tables whose platform rows a tenant is deliberately not shown.
 *
 * Each of these is a decision, not an oversight, and the reason is the point of
 * the entry. A table added here without a reason is a bug being written down.
 */
const NOT_FOR_TENANTS: Record<string, string> = {
  audit_events:
    'The ledger. A company reads its own rows; the platform-level ones record '
    + 'operator actions across every tenant and are not one tenant’s business.',
};

describe('what belongs to the platform is readable by every tenant', () => {
  let h: Harness;
  const member = '11111111-1111-4111-8111-111111111111';
  let offenders: Array<{ table: string; platform: number; visible: number }> = [];

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'m@ridge.test')`, [member]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'m@ridge.test')
                 on conflict (id) do nothing`, [member]);
    await h.asUser(member, () => h.sql(
      `select app.provision_company('Ridgeline','ridgeline','enterprise')`));

    /*
     * Every table carrying a nullable company_id. Read from the catalog rather
     * than listed, so a table added next year is covered the day it is added.
     */
    const tables = await h.sql<{ table_name: string }>(
      `select c.table_name
         from information_schema.columns c
         join information_schema.tables t
           on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public'
          and c.column_name = 'company_id'
          and c.is_nullable = 'YES'
          and t.table_type = 'BASE TABLE'
        order by c.table_name`);

    for (const { table_name } of tables) {
      const [all] = await h.sql<{ c: number }>(
        `select count(*)::int c from ${table_name} where company_id is null`);
      if (!all || all.c === 0) continue;
      const [seen] = await h.asUser(member, () => h.sql<{ c: number }>(
        `select count(*)::int c from ${table_name} where company_id is null`));
      if ((seen?.c ?? 0) === 0) {
        offenders.push({ table: table_name, platform: all.c, visible: seen?.c ?? 0 });
      }
    }
  }, 300_000);

  afterAll(async () => { await h?.db.close(); });

  it('finds tables to check, so the sweep is not vacuously green', async () => {
    const [r] = await h.sql<{ c: number }>(
      `select count(*)::int c from information_schema.columns
        where table_schema = 'public' and column_name = 'company_id' and is_nullable = 'YES'`);
    expect(r!.c).toBeGreaterThan(20);
  });

  it('shows a member every platform row that is not deliberately withheld', () => {
    const unexplained = offenders
      .filter((o) => !(o.table in NOT_FOR_TENANTS))
      .map((o) => `${o.table}: ${o.platform} platform rows, none readable`);
    expect(unexplained).toEqual([]);
  });

  it('withholds nothing it does not have a reason for', () => {
    /*
     * The other direction: an entry above that no longer withholds anything is
     * a stale exception, and a stale exception is how the next one hides.
     */
    const stale = Object.keys(NOT_FOR_TENANTS)
      .filter((t) => !offenders.some((o) => o.table === t));
    expect(stale).toEqual([]);
  });

  it('shows the four that were wrong, since that is what this file is for', async () => {
    for (const table of ['assembly_components', 'crew_members',
                         'markup_components', 'equipment_rates']) {
      const [seen] = await h.asUser(member, () => h.sql<{ c: number }>(
        `select count(*)::int c from ${table} where company_id is null`));
      expect({ table, visible: seen!.c > 0 }).toEqual({ table, visible: true });
    }
  });

  it('still lets nobody write one', async () => {
    await expect(h.asUser(member, () => h.sql(
      `update assembly_components set sort_order = 999 where company_id is null`)))
      .resolves.toBeDefined();
    const [r] = await h.sql<{ c: number }>(
      `select count(*)::int c from assembly_components
        where company_id is null and sort_order = 999`);
    // The update is permitted to run and changes nothing: RLS filters the rows.
    expect(r!.c).toBe(0);
  });
});
