-- =============================================================================
-- 0100 — An assembly lists a thing once
--
-- Migration 0056 found that `equipment_rates` had a lookup index of the right
-- shape that was never unique, so a machine could carry two identical rates and
-- the engine priced against whichever it read first. It recorded the lesson in
-- its own header: `on conflict do nothing` skips a row only when it violates a
-- unique constraint, so without the constraint the clause is decoration.
--
-- `assembly_components` has the same hole and now matters, because 0099's seed
-- fills it: 2,783 rows saying which tasks each service is made of. Nothing
-- stopped an assembly from listing the same task twice, which would double that
-- task's hours and cost in every estimate priced from it — quietly, since a
-- duplicate line reads as a real one.
--
-- The uniqueness is the fix. The seed's conflict clause only works because of it.
-- =============================================================================

-- Anything already duplicated collapses to the row that arrived first, which is
-- the one any snapshot taken so far has pinned.
delete from assembly_components a
using assembly_components b
where a.id <> b.id
  and a.assembly_id = b.assembly_id
  and a.component_kind = b.component_kind
  and a.task_id            is not distinct from b.task_id
  and a.labor_rate_id      is not distinct from b.labor_rate_id
  and a.equipment_id       is not distinct from b.equipment_id
  and a.material_id        is not distinct from b.material_id
  and a.nested_assembly_id is not distinct from b.nested_assembly_id
  and (a.created_at, a.id) > (b.created_at, b.id);

/*
 * One index per kind rather than one over every reference column, because the
 * columns are mutually exclusive by the table's own check constraint and a
 * single index over all of them would treat two rows that differ only in which
 * null they carry as distinct.
 *
 * 'subcontract' and 'trucking' reference nothing, so an assembly may legitimately
 * carry more than one of each — a bid with two subcontract allowances is normal.
 * They are deliberately left out.
 */
create unique index assembly_components_task_idx
  on assembly_components(assembly_id, task_id) where component_kind = 'task';
create unique index assembly_components_labor_idx
  on assembly_components(assembly_id, labor_rate_id) where component_kind = 'labor';
create unique index assembly_components_equipment_idx
  on assembly_components(assembly_id, equipment_id) where component_kind = 'equipment';
create unique index assembly_components_material_idx
  on assembly_components(assembly_id, material_id) where component_kind = 'material';
create unique index assembly_components_nested_idx
  on assembly_components(assembly_id, nested_assembly_id) where component_kind = 'assembly';

comment on index assembly_components_task_idx is
  'One entry per task per assembly. Without it a seed replay or a double-click doubles the task''s hours and cost in every estimate priced from the assembly, and the duplicate reads as a real line.';

select app.assert_security_gates();
