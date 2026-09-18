-- =============================================================================
-- 0217 — Nothing in a library is destroyed
--
-- The owner: "I accidentally deleted excavation crew A." It was not deleted —
-- `retireCrew` sets `status = 'archived'`, so the row and both its crew members
-- were still there and were restored with one UPDATE.
--
-- That is the schema behaving well and the product behaving badly. From where
-- the owner sat: a button was pressed, a crew vanished, and there was no way
-- back and nothing saying the row still existed. A delete you cannot undo and a
-- delete you *believe* you cannot undo cost the same in the moment.
--
-- Their answer, and it is the right one: "be an archive is cool, it's better
-- than deleted. But it has to be on all relevant categories. And subcategories."
--
-- Today it is not. `retireRow` covers `services` and `tasks` and writes
-- `retired`; `retireCrew` covers `crews` and writes `archived`; ten other
-- library tables have no such door at all, and the UI offers the action on two
-- tabs out of twelve. Two words for one idea, and ten places it is missing.
--
-- So one door, `app.set_library_status`, over every library table that carries
-- a status, with the rules the screens cannot be trusted to keep:
--
--   * **A shipped row is never archived.** It belongs to every company on the
--     platform; hiding it for one would hide it for all. The refusal says so,
--     and says what to do instead — adopt it, then archive your copy.
--   * **Archived and active are the only two directions offered.** `retired`,
--     `draft` and `inactive` mean specific things elsewhere in this schema and
--     are not a delete button's business.
--   * **Restoring is the same door.** A round trip that needs two different
--     functions is a round trip somebody builds half of.
--
-- ENTITY.
-- =============================================================================

/**
 * Put a library row away, or bring it back.
 *
 * The table is chosen from a fixed list rather than interpolated from the
 * caller's string: a `format('%I')` on user input here would be an injection
 * against every table in the schema, and a typo would be a silent no-op.
 */
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
  v_shipped boolean;
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
    /* Either it does not exist or row level security hides it. The same answer
       for both, as everywhere else in this schema. */
    raise exception 'No such row' using errcode = 'no_data_found';
  end if;

  if v_company is null then
    raise exception '% is shipped with GrounUp and is shared by every company', v_name
      using errcode = 'insufficient_privilege',
            hint = 'Make your own copy of it first, then archive the copy. The shipped one is left alone for everybody else.';
  end if;

  perform app.company_for_write(v_company, 'libraries.write');

  execute format('update %I set status = $1, updated_at = now() where id = $2', v_table)
    using p_status, p_row;

  return p_status;
end;
$$;

comment on function app.set_library_status(text, uuid, text) is
  'Archives a library row or brings it back. One door for fourteen tables, because two words for one idea is how ten of them ended up with neither. Refuses a shipped row: it is shared by every company, so hiding it for one would hide it for all. ENTITY.';

create or replace function public.set_library_status(
  p_kind text, p_row uuid, p_status text default 'archived')
returns text language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_library_status(p_kind, p_row, p_status); $$;

revoke all on function public.set_library_status(text, uuid, text) from public, anon;
grant execute on function public.set_library_status(text, uuid, text)
  to authenticated, service_role;
