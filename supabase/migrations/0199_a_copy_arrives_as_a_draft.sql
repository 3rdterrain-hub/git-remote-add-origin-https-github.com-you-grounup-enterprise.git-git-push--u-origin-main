-- =============================================================================
-- 0199 — A copy arrives as a draft, and says the company made it
--
-- 0198 gave six libraries their copy path and got two things wrong about what a
-- copy *is*. Both were caught by constraints the schema had been carrying all
-- along, which is the schema doing its job:
--
--   * **`*_active_needs_approver`.** A company row may not be `active` without
--     an approver. 0198 inserted every copy as active with nobody named, and
--     the database refused all six. The constraint is right and the fix is not
--     to satisfy it by stamping the copier as the approver: **a copy arrives as
--     a draft unless the person making it can approve library rows.** A rate
--     nobody has looked at should not price a bid, and RULE-008 says the same
--     thing in general — the platform proposes, a person accepts.
--
--   * **`*_origin_known`.** `origin` takes `catalog`, `company`, `ai_discovered`
--     or `imported`, and 0198 wrote `human`, which is the vocabulary a different
--     column uses. A copy's origin is `company`: it exists because this company
--     asked for it.
--
-- The three helpers below exist so the answer to "what status, and whose
-- approval" is given once rather than six times. Six copies of a rule is five
-- chances for it to drift.
-- =============================================================================

/** Whether a copy this caller makes can go straight to active, or lands as draft. */
create or replace function app.copy_status(p_company uuid)
returns app.record_status
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case when app.has_permission(p_company, 'libraries.approve')
              then 'active'::app.record_status
              else 'draft'::app.record_status end;
$$;

comment on function app.copy_status(uuid) is
  'The status a copied catalog row lands in: active when the caller can approve library rows, draft otherwise. LIBRARY support: a row nobody has looked at should not price a bid.';

/** Who approved a copy, where the caller could approve it. */
create or replace function app.copy_approver(p_company uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case when app.has_permission(p_company, 'libraries.approve') then auth.uid() end;
$$;

/** When a copy was approved, where the caller could approve it. */
create or replace function app.copy_approved_at(p_company uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case when app.has_permission(p_company, 'libraries.approve') then now() end;
$$;

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
                        default_assembly_id, cost_code_id, status, source, origin,
                        approved_by, approved_at)
  values (p_company, v_code, v_src.name, v_src.industry, v_src.category, v_src.subcategory,
          v_src.description, v_src.default_unit, v_src.supported_units, v_src.pricing_method,
          v_src.default_assembly_id, v_src.cost_code_id,
          app.copy_status(p_company), 'Copied from ' || v_src.code, 'company',
          app.copy_approver(p_company), app.copy_approved_at(p_company))
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
                     status, source, origin, approved_by, approved_at)
  values (p_company, v_code, v_src.name, v_src.category, v_src.default_unit,
          v_src.default_method_code, v_src.production_required, v_src.crew_required,
          v_src.equipment_required, v_src.material_required, v_src.safety_review_required,
          v_src.quality_review_required, app.copy_status(p_company),
          'Copied from ' || v_src.code, 'company',
          app.copy_approver(p_company), app.copy_approved_at(p_company))
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
          current_date, app.copy_status(p_company),
          case when app.has_permission(p_company, 'libraries.approve')
               then 'approved'::app.approval_state else 'pending'::app.approval_state end,
          'Copied from ' || v_src.code, 'company',
          app.copy_approver(p_company), app.copy_approved_at(p_company))
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
                         status, source, origin, brand, model, service_groups,
                         approved_by, approved_at)
  values (p_company, v_code, v_src.name, v_src.equipment_class, v_src.ownership_type,
          v_src.planned_hours_per_day, v_src.fuel_gallons_per_hour, v_src.def_percent_of_fuel,
          v_src.operator_required, v_src.mobilization_required, v_src.mobilization_cost,
          app.copy_status(p_company), 'Copied from ' || v_src.code, 'company',
          v_src.brand, v_src.model, v_src.service_groups,
          app.copy_approver(p_company), app.copy_approved_at(p_company))
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

  insert into crews (company_id, code, name, discipline, shift_hours, status, source,
                     origin, approved_by, approved_at)
  values (p_company, v_code, v_src.name, v_src.discipline, v_src.shift_hours,
          app.copy_status(p_company), 'Copied from ' || v_src.code, 'company',
          app.copy_approver(p_company), app.copy_approved_at(p_company))
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
          app.copy_status(p_company), current_date, 'Copied from ' || v_src.code, 'company',
          app.copy_approver(p_company), app.copy_approved_at(p_company))
  returning * into v_copy;
  return v_copy;
end;
$$;

