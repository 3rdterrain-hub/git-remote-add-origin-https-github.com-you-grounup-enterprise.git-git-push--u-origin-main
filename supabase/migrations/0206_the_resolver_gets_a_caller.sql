-- =============================================================================
-- 0206 — The resolver gets a caller
--
-- 0201 wrote `app.resolve_labor_rate` and nothing called it. `every-door-has-a-
-- reader` said so on the next run, which is the whole reason that test exists:
-- a rule with no caller is a rule that is not being applied, and this one
-- decides what a bid pays its people.
--
-- The temptation was to resolve in the Edge Function instead — it already has
-- the crews in memory, and it would have been fifteen lines. Rejected on the
-- ground this repository has already learned twice: two implementations of the
-- same rule disagree eventually, and the one that disagrees quietly here is a
-- wage. So the SQL function stays the only statement of it and the Edge
-- Function asks, once per version rather than once per worker.
--
-- `public.resolve_labor_rate` is dropped. A browser has no business resolving a
-- wage — the engine does that, under the service role, and a rate a browser
-- picked is exactly what 0058 exists to refuse.
-- =============================================================================

/**
 * Every crew member on a version, and the rate that prices it.
 *
 * One row per member, so the Edge Function makes one call rather than one per
 * worker — and every row goes through `app.resolve_labor_rate`, so the identity
 * property and the refusal both hold exactly as they do on their own. A version
 * naming no sheet returns each member's own rate, unchanged, and this is then a
 * mapping of every id to itself: correct, and cheap enough not to special-case.
 */
create or replace function app.resolved_labor_rates(p_version uuid)
returns table (crew_member_id uuid, labor_rate_id uuid)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select m.id, app.resolve_labor_rate(m.id, p_version)
    from crew_members m
   where m.crew_id in (
     select distinct l.crew_id from estimate_line_items l
      where l.estimate_version_id = p_version and l.crew_id is not null
   );
$$;

comment on function app.resolved_labor_rates(uuid) is
  'Every crew member on one estimate version with the rate that prices it. ENGINE support: one call rather than one per worker, and every row goes through app.resolve_labor_rate so there is one statement of the rule rather than two that can disagree about a wage.';

create or replace function public.resolved_labor_rates(p_version uuid)
returns table (crew_member_id uuid, labor_rate_id uuid)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$ select * from app.resolved_labor_rates(p_version); $$;

revoke all on function public.resolved_labor_rates(uuid) from public, anon;
grant execute on function public.resolved_labor_rates(uuid) to authenticated, service_role;

-- A browser has no business resolving a wage. The engine does it, under the
-- service role, for the same reason it is the only thing permitted to price.
drop function if exists public.resolve_labor_rate(uuid, uuid);

select app.assert_security_gates();
