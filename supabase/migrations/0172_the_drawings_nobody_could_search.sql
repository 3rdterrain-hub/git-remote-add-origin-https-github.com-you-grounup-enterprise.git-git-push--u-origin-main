/**
 * The drawings nobody could search.
 *
 * `document_sheets.extracted_text` has carried a GIN trigram index since
 * migration 0005 and a snippet-building search function since 0036, and
 * `search_document_text` was given a public wrapper and a screen in 0147. The
 * column has never held a value. Nothing in this repository writes it — the
 * "Search the drawings" tab has only ever been able to return nothing, and
 * `ai-analyze-document` substitutes the literal string
 * "(no text extracted from this sheet)" for every sheet it reads, so the model
 * is asked to analyze a plan set it cannot see.
 *
 * `document_extractions` (0019) is the other half and has never held a row
 * either. Its own header says why it exists separately, and it is right:
 *
 *     Kept separate from `document_sheets` so a re-extraction with a better
 *     model can be written and compared without destroying what the previous
 *     run found.
 *
 * So these are not two names for one thing. `document_extractions` is the
 * record of each run — what read the sheet, what it concluded, what it found —
 * and `document_sheets.extracted_text` is the current text the search index
 * sits on. One writer keeps them in step, because a run that wrote one and not
 * the other is how they would come to disagree.
 *
 * A sheet's text is not an engine output and is not a judgment. It is what the
 * PDF says. The first writer of it is therefore the browser's own text layer —
 * deterministic, needs no key, and available on any set that came out of CAD.
 * A model may supersede that later with a better reading; it may not quietly
 * replace a reading with a worse one, so a run says what it was.
 *
 * WORKFLOW.
 */

-- -----------------------------------------------------------------------------
-- Recording one sheet's text
-- -----------------------------------------------------------------------------

/**
 * Record what a sheet says, and by what.
 *
 * `p_source` is the run: `pdf_text_layer` for the deterministic extraction the
 * browser does at upload, or a model name for a reading. It is stored on the
 * extraction row rather than inferred, because "who read this" is the first
 * question asked of a sheet whose text looks wrong.
 *
 * Empty text is recorded rather than refused. A sheet with no text layer is a
 * fact about the sheet — it is a scan, and it needs OCR — and a run that wrote
 * nothing is indistinguishable from a run that never happened unless the empty
 * result is kept.
 */
create or replace function app.record_sheet_extraction(
  p_sheet         uuid,
  p_text          text,
  p_source        text default 'pdf_text_layer',
  p_classified_as text default null,
  p_confidence    numeric default null,
  p_items         jsonb default '[]'::jsonb,
  p_job           uuid default null,
  p_prompt_version text default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_id      uuid;
  v_text    text := nullif(btrim(coalesce(p_text, '')), '');
begin
  select s.company_id into v_company from document_sheets s where s.id = p_sheet;
  if v_company is null then
    raise exception 'No such sheet' using errcode = 'no_data_found';
  end if;

  if not app.has_permission(v_company, 'documents.write') then
    raise exception 'You do not have permission to change this document'
      using errcode = 'insufficient_privilege';
  end if;

  if coalesce(btrim(p_source), '') = '' then
    raise exception 'Say what read this sheet'
      using errcode = 'check_violation',
            hint = 'The first question asked of text that looks wrong is who produced it.';
  end if;

  if p_confidence is not null and (p_confidence < 0 or p_confidence > 1) then
    raise exception 'A confidence is between 0 and 1, not %', p_confidence
      using errcode = 'check_violation';
  end if;

  /*
   * The run. `app.supersede_extraction` marks every earlier row for this sheet
   * not current, so the history is kept and only one row is the answer.
   */
  insert into document_extractions (
    company_id, document_sheet_id, ingestion_job_id, classified_as,
    classification_confidence, extracted_text, extracted_items, model, prompt_version)
  values (
    v_company, p_sheet, p_job, nullif(btrim(coalesce(p_classified_as, '')), ''),
    p_confidence, v_text, coalesce(p_items, '[]'::jsonb), btrim(p_source),
    nullif(btrim(coalesce(p_prompt_version, '')), ''))
  returning id into v_id;

  /*
   * And the current text, which is what the trigram index and the search
   * function read. Written from the same call so the two cannot drift: a run
   * that wrote the record and not the index is a sheet that is searchable for
   * nobody and looks extracted to everybody.
   *
   * A reading that found nothing records the run and leaves the text alone. An
   * OCR pass that fails, or a model that times out on one sheet of three
   * hundred, must not blank text the PDF's own layer read exactly — a sheet
   * that was searchable yesterday and is not today, with nothing on screen
   * saying why, is the worst version of this defect rather than a fix for it.
   * The run is still recorded, so the failure is visible in the history.
   */
  if v_text is not null then
    update document_sheets set extracted_text = v_text where id = p_sheet;
  end if;

  return v_id;
end;
$$;

comment on function app.record_sheet_extraction(uuid, text, text, text, numeric, jsonb, uuid, text) is
  'Records one reading of one sheet and makes it the current text. Writes document_extractions, which has never held a row, and document_sheets.extracted_text, which has carried a trigram index since 0005 with no writer. WORKFLOW.';

/**
 * Record a whole plan set's text in one call.
 *
 * A civil set is fourteen sheets and a specification is three hundred. One
 * round trip each is three hundred round trips, and a half-written set is worse
 * than an unwritten one — the search would return the first eighty pages and
 * silently omit the rest. This is one statement and one transaction.
 *
 * Takes the document and writes against its newest version, because that is
 * what the caller has: the browser has just uploaded the file and holds the id
 * `register_document_version` handed back. `documents` carries no version
 * pointer — `my_documents` derives it — so the resolution is done here rather
 * than left to every caller to get right the same way.
 *
 * `p_pages` is `[{"page": 1, "text": "..."}, ...]`. A page with no sheet row is
 * refused rather than skipped, because a page count that disagrees with the
 * file is the thing that would otherwise go unnoticed.
 */
create or replace function app.record_plan_set_text(
  p_document uuid,
  p_pages    jsonb,
  p_source   text default 'pdf_text_layer')
returns int
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_version uuid;
  v_page    jsonb;
  v_sheet   uuid;
  v_done    int := 0;
begin
  select v.company_id, v.id into v_company, v_version
    from document_versions v
   where v.document_id = p_document
   order by v.version_number desc
   limit 1;
  if v_company is null then
    raise exception 'That document has no versions' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'documents.write') then
    raise exception 'You do not have permission to change this document'
      using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_pages) <> 'array' then
    raise exception 'The pages are an array of {page, text}'
      using errcode = 'invalid_parameter_value';
  end if;

  for v_page in select * from jsonb_array_elements(p_pages)
  loop
    /*
     * A field name that is not recognized is refused, never ignored —
     * migrations 0136 and 0139. A typo in a key would otherwise write nothing
     * and report success.
     */
    if exists (
      select 1 from jsonb_object_keys(v_page) k
       where k not in ('page', 'text')
    ) then
      raise exception 'Unknown field in a page: %',
        (select string_agg(k, ', ') from jsonb_object_keys(v_page) k
          where k not in ('page', 'text'))
        using errcode = 'invalid_parameter_value',
              hint = 'A page is {"page": 1, "text": "..."}.';
    end if;

    select s.id into v_sheet
      from document_sheets s
     where s.document_version_id = v_version
       and s.page_number = (v_page ->> 'page')::int;

    if v_sheet is null then
      raise exception 'This set has no page %', v_page ->> 'page'
        using errcode = 'no_data_found',
              hint = 'The sheets are made from the page count. Set the page count first.';
    end if;

    perform app.record_sheet_extraction(v_sheet, v_page ->> 'text', p_source);
    v_done := v_done + 1;
  end loop;

  return v_done;
end;
$$;

comment on function app.record_plan_set_text(uuid, jsonb, text) is
  'Records the text of every page of a plan set in one transaction, so a set is searchable or it is not. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- What has been read, and what has not
-- -----------------------------------------------------------------------------

/**
 * Which sheets can be searched, and which are pictures of drawings.
 *
 * A set with no text layer is not broken and does not announce itself: the
 * search simply never finds it. This is where it says so, and it is the thing
 * that tells somebody a set needs OCR rather than another search term.
 */
create or replace view my_sheet_text_coverage as
select v.id            as document_version_id,
       d.id            as document_id,
       d.name          as document_name,
       v.storage_bucket,
       v.storage_path,
       count(*)                                          as sheets,
       count(*) filter (where s.extracted_text is not null) as sheets_with_text,
       count(*) filter (where s.extracted_text is null)     as sheets_without_text,
       max(e.created_at)                                 as last_read_at,
       (array_agg(e.model order by e.created_at desc)
          filter (where e.model is not null))[1]         as last_read_by
  from document_versions v
  join documents d on d.id = v.document_id
  join document_sheets s on s.document_version_id = v.id
  left join document_extractions e on e.document_sheet_id = s.id and e.is_current
 group by v.id, d.id, d.name, v.storage_bucket, v.storage_path;

revoke all on my_sheet_text_coverage from public, anon;
grant select on my_sheet_text_coverage to authenticated;
alter view my_sheet_text_coverage set (security_invoker = on);

comment on view my_sheet_text_coverage is
  'How much of each plan set can be searched. A set with no text layer is a scan and needs OCR, which is otherwise invisible: the search just never finds it.';

-- -----------------------------------------------------------------------------
-- Doors
-- -----------------------------------------------------------------------------
/*
 * One door, not two. `record_sheet_extraction` is reached through
 * `record_plan_set_text`, because a set is searchable or it is not — writing
 * one sheet at a time from a browser is how half a set gets written and nobody
 * finds out. It gets a wrapper of its own when something needs to re-read a
 * single sheet, and not before.
 */
create or replace function public.record_plan_set_text(
  p_document uuid, p_pages jsonb, p_source text default 'pdf_text_layer')
returns int language sql security invoker set search_path = public, pg_catalog
as $$ select app.record_plan_set_text(p_document, p_pages, p_source); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.record_plan_set_text(uuid, jsonb, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

select app.attach_standard_triggers('public.document_extractions');
