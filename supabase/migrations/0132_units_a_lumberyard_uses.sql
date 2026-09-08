-- =============================================================================
-- 0132 — Units a lumberyard uses
--
-- A materials export of 342 rows loaded 329 of them. The four it refused were
-- framing lumber, pressure-treated lumber, architectural shingles and a solar
-- allowance, and the importer was right to refuse them: their units were BF,
-- BF, SQ and KW, and `app.unit_synonym` returns null for a unit that would
-- need arithmetic rather than flattening a board foot into something it is not.
--
-- That refusal was correct and the conclusion drawn from it was wrong. The
-- importer refuses these because the platform has no such unit — but a board
-- foot is not an exotic measure, it is how every lumberyard in the country
-- quotes lumber, and a construction estimating platform that cannot express it
-- has a gap in its enum, not a problem with the spreadsheet. The same is true
-- of a roofing square, which is how every roof in the country is sold, and of
-- the kilowatt, which is how every solar array is.
--
-- So they become units:
--
--   * `BF`  — board foot. 144 cubic inches of lumber. Nominal, so a 2x4 is
--             priced as two by four however thick it actually is.
--   * `SQ`  — roofing square. 100 square feet of finished roof.
--   * `KW`  — kilowatt. Solar, generators, temporary power.
--
-- None of them converts to anything else here, and that is the point: `SQ` is
-- 100 SF, but a price per square is not a price per hundred square feet until
-- somebody says the waste and the coverage, so the platform keeps them apart
-- and prices each in its own unit.
--
-- This migration adds the values and nothing else. PostgreSQL will not let a
-- new enum value be used in the transaction that created it, so 0133 does the
-- using — the synonym table, and the four materials that were waiting on it.
-- =============================================================================

alter type app.unit_code add value if not exists 'BF';
alter type app.unit_code add value if not exists 'SQ';
alter type app.unit_code add value if not exists 'KW';
