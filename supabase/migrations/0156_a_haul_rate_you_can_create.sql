-- =============================================================================
-- 0156 — A haul rate you can actually create
--
-- `trucking_rates` has existed since migration 0004, gained three pricing bases
-- in 0067, and has never held a row. Not because nobody needed one — the fleet
-- tab reads it, `app.haul_cost` compares across it, `FromLibrary` offers haul
-- profiles from it, and 0151's typed picker searches it — but because
-- `company_id` is `not null`, so the platform cannot ship one, and nothing on
-- any screen could create one either. `createTruckingRate` has sat in the data
-- layer since the fleet work with no caller anywhere in the application.
--
-- So every one of those readers reads an empty table, and there was no way to
-- put anything in it short of SQL. A haul rate is a negotiated position with a
-- specific trucker — there is no catalog default for one, and that is exactly
-- why the company has to be able to enter its own.
--
-- This migration adds the one thing the screen cannot do safely for itself: a
-- code that does not collide. Two people adding a haul profile at the same
-- moment would both read the highest code and both write it, and the unique
-- index would refuse the second with a message about a constraint. The same
-- reasoning, and the same shape, as `app.next_company_material_code` in 0127.
--
-- Everything else about creating one is already permitted: 0010 put standard
-- tenant row level security on the table with `libraries.write`, so the insert
-- and the update are a company's own to make.
--
-- Library: the haul rates behind every trucking line.
-- =============================================================================

/**
 * The next unused haul code for a company: HAUL-0001, HAUL-0002.
 *
 * `security definer` and scoped to one company, like its sibling in 0127: the
 * caller may not be able to see every row that decides the number, and a code
 * that skips is harmless where a code that collides is an error message.
 */
create or replace function app.next_company_haul_code(p_company uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select 'HAUL-' || lpad((coalesce(max(substring(t.code from '^HAUL-(\d+)$')::int), 0) + 1)::text, 4, '0')
  from trucking_rates t
  where t.company_id = p_company and t.code ~ '^HAUL-\d+$';
$$;

comment on function app.next_company_haul_code(uuid) is
  'The next unused HAUL-0000 code for one company. LIBRARY support: a screen adding a haul profile should not have to pick a code, and two people adding one at the same moment should not collide.';

revoke all on function app.next_company_haul_code(uuid) from public, anon;
grant execute on function app.next_company_haul_code(uuid) to authenticated;

create or replace function public.next_company_haul_code(p_company uuid)
returns text language sql stable security invoker set search_path = public, pg_catalog
as $$ select app.next_company_haul_code(p_company); $$;

revoke all on function public.next_company_haul_code(uuid) from public, anon;
grant execute on function public.next_company_haul_code(uuid) to authenticated;

select app.assert_security_gates();
