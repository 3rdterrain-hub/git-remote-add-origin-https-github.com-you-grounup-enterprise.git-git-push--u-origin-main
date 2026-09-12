-- =============================================================================
-- 0155 — Where the row came from, and where its price did
--
-- Seed 0013 priced 173 catalog materials and recorded the price's provenance in
-- the wrong column: it overwrote `source`, which says where the *material* came
-- from, with a string about where its *number* came from. Those are two facts
-- and the schema has two columns for them — 0133 writes a price's provenance to
-- `cost_source` for exactly this reason.
--
-- The seed is corrected, so a database built from scratch is right. This is for
-- the one that is not: the catalog migration had already been applied before the
-- mistake was found, and an applied migration does not run again. So the repair
-- has to be its own.
--
-- It reads as a no-op anywhere the seed ran in its corrected form, because no
-- row will match — which is the property that makes it safe to ship rather than
-- run by hand.
--
-- Worth stating plainly, since the whole point of `source` is that somebody can
-- ask a row where it came from: for a few hours, 173 materials answered that
-- question with the name of a price list.
-- =============================================================================

update materials
   set cost_source = 'GrounUp material library (07_F_P_MATERIAL_LIBRARY), price_default',
       source      = 'GrounUp material catalog v1'
 where company_id is null
   and source = 'GrounUp material library (07_F_P_MATERIAL_LIBRARY), price_default';

select app.assert_security_gates();
