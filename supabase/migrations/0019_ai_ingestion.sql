-- =============================================================================
-- GrounUp Enterprise — 0019 Document ingestion and enterprise search
--
-- SVC-INGEST, SVC-SEARCH and SVC-KNOWLEDGE.
--
-- The pipeline that turns an uploaded plan set into cited findings:
--   upload -> scan -> split -> extract -> index -> findings -> human review
--
-- Each stage is recorded, so a document that produced a bad quantity can be
-- traced to the exact model, prompt version and page it came from. That
-- traceability is what makes an AI finding auditable rather than merely
-- plausible.
-- =============================================================================

create table ingestion_jobs (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  document_id         uuid not null references documents(id) on delete cascade,
  document_version_id uuid not null references document_versions(id) on delete cascade,

  stage               text not null default 'queued'
                        check (stage in ('queued', 'virus_scan', 'splitting', 'ocr',
                                         'classifying', 'extracting', 'indexing', 'complete', 'failed')),
  -- Fraction of the pipeline finished, for a progress bar that means something.
  progress            numeric(5,4) not null default 0 check (progress >= 0 and progress <= 1),
  pages_total         int check (pages_total is null or pages_total >= 0),
  pages_processed     int not null default 0 check (pages_processed >= 0),

  agent_id            text references ai_agents(id) on delete set null,
  model               text,
  prompt_version      text,
  input_tokens        int check (input_tokens is null or input_tokens >= 0),
  output_tokens       int check (output_tokens is null or output_tokens >= 0),
  cost_estimate       numeric(12,4) check (cost_estimate is null or cost_estimate >= 0),

  findings_created    int not null default 0 check (findings_created >= 0),
  started_at          timestamptz,
  completed_at        timestamptz,
  duration_ms         int check (duration_ms is null or duration_ms >= 0),
  error_message       text,
  -- Retry bookkeeping so a transient failure is distinguishable from a real one.
  attempts            int not null default 0 check (attempts >= 0 and attempts <= 5),

  requested_by        uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint ingestion_jobs_failed check (stage <> 'failed' or error_message is not null),
  constraint ingestion_jobs_complete check (stage <> 'complete' or completed_at is not null),
  constraint ingestion_jobs_pages check (pages_total is null or pages_processed <= pages_total)
);
create index ingestion_jobs_document_idx on ingestion_jobs(document_version_id, created_at desc);
create index ingestion_jobs_active_idx on ingestion_jobs(company_id, stage)
  where stage not in ('complete', 'failed');

comment on constraint ingestion_jobs_failed on ingestion_jobs is
  'A failed job must say why. "Failed" with no message forces someone to re-run it blind.';

/**
 * The extracted, searchable text of a document, one row per sheet.
 *
 * Kept separate from `document_sheets` so a re-extraction with a better model
 * can be written and compared without destroying what the previous run found.
 */
create table document_extractions (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  document_sheet_id   uuid not null references document_sheets(id) on delete cascade,
  ingestion_job_id    uuid references ingestion_jobs(id) on delete set null,
  -- What the model concluded this sheet is.
  classified_as       text,
  classification_confidence numeric(5,4) check (classification_confidence is null or (classification_confidence >= 0 and classification_confidence <= 1)),
  extracted_text      text,
  -- Structured items the model located, each carrying its own citation.
  extracted_items     jsonb not null default '[]'::jsonb,
  model               text,
  prompt_version      text,
  is_current          boolean not null default true,
  created_at          timestamptz not null default now()
);
create index document_extractions_sheet_idx on document_extractions(document_sheet_id) where is_current;
create index document_extractions_text_idx on document_extractions using gin (extracted_text gin_trgm_ops);

create trigger document_extractions_tenant_parent
  before insert or update on document_extractions
  for each row execute function app.enforce_tenant_parent('document_sheets', 'document_sheet_id', 'id');

/** Only one current extraction per sheet; older runs are retained for comparison. */
create or replace function app.supersede_extraction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.is_current then
    update document_extractions
    set is_current = false
    where document_sheet_id = new.document_sheet_id
      and id <> new.id
      and is_current;
  end if;
  return new;
end;
$$;

create trigger supersede_extraction
  after insert on document_extractions
  for each row execute function app.supersede_extraction();

-- -----------------------------------------------------------------------------
-- Company knowledge base (SVC-KNOWLEDGE)
-- -----------------------------------------------------------------------------
create table knowledge_articles (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  title               text not null,
  slug                text not null,
  category            text not null default 'sop'
                        check (category in ('sop', 'standard', 'policy', 'lesson_learned', 'manual', 'spec_note')),
  body                text not null,
  tags                text[] not null default '{}',
  -- A knowledge article the AI may cite must be approved, or the assistant is
  -- quoting a draft back to the company as though it were policy.
  status              text not null default 'draft'
                        check (status in ('draft', 'in_review', 'approved', 'retired')),
  approved_by         uuid references auth.users(id) on delete set null,
  approved_at         timestamptz,
  version             int not null default 1 check (version >= 1),
  supersedes_id       uuid references knowledge_articles(id) on delete set null,
  search_text         text generated always as (title || ' ' || body) stored,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, slug, version),
  constraint knowledge_articles_approved
    check (status <> 'approved' or (approved_by is not null and approved_at is not null))
);
create index knowledge_articles_company_idx on knowledge_articles(company_id, status);
create index knowledge_articles_search_idx on knowledge_articles using gin (search_text gin_trgm_ops);

comment on constraint knowledge_articles_approved on knowledge_articles is
  'Only an approved article may be cited by the knowledge assistant. Quoting a draft back to the company as policy is worse than saying nothing.';

-- -----------------------------------------------------------------------------
-- Enterprise search (SVC-SEARCH)
-- -----------------------------------------------------------------------------

/**
 * Permission-filtered search across the records a user may actually see.
 *
 * The filtering is not applied afterwards in application code: each branch of
 * the union reads a table that already has RLS forced, so a row the caller
 * cannot select simply does not appear. A search index maintained outside the
 * permission model is the classic way a platform leaks one tenant's data to
 * another through autocomplete.
 */
create or replace function app.search(p_query text, p_limit int default 25)
returns table (
  kind text,
  id uuid,
  title text,
  subtitle text,
  path text,
  rank real
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with q as (select nullif(trim(p_query), '') as term)
  select * from (
    select 'estimate'::text as kind, e.id as id,
           (e.number || ' — ' || e.name) as title,
           coalesce(c.name, 'No customer') as subtitle,
           ('/app/estimates/' || e.id) as path,
           similarity(e.number || ' ' || e.name, (select term from q)) as rank
    from estimates e left join customers c on c.id = e.customer_id, q
    where q.term is not null and (e.number || ' ' || e.name) % q.term

    union all
    select 'project', p.id, p.number || ' — ' || p.name,
           coalesce(cu.name, 'No customer'), '/app/projects/' || p.id,
           similarity(p.number || ' ' || p.name, (select term from q))
    from projects p left join customers cu on cu.id = p.customer_id, q
    where q.term is not null and (p.number || ' ' || p.name) % q.term

    union all
    select 'customer', c.id, c.name, coalesce(c.city || ', ' || c.state_province, ''),
           '/app/crm', similarity(c.name, (select term from q))
    from customers c, q
    where q.term is not null and c.name % q.term

    union all
    select 'document', d.id, d.name, coalesce(d.discipline, d.document_type),
           '/app/plans', similarity(d.name, (select term from q))
    from documents d, q
    where q.term is not null and d.name % q.term and not d.is_superseded

    union all
    select 'service', s.id, s.name, coalesce(s.category, ''),
           '/app/libraries', similarity(s.name, (select term from q))
    from services s, q
    where q.term is not null and s.name % q.term

    union all
    select 'sheet', sh.id,
           coalesce(sh.sheet_number, 'p.' || sh.page_number) || ' — ' || coalesce(sh.sheet_title, 'Untitled'),
           coalesce(sh.discipline, ''), '/app/plans',
           similarity(coalesce(sh.sheet_number, '') || ' ' || coalesce(sh.sheet_title, ''), (select term from q))
    from document_sheets sh, q
    where q.term is not null
      and (coalesce(sh.sheet_number, '') || ' ' || coalesce(sh.sheet_title, '')) % q.term
  ) results
  order by results.rank desc nulls last
  limit greatest(1, least(p_limit, 100));
$$;

grant execute on function app.search(text, int) to authenticated;

comment on function app.search is
  'SECURITY INVOKER by design: every branch reads an RLS-protected table as the caller, so results are permission-filtered by construction rather than by a filter someone has to remember to apply.';
