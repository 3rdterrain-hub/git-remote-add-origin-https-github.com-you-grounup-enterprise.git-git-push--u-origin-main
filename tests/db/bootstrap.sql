-- =============================================================================
-- Test-only bootstrap.
--
-- Supabase provides the `auth` schema, `auth.users` and `auth.uid()` in a real
-- project. PGlite is a bare PostgreSQL, so the harness creates the minimum
-- surface the migrations depend on. Nothing here ships to production — it
-- exists so the production migrations can run unmodified against real Postgres.
-- =============================================================================

create schema if not exists auth;

create table if not exists auth.users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  created_at    timestamptz not null default now()
);

-- Supabase resolves auth.uid() from the request JWT. The harness resolves it
-- from a session GUC, which is the same mechanism Supabase itself uses.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

-- Supabase's two API roles.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

-- Supabase grants the API roles access to auth.uid()/auth.role(). Without this
-- every policy that calls auth.uid() fails with "permission denied for schema
-- auth" rather than simply returning no rows.
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

-- Schema usage only. Table privileges are granted by migration 0012, which is
-- production code rather than test scaffolding.
grant usage on schema public to anon, authenticated, service_role;
