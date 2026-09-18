-- =============================================================================
-- 0223 — One set_material, not two
--
-- 0222 added the waste basis to `set_material`, which in PostgreSQL means a new
-- function rather than a changed one: the five-argument version from 0221 is
-- still there, both have defaults, and a five-argument call matches both.
--
--     function public.set_material(unknown, ...) is not unique
--
-- Overloads are a feature when two signatures mean different things. Here one
-- is simply the older shape of the other, and leaving it would mean every
-- caller has to pass all six arguments forever to stay unambiguous — or find
-- out at run time that it did not.
-- =============================================================================

drop function if exists public.set_material(uuid, text, text, text, numeric);
drop function if exists app.set_material(uuid, text, text, text, numeric);
