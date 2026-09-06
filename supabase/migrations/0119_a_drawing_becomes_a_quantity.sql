-- =============================================================================
-- 0119 — A drawing becomes a quantity
--
-- `ai-analyze-document` has existed since migration 0019's governance work. It
-- reads an uploaded plan set with Claude, writes cited findings in state
-- `proposed`, refuses a factual finding with no citation, and is told in its
-- own prompt that it does not compute cost, price, production or duration —
-- those belong to the deterministic engine.
--
-- None of that could be reached. The function takes a `documentVersionId`, and
-- nothing in this platform ever created one: there was no upload, so there was
-- no document, so there was no version to analyze. The most-asked-for thing in
-- estimating — hand it the plans, get quantities back — was a working Edge
-- Function with no door.
--
-- This builds the two ends of it.
--
--   * **Registering an upload.** `app.register_document_version` files the
--     `documents` and `document_versions` rows for a file that has landed in
--     storage. It is a function rather than two inserts because a version with
--     no document is a row nothing can find, and a document whose
--     `current_version` disagrees with its versions is a lie about which
--     drawing is current.
--
--   * **Accepting a finding.** `app.accept_finding_as_line` turns a quantity
--     candidate into an estimate line — and this is where RULE-008 lives. The
--     AI proposes; a person accepts; the line records that it came from AI and
--     who accepted it. The finding's own confidence does not become the line's,
--     because the line's confidence is the engine's to compute. And the model's
--     arithmetic is never authoritative: the quantity is an input, and every
--     cost that follows is the engine's.
--
-- The storage bucket is created here too, private, with policies that let a
-- member read and write only their own company's prefix. `document_versions`
-- has carried `storage_bucket text not null default 'project-documents'` since
-- migration 0005 and the bucket has never existed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Somewhere for the file to live
-- -----------------------------------------------------------------------------

/*
 * Private. Every read goes through a signed URL the caller's own policy allowed,
 * so a plan set is never a public object with an unguessable name — an
 * unguessable name is not an access control.
 *
 * Guarded because `storage` belongs to the Supabase platform: a database that
 * has no storage schema (the test harness) skips this and everything else in
 * this migration still applies.
 */
do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'storage' and table_name = 'buckets') then
    execute $b$
      insert into storage.buckets (id, name, public, file_size_limit)
      values ('project-documents', 'project-documents', false, 268435456)
      on conflict (id) do nothing
    $b$;

    /*
     * The first path segment is the company id, so a policy can decide from the
     * object name alone whose file this is. `app.is_member` then answers the
     * only question that matters.
     */
    execute $p$
      drop policy if exists project_documents_read on storage.objects;
      create policy project_documents_read on storage.objects
        for select to authenticated
        using (bucket_id = 'project-documents'
               and app.is_member(nullif(split_part(name, '/', 1), '')::uuid));
    $p$;
    execute $p$
      drop policy if exists project_documents_write on storage.objects;
      create policy project_documents_write on storage.objects
        for insert to authenticated
        with check (bucket_id = 'project-documents'
                    and app.is_member(nullif(split_part(name, '/', 1), '')::uuid)
                    and app.has_permission(
                          nullif(split_part(name, '/', 1), '')::uuid, 'documents.write'));
    $p$;
    execute $p$
      drop policy if exists project_documents_delete on storage.objects;
      create policy project_documents_delete on storage.objects
        for delete to authenticated
        using (bucket_id = 'project-documents'
               and app.is_member(nullif(split_part(name, '/', 1), '')::uuid)
               and app.has_permission(
                     nullif(split_part(name, '/', 1), '')::uuid, 'documents.write'));
    $p$;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Registering what was uploaded
-- -----------------------------------------------------------------------------

/**
 * File a document and its first version for something that has landed in
 * storage.
 *
 * One call, because the two rows have to agree: a version with no document
 * cannot be found, and a document whose `current_version` disagrees with its
 * versions is a lie about which drawing is current.
 *
 * Returns the version id, which is what `ai-analyze-document` takes.
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
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_document uuid;
  v_version  uuid;
begin
  if p_company is null then
    raise exception 'Say which company this document belongs to'
      using errcode = 'check_violation';
  end if;
  if not app.has_permission(p_company, 'documents.write') then
    raise exception 'You do not have permission to add a document'
      using errcode = 'insufficient_privilege';
  end if;
  if nullif(trim(coalesce(p_storage_path, '')), '') is null then
    raise exception 'A document version needs the path it was stored at'
      using errcode = 'check_violation';
  end if;
  /*
   * The path has to start with the company id, because that is what the storage
   * policy reads to decide whose file it is. A row pointing somewhere else
   * would be a document the platform lists and nobody can open.
   */
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

  return v_version;
end;
$$;

comment on function app.register_document_version(uuid, text, text, text, text, bigint, text, uuid, int) is
  'Files a document and its first version for a file that has landed in storage. WORKFLOW: one call, because a version with no document cannot be found and a document whose current_version disagrees with its versions is a lie about which drawing is current.';

-- -----------------------------------------------------------------------------
-- Accepting what the model found
-- -----------------------------------------------------------------------------

/**
 * Turn a quantity candidate into an estimate line.
 *
 * This is where RULE-008 is enforced rather than described. The model proposes;
 * a person accepts; the line records that it came from AI, who accepted it and
 * when. Three things it deliberately does not do:
 *
 *   * It does not carry the model's confidence onto the line. Line confidence
 *     is the engine's to compute from the rate, the sources and the checks —
 *     a number the model scored itself is not evidence about the estimate.
 *   * It does not price anything. The quantity is an input; every cost that
 *     follows is the engine's, and this writes none of them.
 *   * It does not accept the same finding twice. A finding already applied has
 *     a line; a second one would double a quantity somebody thought they had
 *     entered once.
 */
create or replace function app.accept_finding_as_line(
  p_finding uuid,
  p_version uuid,
  p_note text default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_f       ai_findings%rowtype;
  v_company uuid;
  v_status  app.estimate_status;
  v_qty     numeric;
  v_unit    app.unit_code;
  v_line    uuid;
begin
  select * into v_f from ai_findings where id = p_finding;
  if not found then
    raise exception 'No such finding' using errcode = 'no_data_found';
  end if;

  select v.company_id, v.status into v_company, v_status
  from estimate_versions v where v.id = p_version;
  if v_company is null then
    raise exception 'No such estimate version' using errcode = 'no_data_found';
  end if;
  if v_f.company_id <> v_company then
    raise exception 'That finding belongs to another company'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.has_permission(v_company, 'estimates.write') then
    raise exception 'You do not have permission to change this estimate'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status not in ('draft', 'in_review') then
    raise exception 'This version is %; make a new version to change it', v_status
      using errcode = 'check_violation',
            hint = 'app.revise_estimate_version copies it forward with a reason.';
  end if;
  if v_f.finding_type <> 'quantity_candidate' then
    raise exception 'Only a quantity candidate becomes a line; this is a %', v_f.finding_type
      using errcode = 'check_violation';
  end if;
  if v_f.state <> 'proposed' then
    raise exception 'That finding has already been %', v_f.state
      using errcode = 'check_violation',
            hint = 'A finding accepted twice would double a quantity somebody entered once.';
  end if;

  v_qty := nullif(v_f.payload ->> 'quantity', '')::numeric;
  v_unit := nullif(v_f.payload ->> 'unit', '')::app.unit_code;
  if v_qty is null or v_qty < 0 then
    raise exception 'That finding carries no usable quantity'
      using errcode = 'check_violation';
  end if;

  v_line := app.add_estimate_line(p_version, null, v_f.title, v_qty, coalesce(v_unit, 'LS'));

  /*
   * The provenance, on the line itself. `origin = 'ai_suggested'` with an
   * accepter is the shape migration 0006's `eli_ai_acceptance` constraint was
   * written for: an AI line cannot sit in an estimate unaccepted by a human.
   */
  update estimate_line_items
     set origin = 'ai_suggested',
         ai_agent_id = v_f.agent_id,
         ai_accepted_by = auth.uid(),
         ai_accepted_at = now(),
         source_references = coalesce(v_f.sheet_references, '{}'),
         notes = nullif(trim(coalesce(p_note, '')), '')
   where id = v_line;

  update ai_findings
     set state = 'accepted',
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_note = nullif(trim(coalesce(p_note, '')), ''),
         applied_entity_table = 'estimate_line_items',
         applied_entity_id = v_line
   where id = p_finding;

  return v_line;
end;
$$;

comment on function app.accept_finding_as_line(uuid, uuid, text) is
  'Turns an AI quantity candidate into an estimate line, recording who accepted it. WORKFLOW enforcing RULE-008: the model proposes and a person decides. The finding''s own confidence is not carried onto the line, because line confidence is the engine''s to compute.';

/** Set a finding aside, with the reason it was not used. */
create or replace function app.reject_finding(p_finding uuid, p_note text)
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  select company_id into v_company from ai_findings where id = p_finding;
  if v_company is null then
    raise exception 'No such finding' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'estimates.write') then
    raise exception 'You do not have permission to review findings'
      using errcode = 'insufficient_privilege';
  end if;
  if p_note is null or length(trim(p_note)) < 4 then
    raise exception 'Say why this was not used'
      using errcode = 'check_violation',
            hint = 'The next person reading the plans deserves to know what was already ruled out.';
  end if;

  update ai_findings
     set state = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
         review_note = trim(p_note)
   where id = p_finding and state = 'proposed';
end;
$$;

-- -----------------------------------------------------------------------------
-- What a screen reads
-- -----------------------------------------------------------------------------

/** The findings waiting on a person, with what they came from. */
create or replace view my_ai_findings
with (security_invoker = true) as
select f.id,
       f.company_id,
       f.agent_id,
       f.finding_type,
       f.title,
       f.description,
       f.confidence,
       f.state,
       f.severity,
       f.citations,
       f.sheet_references,
       f.specification_references,
       nullif(f.payload ->> 'quantity', '')::numeric as quantity,
       nullif(f.payload ->> 'unit', '')              as unit,
       nullif(f.payload ->> 'method', '')            as method,
       f.model,
       f.prompt_version,
       f.reviewed_at,
       f.review_note,
       f.applied_entity_id,
       f.created_at,
       f.document_id,
       f.document_version_id,
       f.estimate_version_id,
       d.name      as document_name,
       dv.file_name,
       dv.page_count
from ai_findings f
left join documents d on d.id = f.document_id
left join document_versions dv on dv.id = f.document_version_id;

revoke all on my_ai_findings from public, anon;
grant select on my_ai_findings to authenticated;

/** The plan sets this company has uploaded, and what came of each. */
create or replace view my_documents
with (security_invoker = true) as
select d.id,
       d.company_id,
       d.name,
       d.document_type,
       d.estimate_id,
       d.created_at,
       dv.id            as current_version_id,
       dv.file_name,
       dv.mime_type,
       dv.byte_size,
       dv.page_count,
       dv.storage_path,
       dv.processing_state,
       (select count(*) from ai_findings f
         where f.document_version_id = dv.id)                        as finding_count,
       (select count(*) from ai_findings f
         where f.document_version_id = dv.id and f.state = 'proposed') as awaiting_review
from documents d
join document_versions dv
  on dv.document_id = d.id and dv.version_number = d.current_version
where d.status = 'active';

revoke all on my_documents from public, anon;
grant select on my_documents to authenticated;

-- -----------------------------------------------------------------------------
-- The doors a browser uses
-- -----------------------------------------------------------------------------

create or replace function public.register_document_version(
  p_company uuid, p_name text, p_storage_path text, p_file_name text,
  p_mime_type text default null, p_byte_size bigint default null,
  p_document_type text default 'plan_set', p_estimate_id uuid default null,
  p_page_count int default null)
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin
  return app.register_document_version(p_company, p_name, p_storage_path, p_file_name,
    p_mime_type, p_byte_size, p_document_type, p_estimate_id, p_page_count);
end; $$;

create or replace function public.accept_finding_as_line(
  p_finding uuid, p_version uuid, p_note text default null)
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin return app.accept_finding_as_line(p_finding, p_version, p_note); end; $$;

create or replace function public.reject_finding(p_finding uuid, p_note text)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.reject_finding(p_finding, p_note); end; $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.register_document_version(uuid, text, text, text, text, bigint, text, uuid, int)',
    'public.accept_finding_as_line(uuid, uuid, text)',
    'public.reject_finding(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

select app.assert_security_gates();
