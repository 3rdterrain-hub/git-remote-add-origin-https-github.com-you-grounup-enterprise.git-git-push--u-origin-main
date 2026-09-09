-- =============================================================================
-- 0138 — What a line sells for
--
-- An estimate line had a cost and no price, and the markup typed on it did
-- nothing at all.
--
-- `markup_override` has been a column since migration 0107, the line editors
-- have written to it, and its comment says exactly what it is for: "this line's
-- own markup as a fraction, or null to use the pricing profile. A line that
-- differs from the company standard is the estimator's judgment about that
-- scope." The estimating engine never read it. Not in `EstimateLineInput`, not
-- in the pricing function, not in the columns the Edge Function selects. An
-- estimator could set a line to 40% and the bid would come back to the cent
-- exactly what it was before.
--
-- That is the same shape as the labor hours in 0000-something and the field
-- name in 0136: a control that takes a value, reports success, and changes
-- nothing. This one had the largest consequence of the three, because the
-- number it silently discarded was margin.
--
-- So the engine reads it, and these columns hold what comes back:
--
--   * `markup_rate` — what this line was actually marked up at, whether that
--     came from the line or from the profile. Stored rather than derived so a
--     reopened estimate says what it was priced at rather than what today's
--     profile would say.
--   * `markup_amount` and `total_price` — the money.
--   * `unit_price` — the price per unit, beside the unit cost, which is the
--     pair an estimator reads across.
--
-- Written by the engine, so they are refused by hand like every other computed
-- column: migration 0058 made that the rule, and a price somebody typed is a
-- price nobody can reproduce.
--
-- **The lines add up to the bid, to the cent.** The engine allocates the last
-- cents by largest remainder rather than rounding each line and hoping. A bid
-- that disagrees with the lines it is made of is the one thing an estimator
-- cannot explain to a customer.
-- =============================================================================

alter table estimate_line_items
  add column if not exists markup_rate   numeric(10,6) not null default 0
    check (markup_rate >= 0),
  add column if not exists markup_amount numeric(18,2) not null default 0,
  add column if not exists total_price   numeric(18,2) not null default 0,
  add column if not exists unit_price    numeric(14,4) not null default 0;

comment on column estimate_line_items.markup_rate is
  'What this line was marked up at, as a fraction — from markup_override when the estimator set one, otherwise the share the pricing profile put on it. Stored rather than derived, so reopening an estimate says what it was priced at rather than what today profile would say.';
comment on column estimate_line_items.markup_amount is
  'The money between this line cost and its price.';
comment on column estimate_line_items.total_price is
  'What this line sells for. The prices of every line on a version sum exactly to the version total_price; the engine allocates the last cents rather than rounding them away.';
comment on column estimate_line_items.unit_price is
  'Price per unit, which is the figure a customer sees on a unit-price bid and the one an estimator reads against unit_cost.';

/*
 * Engine output, so it may not be written by hand. The same rule and the same
 * mechanism as migration 0058: a price a person typed is a price nobody can
 * reproduce, and an estimate whose numbers cannot be reproduced is not an
 * estimate.
 */
drop trigger if exists estimate_line_items_engine_outputs on estimate_line_items;
create trigger estimate_line_items_engine_outputs
  before insert or update on estimate_line_items
  for each row execute function app.guard_engine_outputs(
    'adjusted_quantity', 'gross_quantity',
    'theoretical_production', 'practical_production', 'recommended_production',
    'productive_hours', 'practical_days',
    'cost_labor_wage', 'cost_labor_burden', 'cost_equipment', 'cost_equipment_mob',
    'cost_fuel', 'cost_material', 'cost_trucking', 'cost_disposal',
    'cost_subcontract', 'cost_other', 'total_direct_cost', 'unit_cost',
    'labor_hours', 'equipment_hours', 'fuel_gallons',
    'confidence_score', 'confidence_band', 'verification_status',
    'approval_gate', 'blocks_issue', 'derivation', 'warnings',
    /* New, and guarded for the same reason as every line above it. */
    'markup_rate', 'markup_amount', 'total_price', 'unit_price');

select app.assert_security_gates();
