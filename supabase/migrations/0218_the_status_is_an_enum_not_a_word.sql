-- =============================================================================
-- 0218 — The status is an enum, not a word
--
-- `app.set_library_status` from 0217 passes the new status into a dynamic
-- UPDATE as `text`, and every library's `status` column is
-- `app.record_status`. Postgres will not coerce a text parameter into an enum
-- across EXECUTE ... USING, so every archive raised:
--
--     column "status" is of type app.record_status but expression is of type text
--
-- Worth noting how this got through: the live check after 0217 exercised the
-- *refusals* — a shipped row, an unknown library — and they all behaved
-- correctly, because none of them reaches the UPDATE. The path that does the
-- work was the one path not covered, and it was broken. The tests found it
-- immediately afterwards.
--
-- The cast is the whole change.
-- =============================================================================

create or replace function app.set_library_status(
  p_kind text,
  p_row  uuid,
  p_status text default 'archived')
returns text
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_table   text;
  v_company uuid;
  v_name    text;
begin
  if p_status not in ('archived', 'active') then
    raise exception 'A library row is archived or active'
      using errcode = 'check_violation',
            hint = 'Retired, draft and inactive mean other things in this schema.';
  end if;

  v_table := case p_kind
    when 'service'            then 'services'
    when 'task'               then 'tasks'
    when 'assembly'           then 'assemblies'
    when 'material'           then 'materials'
    when 'labor_rate'         then 'labor_rates'
    when 'equipment'          then 'equipment'
    when 'crew'               then 'crews'
    when 'production_rate'    then 'production_rates'
    when 'trucking_rate'      then 'trucking_rates'
    when 'vendor'             then 'vendors'
    when 'condition_modifier' then 'condition_modifiers'
    when 'pricing_profile'    then 'pricing_profiles'
    when 'disposal_site'      then 'disposal_sites'
    when 'wage_schedule'      then 'wage_schedules'
  end;
  if v_table is null then
    raise exception 'There is no library called %', p_kind using errcode = 'check_violation';
  end if;

  execute format(
    'select company_id, coalesce(name, code, %L) from %I where id = $1',
    'that row', v_table)
    into v_company, v_name using p_row;

  if v_name is null and v_company is null then
    raise exception 'No such row' using errcode = 'no_data_found';
  end if;

  if v_company is null then
    raise exception '% is shipped with GrounUp and is shared by every company', v_name
      using errcode = 'insufficient_privilege',
            hint = 'Make your own copy of it first, then archive the copy. The shipped one is left alone for everybody else.';
  end if;

  perform app.company_for_write(v_company, 'libraries.write');

  execute format('update %I set status = $1, updated_at = now() where id = $2', v_table)
    using p_status::app.record_status, p_row;

  return p_status;
end;
$$;
