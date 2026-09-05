import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * The superadmin hires.
 *
 * Migration 0064 said there was deliberately no way to add an operator from a
 * screen. That reasoning held for superadmin and not for sales, and treating
 * them the same made taking somebody on to sell into a database chore.
 *
 * The tests worth reading are the two refusals: a screen cannot mint a
 * superadmin, and it cannot give the seat away either. Both would leave a
 * platform in a state only the database can recover from.
 */
describe('hiring operators', () => {
  let h: Harness;
  const boss   = '11111111-1111-4111-8111-111111111111';
  const hire   = '22222222-2222-4222-8222-222222222222';
  const other  = '33333333-3333-4333-8333-333333333333';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [
      [boss, 'boss@grounup.test'], [hire, 'newsales@grounup.test'],
      [other, 'someone@grounup.test'],
    ] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2) on conflict (id) do nothing`,
        [id, email]);
    }
    await h.sql(`insert into platform_admins (user_id, reason, role)
                 values ($1,'Runs the platform','superadmin')`, [boss]);
  });

  afterAll(async () => { await h?.db.close(); });

  describe('taking somebody on', () => {
    it('grants sales access by email', async () => {
      // Email, because that is what a person hiring somebody actually has.
      const [r] = await h.asUser(boss, () => h.sql<{ id: string }>(
        `select app.hire_operator('newsales@grounup.test',
           'Joining to sell into the Ohio market') as id`));
      expect(r!.id).toBeTruthy();

      const [s] = await h.asUser(hire, () => h.sql<{ a: boolean; s: boolean }>(
        `select app.is_platform_admin() as a, app.is_superadmin() as s`));
      expect(s!.a).toBe(true);
      expect(s!.s).toBe(false);
    });

    it('is not case sensitive about the address', async () => {
      await expect(h.asUser(boss, () => h.sql(
        `select app.hire_operator('NEWSALES@GROUNUP.TEST','Same person, shouting')`)))
        .rejects.toThrow(/already has operator access/);
    });

    it('refuses somebody with no account rather than creating one', async () => {
      /*
       * GrounUp does not issue logins. Inventing a user here would mean the
       * platform holding credentials it cannot manage or revoke.
       */
      await expect(h.asUser(boss, () => h.sql(
        `select app.hire_operator('nobody@nowhere.test','New hire starting Monday')`)))
        .rejects.toThrow(/No account here uses/);
    });

    it('refuses without saying who this is and why', async () => {
      await expect(h.asUser(boss, () => h.sql(
        `select app.hire_operator('someone@grounup.test','ok')`)))
        .rejects.toThrow(/who this is and why/);
    });

    it('is the superadmin alone', async () => {
      await expect(h.asUser(hire, () => h.sql(
        `select app.hire_operator('someone@grounup.test','A friend of mine')`)))
        .rejects.toThrow(/do not have permission/);
    });

    it('records the hire in the ledger', async () => {
      const rows = await h.sql<{ reason: string; new_state: Record<string, unknown> }>(
        `select reason, new_state from audit_events
          where entity_table = 'public.platform_admins'
            and new_state->>'email' = 'newsales@grounup.test'`);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.new_state).toMatchObject({ role: 'sales' });
      expect(rows[0]!.reason).toMatch(/Ohio market/);
    });

    it('cannot grant the superadmin role, whatever is passed', async () => {
      /*
       * The refusal that matters most. A screen able to mint a superadmin is a
       * screen worth attacking. Migration 0074 gave hiring a role parameter —
       * support and finance are real jobs — so "there is nothing to pass" is no
       * longer the guard. The guard is that the superadmin role is marked
       * unassignable, which is a property of the role rather than a condition
       * somebody has to remember to write at each call site.
       */
      await expect(h.asUser(boss, () => h.sql(
        `select app.hire_operator('someone@grounup.test','Taking over the platform','superadmin')`)))
        .rejects.toThrow(/cannot be granted from a screen/);

      await expect(h.asUser(boss, () => h.sql(
        `select app.hire_operator('someone@grounup.test','Inventing a job','emperor')`)))
        .rejects.toThrow(/no operator role called/);

      const [n] = await h.sql<{ n: string }>(
        `select count(*)::text as n from platform_admins
          where role = 'superadmin' and revoked_at is null`);
      expect(Number(n!.n)).toBe(1);
    });

    it('grants the role that was asked for', async () => {
      const hire = '99999999-9999-4999-8999-999999999999';
      await h.sql(`insert into auth.users (id, email) values ($1,'books@grounup.test')`, [hire]);
      await h.sql(`insert into user_profiles (id, email) values ($1,'books@grounup.test')
                   on conflict (id) do nothing`, [hire]);
      await h.asUser(boss, () => h.sql(
        `select app.hire_operator('books@grounup.test','Handles the invoicing','finance')`));

      const [r] = await h.sql<{ role: string; role_key: string }>(
        `select role, role_key from platform_admins where user_id = $1`, [hire]);
      // The tier stays coarse so the one-superadmin index still holds; what
      // they may actually do comes from the role key.
      expect(r!.role).toBe('sales');
      expect(r!.role_key).toBe('finance');

      // And finance sees billing without seeing the tenant list.
      const [can] = await h.asUser(hire, () => h.sql<{ billing: boolean; companies: boolean }>(
        `select app.operator_can('billing.read') as billing,
                app.operator_can('companies.read') as companies`));
      expect(can!.billing).toBe(true);
      expect(can!.companies).toBe(false);

      const seen = await h.asUser(hire, () => h.sql(`select company_id from admin_companies`));
      expect(seen).toHaveLength(0);

      await h.asUser(boss, () => h.sql(
        `select app.revoke_operator($1,'Contract ended')`, [hire]));
    });
  });

  describe('reading the list of operators', () => {
    it('answers in one query, with the email attached', async () => {
      /*
       * The console asked PostgREST to embed `user_profiles` inside
       * `platform_admins`, and there is no foreign key between them —
       * `platform_admins.user_id` references `auth.users`, which is correct and
       * not something the client can follow. Every call returned a
       * schema-cache error, and it went unnoticed because the screen it was on
       * put the list third, under two things that worked.
       */
      const rows = await h.asUser(boss, () => h.sql<{
        email: string; role_key: string; role_name: string; active: boolean;
      }>(`select email, role_key, role_name, active from admin_operators`));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((r) => r.email === 'boss@grounup.test')).toBe(true);
      expect(rows.every((r) => r.role_name !== null)).toBe(true);
    });

    it('says what each of them may actually do', async () => {
      const [r] = await h.asUser(boss, () => h.sql<{ permissions: string[] }>(
        `select permissions from admin_operators where email = 'boss@grounup.test'`));
      expect(r!.permissions).toContain('*');
    });

    it('shows somebody who is not an operator nothing', async () => {
      const stranger = '99999999-0000-4000-8000-000000000001';
      await h.sql(`insert into auth.users (id, email) values ($1,'nobody@elsewhere.test')`,
        [stranger]);
      await h.sql(`insert into user_profiles (id, email)
                   values ($1,'nobody@elsewhere.test') on conflict (id) do nothing`,
        [stranger]);
      const rows = await h.asUser(stranger, () => h.sql(`select id from admin_operators`));
      expect(rows).toHaveLength(0);
    });
  });

  describe('letting somebody go', () => {
    it('withdraws access, and it stops working immediately', async () => {
      expect((await h.asUser(hire, () => h.sql(`select 1 from admin_companies`))).length)
        .toBeGreaterThanOrEqual(0);
      await h.asUser(boss, () => h.sql(
        `select app.revoke_operator($1,'Left the company at the end of the quarter')`,
        [hire]));
      const [s] = await h.asUser(hire, () => h.sql<{ a: boolean }>(
        `select app.is_platform_admin() as a`));
      expect(s!.a).toBe(false);
    });

    it('retires the grant rather than deleting it', async () => {
      // A past administration has to stay answerable.
      const [g] = await h.sql<{ revoked_at: string; revoke_reason: string }>(
        `select revoked_at, revoke_reason from platform_admins where user_id = $1`, [hire]);
      expect(g!.revoked_at).not.toBeNull();
      expect(g!.revoke_reason).toMatch(/end of the quarter/);
    });

    it('refuses without a reason', async () => {
      await h.asUser(boss, () => h.sql(
        `select app.hire_operator('someone@grounup.test','Covering while she is away')`));
      await expect(h.asUser(boss, () => h.sql(
        `select app.revoke_operator($1,'no')`, [other])))
        .rejects.toThrow(/Say why access is being withdrawn/);
    });

    it('refuses to give up the superadmin seat', async () => {
      /*
       * Losing it from a screen would leave a platform with nobody able to
       * grant anything, and recovering from that means the database anyway.
       */
      await expect(h.asUser(boss, () => h.sql(
        `select app.revoke_operator($1,'Stepping back from the business')`, [boss])))
        .rejects.toThrow(/cannot be given up from a screen/);
    });

    it('refuses for somebody who holds nothing', async () => {
      await expect(h.asUser(boss, () => h.sql(
        `select app.revoke_operator($1,'Tidying up the list')`, [hire])))
        .rejects.toThrow(/does not currently hold operator access/);
    });

    it('is the superadmin alone', async () => {
      await expect(h.asUser(other, () => h.sql(
        `select app.revoke_operator($1,'I would rather work alone')`, [boss])))
        .rejects.toThrow(/do not have permission/);
    });

    it('lets a revoked person be taken on again', async () => {
      // People come back. The live-grant index is partial for exactly this.
      const [r] = await h.asUser(boss, () => h.sql<{ id: string }>(
        `select app.hire_operator('newsales@grounup.test','Rejoining after a year') as id`));
      expect(r!.id).toBeTruthy();
      const [s] = await h.asUser(hire, () => h.sql<{ a: boolean }>(
        `select app.is_platform_admin() as a`));
      expect(s!.a).toBe(true);
    });
  });
});
