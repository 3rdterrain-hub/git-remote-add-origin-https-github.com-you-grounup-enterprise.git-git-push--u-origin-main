-- =============================================================================
-- 0222 — A waste figure says what it is a share of
--
-- `app.set_material` from 0221 takes a waste percentage and not the basis it is
-- measured against, and `materials_waste_basis` has required the pair since
-- migration 0004: `default_waste_percent = 0 or waste_basis is not null`.
--
-- So setting 8% waste on a material that had none failed with the constraint's
-- own words — a violation message naming an index, in front of somebody who
-- typed a number into a box. The rule is right and the door was not carrying
-- it: eight percent *of what* is the whole question, and a share with no
-- denominator is the same kind of figure this schema refuses everywhere else.
--
-- `set_material` now takes the basis, and refuses a non-zero waste that has
-- none — on the call or already on the row — saying which.
-- =============================================================================

create or replace function app.set_material(
  p_material      uuid,
  p_name          text default null,
  p_category      text default null,
  p_specification text default null,
  p_waste_percent numeric default null,
  p_waste_basis   text default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_row   materials%rowtype;
  v_basis text;
begin
  select * into v_row from materials where id = p_material;
  if v_row.id is null then
    raise exception 'No such material' using errcode = 'no_data_found';
  end if;
  if v_row.company_id is null then
    raise exception 'That material is shipped with GrounUp and is shared by every company'
      using errcode = 'insufficient_privilege',
            hint = 'Make your own copy of it first, then change the copy.';
  end if;
  perform app.company_for_write(v_row.company_id, 'libraries.write');

  if p_waste_percent is not null and (p_waste_percent < 0 or p_waste_percent > 1) then
    raise exception 'Waste is a share, between 0 and 1'
      using errcode = 'check_violation', hint = 'Ten percent is 0.10, not 10.';
  end if;

  v_basis := coalesce(nullif(btrim(coalesce(p_waste_basis, '')), ''), v_row.waste_basis);
  if coalesce(p_waste_percent, v_row.default_waste_percent) > 0 and v_basis is null then
    raise exception 'Say what the waste is a share of'
      using errcode = 'check_violation',
            hint = 'Waste measured against the installed quantity and waste against the ordered quantity are different numbers.';
  end if;

  update materials
     set name                  = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
         category              = coalesce(nullif(btrim(coalesce(p_category, '')), ''), category),
         specification         = coalesce(nullif(btrim(coalesce(p_specification, '')), ''), specification),
         default_waste_percent = coalesce(p_waste_percent, default_waste_percent),
         waste_basis           = v_basis,
         updated_at            = now()
   where id = p_material;
end;
$$;

create or replace function public.set_material(
  p_material uuid, p_name text default null, p_category text default null,
  p_specification text default null, p_waste_percent numeric default null,
  p_waste_basis text default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_material(p_material, p_name, p_category, p_specification,
       p_waste_percent, p_waste_basis); $$;

revoke all on function public.set_material(uuid, text, text, text, numeric, text)
  from public, anon;
grant execute on function public.set_material(uuid, text, text, text, numeric, text)
  to authenticated, service_role;
