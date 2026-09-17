-- =============================================================================
-- 0215 — Your own work outranks the catalog
--
-- 0214 made search find things by containment, which was the fix it needed. It
-- also made a second problem visible that the old behavior had been hiding:
--
--     search('grading', 12)  →  12 services, 0 estimates
--
-- The shipped catalog is 2,820 services. Any ordinary construction word matches
-- dozens of them, and they filled the dropdown completely — while
-- `E-2026-0005 Auburn Ave site package — mass grading and storm`, an estimate
-- belonging to the person typing, did not appear at all. A search that cannot
-- surface your own live bid under the word it is named after is not usable,
-- however correct each individual row is.
--
-- So a hit is scored by what it is as well as how well it matches:
--
--   * **1.00 — your operational records.** Estimates, projects, customers,
--     documents, sheets, assets, people, purchase orders. Things this company
--     made, which is nearly always what somebody is reaching for.
--   * **0.90 — your own library.** A service this company added or customized
--     is theirs and is ranked as such.
--   * **0.55 — the shipped catalog.** Reference material. Worth finding, never
--     worth burying a live bid under.
--
-- Multiplied rather than ordered in tiers, deliberately: a tier sort would put a
-- vague 0.3 trigram guess at an estimate above a perfect match on a catalog
-- service, which is the same failure pointing the other way. Multiplied, an
-- exact catalog hit (1.00 × 0.55) still beats a weak fuzzy record hit (0.30),
-- and an equal text match on your own work always wins.
--
-- ENGINE.
-- =============================================================================

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
  select results.kind, results.id, results.title, results.subtitle, results.path,
         (results.rank * results.weight)::real as rank
    from (
    select 'estimate'::text as kind, e.id as id,
           (e.number || ' — ' || e.name) as title,
           coalesce(c.name, 'No customer') as subtitle,
           ('/app/estimates/' || e.id) as path,
           app.search_rank(e.number || ' ' || e.name, (select term from q)) as rank,
           1.0::real as weight
    from estimates e left join customers c on c.id = e.customer_id, q
    where q.term is not null
      and (e.number ilike '%' || q.term || '%'
        or e.name ilike '%' || q.term || '%'
        or (e.number || ' ' || e.name) % q.term)

    union all
    select 'project', p.id, p.number || ' — ' || p.name,
           coalesce(cu.name, 'No customer'), '/app/projects/' || p.id,
           app.search_rank(p.number || ' ' || p.name, (select term from q)), 1.0
    from projects p left join customers cu on cu.id = p.customer_id, q
    where q.term is not null
      and (p.number ilike '%' || q.term || '%'
        or p.name ilike '%' || q.term || '%'
        or (p.number || ' ' || p.name) % q.term)

    union all
    select 'customer', c.id, c.name,
           coalesce(c.city || ', ' || c.state_province, ''),
           '/app/crm', app.search_rank(c.name, (select term from q)), 1.0
    from customers c, q
    where q.term is not null
      and (c.name ilike '%' || q.term || '%' or c.name % q.term)

    union all
    select 'document', d.id, d.name, coalesce(d.discipline, d.document_type),
           '/app/plans', app.search_rank(d.name, (select term from q)), 1.0
    from documents d, q
    where q.term is not null and not d.is_superseded
      and (d.name ilike '%' || q.term || '%' or d.name % q.term)

    /*
     * The one branch whose weight is not fixed. A service with a company on it
     * is something this company added or made its own — 0198's `customize_*`
     * and `adopt_library_row` — and it is ranked as their work. A service with
     * no company is the shipped catalog.
     */
    union all
    select 'service', s.id, s.name, coalesce(s.category, ''),
           '/app/libraries', app.search_rank(s.name, (select term from q)),
           case when s.company_id is not null then 0.9::real else 0.55::real end
    from services s, q
    where q.term is not null
      and (s.name ilike '%' || q.term || '%' or s.name % q.term)

    union all
    select 'sheet', sh.id,
           coalesce(sh.sheet_number, 'p.' || sh.page_number) || ' — '
             || coalesce(sh.sheet_title, 'Untitled'),
           coalesce(sh.discipline, ''), '/app/plans',
           app.search_rank(coalesce(sh.sheet_number, '') || ' '
             || coalesce(sh.sheet_title, ''), (select term from q)), 1.0
    from document_sheets sh, q
    where q.term is not null
      and (sh.sheet_number ilike '%' || q.term || '%'
        or sh.sheet_title ilike '%' || q.term || '%'
        or (coalesce(sh.sheet_number, '') || ' ' || coalesce(sh.sheet_title, '')) % q.term)

    union all
    select 'asset', a.id, a.asset_number || ' — ' || a.name,
           btrim(coalesce(a.make, '') || ' ' || coalesce(a.model, '')),
           '/app/fleet',
           app.search_rank(a.asset_number || ' ' || a.name || ' '
             || coalesce(a.make, '') || ' ' || coalesce(a.model, ''), (select term from q)), 1.0
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
             (select term from q)), 1.0
    from employees em, q
    where q.term is not null
      and (em.full_name ilike '%' || q.term || '%'
        or em.employee_number ilike '%' || q.term || '%'
        or em.classification ilike '%' || q.term || '%'
        or em.full_name % q.term)

    union all
    select 'purchase_order', po.id, po.number || ' — ' || po.title,
           coalesce(v.name, ''), '/app/procurement',
           app.search_rank(po.number || ' ' || po.title, (select term from q)), 1.0
    from purchase_orders po left join vendors v on v.id = po.vendor_id, q
    where q.term is not null
      and (po.number ilike '%' || q.term || '%'
        or po.title ilike '%' || q.term || '%'
        or (po.number || ' ' || po.title) % q.term)
  ) results
  order by (results.rank * results.weight) desc nulls last, results.title
  limit greatest(1, least(p_limit, 100));
$$;

comment on function app.search is
  'SECURITY INVOKER by design: every branch reads an RLS-protected table as the caller, so results are permission-filtered by construction. Matches on containment, ranks by position, and weights this company''s own records above the shipped catalog so a live bid is not buried under 2,820 seeded services. ENGINE.';
