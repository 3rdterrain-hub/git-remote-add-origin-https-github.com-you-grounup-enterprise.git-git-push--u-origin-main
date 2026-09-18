-- =============================================================================
-- 0216 — A task knows what trade it belongs to
--
-- The owner, looking at the Tasks tab: "what is task category showing."
--
-- It was showing `Support` for 7,161 of 8,532 tasks and `Production` for the
-- other 1,371 — which is a real distinction and the wrong one to navigate by.
-- That field says whether a task is the productive work or the work around it,
-- and it is what decides whether a task carries a production rate. It is not a
-- trade, and there is nothing else on a task that is.
--
-- So the Tasks tab could not be browsed the way Services can, where five real
-- categories divide 2,820 rows.
--
-- **The trade is not typed. It is read from what already uses the task.** A task
-- sits in an assembly; an assembly is a service's build-up; a service carries a
-- category. Measured before writing this:
--
--     8,532 tasks
--     8,499 reachable from a service
--     8,459 resolving to exactly one category   (99.1%)
--
-- Inventing a trade for 8,532 rows would be the largest invented-data exercise
-- in this repository. Deriving one from the catalog's own structure invents
-- nothing: it states a relationship that is already there.
--
-- **Derived on read rather than stored**, for the same reason the totals in this
-- schema are recomputed rather than incremented. A stored trade would be right
-- on the day it was written and wrong the first time somebody moved a task into
-- a different assembly, with nothing to notice. A view cannot drift.
--
-- **The 73 that do not resolve are left null and say why**, rather than being
-- given the alphabetically-first guess:
--
--     ambiguous — used by services in more than one trade
--     unused    — in no service's build-up at all
--
-- LIBRARY.
-- =============================================================================

create or replace view my_library_tasks
with (security_invoker = true) as
with used_by as (
  /*
   * One pass over the components rather than a lookup per task. `task_id` is
   * indexed and `services.default_assembly_id` is the join the catalog is
   * already built around.
   */
  select ac.task_id,
         count(distinct s.category) filter (where s.category is not null) as trades,
         min(s.category)                                                  as only_trade,
         count(distinct s.id)                                             as services_using
    from assembly_components ac
    join services s on s.default_assembly_id = ac.assembly_id
   where ac.task_id is not null
   group by ac.task_id
)
select t.id,
       t.company_id,
       t.enterprise_group_id,
       t.code,
       t.name,
       t.default_unit,
       t.category,
       t.production_required,
       t.crew_required,
       t.equipment_required,
       t.material_required,
       t.safety_review_required,
       t.status,
       /* The trade, where exactly one service category uses this task. */
       case when u.trades = 1 then u.only_trade end                       as trade,
       case
         when u.task_id is null then 'unused'
         when u.trades = 1      then 'derived'
         when u.trades = 0      then 'unused'
         else 'ambiguous'
       end                                                                as trade_certainty,
       coalesce(u.services_using, 0)                                      as services_using
  from tasks t
  left join used_by u on u.task_id = t.id;

revoke all on my_library_tasks from public, anon;
grant select on my_library_tasks to authenticated, service_role;

comment on view my_library_tasks is
  'The task library with the trade each task belongs to, read from the services whose build-ups use it rather than typed onto the row. Null where a task is used by more than one trade or by none, with trade_certainty saying which — an alphabetically-first guess would be an invented figure. LIBRARY view.';
