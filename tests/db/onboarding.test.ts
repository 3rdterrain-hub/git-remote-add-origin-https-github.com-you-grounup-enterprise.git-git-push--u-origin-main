import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * Signing up produces a company.
 *
 * Before migration 0059 it did not. `app.provision_company()` was complete,
 * correct and granted to `authenticated` since migration 0011, and nothing
 * outside the test suite had ever called it — so a real sign-up ended with a
 * profile and no tenant, and row level security correctly showed that person an
 * empty platform forever.
 */
describe('creating a company at sign-up', () => {
  let h: Harness;
  const alice = '11111111-1111-4111-8111-111111111111';
  const bob   = '22222222-2222-4222-8222-222222222222';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [[alice, 'alice@r.test'], [bob, 'bob@r.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2) on conflict (id) do nothing`,
        [id, email]);
    }
  });

  afterAll(async () => { await h?.db.close(); });

  it('turns a name into a company the caller owns', async () => {
    const [r] = await h.asUser(alice, () => h.sql<{ id: string }>(
      `select app.create_my_company('Ridgeline Construction') as id`));
    expect(r!.id).toMatch(/^[0-9a-f-]{36}$/);

    const [m] = await h.asUser(alice, () => h.sql<{
      name: string; slug: string; is_owner: boolean; role_key: string;
    }>(`select name, slug, is_owner, role_key from my_companies`));
    expect(m!.name).toBe('Ridgeline Construction');
    expect(m!.slug).toBe('ridgeline-construction');
    expect(m!.is_owner).toBe(true);
    expect(m!.role_key).toBe('owner');
  });

  it('leaves the company able to price an estimate immediately', async () => {
    /*
     * A tenant with no pricing profile can hold line items and cannot produce a
     * price, which would make the first thing a new customer tries fail. The
     * provisioning seeds overhead, profit and contingency; this asserts a
     * sign-up actually receives them.
     */
    const [p] = await h.asUser(alice, () => h.sql<{ code: string; components: string }>(
      `select p.code, count(m.id)::text as components
         from pricing_profiles p
         left join markup_components m on m.pricing_profile_id = p.id
        where p.is_default group by p.code`));
    expect(p!.code).toBe('PP-DEFAULT');
    expect(Number(p!.components)).toBe(3);
  });

  it('starts a bounded trial rather than an open-ended one', async () => {
    const [e] = await h.asUser(alice, () => h.sql<{
      plan_id: string; entitlement_source: string; entitlement_valid_until: string | null;
    }>(`select plan_id, entitlement_source, entitlement_valid_until from my_companies`));
    expect(e!.entitlement_source).toBe('trial');
    // An unpaid trial that never expires is a free product.
    expect(e!.entitlement_valid_until).not.toBeNull();
  });

  it('gives a second company the same name a different address', async () => {
    // Slugs are globally unique, so two customers with the same name is not an
    // error — it is Tuesday.
    const [r] = await h.asUser(bob, () => h.sql<{ id: string }>(
      `select app.create_my_company('Ridgeline Construction') as id`));
    const [m] = await h.asUser(bob, () => h.sql<{ slug: string }>(
      `select slug from my_companies where company_id = $1`, [r!.id]));
    expect(m!.slug).toBe('ridgeline-construction-1');
  });

  it('returns the same company when the form is submitted twice', async () => {
    /*
     * A slow network and an impatient click would otherwise leave somebody
     * owning two identical tenants with the trial split between them.
     */
    const [first] = await h.asUser(bob, () => h.sql<{ id: string }>(
      `select app.create_my_company('Second Venture') as id`));
    const [again] = await h.asUser(bob, () => h.sql<{ id: string }>(
      `select app.create_my_company('Second Venture') as id`));
    expect(again!.id).toBe(first!.id);

    const [n] = await h.asUser(bob, () => h.sql<{ count: string }>(
      `select count(*)::text from my_companies where name = 'Second Venture'`));
    expect(Number(n!.count)).toBe(1);
  });

  it('makes a slug out of a name that has no letters left', async () => {
    const [r] = await h.asUser(bob, () => h.sql<{ id: string }>(
      `select app.create_my_company('&&& ///') as id`));
    const [m] = await h.asUser(bob, () => h.sql<{ slug: string }>(
      `select slug from my_companies where company_id = $1`, [r!.id]));
    expect(m!.slug).toMatch(/^company/);
  });

  it('refuses a name that is not one', async () => {
    await expect(h.asUser(bob, () => h.sql(`select app.create_my_company(' ')`)))
      .rejects.toThrow(/needs a name/);
  });

  it("shows one person nothing of another person's companies", async () => {
    const rows = await h.asUser(alice, () => h.sql<{ name: string }>(
      `select name from my_companies order by name`));
    expect(rows.map((r) => r.name)).toEqual(['Ridgeline Construction']);
  });

  it('cannot be called by somebody who is not signed in', async () => {
    await expect(h.sql(`select app.create_my_company('Anonymous Co')`))
      .rejects.toThrow(/Sign in before creating a company/);
  });
});
