-- =============================================================================
-- 0126 — A rate you type, and a crew you did not have to
--
-- Two things an estimator asked for, and both were already half-built.
--
-- **A unit cost you type.** Migration 0066 added `parametric_cost_per_unit` —
-- a rate a line is priced at rather than built up from resources — with a
-- constraint requiring a stated basis and another forcing the line to be scored
-- as the allowance it is. Nothing has ever written it. So a subcontract quote,
-- an allowance, or a number an estimator simply knows had no way into an
-- estimate except by inventing resources until the arithmetic came out right,
-- which is worse than typing the number and saying where it came from.
--
-- **A crew you did not have to assemble.** `assembly_components` holds 8,159
-- platform rows saying what a service is made of — the labor, the equipment,
-- the materials, the trucking, each with a quantity per unit of the parent.
-- Nothing has ever read them onto a line. An estimator picking "Mass
-- excavation" got a production rate and an empty resource list, and rebuilt by
-- hand what the library already knew.
--
-- Three decisions worth stating.
--
-- Suggesting and applying are separate calls. The suggestion is a read that
-- costs nothing and can be shown beside the line; applying is a write somebody
-- asked for. A screen that filled the resources in the moment a service was
-- picked would be making a claim about the job on the estimator's behalf.
--
-- Applying never overwrites. A kind that already has resources on the line is
-- skipped and said so, because somebody who has already priced the equipment
-- does not want the library's opinion of it dropped on top.
--
-- And a typed rate and built-up resources are mutually exclusive, enforced
-- rather than described. A line carrying both would report a number nobody
-- could reproduce from what is on it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A rate you type
-- -----------------------------------------------------------------------------

/**
 * Price this line at a rate instead of building it up.
 *
 * The basis is not paperwork. `parametric_cost_per_unit` has required one since
 * 0066 — "Sub quote, Delaney Bros, 14 Aug" is a different number from "roughly
 * what we got last year", and an estimate that cannot tell them apart cannot be
 * reviewed. Three characters is the floor the constraint sets; this asks for
 * something rather than waiting for the constraint to refuse.
 */
create or replace function app.set_line_unit_cost(
  p_line  uuid,
  p_rate  numeric,
  p_basis text
)
returns estimate_line_items
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_status  app.estimate_status;
  v_kids    int;
  v_res     int;
  v_row     estimate_line_items;
begin
  select l.company_id, v.status into v_company, v_status
  from estimate_line_items l
  join estimate_versions v on v.id = l.estimate_version_id
  where l.id = p_line;

  if v_company is null then
    raise exception 'No such estimate line' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'estimates.write') then
    raise exception 'You do not have permission to change this estimate'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status not in ('draft', 'in_review') then
    raise exception 'This version is %; make a new version to change it', v_status
      using errcode = 'check_violation',
            hint = 'app.revise_estimate_version copies it forward with a reason.';
  end if;

  if p_rate is null or p_rate < 0 then
    raise exception 'A unit cost is a number and cannot be negative.'
      using errcode = 'check_violation';
  end if;
  if coalesce(length(btrim(p_basis)), 0) < 3 then
    raise exception 'Say where the rate came from — a quote, a past job, an allowance. An unattributable rate is a guess, and a guess that looks like a price is the most expensive thing an estimate can carry.'
      using errcode = 'check_violation';
  end if;

  select count(*) into v_kids from estimate_line_items where parent_line_id = p_line;
  if v_kids > 0 then
    raise exception 'This line has % lines under it, and a parent is the sum of its children. Price the children, or flatten this line first.', v_kids
      using errcode = 'check_violation';
  end if;

  select count(*) into v_res from estimate_line_resources where line_item_id = p_line;
  if v_res > 0 then
    raise exception 'This line already has % resources priced on it. Remove them first, or leave the rate off — a line carrying both reports a number nobody can reproduce from what is on it.', v_res
      using errcode = 'check_violation';
  end if;

  update estimate_line_items
     set parametric_cost_per_unit = round(p_rate, 4),
         parametric_basis         = btrim(p_basis),
         /* The constraint from 0066 requires it, and it is the honest label. */
         measurement_method       = 'estimator_allowance',
         updated_at               = now()
   where id = p_line
  returning * into v_row;

  return v_row;
end;
$$;

/** Take the typed rate back off, so the line is built up from resources again. */
create or replace function app.clear_line_unit_cost(p_line uuid)
returns estimate_line_items
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_status  app.estimate_status;
  v_row     estimate_line_items;
begin
  select l.company_id, v.status into v_company, v_status
  from estimate_line_items l
  join estimate_versions v on v.id = l.estimate_version_id
  where l.id = p_line;

  if v_company is null then
    raise exception 'No such estimate line' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'estimates.write') then
    raise exception 'You do not have permission to change this estimate'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status not in ('draft', 'in_review') then
    raise exception 'This version is %; make a new version to change it', v_status
      using errcode = 'check_violation';
  end if;

  /*
   * `measurement_method` is left where it is. It was set to an allowance when
   * the rate went on, and whether the quantity is now a measured one is a claim
   * only the estimator can make — putting it back to 'explicit_dimension' here
   * would upgrade the line's confidence on the platform's own say-so.
   */
  update estimate_line_items
     set parametric_cost_per_unit = null,
         parametric_basis         = null,
         updated_at               = now()
   where id = p_line
  returning * into v_row;

  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- A crew you did not have to assemble
-- -----------------------------------------------------------------------------

/**
 * What the library says this line is made of.
 *
 * Reads the service's default assembly and scales each component by the line's
 * quantity. A read, and only a read: what it returns is shown beside the line
 * so an estimator can see what would be added before any of it is.
 *
 * Rates come from the library rows themselves rather than being recomputed
 * here, so the number in the suggestion is the number that will land.
 */
create or replace function app.line_resource_suggestions(p_line uuid)
returns table (
  resource_kind    text,
  resource_id      uuid,
  name             text,
  quantity_per_unit numeric,
  quantity         numeric,
  unit             app.unit_code,
  unit_rate        numeric,
  extended_cost    numeric,
  is_optional      boolean,
  already_on_line  boolean
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with line as (
    select l.id, l.company_id, l.service_id,
           greatest(coalesce(nullif(l.gross_quantity, 0), l.measured_quantity), 0) as qty
    from estimate_line_items l
    where l.id = p_line
  ),
  parts as (
    select
      ac.component_kind::text as kind,
      coalesce(ac.labor_rate_id, ac.equipment_id, ac.material_id) as ref,
      ac.quantity_per_unit,
      ac.unit,
      ac.is_optional,
      ac.sort_order
    from line
    join services s on s.id = line.service_id
    join assembly_components ac on ac.assembly_id = s.default_assembly_id
    where ac.component_kind in ('labor', 'equipment', 'material', 'trucking')
      and (ac.company_id = line.company_id or ac.company_id is null)
  )
  select
    p.kind,
    p.ref,
    coalesce(lr.classification, eq.name, m.name, 'Unnamed'),
    p.quantity_per_unit,
    round(p.quantity_per_unit * line.qty, 4),
    coalesce(p.unit, m.unit, 'LS')::app.unit_code,
    coalesce(lr.burdened_cost_per_hour, eqr.hourly_rate, m.unit_cost, 0),
    round(p.quantity_per_unit * line.qty
          * coalesce(lr.burdened_cost_per_hour, eqr.hourly_rate, m.unit_cost, 0), 2),
    p.is_optional,
    exists (
      select 1 from estimate_line_resources r
      where r.line_item_id = p_line and r.resource_kind = p.kind
        and (r.labor_rate_id = p.ref or r.equipment_id = p.ref or r.material_id = p.ref))
  from parts p
  cross join line
  left join labor_rates lr on lr.id = p.ref and p.kind = 'labor'
  left join equipment  eq on eq.id = p.ref and p.kind = 'equipment'
  left join materials  m  on m.id  = p.ref and p.kind = 'material'
  /*
   * The machine's rate, under RULE-003's precedence: a quote for this project
   * beats a rate the company approved, which beats a regional one, which beats
   * the platform's seed. Every candidate is kept in `equipment_rates` so an
   * estimate can show what was overridden; this picks the winner the same way
   * the pricing engine does rather than inventing a second ordering.
   */
  left join lateral (
    select er.hourly_rate
    from equipment_rates er
    where p.kind = 'equipment' and er.equipment_id = p.ref
      and (er.company_id = line.company_id or er.company_id is null)
      and er.effective_date <= current_date
      and (er.expires_on is null or er.expires_on > current_date)
    order by array_position(
               array['project_quote','tenant_approved','regional','global_seed']::app.rate_source[],
               er.source),
             er.effective_date desc
    limit 1
  ) eqr on true
  order by p.sort_order, p.kind;
$$;

comment on function app.line_resource_suggestions(uuid) is
  'What a service''s assembly says a line is made of, scaled to its quantity. ENGINE support: a read, so a screen can show what would be added before anything is.';

/**
 * Put the library's answer on the line.
 *
 * Never overwrites. A kind that already carries resources is left alone — an
 * estimator who has priced the equipment does not want the library's opinion of
 * it dropped on top — and the count returned says how many were actually
 * written, not how many were offered.
 *
 * `p_kinds` narrows it: pass `array['material']` to take the materials and
 * leave the crew alone.
 */
create or replace function app.apply_line_resource_suggestions(
  p_line  uuid,
  p_kinds text[] default null
)
returns int
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_status  app.estimate_status;
  v_rate    numeric;
  r         record;
  v_written int := 0;
begin
  select l.company_id, v.status, l.parametric_cost_per_unit
    into v_company, v_status, v_rate
  from estimate_line_items l
  join estimate_versions v on v.id = l.estimate_version_id
  where l.id = p_line;

  if v_company is null then
    raise exception 'No such estimate line' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'estimates.write') then
    raise exception 'You do not have permission to change this estimate'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status not in ('draft', 'in_review') then
    raise exception 'This version is %; make a new version to change it', v_status
      using errcode = 'check_violation';
  end if;
  if v_rate is not null then
    raise exception 'This line is priced at a typed rate. Clear the rate first — a line carrying both reports a number nobody can reproduce from what is on it.'
      using errcode = 'check_violation';
  end if;

  for r in
    select * from app.line_resource_suggestions(p_line)
    where not already_on_line
      and not is_optional
      and (p_kinds is null or resource_kind = any (p_kinds))
  loop
    perform app.save_line_resource(p_line, r.resource_kind, jsonb_build_object(
      'description', r.name,
      'quantity',    r.quantity,
      'unit',        r.unit::text,
      'unit_rate',   r.unit_rate,
      'labor_rate_id', case when r.resource_kind = 'labor'     then r.resource_id end,
      'equipment_id',  case when r.resource_kind = 'equipment' then r.resource_id end,
      'material_id',   case when r.resource_kind = 'material'  then r.resource_id end));
    v_written := v_written + 1;
  end loop;

  return v_written;
end;
$$;

comment on function app.apply_line_resource_suggestions(uuid, text[]) is
  'Writes a service assembly''s components onto a line as resources. WORKFLOW: never overwrites a kind already priced, skips optional components, and returns how many were written rather than how many were offered.';

-- -----------------------------------------------------------------------------
-- Reachable from a browser
-- -----------------------------------------------------------------------------

create or replace function public.set_line_unit_cost(p_line uuid, p_rate numeric, p_basis text)
returns estimate_line_items
language sql security definer set search_path = public, pg_catalog
as $$ select app.set_line_unit_cost(p_line, p_rate, p_basis); $$;

create or replace function public.clear_line_unit_cost(p_line uuid)
returns estimate_line_items
language sql security definer set search_path = public, pg_catalog
as $$ select app.clear_line_unit_cost(p_line); $$;

create or replace function public.line_resource_suggestions(p_line uuid)
returns setof record
language sql stable security definer set search_path = public, pg_catalog
as $$ select * from app.line_resource_suggestions(p_line); $$;

create or replace function public.apply_line_resource_suggestions(
  p_line uuid, p_kinds text[] default null)
returns int
language sql security definer set search_path = public, pg_catalog
as $$ select app.apply_line_resource_suggestions(p_line, p_kinds); $$;

/** The same read, shaped for a screen that lists it. */
create or replace view my_line_resource_suggestions as
select
  l.id as line_item_id,
  l.company_id,
  s.resource_kind,
  s.resource_id,
  s.name,
  s.quantity_per_unit,
  s.quantity,
  s.unit,
  s.unit_rate,
  s.extended_cost,
  s.is_optional,
  s.already_on_line
from estimate_line_items l
cross join lateral app.line_resource_suggestions(l.id) s;

revoke all on my_line_resource_suggestions from public, anon;
grant select on my_line_resource_suggestions to authenticated;
alter view my_line_resource_suggestions set (security_invoker = on);

revoke all on function public.set_line_unit_cost(uuid, numeric, text) from public, anon;
grant execute on function public.set_line_unit_cost(uuid, numeric, text) to authenticated;
revoke all on function public.clear_line_unit_cost(uuid) from public, anon;
grant execute on function public.clear_line_unit_cost(uuid) to authenticated;
revoke all on function public.line_resource_suggestions(uuid) from public, anon;
grant execute on function public.line_resource_suggestions(uuid) to authenticated;
revoke all on function public.apply_line_resource_suggestions(uuid, text[]) from public, anon;
grant execute on function public.apply_line_resource_suggestions(uuid, text[]) to authenticated;
revoke all on function app.line_resource_suggestions(uuid) from public, anon;
grant execute on function app.line_resource_suggestions(uuid) to authenticated;
