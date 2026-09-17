/**
 * A company you can administer.
 *
 * `roles`, `company_memberships` and `company_invitations` have existed since
 * migration 0002 with no reader and no writer of any kind, while the Users &
 * roles tab rendered eleven roles typed into the JSX with invented user counts
 * beside them.
 *
 * Most of these tests are about refusals, because on this screen the refusals
 * *are* the feature. The one that matters more than the rest: an administrator
 * holds `users.manage`, which is enough to write a role — so without a check,
 * they could mint a role granting everything and assign it to themselves. That
 * is privilege escalation through the settings page, and it is the first thing
 * anybody would try.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '7e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e';
const ADMIN = '8f2f2f2f-2f2f-4f2f-8f2f-2f2f2f2f2f2f';
const HAND = '9a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a';

describe('a company you can administer', () => {
  let h: Harness;
  let company = '';
  let adminMembership = '';
  let handMembership = '';
  let estimatorRole = '';
  let viewerRole = '';

  const asOwner = <T>(fn: () => Promise<T>) => h.asUser(OWNER, fn);
  const one = <T>(sql: string, args: unknown[] = []) =>
    asOwner(() => h.sql<T>(sql, args)).then((r) => r[0]!);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email, name] of [
      [OWNER, 'owner@admin.test', 'Tyree Owner'],
      [ADMIN, 'admin@admin.test', 'Avery Admin'],
      [HAND, 'hand@admin.test', 'Sam Hand'],
    ]) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      /* A trigger on auth.users creates the profile first, so this has to
         update rather than do nothing — which is why every name read null. */
      await h.sql(`insert into user_profiles (id, email, full_name) values ($1,$2,$3)
                   on conflict (id) do update set full_name = excluded.full_name,
                                                  email = excluded.email`,
        [id, email, name]);
    }
    company = (await asOwner(() => h.sql<{ id: string }>(
      `select app.provision_company('Admin Civil','admin-civil','enterprise') as id`)))[0]!.id;

    estimatorRole = (await one<{ id: string }>(
      `select id from roles where company_id is null and key = 'estimator'`)).id;
    viewerRole = (await one<{ id: string }>(
      `select id from roles where company_id is null and key = 'viewer'`)).id;
    const adminRole = (await one<{ id: string }>(
      `select id from roles where company_id is null and key = 'admin'`)).id;

    /* Two colleagues, put in directly — joining a company is a separate flow. */
    adminMembership = (await one<{ id: string }>(
      `insert into company_memberships (company_id, user_id, role_id, status)
       values ($1,$2,$3,'active') returning id`, [company, ADMIN, adminRole])).id;
    handMembership = (await one<{ id: string }>(
      `insert into company_memberships (company_id, user_id, role_id, status)
       values ($1,$2,$3,'active') returning id`, [company, HAND, estimatorRole])).id;
  }, 180_000);

  describe('what the screen reads', () => {
    it('counts the people actually holding each role', async () => {
      const row = await one<{ member_count: string; name: string }>(
        `select name, member_count from my_company_roles where id = $1`, [estimatorRole]);
      expect(row.name).toBe('Estimator');
      expect(Number(row.member_count)).toBe(1);
    });

    it('counts nobody else’s company, on a role every tenant shares', async () => {
      /*
       * The defect this would have shipped: a system role belongs to no company,
       * so counting its memberships without scoping tells this company how many
       * estimators work at every other company on the platform — under a column
       * labeled "Users".
       */
      const other = (await h.asUser(ADMIN, () => h.sql<{ id: string }>(
        `select app.provision_company('Rival Civil','rival-civil','enterprise') as id`)))[0]!.id;
      await h.sql(`insert into company_memberships (company_id, user_id, role_id, status)
                   values ($1,$2,$3,'active')`, [other, HAND, estimatorRole]);
      const rows = await asOwner(() => h.sql<{ member_count: string }>(
        `select member_count from my_company_roles where id = $1`, [estimatorRole]));
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.member_count)).toBe(1);
    });

    it('lists the people with the role each holds', async () => {
      const rows = await asOwner(() => h.sql<{ full_name: string; role_key: string }>(
        `select full_name, role_key from my_company_members
          where company_id = $1 order by full_name`, [company]));
      expect(rows.map((r) => `${r.full_name}:${r.role_key}`)).toEqual([
        'Avery Admin:admin', 'Sam Hand:estimator', 'Tyree Owner:owner',
      ]);
    });

    it('says which roles are yours to edit and which are shipped', async () => {
      const [system] = await asOwner(() => h.sql<{ is_editable: boolean }>(
        `select is_editable from my_company_roles where id = $1`, [estimatorRole]));
      expect(system!.is_editable).toBe(false);
    });
  });

  describe('a role a company defines for itself', () => {
    let custom = '';

    it('is created with the permissions the owner actually holds', async () => {
      custom = (await one<{ id: string }>(
        `select public.create_company_role($1,'yard_foreman','Yard Foreman',
           array['fleet.read','hr.read'],'Runs the yard',1) as id`, [company])).id;
      const row = await one<{ name: string; permissions: string[]; is_editable: boolean }>(
        `select name, permissions, is_editable from my_company_roles where id = $1`, [custom]);
      expect(row.name).toBe('Yard Foreman');
      expect(row.is_editable).toBe(true);
    });

    it('refuses a permission that does not exist, rather than storing it', async () => {
      await expect(asOwner(() => h.sql(
        `select public.create_company_role($1,'ghost','Ghost',array['fleet.teleport'])`,
        [company]))).rejects.toThrow(/No such permission: fleet\.teleport/);
    });

    it('refuses a role that grants nothing', async () => {
      await expect(asOwner(() => h.sql(
        `select public.create_company_role($1,'empty','Empty',array[]::text[])`,
        [company]))).rejects.toThrow(/grants nothing/);
    });

    it('refuses a second role with a name that is already taken', async () => {
      await expect(asOwner(() => h.sql(
        `select public.create_company_role($1,'estimator','Estimator',array['estimates.read'])`,
        [company]))).rejects.toThrow(/already a role called estimator/);
    });

    it('will not let a shipped role be edited or removed', async () => {
      await expect(asOwner(() => h.sql(
        `select public.set_company_role($1,'Renamed')`, [estimatorRole])))
        .rejects.toThrow(/shipped role cannot be edited/);
      await expect(asOwner(() => h.sql(
        `select public.delete_company_role($1,$2)`, [estimatorRole, viewerRole])))
        .rejects.toThrow(/shipped role cannot be removed/);
    });

    it('moves the people into a named role when one is removed', async () => {
      const doomed = (await one<{ id: string }>(
        `select public.create_company_role($1,'temp_role','Temp',array['projects.read']) as id`,
        [company])).id;
      await asOwner(() => h.sql(`select public.set_member_role($1,$2)`, [handMembership, doomed]));

      await expect(asOwner(() => h.sql(
        `select public.delete_company_role($1,null)`, [doomed])))
        .rejects.toThrow(/Say which role to move these people into/);

      const [{ moved }] = await asOwner(() => h.sql<{ moved: number }>(
        `select public.delete_company_role($1,$2) as moved`, [doomed, estimatorRole]));
      expect(Number(moved)).toBe(1);
      const back = await one<{ role_key: string }>(
        `select role_key from my_company_members where id = $1`, [handMembership]);
      expect(back.role_key).toBe('estimator');
    });
  });

  describe('the escalation this screen would otherwise allow', () => {
    it('refuses a role granting everything', async () => {
      await expect(asOwner(() => h.sql(
        `select public.create_company_role($1,'god','Everything',array['*'])`, [company])))
        .rejects.toThrow(/cannot grant every permission/);
    });

    it('refuses a permission the person writing the role does not hold', async () => {
      /*
       * The whole point. `admin` carries users.manage, which is enough to write
       * a role — so an administrator could otherwise build one carrying a
       * permission reserved for the owner and put themselves in it.
       */
      const held = await h.asUser(ADMIN, () => h.sql<{ ok: boolean }>(
        `select app.has_permission($1,'billing.manage') as ok`, [company]));
      expect(held[0]!.ok).toBe(false);
      await expect(h.asUser(ADMIN, () => h.sql(
        `select public.create_company_role($1,'sneaky','Sneaky',array['billing.manage'])`,
        [company]))).rejects.toThrow(/cannot grant a permission you do not hold/);
    });

    it('refuses an approval tier above the writer’s own', async () => {
      await expect(h.asUser(ADMIN, () => h.sql(
        `select public.create_company_role($1,'signer','Signer',array['estimates.read'],null,4)`,
        [company]))).rejects.toThrow(/signs off above your own tier/);
    });

    it('will not let somebody change their own role', async () => {
      await expect(h.asUser(ADMIN, () => h.sql(
        `select public.set_member_role($1,$2)`, [adminMembership, viewerRole])))
        .rejects.toThrow(/cannot change your own role/);
    });

    it('will not let somebody suspend their own access', async () => {
      await expect(h.asUser(ADMIN, () => h.sql(
        `select public.set_member_status($1,'suspended')`, [adminMembership])))
        .rejects.toThrow(/cannot suspend or remove your own access/);
    });
  });

  describe('taking access away', () => {
    it('suspends a member, and restores them', async () => {
      await asOwner(() => h.sql(`select public.set_member_status($1,'suspended')`, [handMembership]));
      let row = await one<{ status: string }>(
        `select status from my_company_members where id = $1`, [handMembership]);
      expect(row.status).toBe('suspended');

      await asOwner(() => h.sql(`select public.set_member_status($1,'active')`, [handMembership]));
      row = await one<{ status: string }>(
        `select status from my_company_members where id = $1`, [handMembership]);
      expect(row.status).toBe('active');
    });

    it('keeps at least one active owner, whatever anybody asks for', async () => {
      const ownerMembership = (await one<{ id: string }>(
        `select id from company_memberships where company_id = $1 and user_id = $2`,
        [company, OWNER])).id;
      await expect(h.asUser(ADMIN, () => h.sql(
        `select public.set_member_status($1,'removed')`, [ownerMembership])))
        .rejects.toThrow(/at least one active owner/);
    });
  });

  describe('an invitation', () => {
    let invitation = '';
    let token = '';

    it('returns its token once, and stores only the hash', async () => {
      const row = await one<{ id: string; token: string }>(
        `select id, token from public.invite_member($1,'New.Hand@Example.com',$2)`,
        [company, estimatorRole]);
      invitation = row.id;
      token = row.token;
      expect(token).toMatch(/^[0-9a-f]{64}$/);

      const stored = await one<{ token_hash: string }>(
        `select token_hash from company_invitations where id = $1`, [invitation]);
      expect(stored.token_hash).not.toBe(token);
      expect(stored.token_hash).toBe(
        (await one<{ h: string }>(`select app.hash_api_key($1) as h`, [token])).h);
    });

    it('lowercases the address, so one person cannot be invited twice', async () => {
      const row = await one<{ email: string; state: string }>(
        `select email, state from my_company_invitations where id = $1`, [invitation]);
      expect(row.email).toBe('new.hand@example.com');
      expect(row.state).toBe('pending');

      await expect(asOwner(() => h.sql(
        `select public.invite_member($1,'NEW.HAND@example.com',$2)`, [company, estimatorRole])))
        .rejects.toThrow(/already has an invitation waiting/);
    });

    it('refuses to invite somebody who is already here', async () => {
      await expect(asOwner(() => h.sql(
        `select public.invite_member($1,'hand@admin.test',$2)`, [company, estimatorRole])))
        .rejects.toThrow(/already in this company/);
    });

    it('refuses an address that is not one', async () => {
      await expect(asOwner(() => h.sql(
        `select public.invite_member($1,'not-an-address',$2)`, [company, estimatorRole])))
        .rejects.toThrow(/not an email address/);
    });

    it('is revoked rather than deleted, so the record of it stays', async () => {
      await asOwner(() => h.sql(`select public.revoke_invitation($1)`, [invitation]));
      const row = await one<{ state: string; revoked_at: string | null }>(
        `select state, revoked_at from my_company_invitations where id = $1`, [invitation]);
      expect(row.state).toBe('revoked');
      expect(row.revoked_at).not.toBeNull();
    });
  });
});
