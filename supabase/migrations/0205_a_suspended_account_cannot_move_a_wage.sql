-- =============================================================================
-- 0205 — A suspended account cannot move a wage either
--
-- `wage_schedules` (0201) is a tenant table and did not carry the suspension
-- guard. `suspension.test.ts` found it on the next run, which is exactly what
-- that test is built to do: it walks every table with a `company_id` and names
-- the ones missing the trigger, rather than checking a list somebody has to
-- remember to extend.
--
-- The comment on `app.guard_suspension` says a migration adding a tenant table
-- calls it. Mine did not. Nothing was lost — a suspended company could have
-- edited a wage sheet between 0201 and now, and nobody is suspended — but the
-- gap is closed and the invariant is whole again.
-- =============================================================================

select app.guard_suspension('wage_schedules');

select app.assert_security_gates();
