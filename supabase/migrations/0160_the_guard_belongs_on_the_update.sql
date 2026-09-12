-- =============================================================================
-- 0160 — The guard belongs on the update
--
-- 0158 attached `app.guard_engine_outputs` to `schedule_activities` for insert
-- *and* update, copying the shape 0058 used for estimates. On the estimate side
-- that is right: a new version is unpriced by definition, so a forged starting
-- position is discarded rather than refused, and there is nothing else standing
-- behind it.
--
-- The schedule is not in that position, and the test suite said so immediately.
-- 0029 had already put a constraint on insert —
-- `schedule_activities_float_is_calculated`, "float cannot be asserted, only
-- computed" — which *refuses*, by name, with four tests pinning the refusal.
-- Discarding on insert stepped in front of it and turned every one of those
-- loud errors into silence.
--
-- It was also wrong about a legitimate case. An activity may be created already
-- carrying the results of a real calculation, and 0029 has a test for exactly
-- that; 0158 silently stripped the float back off it while reporting success.
-- A screen doing that would be the defect this whole build keeps removing.
--
-- So the guard moves to update only, which is where it was always needed:
--
--   * **On insert**, 0029's constraint decides, and it refuses float that does
--     not name a calculation. What a caller cannot do is invent the calculation
--     to name — 0158 revoked `schedule_calculations` from `authenticated`, so
--     the only ones that exist were made by the engine.
--   * **On update**, the guard refuses, because an update is a deliberate act
--     on an existing row and silence there would leave the caller believing it
--     worked. That is the case 0058 reasoned about, and it is unchanged.
-- =============================================================================

drop trigger if exists schedule_activities_engine_outputs on schedule_activities;
create trigger schedule_activities_engine_outputs
  before update on schedule_activities
  for each row execute function app.guard_engine_outputs(
    'early_start', 'early_finish', 'late_start', 'late_finish',
    'total_float_days', 'free_float_days', 'is_critical', 'calculation_id');

comment on constraint schedule_activities_float_is_calculated on schedule_activities is
  'Float cannot be asserted, only computed. A row carrying total_float_days must name the calculation that produced it — and since 0158 nobody but the engine can make one of those to name.';

select app.assert_security_gates();
