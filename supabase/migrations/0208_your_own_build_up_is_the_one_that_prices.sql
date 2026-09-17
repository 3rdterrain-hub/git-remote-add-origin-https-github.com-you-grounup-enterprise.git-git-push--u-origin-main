-- =============================================================================
-- 0208 — Your own build-up is the one that prices
--
-- The shipped catalog carries 2,819 services, 914 assemblies and 8,604 assembly
-- components — and every one of those components is of kind `task`. There is no
-- labor, no equipment and no material anywhere in it. That is a deliberate,
-- honestly-labeled gap: every seeded production rate says
-- `source_type = 'seed_benchmark'` at an average confidence of 0.403, and the
-- equipment spread literally reads "Task-dependent approved spread".
--
-- Nothing in this migration invents a number to close that gap. A price nobody
-- can reproduce, applied to 2,545 services across every tenant, would be far
-- worse than the $0.00 it replaced: a zero is visibly wrong and gets caught, and
-- a plausible figure goes out on a bid.
--
-- What it fixes is the loop that lets a company close the gap for itself, which
-- did not close.
--
-- 0189 gave `save_line_buildup_to_library` the right behavior: a line built up
-- by hand is saved back, and a *catalog* assembly is copied into the company's
-- library first, because a catalog row is the row every tenant reads. That part
-- works.
--
-- But `line_resource_suggestions` (0126) looks up components through
-- `services.default_assembly_id` — and for a catalog service that column still
-- points at the catalog assembly, which holds only task rows. The company's own
-- copy, with their crew and their machines on it, was never consulted. So an
-- estimator built a service up, saved it for next time, came back, and was shown
-- nothing. Again. Exactly the shape this repository keeps producing: a reader
-- that does not follow the chain the writer just created.
--
-- The rule added here is the one RULE-003 already uses for rates, applied to
-- build-ups: **the most specific thing this company said wins.** Their own
-- assembly for the service if they have one; the shipped one otherwise.
--
-- LIBRARY.
-- =============================================================================

/**
 * The assembly whose components price a service, for one company.
 *
 * Their own copy first. A company that has built a service up once has said
 * something specific about how they do that work, and it outranks the shipped
 * template for the same reason a project quote outranks a regional rate.
 *
 * Ordered by `updated_at` so the most recently worked-on copy wins where a
 * company somehow has two — deterministic rather than whichever the planner
 * happened to return.
 */
create or replace function app.assembly_for_pricing(p_service uuid, p_company uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    (select a.id
       from assemblies a
      where a.service_id = p_service
        and a.company_id = p_company
        and a.status <> 'retired'
        and exists (select 1 from assembly_components ac
                     where ac.assembly_id = a.id
                       and ac.component_kind in ('labor','equipment','material','trucking'))
      order by a.updated_at desc
      limit 1),
    (select s.default_assembly_id from services s where s.id = p_service));
$$;

comment on function app.assembly_for_pricing(uuid, uuid) is
  'The assembly whose components price a service for one company: their own build-up where they have one, the shipped template otherwise. LIBRARY: the same precedence RULE-003 uses for rates — the most specific thing this company said about the work wins.';

/**
 * What a line could be built from, and what it would cost.
 *
 * Unchanged from 0126 except for where the components come from: the assembly
 * is now resolved per company rather than read straight off the service. A
 * company that has never built the service up sees exactly what they saw
 * before, because `assembly_for_pricing` falls through to the same column.
 */
create or replace function app.line_resource_suggestions(p_line uuid)
returns table (
  resource_kind    text,
  resource_id      uuid,
  name             text,
  quantity_per_unit numeric,
  quantity         numeric,
  unit             app.unit_code,
  unit_rate        numeric,
  extended_cost    numeric,
  is_optional      boolean,
  already_on_line  boolean
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with line as (
    select l.id, l.company_id, l.service_id,
           greatest(coalesce(nullif(l.gross_quantity, 0), l.measured_quantity), 0) as qty,
           app.assembly_for_pricing(l.service_id, l.company_id) as assembly_id
    from estimate_line_items l
    where l.id = p_line
  ),
  parts as (
    select
      ac.component_kind::text as kind,
      coalesce(ac.labor_rate_id, ac.equipment_id, ac.material_id) as ref,
      ac.quantity_per_unit,
      ac.unit,
      ac.is_optional,
      ac.sort_order
    from line
    join assembly_components ac on ac.assembly_id = line.assembly_id
    where ac.component_kind in ('labor', 'equipment', 'material', 'trucking')
      and (ac.company_id = line.company_id or ac.company_id is null)
  )
  select
    p.kind,
    p.ref,
    coalesce(lr.classification, eq.name, m.name, 'Unnamed'),
    p.quantity_per_unit,
    round(p.quantity_per_unit * line.qty, 4),
    coalesce(p.unit, m.unit, 'LS')::app.unit_code,
    coalesce(lr.burdened_cost_per_hour, eqr.hourly_rate, m.unit_cost, 0),
    round(p.quantity_per_unit * line.qty
          * coalesce(lr.burdened_cost_per_hour, eqr.hourly_rate, m.unit_cost, 0), 2),
    p.is_optional,
    exists (
      select 1 from estimate_line_resources r
      where r.line_item_id = p_line and r.resource_kind = p.kind
        and (r.labor_rate_id = p.ref or r.equipment_id = p.ref or r.material_id = p.ref))
  from parts p
  cross join line
  left join labor_rates lr on lr.id = p.ref and p.kind = 'labor'
  left join equipment  eq on eq.id = p.ref and p.kind = 'equipment'
  left join materials  m  on m.id  = p.ref and p.kind = 'material'
  left join lateral (
    select er.hourly_rate
      from equipment_rates er
     where er.equipment_id = p.ref and p.kind = 'equipment'
       and er.effective_date <= current_date
       and (er.expires_on is null or er.expires_on > current_date)
     order by case er.source
                when 'project_quote'  then 1
                when 'tenant_approved' then 2
                when 'regional'        then 3
                else 4 end,
              er.effective_date desc
     limit 1) eqr on true
  order by p.sort_order, p.kind;
$$;

select app.assert_security_gates();
