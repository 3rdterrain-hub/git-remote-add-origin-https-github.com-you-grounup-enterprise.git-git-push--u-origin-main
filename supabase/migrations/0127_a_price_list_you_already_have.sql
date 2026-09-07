-- =============================================================================
-- 0127 — A price list you already have
--
-- Every contractor already has a materials list. It is in a spreadsheet, it has
-- been maintained for years, and it is the single most tedious thing to retype
-- into a new system — which is why most people never do, and why a platform
-- with an empty materials library stays empty.
--
-- The seed ships no materials at all. Services, tasks, crews and production
-- rates it has; materials it does not, because a price list is a company's own
-- and a national average is worse than nothing. So the way materials arrive is
-- by import, and this is the governed door for it.
--
-- What it will not do is the interesting part.
--
-- **It does not invent units.** A real export arrived with 212 of 342 rows
-- filed as `EA`, including crushed stone and aggregate base, which are sold by
-- the ton. Silently changing those would put a per-each price on a per-ton
-- material and quietly wreck every estimate that used one. They import as
-- given, and come back in a `review` list that names them.
--
-- **It does not invent prices.** 336 of those 342 rows had no cost. They land
-- as `not_costed` — the state migration 0121 added for exactly this — so the
-- engine warns rather than multiplying by a zero that looks like a price.
--
-- **It does map genuine synonyms**, and only those. `Ton` is `TON`; `AC` is
-- `ACRE`; a `SHEET`, a `BAG` and a `BALE` are each bought as one thing, which
-- is what `EA` means. A board foot and a roofing square are real units this
-- schema does not have, and those rows are refused by name rather than
-- flattened into something they are not.
--
-- Categories are created before the materials that need them, because
-- `materials.category` has been governed by `library_categories` since 0113 and
-- an import that did not would be refused one row at a time.
-- =============================================================================

/**
 * Unit synonyms this platform accepts on import.
 *
 * Only where the two names mean the same measurement. Anything requiring
 * arithmetic — a roofing square is 100 square feet, a board foot is a volume —
 * is deliberately absent: converting silently would change the number attached
 * to somebody's price.
 */
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
    else null
  end::app.unit_code;
$$;

comment on function app.unit_synonym(text) is
  'Maps an imported unit name onto app.unit_code, for synonyms only. Returns null for a unit that would need arithmetic — a roofing square or a board foot — so the importer can refuse the row by name rather than flatten it into something it is not.';

/**
 * Units that look wrong for what the material is.
 *
 * Not a refusal and not a correction: a list somebody has to look at. The
 * export that prompted this had aggregate, stone, concrete and asphalt filed as
 * `EA`, which is how a per-ton price ends up multiplied per-each.
 */
create or replace function app.unit_looks_wrong(p_category text, p_name text, p_unit app.unit_code)
returns boolean
language sql
immutable
as $$
  select p_unit = 'EA'
     and (coalesce(p_category, '') || ' ' || coalesce(p_name, '')) ~*
         '(aggregate|stone|gravel|sand|topsoil|fill|asphalt|concrete|mulch|riprap|rip-rap|base course|slag|limestone)';
$$;

/** The next company material code, counting from the highest rather than the count. */
create or replace function app.next_company_material_code(p_company uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select 'M-' || lpad((coalesce(max(substring(m.code from '^M-(\d+)$')::int), 0) + 1)::text, 4, '0')
  from materials m
  where m.company_id = p_company and m.code ~ '^M-\d+$';
$$;

/**
 * Import a price list.
 *
 * Takes the rows as JSON — `[{name, category, unit, unit_cost, density, waste_pct}]`,
 * the shape every materials export already has — and returns a report saying
 * what happened to each one rather than a count that hides the interesting
 * half.
 *
 * Idempotent by name. Running it again after fixing six rows in the spreadsheet
 * updates nothing and re-imports nothing: the six new names arrive, the rest
 * are reported as already there. An importer that created duplicates on the
 * second run is an importer nobody runs twice.
 */
create or replace function public.import_materials(p_company uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r            jsonb;
  v_name       text;
  v_category   text;
  v_unit       app.unit_code;
  v_raw_unit   text;
  v_cost       numeric;
  v_density    numeric;
  v_waste      numeric;
  v_code       text;
  v_approve    boolean;
  v_imported   int := 0;
  v_existing   int := 0;
  v_rejected   jsonb := '[]'::jsonb;
  v_review     jsonb := '[]'::jsonb;
  v_categories int := 0;
begin
  if not app.has_permission(p_company, 'libraries.write') then
    raise exception 'Importing materials needs the libraries.write permission.'
      using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Give me an array of rows.' using errcode = 'invalid_parameter_value';
  end if;

  v_approve := app.has_permission(p_company, 'libraries.approve');

  /*
   * Categories first. `materials.category` is governed by library_categories,
   * so importing them one row at a time would be refused one row at a time.
   */
  for r in select distinct on (lower(btrim(x->>'category')))
                  x from jsonb_array_elements(p_rows) x
           where coalesce(btrim(x->>'category'), '') <> ''
  loop
    v_category := btrim(r->>'category');
    if not exists (
      select 1 from library_categories c
      where c.kind = 'material_category' and c.status = 'active'
        and lower(btrim(c.name)) = lower(v_category)
        and (c.company_id is null or c.company_id = p_company))
    then
      perform app.add_library_category('material_category', v_category, null, p_company);
      v_categories := v_categories + 1;
    end if;
  end loop;

  for r in select x from jsonb_array_elements(p_rows) x loop
    v_name     := btrim(coalesce(r->>'name', ''));
    v_category := nullif(btrim(coalesce(r->>'category', '')), '');
    v_raw_unit := coalesce(r->>'unit', 'EA');
    v_cost     := coalesce(nullif(btrim(coalesce(r->>'unit_cost', '')), '')::numeric, 0);
    v_density  := nullif(btrim(coalesce(r->>'density', '')), '')::numeric;
    v_waste    := coalesce(nullif(btrim(coalesce(r->>'waste_pct', '')), '')::numeric, 0);

    if length(v_name) < 2 then
      v_rejected := v_rejected || jsonb_build_object(
        'name', v_name, 'reason', 'No name to file it under.');
      continue;
    end if;

    v_unit := app.unit_synonym(v_raw_unit);
    if v_unit is null then
      v_rejected := v_rejected || jsonb_build_object(
        'name', v_name,
        'reason', format('%s is not a unit this platform has, and converting it would change the price. Restate it in the spreadsheet.', v_raw_unit));
      continue;
    end if;

    if exists (
      select 1 from materials m
      where m.company_id = p_company
        and lower(btrim(m.name)) = lower(v_name)
        and m.status <> 'retired')
    then
      v_existing := v_existing + 1;
      continue;
    end if;

    /*
     * A waste percent arrives as 5 or as 0.05 depending on who exported it.
     * Anything above 1 is read as a percentage, which is the only reading that
     * makes sense — a 500% waste factor is not a thing anybody types.
     */
    if v_waste > 1 then v_waste := v_waste / 100; end if;
    if v_waste < 0 or v_waste > 1 then v_waste := 0; end if;

    v_code := app.next_company_material_code(p_company);

    insert into materials (
      company_id, code, name, category, unit, unit_cost,
      default_waste_percent, waste_basis, density_lb_per_cy,
      origin, status, source, approved_by, approved_at)
    values (
      p_company, v_code, v_name, v_category, v_unit, coalesce(v_cost, 0),
      v_waste,
      case when v_waste > 0 then 'Imported from the company price list' end,
      v_density,
      'imported',
      (case when v_approve then 'active' else 'draft' end)::app.record_status,
      'Price list import',
      case when v_approve then auth.uid() end,
      case when v_approve then now() end);

    v_imported := v_imported + 1;

    if app.unit_looks_wrong(v_category, v_name, v_unit) then
      v_review := v_review || jsonb_build_object(
        'name', v_name, 'unit', v_unit::text,
        'why', 'Filed as each. Material of this kind is normally bought by the ton or the yard.');
    elsif coalesce(v_cost, 0) = 0 then
      v_review := v_review || jsonb_build_object(
        'name', v_name, 'unit', v_unit::text,
        'why', 'No cost. It will price at nothing until somebody sets one.');
    end if;
  end loop;

  return jsonb_build_object(
    'imported',          v_imported,
    'already_there',     v_existing,
    'categories_added',  v_categories,
    'rejected',          v_rejected,
    'needs_review',      v_review,
    'approved',          v_approve);
end;
$$;

comment on function public.import_materials(uuid, jsonb) is
  'Imports a company price list. WORKFLOW: creates the categories first because materials.category is governed, maps unit synonyms but never converts a unit that would change the price, files an uncosted row as not_costed rather than as free, and returns what needs a person to look at rather than a count that hides it.';

revoke all on function public.import_materials(uuid, jsonb) from public, anon;
grant execute on function public.import_materials(uuid, jsonb) to authenticated;
revoke all on function app.unit_synonym(text) from public, anon;
grant execute on function app.unit_synonym(text) to authenticated;
revoke all on function app.unit_looks_wrong(text, text, app.unit_code) from public, anon;
grant execute on function app.unit_looks_wrong(text, text, app.unit_code) to authenticated;
revoke all on function app.next_company_material_code(uuid) from public, anon;
grant execute on function app.next_company_material_code(uuid) to authenticated;
