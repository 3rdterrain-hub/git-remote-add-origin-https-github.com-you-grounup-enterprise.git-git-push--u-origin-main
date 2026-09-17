-- =============================================================================
-- 0209 — The equipment rate stays inside the company that owns it
--
-- 0208 rewrote `line_resource_suggestions` by hand and, in retyping the
-- equipment-rate lateral, dropped one line from it:
--
--     and (er.company_id = line.company_id or er.company_id is null)
--
-- That is a tenancy filter. Without it the rate chosen for a machine could have
-- come from another company's rate sheet — a wrong number on a bid, sourced from
-- somebody else's books, with nothing on screen to show it.
--
-- Nothing was priced through it: 0208 and this migration are minutes apart and
-- the function is only reached from the estimate line. But the lesson is the one
-- this repository keeps relearning, so it is written down rather than quietly
-- corrected: **a function that prices is not retyped.** The body below is 0126's
-- text with exactly two substitutions applied to it programmatically — the
-- assembly is resolved per company, and the join follows that instead of
-- `services.default_assembly_id`. Everything else, including RULE-003's
-- ordering and its tenant filter, is the original character for character.
-- =============================================================================

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
           /*
            * Their own build-up where they have one, the shipped template
            * otherwise. The only change from 0126, and the reason a service
            * built up once now prices every time afterwards.
            */
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
  /*
   * The machine's rate, under RULE-003's precedence: a quote for this project
   * beats a rate the company approved, which beats a regional one, which beats
   * the platform's seed. Every candidate is kept in `equipment_rates` so an
   * estimate can show what was overridden; this picks the winner the same way
   * the pricing engine does rather than inventing a second ordering.
   */
  left join lateral (
    select er.hourly_rate
    from equipment_rates er
    where p.kind = 'equipment' and er.equipment_id = p.ref
      and (er.company_id = line.company_id or er.company_id is null)
      and er.effective_date <= current_date
      and (er.expires_on is null or er.expires_on > current_date)
    order by array_position(
               array['project_quote','tenant_approved','regional','global_seed']::app.rate_source[],
               er.source),
             er.effective_date desc
    limit 1
  ) eqr on true
  order by p.sort_order, p.kind;
$$;

select app.assert_security_gates();
