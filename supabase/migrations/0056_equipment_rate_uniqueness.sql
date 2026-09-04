-- =============================================================================
-- 0056 — Two rates for one machine, and nothing to choose between them
--
-- @implements EDM-000022
--
-- `labor_rates` is unique per scope on its code and effective date — one global
-- index for platform rows, one per-company index for overrides. `equipment_rates`
-- has a lookup index on the same shape and it is **not unique**, so nothing has
-- ever prevented two active rates for the same machine, from the same source,
-- effective the same day, in the same scope. The estimating engine picks one.
--
-- Found by a test written to prove the deployment could load the seed twice.
-- The seed's equipment rate insert carried no `on conflict` at all, and adding
-- one did nothing: `on conflict do nothing` skips a row only when it violates a
-- unique constraint, and there was none — so a second run inserted a complete
-- duplicate set, 34 rates becoming 51. A deployment that ran twice would have
-- quietly doubled the equipment rate library.
--
-- The uniqueness is the real fix; the seed clause only works because of it.
-- =============================================================================

-- Anything already duplicated is collapsed to the row that arrived first, which
-- is the one any estimate priced against a snapshot will have pinned.
delete from equipment_rates a
using equipment_rates b
where a.id <> b.id
  and a.equipment_id  = b.equipment_id
  and a.source        = b.source
  and a.effective_date = b.effective_date
  and a.company_id is not distinct from b.company_id
  and (a.created_at, a.id) > (b.created_at, b.id);

create unique index equipment_rates_company_rate_idx
  on equipment_rates(company_id, equipment_id, source, effective_date)
  where company_id is not null;

create unique index equipment_rates_global_rate_idx
  on equipment_rates(equipment_id, source, effective_date)
  where company_id is null;

comment on index equipment_rates_global_rate_idx is
  'One platform rate per machine, per source, per effective date. Mirrors the constraint labor_rates has carried since 0004 — equipment rates had a lookup index of the same shape that was never unique, so a machine could hold two rates and the engine would price against whichever it read first.';

select app.assert_security_gates();
