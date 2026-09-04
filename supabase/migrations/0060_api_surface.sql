-- =============================================================================
-- 0060 — The API surface the configuration describes
--
-- `supabase/config.toml` publishes `public` and `graphql_public` to PostgREST,
-- and says why:
--
--     # `app` holds the platform's governance functions and is reached only
--     # through SECURITY DEFINER helpers the API schema exposes. It is
--     # deliberately not published: nothing should be able to call app.*
--     # directly over PostgREST.
--
-- The reasoning is right. The helpers do not exist. There is not one function
-- in `public`, and meanwhile seven call sites across the browser client and the
-- Edge Functions call `.rpc('has_permission')`, `.rpc('has_entitlement')`,
-- `.rpc('current_usage')`, `.rpc('ai_request_allowed')` and `.rpc('search')`.
-- Every one of them resolves to nothing on a real deployment.
--
-- The consequences are not uniform, and the worst of them is quiet:
--
--   * `requirePermission()` in `_shared/auth.ts` reads `data !== true` — an
--     undefined result from a missing function is not true, so it denies. The
--     authorization check fails closed, which is the right direction, and it
--     would have made every Edge Function unusable rather than unsafe.
--   * `has_entitlement` in the document analyst is compared `!== true` as well.
--     Also closed.
--   * `ai_request_allowed` is compared `=== false` before refusing. A missing
--     function returns undefined, which is not false, so the AI credit
--     allowance added in migration 0039 would not have been enforced at all.
--     That one fails open.
--
-- This migration writes the helpers the configuration always described, and a
-- governance test now walks every `.rpc()` call in the repository and fails the
-- build if the named function is not exposed with a matching argument list — so
-- a call added tomorrow cannot go missing the same way.
--
-- Each wrapper is a thin `security invoker` pass-through. It changes no
-- behavior: `app.has_permission` already reads `auth.uid()` and the caller's
-- own memberships, and row level security still applies underneath. What these
-- add is reachability, and nothing else.
-- =============================================================================

/** May the caller do this in this company? */
create or replace function public.has_permission(p_company uuid, p_permission text)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$ select app.has_permission(p_company, p_permission); $$;

/** Does this company's plan include this feature? */
create or replace function public.has_entitlement(p_company uuid, p_feature text)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$ select app.has_entitlement(p_company, p_feature); $$;

/** Authorization and entitlement are different questions; both must pass. */
create or replace function public.can_use(p_company uuid, p_feature text, p_permission text)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$ select app.can_use(p_company, p_feature, p_permission); $$;

/** Metered usage so far in the current paid period. */
create or replace function public.current_usage(p_company uuid, p_metric text)
returns numeric
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$ select app.current_usage(p_company, p_metric); $$;

/**
 * May this company make another AI request this period?
 *
 * The one that was failing open. The document analyst refuses only on an
 * explicit `false`, and a missing function returned undefined — so the credit
 * allowance published on every plan version was never actually checked.
 */
create or replace function public.ai_request_allowed(p_company uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$ select app.ai_request_allowed(p_company); $$;

/** Cross-entity search, scoped by row level security to the caller's own data. */
create or replace function public.search(p_query text, p_limit int default 25)
returns table (kind text, id uuid, title text, subtitle text, path text, rank real)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$ select * from app.search(p_query, p_limit); $$;

/** Create the caller's company. The one call a sign-up form makes. */
create or replace function public.create_my_company(p_name text, p_plan_id text default 'starter')
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$ begin return app.create_my_company(p_name, p_plan_id); end; $$;

-- -----------------------------------------------------------------------------
-- Grants
--
-- `anon` is absent from every one of these. An unauthenticated visitor has no
-- company, no entitlement and nothing to search, and each function would answer
-- them with a null rather than an error — which is the kind of quiet that hides
-- a misconfiguration.
-- -----------------------------------------------------------------------------
do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.has_permission(uuid, text)',
    'public.has_entitlement(uuid, text)',
    'public.can_use(uuid, text, text)',
    'public.current_usage(uuid, text)',
    'public.ai_request_allowed(uuid)',
    'public.search(text, int)',
    'public.create_my_company(text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated, service_role', v_sig);
  end loop;
end $$;

comment on function public.ai_request_allowed(uuid) is
  'The AI credit check. Exposed here because the Edge Function that calls it refuses only on an explicit false — and before migration 0060 the function it named did not exist, so the allowance was never enforced.';

select app.assert_security_gates();
