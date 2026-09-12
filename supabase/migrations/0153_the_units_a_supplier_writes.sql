-- =============================================================================
-- 0153 — The units a supplier actually writes
--
-- 0152 added `CF`. This is where it is used, and where two more names from the
-- same price library are mapped onto units that already exist.
--
--   * `CF`, `CUFT`, `CU FT` — the cubic foot itself, now that there is one.
--   * `SET` — a hardware set is a countable thing, the same as `BOX`, `PC` and
--     `ROLL` before it. A name for an each, not a measurement of its own.
--
-- Nothing here converts. `BAG` was already an each and stays one; `CF` maps to
-- `CF` and never to `CY`, because 27 is a factor and a factor applied to
-- somebody's price without being asked is the mistake this function exists to
-- refuse.
-- =============================================================================

create or replace function app.unit_synonym(p_raw text)
returns app.unit_code
language sql
immutable
as $$
  select case upper(btrim(coalesce(p_raw, '')))
    when 'LS' then 'LS' when 'EA' then 'EA' when 'LF' then 'LF' when 'SF' then 'SF'
    when 'SY' then 'SY' when 'CY' then 'CY' when 'TON' then 'TON' when 'HR' then 'HR'
    when 'DAY' then 'DAY' when 'ACRE' then 'ACRE' when 'GAL' then 'GAL' when 'LB' then 'LB'
    when 'MO' then 'MO' when 'WK' then 'WK'
    when 'BF' then 'BF' when 'SQ' then 'SQ' when 'KW' then 'KW' when 'CF' then 'CF'
    /* Genuine synonyms: the same measurement under another name. */
    when 'AC'    then 'ACRE'
    when 'ACRES' then 'ACRE'
    when 'TONS'  then 'TON'
    when 'TONNE' then 'TON'
    when 'SHEET' then 'EA'
    when 'SHT'   then 'EA'
    when 'BAG'   then 'EA'
    when 'BALE'  then 'EA'
    when 'ROLL'  then 'EA'
    when 'BOX'   then 'EA'
    when 'PC'    then 'EA'
    when 'PIECE' then 'EA'
    when 'EACH'  then 'EA'
    when 'SET'   then 'EA'
    when 'HOUR'  then 'HR'
    when 'HRS'   then 'HR'
    when 'DAYS'  then 'DAY'
    when 'POUND' then 'LB'
    when 'LBS'   then 'LB'
    when 'GALLON' then 'GAL'
    when 'GALS'  then 'GAL'
    when 'FT'    then 'LF'
    when 'LNFT'  then 'LF'
    when 'SQFT'  then 'SF'
    when 'SQ FT' then 'SF'
    when 'CUYD'  then 'CY'
    when 'CU YD' then 'CY'
    when 'SQYD'  then 'SY'
    /* Board feet and roofing squares, now that there is somewhere to put them. */
    when 'BDFT'  then 'BF'
    when 'BD FT' then 'BF'
    when 'MBF'   then null          -- thousand board feet: a factor of 1000, not a name
    when 'SQUARE' then 'SQ'
    when 'SQS'   then 'SQ'
    when 'KILOWATT' then 'KW'
    /* The cubic foot, which is not a cubic yard divided by anything yet. */
    when 'CUFT'  then 'CF'
    when 'CU FT' then 'CF'
    else null
  end::app.unit_code;
$$;

comment on function app.unit_synonym(text) is
  'Maps an imported unit name onto app.unit_code, for synonyms only. Returns null for a unit that would need arithmetic — MBF is a thousand board feet, and multiplying somebody''s price by 1000 silently is worse than refusing the row by name. CF is a unit of its own and never becomes CY.';

select app.assert_security_gates();
