-- =============================================================================
-- 0159 — The schedule writer, where the Edge Function can reach it
--
-- 0158 made `app.record_schedule_calculation` the only writer of float and
-- granted it to `service_role` alone. It left out the half that migration 0062
-- had already had to add for pricing: PostgREST does not expose the `app`
-- schema, so a function living only there cannot be called over the wire by
-- anything — including by the Edge Function holding the service role.
--
-- `api-surface.test.ts` caught it, which is exactly what that test is for: it
-- reads every `rpc('…')` call site in the repository and insists the database
-- actually exposes a function of that name taking those argument names. A
-- wrapper with the right name and the wrong parameter names is as broken as no
-- wrapper at all, and both halves are checked.
--
-- The wrapper changes nothing about the boundary, for the same reasons 0062
-- gave: `security invoker`, so the security-definer function underneath still
-- decides what happens, and granted to `service_role` alone — never to
-- `authenticated`, never to `anon`. A browser session reaches this exactly as
-- far as it reached the function underneath it, which is not at all.
-- =============================================================================

create or replace function public.record_schedule_calculation(
  p_company uuid,
  p_project uuid,
  p_data_date date,
  p_engine_version text,
  p_calendar uuid,
  p_project_start date,
  p_project_finish date,
  p_duration_working_days int,
  p_required_finish date,
  p_finish_float_days int,
  p_critical_path uuid[],
  p_warnings text[],
  p_activities jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  return app.record_schedule_calculation(
    p_company, p_project, p_data_date, p_engine_version, p_calendar,
    p_project_start, p_project_finish, p_duration_working_days,
    p_required_finish, p_finish_float_days, p_critical_path, p_warnings,
    p_activities);
end;
$$;

comment on function public.record_schedule_calculation(
  uuid, uuid, date, text, uuid, date, date, int, date, int, uuid[], text[], jsonb) is
  'The PostgREST door onto app.record_schedule_calculation. ENGINE: granted to service_role alone, because a critical path is not a permission a senior role can hold.';

-- The boundary, restated where it can be checked. `authenticated` is absent on
-- purpose, the same way it is absent from the pricing writer.
revoke all on function public.record_schedule_calculation(
  uuid, uuid, date, text, uuid, date, date, int, date, int, uuid[], text[], jsonb)
  from public, anon, authenticated;
grant execute on function public.record_schedule_calculation(
  uuid, uuid, date, text, uuid, date, date, int, date, int, uuid[], text[], jsonb)
  to service_role;

select app.assert_security_gates();
