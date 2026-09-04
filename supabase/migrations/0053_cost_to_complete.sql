-- =============================================================================
-- 0053 — The platform's only forward-looking number ignored money already spent
--
-- @implements EDM-000068
--
-- `cost_to_complete` is the one metric in the semantic layer that looks
-- forward, and it was defined as `sum(approved_budget) - sum(actual_cost)` with
-- the description "Approved budget less actual cost. Negative means the budget
-- is already spent and the remaining work has no funding behind it."
--
-- That was defensible when it was written and is not now, and this build is why.
-- Before migration 0046 `committed_cost` was structurally zero — nothing had
-- ever written a committed row — so a definition that ignored commitments
-- ignored nothing. Since 0046 an issued purchase order posts its open
-- commitment, and the omission became real money: a project with a $100,000
-- budget, $60,000 of actual cost and $50,000 committed to vendors reports
-- $40,000 left to spend when it is in fact $10,000 overcommitted.
--
-- **A commitment is money the company can no longer choose not to spend.** A
-- forecast that excludes it tells a project manager there is room where there
-- is a hole, which is the direction that matters: the error is always
-- optimistic and it grows with how well the job is bought out.
--
-- Recorded as a defect this build created rather than one it found. Adding the
-- commitment posting was right; leaving the metric that reads it alone was not,
-- and nothing caught it because a metric expression is prose the platform does
-- not execute against its own semantics.
-- =============================================================================

update metric_definitions set
  expression  = 'sum(approved_budget) - sum(actual_cost) - sum(committed_cost)',
  description = 'Approved budget less actual cost and open commitments. A commitment is '
                'money the company can no longer choose not to spend, so a figure that '
                'excludes it reports room where there is a hole. Negative means the budget '
                'is already spent or promised and the remaining work has no funding behind it.'
where company_id is null and key = 'cost_to_complete';

-- The change publishes version 2 through app.publish_metric_version(). Version 1
-- is kept: it is what the platform reported before this, and a definition
-- history that edits out its own mistakes answers no question worth asking.

select app.assert_security_gates();
