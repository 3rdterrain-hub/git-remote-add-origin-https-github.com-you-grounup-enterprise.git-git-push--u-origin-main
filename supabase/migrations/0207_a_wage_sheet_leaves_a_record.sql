-- =============================================================================
-- 0207 — A wage sheet leaves a record of what happened to it
--
-- `wage_schedules` (0201) was neither audited nor frozen, and the governance
-- test that walks the whole schema said so. It is right to insist, and this
-- table is one of the clearer cases for it.
--
-- A wage sheet is evidence. "What did this determination say on the day we bid
-- it" is a question an owner's auditor asks on public work, and a sheet whose
-- wage changed with no record of the change is a sheet that cannot answer.
-- Certified payroll is checked against the determination in force at the time,
-- not against whatever the row says today.
--
-- So it is audited rather than frozen: a sheet legitimately changes — a wage
-- gets corrected, a class gets added, a district gets filled in — and what
-- matters is that every one of those changes leaves a trace.
--
-- `attach_standard_triggers` also gives it `set_updated_at`, which it was
-- carrying by hand.
-- =============================================================================

select app.attach_standard_triggers('public.wage_schedules');

select app.assert_security_gates();
