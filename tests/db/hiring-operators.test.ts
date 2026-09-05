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
        .rejects.toThrow(/Only the superadmin/);
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

    it('can only ever grant sales', async () => {
      /*
       * The refusal that matters most. A screen able to mint a superadmin is a
       * screen worth attacking, and there is exactly one by construction — so
       * the function does not take a role at all.
       */
      const [sig] = await h.sql<{ args: string }>(
        `select pg_get_function_identity_arguments(p.oid) as args
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'hire_operator'`);
      // Two text parameters: an email and a reason. No role among them, so
      // there is nothing to pass that could ask for a superadmin.
      expect(sig!.args).not.toMatch(/role/);
      expect(sig!.args.split(',')).toHaveLength(2);

      const roles = await h.sql<{ role: string }>(
        `select role from platform_admins where granted_by = $1`, [boss]);
      expect(roles.every((x) => x.role === 'sales')).toBe(true);
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
        .rejects.toThrow(/Only the superadmin/);
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
