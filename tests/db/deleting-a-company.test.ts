import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * What happens to a company's last owner, and what it takes to delete a tenant.
 *
 * `protect_last_owner` refuses to remove a company's final active owner, which
 * is right: a tenant nobody can administer is a support ticket that cannot be
 * resolved from inside the product. It also fired on the cascade from deleting
 * the company itself, which is a different situation entirely — the last owner
 * is leaving because the company is — and migration 0072 tells the two apart.
 *
 * That fix does not make a tenant deletable, and these tests say so rather than
 * implying otherwise. Ten append-only ledgers refuse a DELETE at any privilege
 * level, several of them reference `companies`, and that is the guard working:
 * an audit trail somebody can erase is not an audit trail. Deleting a customer
 * properly means exporting what they are owed, removing their business data,
 * and reducing the ledgers to something that answers a legal question without
 * holding personal data. That is a deliberate piece of work, recorded in the
 * backlog, and not something to reach by loosening an immutability guarantee.
 */
describe('a company and its last owner', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  const mate  = '22222222-2222-4222-8222-222222222222';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [[owner, 'o@r.test'], [mate, 'm@r.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2) on conflict (id) do nothing`,
        [id, email]);
    }
  });

  afterAll(async () => { await h?.db.close(); });

  const company = async (slug: string) =>
    (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company($1,$2,'grounup') as id`, [slug, slug])))[0]!.id;

  describe('the guard that must not weaken', () => {
    it('refuses to strand a company with no owner', async () => {
      const id = await company('kept');
      const [m] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `select id from company_memberships where company_id = $1 and is_owner`, [id]));
      await expect(h.sql(`delete from company_memberships where id = $1`, [m!.id]))
        .rejects.toThrow(/must retain at least one active owner/);
    });

    it('refuses to demote the last owner', async () => {
      const id = await company('kept2');
      await expect(h.sql(
        `update company_memberships set is_owner = false
          where company_id = $1 and is_owner`, [id]))
        .rejects.toThrow(/must retain at least one active owner/);
    });

    it('refuses to deactivate the last owner', async () => {
      const id = await company('kept3');
      await expect(h.sql(
        `update company_memberships set status = 'removed'
          where company_id = $1 and is_owner`, [id]))
        .rejects.toThrow(/must retain at least one active owner/);
    });

    it('allows an owner to leave when another one remains', async () => {
      const id = await company('shared');
      const role = (await h.sql<{ id: string }>(
        `select id from roles where key='owner' and company_id is null`))[0]!.id;
      await h.sql(`insert into company_memberships
                     (company_id, user_id, role_id, status, is_owner, joined_at)
                   values ($1,$2,$3,'active',true,now())`, [id, mate, role]);
      const [first] = await h.sql<{ id: string }>(
        `select id from company_memberships where company_id = $1 and user_id = $2`,
        [id, owner]);
      await h.sql(`delete from company_memberships where id = $1`, [first!.id]);
      const [n] = await h.sql<{ n: string }>(
        `select count(*)::text as n from company_memberships
          where company_id = $1 and is_owner and status = 'active'`, [id]);
      expect(Number(n!.n)).toBe(1);
    });
  });

  describe('what used to stand between a tenant and deletion', () => {
    it('is no longer the owner guard', async () => {
      /*
       * Migration 0072's whole purpose. During a cascade the parent row is
       * already gone when the child trigger runs, so the guard can tell "the
       * last administrator is being removed" from "the company is going".
       */
      // It now succeeds outright, which is the strongest form of "not that".
      const id = await company('cascadeprobe');
      await expect(h.sql(`delete from companies where id = $1`, [id]))
        .resolves.toBeDefined();
    });

    it('is no longer the append-only ledgers either', async () => {
      /*
       * This test used to assert the opposite, and the assertion was honest:
       * the ledgers did refuse, and deleting a customer properly was described
       * as a workflow nobody had built. Migration 0092 built it, using the same
       * distinction 0072 drew — during a cascade the parent is already gone, so
       * a guard can ask whether the company still exists.
       *
       * The immutability that mattered is untouched, which the next test holds.
       */
      const id = await company('ledgerprobe');
      await expect(h.sql(`delete from companies where id = $1`, [id])).resolves.toBeDefined();
      expect(await h.sql(`select id from companies where id = $1`, [id])).toHaveLength(0);
    });

    it('still refuses to let anybody edit a ledger', async () => {
      /*
       * The point of the guard, and the thing that would have been lost by
       * loosening it carelessly. A row may leave because the tenant it
       * described has left. Nothing may be rewritten.
       */
      const id = await company('editprobe');
      await expect(h.sql(
        `update library_row_versions set payload = '{}'::jsonb where company_id = $1`, [id]))
        .rejects.toThrow(/append-only/);
      await expect(h.sql(
        `delete from library_row_versions where company_id = $1`, [id]))
        .rejects.toThrow(/append-only/);
    });

    it('is not the audit ledger, which now outlives its tenant', async () => {
      /*
       * audit_events cascaded from companies and is append-only, so it refused
       * its own cascade. Cascading was the wrong relationship: a company
       * closing its account does not unmake the events. The reference goes and
       * the record stays.
       */
      const [fk] = await h.sql<{ confdeltype: string }>(
        `select confdeltype from pg_constraint
          where conrelid = 'public.audit_events'::regclass and contype = 'f'
            and confrelid = 'public.companies'::regclass`);
      // 'n' is SET NULL; 'c' was CASCADE.
      expect(fk!.confdeltype).toBe('n');
    });
  });
});
