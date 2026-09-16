-- =============================================================================
-- 0198 — A shipped row you can make your own
--
-- O-026, open since the libraries screen was built: the "Copy to company scope"
-- button was disabled with the reason written on it, which was honest, and left
-- the platform shipping 2,819 services, 8,532 tasks, 700 machines, 56 labor
-- classifications, 42 crews and 2,143 production rates that no company could
-- take a single one of and make its own.
--
-- Two of these already existed and are left exactly alone: `customize_assembly`
-- (0129) copies a work sequence with its steps, and `set_material_cost` (0133)
-- copies a catalog material the moment somebody prices it. This is the rest of
-- the same idea, in the same shape, with one dispatcher over the top so a screen
-- can offer one gesture instead of six.
--
-- The three properties every one of these holds, taken from 0129:
--
--   1. **A second call is not an error.** Somebody pressing "make it mine"
--      twice means to work on their copy. A duplicate row is worse than a no-op,
--      so the existing copy comes back.
--   2. **The platform's row is never touched.** RLS already refuses it; these
--      raise a sentence saying what to do instead rather than letting a policy
--      return a bare permission error.
--   3. **The copy says where it came from.** `source` carries the original code,
--      so a rate somebody is about to argue with can be traced back to what was
--      shipped.
--
-- What is deliberately not copied: rates and prices attached to the row.
-- Copying a machine brings the machine, not somebody else's hourly rate —
-- RULE-003 decides which rate prices, and a copied rate would quietly insert
-- itself into that order carrying a company's own precedence.
--
-- LIBRARY.
-- =============================================================================

/**
 * The company-scoped code for a copy of a catalog row.
 *
 * The same construction 0129 and 0133 use, kept in one place now that six
 * tables want it: the original code, trimmed to fit, plus six characters of the
 * company id. Deterministic, so a second call finds the first copy.
 */
create or replace function app.company_scoped_code(p_code text, p_company uuid, p_max int default 30)
returns text
language sql
immutable
as $$
  select left(p_code, p_max) || '-' || substring(replace(p_company::text, '-', '') from 1 for 6);
$$;

comment on function app.company_scoped_code(text, uuid, int) is
  'The code a company''s copy of a catalog row takes. LIBRARY support: deterministic, so copying twice finds the first copy rather than making a second.';

/** Refuses when the caller may not write this company's libraries. */
create or replace function app.assert_can_copy_catalog(p_company uuid)
returns void
language plpgsql
stable
as $$
begin
  if p_company is null then
    raise exception 'Say which company library this copy belongs in'
      using errcode = 'no_data_found';
  end if;
  if not app.has_permission(p_company, 'libraries.write') then
    raise exception 'Making your own copy of a shipped row needs the libraries.write permission'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- A service
-- -----------------------------------------------------------------------------

create or replace function app.customize_service(p_service uuid, p_company uuid)
returns services
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_src  services;
  v_copy services;
  v_code text;
begin
  select * into v_src from services where id = p_service;
  if v_src.id is null then
    raise exception 'No such service' using errcode = 'no_data_found';
  end if;
  perform app.assert_can_copy_catalog(p_company);
  if v_src.company_id = p_company then return v_src; end if;
  if v_src.company_id is not null then
    raise exception 'That service belongs to another company'
      using errcode = 'insufficient_privilege';
  end if;

  v_code := app.company_scoped_code(v_src.code, p_company);
  select * into v_copy from services where company_id = p_company and code = v_code;
  if v_copy.id is not null then return v_copy; end if;

  insert into services (company_id, code, name, industry, category, subcategory,
                        description, default_unit, supported_units, pricing_method,
                        default_assembly_id, cost_code_id, status, source, origin)
  values (p_company, v_code, v_src.name, v_src.industry, v_src.category, v_src.subcategory,
          v_src.description, v_src.default_unit, v_src.supported_units, v_src.pricing_method,
          v_src.default_assembly_id, v_src.cost_code_id, 'active',
          'Copied from ' || v_src.code, 'human')
  returning * into v_copy;
  return v_copy;
end;
$$;

-- -----------------------------------------------------------------------------
-- A task
-- -----------------------------------------------------------------------------

create or replace function app.customize_task(p_task uuid, p_company uuid)
returns tasks
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_src  tasks;
  v_copy tasks;
  v_code text;
begin
  select * into v_src from tasks where id = p_task;
  if v_src.id is null then
    raise exception 'No such task' using errcode = 'no_data_found';
  end if;
  perform app.assert_can_copy_catalog(p_company);
  if v_src.company_id = p_company then return v_src; end if;
  if v_src.company_id is not null then
    raise exception 'That task belongs to another company'
      using errcode = 'insufficient_privilege';
  end if;

  v_code := app.company_scoped_code(v_src.code, p_company);
  select * into v_copy from tasks where company_id = p_company and code = v_code;
  if v_copy.id is not null then return v_copy; end if;

  insert into tasks (company_id, code, name, category, default_unit, default_method_code,
                     production_required, crew_required, equipment_required,
                     material_required, safety_review_required, quality_review_required,
                     status, source, origin)
  values (p_company, v_code, v_src.name, v_src.category, v_src.default_unit,
          v_src.default_method_code, v_src.production_required, v_src.crew_required,
          v_src.equipment_required, v_src.material_required, v_src.safety_review_required,
          v_src.quality_review_required, 'active', 'Copied from ' || v_src.code, 'human')
  returning * into v_copy;
  return v_copy;
end;
$$;

-- -----------------------------------------------------------------------------
-- A labor classification
-- -----------------------------------------------------------------------------

/**
 * Copy a classification, wage and all.
 *
 * The wage does come with this one, and that is the difference between a labor
 * rate and a machine: the shipped wage is the prevailing or union rate for the
 * classification, which is a real number about the trade rather than about
 * somebody else's fleet. It arrives unapproved unless the caller can approve,
 * so nothing prices from it until a person has looked at it.
 */
create or replace function app.customize_labor_rate(p_rate uuid, p_company uuid)
returns labor_rates
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_src  labor_rates;
  v_copy labor_rates;
  v_code text;
begin
  select * into v_src from labor_rates where id = p_rate;
  if v_src.id is null then
    raise exception 'No such labor rate' using errcode = 'no_data_found';
  end if;
  perform app.assert_can_copy_catalog(p_company);
  if v_src.company_id = p_company then return v_src; end if;
  if v_src.company_id is not null then
    raise exception 'That rate belongs to another company'
      using errcode = 'insufficient_privilege';
  end if;

  v_code := app.company_scoped_code(v_src.code, p_company);
  select * into v_copy from labor_rates where company_id = p_company and code = v_code;
  if v_copy.id is not null then return v_copy; end if;

  insert into labor_rates (company_id, code, classification, labor_group,
                           base_wage_per_hour, burden_percent, overtime_multiplier,
                           doubletime_multiplier, pricing_profile, region, is_union,
                           effective_date, status, approval_state, source, origin,
                           approved_by, approved_at)
  values (p_company, v_code, v_src.classification, v_src.labor_group,
          v_src.base_wage_per_hour, v_src.burden_percent, v_src.overtime_multiplier,
          v_src.doubletime_multiplier, v_src.pricing_profile, v_src.region, v_src.is_union,
          current_date, 'active',
          case when app.has_permission(p_company, 'libraries.approve')
               then 'approved'::app.approval_state else 'pending'::app.approval_state end,
          'Copied from ' || v_src.code, 'human',
          case when app.has_permission(p_company, 'libraries.approve') then auth.uid() end,
          case when app.has_permission(p_company, 'libraries.approve') then now() end)
  returning * into v_copy;
  return v_copy;
end;
$$;

-- -----------------------------------------------------------------------------
-- A machine
-- -----------------------------------------------------------------------------

/**
 * Copy the machine, not the rate.
 *
 * `equipment_rates` is deliberately left behind. RULE-003 decides which rate
 * prices — `project_quote` over `tenant_approved` over `regional` over
 * `global_seed` — and a copied rate would arrive carrying this company's own
 * precedence while being somebody else's number. The company sets its own rate
 * through the rate path, where it is asked where the figure came from.
 */
create or replace function app.customize_equipment(p_equipment uuid, p_company uuid)
returns equipment
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_src  equipment;
  v_copy equipment;
  v_code text;
begin
  select * into v_src from equipment where id = p_equipment;
  if v_src.id is null then
    raise exception 'No such equipment' using errcode = 'no_data_found';
  end if;
  perform app.assert_can_copy_catalog(p_company);
  if v_src.company_id = p_company then return v_src; end if;
  if v_src.company_id is not null then
    raise exception 'That machine belongs to another company'
      using errcode = 'insufficient_privilege';
  end if;

  v_code := app.company_scoped_code(v_src.code, p_company);
  select * into v_copy from equipment where company_id = p_company and code = v_code;
  if v_copy.id is not null then return v_copy; end if;

  insert into equipment (company_id, code, name, equipment_class, ownership_type,
                         planned_hours_per_day, fuel_gallons_per_hour, def_percent_of_fuel,
                         operator_required, mobilization_required, mobilization_cost,
                         status, source, origin, brand, model, service_groups)
  values (p_company, v_code, v_src.name, v_src.equipment_class, v_src.ownership_type,
          v_src.planned_hours_per_day, v_src.fuel_gallons_per_hour, v_src.def_percent_of_fuel,
          v_src.operator_required, v_src.mobilization_required, v_src.mobilization_cost,
          'active', 'Copied from ' || v_src.code, 'human',
          v_src.brand, v_src.model, v_src.service_groups)
  returning * into v_copy;
  return v_copy;
end;
$$;

-- -----------------------------------------------------------------------------
-- A crew
-- -----------------------------------------------------------------------------

/**
 * Copy a crew and the people in it.
 *
 * The members come with it, pointed at whichever labor rate the company already
 * has for that classification — and at the shipped one where it has none, which
 * is exactly what the rate precedence is for. A crew copied without its members
 * is an empty crew, and forty-two of those is what the library shipped before
 * migration 0187 gave `crew_members` a writer at all.
 */
create or replace function app.customize_crew(p_crew uuid, p_company uuid)
returns crews
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_src  crews;
  v_copy crews;
  v_code text;
begin
  select * into v_src from crews where id = p_crew;
  if v_src.id is null then
    raise exception 'No such crew' using errcode = 'no_data_found';
  end if;
  perform app.assert_can_copy_catalog(p_company);
  if v_src.company_id = p_company then return v_src; end if;
  if v_src.company_id is not null then
    raise exception 'That crew belongs to another company'
      using errcode = 'insufficient_privilege';
  end if;

  v_code := app.company_scoped_code(v_src.code, p_company);
  select * into v_copy from crews where company_id = p_company and code = v_code;
  if v_copy.id is not null then return v_copy; end if;

  insert into crews (company_id, code, name, discipline, shift_hours, status, source, origin)
  values (p_company, v_code, v_src.name, v_src.discipline, v_src.shift_hours,
          'active', 'Copied from ' || v_src.code, 'human')
  returning * into v_copy;

  insert into crew_members (company_id, crew_id, labor_rate_id, headcount,
                            straight_hours_per_shift, overtime_hours_per_shift,
                            doubletime_hours_per_shift)
  select p_company, v_copy.id,
         /* Their own classification where they have one; the shipped one otherwise. */
         coalesce((select mine.id from labor_rates mine
                    join labor_rates src on src.id = m.labor_rate_id
                   where mine.company_id = p_company
                     and mine.classification = src.classification
                     and mine.status = 'active'
                   order by mine.effective_date desc limit 1),
                  m.labor_rate_id),
         m.headcount, m.straight_hours_per_shift, m.overtime_hours_per_shift,
         m.doubletime_hours_per_shift
    from crew_members m
   where m.crew_id = p_crew;

  return v_copy;
end;
$$;

-- -----------------------------------------------------------------------------
-- A production rate
-- -----------------------------------------------------------------------------

/**
 * Copy a production rate so a company can put its own number on it.
 *
 * It arrives as `company_actual` only if the caller says so elsewhere — here it
 * keeps the source type it had, because a shipped industry rate copied into a
 * company library is still an industry rate until somebody measures their own.
 * Claiming otherwise would put a company's name on a number nobody there
 * produced, and every confidence figure downstream reads `source_type`.
 */
create or replace function app.customize_production_rate(p_rate uuid, p_company uuid)
returns production_rates
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_src  production_rates;
  v_copy production_rates;
  v_code text;
begin
  select * into v_src from production_rates where id = p_rate;
  if v_src.id is null then
    raise exception 'No such production rate' using errcode = 'no_data_found';
  end if;
  perform app.assert_can_copy_catalog(p_company);
  if v_src.company_id = p_company then return v_src; end if;
  if v_src.company_id is not null then
    raise exception 'That rate belongs to another company'
      using errcode = 'insufficient_privilege';
  end if;

  v_code := app.company_scoped_code(v_src.code, p_company);
  select * into v_copy from production_rates where company_id = p_company and code = v_code;
  if v_copy.id is not null then return v_copy; end if;

  insert into production_rates (company_id, code, task_id, service_id, crew_id, method_code,
                                rate_per_hour, rate_unit, utilization_factor, shift_hours,
                                equipment_spread, controlling_resource, material_condition,
                                access_condition, weather_condition, region, source_type,
                                confidence_score, sample_size, approval_state, status,
                                effective_date, source, origin, approved_by, approved_at)
  values (p_company, v_code, v_src.task_id, v_src.service_id, v_src.crew_id, v_src.method_code,
          v_src.rate_per_hour, v_src.rate_unit, v_src.utilization_factor, v_src.shift_hours,
          v_src.equipment_spread, v_src.controlling_resource, v_src.material_condition,
          v_src.access_condition, v_src.weather_condition, v_src.region, v_src.source_type,
          v_src.confidence_score, v_src.sample_size,
          case when app.has_permission(p_company, 'libraries.approve')
               then 'approved'::app.approval_state else 'pending'::app.approval_state end,
          'active', current_date, 'Copied from ' || v_src.code, 'human',
          case when app.has_permission(p_company, 'libraries.approve') then auth.uid() end,
          case when app.has_permission(p_company, 'libraries.approve') then now() end)
  returning * into v_copy;
  return v_copy;
end;
$$;

-- -----------------------------------------------------------------------------
-- One gesture over the six
-- -----------------------------------------------------------------------------

/**
 * Make a shipped row the company's own, whichever library it is in.
 *
 * Returns the copy's id. A screen offers one button; which function runs is a
 * question about the row, not about the person pressing it. Assemblies and
 * materials route to the two that already existed — `customize_assembly` (0129)
 * and `set_material_cost` (0133) — rather than to a second implementation
 * beside them, which is how this repository ended up with two lead intakes and
 * two `set_material_cost`s before anybody noticed.
 */
create or replace function app.adopt_library_row(
  p_kind text,
  p_row uuid,
  p_company uuid)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare v_id uuid;
begin
  case p_kind
    when 'service'         then select id into v_id from app.customize_service(p_row, p_company);
    when 'task'            then select id into v_id from app.customize_task(p_row, p_company);
    when 'labor_rate'      then select id into v_id from app.customize_labor_rate(p_row, p_company);
    when 'equipment'       then select id into v_id from app.customize_equipment(p_row, p_company);
    when 'crew'            then select id into v_id from app.customize_crew(p_row, p_company);
    when 'production_rate' then select id into v_id from app.customize_production_rate(p_row, p_company);
    when 'assembly'        then select id into v_id from public.customize_assembly(p_row, p_company);
    when 'material'        then
      raise exception 'A catalog material is copied by pricing it'
        using errcode = 'check_violation',
              hint = 'set_material_cost does it, because a price is a fact about who is buying rather than about the material.';
    else
      raise exception 'There is no library called %', p_kind using errcode = 'check_violation';
  end case;
  return v_id;
end;
$$;

comment on function app.adopt_library_row(text, uuid, uuid) is
  'Makes a shipped catalog row the company''s own, whichever library it is in. LIBRARY: one gesture over six copies, routing assemblies and materials to the functions that already did it rather than to a second implementation beside them.';

-- -----------------------------------------------------------------------------
-- What a screen reads
-- -----------------------------------------------------------------------------

/**
 * Which shipped rows this company has taken a copy of.
 *
 * Read by the libraries screen so a row that has already been copied says so
 * and offers the copy, rather than offering to make a second one that the
 * function would decline to make anyway.
 */
create or replace view my_library_copies
with (security_invoker = true) as
select 'service'::text as kind, s.id, s.company_id, s.code, s.name, s.source, s.status::text
  from services s where s.company_id is not null
union all
select 'task', t.id, t.company_id, t.code, t.name, t.source, t.status::text
  from tasks t where t.company_id is not null
union all
select 'assembly', a.id, a.company_id, a.code, a.name, a.source, a.status::text
  from assemblies a where a.company_id is not null
union all
select 'labor_rate', l.id, l.company_id, l.code, l.classification, l.source, l.status::text
  from labor_rates l where l.company_id is not null
union all
select 'equipment', e.id, e.company_id, e.code, e.name, e.source, e.status::text
  from equipment e where e.company_id is not null
union all
select 'crew', c.id, c.company_id, c.code, c.name, c.source, c.status::text
  from crews c where c.company_id is not null
union all
select 'production_rate', p.id, p.company_id, p.code, p.code, p.source, p.status::text
  from production_rates p where p.company_id is not null
union all
select 'material', m.id, m.company_id, m.code, m.name, m.source, m.status::text
  from materials m where m.company_id is not null;

revoke all on my_library_copies from public, anon;
grant select on my_library_copies to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The doors
-- -----------------------------------------------------------------------------

create or replace function public.adopt_library_row(
  p_kind text, p_row uuid, p_company uuid)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.adopt_library_row(p_kind, p_row, p_company); $$;

create or replace function public.customize_service(p_service uuid, p_company uuid)
returns services language sql security invoker set search_path = public, pg_catalog
as $$ select app.customize_service(p_service, p_company); $$;

create or replace function public.customize_task(p_task uuid, p_company uuid)
returns tasks language sql security invoker set search_path = public, pg_catalog
as $$ select app.customize_task(p_task, p_company); $$;

create or replace function public.customize_labor_rate(p_rate uuid, p_company uuid)
returns labor_rates language sql security invoker set search_path = public, pg_catalog
as $$ select app.customize_labor_rate(p_rate, p_company); $$;

create or replace function public.customize_equipment(p_equipment uuid, p_company uuid)
returns equipment language sql security invoker set search_path = public, pg_catalog
as $$ select app.customize_equipment(p_equipment, p_company); $$;

create or replace function public.customize_crew(p_crew uuid, p_company uuid)
returns crews language sql security invoker set search_path = public, pg_catalog
as $$ select app.customize_crew(p_crew, p_company); $$;

create or replace function public.customize_production_rate(p_rate uuid, p_company uuid)
returns production_rates language sql security invoker set search_path = public, pg_catalog
as $$ select app.customize_production_rate(p_rate, p_company); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.adopt_library_row(text, uuid, uuid)',
    'public.customize_service(uuid, uuid)',
    'public.customize_task(uuid, uuid)',
    'public.customize_labor_rate(uuid, uuid)',
    'public.customize_equipment(uuid, uuid)',
    'public.customize_crew(uuid, uuid)',
    'public.customize_production_rate(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

select app.assert_security_gates();
