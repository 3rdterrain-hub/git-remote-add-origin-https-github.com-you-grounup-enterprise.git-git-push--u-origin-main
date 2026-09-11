-- =============================================================================
-- 0145 — The door onto awarding
--
-- `app.award_estimate_version` has existed since migration 0007. It creates the
-- project, copies every priced line into `project_tasks` with its budgeted
-- hours and budgeted cost, moves the estimate and the version to `awarded`, and
-- writes an audit event. It is granted to `authenticated`. It is tested.
--
-- It has no `public.` wrapper, so PostgREST cannot reach it, so no browser can
-- call it, so nothing in the application ever has. The Projects screen says
-- "A project appears here when an estimate is awarded, or when somebody creates
-- one" and the first half of that sentence was not true of any deployment.
--
-- That is the thirteenth instance of this build's signature defect, and the
-- most consequential: it is the join between estimating and operations. Every
-- screen downstream of it — the project page, its earned value, its daily
-- reports, its change orders, the site forecast — was reachable only by
-- inserting a project by hand.
--
-- The door inventory did not catch it either, because it looks for `public.*`
-- functions and `my_*` views. An `app.*` function granted to `authenticated`
-- with no public wrapper is invisible to the scan for the same reason it is
-- invisible to PostgREST. `scripts/build-door-inventory.mjs` now counts those
-- too.
--
-- Workflow: award.
-- =============================================================================

create or replace function public.award_estimate_version(
  p_version_id uuid,
  p_project_number text,
  p_project_name text
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  return app.award_estimate_version(p_version_id, p_project_number, p_project_name);
end;
$$;

comment on function public.award_estimate_version(uuid, text, text) is
  'Turns an approved or issued estimate version into a project, copying every priced line into project_tasks with its budgeted hours and cost. The browser-reachable wrapper over app.award_estimate_version, which had none for thirteen migrations and so could not be called from any screen.';

revoke all on function public.award_estimate_version(uuid, text, text) from public, anon;
grant execute on function public.award_estimate_version(uuid, text, text) to authenticated;

select app.assert_security_gates();
