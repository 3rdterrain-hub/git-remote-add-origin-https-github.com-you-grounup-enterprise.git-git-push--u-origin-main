/**
 * A key you are shown once.
 *
 * `api_keys` is one of the better-designed tables here — hash only, a prefix for
 * logs, scopes, a rate limit, an expiry, a revocation the schema refuses without
 * a reason, row level security scoped to `company.manage`, and a trigger
 * forbidding a hash to be rewritten. And nothing could create one, anywhere, so
 * the authenticated rate-limited scoped API this platform sells had never been
 * usable by anybody.
 *
 * The test that matters is the last pair: the secret is returned once and what
 * is stored cannot be replayed.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '4c8c8c8c-8c8c-4c8c-8c8c-8c8c8c8c8c8c';

describe('a key you are shown once', () => {
  let h: Harness;
  let company = '';
  let issued = '';
  let keyId = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@api.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@api.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Api Civil','api-civil','enterprise') as id`)))[0]!.id;
  });

  it('issues a key in the shape the gateway parses', async () => {
    const [row] = await h.asUser(OWNER, () => h.sql<{
      id: string; key: string; key_prefix: string;
    }>(`select * from public.create_api_key($1,'Accounting sync',
         array['projects:read','finance:read'], 240)`, [company]));
    issued = row!.key; keyId = row!.id;
    /* gateway.ts: /^gu_(live|test)_([A-Za-z0-9]{8})([A-Za-z0-9]{32})$/ */
    expect(issued).toMatch(/^gu_(live|test)_[A-Za-z0-9]{8}[A-Za-z0-9]{32}$/);
    expect(row!.key_prefix).toBe(issued.slice(0, 16));
    expect(row!.key_prefix).toMatch(/^gu_[a-z]{4}_[A-Za-z0-9]{8}$/);
  });

  it('stores a hash and never the key', async () => {
    const [row] = await h.asUser(OWNER, () => h.sql<{
      key_hash: string; key_prefix: string;
    }>(`select key_hash, key_prefix from api_keys where id = $1`, [keyId]));
    expect(row!.key_hash).toMatch(/^[a-f0-9]{64}$/);
    /* Nothing readable from the database can be replayed against the endpoint. */
    expect(row!.key_hash).not.toContain(issued);
    expect(issued).not.toContain(row!.key_hash);
  });

  it('hashes the way the gateway hashes, or no key would ever authenticate', async () => {
    const [row] = await h.asUser(OWNER, () => h.sql<{ same: boolean }>(
      `select (select key_hash from api_keys where id = $1) = app.hash_api_key($2) as same`,
      [keyId, issued]));
    expect(row!.same).toBe(true);
  });

  it('refuses a scope the gateway does not know, rather than ignoring it', async () => {
    /*
     * The rule 0136 and 0139 settled for jsonb keys, and it matters more here:
     * a scope that matched nothing would produce a key somebody believes grants
     * access it does not have.
     */
    await expect(h.asUser(OWNER, () => h.sql(
      `select * from public.create_api_key($1,'Wrong', array['projects:delete'])`,
      [company]))).rejects.toThrow(/Unknown scope: projects:delete/i);
  });

  it('refuses a key with no scopes, which could read nothing', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select * from public.create_api_key($1,'Empty', array[]::text[])`, [company])))
      .rejects.toThrow(/no scopes can read nothing/i);
  });

  it('refuses a rate limit that would let a key flood the database', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select * from public.create_api_key($1,'Fast', array['metrics:read'], 99999)`,
      [company]))).rejects.toThrow(/between 1 and 10000/i);
  });

  it('shows the key with what it has done, and never its hash', async () => {
    const [row] = await h.asUser(OWNER, () => h.sql<{
      name: string; key_prefix: string; scopes: string[]; is_revoked: boolean;
      requests_30_days: string; created_by: string;
    }>(`select name, key_prefix, scopes, is_revoked, requests_30_days, created_by
          from my_api_keys where id = $1`, [keyId]));
    expect(row!.name).toBe('Accounting sync');
    expect(row!.scopes).toEqual(['projects:read', 'finance:read']);
    expect(row!.is_revoked).toBe(false);
    expect(Number(row!.requests_30_days)).toBe(0);
    expect(row!.created_by).toBe('o@api.test');
    const cols = await h.asUser(OWNER, () => h.sql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'my_api_keys'`));
    expect(cols.map((c) => c.column_name)).not.toContain('key_hash');
  });

  it('revokes with a reason, and will not revoke twice', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select public.revoke_api_key($1,'')`, [keyId])))
      .rejects.toThrow(/Say why it is being revoked/i);

    await h.asUser(OWNER, () => h.sql(
      `select public.revoke_api_key($1,'Rotated after the integration was rebuilt')`,
      [keyId]));
    const [row] = await h.asUser(OWNER, () => h.sql<{
      is_revoked: boolean; revoke_reason: string;
    }>(`select is_revoked, revoke_reason from my_api_keys where id = $1`, [keyId]));
    expect(row!.is_revoked).toBe(true);
    expect(row!.revoke_reason).toMatch(/Rotated/);

    await expect(h.asUser(OWNER, () => h.sql(
      `select public.revoke_api_key($1,'Again')`, [keyId])))
      .rejects.toThrow(/already revoked/i);
  });

  it('will not let a key be rewritten in place', async () => {
    /* 0024's guard: rotation issues a new key, it does not edit a hash. */
    await expect(h.asService(() => h.sql(
      `update api_keys set key_hash = repeat('a', 64) where id = $1`, [keyId])))
      .rejects.toThrow(/cannot be rewritten in place/i);
  });

  it('issues two keys that are not the same', async () => {
    const one = (await h.asUser(OWNER, () => h.sql<{ key: string }>(
      `select key from public.create_api_key($1,'One', array['metrics:read'])`,
      [company])))[0]!.key;
    const two = (await h.asUser(OWNER, () => h.sql<{ key: string }>(
      `select key from public.create_api_key($1,'Two', array['metrics:read'])`,
      [company])))[0]!.key;
    expect(one).not.toBe(two);
    expect(one.slice(0, 16)).not.toBe(two.slice(0, 16));
  });
});
