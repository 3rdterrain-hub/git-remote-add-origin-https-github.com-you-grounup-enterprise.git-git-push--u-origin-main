-- =============================================================================
-- 0135 — A plan set becomes sheets
--
-- On-screen takeoff could not be started. Not "was awkward" — could not begin.
--
-- The chain is five links. A plan set is uploaded and lands in storage, and
-- `register_document_version` files the `documents` and `document_versions`
-- rows for it. A sheet — one page of that plan set — is what a takeoff is taken
-- on: `takeoff_calibrations` sets its scale, `takeoff_measurements` records
-- what was traced on it, and `apply_takeoff_to_line` puts the result on an
-- estimate. Four of those five links were built, tested, and are still tested.
--
-- Nothing in this repository ever created the second one. Not a function, not a
-- trigger, not the AI reader, not a seed. `document_sheets` had a table, row
-- level security, a tenant-parent guard, two indexes and a trigram search
-- index, and no writer. So `loadSheets` returned an empty list forever, the
-- takeoff screen had nothing to open, and the PDF canvas, the measurement
-- overlay, the calibration panel, the apply panel and the engine's `measure`
-- and `measureBasin` all sat idle behind it.
--
-- This is not the usual "a working feature with no door" — the door is in the
-- middle of the corridor, with working rooms on both sides of it.
--
-- The page count is what makes a sheet, and `register_document_version` has
-- taken a `p_page_count` argument since 0119 and never done anything with it.
-- The browser already renders these pages with PDF.js, so it already knows the
-- number; it was passing null. Now the count creates the sheets.
--
-- Two functions rather than one, because there are two moments:
--
--   * a plan set uploaded from now on gets its sheets as it is registered;
--   * a plan set already uploaded is not stranded — `set_document_page_count`
--     gives it sheets whenever somebody says how many pages it has, which is
--     the difference between fixing this going forward and fixing it.
--
-- What a sheet does *not* get here is a sheet number, a title, a discipline or
-- a stated scale. Those are printed in the title block, and reading them is
-- `ai-analyze-document`'s job or a person's. A page with no number is honest;
-- a page numbered by guess is a drawing somebody cannot find again.
-- =============================================================================

/**
 * One sheet per page, made once.
 *
 * Idempotent on `(document_version_id, page_number)`, which 0005 already made
 * unique — so calling this twice on the same plan set, or raising a page count
 * from 12 to 14, adds what is missing and disturbs nothing that already carries
 * a calibration or a measurement.
 */
create or replace function app.create_document_sheets(p_version uuid, p_pages int)
returns int
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_made    int;
begin
  if p_pages is null or p_pages < 1 then
    return 0;
  end if;
  if p_pages > 2000 then
    raise exception 'A plan set of % pages is not a plan set.', p_pages
      using errcode = 'check_violation',
            hint = 'If it really is that long, split it into volumes.';
  end if;

  select company_id into v_company from document_versions where id = p_version;
  if v_company is null then
    raise exception 'No such document version.' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'documents.write') then
    raise exception 'Making the sheets of a plan set needs the documents.write permission.'
      using errcode = 'insufficient_privilege';
  end if;

  with made as (
    insert into document_sheets (company_id, document_version_id, page_number)
    select v_company, p_version, g
      from generate_series(1, p_pages) g
    on conflict (document_version_id, page_number) do nothing
    returning 1)
  select count(*)::int into v_made from made;

  return v_made;
end;
$$;

comment on function app.create_document_sheets(uuid, int) is
  'Creates one document_sheets row per page of a plan set, which is what a takeoff is taken on. Idempotent, so raising a page count fills the gap without disturbing a sheet that already carries a calibration. ENGINE support for on-screen takeoff.';

/**
 * File a document and its first version, and make its sheets.
 *
 * Unchanged from 0119 except for the last statement. The page count was already
 * an argument and was already being stored on the version; it just never became
 * anything a person could open.
 */
create or replace function app.register_document_version(
  p_company uuid,
  p_name text,
  p_storage_path text,
  p_file_name text,
  p_mime_type text default null,
  p_byte_size bigint default null,
  p_document_type text default 'plan_set',
  p_estimate_id uuid default null,
  p_page_count int default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_document uuid;
  v_version  uuid;
begin
  if not app.has_permission(p_company, 'documents.write') then
    raise exception 'Uploading a document needs the documents.write permission'
      using errcode = 'insufficient_privilege';
  end if;
  if nullif(trim(coalesce(p_file_name, '')), '') is null then
    raise exception 'A document version needs the name of the file it came from'
      using errcode = 'check_violation';
  end if;
  if nullif(trim(coalesce(p_storage_path, '')), '') is null then
    raise exception 'A document version needs the path it was stored at'
      using errcode = 'check_violation';
  end if;
  if split_part(p_storage_path, '/', 1) <> p_company::text then
    raise exception 'That storage path does not belong to this company'
      using errcode = 'check_violation',
            hint = 'Upload to <company-id>/… so the storage policy can see whose file it is.';
  end if;
  if p_estimate_id is not null
     and not exists (select 1 from estimates e
                      where e.id = p_estimate_id and e.company_id = p_company) then
    raise exception 'That estimate is not one of yours' using errcode = 'no_data_found';
  end if;

  insert into documents (company_id, name, document_type, estimate_id,
                         current_version, created_by)
  values (p_company,
          coalesce(nullif(trim(coalesce(p_name, '')), ''), p_file_name),
          coalesce(nullif(trim(coalesce(p_document_type, '')), ''), 'plan_set'),
          p_estimate_id, 1, auth.uid())
  returning id into v_document;

  insert into document_versions (
    company_id, document_id, version_number, storage_path, storage_bucket,
    file_name, mime_type, byte_size, page_count, uploaded_by)
  values (
    p_company, v_document, 1, p_storage_path, 'project-documents',
    p_file_name, p_mime_type, p_byte_size, p_page_count, auth.uid())
  returning id into v_version;

  /* The pages become sheets, which is what a takeoff is taken on. */
  perform app.create_document_sheets(v_version, p_page_count);

  return v_version;
end;
$$;

/**
 * Say how many pages a plan set has, and get its sheets.
 *
 * For everything uploaded before this migration, and for anything uploaded by a
 * caller that did not count the pages. Without it the fix would apply only to
 * plan sets uploaded from now on, and every drawing already in the system would
 * stay un-takeoffable with no way to say so.
 *
 * Returns how many sheets were made, which is zero when they already exist.
 */
create or replace function public.set_document_page_count(p_version uuid, p_pages int)
returns int
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare v_made int;
begin
  v_made := app.create_document_sheets(p_version, p_pages);
  update document_versions set page_count = p_pages where id = p_version;
  return v_made;
end;
$$;

comment on function public.set_document_page_count(uuid, int) is
  'Records how many pages a plan set has and creates the sheet rows a takeoff needs. WORKFLOW for a document uploaded before its pages were counted.';

/**
 * The plan sets nobody can take off, and why.
 *
 * A drawing with no sheets is not broken and does not announce itself — it
 * simply never appears on the takeoff screen. This is where it says so.
 */
create or replace view my_plan_sets_without_sheets
with (security_invoker = true) as
select v.id           as document_version_id,
       v.company_id,
       d.name         as document_name,
       d.document_type,
       v.file_name,
       v.page_count,
       v.created_at
from document_versions v
join documents d on d.id = v.document_id
where not exists (select 1 from document_sheets s where s.document_version_id = v.id);

comment on view my_plan_sets_without_sheets is
  'Uploaded documents that have no sheets, so no takeoff can be started on them. REPORTING view over documents. A page count is all that is missing; set_document_page_count supplies it.';

do $$
begin
  execute 'revoke all on function public.set_document_page_count(uuid, int) from public, anon';
  execute 'grant execute on function public.set_document_page_count(uuid, int) to authenticated';
  execute 'revoke all on function app.create_document_sheets(uuid, int) from public, anon';
  execute 'grant execute on function app.create_document_sheets(uuid, int) to authenticated';
  execute 'revoke all on my_plan_sets_without_sheets from public, anon';
  execute 'grant select on my_plan_sets_without_sheets to authenticated';
end $$;

select app.assert_security_gates();
