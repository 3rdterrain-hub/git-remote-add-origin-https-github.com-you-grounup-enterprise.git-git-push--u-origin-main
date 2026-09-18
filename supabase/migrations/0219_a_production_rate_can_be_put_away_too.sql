-- =============================================================================
-- 0219 — A production rate can be put away too
--
-- `my_production_rates` filters to `status in ('active','draft')` and does not
-- project the status at all, so the archive control added in 0217 had nothing
-- to read and nothing to show. An archived rate simply disappeared, which is
-- the behavior the owner lost a crew to.
--
-- Two changes, both small:
--
--   * **`status` is projected**, so a screen can tell a live rate from one that
--     was put away, and offer the way back.
--   * **`archived` joins the filter.** It was excluded, so an archived rate
--     could never be seen again by anybody — the row survived and was
--     unreachable, which is the worst of both.
--
-- `superseded_by_id is null` stays exactly as it was: a rate replaced by a
-- newer one is not archived, it is *superseded*, and showing both would put two
-- answers to the same question in front of an estimator.
-- =============================================================================

create or replace view my_production_rates
with (security_invoker = true) as
select pr.id,
       pr.company_id,
       pr.code,
       pr.rate_per_hour,
       pr.rate_unit,
       pr.utilization_factor,
       pr.shift_hours,
       pr.source_type,
       pr.confidence_score,
       pr.sample_size,
       pr.approval_state,
       pr.region,
       pr.effective_date,
       pr.controlling_resource,
       pr.equipment_spread,
       pr.company_id is not null as is_own,
       t.id   as task_id,
       t.code as task_code,
       t.name as task_name,
       t.category as task_category,
       /*
        * Appended rather than placed beside the other row facts: `create or
        * replace view` may add a column at the end and may not move one, and
        * this view already has dependents. Position is not worth a drop.
        */
       pr.status
from production_rates pr
left join tasks t on t.id = pr.task_id
where pr.status in ('active', 'draft', 'archived') and pr.superseded_by_id is null;

revoke all on my_production_rates from public, anon;
grant select on my_production_rates to authenticated, service_role;
