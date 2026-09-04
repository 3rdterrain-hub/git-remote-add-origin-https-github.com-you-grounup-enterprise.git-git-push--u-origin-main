-- =============================================================================
-- 0062 — The engine's door has to be reachable from where the engine stands
--
-- Migration 0058 made `app.record_engine_result()` the only writer of a price
-- and granted it to `service_role` alone. Migration 0060 exposed the API
-- surface the configuration described and added a governance test that walks
-- every `.rpc()` call in the repository.
--
-- That test then caught the pricing function this build had just written. The
-- Edge Function calls `.rpc('record_engine_result')` through a service-role
-- client, which reaches PostgREST, which publishes `public` and not `app` — so
-- the one write that gives an estimate a price would have resolved to nothing
-- on a real deployment, and the button would have reported success having
-- written nothing at all.
--
-- Caught by a test written two commits earlier against a defect of exactly this
-- shape, on code written after it. That is the whole argument for a guard that
-- walks the call sites rather than a list somebody maintains.
--
-- The wrapper changes nothing about the boundary. It is `security invoker`, so
-- it runs as whoever called it and the security-definer function underneath
-- still decides what happens; and it is granted to `service_role` alone, never
-- to `authenticated` and never to `anon`. A browser session reaches this
-- exactly as far as it reached the function underneath it: not at all.
-- =============================================================================

create or replace function public.record_engine_result(
  p_version_id     uuid,
  p_engine_version text,
  p_version        jsonb,
  p_lines          jsonb default '[]'::jsonb,
  p_resources      jsonb default '[]'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  perform app.record_engine_result(
    p_version_id, p_engine_version, p_version, p_lines, p_resources);
end;
$$;

-- The boundary, restated where it can be checked. `authenticated` is absent on
-- purpose: pricing is not a permission a senior role can hold.
revoke all on function public.record_engine_result(uuid, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_engine_result(uuid, text, jsonb, jsonb, jsonb)
  to service_role;

comment on function public.record_engine_result(uuid, text, jsonb, jsonb, jsonb) is
  'Reachable over PostgREST by the Edge Function that hosts the estimating engine, and by nothing else. security invoker, so the security-definer function underneath still decides; granted to service_role alone, so a browser session cannot call it however senior the person signed in.';

select app.assert_security_gates();
