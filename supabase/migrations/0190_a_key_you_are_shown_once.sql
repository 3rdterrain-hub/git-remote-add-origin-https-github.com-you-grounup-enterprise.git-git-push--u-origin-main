-- =============================================================================
-- 0190 — A key you are shown once
--
-- `api_keys` is one of the better-designed tables in this schema. It stores only
-- a SHA-256 of the key, so a database read cannot be replayed against the API.
-- It carries a prefix for identifying a key in a log, a scope list, a rate limit
-- with a comment explaining that a key without one is "a denial-of-service
-- waiting to happen against your own database", an expiry, and a revocation that
-- the schema refuses without a reason. 0024 gave it row level security scoped to
-- `company.manage` and a trigger forbidding a hash to be rewritten in place.
--
-- Nothing could create one. No function, no screen, nowhere. The API Access page
-- lists sample keys from a fixture and its three buttons had no handlers. So the
-- API this platform sells — a deployed, authenticated, rate-limited, scoped
-- gateway with its own OpenAPI document — has never been usable by anyone,
-- because no key could be issued.
--
-- Two things matter in how a key is made, and both are the reason this is a
-- database function rather than a screen:
--
--   * **The secret is returned once and never stored.** `create_api_key` is the
--     only moment the plaintext exists. Everything afterwards reads a hash.
--   * **The screen does not choose it.** A key generated in a browser is a key
--     whose randomness nobody can account for, and it would travel to the server
--     to be hashed anyway. `gen_random_uuid()` is the source, because migration
--     0065 established that pgcrypto's `gen_random_bytes` lives in the
--     `extensions` schema on Supabase and a migration reaching for it
--     unqualified passes locally and fails on a real project.
--
-- ENTITY.
-- =============================================================================

/**
 * SHA-256 of an API key, hex — the form `api/index.ts` looks up by.
 *
 * The PostgreSQL built-in, for the reason 0166 gives: pgcrypto is installed
 * outside the default search path on Supabase and `digest()` unqualified is a
 * migration that works locally and breaks in production.
 */
create or replace function app.hash_api_key(p_key text)
returns text language sql immutable set search_path = public, pg_catalog
as $$ select encode(sha256(convert_to(p_key, 'utf8')), 'hex'); $$;

comment on function app.hash_api_key(text) is
  'SHA-256 of an API key, hex. The column is what the gateway matches on, so this and supabase/functions/api/index.ts must agree — both are a plain SHA-256 of the whole key. ENTITY.';

/**
 * Issue an API key. Returns the secret, once.
 *
 * The shape is `gu_<env>_<8 chars><32 chars>`, which is what
 * `gateway.ts:KEY_PATTERN` parses and what `api_keys.key_prefix` is checked
 * against. The first eight characters after the environment are the prefix and
 * are stored in clear; they identify a key in a log and authenticate nothing.
 *
 * `company.manage` rather than a lesser permission, matching the row level
 * security 0024 put on the table: a key is company-wide authority with a scope
 * list attached, and handing one out is an administrative act.
 */
create or replace function app.create_api_key(
  p_company     uuid,
  p_name        text,
  p_scopes      text[],
  p_rate_limit  int default 120,
  p_expires_at  timestamptz default null,
  p_environment text default 'live')
returns table (id uuid, key text, key_prefix text)
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'company.manage');
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_known   constant text[] := array[
    'projects:read', 'projects:write', 'estimates:read',
    'finance:read', 'finance:write', 'fleet:read', 'fleet:write',
    'workforce:read', 'workforce:write', 'metrics:read'];
  v_unknown text[];
  v_secret  text;
  v_key     text;
  v_prefix  text;
  v_id      uuid;
begin
  if v_name is null then
    raise exception 'A key needs a name'
      using errcode = 'check_violation',
            hint = 'What holds it: the accounting sync, the telematics feed, the BI job.';
  end if;
  if p_environment not in ('live', 'test') then
    raise exception 'A key is live or test' using errcode = 'check_violation';
  end if;
  if p_scopes is null or cardinality(p_scopes) = 0 then
    raise exception 'A key with no scopes can read nothing'
      using errcode = 'check_violation',
            hint = 'Give it the least it needs. A key is easier to widen than to take back.';
  end if;

  /*
   * An unknown scope is refused rather than ignored — the rule 0136 and 0139
   * settled for jsonb field names, and it matters more here: a scope that
   * matches nothing would produce a key somebody believes grants access it
   * does not have, and they would find out at the worst moment.
   */
  select array_agg(s) into v_unknown
    from unnest(p_scopes) s where s <> all (v_known);
  if v_unknown is not null then
    raise exception 'Unknown scope: %', array_to_string(v_unknown, ', ')
      using errcode = 'check_violation',
            hint = 'The gateway knows ' || array_to_string(v_known, ', ') || '.';
  end if;
  if coalesce(p_rate_limit, 120) not between 1 and 10000 then
    raise exception 'A rate limit is between 1 and 10000 requests a minute'
      using errcode = 'check_violation';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'That expiry is already past' using errcode = 'check_violation';
  end if;

  /*
   * Forty characters of randomness from two uuids. Hex is a subset of
   * [A-Za-z0-9], which is what the gateway's pattern and the table's check both
   * require. The secret exists in exactly one place — this variable — and is
   * returned to the caller once; only its hash is written down.
   */
  v_secret := replace(gen_random_uuid()::text, '-', '')
           || replace(gen_random_uuid()::text, '-', '');
  v_prefix := 'gu_' || p_environment || '_' || substring(v_secret from 1 for 8);
  v_key    := v_prefix || substring(v_secret from 9 for 32);

  insert into api_keys (
    company_id, name, key_hash, key_prefix, scopes,
    rate_limit_per_minute, expires_at, created_by)
  values (
    v_company, v_name, app.hash_api_key(v_key), v_prefix, p_scopes,
    coalesce(p_rate_limit, 120), p_expires_at, auth.uid())
  returning api_keys.id into v_id;

  return query select v_id, v_key, v_prefix;
end;
$$;

comment on function app.create_api_key(uuid, text, text[], int, timestamptz, text) is
  'Issues an API key and returns the secret once. The first writer of api_keys anywhere: the table, its row level security, its rewrite guard and the whole gateway existed and no key could ever be made, so the API this platform sells had never been usable. ENTITY.';

/**
 * Revoke a key.
 *
 * The reason is required because the schema requires it — `api_keys_revoked`
 * refuses a revocation without one — and because the question six months later
 * is never "was this revoked" but "why". Revoking is not deleting: the request
 * history in `api_requests` points at the key, and a key that vanishes takes
 * the explanation of its own traffic with it.
 */
create or replace function app.revoke_api_key(p_key uuid, p_reason text)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid; v_revoked timestamptz;
begin
  select company_id, revoked_at into v_company, v_revoked from api_keys where id = p_key;
  if v_company is null then
    raise exception 'No such key' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'company.manage') then
    raise exception 'Revoking a key needs the company.manage permission'
      using errcode = 'insufficient_privilege';
  end if;
  if v_revoked is not null then
    raise exception 'That key was already revoked' using errcode = 'check_violation';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say why it is being revoked'
      using errcode = 'check_violation',
            hint = 'Rotated, the integration was retired, it leaked. The next person reads this.';
  end if;

  update api_keys
     set revoked_at = now(), revoked_by = auth.uid(),
         revoke_reason = btrim(p_reason), updated_at = now()
   where id = p_key;
end;
$$;

comment on function app.revoke_api_key(uuid, text) is
  'Revokes a key with the reason the schema requires. Never deletes: api_requests points at the key, and one that vanishes takes the explanation of its own traffic with it. ENTITY.';

/**
 * The company's keys, and what each has actually done.
 *
 * Never the hash. It authenticates nothing on its own — the gateway matches the
 * SHA-256 of a whole key — but there is no reason for it to travel to a browser,
 * and a column that never leaves the database cannot leak from one.
 */
create or replace view my_api_keys
with (security_invoker = true) as
select k.id,
       k.company_id,
       k.name,
       k.key_prefix,
       k.scopes,
       k.rate_limit_per_minute,
       k.expires_at,
       k.last_used_at,
       k.request_count,
       k.revoked_at,
       k.revoke_reason,
       k.created_at,
       coalesce(u.full_name, u.email)                        as created_by,
       coalesce(r.email, r.full_name)                        as revoked_by,
       (k.revoked_at is not null)                            as is_revoked,
       (k.expires_at is not null and k.expires_at <= now())  as is_expired,
       (select count(*) from api_requests q
         where q.api_key_id = k.id
           and q.occurred_at >= now() - interval '30 days')  as requests_30_days,
       (select count(*) from api_requests q
         where q.api_key_id = k.id
           and q.status_code >= 400
           and q.occurred_at >= now() - interval '30 days')  as errors_30_days
  from api_keys k
  left join user_profiles u on u.id = k.created_by
  left join user_profiles r on r.id = k.revoked_by;

comment on view my_api_keys is
  'Every key with what it has done, and never its hash. ENTITY. The prefix identifies a key in a log; it authenticates nothing, which is why it is the only part of a key that is ever shown again.';

revoke all on my_api_keys from public, anon;
grant select on my_api_keys to authenticated, service_role;

create or replace function public.create_api_key(
  p_company uuid, p_name text, p_scopes text[], p_rate_limit int default 120,
  p_expires_at timestamptz default null, p_environment text default 'live')
returns table (id uuid, key text, key_prefix text)
language sql security invoker set search_path = public, pg_catalog
as $$ select * from app.create_api_key(p_company, p_name, p_scopes, p_rate_limit,
       p_expires_at, p_environment); $$;

create or replace function public.revoke_api_key(p_key uuid, p_reason text)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.revoke_api_key(p_key, p_reason); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.create_api_key(uuid, text, text[], int, timestamptz, text)',
    'public.revoke_api_key(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
