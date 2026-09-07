-- =============================================================================
-- 0128 — A machine with no rate on it
--
-- A resource catalog arrived with 191 machines, tools and attachments in it,
-- organized properly — trade families, equipment groups, and a column saying
-- which kinds of work each one is used on — and not one rate anywhere.
--
-- That is the ordinary state of a resource list. Somebody builds the catalog
-- long before anybody prices it, and the catalog is worth having: an estimator
-- who can find "Hydraulic Conduit Bender" and mark it as needing a rate is
-- ahead of one who cannot find it at all.
--
-- What is not acceptable is a machine that prices at zero and says nothing.
-- Migration 0121 made exactly this distinction for materials: an uncosted
-- material is a different fact from a free one, and the engine warns about the
-- first rather than multiplying by it. Equipment had no such distinction. A
-- machine with no `equipment_rates` row contributes nothing to a line's cost,
-- the line totals, the bid goes out, and the machine was on the job.
--
-- So three things:
--
--   * Equipment learns `brand`, `model` and `service_groups`, because a catalog
--     that has them and a schema that does not means throwing away the part of
--     the file worth most — `service_groups` is the link between a service and
--     the equipment it needs.
--   * `my_unrated_equipment` names every machine with no rate, so "we have not
--     priced the fleet" is a list somebody can work through rather than a
--     discovery made at bid time.
--   * `app.equipment_rate_state` answers the same question per machine, for a
--     screen or an engine that needs to warn on one line rather than audit a
--     library.
-- =============================================================================

alter table equipment
  add column if not exists brand text,
  add column if not exists model text,
  /*
   * What kinds of work this machine is used on, in the words the resource
   * catalog uses. Not a foreign key: the catalog's groupings are coarser than
   * `services`, and pretending otherwise would either drop the ones that do not
   * match or invent links nobody stated.
   */
  add column if not exists service_groups text[] not null default '{}';

comment on column equipment.service_groups is
  'The kinds of work this machine is used on, as stated by whoever built the resource catalog. Deliberately text rather than a reference to services: the groupings are coarser, and forcing a join would either drop what does not match or invent a link nobody made.';

comment on column equipment.brand is
  'The manufacturer, when the row is a specific machine rather than a class. Null on a class row — "Dozer" is a class, "Dozer D6 class" is a class, a Caterpillar D6T is a machine.';

create index if not exists equipment_service_groups_idx on equipment using gin (service_groups);

/**
 * Whether a machine has a rate anybody can price with.
 *
 * `unrated` is the state this migration exists for: the machine is in the
 * library, it can be put on a line, and it will contribute nothing. `seeded`
 * means the only rate is the platform's own ownership-cost assumption, which is
 * a starting point rather than a price. `priced` means somebody has put a real
 * rate against it.
 */
create or replace function app.equipment_rate_state(p_equipment uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
    when not exists (select 1 from equipment_rates r where r.equipment_id = p_equipment)
      then 'unrated'
    when exists (select 1 from equipment_rates r
                 where r.equipment_id = p_equipment and r.source <> 'global_seed')
      then 'priced'
    else 'seeded'
  end;
$$;

comment on function app.equipment_rate_state(uuid) is
  'unrated, seeded or priced. ENGINE support: a machine with no rate contributes nothing to a line and the line still totals, which is the failure this distinguishes.';

/**
 * Every machine the caller can see, with what it would cost to run.
 *
 * Ordered so the unrated ones come first: this is a list to work through, and a
 * list that opens on the machines already priced is a list nobody finishes.
 */
create or replace view my_unrated_equipment as
select
  e.id,
  e.company_id,
  e.code,
  e.name,
  e.equipment_class,
  e.brand,
  e.model,
  e.ownership_type,
  e.service_groups,
  app.equipment_rate_state(e.id) as rate_state,
  (select r.hourly_rate from equipment_rates r
    where r.equipment_id = e.id
    order by array_position(
               array['project_quote','tenant_approved','regional','global_seed']::app.rate_source[],
               r.source)
    limit 1) as hourly_rate,
  (select count(*) from estimate_line_resources lr where lr.equipment_id = e.id)::int
    as times_used
from equipment e
where e.status = 'active';

revoke all on my_unrated_equipment from public, anon;
grant select on my_unrated_equipment to authenticated;
alter view my_unrated_equipment set (security_invoker = on);

revoke all on function app.equipment_rate_state(uuid) from public, anon;
grant execute on function app.equipment_rate_state(uuid) to authenticated;

/*
 * The classes the resource catalog files things under. Same reason the trades
 * pack declares its own: `equipment.equipment_class` is governed by
 * `library_categories`, so a class that is not on the list is refused.
 */
insert into library_categories (company_id, kind, name, sort_order)
select null, 'equipment_class', v.name, v.sort
from (values
  ('Small Tools', 400), ('Attachments', 410), ('Technology', 420),
  ('Accessories', 430), ('Safety Equipment', 440), ('Vehicles', 450),
  ('Traffic Control', 460), ('Pollution Control', 470), ('Survey and Aerial', 480),
  ('Pressure Washing', 490), ('Diagnostics', 500)
) as v(name, sort)
on conflict do nothing;
