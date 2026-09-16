-- =============================================================================
-- 0195 — The volume writer, where the Edge Function can reach it
--
-- 0193 made `app.record_surface_comparison` the only writer of cut, fill, net,
-- areas, depths and coverage, and granted it to `service_role` alone. It left
-- out the half 0062 had to add for pricing and 0159 had to add for float:
-- PostgREST does not expose the `app` schema, so a function living only there
-- cannot be called over the wire by anything — including by the Edge Function
-- holding the service role.
--
-- Three migrations have now made the same mistake, which is a fair description
-- of the defect this repository keeps producing: the machinery was right, the
-- tests passed, and the door onto it was missing. `api-surface.test.ts` reads
-- every `rpc('…')` call site in the tree and insists the database exposes a
-- function of that name taking those argument names, which is what catches it.
--
-- The wrapper changes nothing about the boundary: `security invoker`, so the
-- security-definer function underneath still decides what happens, and granted
-- to `service_role` alone — never to `authenticated`, never to `anon`. A
-- browser reaches this exactly as far as it reached the function underneath it,
-- which is not at all.
-- =============================================================================

create or replace function public.record_surface_comparison(
  p_company uuid,
  p_project uuid,
  p_existing uuid,
  p_design uuid,
  p_name text,
  p_engine_version text,
  p_result jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  return app.record_surface_comparison(
    p_company, p_project, p_existing, p_design, p_name, p_engine_version, p_result);
end;
$$;

comment on function public.record_surface_comparison(uuid, uuid, uuid, uuid, text, text, jsonb) is
  'The PostgREST door onto app.record_surface_comparison. ENGINE: granted to service_role alone, because an earthwork quantity is not a permission a senior role can hold — it is what the job is bid and paid on.';

revoke all on function public.record_surface_comparison(uuid, uuid, uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_surface_comparison(uuid, uuid, uuid, uuid, text, text, jsonb)
  to service_role;

select app.assert_security_gates();
