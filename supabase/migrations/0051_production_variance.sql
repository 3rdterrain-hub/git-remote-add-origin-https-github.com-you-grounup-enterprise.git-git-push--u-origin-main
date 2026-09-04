-- =============================================================================
-- 0051 — The calibration loop, modeled three times over and never closed
--
-- @implements GES-P04-REQ-044, GES-P04-REQ-055
--
-- An estimating platform earns its keep by learning what work actually takes.
-- This one is built to: `production_actuals` records installed quantity against
-- crew hours with the conditions of the day and a generated `actual_per_hour`,
-- and points at the very `production_rates` row that estimated it.
-- `production_rates` carries `sample_size`, `confidence_score`, a
-- `derived_from_project_id` and a `source_type` that can say the rate came from
-- calibration. Library rows carry an `origin` whose values include
-- `calibration`. The notification catalog carries a `calibration` category.
--
-- **Nothing computes any of it.** `production_actuals` is referenced by no
-- statement anywhere outside its own definition. No row has ever been written
-- with `origin = 'calibration'`. The `calibration` notification category has no
-- producer. Three separate places in the schema anticipate a capability, and
-- the capability is absent — the same shape as labor never reaching job cost,
-- committed cost never being written, and a credential's expiry never being
-- checked, on the one loop that makes an estimating library get better.
--
-- What this adds is the measurement and deliberately not the correction. A
-- library rate is an approved record, and the platform's rule is that approved
-- library rows change through the approval workflow — an automatic rewrite from
-- field data would be exactly the AI-and-automation overreach the governance
-- rules exist to prevent, and it would do it with the estimator's own numbers.
-- So this reports the variance, names its direction, and says how much evidence
-- is behind it. Somebody decides.
-- =============================================================================

/**
 * What the field actually achieved against what the library said it would.
 *
 * The achieved rate is total quantity over total hours rather than an average
 * of daily rates: a half-day of bad access and a full week of clean production
 * are not two equally weighted opinions, and averaging them lets one short
 * shift move a rate as much as a month of work.
 *
 * `observations` and `hours_observed` are published beside the variance so a
 * reader can tell a signal from an anecdote. Two days of data disagreeing with
 * a seeded benchmark is not a reason to move it.
 */
create or replace view reporting_production_variance
with (security_invoker = true) as
select
  a.company_id,
  a.production_rate_id,
  pr.code                                     as rate_code,
  pr.rate_unit,
  pr.source_type,
  pr.sample_size                              as library_sample_size,
  pr.confidence_score                         as library_confidence,
  pr.rate_per_hour                            as library_rate_per_hour,
  count(*)                                    as observations,
  sum(a.crew_hours)                           as hours_observed,
  sum(a.quantity_installed)                   as quantity_installed,
  -- Weighted by hours, not averaged across days.
  round(sum(a.quantity_installed) / nullif(sum(a.crew_hours), 0), 6)
                                              as achieved_rate_per_hour,
  round(sum(a.quantity_installed) / nullif(sum(a.crew_hours), 0) - pr.rate_per_hour, 6)
                                              as variance_per_hour,
  round(100 * (sum(a.quantity_installed) / nullif(sum(a.crew_hours), 0) - pr.rate_per_hour)
        / nullif(pr.rate_per_hour, 0), 3)     as variance_percent,
  -- Named rather than left to a reader to work out, because the direction is
  -- what somebody acts on: an optimistic library rate loses bids slowly and
  -- then loses money on the ones it wins.
  case
    when sum(a.crew_hours) = 0 then 'no hours recorded'
    when abs(sum(a.quantity_installed) / nullif(sum(a.crew_hours), 0) - pr.rate_per_hour)
         <= pr.rate_per_hour * 0.05 then 'aligned'
    when sum(a.quantity_installed) / nullif(sum(a.crew_hours), 0) < pr.rate_per_hour
      then 'library rate is optimistic'
    else 'library rate is conservative'
  end                                         as finding
from production_actuals a
join production_rates pr on pr.id = a.production_rate_id
where a.production_rate_id is not null
group by a.company_id, a.production_rate_id, pr.code, pr.rate_unit, pr.source_type,
         pr.sample_size, pr.confidence_score, pr.rate_per_hour;

comment on view reporting_production_variance is
  'What the field achieved against what the library said, per production rate, weighted by hours and published with the evidence behind it. Deliberately a measurement and not a correction: a library rate is an approved record and changes through the approval workflow, so this tells somebody what to decide rather than deciding it.';

grant select on reporting_production_variance to authenticated;
revoke all on reporting_production_variance from anon;

select app.assert_security_gates();
