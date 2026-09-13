-- =============================================================================
-- 0169 — The library that was in a spreadsheet
--
-- The suggestion machinery has been complete since 0126: a view saying what a
-- service implies, a writer that puts it on a line without overwriting anything
-- somebody has priced, and since this week a panel on the wrench. It shows
-- nothing, for every service, and the reason is not the code.
--
-- Every one of the 8,142 `assembly_components` in the shipped catalog is
-- `component_kind = 'task'`. There is not one labor, equipment or material
-- component in the whole library, so the suggestion query cannot return a row
-- however the question is asked. The GES Phase 05 entity catalog says what an
-- assembly component is meant to be — "Labor, equipment, material, subcontract
-- or other component" — and the catalog shipped work sequences instead.
--
-- The data was in a spreadsheet the whole time. `3rd_Terrain_Estimating_
-- Workbook.xlsx` carries 59 assemblies with columns headed **Suggested Crew**
-- and **Suggested Equipment**, 47 of them with a production rate, beside five
-- crews and nine machines with their hourly rates.
--
-- Installed rather than seeded, and by any company that wants it. These are one
-- excavation contractor's considered figures, not a universal truth, so they
-- arrive as tenant rows where RULE-003 ranks them above the shipped seed and
-- below anything quoted for a project. `company_historical` rather than
-- `company_actual`: nobody has measured them yet, and the calibration loop is
-- what turns the second into the first.
--
-- Three things deliberately left out.
--
--   * **The starter unit prices.** The workbook prices light, medium and heavy
--     clearing identically at $2,800 an acre while their production rates are
--     2, 1.2 and 0.6 acres a day — heavy clearing takes three times as long and
--     costs the same. Every EA row is $300 and most SY rows $3.50. They are
--     placeholders, and importing them would put a number in front of the
--     engine that disagrees with the engine's own inputs.
--   * **Rates measured in another unit than the line.** Strip and respread
--     topsoil are measured per acre and rated in cubic yards. That rate cannot
--     turn an acre into hours, so it is carried in the notes for somebody to
--     resolve rather than silently converted.
--   * **Machines the workbook never priced.** Chainsaws, lasers, trench boxes,
--     hydroseeders. Naming them without a rate would be naming a cost nobody
--     set.
-- =============================================================================

create or replace function app.install_earthwork_starter_library(p_company uuid default null)
returns table (crews int, machines int, assemblies int, components int, rates int)
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_co        uuid;
  v_crew      uuid;
  v_eq        uuid;
  v_asm       uuid;
  v_svc       uuid;
  v_rate      uuid;
  v_lab       uuid;
  v_crews     int := 0;
  v_machines  int := 0;
  v_asms      int := 0;
  v_comps     int := 0;
  v_rates     int := 0;
begin
  /*
   * Resolved with a branch rather than a coalesce over a subquery: the
   * subquery is planned either way, and a caller who named the company should
   * not need rights on the membership table to say so.
   */
  if p_company is not null then
    v_co := p_company;
  else
    select company_id into v_co from company_memberships
     where user_id = auth.uid() and status = 'active'
     order by created_at limit 1;
  end if;

  if v_co is null then
    raise exception 'Say which company this library is for' using errcode = 'check_violation';
  end if;
  if not app.has_permission(v_co, 'libraries.write') then
    raise exception 'You do not have permission to change the library'
      using errcode = 'insufficient_privilege';
  end if;


  /*
   * The words this library files things under, added before anything is filed.
   * `add_library_category` returns an existing category rather than refusing
   * one, so installing twice adds nothing and the crew discipline a crew names
   * is guaranteed to be on the list — which is what refused the first attempt.
   */
  perform app.add_library_category('crew_discipline', 'Earthwork', null, v_co);
  perform app.add_library_category('crew_discipline', 'Utilities', null, v_co);
  perform app.add_library_category('crew_discipline', 'Trucking', null, v_co);
  perform app.add_library_category('crew_discipline', 'General', null, v_co);
  perform app.add_library_category('equipment_class', 'Excavator', null, v_co);
  perform app.add_library_category('equipment_class', 'Dozer', null, v_co);
  perform app.add_library_category('equipment_class', 'Loader', null, v_co);
  perform app.add_library_category('equipment_class', 'Hauling', null, v_co);
  perform app.add_library_category('equipment_class', 'Compact Equipment', null, v_co);
  perform app.add_library_category('equipment_class', 'Attachment', null, v_co);
  perform app.add_library_category('equipment_class', 'Support', null, v_co);
  perform app.add_library_category('equipment_class', 'Compaction', null, v_co);
  perform app.add_library_category('service_category', 'Concrete', null, v_co);
  perform app.add_library_category('service_category', 'Demolition', null, v_co);
  perform app.add_library_category('service_category', 'Drainage', null, v_co);
  perform app.add_library_category('service_category', 'Earthwork', null, v_co);
  perform app.add_library_category('service_category', 'Erosion', null, v_co);
  perform app.add_library_category('service_category', 'Materials', null, v_co);
  perform app.add_library_category('service_category', 'Paving', null, v_co);
  perform app.add_library_category('service_category', 'Restoration', null, v_co);
  perform app.add_library_category('service_category', 'Site Prep', null, v_co);
  perform app.add_library_category('service_category', 'Specialty', null, v_co);
  perform app.add_library_category('service_category', 'Trucking', null, v_co);
  perform app.add_library_category('service_category', 'Utilities', null, v_co);
  -- The crews, as compositions of the Toledo-baseline classifications the
  -- catalog ships. The workbook's burdened rate is recorded beside each so a
  -- difference from what the classifications compute is visible rather than
  -- silently one or the other.

  insert into crews (company_id, code, name, discipline, shift_hours, status,
                     origin, source, approved_by, approved_at)
  values (v_co, 'CRW-3T-EXCA', 'Excavation Crew A', 'Earthwork', 8, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set name = excluded.name, updated_at = now()
  returning id into v_crew;
  if v_crew is not null then v_crews := v_crews + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into crew_members (company_id, crew_id, labor_rate_id, headcount, straight_hours_per_shift)
    values (v_co, v_crew, v_lab, 1, 8)
    on conflict (crew_id, labor_rate_id) do update set headcount = excluded.headcount;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into crew_members (company_id, crew_id, labor_rate_id, headcount, straight_hours_per_shift)
    values (v_co, v_crew, v_lab, 1, 8)
    on conflict (crew_id, labor_rate_id) do update set headcount = excluded.headcount;
  end if;

  insert into crews (company_id, code, name, discipline, shift_hours, status,
                     origin, source, approved_by, approved_at)
  values (v_co, 'CRW-3T-EXCB', 'Excavation Crew B', 'Earthwork', 8, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set name = excluded.name, updated_at = now()
  returning id into v_crew;
  if v_crew is not null then v_crews := v_crews + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into crew_members (company_id, crew_id, labor_rate_id, headcount, straight_hours_per_shift)
    values (v_co, v_crew, v_lab, 2, 8)
    on conflict (crew_id, labor_rate_id) do update set headcount = excluded.headcount;
  end if;

  insert into crews (company_id, code, name, discipline, shift_hours, status,
                     origin, source, approved_by, approved_at)
  values (v_co, 'CRW-3T-TRCH', 'Trenching Crew', 'Utilities', 8, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set name = excluded.name, updated_at = now()
  returning id into v_crew;
  if v_crew is not null then v_crews := v_crews + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into crew_members (company_id, crew_id, labor_rate_id, headcount, straight_hours_per_shift)
    values (v_co, v_crew, v_lab, 1, 8)
    on conflict (crew_id, labor_rate_id) do update set headcount = excluded.headcount;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into crew_members (company_id, crew_id, labor_rate_id, headcount, straight_hours_per_shift)
    values (v_co, v_crew, v_lab, 2, 8)
    on conflict (crew_id, labor_rate_id) do update set headcount = excluded.headcount;
  end if;

  insert into crews (company_id, code, name, discipline, shift_hours, status,
                     origin, source, approved_by, approved_at)
  values (v_co, 'CRW-3T-HAUL', 'Haul Crew', 'Trucking', 8, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set name = excluded.name, updated_at = now()
  returning id into v_crew;
  if v_crew is not null then v_crews := v_crews + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into crew_members (company_id, crew_id, labor_rate_id, headcount, straight_hours_per_shift)
    values (v_co, v_crew, v_lab, 1, 8)
    on conflict (crew_id, labor_rate_id) do update set headcount = excluded.headcount;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-DRV' and company_id is null limit 1;
  if v_lab is not null then
    insert into crew_members (company_id, crew_id, labor_rate_id, headcount, straight_hours_per_shift)
    values (v_co, v_crew, v_lab, 2, 8)
    on conflict (crew_id, labor_rate_id) do update set headcount = excluded.headcount;
  end if;

  insert into crews (company_id, code, name, discipline, shift_hours, status,
                     origin, source, approved_by, approved_at)
  values (v_co, 'CRW-3T-FGRD', 'Finish Grade Crew', 'Earthwork', 8, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set name = excluded.name, updated_at = now()
  returning id into v_crew;
  if v_crew is not null then v_crews := v_crews + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into crew_members (company_id, crew_id, labor_rate_id, headcount, straight_hours_per_shift)
    values (v_co, v_crew, v_lab, 1, 8)
    on conflict (crew_id, labor_rate_id) do update set headcount = excluded.headcount;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into crew_members (company_id, crew_id, labor_rate_id, headcount, straight_hours_per_shift)
    values (v_co, v_crew, v_lab, 1, 8)
    on conflict (crew_id, labor_rate_id) do update set headcount = excluded.headcount;
  end if;

  insert into crews (company_id, code, name, discipline, shift_hours, status,
                     origin, source, approved_by, approved_at)
  values (v_co, 'CRW-3T-LABR', 'Laborers', 'General', 8, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set name = excluded.name, updated_at = now()
  returning id into v_crew;
  if v_crew is not null then v_crews := v_crews + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into crew_members (company_id, crew_id, labor_rate_id, headcount, straight_hours_per_shift)
    values (v_co, v_crew, v_lab, 2, 8)
    on conflict (crew_id, labor_rate_id) do update set headcount = excluded.headcount;
  end if;

  insert into crews (company_id, code, name, discipline, shift_hours, status,
                     origin, source, approved_by, approved_at)
  values (v_co, 'CRW-3T-LOAD', 'Loader Crew', 'Earthwork', 8, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set name = excluded.name, updated_at = now()
  returning id into v_crew;
  if v_crew is not null then v_crews := v_crews + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into crew_members (company_id, crew_id, labor_rate_id, headcount, straight_hours_per_shift)
    values (v_co, v_crew, v_lab, 1, 8)
    on conflict (crew_id, labor_rate_id) do update set headcount = excluded.headcount;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into crew_members (company_id, crew_id, labor_rate_id, headcount, straight_hours_per_shift)
    values (v_co, v_crew, v_lab, 1, 8)
    on conflict (crew_id, labor_rate_id) do update set headcount = excluded.headcount;
  end if;

  -- The machines, at the rates the workbook actually paid.

  insert into equipment (company_id, code, name, equipment_class, ownership_type,
                         planned_hours_per_day, fuel_gallons_per_hour, operator_required,
                         mobilization_required, status, origin, source,
                         approved_by, approved_at)
  values (v_co, 'EQ-3T-EX336', 'CAT 336 Excavator', 'Excavator', 'owned', 8, 9.5, true, true, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_eq;
  if v_eq is not null then
    v_machines := v_machines + 1;
    insert into equipment_rates (company_id, equipment_id, source, hourly_rate, effective_date, reference)
    values (v_co, v_eq, 'tenant_approved', 185.0, current_date, '3RD Terrain estimating workbook')
    on conflict do nothing;
  end if;

  insert into equipment (company_id, code, name, equipment_class, ownership_type,
                         planned_hours_per_day, fuel_gallons_per_hour, operator_required,
                         mobilization_required, status, origin, source,
                         approved_by, approved_at)
  values (v_co, 'EQ-3T-EX349', 'CAT 349 Excavator', 'Excavator', 'owned', 8, 12.0, true, true, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_eq;
  if v_eq is not null then
    v_machines := v_machines + 1;
    insert into equipment_rates (company_id, equipment_id, source, hourly_rate, effective_date, reference)
    values (v_co, v_eq, 'tenant_approved', 235.0, current_date, '3RD Terrain estimating workbook')
    on conflict do nothing;
  end if;

  insert into equipment (company_id, code, name, equipment_class, ownership_type,
                         planned_hours_per_day, fuel_gallons_per_hour, operator_required,
                         mobilization_required, status, origin, source,
                         approved_by, approved_at)
  values (v_co, 'EQ-3T-D6', 'CAT D6 Dozer', 'Dozer', 'owned', 8, 8.5, true, true, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_eq;
  if v_eq is not null then
    v_machines := v_machines + 1;
    insert into equipment_rates (company_id, equipment_id, source, hourly_rate, effective_date, reference)
    values (v_co, v_eq, 'tenant_approved', 175.0, current_date, '3RD Terrain estimating workbook')
    on conflict do nothing;
  end if;

  insert into equipment (company_id, code, name, equipment_class, ownership_type,
                         planned_hours_per_day, fuel_gallons_per_hour, operator_required,
                         mobilization_required, status, origin, source,
                         approved_by, approved_at)
  values (v_co, 'EQ-3T-LDR', 'Wheel Loader (3-4yd)', 'Loader', 'owned', 8, 7.5, true, true, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_eq;
  if v_eq is not null then
    v_machines := v_machines + 1;
    insert into equipment_rates (company_id, equipment_id, source, hourly_rate, effective_date, reference)
    values (v_co, v_eq, 'tenant_approved', 165.0, current_date, '3RD Terrain estimating workbook')
    on conflict do nothing;
  end if;

  insert into equipment (company_id, code, name, equipment_class, ownership_type,
                         planned_hours_per_day, fuel_gallons_per_hour, operator_required,
                         mobilization_required, status, origin, source,
                         approved_by, approved_at)
  values (v_co, 'EQ-3T-ADT', 'Articulated Truck (25-30t)', 'Hauling', 'owned', 8, 8.0, true, true, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_eq;
  if v_eq is not null then
    v_machines := v_machines + 1;
    insert into equipment_rates (company_id, equipment_id, source, hourly_rate, effective_date, reference)
    values (v_co, v_eq, 'tenant_approved', 150.0, current_date, '3RD Terrain estimating workbook')
    on conflict do nothing;
  end if;

  insert into equipment (company_id, code, name, equipment_class, ownership_type,
                         planned_hours_per_day, fuel_gallons_per_hour, operator_required,
                         mobilization_required, status, origin, source,
                         approved_by, approved_at)
  values (v_co, 'EQ-3T-SKID', 'Skid Steer', 'Compact Equipment', 'owned', 8, 3.0, true, true, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_eq;
  if v_eq is not null then
    v_machines := v_machines + 1;
    insert into equipment_rates (company_id, equipment_id, source, hourly_rate, effective_date, reference)
    values (v_co, v_eq, 'tenant_approved', 85.0, current_date, '3RD Terrain estimating workbook')
    on conflict do nothing;
  end if;

  insert into equipment (company_id, code, name, equipment_class, ownership_type,
                         planned_hours_per_day, fuel_gallons_per_hour, operator_required,
                         mobilization_required, status, origin, source,
                         approved_by, approved_at)
  values (v_co, 'EQ-3T-HAMR', 'Hydraulic Hammer (attachment)', 'Attachment', 'owned', 8, 0.0, true, true, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_eq;
  if v_eq is not null then
    v_machines := v_machines + 1;
    insert into equipment_rates (company_id, equipment_id, source, hourly_rate, effective_date, reference)
    values (v_co, v_eq, 'tenant_approved', 75.0, current_date, '3RD Terrain estimating workbook')
    on conflict do nothing;
  end if;

  insert into equipment (company_id, code, name, equipment_class, ownership_type,
                         planned_hours_per_day, fuel_gallons_per_hour, operator_required,
                         mobilization_required, status, origin, source,
                         approved_by, approved_at)
  values (v_co, 'EQ-3T-WTRK', 'Water Truck', 'Support', 'owned', 8, 4.0, true, true, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_eq;
  if v_eq is not null then
    v_machines := v_machines + 1;
    insert into equipment_rates (company_id, equipment_id, source, hourly_rate, effective_date, reference)
    values (v_co, v_eq, 'tenant_approved', 110.0, current_date, '3RD Terrain estimating workbook')
    on conflict do nothing;
  end if;

  insert into equipment (company_id, code, name, equipment_class, ownership_type,
                         planned_hours_per_day, fuel_gallons_per_hour, operator_required,
                         mobilization_required, status, origin, source,
                         approved_by, approved_at)
  values (v_co, 'EQ-3T-PLATE', 'Plate Compactor/Jumping Jack', 'Compaction', 'owned', 8, 0.5, true, true, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_eq;
  if v_eq is not null then
    v_machines := v_machines + 1;
    insert into equipment_rates (company_id, equipment_id, source, hourly_rate, effective_date, reference)
    values (v_co, v_eq, 'tenant_approved', 35.0, current_date, '3RD Terrain estimating workbook')
    on conflict do nothing;
  end if;
  -- The assemblies, each with the crew and the machines the workbook put
  -- against it. `quantity_per_unit` is hours per unit of the line — a shift
  -- divided by the day's production — multiplied by headcount for labor, so
  -- the suggestion arrives as the hours it would actually take.

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-MOBILIZATION-DEMOBILIZATIO', 'Mobilization / Demobilization', 'LS', 'Includes move-in, setup, temp facilities', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-MOBILIZATION-DEMOBILIZATIO', 'Mobilization / Demobilization', 'Site Prep', 'Includes move-in, setup, temp facilities',
          'LS', array['LS']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-CLEARING-GRUBBING-LIGHT', 'Clearing & Grubbing (Light)', 'ACRE', 'Sparse brush/grasses', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-CLEARING-GRUBBING-LIGHT', 'Clearing & Grubbing (Light)', 'Site Prep', 'Sparse brush/grasses',
          'ACRE', array['ACRE']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-CLEARING-GRUBBING-LIGHT', v_svc,
          0.25, 'ACRE', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 4.0, 'ACRE')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 4.0, 'ACRE')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-D6' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 4.0, 'ACRE')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-SKID' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 21, 'equipment', v_eq, 4.0, 'ACRE')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-CLEARING-GRUBBING-MEDIUM', 'Clearing & Grubbing (Medium)', 'ACRE', 'Brush + small trees', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-CLEARING-GRUBBING-MEDIUM', 'Clearing & Grubbing (Medium)', 'Site Prep', 'Brush + small trees',
          'ACRE', array['ACRE']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-CLEARING-GRUBBING-MEDIUM', v_svc,
          0.15, 'ACRE', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 6.666667, 'ACRE')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 6.666667, 'ACRE')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-EX336' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 6.666667, 'ACRE')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-D6' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 21, 'equipment', v_eq, 6.666667, 'ACRE')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-SKID' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 22, 'equipment', v_eq, 6.666667, 'ACRE')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-CLEARING-GRUBBING-HEAVY', 'Clearing & Grubbing (Heavy)', 'ACRE', 'Dense trees/stumps', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-CLEARING-GRUBBING-HEAVY', 'Clearing & Grubbing (Heavy)', 'Site Prep', 'Dense trees/stumps',
          'ACRE', array['ACRE']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-CLEARING-GRUBBING-HEAVY', v_svc,
          0.075, 'ACRE', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 26.666667, 'ACRE')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-EX336' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 13.333333, 'ACRE')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-D6' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 21, 'equipment', v_eq, 13.333333, 'ACRE')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-TREE-REMOVAL-12-DIA', 'Tree Removal ≤12" dia', 'EA', 'Includes stump removal', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-TREE-REMOVAL-12-DIA', 'Tree Removal ≤12" dia', 'Site Prep', 'Includes stump removal',
          'EA', array['EA']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-TREE-REMOVAL-12-DIA', v_svc,
          1.5, 'EA', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.666667, 'EA')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.666667, 'EA')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-EX336' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.666667, 'EA')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-TREE-REMOVAL-12-24-DIA', 'Tree Removal 12-24" dia', 'EA', 'Includes stump removal', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-TREE-REMOVAL-12-24-DIA', 'Tree Removal 12-24" dia', 'Site Prep', 'Includes stump removal',
          'EA', array['EA']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-TREE-REMOVAL-12-24-DIA', v_svc,
          1.0, 'EA', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 1.0, 'EA')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 1.0, 'EA')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-EX336' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 1.0, 'EA')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-STUMP-GRINDING', 'Stump Grinding', 'EA', 'Grind below grade', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-STUMP-GRINDING', 'Stump Grinding', 'Site Prep', 'Grind below grade',
          'EA', array['EA']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-STUMP-GRINDING', v_svc,
          1.875, 'EA', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 1.066667, 'EA')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-SKID' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.533333, 'EA')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-STRIP-TOPSOIL-4', 'Strip Topsoil (4")', 'ACRE', 'Stockpile on site Workbook rate 500 CY/day is measured in a different unit from the line (ACRE); resolve it before this rate can drive hours.', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-STRIP-TOPSOIL-4', 'Strip Topsoil (4")', 'Earthwork', 'Stockpile on site Workbook rate 500 CY/day is measured in a different unit from the line (ACRE); resolve it before this rate can drive hours.',
          'ACRE', array['ACRE']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-RESPREAD-TOPSOIL-4', 'Respread Topsoil (4")', 'ACRE', 'Fine grade included Workbook rate 400 CY/day is measured in a different unit from the line (ACRE); resolve it before this rate can drive hours.', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-RESPREAD-TOPSOIL-4', 'Respread Topsoil (4")', 'Earthwork', 'Fine grade included Workbook rate 400 CY/day is measured in a different unit from the line (ACRE); resolve it before this rate can drive hours.',
          'ACRE', array['ACRE']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-SAWCUT-ASPHALT-CONCRETE', 'Sawcut Asphalt/Concrete', 'LF', 'For demo limits', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-SAWCUT-ASPHALT-CONCRETE', 'Sawcut Asphalt/Concrete', 'Demolition', 'For demo limits',
          'LF', array['LF']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-SAWCUT-ASPHALT-CONCRETE', v_svc,
          62.5, 'LF', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.032, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-ADT' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.016, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-WTRK' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 21, 'equipment', v_eq, 0.016, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-ASPHALT-PAVEMENT-DEMO-4-6', 'Asphalt Pavement Demo (4-6")', 'SY', 'Haul off included', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-ASPHALT-PAVEMENT-DEMO-4-6', 'Asphalt Pavement Demo (4-6")', 'Demolition', 'Haul off included',
          'SY', array['SY']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-ASPHALT-PAVEMENT-DEMO-4-6', v_svc,
          150.0, 'SY', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.006667, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.006667, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-ADT' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.006667, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-LDR' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 21, 'equipment', v_eq, 0.006667, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-SKID' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 22, 'equipment', v_eq, 0.006667, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-CONCRETE-PAVEMENT-DEMO-6-8', 'Concrete Pavement Demo (6-8")', 'SY', 'Haul off included', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-CONCRETE-PAVEMENT-DEMO-6-8', 'Concrete Pavement Demo (6-8")', 'Demolition', 'Haul off included',
          'SY', array['SY']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-CONCRETE-PAVEMENT-DEMO-6-8', v_svc,
          75.0, 'SY', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.013333, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.013333, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-EX336' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.013333, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-ADT' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 21, 'equipment', v_eq, 0.013333, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-HAMR' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 22, 'equipment', v_eq, 0.013333, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-CURB-GUTTER-REMOVAL', 'Curb & Gutter Removal', 'LF', 'Includes haul off', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-CURB-GUTTER-REMOVAL', 'Curb & Gutter Removal', 'Demolition', 'Includes haul off',
          'LF', array['LF']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-CURB-GUTTER-REMOVAL', v_svc,
          50.0, 'LF', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.02, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.02, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-EX336' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.02, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-SKID' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 21, 'equipment', v_eq, 0.02, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-SIDEWALK-REMOVAL-4', 'Sidewalk Removal (4")', 'SY', 'Includes haul off', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-SIDEWALK-REMOVAL-4', 'Sidewalk Removal (4")', 'Demolition', 'Includes haul off',
          'SY', array['SY']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-SIDEWALK-REMOVAL-4', v_svc,
          100.0, 'SY', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.02, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-SKID' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.01, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-FOUNDATION-WALL-DEMO', 'Foundation Wall Demo', 'LF', 'Up to 8'' depth', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-FOUNDATION-WALL-DEMO', 'Foundation Wall Demo', 'Demolition', 'Up to 8'' depth',
          'LF', array['LF']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-FOUNDATION-WALL-DEMO', v_svc,
          7.5, 'LF', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.133333, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.133333, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-EX336' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.133333, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-HAMR' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 21, 'equipment', v_eq, 0.133333, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-BUILDING-SLAB-DEMO', 'Building Slab Demo', 'SY', 'Rebar sorting included', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-BUILDING-SLAB-DEMO', 'Building Slab Demo', 'Demolition', 'Rebar sorting included',
          'SY', array['SY']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-BUILDING-SLAB-DEMO', v_svc,
          62.5, 'SY', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.016, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.016, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-EX336' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.016, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-HAMR' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 21, 'equipment', v_eq, 0.016, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-POOL-DEMO-PARTIAL-CRUSH-CA', 'Pool Demo - Partial (Crush & Cap)', 'EA', 'Per local code; perforate bottom', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-POOL-DEMO-PARTIAL-CRUSH-CA', 'Pool Demo - Partial (Crush & Cap)', 'Demolition', 'Per local code; perforate bottom',
          'EA', array['EA']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-POOL-DEMO-FULL-REMOVAL-HAU', 'Pool Demo - Full Removal (Haul)', 'EA', 'Remove all debris, backfill/compact', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-POOL-DEMO-FULL-REMOVAL-HAU', 'Pool Demo - Full Removal (Haul)', 'Demolition', 'Remove all debris, backfill/compact',
          'EA', array['EA']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-REMOVE-POOL-DECK-CONCRETE', 'Remove Pool Deck (Concrete)', 'SY', 'Haul off included', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-REMOVE-POOL-DECK-CONCRETE', 'Remove Pool Deck (Concrete)', 'Demolition', 'Haul off included',
          'SY', array['SY']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-REMOVE-POOL-DECK-CONCRETE', v_svc,
          75.0, 'SY', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.013333, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.013333, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-EX336' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.013333, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-SKID' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 21, 'equipment', v_eq, 0.013333, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-FENCE-REMOVE-REINSTALL', 'Fence Remove & Reinstall', 'LF', 'Includes posts reset', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-FENCE-REMOVE-REINSTALL', 'Fence Remove & Reinstall', 'Demolition', 'Includes posts reset',
          'LF', array['LF']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-FENCE-REMOVE-REINSTALL', v_svc,
          25.0, 'LF', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.08, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-SKID' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.04, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-GENERAL-EXCAVATION-COMMON-', 'General Excavation - Common Earth', 'CY', 'Average haul ≤500''', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-GENERAL-EXCAVATION-COMMON-', 'General Excavation - Common Earth', 'Earthwork', 'Average haul ≤500''',
          'CY', array['CY']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-GENERAL-EXCAVATION-COMMON-E', v_svc,
          100.0, 'CY', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.02, 'CY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-EX336' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.01, 'CY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-D6' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 21, 'equipment', v_eq, 0.01, 'CY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-ADT' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 22, 'equipment', v_eq, 0.01, 'CY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-GENERAL-EXCAVATION-ROCK-HA', 'General Excavation - Rock (Hammer)', 'CY', 'No blasting', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-GENERAL-EXCAVATION-ROCK-HA', 'General Excavation - Rock (Hammer)', 'Earthwork', 'No blasting',
          'CY', array['CY']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-GENERAL-EXCAVATION-ROCK-HAM', v_svc,
          18.75, 'CY', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.106667, 'CY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-EX336' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.053333, 'CY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-D6' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 21, 'equipment', v_eq, 0.053333, 'CY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-HAMR' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 22, 'equipment', v_eq, 0.053333, 'CY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-GENERAL-EXCAVATION-ROCK-BL', 'General Excavation - Rock (Blasting)', 'CY', 'Blasting subcontract', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-GENERAL-EXCAVATION-ROCK-BL', 'General Excavation - Rock (Blasting)', 'Earthwork', 'Blasting subcontract',
          'CY', array['CY']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-GENERAL-EXCAVATION-ROCK-BLA', v_svc,
          50.0, 'CY', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.04, 'CY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-EX336' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.02, 'CY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-D6' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 21, 'equipment', v_eq, 0.02, 'CY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-ADT' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 22, 'equipment', v_eq, 0.02, 'CY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-IMPORT-FILL-PLACE-COMPACT', 'Import Fill (Place & Compact)', 'CY', 'Avg haul 10 miles', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-IMPORT-FILL-PLACE-COMPACT', 'Import Fill (Place & Compact)', 'Earthwork', 'Avg haul 10 miles',
          'CY', array['CY']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-IMPORT-FILL-PLACE-COMPACT', v_svc,
          62.5, 'CY', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.016, 'CY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-DRV' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.032, 'CY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-D6' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.016, 'CY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-ADT' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 21, 'equipment', v_eq, 0.016, 'CY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-PLATE' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 22, 'equipment', v_eq, 0.016, 'CY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-EXPORT-SPOILS-HAUL-DUMP', 'Export Spoils (Haul & Dump)', 'CY', 'Legal dump fees extra', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-EXPORT-SPOILS-HAUL-DUMP', 'Export Spoils (Haul & Dump)', 'Earthwork', 'Legal dump fees extra',
          'CY', array['CY']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-EXPORT-SPOILS-HAUL-DUMP', v_svc,
          75.0, 'CY', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.013333, 'CY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-DRV' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.026667, 'CY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-ADT' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.013333, 'CY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-LDR' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 21, 'equipment', v_eq, 0.013333, 'CY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-FINE-GRADING-SUBGRADE', 'Fine Grading (Subgrade)', 'SY', '±0.10'' tolerance', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-FINE-GRADING-SUBGRADE', 'Fine Grading (Subgrade)', 'Earthwork', '±0.10'' tolerance',
          'SY', array['SY']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-FINE-GRADING-SUBGRADE', v_svc,
          500.0, 'SY', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.002, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.002, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-D6' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.002, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-FINE-GRADING-TOPSOIL', 'Fine Grading (Topsoil)', 'SY', 'For lawn areas', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-FINE-GRADING-TOPSOIL', 'Fine Grading (Topsoil)', 'Earthwork', 'For lawn areas',
          'SY', array['SY']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-FINE-GRADING-TOPSOIL', v_svc,
          375.0, 'SY', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.002667, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.002667, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-D6' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.002667, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-TRENCH-EXC-6-COMMON', 'Trench Exc <6'' (Common)', 'LF', 'Width ≤24"', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-TRENCH-EXC-6-COMMON', 'Trench Exc <6'' (Common)', 'Utilities', 'Width ≤24"',
          'LF', array['LF']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-TRENCH-EXC-6-COMMON', v_svc,
          18.75, 'LF', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.053333, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.106667, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-EX336' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.053333, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-PLATE' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 21, 'equipment', v_eq, 0.053333, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-TRENCH-EXC-6-10-COMMON', 'Trench Exc 6-10'' (Common)', 'LF', 'OSHA shoring', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-TRENCH-EXC-6-10-COMMON', 'Trench Exc 6-10'' (Common)', 'Utilities', 'OSHA shoring',
          'LF', array['LF']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-TRENCH-EXC-6-10-COMMON', v_svc,
          15.0, 'LF', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.066667, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.133333, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-EX336' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.066667, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-TRENCH-EXC-10-COMMON', 'Trench Exc >10'' (Common)', 'LF', 'OSHA shoring', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-TRENCH-EXC-10-COMMON', 'Trench Exc >10'' (Common)', 'Utilities', 'OSHA shoring',
          'LF', array['LF']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-TRENCH-EXC-10-COMMON', v_svc,
          10.0, 'LF', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.1, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.2, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-EX336' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.1, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-ROCK-TRENCH-HAMMER', 'Rock Trench (Hammer)', 'LF', 'As encountered', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-ROCK-TRENCH-HAMMER', 'Rock Trench (Hammer)', 'Utilities', 'As encountered',
          'LF', array['LF']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-ROCK-TRENCH-HAMMER', v_svc,
          5.0, 'LF', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.2, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.4, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-EX336' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.2, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-HAMR' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 21, 'equipment', v_eq, 0.2, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-BEDDING-MATERIAL-PLACE', 'Bedding Material Place', 'LF', 'Per pipe spec', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-BEDDING-MATERIAL-PLACE', 'Bedding Material Place', 'Utilities', 'Per pipe spec',
          'LF', array['LF']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-BEDDING-MATERIAL-PLACE', v_svc,
          37.5, 'LF', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.026667, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.053333, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-SKID' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.026667, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-PIPE-INSTALL-SDR35-8', 'Pipe Install - SDR35 8"', 'LF', 'Gravity sewer', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-PIPE-INSTALL-SDR35-8', 'Pipe Install - SDR35 8"', 'Utilities', 'Gravity sewer',
          'LF', array['LF']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-PIPE-INSTALL-SDR35-8', v_svc,
          31.25, 'LF', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.032, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.064, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-EX336' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.032, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-PIPE-INSTALL-PVC-WATER-6', 'Pipe Install - PVC Water 6"', 'LF', 'Pressure test by others', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-PIPE-INSTALL-PVC-WATER-6', 'Pipe Install - PVC Water 6"', 'Utilities', 'Pressure test by others',
          'LF', array['LF']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-PIPE-INSTALL-PVC-WATER-6', v_svc,
          27.5, 'LF', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.036364, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.072727, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-EX336' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.036364, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-BACKFILL-COMPACTION-TRENCH', 'Backfill & Compaction (Trench)', 'LF', 'Lift thickness per spec', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-BACKFILL-COMPACTION-TRENCH', 'Backfill & Compaction (Trench)', 'Utilities', 'Lift thickness per spec',
          'LF', array['LF']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-BACKFILL-COMPACTION-TRENCH', v_svc,
          37.5, 'LF', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.026667, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.053333, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-PLATE' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.026667, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-STRUCTURE-SET-MANHOLE-4-DI', 'Structure Set - Manhole 4'' dia', 'EA', 'Grout/boot install', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-STRUCTURE-SET-MANHOLE-4-DI', 'Structure Set - Manhole 4'' dia', 'Utilities', 'Grout/boot install',
          'EA', array['EA']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-STRUCTURE-SET-MANHOLE-4-DIA', v_svc,
          0.5, 'EA', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 2.0, 'EA')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 2.0, 'EA')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-EX336' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 2.0, 'EA')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-ADT' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 21, 'equipment', v_eq, 2.0, 'EA')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-STRUCTURE-SET-CATCH-BASIN-', 'Structure Set - Catch Basin Std', 'EA', 'Includes grate', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-STRUCTURE-SET-CATCH-BASIN-', 'Structure Set - Catch Basin Std', 'Utilities', 'Includes grate',
          'EA', array['EA']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-STRUCTURE-SET-CATCH-BASIN-S', v_svc,
          0.625, 'EA', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 1.6, 'EA')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 1.6, 'EA')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-EX336' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 1.6, 'EA')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-ADT' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 21, 'equipment', v_eq, 1.6, 'EA')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-AGGREGATE-BASE-6', 'Aggregate Base (6")', 'SY', '#304 or 21AA', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-AGGREGATE-BASE-6', 'Aggregate Base (6")', 'Paving', '#304 or 21AA',
          'SY', array['SY']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-AGGREGATE-BASE-6', v_svc,
          312.5, 'SY', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.0032, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-DRV' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.0064, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-ADT' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.0032, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-LDR' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 21, 'equipment', v_eq, 0.0032, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-STONE-PATHWAYS-SIDEWALK-BA', 'Stone Pathways/Sidewalk Base (4")', 'SY', 'Compact to spec', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-STONE-PATHWAYS-SIDEWALK-BA', 'Stone Pathways/Sidewalk Base (4")', 'Paving', 'Compact to spec',
          'SY', array['SY']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-STONE-PATHWAYS-SIDEWALK-BAS', v_svc,
          225.0, 'SY', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.004444, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.004444, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-SKID' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.004444, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-PLATE' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 21, 'equipment', v_eq, 0.004444, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-CRUSHED-CONCRETE-PLACE-COM', 'Crushed Concrete (Place/Compact)', 'CY', 'From on-site crushing', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-CRUSHED-CONCRETE-PLACE-COM', 'Crushed Concrete (Place/Compact)', 'Paving', 'From on-site crushing',
          'CY', array['CY']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-CRUSHED-CONCRETE-PLACE-COMP', v_svc,
          50.0, 'CY', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.02, 'CY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-DRV' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.04, 'CY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-D6' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.02, 'CY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-ADT' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 21, 'equipment', v_eq, 0.02, 'CY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-SILT-FENCE-INSTALL', 'Silt Fence Install', 'LF', 'Posts @ 6'' oc', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-SILT-FENCE-INSTALL', 'Silt Fence Install', 'Erosion', 'Posts @ 6'' oc',
          'LF', array['LF']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-SILT-FENCE-INSTALL', v_svc,
          100.0, 'LF', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.02, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-SKID' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.01, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-INLET-PROTECTION', 'Inlet Protection', 'EA', 'Mesh/bag type', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-INLET-PROTECTION', 'Inlet Protection', 'Erosion', 'Mesh/bag type',
          'EA', array['EA']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-INLET-PROTECTION', v_svc,
          1.875, 'EA', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 1.066667, 'EA')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-CONSTRUCTION-ENTRANCE-STON', 'Construction Entrance (Stone)', 'EA', '12" stone over fabric', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-CONSTRUCTION-ENTRANCE-STON', 'Construction Entrance (Stone)', 'Erosion', '12" stone over fabric',
          'EA', array['EA']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-CONSTRUCTION-ENTRANCE-STONE', v_svc,
          0.125, 'EA', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 8.0, 'EA')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 8.0, 'EA')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-EX336' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 8.0, 'EA')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-SEEDING-LAWN-HYDRO', 'Seeding - Lawn (Hydro)', 'ACRE', 'Seed, mulch, tack', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-SEEDING-LAWN-HYDRO', 'Seeding - Lawn (Hydro)', 'Restoration', 'Seed, mulch, tack',
          'ACRE', array['ACRE']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-SEEDING-LAWN-HYDRO', v_svc,
          0.1875, 'ACRE', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 10.666667, 'ACRE')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-SEEDING-LAWN-BROADCAST', 'Seeding - Lawn (Broadcast)', 'ACRE', 'Seed + straw', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-SEEDING-LAWN-BROADCAST', 'Seeding - Lawn (Broadcast)', 'Restoration', 'Seed + straw',
          'ACRE', array['ACRE']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-SEEDING-LAWN-BROADCAST', v_svc,
          0.25, 'ACRE', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 8.0, 'ACRE')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-STRAW-BLANKET-INSTALL', 'Straw Blanket Install', 'SY', 'Slopes ≤3:1', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-STRAW-BLANKET-INSTALL', 'Straw Blanket Install', 'Restoration', 'Slopes ≤3:1',
          'SY', array['SY']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-STRAW-BLANKET-INSTALL', v_svc,
          250.0, 'SY', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.008, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-DEWATERING-ALLOWANCE-DAY', 'Dewatering - Allowance (Day)', 'DAY', 'T&M allowance', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-DEWATERING-ALLOWANCE-DAY', 'Dewatering - Allowance (Day)', 'Specialty', 'T&M allowance',
          'DAY', array['DAY']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-UTILITY-LOCATES-POTHOLING', 'Utility Locates / Potholing', 'EA', 'As directed', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-UTILITY-LOCATES-POTHOLING', 'Utility Locates / Potholing', 'Specialty', 'As directed',
          'EA', array['EA']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-UTILITY-LOCATES-POTHOLING', v_svc,
          1.25, 'EA', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.8, 'EA')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 1.6, 'EA')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-EX336' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.8, 'EA')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-ROCK-HAMMER-ATTACHMENT-DAY', 'Rock Hammer (Attachment) - Day', 'DAY', 'T&M', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-ROCK-HAMMER-ATTACHMENT-DAY', 'Rock Hammer (Attachment) - Day', 'Specialty', 'T&M',
          'DAY', array['DAY']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-TRAFFIC-CONTROL-DAY', 'Traffic Control - Day', 'DAY', 'As required', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-TRAFFIC-CONTROL-DAY', 'Traffic Control - Day', 'Specialty', 'As required',
          'DAY', array['DAY']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-REMOVE-REPLACE-WALK-4', 'Remove & Replace - Walk (4")', 'SY', 'Includes haul & pour', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-REMOVE-REPLACE-WALK-4', 'Remove & Replace - Walk (4")', 'Concrete', 'Includes haul & pour',
          'SY', array['SY']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-REMOVE-REPLACE-WALK-4', v_svc,
          37.5, 'SY', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.026667, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.026667, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-SKID' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.026667, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-REMOVE-REPLACE-DRIVE-6', 'Remove & Replace - Drive (6")', 'SY', 'Includes haul & pour', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-REMOVE-REPLACE-DRIVE-6', 'Remove & Replace - Drive (6")', 'Concrete', 'Includes haul & pour',
          'SY', array['SY']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-REMOVE-REPLACE-DRIVE-6', v_svc,
          31.25, 'SY', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.032, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.032, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-SKID' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.032, 'SY')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-FRENCH-DRAIN-W-PERF-PIPE', 'French Drain (w/ perf pipe)', 'LF', 'Stone + fabric + pipe', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-FRENCH-DRAIN-W-PERF-PIPE', 'French Drain (w/ perf pipe)', 'Drainage', 'Stone + fabric + pipe',
          'LF', array['LF']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-FRENCH-DRAIN-W-PERF-PIPE', v_svc,
          25.0, 'LF', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.04, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.08, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-SKID' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.04, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-EX336' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 21, 'equipment', v_eq, 0.04, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-PLATE' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 22, 'equipment', v_eq, 0.04, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-CATCH-BASIN-ADJUST-TO-GRAD', 'Catch Basin Adjust to Grade', 'EA', 'Raise/lower frame', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-CATCH-BASIN-ADJUST-TO-GRAD', 'Catch Basin Adjust to Grade', 'Drainage', 'Raise/lower frame',
          'EA', array['EA']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-CATCH-BASIN-ADJUST-TO-GRADE', v_svc,
          1.5, 'EA', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 1.333333, 'EA')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-DOWNSPOUT-BURY-TO-DAYLIGHT', 'Downspout Bury to Daylight', 'LF', '4" perf/smooth', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-DOWNSPOUT-BURY-TO-DAYLIGHT', 'Downspout Bury to Daylight', 'Drainage', '4" perf/smooth',
          'LF', array['LF']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into production_rates (company_id, code, service_id, rate_per_hour, rate_unit,
                                utilization_factor, shift_hours, source_type,
                                confidence_score, region, effective_date, status,
                                origin, source, approved_by, approved_at)
  values (v_co, 'PR-3T-DOWNSPOUT-BURY-TO-DAYLIGHT', v_svc,
          22.5, 'LF', 1, 8, 'company_historical',
          0.7, 'Toledo, Ohio', current_date, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set rate_per_hour = excluded.rate_per_hour, updated_at = now()
  returning id into v_rate;
  if v_rate is not null then v_rates := v_rates + 1; end if;
  select id into v_lab from labor_rates where code = 'LAB-OP1' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.044444, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_lab from labor_rates where code = 'LAB-LAB' and company_id is null limit 1;
  if v_lab is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     labor_rate_id, quantity_per_unit, unit)
    values (v_co, v_asm, 10, 'labor', v_lab, 0.088889, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-SKID' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 20, 'equipment', v_eq, 0.044444, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;
  select id into v_eq from equipment where code = 'EQ-3T-EX336' and company_id = v_co limit 1;
  if v_eq is not null then
    insert into assembly_components (company_id, assembly_id, sort_order, component_kind,
                                     equipment_id, quantity_per_unit, unit)
    values (v_co, v_asm, 21, 'equipment', v_eq, 0.044444, 'LF')
    on conflict do nothing;
    v_comps := v_comps + 1;
  end if;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-IMPORT-TOPSOIL-DELIVERED', 'Import Topsoil (Delivered)', 'CY', 'Supplier ticketed', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-IMPORT-TOPSOIL-DELIVERED', 'Import Topsoil (Delivered)', 'Materials', 'Supplier ticketed',
          'CY', array['CY']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-HAUL-TO-DUMP-CLEAN', 'Haul to Dump (Clean)', 'CY', 'Per CY-mile Workbook prices this per cubic-yard-mile. Measured here in cubic yards; the haul distance belongs on the trucking row, where the engine computes the cycle rather than taking a rate per mile.', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-HAUL-TO-DUMP-CLEAN', 'Haul to Dump (Clean)', 'Trucking', 'Per CY-mile Workbook prices this per cubic-yard-mile. Measured here in cubic yards; the haul distance belongs on the trucking row, where the engine computes the cycle rather than taking a rate per mile.',
          'CY', array['CY']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-HAUL-TO-DUMP-MIXED-DEBRIS', 'Haul to Dump (Mixed Debris)', 'CY', 'Higher dump fees Workbook prices this per cubic-yard-mile. Measured here in cubic yards; the haul distance belongs on the trucking row, where the engine computes the cycle rather than taking a rate per mile.', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-HAUL-TO-DUMP-MIXED-DEBRIS', 'Haul to Dump (Mixed Debris)', 'Trucking', 'Higher dump fees Workbook prices this per cubic-yard-mile. Measured here in cubic yards; the haul distance belongs on the trucking row, where the engine computes the cycle rather than taking a rate per mile.',
          'CY', array['CY']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  insert into assemblies (company_id, code, name, quantity_unit, description, status,
                          origin, source, approved_by, approved_at)
  values (v_co, 'ASM-3T-ON-SITE-CRUSHING-CONCRETE', 'On-Site Crushing (Concrete)', 'DAY', 'Mob + daily rate', 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update set name = excluded.name, updated_at = now()
  returning id into v_asm;
  if v_asm is not null then v_asms := v_asms + 1; end if;

  insert into services (company_id, code, name, category, description, default_unit,
                        supported_units, default_assembly_id, status,
                        origin, source, approved_by, approved_at)
  values (v_co, 'SVC-3T-ON-SITE-CRUSHING-CONCRETE', 'On-Site Crushing (Concrete)', 'Specialty', 'Mob + daily rate',
          'DAY', array['DAY']::app.unit_code[], v_asm, 'active',
          'imported', '3RD Terrain estimating workbook', auth.uid(), now())
  on conflict (company_id, code) where company_id is not null do update
    set default_assembly_id = excluded.default_assembly_id,
        description = excluded.description, updated_at = now()
  returning id into v_svc;

  return query select v_crews, v_machines, v_asms, v_comps, v_rates;
end;
$$;

comment on function app.install_earthwork_starter_library(uuid) is
  'Installs an excavation contractor''s starter library — crews, machines, assemblies with their labor and equipment components, and production rates — as tenant rows. LIBRARY. Rates arrive as company_historical because nobody has measured them yet; the calibration loop is what makes them actuals.';

revoke all on function app.install_earthwork_starter_library(uuid) from public, anon;
grant execute on function app.install_earthwork_starter_library(uuid) to authenticated;

create or replace function public.install_earthwork_starter_library(p_company uuid default null)
returns table (crews int, machines int, assemblies int, components int, rates int)
language sql security invoker set search_path = public, pg_catalog
as $$ select * from app.install_earthwork_starter_library(p_company); $$;

revoke all on function public.install_earthwork_starter_library(uuid) from public, anon;
grant execute on function public.install_earthwork_starter_library(uuid) to authenticated;

select app.assert_security_gates();