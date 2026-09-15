/**
 * The thing being measured, as opposed to the shape that measures it.
 *
 * A site plan is not forty estimate lines. It is eight or ten *things* —
 * six-inch sidewalk, curb and gutter, light-duty pavement, topsoil strip — each
 * traced in several places. Until now a traced shape was applied straight to an
 * estimate line, which made the estimator repeat that association once per
 * shape and gave them forty lines to merge afterwards.
 *
 * Every takeoff product estimators actually use — On-Screen Takeoff, PlanSwift,
 * STACK, eTakeoff, Procore — has an object in between, and all of them make you
 * pick it *before* you trace. On-Screen Takeoff calls it a Condition, and its
 * governing rule is the one that matters: **each unique object on a plan is one
 * condition.** You make one "6-inch concrete sidewalk" and trace it in twelve
 * places; the twelve roll into one quantity.
 *
 * It has to come first for two concrete reasons, not as a matter of taste:
 *
 *   * it owns the **color**, and forty overlapping shapes are unreadable unless
 *     each already knows what color it is — coloring by *kind*, as this
 *     platform did, makes every area on the sheet the same violet
 *   * it owns the **depth**, and no traced polygon becomes cubic yards without
 *     one; asking afterwards means asking once per shape
 *
 * This sits *on top of* migration 0177 rather than replacing it. The line is
 * still the sum of the measurements applied to it. A condition is the
 * pre-selection that makes tracing fast and legible, and the thing that knows
 * which line the shapes it collects belong on.
 *
 * `estimate_version_id` is nullable on purpose. Not null is a condition for
 * this estimate, which is what is built now. Null is a condition in the
 * library, reusable on every future job — the same shape, no migration needed,
 * built next.
 *
 * LIBRARY.
 */

create table if not exists takeoff_conditions (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  /* Null means it lives in the library, for every job rather than this one. */
  estimate_version_id uuid references estimate_versions(id) on delete cascade,
  /* The line these shapes add up onto. Null while it is a library definition. */
  line_item_id        uuid references estimate_line_items(id) on delete set null,

  name                text not null check (length(trim(name)) between 1 and 200),
  /*
   * What kind of thing it is, which fixes what a shape traced for it means and
   * what units can come out. The same five the measurements use.
   */
  style               text not null
                        check (style in ('count', 'linear', 'area', 'volume', 'basin')),
  unit                app.unit_code not null,
  /*
   * What it looks like on the drawing. Not decoration: it is the only thing
   * that keeps forty overlapping traces legible, which is why the condition
   * owns it and the shape does not.
   */
  color               text not null default '#7C3AED'
                        check (color ~ '^#[0-9A-Fa-f]{6}$'),

  /* The dimensions the drawing does not supply. */
  depth_feet          numeric(12,4) check (depth_feet is null or depth_feet > 0),
  width_feet          numeric(12,4) check (width_feet is null or width_feet > 0),
  pitch_rise          numeric(8,4)  check (pitch_rise is null or pitch_rise >= 0),
  count_per           numeric(12,4) not null default 1 check (count_per > 0),
  multiplier          numeric(12,4) not null default 1 check (multiplier > 0),

  /* What prices it, when it becomes a line. */
  service_id          uuid references services(id) on delete set null,
  cost_code_id        uuid references cost_codes(id) on delete set null,
  trade               text,
  notes               text,

  sort_order          int not null default 0,
  status              app.record_status not null default 'active',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id) on delete set null,

  /*
   * A basin has sloping sides and its own arithmetic; a count has no scale.
   * Neither takes a depth typed in here.
   */
  constraint takeoff_conditions_depth_suits_style
    check (depth_feet is null or style in ('volume', 'linear', 'area')),
  /* One name for one thing, per estimate — the rule from CLAUDE.md. */
  constraint takeoff_conditions_named_once
    unique (company_id, estimate_version_id, name)
);

create index if not exists takeoff_conditions_version_idx
  on takeoff_conditions(estimate_version_id, sort_order)
  where estimate_version_id is not null;
create index if not exists takeoff_conditions_library_idx
  on takeoff_conditions(company_id, name)
  where estimate_version_id is null;
create index if not exists takeoff_conditions_line_idx
  on takeoff_conditions(line_item_id) where line_item_id is not null;

comment on table takeoff_conditions is
  'A thing being measured — six-inch sidewalk, curb and gutter — traced in many places and priced once. Owns the color that keeps a busy sheet readable and the depth a drawing does not supply. Null estimate_version_id means it lives in the library. LIBRARY.';

/* The shape knows what it is a shape *of*. */
alter table takeoff_measurements
  add column if not exists condition_id uuid
    references takeoff_conditions(id) on delete set null;

create index if not exists takeoff_measurements_condition_idx
  on takeoff_measurements(condition_id) where condition_id is not null;

comment on column takeoff_measurements.condition_id is
  'The thing this shape measures. Many shapes to one condition: a sidewalk traced in twelve runs is twelve measurements and one condition.';

-- -----------------------------------------------------------------------------
-- Making one
-- -----------------------------------------------------------------------------

/**
 * Create a condition on an estimate, and the line it will price on.
 *
 * The line is made here rather than left to the estimator, because a condition
 * with nowhere to add up is the doorless-feature defect in miniature: you would
 * trace twelve shapes and then find there was nothing to apply them to. It
 * starts at zero quantity and fills as shapes are traced — migration 0177's
 * trigger does the summing.
 *
 * A service may be named, in which case the line is built from it the way any
 * other line from the library is, and the condition inherits its unit.
 */
create or replace function app.create_takeoff_condition(
  p_version      uuid,
  p_name         text,
  p_style        text,
  p_unit         app.unit_code,
  p_color        text default null,
  p_depth_feet   numeric default null,
  p_width_feet   numeric default null,
  p_service      uuid default null,
  p_cost_code    uuid default null,
  p_count_per    numeric default 1,
  p_multiplier   numeric default 1)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_status  app.estimate_status;
  v_line    uuid;
  v_id      uuid;
  v_sort    int;
  v_color   text;
begin
  select v.company_id, v.status into v_company, v_status
    from estimate_versions v where v.id = p_version;
  if v_company is null then
    raise exception 'No such estimate version' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'estimates.write') then
    raise exception 'You do not have permission to change this estimate'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status not in ('draft', 'in_review') then
    raise exception 'This version is %; make a new version to change it', v_status
      using errcode = 'check_violation';
  end if;
  if p_style not in ('count', 'linear', 'area', 'volume', 'basin') then
    raise exception 'A condition is a count, a length, an area, a volume or a pond, not %',
      p_style using errcode = 'check_violation';
  end if;
  if coalesce(btrim(coalesce(p_name, '')), '') = '' then
    raise exception 'A condition needs a name — it is what you will pick it by'
      using errcode = 'check_violation';
  end if;

  /*
   * A color it can be told apart by. Given one, it is used; otherwise the next
   * one round a fixed wheel, so ten conditions made in a row are ten different
   * colors without anybody choosing them.
   */
  select count(*) into v_sort from takeoff_conditions
   where estimate_version_id = p_version;
  v_color := coalesce(
    nullif(btrim(coalesce(p_color, '')), ''),
    (array['#7C3AED','#059669','#0284C7','#D97706','#DB2777',
           '#0891B2','#65A30D','#DC2626','#4F46E5','#C026D3'])[(v_sort % 10) + 1]);

  v_line := app.add_estimate_line(p_version, p_service, btrim(p_name), 0, p_unit);
  if p_cost_code is not null then
    update estimate_line_items set cost_code_id = p_cost_code where id = v_line;
  end if;

  insert into takeoff_conditions (
    company_id, estimate_version_id, line_item_id, name, style, unit, color,
    depth_feet, width_feet, service_id, cost_code_id, count_per, multiplier,
    sort_order, created_by)
  values (
    v_company, p_version, v_line, btrim(p_name), p_style, p_unit, v_color,
    p_depth_feet, p_width_feet, p_service, p_cost_code,
    coalesce(p_count_per, 1), coalesce(p_multiplier, 1), v_sort, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.create_takeoff_condition(uuid, text, text, app.unit_code, text, numeric, numeric, uuid, uuid, numeric, numeric) is
  'Creates a thing to measure and the line it prices on. The line starts empty and fills as shapes are traced. WORKFLOW.';

/** Change one. Null leaves a field alone. */
create or replace function app.update_takeoff_condition(
  p_condition  uuid,
  p_name       text default null,
  p_color      text default null,
  p_depth_feet numeric default null,
  p_width_feet numeric default null,
  p_count_per  numeric default null,
  p_multiplier numeric default null,
  p_trade      text default null,
  p_notes      text default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_c takeoff_conditions%rowtype;
begin
  select * into v_c from takeoff_conditions where id = p_condition;
  if v_c.id is null then
    raise exception 'No such condition' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_c.company_id, 'estimates.write') then
    raise exception 'You do not have permission to change this condition'
      using errcode = 'insufficient_privilege';
  end if;

  update takeoff_conditions
     set name        = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
         color       = coalesce(nullif(btrim(coalesce(p_color, '')), ''), color),
         depth_feet  = coalesce(p_depth_feet, depth_feet),
         width_feet  = coalesce(p_width_feet, width_feet),
         count_per   = coalesce(p_count_per, count_per),
         multiplier  = coalesce(p_multiplier, multiplier),
         trade       = coalesce(p_trade, trade),
         notes       = coalesce(p_notes, notes),
         updated_at  = now()
   where id = p_condition;

  /* The line is called what the condition is called. */
  if nullif(btrim(coalesce(p_name, '')), '') is not null and v_c.line_item_id is not null then
    update estimate_line_items
       set description = btrim(p_name), updated_at = now()
     where id = v_c.line_item_id
       and exists (select 1 from estimate_versions v
                    where v.id = estimate_line_items.estimate_version_id
                      and v.status in ('draft', 'in_review'));
  end if;
end;
$$;

comment on function app.update_takeoff_condition(uuid, text, text, numeric, numeric, numeric, numeric, text, text) is
  'Changes a condition, and renames the line with it. WORKFLOW.';

/**
 * Trace a shape for a condition.
 *
 * The shape takes the condition's color, depth and unit, and is applied to the
 * condition's line in the same call — which is the whole point: pick the thing
 * once, then trace it wherever it appears without answering the same questions
 * again.
 */
create or replace function app.record_condition_takeoff(
  p_condition    uuid,
  p_measurement  uuid,
  p_quantity     numeric,
  p_engine_version text)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_c takeoff_conditions%rowtype;
begin
  select * into v_c from takeoff_conditions where id = p_condition;
  if v_c.id is null then
    raise exception 'No such condition' using errcode = 'no_data_found';
  end if;
  if v_c.line_item_id is null then
    raise exception 'That condition is a library definition and has no line to add up on'
      using errcode = 'check_violation',
            hint = 'Bring it into an estimate first.';
  end if;

  update takeoff_measurements
     set condition_id = p_condition, updated_at = now()
   where id = p_measurement;

  perform app.apply_takeoff_to_line(
    p_measurement, v_c.line_item_id, p_quantity, p_engine_version);
end;
$$;

comment on function app.record_condition_takeoff(uuid, uuid, numeric, text) is
  'Files a traced shape under the thing it measures, and onto that thing''s line. WORKFLOW.';

/** Move a shape to a different condition — the correction path, not the flow. */
create or replace function app.reassign_measurement(
  p_measurement uuid, p_condition uuid, p_quantity numeric, p_engine_version text)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
begin
  /*
   * Off the old line first, so both ends are recomputed: 0177's trigger
   * corrects the line it left as well as the one it joins.
   */
  perform app.unapply_takeoff(p_measurement);
  perform app.record_condition_takeoff(p_condition, p_measurement, p_quantity, p_engine_version);
end;
$$;

comment on function app.reassign_measurement(uuid, uuid, numeric, text) is
  'Moves a traced shape to a different condition. Estimators do trace the wrong thing; this is the correction, not the normal path. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- Doors
-- -----------------------------------------------------------------------------

/**
 * What is being measured on this estimate, and how much of it there is so far.
 *
 * `traced` is the count of shapes, which is the number an estimator scans for:
 * a condition with no shapes is something they meant to measure and have not,
 * and it is the only way to see that before the bid goes out.
 */
create or replace view my_takeoff_conditions as
select c.id,
       c.company_id,
       c.estimate_version_id,
       c.line_item_id,
       c.name,
       c.style,
       c.unit,
       c.color,
       c.depth_feet,
       c.width_feet,
       c.count_per,
       c.multiplier,
       c.service_id,
       c.cost_code_id,
       c.trade,
       c.notes,
       c.sort_order,
       (c.estimate_version_id is null) as in_library,
       (select count(*) from takeoff_measurements m where m.condition_id = c.id)
         as traced,
       (select coalesce(sum(m.applied_quantity), 0) from takeoff_measurements m
         where m.condition_id = c.id and m.applied_line_item_id is not null)
         as quantity,
       (select count(distinct m.document_sheet_id) from takeoff_measurements m
         where m.condition_id = c.id) as sheets,
       l.total_price
  from takeoff_conditions c
  left join estimate_line_items l on l.id = c.line_item_id
 where c.status <> 'archived';

revoke all on my_takeoff_conditions from public, anon;
grant select on my_takeoff_conditions to authenticated;
alter view my_takeoff_conditions set (security_invoker = on);

comment on view my_takeoff_conditions is
  'The things being measured on an estimate, with how many shapes have been traced for each and what they add up to. A condition with nothing traced is something somebody meant to measure.';

create or replace function public.create_takeoff_condition(
  p_version uuid, p_name text, p_style text, p_unit app.unit_code,
  p_color text default null, p_depth_feet numeric default null,
  p_width_feet numeric default null, p_service uuid default null,
  p_cost_code uuid default null, p_count_per numeric default 1,
  p_multiplier numeric default 1)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_takeoff_condition(p_version, p_name, p_style, p_unit, p_color,
       p_depth_feet, p_width_feet, p_service, p_cost_code, p_count_per, p_multiplier); $$;

create or replace function public.update_takeoff_condition(
  p_condition uuid, p_name text default null, p_color text default null,
  p_depth_feet numeric default null, p_width_feet numeric default null,
  p_count_per numeric default null, p_multiplier numeric default null,
  p_trade text default null, p_notes text default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.update_takeoff_condition(p_condition, p_name, p_color, p_depth_feet,
       p_width_feet, p_count_per, p_multiplier, p_trade, p_notes); $$;

create or replace function public.record_condition_takeoff(
  p_condition uuid, p_measurement uuid, p_quantity numeric, p_engine_version text)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.record_condition_takeoff(p_condition, p_measurement, p_quantity,
       p_engine_version); $$;

create or replace function public.reassign_measurement(
  p_measurement uuid, p_condition uuid, p_quantity numeric, p_engine_version text)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.reassign_measurement(p_measurement, p_condition, p_quantity,
       p_engine_version); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.create_takeoff_condition(uuid, text, text, app.unit_code, text, numeric, numeric, uuid, uuid, numeric, numeric)',
    'public.update_takeoff_condition(uuid, text, text, numeric, numeric, numeric, numeric, text, text)',
    'public.record_condition_takeoff(uuid, uuid, numeric, text)',
    'public.reassign_measurement(uuid, uuid, numeric, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

select app.apply_tenant_rls('takeoff_conditions', null, 'estimates.write');
select app.attach_standard_triggers('public.takeoff_conditions');
select app.guard_suspension('takeoff_conditions');
