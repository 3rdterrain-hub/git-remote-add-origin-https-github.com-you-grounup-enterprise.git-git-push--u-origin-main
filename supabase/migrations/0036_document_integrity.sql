-- =============================================================================
-- 0036 — Document integrity: the current version, supersession, and the text
--
-- Document control is the evidence layer everything else cites. A claim rests
-- on the drawings and reports it names, a change order on the revision that
-- caused it, a submittal on the specification section it answers. Three things
-- were wrong with it, and all three are the same shape this build has found
-- repeatedly — a value the platform presents as derived that a caller can type,
-- and an index nothing queries.
--
--   * **`documents.current_version` was a stored integer nothing maintained.**
--     Uploading version 3 did not advance it, and setting it to 7 when two
--     versions existed was accepted. Every screen that shows "Rev 3" was
--     reading a number somebody typed.
--   * **A version could be attached across a tenant boundary.** Found by the
--     tests written for this migration, and made reachable by the fix above:
--     the current-version trigger counts every version a document has, so a
--     row another company attached would move it.
--   * **Supersession had no cycle guard.** A document could supersede itself,
--     or two could supersede each other, and any walk of the chain would loop.
--   * **The text of every document was indexed and unsearchable.**
--     `document_sheets.extracted_text` carries a GIN trigram index and a
--     comment saying it is "used for permission-filtered search across the plan
--     set". Nothing queried it, and `app.search` searched document *names*
--     only. A superintendent looking for "cathodic protection" found a drawing
--     only if those words were in its file name.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A version belongs to the document's company, not the uploader's
--
-- `document_versions` and `document_sheets` had no tenant-parent guard, so a
-- user of company B could attach a version to company A's document: row level
-- security passed, because the row carried B's own company_id, and the foreign
-- key passed, because the document existed. Company A could not see the row —
-- and would still have felt it, because the current-version trigger below
-- counts every version a document has.
--
-- This is the exact structural gap `app.enforce_tenant_parent` exists to
-- close, and the evidence layer was one of the few places without it.
-- -----------------------------------------------------------------------------
create trigger document_versions_tenant_parent
  before insert or update on document_versions
  for each row execute function app.enforce_tenant_parent('documents', 'document_id', 'id');

create trigger document_sheets_tenant_parent
  before insert or update on document_sheets
  for each row execute function app.enforce_tenant_parent('document_versions', 'document_version_id', 'id');

-- -----------------------------------------------------------------------------
-- The current version is counted, not typed
-- -----------------------------------------------------------------------------

/**
 * Keep `documents.current_version` equal to the highest version that exists.
 *
 * Maintained rather than derived because the column is already there and read
 * from several screens; removing it would be a wider change than this defect
 * warrants. What matters is that nothing can set it to a number that is not
 * true, which the guard below enforces from the other side.
 */
create or replace function app.sync_document_current_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_document uuid := coalesce(new.document_id, old.document_id);
  v_highest  int;
begin
  select coalesce(max(version_number), 1) into v_highest
  from document_versions where document_id = v_document;

  update documents set current_version = v_highest
  where id = v_document and current_version is distinct from v_highest;

  return coalesce(new, old);
end;
$$;

create trigger document_versions_sync_current
  after insert or update or delete on document_versions
  for each row execute function app.sync_document_current_version();

/**
 * Refuse a current version that no version row supports.
 *
 * The trigger above keeps the number right when versions move. This stops a
 * caller writing a number directly that was never true — the same shape as a
 * schedule float nobody computed or a claim deadline nobody derived.
 */
create or replace function app.enforce_document_current_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_highest int;
  v_count   int;
begin
  if tg_op = 'UPDATE' and new.current_version is not distinct from old.current_version then
    return new;
  end if;

  select count(*), coalesce(max(version_number), 0) into v_count, v_highest
  from document_versions where document_id = new.id;

  -- A document with no versions yet is at 1 by definition: the row exists
  -- before its first file is attached.
  if v_count = 0 then
    if new.current_version <> 1 then
      raise exception
        'Document % has no versions, so its current version is 1, not %.',
        new.name, new.current_version
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.current_version <> v_highest then
    raise exception
      'Document % is at version %, not %. The current version is counted from the versions that exist, not set.',
      new.name, v_highest, new.current_version
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger documents_current_version_true
  before insert or update of current_version on documents
  for each row execute function app.enforce_document_current_version();

comment on function app.enforce_document_current_version() is
  'The current version is counted from the version rows that exist. A number set directly that no version supports is refused, because every screen showing a revision reads this column.';

-- -----------------------------------------------------------------------------
-- Supersession is a chain, not a loop
-- -----------------------------------------------------------------------------

alter table documents
  add constraint documents_not_superseded_by_self
  check (superseded_by_id is null or superseded_by_id <> id);

comment on constraint documents_not_superseded_by_self on documents is
  'A document cannot replace itself. Any walk of the supersession chain would never terminate.';

/**
 * Refuse a supersession that closes a loop.
 *
 * A self-reference is caught by the constraint above; this catches the longer
 * case — A superseded by B superseded by A — which no constraint can see.
 * Walks the chain from the proposed target and refuses if it arrives back.
 */
create or replace function app.enforce_supersession_acyclic()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_at    uuid := new.superseded_by_id;
  v_steps int := 0;
  v_path  text := '';
  v_name  text;
begin
  if v_at is null then
    return new;
  end if;

  while v_at is not null loop
    v_steps := v_steps + 1;
    if v_steps > 64 then
      raise exception 'The supersession chain from % is longer than 64 documents; refusing to walk further.',
        new.name using errcode = 'restrict_violation';
    end if;

    select name, superseded_by_id into v_name, v_at from documents where id = v_at;
    v_path := v_path || ' -> ' || coalesce(v_name, '(missing)');

    if v_at = new.id then
      raise exception
        'Superseding % by that document would close a loop:%  -> %. A revision chain has to end somewhere.',
        new.name, v_path, new.name
        using errcode = 'restrict_violation';
    end if;
  end loop;

  return new;
end;
$$;

create trigger documents_supersession_acyclic
  before insert or update of superseded_by_id on documents
  for each row execute function app.enforce_supersession_acyclic();

-- -----------------------------------------------------------------------------
-- Search the text, not only the name
-- -----------------------------------------------------------------------------

/**
 * Extend the platform search to what documents actually say.
 *
 * `document_sheets.extracted_text` carries a GIN trigram index and a comment
 * saying it is "used for permission-filtered search across the plan set".
 * Nothing queried it. A drawing whose title block says "C-210" and whose body
 * says "cathodic protection" was findable by the first and not the second —
 * the column stated its own purpose and nothing fulfilled it.
 *
 * SECURITY INVOKER, so a caller sees only sheets their own row level security
 * lets them read, which is what "permission-filtered" was always meant to
 * mean. Superseded documents stay out for the same reason the name search
 * excludes them: they are kept for the audit trail, not for reference.
 */
create or replace function app.search_document_text(p_query text, p_limit int default 25)
returns table (
  document_id uuid,
  document_name text,
  version_number int,
  page_number int,
  sheet_number text,
  snippet text,
  rank real
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with q as (select nullif(trim(p_query), '') as term)
  select d.id, d.name, v.version_number, s.page_number, s.sheet_number,
         -- A window around the first match, so a result shows why it matched.
         '…' || substring(
           s.extracted_text
           from greatest(1, position(lower((select term from q)) in lower(s.extracted_text)) - 60)
           for 180) || '…' as snippet,
         similarity(s.extracted_text, (select term from q)) as rank
  from document_sheets s
  join document_versions v on v.id = s.document_version_id
  join documents d on d.id = v.document_id
  cross join q
  where q.term is not null
    and not d.is_superseded
    and s.extracted_text is not null
    and s.extracted_text ilike '%' || q.term || '%'
  order by rank desc nulls last, d.name, s.page_number
  limit greatest(1, least(p_limit, 100));
$$;

grant execute on function app.search_document_text(text, int) to authenticated;

comment on function app.search_document_text(text, int) is
  'Searches what documents say, not only what they are called. SECURITY INVOKER, so results are already bounded by the caller''s row level security; superseded documents are excluded because they are kept for the audit trail rather than for reference.';

select app.assert_security_gates();
