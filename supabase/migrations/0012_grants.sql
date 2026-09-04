-- =============================================================================
-- GrounUp Enterprise — 0012 Table privileges
--
-- RLS decides which *rows* a request may see. GRANT decides whether the request
-- may touch the table at all. Both are set explicitly here so the anonymous
-- role is denied at the privilege layer rather than relying on a policy to
-- return zero rows — two independent controls, so a policy mistake on one table
-- cannot expose business data to the public API.
-- =============================================================================

-- The anonymous role starts with nothing.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Authenticated requests reach every table, and RLS decides the rows.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- The service role is used only by Edge Functions and bypasses RLS by design.
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- The only tables an unauthenticated visitor may read: the public plan catalog,
-- which the pricing page must render before anyone signs in. Both are further
-- restricted by RLS to rows flagged active and public.
grant select on plans to anon;
grant select on plan_prices to anon;

-- Views inherit the privileges of their own definition, so grant explicitly.
grant select on rls_coverage to authenticated, service_role;

-- Tables added by future migrations inherit these defaults automatically.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Privilege gate
--
-- Fails the migration if the anonymous role can read anything other than the
-- public plan catalog.
-- -----------------------------------------------------------------------------
do $$
declare
  v_leaks text[];
begin
  select array_agg(c.relname order by c.relname) into v_leaks
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'v')
    and c.relname not in ('plans', 'plan_prices')
    and has_table_privilege('anon', c.oid, 'SELECT');

  if v_leaks is not null then
    raise exception 'Privilege gate failed. The anon role can read: %', array_to_string(v_leaks, ', ');
  end if;
end $$;
