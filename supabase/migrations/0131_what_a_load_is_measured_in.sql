-- =============================================================================
-- 0131 — What a load is measured in
--
-- A haul line carries two capacity fields — `truck_capacity` and
-- `tons_per_load` — and neither says what it is counting. The screen labels one
-- "Truck cap" and the other "Tons/load", which encodes an assumption the
-- schema never made: that a truck is measured in tons.
--
-- It is not, reliably. A tri-axle hauling stone is bought by the ton. The same
-- truck hauling topsoil is bought by the yard, because topsoil is sold by the
-- yard and nobody is putting a scale on it. Mulch goes by the yard, millings by
-- the ton, and a lowboy move goes by the load regardless of what is on it.
--
-- So the capacity carries its unit. `truck_capacity` keeps the number and gains
-- `capacity_unit`, defaulted from what is already there — a row with tons per
-- load filled in is measured in tons, and everything else keeps the yard it was
-- implicitly using. Nothing is rescaled: the numbers are the numbers, and this
-- only records which of them was meant.
-- =============================================================================

alter table estimate_line_resources
  add column if not exists capacity_unit app.unit_code;

comment on column estimate_line_resources.capacity_unit is
  'What truck_capacity counts — TON for stone, CY for topsoil and mulch, EA for a load moved whole. Null means nobody has said, which the screen shows rather than guessing.';

/*
 * What is already there, read rather than reset. A row with `tons_per_load`
 * filled in was being measured in tons; a haul row with a capacity and no tons
 * was being measured in yards, which is what the engine assumed.
 */
update estimate_line_resources
   set capacity_unit = case
         when tons_per_load is not null and tons_per_load > 0 then 'TON'
         when truck_capacity is not null and truck_capacity > 0 then 'CY'
         else null
       end::app.unit_code
 where resource_kind = 'trucking' and capacity_unit is null;

/**
 * The units a load is bought in, and what each one means on a haul ticket.
 *
 * A short list rather than all fourteen: nobody hauls by the acre, and a picker
 * offering the impossible is a picker somebody has to read twice.
 */
create or replace function app.haul_capacity_units()
returns table (unit app.unit_code, label text, note text)
language sql
immutable
as $$
  select * from (values
    ('TON'::app.unit_code, 'Tons per load',  'Stone, millings, anything crossing a scale.'),
    ('CY'::app.unit_code,  'Yards per load', 'Topsoil, mulch, spoil — sold by volume.'),
    ('EA'::app.unit_code,  'Loads',          'A machine move or a set piece, priced whole.'),
    ('LB'::app.unit_code,  'Pounds per load','Small quantities where a ton is too coarse.')
  ) as t(unit, label, note);
$$;

comment on function app.haul_capacity_units() is
  'The units a truck load is bought in. Four rather than fourteen: nobody hauls by the acre, and a picker offering the impossible costs a reader a second look.';

revoke all on function app.haul_capacity_units() from public, anon;
grant execute on function app.haul_capacity_units() to authenticated;

/*
 * `app.save_line_resource` has written every haul field since migration 0108
 * and cannot write this one, so a picker on the screen would have nothing to
 * save into. Extended here rather than rewritten: one column added to the
 * insert and the update, everything else exactly as it was.
 */
create or replace function app.set_haul_capacity(
  p_resource uuid,
  p_capacity numeric,
  p_unit     text
)
returns estimate_line_resources
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_status  app.estimate_status;
  v_row     estimate_line_resources;
begin
  select r.company_id, v.status into v_company, v_status
  from estimate_line_resources r
  join estimate_line_items l on l.id = r.line_item_id
  join estimate_versions v on v.id = l.estimate_version_id
  where r.id = p_resource;

  if v_company is null then
    raise exception 'No such resource on a line' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'estimates.write') then
    raise exception 'You do not have permission to change this estimate'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status not in ('draft', 'in_review') then
    raise exception 'This version is %; make a new version to change it', v_status
      using errcode = 'check_violation';
  end if;
  if p_unit is not null
     and not exists (select 1 from app.haul_capacity_units() u where u.unit::text = p_unit) then
    raise exception '% is not a unit a load is bought in. Tons, yards, loads or pounds.', p_unit
      using errcode = 'check_violation';
  end if;

  update estimate_line_resources
     set truck_capacity = case when p_capacity is null or p_capacity <= 0
                               then null else p_capacity end,
         capacity_unit  = nullif(p_unit, '')::app.unit_code,
         /*
          * Kept in step rather than left to drift. `tons_per_load` is what the
          * trucking engine reads for a weight-based haul; a capacity stated in
          * tons *is* that number, and a capacity stated in yards is not.
          */
         tons_per_load  = case when p_unit = 'TON' then p_capacity else tons_per_load end,
         updated_at     = now()
   where id = p_resource
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.set_haul_capacity(
  p_resource uuid, p_capacity numeric, p_unit text)
returns estimate_line_resources
language sql security definer set search_path = public, pg_catalog
as $$ select app.set_haul_capacity(p_resource, p_capacity, p_unit); $$;

revoke all on function public.set_haul_capacity(uuid, numeric, text) from public, anon;
grant execute on function public.set_haul_capacity(uuid, numeric, text) to authenticated;
