-- =============================================================================
-- 0227 — The tenant and the unit both matter
--
-- Two defects in 0226, both caught by the tests immediately and both mine.
--
--   * **`assemblies.quantity_unit` is `app.unit_code`**, and the function
--     passed text. Postgres will not coerce across the assignment.
--   * **`markup_components` carries its own `company_id`** and its insert policy
--     requires it: `company_id is not null and app.is_member(company_id) and
--     app.has_permission(company_id, 'libraries.write')`. The insert omitted the
--     column, the row arrived with a null tenant, and row level security
--     refused it — correctly. A markup with no company on it is a markup no
--     policy can reason about, which is exactly why the column is there.
--
-- The second is the more interesting failure: the function checked the caller's
-- permission on the *profile's* company and then wrote a row that did not say
-- which company it belonged to. The check passed and the write was still wrong,
-- which is the shape of mistake RLS exists to catch.
-- =============================================================================

create or replace function app.create_assembly(
  p_company  uuid,
  p_name     text,
  p_unit     text default 'EA',
  p_service  uuid default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'libraries.write');
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_code    text;
  v_id      uuid;
begin
  if v_name is null then
    raise exception 'A work sequence needs a name'
      using errcode = 'check_violation',
            hint = 'What the sequence builds: "Trench, bed and backfill", "Strip and stockpile".';
  end if;
  if p_service is not null and not exists (
    select 1 from services s where s.id = p_service) then
    raise exception 'No such service' using errcode = 'no_data_found';
  end if;

  v_code := 'ASM-' || upper(substring(regexp_replace(v_name, '[^A-Za-z0-9]', '', 'g') from 1 for 6))
         || '-' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6);

  insert into assemblies (
    company_id, code, name, quantity_unit, service_id, status, origin,
    approved_by, approved_at)
  values (
    v_company, v_code, v_name,
    coalesce(nullif(btrim(p_unit), ''), 'EA')::app.unit_code,
    p_service, 'active', 'company', auth.uid(), now())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function app.set_markup_component(
  p_profile  uuid,
  p_code     text,
  p_label    text,
  p_percent  numeric,
  p_basis    text default 'profile_default',
  p_sequence int default 10,
  p_disclosed boolean default true)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_code    text := upper(btrim(coalesce(p_code, '')));
  v_id      uuid;
begin
  select company_id into v_company from pricing_profiles where id = p_profile;
  if not found then
    raise exception 'No such pricing profile' using errcode = 'no_data_found';
  end if;
  if v_company is null then
    raise exception 'That profile is shipped with GrounUp and is shared by every company'
      using errcode = 'insufficient_privilege',
            hint = 'Make your own copy of it first, then change the copy.';
  end if;
  perform app.company_for_write(v_company, 'libraries.write');

  if v_code !~ '^[A-Z][A-Z0-9_]{0,20}$' then
    raise exception 'A markup code is capitals, digits and underscores'
      using errcode = 'check_violation', hint = 'OVERHEAD, PROFIT, BOND.';
  end if;
  if p_percent is null or p_percent < 0 or p_percent > 5 then
    raise exception 'A markup is a share between 0 and 5'
      using errcode = 'check_violation', hint = 'Ten percent is 0.10, not 10.';
  end if;
  if p_basis not in ('profile_default', 'direct_cost', 'direct_plus_indirect',
                     'running_total', 'marked_up_total') then
    raise exception 'That is not a basis this schema knows' using errcode = 'check_violation';
  end if;

  select id into v_id from markup_components
   where pricing_profile_id = p_profile and code = v_code;

  if v_id is null then
    insert into markup_components (
      /* The tenant the row belongs to. Its own insert policy requires it, and
         a markup with no company on it is one no policy can reason about. */
      company_id, pricing_profile_id, code, label, percent, basis, sequence, disclosed)
    values (
      v_company, p_profile, v_code, btrim(p_label), p_percent, p_basis,
      coalesce(p_sequence, 10), coalesce(p_disclosed, true))
    returning id into v_id;
  else
    update markup_components
       set label = btrim(p_label), percent = p_percent, basis = p_basis,
           sequence = coalesce(p_sequence, sequence),
           disclosed = coalesce(p_disclosed, disclosed), updated_at = now()
     where id = v_id;
  end if;
  return v_id;
end;
$$;
