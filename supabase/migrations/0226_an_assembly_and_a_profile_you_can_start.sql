-- =============================================================================
-- 0226 — An assembly and a profile you can start
--
-- The last two library tabs with no way to create anything. Both could only be
-- *copied*: `customize_assembly` clones a shipped build-up, `adopt_profile_markups`
-- takes somebody else's markups. A company doing work the catalog has never
-- heard of, or marking up the way they have marked up for twenty years, had to
-- start from the nearest shipped thing and edit it into shape.
--
-- Two judgments:
--
--   * **An assembly starts empty, and that is a state the screen already
--     knows.** An assembly is an ordered list of steps; inventing a first step
--     would be guessing at work nobody described. `add_assembly_step` and
--     `add_assembly_resource` are what fill it, and they already exist.
--   * **A pricing profile starts with no markup at all.** Not with a helpful
--     ten percent. A markup somebody did not choose is a price somebody did not
--     choose, and it would be applied to every line the profile touches. The
--     screen says the profile prices at cost until markups are added, which is
--     true and visible, rather than quietly adding margin.
--
-- LIBRARY.
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
    v_company, v_code, v_name, coalesce(nullif(btrim(p_unit), ''), 'EA'),
    p_service, 'active', 'company', auth.uid(), now())
  returning id into v_id;

  /* No steps. An assembly is the order work happens in, and nobody has said
     what the work is yet — `add_assembly_step` is the next thing they do. */
  return v_id;
end;
$$;

create or replace function app.create_pricing_profile(
  p_company   uuid,
  p_name      text,
  p_method    text default 'parallel',
  p_region    text default null,
  p_is_default boolean default false)
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
    raise exception 'A pricing profile needs a name'
      using errcode = 'check_violation',
            hint = 'What it is for: "Public work", "Negotiated private", "Emergency call-out".';
  end if;
  if p_method not in ('parallel', 'stacked') then
    raise exception 'A profile applies its markups in parallel or stacked'
      using errcode = 'check_violation',
            hint = 'Parallel takes each markup off the same base; stacked takes each off the running total.';
  end if;

  v_code := 'PP-' || upper(substring(regexp_replace(v_name, '[^A-Za-z0-9]', '', 'g') from 1 for 6))
         || '-' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6);

  /*
   * One default per company. Setting a new one steps the old one down rather
   * than leaving two rows both claiming to be the default, which is the kind of
   * thing that is only noticed when two estimates disagree.
   */
  if p_is_default then
    update pricing_profiles set is_default = false, updated_at = now()
     where company_id = v_company and is_default;
  end if;

  insert into pricing_profiles (
    company_id, code, name, method, region, is_default, status, origin,
    approved_by, approved_at)
  values (
    v_company, v_code, v_name, p_method::app.markup_method,
    nullif(btrim(coalesce(p_region, '')), ''), coalesce(p_is_default, false),
    'active', 'company', auth.uid(), now())
  returning id into v_id;

  /* No markups. A profile that arrived with a helpful ten percent would put
     margin nobody chose on every line it touches. It prices at cost until
     somebody says otherwise, and the screen says so. */
  return v_id;
end;
$$;

/**
 * Put a markup on a profile.
 *
 * `percent` is a share, checked between 0 and 5 by the table since 0004 — a
 * markup of 5 is five hundred percent, which is a real thing on a small change
 * order and nonsense as a typo for 5%.
 */
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
      pricing_profile_id, code, label, percent, basis, sequence, disclosed)
    values (
      p_profile, v_code, btrim(p_label), p_percent, p_basis,
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

create or replace function public.create_assembly(
  p_company uuid, p_name text, p_unit text default 'EA', p_service uuid default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_assembly(p_company, p_name, p_unit, p_service); $$;

create or replace function public.create_pricing_profile(
  p_company uuid, p_name text, p_method text default 'parallel',
  p_region text default null, p_is_default boolean default false)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_pricing_profile(p_company, p_name, p_method, p_region, p_is_default); $$;

create or replace function public.set_markup_component(
  p_profile uuid, p_code text, p_label text, p_percent numeric,
  p_basis text default 'profile_default', p_sequence int default 10,
  p_disclosed boolean default true)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_markup_component(p_profile, p_code, p_label, p_percent, p_basis,
       p_sequence, p_disclosed); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.create_assembly(uuid, text, text, uuid)',
    'public.create_pricing_profile(uuid, text, text, text, boolean)',
    'public.set_markup_component(uuid, text, text, numeric, text, int, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
