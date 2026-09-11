-- =============================================================================
-- 0142 — A project you can open
--
-- `projects.tsx` has read live projects since the semantic layer landed. The
-- page it links to has never read one: `project-detail.tsx` opens `PROJECTS`
-- from `@/data/operations` and shows invented daily reports, invented change
-- orders, invented RFIs and invented submittals. A person clicks a real project
-- number and lands on somebody else's job. It is the billing-page defect one
-- screen over, and worse in one respect — a daily report is evidence in a
-- claim, and an invented one sitting under a real project number is the kind of
-- thing that gets read out in a deposition.
--
-- Almost everything the screen needs is already there and already governed:
-- `daily_reports` with its labor, equipment and production children (0007,
-- 0013), `change_orders` with items, `rfis` (0006), `submittals` (0013), and
-- `reporting_project_financials` / `reporting_wip` (0025, 0057). Those are read
-- directly, through row level security, with PostgREST embeds. Nothing is
-- rebuilt here that exists.
--
-- Two things genuinely did not exist:
--
--   * **The people and the place.** A project names a project manager and a
--     superintendent by `auth.users(id)`, which no tenant may read, so no embed
--     can resolve either into a name. Same for the customer when the screen
--     wants one string rather than a nested object.
--   * **What the job has actually earned.** `project_tasks` has carried
--     `budgeted_cost`, `actual_cost`, `percent_complete`, `budgeted_hours`,
--     `actual_hours` and `installed_quantity` since 0007 and is read by nothing
--     at all — no view, no screen, no function. It is the only place an earned
--     value exists.
--
-- And one figure is deliberately *not* restored. The fixture screen showed a
-- cost performance index computed as (budget x percent complete) / actual cost,
-- with percent complete coming from the fixture. The live percent complete in
-- `reporting_wip` is cost-to-cost — actual cost over budget — so that same
-- formula would reduce to actual cost over actual cost and print 1.00 on every
-- project in the platform, forever, while looking like a measurement. CPI here
-- is earned value over actual cost, where earned value is the sum of each
-- task's budget times its own percent complete, and it is null when no task
-- carries a budget. A project whose work has not been broken down has not
-- earned anything measurable, and saying so is the only honest answer.
--
-- Entity: Project.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- What a project has earned
--
-- Earned value, from the tasks. Null rather than zero wherever the denominator
-- is missing, the rule migration 0057 set for work in progress: a project with
-- no budgeted tasks is not a project that is 0% complete, it is one nobody has
-- broken down yet, and the two look identical once a null becomes a zero.
-- -----------------------------------------------------------------------------
create or replace view reporting_project_earned_value
with (security_invoker = true) as
select
  t.company_id,
  t.project_id,
  count(*)::int                                          as tasks,
  count(*) filter (where t.status = 'complete')::int      as tasks_complete,
  sum(t.budgeted_cost)                                    as budgeted_cost,
  sum(t.actual_cost)                                      as task_actual_cost,
  sum(t.budgeted_hours)                                   as budgeted_hours,
  sum(t.actual_hours)                                     as actual_hours,

  -- BCWP: what the budget said the finished part of the work was worth.
  case when sum(t.budgeted_cost) > 0
       then round(sum(t.budgeted_cost * t.percent_complete), 2) end as earned_value,

  -- Progress weighted by money rather than by task count, because ten pipe
  -- fittings and one lift station are not one eleventh of the job each.
  case when sum(t.budgeted_cost) > 0
       then round(sum(t.budgeted_cost * t.percent_complete) / sum(t.budgeted_cost), 6)
       end                                                as percent_complete,

  -- CPI: earned over spent. Above 1.00 is work delivered for less than it was
  -- budgeted at; below is margin going out of the job.
  case when sum(t.budgeted_cost) > 0 and sum(t.actual_cost) > 0
       then round(sum(t.budgeted_cost * t.percent_complete) / sum(t.actual_cost), 4)
       end                                                as cost_performance_index,

  -- The same question asked of hours, which is the one a superintendent feels
  -- first: labor burns before the invoices arrive.
  case when sum(t.budgeted_hours) > 0 and sum(t.actual_hours) > 0
       then round(sum(t.budgeted_hours * t.percent_complete) / sum(t.actual_hours), 4)
       end                                                as hours_performance_index
from project_tasks t
where t.status <> 'canceled'
group by t.company_id, t.project_id;

comment on view reporting_project_earned_value is
  'Earned value from the project''s own tasks: budget times percent complete, summed. Every ratio is null where its denominator is zero, because a project nobody has broken down has not earned nothing — it has earned an amount no one can compute, and those are different answers.';

revoke all on reporting_project_earned_value from public, anon;
grant select on reporting_project_earned_value to authenticated;

-- -----------------------------------------------------------------------------
-- The project, with the names on it
--
-- A screen showing "Project manager: 4f2a…-8c1e" is a screen nobody uses. The
-- ids point at `auth.users`, which is not readable by a tenant, so the names
-- have to be resolved here or not at all.
-- -----------------------------------------------------------------------------
create or replace view my_project
with (security_invoker = true) as
select
  p.id,
  p.company_id,
  p.number,
  p.name,
  p.description,
  p.status,
  p.contract_type,
  p.contract_value,
  p.original_budget,
  p.approved_budget,
  p.site_address,
  p.site_city,
  p.site_state,
  p.latitude,
  p.longitude,
  p.planned_start,
  p.planned_finish,
  p.actual_start,
  p.actual_finish,
  p.retainage_percent,
  p.customer_id,
  cu.name                                        as customer_name,
  p.project_manager_id,
  coalesce(pm.full_name, pm.email)               as project_manager,
  p.superintendent_id,
  coalesce(su.full_name, su.email)               as superintendent,
  p.source_estimate_version_id,
  /*
   * The estimate this job was awarded from. A project manager asking "what did
   * we bid this at" is asking about one specific priced version, and the link
   * to it is the answer — `app.award_estimate` recorded which one.
   */
  e.number                                       as source_estimate_number,
  ev.version_number                              as source_version_number,
  p.created_at,
  p.updated_at
from projects p
left join customers cu on cu.id = p.customer_id
left join user_profiles pm on pm.id = p.project_manager_id
left join user_profiles su on su.id = p.superintendent_id
left join estimate_versions ev on ev.id = p.source_estimate_version_id
left join estimates e on e.id = ev.estimate_id;

comment on view my_project is
  'A project as a screen needs it: the customer, the two people responsible and the estimate it was awarded from, resolved into names. Row level security on `projects` decides what is visible; this view only spares every caller the four joins.';

revoke all on my_project from public, anon;
grant select on my_project to authenticated;

select app.assert_security_gates();
