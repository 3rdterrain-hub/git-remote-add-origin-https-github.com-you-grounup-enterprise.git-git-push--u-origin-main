-- =============================================================================
-- 0049 — The column every query filters on, unindexed on 53 tables
--
-- Row level security is the platform's central guarantee, and the way it works
-- is that every policy on every tenant-owned table predicates on `company_id`.
-- That predicate is added to every read, by every user, on every request —
-- there is no query against a governed table that does not filter on it.
--
-- 53 of the 136 tables had no index leading on that column. On those tables
-- every tenant-scoped read is a sequential scan of every tenant's rows, and the
-- larger the platform gets the worse it gets: the cost of reading one company's
-- daily reports grows with the number of companies on the platform, which is
-- exactly the property a multi-tenant system must not have.
--
-- It is not a correctness defect — row level security returns the right rows
-- either way — which is why nothing caught it. It is the difference between a
-- filter the database can satisfy from an index and one it satisfies by reading
-- everything and discarding almost all of it.
--
-- Created generatively rather than as 53 hand-written statements: the rule is
-- "a tenant-owned table has an index leading on its tenant key", and a rule
-- written once cannot be applied inconsistently. A governance test asserts the
-- same rule against the live catalog, so a table added later cannot arrive
-- without one.
--
-- @implements EDM-000002
-- =============================================================================

do $$
declare
  r record;
  v_name text;
begin
  for r in
    select c.oid, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'company_id' and a.attnum > 0
    where n.nspname = 'public'
      and c.relkind = 'r'
      -- An index whose *leading* column is the tenant key. A composite that
      -- mentions company_id second does not serve a filter on it alone.
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.oid and i.indkey[0] = a.attnum)
    order by c.relname
  loop
    v_name := r.relname || '_tenant_idx';
    execute format('create index if not exists %I on public.%I (company_id)', v_name, r.relname);
  end loop;
end;
$$;

comment on schema public is
  'GrounUp Enterprise. Every tenant-owned table carries company_id, is protected by forced row level security predicating on it, and has an index leading on it — the last of those added in migration 0049 and held by a governance test.';

select app.assert_security_gates();
