-- =============================================================================
-- 0214 — A search that finds the thing you named
--
-- `app.search` has existed since migration 0019 and is reached by the search bar
-- in the shell. It gates every branch on the trigram operator `%`:
--
--     where (e.number || ' ' || e.name) % q.term
--
-- `%` compares the similarity of two whole strings. It is the right operator for
-- "did they misspell this name", and the wrong one for "does this record contain
-- the word they typed" — because the longer the title, the lower the similarity
-- of any one word inside it. Measured against this database:
--
--     "Sandusky"     1 hit     "Auburn"     0 hits
--     "grading"     12 hits    "San"        0 hits
--
-- `E-2026-0005 Auburn Ave site package — mass grading and storm` is a real
-- estimate in this company. Searching for Auburn did not find it. Searching for
-- the first three letters of Sandusky did not find Sandusky. A person typing the
-- name of their own project got an empty dropdown, which is indistinguishable
-- from having no such project.
--
-- Two changes:
--
--   * **Containment is the predicate; similarity is the ranking.** A record
--     whose text contains what was typed always matches, wherever in the string
--     it falls. Trigram similarity is kept so a near-miss still surfaces, but it
--     is no longer the gate.
--   * **Nine kinds, because nine are advertised.** `KIND_LABEL` in the shell has
--     always listed asset, employee and purchase order alongside the six this
--     function returned, and the demonstration dataset returns them. So a live
--     workspace could not find an asset by its number — `EX-4412`, the example
--     the owner gave for what a reference should do — while the sample data
--     could. Those three branches are added here.
--
-- Trigram indexes are added for the four searched tables that lacked them.
-- ENGINE.
-- =============================================================================

create extension if not exists pg_trgm;

/**
 * How well a haystack answers what somebody typed.
 *
 * Ordered by what a person means rather than by arithmetic: something that
 * *starts* with what they typed is what they were reaching for; something that
 * begins a word with it is next; a match anywhere in the middle after that; and
 * only then a fuzzy near-miss, which is what trigram similarity is actually
 * good at.
 *
 * STABLE rather than IMMUTABLE: `similarity` depends on
 * `pg_trgm.similarity_threshold`, which is a session setting.
 */
create or replace function app.search_rank(p_haystack text, p_term text)
returns real
language sql stable parallel safe set search_path = public, pg_catalog
as $$
  select case
    when p_haystack is null or p_term is null then 0::real
    when position(lower(p_term) in lower(p_haystack)) = 1 then 1.0::real
    /* The start of a word inside it — "Ave" in "Auburn Ave", "0005" in
       "E-2026-0005". Hyphen counts, because record numbers are full of them. */
    when position(' ' || lower(p_term) in lower(p_haystack)) > 0
      or position('-' || lower(p_term) in lower(p_haystack)) > 0 then 0.9::real
    when position(lower(p_term) in lower(p_haystack)) > 0 then 0.75::real
    else similarity(p_haystack, p_term)
  end;
$$;

comment on function app.search_rank(text, text) is
  'Ranks a search hit the way a person means it: starts-with, then start-of-word, then contains, then trigram similarity for a near-miss. ENGINE.';

/**
 * Enterprise search across the nine kinds the shell can render.
 *
 * SECURITY INVOKER, as before and for the same reason: every branch reads an
 * RLS-protected table as the caller, so results are permission-filtered by
 * construction rather than by a filter somebody has to remember to apply. A
 * search index maintained outside the permission model is the classic way a
 * platform leaks one tenant's records to another through autocomplete.
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
           app.search_rank(e.number || ' ' || e.name, (select term from q)) as rank
    from estimates e left join customers c on c.id = e.customer_id, q
    where q.term is not null
      and (e.number ilike '%' || q.term || '%'
        or e.name ilike '%' || q.term || '%'
        or (e.number || ' ' || e.name) % q.term)

    union all
    select 'project', p.id, p.number || ' — ' || p.name,
           coalesce(cu.name, 'No customer'), '/app/projects/' || p.id,
           app.search_rank(p.number || ' ' || p.name, (select term from q))
    from projects p left join customers cu on cu.id = p.customer_id, q
    where q.term is not null
      and (p.number ilike '%' || q.term || '%'
        or p.name ilike '%' || q.term || '%'
        or (p.number || ' ' || p.name) % q.term)

    union all
    select 'customer', c.id, c.name,
           coalesce(c.city || ', ' || c.state_province, ''),
           '/app/crm', app.search_rank(c.name, (select term from q))
    from customers c, q
    where q.term is not null
      and (c.name ilike '%' || q.term || '%' or c.name % q.term)

    union all
    select 'document', d.id, d.name, coalesce(d.discipline, d.document_type),
           '/app/plans', app.search_rank(d.name, (select term from q))
    from documents d, q
    where q.term is not null and not d.is_superseded
      and (d.name ilike '%' || q.term || '%' or d.name % q.term)

    union all
    select 'service', s.id, s.name, coalesce(s.category, ''),
           '/app/libraries', app.search_rank(s.name, (select term from q))
    from services s, q
    where q.term is not null
      and (s.name ilike '%' || q.term || '%' or s.name % q.term)

    union all
    select 'sheet', sh.id,
           coalesce(sh.sheet_number, 'p.' || sh.page_number) || ' — '
             || coalesce(sh.sheet_title, 'Untitled'),
           coalesce(sh.discipline, ''), '/app/plans',
           app.search_rank(coalesce(sh.sheet_number, '') || ' '
             || coalesce(sh.sheet_title, ''), (select term from q))
    from document_sheets sh, q
    where q.term is not null
      and (sh.sheet_number ilike '%' || q.term || '%'
        or sh.sheet_title ilike '%' || q.term || '%'
        or (coalesce(sh.sheet_number, '') || ' ' || coalesce(sh.sheet_title, '')) % q.term)

    /*
     * The three the shell has always been able to render and this function has
     * never returned. `EX-4412` is the owner's own example of a reference that
     * should be findable, and until now it was findable only in the sample data.
     */
    union all
    select 'asset', a.id, a.asset_number || ' — ' || a.name,
           btrim(coalesce(a.make, '') || ' ' || coalesce(a.model, '')),
           '/app/fleet',
           app.search_rank(a.asset_number || ' ' || a.name || ' '
             || coalesce(a.make, '') || ' ' || coalesce(a.model, ''), (select term from q))
    from assets a, q
    where q.term is not null
      and (a.asset_number ilike '%' || q.term || '%'
        or a.name ilike '%' || q.term || '%'
        or a.make ilike '%' || q.term || '%'
        or a.model ilike '%' || q.term || '%'
        or (a.asset_number || ' ' || a.name) % q.term)

    union all
    select 'employee', em.id, em.full_name,
           coalesce(em.classification, ''), '/app/workforce',
           app.search_rank(em.full_name || ' ' || coalesce(em.employee_number, ''),
             (select term from q))
    from employees em, q
    where q.term is not null
      and (em.full_name ilike '%' || q.term || '%'
        or em.employee_number ilike '%' || q.term || '%'
        or em.classification ilike '%' || q.term || '%'
        or em.full_name % q.term)

    union all
    select 'purchase_order', po.id, po.number || ' — ' || po.title,
           coalesce(v.name, ''), '/app/procurement',
           app.search_rank(po.number || ' ' || po.title, (select term from q))
    from purchase_orders po left join vendors v on v.id = po.vendor_id, q
    where q.term is not null
      and (po.number ilike '%' || q.term || '%'
        or po.title ilike '%' || q.term || '%'
        or (po.number || ' ' || po.title) % q.term)
  ) results
  /* Title breaks a tie, so the same query returns the same order every time —
     a dropdown whose entries move between identical searches is unusable. */
  order by results.rank desc nulls last, results.title
  limit greatest(1, least(p_limit, 100));
$$;

grant execute on function app.search(text, int) to authenticated;

comment on function app.search is
  'SECURITY INVOKER by design: every branch reads an RLS-protected table as the caller, so results are permission-filtered by construction rather than by a filter someone has to remember to apply. Matches on containment and ranks by position, with trigram similarity kept for a near-miss rather than used as the gate. ENGINE.';

-- -----------------------------------------------------------------------------
-- The indexes the searched columns were missing
-- -----------------------------------------------------------------------------
/*
 * Seven of the searched tables already carried a trigram index; these four did
 * not, and `ilike '%term%'` cannot use an ordinary btree at all. Small today —
 * eight estimates — and a sequential scan per keystroke is not something to
 * leave in place for the company that has forty thousand purchase orders.
 */
create index if not exists estimates_search_idx
  on estimates using gin ((number || ' ' || name) gin_trgm_ops);
create index if not exists projects_search_idx
  on projects using gin ((number || ' ' || name) gin_trgm_ops);
create index if not exists assets_search_idx
  on assets using gin ((asset_number || ' ' || name) gin_trgm_ops);
create index if not exists purchase_orders_search_idx
  on purchase_orders using gin ((number || ' ' || title) gin_trgm_ops);
