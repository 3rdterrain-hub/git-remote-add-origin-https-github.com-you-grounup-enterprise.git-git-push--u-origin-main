-- =============================================================================
-- 0200 — One door onto a copy, not seven
--
-- 0198 exposed `public.customize_service`, `customize_task`,
-- `customize_labor_rate`, `customize_equipment`, `customize_crew` and
-- `customize_production_rate` alongside the dispatcher `adopt_library_row`.
-- Nothing calls the six: a screen offers one gesture, and which library the row
-- is in is a question about the row rather than about the person pressing it.
--
-- `every-door-has-a-reader` caught them, which is what that test is for. Six
-- granted functions nothing reaches are six more ways for this schema to grow a
-- feature with no door — the defect this repository keeps producing, in its
-- other direction.
--
-- The `app.customize_*` functions stay exactly as they are. They are what the
-- dispatcher calls, and they are where the per-library judgment lives: which
-- columns come with the copy, and which deliberately do not.
-- =============================================================================

drop function if exists public.customize_service(uuid, uuid);
drop function if exists public.customize_task(uuid, uuid);
drop function if exists public.customize_labor_rate(uuid, uuid);
drop function if exists public.customize_equipment(uuid, uuid);
drop function if exists public.customize_crew(uuid, uuid);
drop function if exists public.customize_production_rate(uuid, uuid);

select app.assert_security_gates();
