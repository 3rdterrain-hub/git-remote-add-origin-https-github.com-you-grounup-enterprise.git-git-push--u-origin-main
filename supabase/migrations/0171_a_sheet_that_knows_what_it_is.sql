-- =============================================================================
-- 0171 — A sheet that knows what it is
--
-- `document_sheets` has carried `sheet_number`, `sheet_title`, `discipline`,
-- `drawing_scale`, `revision` and `revision_date` since migration 0005, and
-- there is an index on `(company_id, sheet_number)` for looking a sheet up by
-- the number printed on it. **Nothing has ever written one of them.**
--
-- Found by taking a real set off. A fourteen sheet civil package lists in the
-- takeoff picker as "p.1 — autozone-5436.pdf" through "p.14", so an estimator
-- has to remember that page five is the site plan. One omission, four
-- consequences: the picker cannot name a sheet, the scale is re-derived by hand
-- on every visit although every sheet prints "1 inch = 20 feet", revision
-- comparison has nothing to compare, and searching the drawings has nothing to
-- search.
--
-- The AI pass would read all of it off the title block, and on a scanned set it
-- is the only thing that can. It also needs a key that is not on this
-- deployment. So the person using the drawing can name it, today, and the model
-- fills in what nobody has typed when it is configured — `app.identify_sheet`
-- takes an `p_source` for exactly that, and a value somebody typed is never
-- overwritten by one a model guessed.
-- =============================================================================

/**
 * Name a sheet the way its title block does.
 *
 * Every field is optional and null leaves what is there alone, so correcting
 * one thing does not blank the rest. A sheet number is trimmed and upper-cased
 * because "c1.0" and "C1.0" are the same sheet, and the index that finds one by
 * number should find it either way.
 */
create or replace function app.identify_sheet(
  p_sheet         uuid,
  p_sheet_number  text default null,
  p_sheet_title   text default null,
  p_discipline    text default null,
  p_drawing_scale text default null,
  p_revision      text default null,
  p_revision_date date default null,
  p_source        text default 'human')
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_s       document_sheets%rowtype;
begin
  select * into v_s from document_sheets where id = p_sheet;
  if not found then
    raise exception 'No such sheet' using errcode = 'no_data_found';
  end if;
  v_company := v_s.company_id;
  if not app.has_permission(v_company, 'documents.write') then
    raise exception 'You do not have permission to change this document'
      using errcode = 'insufficient_privilege';
  end if;
  if p_source not in ('human', 'ai_agent') then
    raise exception 'A sheet is identified by a person or by an agent, not by %', p_source
      using errcode = 'check_violation';
  end if;

  /*
   * A model may fill a blank and may not overwrite a person. RULE-008 in the
   * small: the agent proposes where nobody has spoken, and never corrects
   * somebody who has.
   */
  update document_sheets s
     set sheet_number = case
           when p_sheet_number is null then s.sheet_number
           when p_source = 'ai_agent' and s.sheet_number is not null then s.sheet_number
           else nullif(upper(trim(p_sheet_number)), '') end,
         sheet_title = case
           when p_sheet_title is null then s.sheet_title
           when p_source = 'ai_agent' and s.sheet_title is not null then s.sheet_title
           else nullif(trim(p_sheet_title), '') end,
         discipline = case
           when p_discipline is null then s.discipline
           when p_source = 'ai_agent' and s.discipline is not null then s.discipline
           else nullif(trim(p_discipline), '') end,
         drawing_scale = case
           when p_drawing_scale is null then s.drawing_scale
           when p_source = 'ai_agent' and s.drawing_scale is not null then s.drawing_scale
           else nullif(trim(p_drawing_scale), '') end,
         revision = case
           when p_revision is null then s.revision
           when p_source = 'ai_agent' and s.revision is not null then s.revision
           else nullif(trim(p_revision), '') end,
         revision_date = case
           when p_revision_date is null then s.revision_date
           when p_source = 'ai_agent' and s.revision_date is not null then s.revision_date
           else p_revision_date end
   where s.id = p_sheet;
end;
$$;

comment on function app.identify_sheet(uuid, text, text, text, text, text, date, text) is
  'Records what a sheet is: its number, title, discipline, printed scale and revision. Null leaves a field alone, and an agent may fill a blank but never overwrite what a person typed. WORKFLOW.';

/**
 * The sheets of a set, named where anybody has named them.
 *
 * `label` is built here rather than in the browser so the picker, the search
 * and anything printed all call a sheet the same thing.
 */
create or replace view my_plan_sheets as
select s.id,
       s.company_id,
       s.document_version_id,
       d.id   as document_id,
       d.name as document_name,
       v.storage_bucket,
       v.storage_path,
       s.page_number,
       s.sheet_number,
       s.sheet_title,
       s.discipline,
       s.drawing_scale,
       s.revision,
       s.revision_date,
       coalesce(
         nullif(concat_ws(' — ', nullif(s.sheet_number, ''), nullif(s.sheet_title, '')), ''),
         'p.' || s.page_number) as label,
       (s.sheet_number is null and s.sheet_title is null) as unnamed,
       (select count(*) from takeoff_measurements m where m.document_sheet_id = s.id)
         as measurement_count,
       (select count(*) from takeoff_calibrations c where c.document_sheet_id = s.id)
         as calibration_count
  from document_sheets s
  join document_versions v on v.id = s.document_version_id
  join documents d on d.id = v.document_id;

revoke all on my_plan_sheets from public, anon;
grant select on my_plan_sheets to authenticated;
alter view my_plan_sheets set (security_invoker = on);

comment on view my_plan_sheets is
  'Every sheet of every plan set, with the name somebody gave it and whether it still has none. One label, built once, so the picker and the search agree.';

create or replace function public.identify_sheet(
  p_sheet uuid, p_sheet_number text default null, p_sheet_title text default null,
  p_discipline text default null, p_drawing_scale text default null,
  p_revision text default null, p_revision_date date default null,
  p_source text default 'human')
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.identify_sheet(p_sheet, p_sheet_number, p_sheet_title, p_discipline,
                                p_drawing_scale, p_revision, p_revision_date, p_source); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'app.identify_sheet(uuid, text, text, text, text, text, date, text)',
    'public.identify_sheet(uuid, text, text, text, text, text, date, text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

select app.assert_security_gates();
