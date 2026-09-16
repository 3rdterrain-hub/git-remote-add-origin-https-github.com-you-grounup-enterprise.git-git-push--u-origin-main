-- =============================================================================
-- 0189 — A price you enter once
--
-- The defect that makes this platform look broken to the person using it, found
-- by the owner pricing a real line and getting $0.00.
--
-- `app.line_resource_suggestions` (0126) — the thing that says what a service
-- costs — reads `assembly_components` where `component_kind in ('labor',
-- 'equipment', 'material', 'trucking')`. The shipped catalog contains seventeen
-- insert statements into that table and **every one of them is 'task'**. Zero
-- labor, zero equipment, zero material, in any migration in this repository.
--
-- So all 2,545 shipped services describe what work happens and carry nothing
-- that costs money. Pick one, enter a quantity, press Price: $0.00. Every
-- service, every company, since the catalog was written. The message is honest
-- — "1 line has a quantity and no price" — but the product's whole purpose is
-- estimating, and out of the box it cannot price anything.
--
-- What this migration does NOT do is seed prices. "Never invent a number" is
-- the rule and it is the right one: a crew and a rate this repository guessed
-- would be a price nobody could reproduce, attached to 2,545 services, wrong in
-- ways nobody could find.
--
-- What it does is supply the missing half of the library. Everything needed to
-- build a line up by hand already exists — `save_line_resource` (0108) puts a
-- crew on a line, `set_line_unit_cost` records an allowance. What did not exist
-- was any way to keep it: `add_assembly_step` (0129) adds a *task* and nothing
-- writes a labor, equipment or material component. So an estimator builds the
-- crew for "Aggregate base" today, and builds it again next month, and the
-- catalog never learns anything.
--
--   * `add_assembly_resource` gives those component kinds their first writer.
--   * `save_line_buildup_to_library` takes what is on a line and keeps it,
--     copying a shipped assembly into the company's own library first, because
--     0129 rightly refuses to let one company edit what every company reads.
--   * `my_service_buildup` says, before anything is priced, whether a service
--     can produce a cost at all — so the screen can say so when the line is
--     added rather than after the engine has run.
--
-- LIBRARY.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Whether a service can price at all
-- -----------------------------------------------------------------------------

/**
 * What a service's assembly actually carries.
 *
 * `costed_components` is the number that matters: components of a kind that
 * produces money. A service with tasks and no costed components is a work
 * breakdown — useful, and not a price. Saying so before the engine runs is the
 * difference between "add your crew here" and a mystifying $0.00.
 */
create or replace view my_service_buildup
with (security_invoker = true) as
select s.id                          as service_id,
       s.company_id,
       s.code,
       s.name,
       s.default_unit,
       s.default_assembly_id,
       a.company_id is not null      as assembly_is_own,
       coalesce(c.task_components, 0)   as task_components,
       coalesce(c.costed_components, 0) as costed_components,
       (coalesce(c.costed_components, 0) > 0) as can_price
  from services s
  left join assemblies a on a.id = s.default_assembly_id
  left join lateral (
    select count(*) filter (where ac.component_kind = 'task')     as task_components,
           count(*) filter (where ac.component_kind in
             ('labor', 'equipment', 'material', 'trucking', 'subcontract'))
                                                                  as costed_components
      from assembly_components ac
     where ac.assembly_id = s.default_assembly_id
  ) c on true;

comment on view my_service_buildup is
  'Whether a service can produce a cost, and what its assembly is made of. LIBRARY. The shipped catalog carries tasks and no costed components, so can_price is false on every seeded service until a company builds one up — which is a fact a screen should state before somebody prices, not after.';

revoke all on my_service_buildup from public, anon;
grant select on my_service_buildup to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Putting a resource in the library
-- -----------------------------------------------------------------------------

/**
 * Put a crew, a machine, a material or a truck on an assembly.
 *
 * The first writer of a costed `assembly_components` row anywhere. 0129 built
 * `add_assembly_step` for tasks and stopped there, so the column set that
 * `line_resource_suggestions` reads has never had a row in it.
 *
 * `quantity_per_unit` is per unit of the service — a crew of one for every hour
 * the production rate says the work takes, a ton of stone for every ton placed.
 * That is what makes the library a price rather than a list: the quantity
 * scales with the takeoff.
 */
create or replace function app.add_assembly_resource(
  p_assembly  uuid,
  p_kind      text,
  p_reference uuid default null,
  p_quantity_per_unit numeric default 1,
  p_unit      text default null,
  p_position  int default null,
  p_optional  boolean default false,
  p_notes     text default null)
returns assembly_components
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_asm  assemblies;
  v_sort int;
  v_row  assembly_components;
begin
  /* Refuses a catalog assembly by name, and says how to make your own. */
  v_asm := app.assert_own_assembly(p_assembly);

  if p_kind not in ('labor', 'equipment', 'material', 'trucking', 'subcontract') then
    raise exception 'A costed component is labor, equipment, material, trucking or subcontract'
      using errcode = 'check_violation',
            hint = 'A task step goes on with add_assembly_step, which is a different thing: it says what happens, not what it costs.';
  end if;
  if coalesce(p_quantity_per_unit, 1) < 0 then
    raise exception 'A quantity per unit cannot be negative' using errcode = 'check_violation';
  end if;

  /*
   * The reference must exist and must be readable by this company. Named here
   * rather than left to the foreign key, because a key names a constraint and
   * this names the thing that is wrong.
   */
  if p_kind = 'labor' then
    if p_reference is null or not exists (select 1 from labor_rates r where r.id = p_reference) then
      raise exception 'That labor rate does not exist' using errcode = 'no_data_found';
    end if;
  elsif p_kind = 'equipment' then
    if p_reference is null or not exists (select 1 from equipment e where e.id = p_reference) then
      raise exception 'That equipment does not exist' using errcode = 'no_data_found';
    end if;
  elsif p_kind = 'material' then
    if p_reference is null or not exists (select 1 from materials m where m.id = p_reference) then
      raise exception 'That material does not exist' using errcode = 'no_data_found';
    end if;
  end if;

  select coalesce(p_position, coalesce(max(sort_order), 0) + 10) into v_sort
    from assembly_components where assembly_id = p_assembly;

  insert into assembly_components (
    company_id, assembly_id, sort_order, component_kind,
    labor_rate_id, equipment_id, material_id,
    quantity_per_unit, unit, is_optional, notes)
  values (
    v_asm.company_id, p_assembly, v_sort, p_kind,
    case when p_kind = 'labor' then p_reference end,
    case when p_kind = 'equipment' then p_reference end,
    case when p_kind = 'material' then p_reference end,
    coalesce(p_quantity_per_unit, 1),
    nullif(btrim(coalesce(p_unit, '')), '')::app.unit_code,
    coalesce(p_optional, false),
    nullif(btrim(coalesce(p_notes, '')), ''))
  returning * into v_row;

  perform app.renumber_assembly_steps(p_assembly);
  return v_row;
end;
$$;

comment on function app.add_assembly_resource(uuid, text, uuid, numeric, text, int, boolean, text) is
  'Puts a crew, a machine, a material or a truck on a company assembly. The first writer of a costed assembly_components row anywhere in this repository — the column set app.line_resource_suggestions reads has never had one, which is why every shipped service prices at zero. LIBRARY.';

/**
 * Keep what this line is built from.
 *
 * The missing half. An estimator can build a line up by hand today and the
 * catalog learns nothing from it, so the same crew is rebuilt on every estimate
 * that touches the same work. This writes it back to the service's assembly, so
 * the next line that picks that service arrives with it.
 *
 * Three things it is careful about.
 *
 * **It copies a shipped assembly first.** 0129 refuses to let one company edit
 * what every company reads, and it is right to; `customize_assembly` makes the
 * company's own copy, steps and all, and the service is repointed at it.
 *
 * **It does not overwrite.** A kind already on the assembly is left alone —
 * somebody put it there on purpose, possibly at a rate they negotiated. What is
 * new is added. Nothing is silently replaced.
 *
 * **It stores quantity per unit, not quantity.** A line for 1,200 tons that
 * used 40 crew hours stores 0.0333 hours per ton, so the library scales with
 * the next takeoff instead of carrying one job's numbers forever.
 */
create or replace function app.save_line_buildup_to_library(p_line uuid)
returns int
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_line     estimate_line_items;
  v_company  uuid;
  v_service  services;
  v_assembly uuid;
  v_qty      numeric;
  v_added    int := 0;
  r          record;
begin
  select * into v_line from estimate_line_items where id = p_line;
  if v_line.id is null then
    raise exception 'No such line' using errcode = 'no_data_found';
  end if;

  select ev.company_id into v_company
    from estimate_versions ev where ev.id = v_line.estimate_version_id;
  if not app.has_permission(v_company, 'libraries.write') then
    raise exception 'Saving to the library needs the libraries.write permission'
      using errcode = 'insufficient_privilege';
  end if;

  if v_line.service_id is null then
    raise exception 'This line is not tied to a library service'
      using errcode = 'check_violation',
            hint = 'Pick a service on the line first, so there is somewhere to keep the build-up.';
  end if;
  select * into v_service from services where id = v_line.service_id;

  /*
   * The quantity everything is expressed per.
   *
   * `measured_quantity` is what a person entered or a takeoff produced;
   * `adjusted_quantity` is an engine output and guarded by 0058. Scaling by the
   * figure somebody actually measured is what makes the saved build-up
   * reproducible — it is the number on the line they were looking at.
   */
  v_qty := coalesce(nullif(v_line.measured_quantity, 0),
                    nullif(v_line.adjusted_quantity, 0));
  if v_qty is null then
    raise exception 'This line has no quantity, so there is nothing to express the build-up per'
      using errcode = 'check_violation',
            hint = 'A library holds a crew per unit, not a crew for one job.';
  end if;

  if not exists (select 1 from estimate_line_resources lr where lr.line_item_id = p_line) then
    raise exception 'Nothing is on this line to save'
      using errcode = 'no_data_found',
            hint = 'Put the crew, machines and materials on the line first.';
  end if;

  /*
   * The company's own assembly, made if need be. A service with no assembly at
   * all gets one, because there has to be somewhere to put this.
   */
  if v_service.default_assembly_id is null then
    insert into assemblies (company_id, code, name, service_id, assembly_type,
                            quantity_unit, description, origin, source,
                            approved_by, approved_at)
    values (v_company,
            'ASM-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8)),
            v_service.name || ' — company build-up',
            v_service.id, 'Standard', v_service.default_unit,
            'Built from an estimate line.', 'company',
            'Saved from an estimate', auth.uid(), now())
    returning id into v_assembly;
    update services set default_assembly_id = v_assembly, updated_at = now()
     where id = v_service.id and company_id = v_company;
  else
    select case when a.company_id is null
                then (app.customize_assembly_for(a.id, v_company)).id
                else a.id end
      into v_assembly
      from assemblies a where a.id = v_service.default_assembly_id;
  end if;

  /*
   * Every resource on the line, expressed per unit of the service. A kind and
   * reference already on the assembly is left exactly as it is.
   */
  for r in
    select lr.resource_kind,
           coalesce(lr.labor_rate_id, lr.equipment_id, lr.material_id,
                    lr.trucking_rate_id)                     as ref,
           /* Labor is carried in hours; everything else in its own quantity. */
           case when lr.resource_kind = 'labor' and lr.hours > 0
                then lr.hours else lr.quantity end           as amount,
           lr.unit
      from estimate_line_resources lr
     where lr.line_item_id = p_line
       and lr.resource_kind in ('labor', 'equipment', 'material', 'trucking', 'subcontract')
  loop
    if r.ref is null and r.resource_kind in ('labor', 'equipment', 'material') then
      continue;
    end if;
    if exists (
      select 1 from assembly_components ac
       where ac.assembly_id = v_assembly
         and ac.component_kind = r.resource_kind
         and coalesce(ac.labor_rate_id, ac.equipment_id, ac.material_id)
             is not distinct from r.ref) then
      continue;
    end if;

    perform app.add_assembly_resource(
      v_assembly, r.resource_kind, r.ref,
      round(coalesce(r.amount, 0) / v_qty, 6),
      r.unit::text, null, false,
      'Saved from estimate line');
    v_added := v_added + 1;
  end loop;

  return v_added;
end;
$$;

comment on function app.save_line_buildup_to_library(uuid) is
  'Keeps what a line is built from, on the service''s own assembly, per unit so it scales with the next takeoff. The missing half of the library: an estimator could build a line up and the catalog learned nothing, so the same crew was rebuilt on every estimate. LIBRARY.';

/**
 * `customize_assembly` returning the row, addressable by id.
 *
 * 0129's is `public.customize_assembly(assembly, company)` and returns the new
 * assembly. This is the same call under a name that says it is internal, so the
 * function above reads as what it does.
 */
create or replace function app.customize_assembly_for(p_assembly uuid, p_company uuid)
returns assemblies
language sql security definer set search_path = public, pg_catalog
as $$ select public.customize_assembly(p_assembly, p_company); $$;

comment on function app.customize_assembly_for(uuid, uuid) is
  'The company''s own copy of a shipped assembly. A thin name over customize_assembly (0129). LIBRARY.';

-- -----------------------------------------------------------------------------
-- The doors
-- -----------------------------------------------------------------------------

create or replace function public.add_assembly_resource(
  p_assembly uuid, p_kind text, p_reference uuid default null,
  p_quantity_per_unit numeric default 1, p_unit text default null,
  p_position int default null, p_optional boolean default false,
  p_notes text default null)
returns assembly_components language sql security invoker
set search_path = public, pg_catalog
as $$ select app.add_assembly_resource(p_assembly, p_kind, p_reference,
       p_quantity_per_unit, p_unit, p_position, p_optional, p_notes); $$;

create or replace function public.save_line_buildup_to_library(p_line uuid)
returns int language sql security invoker set search_path = public, pg_catalog
as $$ select app.save_line_buildup_to_library(p_line); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.add_assembly_resource(uuid, text, uuid, numeric, text, int, boolean, text)',
    'public.save_line_buildup_to_library(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
