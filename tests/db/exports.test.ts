import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * Taking data out.
 *
 * The one action that removes a record from every protection this platform has.
 * It is recorded rather than restricted — somebody who can read a list on
 * screen can copy it by hand — so the tests are about the trace being there,
 * being honest about its own shape, and never holding a copy of what left.
 */
describe('taking data out', () => {
  let h: Harness;
  const boss  = '0e000000-0000-4000-8000-000000000001';
  const help  = '0e000000-0000-4000-8000-000000000002';
  const owner = '0e000000-0000-4000-8000-000000000003';
  let company = '';

  const account = async (id: string, email: string) => {
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                 on conflict (id) do nothing`, [id, email]);
  };

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [
      [boss, 'boss@grounup.test'], [help, 'support@grounup.test'],
      [owner, 'owner@ridge.test'],
    ] as const) await account(id, email);
    await h.sql(`insert into platform_admins (user_id, reason, role)
                 values ($1,'Runs the platform','superadmin')`, [boss]);
    await h.asUser(boss, () => h.sql(
      `select app.hire_operator('support@grounup.test','Answers billing tickets','support')`));
    company = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','grounup') as id`)))[0]!.id;
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  it('records what was taken and how much', async () => {
    await h.asUser(boss, () => h.sql(`select app.record_export('Companies', 42)`));
    const [e] = await h.sql<{ action: string; reason: string; rows: number }>(
      `select action, reason, (new_state ->> 'rows')::int as rows
         from audit_events where action = 'export'`);
    expect(e!.action).toBe('export');
    expect(Number(e!.rows)).toBe(42);
    expect(e!.reason).toMatch(/Exported 42 rows of Companies/);
  });

  it('never holds a copy of what left', async () => {
    /*
     * A ledger carrying the export would be a second copy of the thing the
     * export was worth worrying about. It records the shape and nothing else.
     */
    const [e] = await h.sql<{ state: Record<string, unknown> }>(
      `select new_state as state from audit_events where action = 'export'`);
    expect(Object.keys(e!.state)).toEqual(['rows']);
  });

  it('refuses somebody who does not operate the platform', async () => {
    await expect(h.asUser(owner, () => h.sql(
      `select app.record_export('Companies', 42)`)))
      .rejects.toThrow(/Only an operator/);
  });

  it('refuses an export that does not say what it was', async () => {
    await expect(h.asUser(boss, () => h.sql(`select app.record_export('', 1)`)))
      .rejects.toThrow(/has to say what it was/);
  });

  it('shows up beside every other operator action, not in a separate log', async () => {
    const rows = await h.asUser(boss, () => h.sql<{ action: string }>(
      `select action from admin_operator_activity where action = 'export'`));
    expect(rows.length).toBeGreaterThan(0);
  });

  it('names who took it, in words rather than a table name', async () => {
    const [e] = await h.asUser(boss, () => h.sql<{
      operator_email: string; what: string; rows: number;
    }>(`select operator_email, what, rows from admin_exports`));
    expect(e!.operator_email).toBe('boss@grounup.test');
    expect(e!.what).toBe('companies');
    expect(Number(e!.rows)).toBe(42);
  });

  it('records an export tied to one customer against that customer', async () => {
    await h.asUser(boss, () => h.sql(
      `select app.record_export('Company invoices', 7, $1)`, [company]));
    const [e] = await h.asUser(boss, () => h.sql<{ company_name: string }>(
      `select company_name from admin_exports where what = 'company invoices'`));
    expect(e!.company_name).toBe('Ridgeline');
  });

  it('lets that customer read it in their own history', async () => {
    // The same property every other operator action has: answerable to the
    // person it was done to.
    const rows = await h.asUser(owner, () => h.sql<{ reason: string }>(
      `select reason from audit_events where company_id = $1 and action = 'export'`,
      [company]));
    expect(rows.some((r) => /7 rows/.test(r.reason ?? ''))).toBe(true);
  });

  it('is not readable by an operator who does not manage staff', async () => {
    const rows = await h.asUser(help, () => h.sql(`select occurred_at from admin_exports`));
    expect(rows).toHaveLength(0);
  });

  it('shows an anonymous visitor nothing at all', async () => {
    await expect(h.asAnon(() => h.sql(`select * from admin_exports`)))
      .rejects.toThrow(/permission denied/);
  });
});
