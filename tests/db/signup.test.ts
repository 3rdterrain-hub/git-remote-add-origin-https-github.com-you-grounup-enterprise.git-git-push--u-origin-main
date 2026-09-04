/**
 * What happens when somebody signs up.
 *
 * @implements CPF-000006
 *
 * `app.handle_new_user()` creates the application profile when Supabase Auth
 * creates a user. It has existed since migration 0011, it is correct, and until
 * migration 0055 **nothing attached it** — its own comment read "Attach with:
 * create trigger on_auth_user_created ...", which is an instruction sitting in
 * a database rather than a trigger.
 *
 * On a real deployment that means the first person to sign up gets no profile,
 * and every join that resolves a person finds nothing. It survived because the
 * harness creates `auth.users` itself and every test wrote its own profile
 * alongside the user, so no test ever took the path a real sign-up takes.
 *
 * These do, and write no profile of their own.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('signing up creates the profile behind it', () => {
  let h: Harness;

  beforeAll(async () => { h = await createHarness({ seed: true }); }, 180_000);
  afterAll(async () => { await h?.db.close(); });

  it('creates a profile with no explicit insert anywhere', async () => {
    const id = '9a1e4f20-0000-4000-8000-000000000001';
    await h.sql(`insert into auth.users (id, email) values ($1,'newcomer@ridgeline.test')`, [id]);
    const [row] = await h.sql<{ email: string; full_name: string | null }>(
      `select email, full_name from user_profiles where id = $1`, [id]);
    expect(row, 'no profile was created for the new user').toBeTruthy();
    expect(row!.email).toBe('newcomer@ridgeline.test');
  });

  it('carries the name from the sign-up metadata', async () => {
    const id = '9a1e4f20-0000-4000-8000-000000000002';
    await h.sql(
      `insert into auth.users (id, email, raw_user_meta_data)
       values ($1,'named@ridgeline.test','{"full_name":"Dana Whitfield"}'::jsonb)`, [id]);
    const [row] = await h.sql<{ full_name: string | null }>(
      `select full_name from user_profiles where id = $1`, [id]);
    expect(row!.full_name).toBe('Dana Whitfield');
  });

  it('leaves the name null rather than blank when the metadata carries none', async () => {
    const id = '9a1e4f20-0000-4000-8000-000000000003';
    await h.sql(
      `insert into auth.users (id, email, raw_user_meta_data)
       values ($1,'blank@ridgeline.test','{"full_name":"   "}'::jsonb)`, [id]);
    const [row] = await h.sql<{ full_name: string | null }>(
      `select full_name from user_profiles where id = $1`, [id]);
    expect(row!.full_name).toBeNull();
  });

  it('is harmless when a caller also writes the profile', async () => {
    // Idempotent by design, which is what let this be attached without
    // rewriting every suite that creates a user.
    const id = '9a1e4f20-0000-4000-8000-000000000004';
    await h.sql(`insert into auth.users (id, email) values ($1,'both@ridgeline.test')`, [id]);
    await h.sql(
      `insert into user_profiles (id, email) values ($1,'both@ridgeline.test')
       on conflict (id) do nothing`, [id]);
    const [row] = await h.sql<{ n: string }>(
      `select count(*) as n from user_profiles where id = $1`, [id]);
    expect(Number(row!.n)).toBe(1);
  });

  it('lets that person provision a company end to end', async () => {
    /*
     * The whole sign-up path in one test: a user appears in auth, a profile
     * follows, and that profile can provision a company with its owner
     * membership, roles, entitlement and trial. Before 0055 the first step
     * produced nothing and everything after it had no person to attach to.
     */
    const id = '9a1e4f20-0000-4000-8000-000000000005';
    await h.sql(`insert into auth.users (id, email) values ($1,'founder@vale.test')`, [id]);
    const [company] = await h.asUser(id, () => h.sql<{ id: string }>(
      `select app.provision_company('Vale Excavation','vale-excavation','starter') as id`));
    expect(company!.id).toBeTruthy();

    const [member] = await h.asUser(id, () => h.sql<{ status: string }>(
      `select status from company_memberships where user_id = $1 and company_id = $2`,
      [id, company!.id]));
    expect(member!.status).toBe('active');
  });
});
