-- =============================================================================
-- 0133 — A price you can click
--
-- The materials library shows every row a company can read, which is its own
-- rows plus the platform catalog, and the cost cell is editable on the first
-- and locked on the second. Row level security says so, and the lock is honest
-- about it: a catalog row is the same row every company reads, and one company
-- editing it would change what another company's estimate prices at.
--
-- The catalog arriving in 0907 makes that lock the wrong answer to the right
-- rule. Three hundred and thirty-three materials, and all but six of them
-- uncosted — a screen full of `$0.00` with a padlock on each one. The rule the
-- lock enforces is real. The conclusion a person draws from it is that the
-- platform will not let them price their own materials, which is the opposite
-- of what is true.
--
-- A price is not a fact about a material. It is a fact about *who is buying it,
-- from whom, this month* — which is exactly the kind of thing the three-tier
-- library already has an answer for, and the answer is copy on write. So
-- clicking the price of a catalog material does what pressing "customize" on a
-- catalog template does in 0129: it makes the company's own copy, carrying the
-- name, the category, the unit and the waste, and puts the typed price on the
-- copy. The catalog row is untouched, every other tenant still reads it, and
-- the estimator did not have to know any of that had happened.
--
-- The copy is deterministic — catalog code plus six characters of the company
-- id — so pricing the same material twice edits one row rather than making a
-- second. That is the same key `customize_assembly` uses, for the same reason.
--
-- Governance is unchanged from 0125: a company that has somebody with
-- `libraries.approve` gets a live row, and a company that does not gets a draft
-- with the price on it, waiting for the person whose job that is. The function
-- returns the row either way, so a screen can say which happened instead of
-- looking like it worked.
--
-- This is `app.set_material_cost` from 0121, extended rather than joined by a
-- second function of a similar name. Everything that migration insisted on
-- still holds — a price called *estimated* or *quoted* has to be above zero and
-- has to say where it came from, and a material called *free* has to say why —
-- because none of that was wrong. One branch changes: the catalog row it used
-- to refuse with "copy it to your library to price it" now does the copying,
-- which is the sentence the error was asking somebody to carry out by hand.
--
-- The signature gains `p_company` at the end and the return type changes from
-- `void` to the row, so a caller learns which material ended up holding the
-- price. Both old signatures are dropped rather than left beside the new ones:
-- two functions of one name, one reachable only by argument count, is the kind
-- of ambiguity PostgREST resolves at runtime and nobody sees until it picks the
-- wrong one.
-- =============================================================================

/* The three units 0132 added. Named directly, so nothing is converted. */
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
    when 'BF' then 'BF' when 'SQ' then 'SQ' when 'KW' then 'KW'
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
    /* Board feet and roofing squares, now that there is somewhere to put them. */
    when 'BDFT'  then 'BF'
    when 'BD FT' then 'BF'
    when 'MBF'   then null          -- thousand board feet: a factor of 1000, not a name
    when 'SQUARE' then 'SQ'
    when 'SQS'   then 'SQ'
    when 'KILOWATT' then 'KW'
    else null
  end::app.unit_code;
$$;
comment on function app.unit_synonym(text) is
  'Maps an imported unit name onto app.unit_code, for synonyms only. Returns null for a unit that would need arithmetic — MBF is a thousand board feet, and multiplying somebody''s price by 1000 silently is worse than refusing the row by name.';

-- -----------------------------------------------------------------------------
-- The one function, extended
-- -----------------------------------------------------------------------------

/*
 * Dropped rather than overloaded. `create or replace` with a new parameter
 * makes a second function, and a four-argument call would then match both.
 */
drop function if exists public.set_material_cost(uuid, numeric, app.material_cost_state, text, date);
drop function if exists app.set_material_cost(uuid, numeric, app.material_cost_state, text, date);

/**
 * Put a price on a material, whoever owns it.
 *
 * On the company's own row this is the update it always was. On a catalog row
 * it is a copy: the company gets its own material carrying the name, the
 * category, the unit, the density and the waste, and the price goes on the
 * copy. The catalog row is untouched and every other tenant still reads it.
 *
 * The copy is keyed on the catalog code plus six characters of the company id,
 * so pricing the same material twice edits one row rather than making a second.
 * That is the same key `customize_assembly` uses, for the same reason.
 *
 * Security definer, like every other copy-on-write in this schema: it inserts a
 * row on the caller's behalf and checks the caller's permission itself.
 */
create or replace function app.set_material_cost(
  p_material   uuid,
  p_unit_cost  numeric,
  p_state      app.material_cost_state,
  p_source     text default null,
  p_quoted_on  date default null,
  p_company    uuid default null)
returns materials
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_src     materials;
  v_row     materials;
  v_company uuid;
  v_mine    uuid[];
  v_code    text;
  v_approve boolean;
begin
  select * into v_src from materials where id = p_material;
  if v_src.id is null then
    raise exception 'No such material' using errcode = 'no_data_found';
  end if;

  /*
   * Whose library this lands in. Their own row answers it; a catalog row has no
   * answer of its own, so the caller says, and if they belong to exactly one
   * company that is not a question worth asking them.
   */
  if v_src.company_id is not null then
    /*
     * Somebody else's row, named as such. Worth its own sentence: "you do not
     * have permission" would be true and would read as a permission somebody
     * could be granted, and no permission makes another company's price list
     * yours to edit.
     */
    if p_company is not null and v_src.company_id <> p_company then
      raise exception 'That material belongs to another company.'
        using errcode = 'insufficient_privilege';
    end if;
    v_company := v_src.company_id;
  else
    v_company := p_company;
    if v_company is null then
      select array_agg(c) into v_mine from app.current_company_ids() c;
      if coalesce(array_length(v_mine, 1), 0) = 1 then
        v_company := v_mine[1];
      else
        raise exception 'Say which company library this price belongs in.'
          using errcode = 'no_data_found',
                hint = 'set_material_cost(material, cost, state, source, quoted_on, company)';
      end if;
    end if;
  end if;

  if not app.has_permission(v_company, 'libraries.write') then
    raise exception 'You do not have permission to change the libraries'
      using errcode = 'insufficient_privilege';
  end if;

  /*
   * What the number claims about itself. Unchanged from 0121: a quote and a
   * guess are different claims and an estimate should be able to tell them
   * apart, so neither may arrive anonymously.
   */
  if p_state in ('estimated', 'quoted') then
    if p_unit_cost is null or p_unit_cost <= 0 then
      raise exception 'A % price has to be above zero', p_state
        using errcode = 'check_violation',
              hint = 'If it genuinely costs nothing, record it as free and say why.';
    end if;
    if p_source is null or length(trim(p_source)) < 3 then
      raise exception 'Say where this price came from'
        using errcode = 'check_violation',
              hint = 'A supplier name, a quote number, or how it was estimated.';
    end if;
  end if;
  if p_state = 'free' and (p_source is null or length(trim(p_source)) < 4) then
    raise exception 'Say why this material costs nothing'
      using errcode = 'check_violation',
            hint = 'Owner-supplied, salvaged on site, included in a subcontract.';
  end if;

  /* Their own row: change it where it is. */
  if v_src.company_id is not null then
    update materials
       set unit_cost      = case when p_state = 'free' then 0
                                 when p_state = 'not_costed' then unit_cost
                                 else p_unit_cost end,
           cost_state     = p_state,
           free_reason    = case when p_state = 'free' then trim(p_source) end,
           cost_source    = case when p_state in ('estimated', 'quoted')
                                 then trim(p_source) end,
           cost_quoted_on = case when p_state = 'quoted'
                                 then coalesce(p_quoted_on, current_date) end,
           updated_at     = now()
     where id = v_src.id
    returning * into v_row;
    return v_row;
  end if;

  -- A catalog row. Their own copy of it, made now or already made.
  v_code    := left(v_src.code, 23) || '-' || substring(replace(v_company::text, '-', '') from 1 for 6);
  v_approve := app.has_permission(v_company, 'libraries.approve');

  select * into v_row from materials where company_id = v_company and code = v_code;

  if v_row.id is not null then
    update materials
       set unit_cost      = case when p_state = 'free' then 0
                                 when p_state = 'not_costed' then unit_cost
                                 else p_unit_cost end,
           cost_state     = p_state,
           free_reason    = case when p_state = 'free' then trim(p_source) end,
           cost_source    = case when p_state in ('estimated', 'quoted')
                                 then trim(p_source) end,
           cost_quoted_on = case when p_state = 'quoted'
                                 then coalesce(p_quoted_on, current_date) end,
           updated_at     = now()
     where id = v_row.id
    returning * into v_row;
    return v_row;
  end if;

  insert into materials (
    company_id, code, name, category, unit, unit_cost,
    default_waste_percent, waste_basis, density_lb_per_cy, specification,
    cost_state, free_reason, cost_source, cost_quoted_on,
    origin, source, status, approved_by, approved_at)
  values (
    v_company, v_code, v_src.name, v_src.category, v_src.unit,
    case when p_state in ('estimated', 'quoted') then p_unit_cost else 0 end,
    v_src.default_waste_percent, v_src.waste_basis, v_src.density_lb_per_cy,
    v_src.specification,
    p_state,
    case when p_state = 'free' then trim(p_source) end,
    case when p_state in ('estimated', 'quoted') then trim(p_source) end,
    case when p_state = 'quoted' then coalesce(p_quoted_on, current_date) end,
    'company', 'Priced from catalog material ' || v_src.code,
    (case when v_approve then 'active' else 'draft' end)::app.record_status,
    case when v_approve then auth.uid() end,
    case when v_approve then now() end)
  returning * into v_row;

  return v_row;
end;
$$;

comment on function app.set_material_cost(uuid, numeric, app.material_cost_state, text, date, uuid) is
  'Puts a price on a material and records what the price claims about itself. A catalog material is copied into the company library first, because a price is a fact about who is buying it rather than about the material. ENGINE for the materials library cost cell.';

/** The published wrapper, so `app` itself stays unpublished. */
create or replace function public.set_material_cost(
  p_material   uuid,
  p_unit_cost  numeric,
  p_state      app.material_cost_state,
  p_source     text default null,
  p_quoted_on  date default null,
  p_company    uuid default null)
returns materials
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare v materials;
begin
  select * into v from app.set_material_cost(
    p_material, p_unit_cost, p_state, p_source, p_quoted_on, p_company);
  return v;
end;
$$;

do $$
begin
  execute 'revoke all on function public.set_material_cost(uuid, numeric, app.material_cost_state, text, date, uuid) from public, anon';
  execute 'grant execute on function public.set_material_cost(uuid, numeric, app.material_cost_state, text, date, uuid) to authenticated';
  execute 'revoke all on function app.set_material_cost(uuid, numeric, app.material_cost_state, text, date, uuid) from public, anon';
  execute 'grant execute on function app.set_material_cost(uuid, numeric, app.material_cost_state, text, date, uuid) to authenticated';
end $$;

select app.assert_security_gates();

-- -----------------------------------------------------------------------------
-- What the uncosted list is a list of
-- -----------------------------------------------------------------------------

/**
 * The materials nobody has priced that somebody is actually going to buy.
 *
 * Migration 0121 wrote this as every material with no cost, and said the count
 * was the point: three uncosted materials is an afternoon of phone calls, three
 * hundred is an estimating system that reports material cost as zero. That was
 * true of a library a company had built. It is not true of the one that arrives
 * with the platform.
 *
 * The catalog in 0907 ships 333 materials and prices five, deliberately —
 * GrounUp knows what a material is and has no business claiming to know what it
 * costs you. Left as it was, this view would hand every company on the platform
 * the same 328-row list on their first day, none of it their doing and none of
 * it urgent, and a queue that is full before anybody touches it is a queue
 * nobody works.
 *
 * So a catalog material appears here once somebody puts it on a line. Before
 * that it is a name in a catalog; after it, it is a zero about to be multiplied
 * by a quantity, which is precisely what this view was built to catch. A
 * company's own uncosted material still appears the moment it exists, because
 * somebody made that row on purpose.
 */
create or replace view my_uncosted_materials
with (security_invoker = true) as
select m.id,
       m.company_id,
       m.code,
       m.name,
       m.category,
       m.unit,
       m.cost_state,
       m.company_id is not null as is_own,
       (select count(*) from estimate_line_resources r
         where r.material_id = m.id)                       as used_on_lines,
       (select count(distinct l.estimate_version_id)
          from estimate_line_resources r
          join estimate_line_items l on l.id = r.line_item_id
         where r.material_id = m.id)                       as used_on_estimates
from materials m
where m.cost_state = 'not_costed'
  and m.status = 'active'
  and (m.company_id is not null
       or exists (select 1 from estimate_line_resources r where r.material_id = m.id));

comment on view my_uncosted_materials is
  'Materials that will price at nothing: every one of the company own, and every catalog one somebody has put on a line. A catalog material nobody has used is a name in a catalog rather than a gap in a library, and listing all 328 of them would fill the queue before anybody touched it. REPORTING view over the materials LIBRARY.';
