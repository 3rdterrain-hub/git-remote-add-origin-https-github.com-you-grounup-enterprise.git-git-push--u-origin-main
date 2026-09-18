-- =============================================================================
-- 0228 — A condition you can describe yourself
--
-- The last library tab with no way to create anything. Twenty shipped
-- modifiers — rock, groundwater, night work, restricted access — and no way to
-- add the one your own ground gives you.
--
-- A condition is the sharpest tool on an estimate. "Difficult material" applied
-- to a line raises that line's equipment cost by 2.077×: 1.35 on the hourly
-- rate and 0.65 on production, so the machine is on the job half again as long
-- *and* dearer. A contractor who knows their clay behaves a particular way
-- should be able to write that down, and until now could not.
--
-- Two refusals, both about the factors:
--
--   * **A target the engine does not honor is refused, not stored.** Nine
--     exist: production, labor_cost, equipment_cost, material_cost,
--     trucking_cost, disposal_cost, indirect_cost, schedule, risk. A tenth
--     would sit in the jsonb looking exactly like the others and change
--     nothing — the rule 0136 and 0139 settled for jsonb field names, and this
--     is the same shape of mistake with a price attached.
--   * **A factor of zero is refused.** On `production` it is work that never
--     finishes; on a cost bucket it is a bucket that costs nothing. Neither is
--     a condition anybody means.
--
-- And one thing the form must carry rather than the schema: `production` is a
-- *rate* multiplier where the cost targets are *cost* multipliers. 0.8 on
-- production means slower; 0.8 on labor_cost means cheaper. The same number
-- means opposite things depending on where it lands, which is exactly the
-- ambiguity this table's explicit map was built to remove.
--
-- LIBRARY.
-- =============================================================================

create or replace function app.create_condition_modifier(
  p_company  uuid,
  p_name     text,
  p_factors  jsonb,
  p_category text default null,
  p_rule     text default 'multiply')
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'libraries.write');
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_known   constant text[] := array[
    'production', 'labor_cost', 'equipment_cost', 'material_cost',
    'trucking_cost', 'disposal_cost', 'indirect_cost', 'schedule', 'risk'];
  v_unknown text[];
  v_bad     text[];
  v_code    text;
  v_id      uuid;
begin
  if v_name is null then
    raise exception 'A condition needs a name'
      using errcode = 'check_violation',
            hint = 'What the ground or the job is doing: "Rock at subgrade", "Working around traffic".';
  end if;
  if p_factors is null or jsonb_typeof(p_factors) <> 'object'
     or p_factors = '{}'::jsonb then
    raise exception 'A condition with no factors changes nothing'
      using errcode = 'check_violation',
            hint = 'Say what it does: slower production, dearer equipment, both.';
  end if;

  select array_agg(k) into v_unknown
    from jsonb_object_keys(p_factors) k where k <> all (v_known);
  if v_unknown is not null then
    raise exception 'The engine does not price %', array_to_string(v_unknown, ', ')
      using errcode = 'check_violation',
            hint = 'It honors ' || array_to_string(v_known, ', ') || '. Anything else would sit in the record looking like a factor and change no price.';
  end if;

  select array_agg(k) into v_bad
    from jsonb_each_text(p_factors) e(k, v)
   where v !~ '^[0-9]*\.?[0-9]+$' or v::numeric <= 0 or v::numeric > 10;
  if v_bad is not null then
    raise exception 'Every factor is a multiplier above zero: %',
      array_to_string(v_bad, ', ')
      using errcode = 'check_violation',
            hint = 'Twenty percent slower is 0.80. Twenty percent dearer is 1.20. Zero is work that never finishes.';
  end if;

  v_code := 'CM-' || upper(substring(regexp_replace(v_name, '[^A-Za-z0-9]', '', 'g') from 1 for 6))
         || '-' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6);

  insert into condition_modifiers (
    company_id, code, name, category, factors, application_rule,
    status, approved_by, approved_at)
  values (
    v_company, v_code, v_name, nullif(btrim(coalesce(p_category, '')), ''),
    p_factors, coalesce(nullif(btrim(p_rule), ''), 'multiply'),
    'active', auth.uid(), now())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.create_condition_modifier(
  p_company uuid, p_name text, p_factors jsonb,
  p_category text default null, p_rule text default 'multiply')
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_condition_modifier(p_company, p_name, p_factors, p_category, p_rule); $$;

revoke all on function public.create_condition_modifier(uuid, text, jsonb, text, text)
  from public, anon;
grant execute on function public.create_condition_modifier(uuid, text, jsonb, text, text)
  to authenticated, service_role;
