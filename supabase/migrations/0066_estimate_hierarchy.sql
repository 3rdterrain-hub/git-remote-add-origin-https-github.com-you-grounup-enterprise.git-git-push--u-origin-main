-- =============================================================================
-- 0066 — Building an estimate from the top down
--
-- `estimate_line_items.parent_line_id` has existed since migration 0006. Every
-- revision since has faithfully copied it and re-parented the children, and
-- nothing has ever computed with it: the engine takes a flat list, so the
-- hierarchy was stored, carried forward, and meant nothing.
--
-- That left one way to build an estimate — one priced line at a time, from the
-- bottom — which is how an estimate is finished rather than how one is started.
-- A bid begins as a shape: forty lots, a mile of roadway, four buildings. The
-- quantities follow from the shape.
--
-- Three columns and two rules make that real:
--
--   * **`quantity_basis`** says where a line's quantity comes from. `measured`
--     is what every line did before. `per_parent_unit` is answered by the
--     parent — two catch basins per lot — so changing forty lots to sixty
--     changes everything beneath it without anybody retyping a number.
--   * **`parametric_cost_per_unit`** prices a line at a rate instead of
--     building it up, which is what an estimate is before there are drawings.
--     It must name where the rate came from, and it must carry
--     `estimator_allowance` — the weakest method on the scale — so the
--     confidence engine and the approval gate treat a rate per square foot as
--     what it is. A conceptual number that scored like a measured one would be
--     the most expensive thing this platform could get wrong.
--   * **The tree must be a tree.** Nothing stopped a line from being its own
--     grandparent, which would have hung the roll-up rather than producing a
--     wrong number — bad in a different way.
--
-- Deliberately absent: a quantity that is a percentage of the parent's *cost*.
-- It sounds symmetrical and is not — cost is not known until the subtree is
-- priced, so the quantity would depend on the price it is used to compute.
-- Percentage-of-cost belongs to indirects, where the estimate-level arithmetic
-- already handles it without the circularity.
-- =============================================================================

alter table estimate_line_items
  add column if not exists quantity_basis text not null default 'measured'
    check (quantity_basis in ('measured', 'per_parent_unit')),
  add column if not exists per_parent_unit numeric(18,6)
    check (per_parent_unit is null or per_parent_unit > 0),
  add column if not exists parametric_cost_per_unit numeric(16,4)
    check (parametric_cost_per_unit is null or parametric_cost_per_unit >= 0),
  add column if not exists parametric_basis text;

comment on column estimate_line_items.quantity_basis is
  'Where this line''s quantity comes from. measured: entered or taken off, as every line worked before. per_parent_unit: answered by the parent, so the shape of the job drives the quantities beneath it.';

comment on column estimate_line_items.parametric_cost_per_unit is
  'A rate this line is priced at rather than built up from resources — what an estimate is before there are drawings. Requires parametric_basis, and forces measurement_method to estimator_allowance so the number is scored as the judgment it is.';

-- A driven line needs a parent to be driven by, and a factor to be driven with.
alter table estimate_line_items drop constraint if exists eli_driven_quantity;
alter table estimate_line_items
  add constraint eli_driven_quantity
    check (quantity_basis <> 'per_parent_unit'
           or (parent_line_id is not null and per_parent_unit is not null));

-- An unattributable rate is a guess, and a guess that looks like a price is the
-- most expensive thing an estimate can carry.
alter table estimate_line_items drop constraint if exists eli_parametric_basis;
alter table estimate_line_items
  add constraint eli_parametric_basis
    check (parametric_cost_per_unit is null
           or (parametric_basis is not null and length(trim(parametric_basis)) >= 3));

/*
 * A rate-priced line is an allowance, and the database says so rather than
 * trusting an application to remember. `measurement_method` is an estimator
 * input rather than an engine output, so nothing else would have stopped a
 * conceptual line being labeled as an explicit dimension and sailing through
 * the approval gate that the label decides.
 */
alter table estimate_line_items drop constraint if exists eli_parametric_is_an_allowance;
alter table estimate_line_items
  add constraint eli_parametric_is_an_allowance
    check (parametric_cost_per_unit is null
           or measurement_method = 'estimator_allowance');

/**
 * The line structure has to be a tree.
 *
 * Nothing prevented a cycle. A cycle does not produce a wrong total — it hangs
 * the roll-up, which is worse in a way that is harder to notice in a test and
 * impossible to miss in production.
 *
 * Walks upward from the new parent, which is bounded by the depth of the tree
 * rather than its size, and stops at a depth no estimate legitimately reaches.
 */
create or replace function app.enforce_line_acyclic()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_cursor uuid := new.parent_line_id;
  v_depth  int := 0;
begin
  if v_cursor is null then return new; end if;

  while v_cursor is not null loop
    if v_cursor = new.id then
      raise exception 'That would make "%" its own ancestor', new.description
        using errcode = 'check_violation';
    end if;
    v_depth := v_depth + 1;
    if v_depth > 32 then
      raise exception 'Estimate lines are nested more than 32 deep, which is a loop or a mistake'
        using errcode = 'check_violation';
    end if;
    select parent_line_id into v_cursor from estimate_line_items where id = v_cursor;
  end loop;

  return new;
end;
$$;

drop trigger if exists estimate_line_items_acyclic on estimate_line_items;
create trigger estimate_line_items_acyclic
  before insert or update of parent_line_id on estimate_line_items
  for each row execute function app.enforce_line_acyclic();

comment on function app.enforce_line_acyclic() is
  'Keeps the estimate line structure a tree. A cycle does not produce a wrong number; it hangs the roll-up, which is harder to notice and worse to meet in production.';

/*
 * A line priced at a rate cannot also have work beneath it: it is one or the
 * other, and allowing both would count the rate and the children.
 *
 * Enforced on the child rather than the parent, because that is where the
 * relationship is created, and checked again when a rate is set on a line that
 * already has children.
 */
create or replace function app.enforce_parametric_is_a_leaf()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_table_name = 'estimate_line_items' and new.parent_line_id is not null then
    if exists (select 1 from estimate_line_items p
               where p.id = new.parent_line_id and p.parametric_cost_per_unit is not null) then
      raise exception
        'The parent line is priced at a rate, so it cannot also have lines beneath it'
        using errcode = 'check_violation',
              hint = 'Remove the rate from the parent, or attach this line elsewhere.';
    end if;
  end if;

  if new.parametric_cost_per_unit is not null
     and exists (select 1 from estimate_line_items c where c.parent_line_id = new.id) then
    raise exception
      'This line has work beneath it, so it cannot also be priced at a rate'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists estimate_line_items_parametric_leaf on estimate_line_items;
create trigger estimate_line_items_parametric_leaf
  before insert or update of parent_line_id, parametric_cost_per_unit
  on estimate_line_items
  for each row execute function app.enforce_parametric_is_a_leaf();

/**
 * An estimate's lines as a tree, with each line's place in it.
 *
 * Depth and path are derived by walking the parents, so they cannot drift from
 * the structure the way stored copies would. `is_rollup` says whether anything
 * hangs beneath a line, which is what decides whether its own cost or its
 * subtree's cost is the number a reader wants.
 */
create or replace view reporting_estimate_structure
with (security_invoker = true) as
with recursive tree as (
  select
    l.id, l.estimate_version_id, l.company_id, l.parent_line_id,
    l.description, l.unit, l.sort_order,
    l.quantity_basis, l.per_parent_unit,
    l.measured_quantity, l.gross_quantity, l.total_direct_cost,
    l.parametric_cost_per_unit, l.parametric_basis,
    0 as depth,
    array[lpad(l.sort_order::text, 6, '0')] as sort_path,
    array[l.description] as path
  from estimate_line_items l
  where l.parent_line_id is null

  union all

  select
    c.id, c.estimate_version_id, c.company_id, c.parent_line_id,
    c.description, c.unit, c.sort_order,
    c.quantity_basis, c.per_parent_unit,
    c.measured_quantity, c.gross_quantity, c.total_direct_cost,
    c.parametric_cost_per_unit, c.parametric_basis,
    t.depth + 1,
    t.sort_path || lpad(c.sort_order::text, 6, '0'),
    t.path || c.description
  from estimate_line_items c
  join tree t on t.id = c.parent_line_id
  where t.depth < 32
)
select
  t.*,
  exists (select 1 from estimate_line_items k where k.parent_line_id = t.id) as is_rollup,
  -- The subtree total: this line's own direct cost plus everything beneath it.
  (select coalesce(sum(d.total_direct_cost), 0)
     from estimate_line_items d
    where d.id = t.id
       or d.parent_line_id = t.id) as immediate_cost
from tree t;

comment on view reporting_estimate_structure is
  'Estimate lines as a tree, with depth and path derived by walking the parents rather than stored — so they cannot drift from the structure. Bounded at 32 levels, which no estimate legitimately reaches and a loop would exceed immediately.';

grant select on reporting_estimate_structure to authenticated;
revoke all on reporting_estimate_structure from anon;

select app.assert_security_gates();
