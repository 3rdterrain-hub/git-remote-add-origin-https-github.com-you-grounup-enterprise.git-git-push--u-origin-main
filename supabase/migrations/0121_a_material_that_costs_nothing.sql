-- =============================================================================
-- 0121 — A material that costs nothing says so
--
-- A materials export from a real company: 342 materials, and **six of them have
-- a price**. Every other one sits at `unit_cost = 0`, which is the column's
-- default and means nothing at all — nobody has costed it yet.
--
-- The estimating engine multiplies quantity by that number and says nothing.
-- So a line carrying eight materials prices cleanly, the estimate totals, the
-- bid goes out, and every one of those materials is bought at whatever it
-- actually costs. It is the most expensive silence available to an estimating
-- engine, because nothing about the output looks wrong.
--
-- The engine cannot tell "nobody has costed this" from "the owner supplies it",
-- and it should not guess. Both are zero. So the library says which:
--
--   * `not_costed` — the default, and what every existing zero becomes. The
--     engine warns on every line that uses one.
--   * `estimated` — somebody put a number on it from experience.
--   * `quoted` — a supplier quoted it, which is firmer than either.
--   * `free` — genuinely no cost, and `free_reason` says why. An owner-supplied
--     material is a real thing and it should be stateable rather than
--     indistinguishable from an oversight.
--
-- The constraint is the same shape as `materials_waste_basis` two migrations
-- into this schema's life: a zero that means something has to say what.
-- =============================================================================

do $type$ begin
  create type app.material_cost_state as enum
    ('not_costed', 'estimated', 'quoted', 'free');
exception when duplicate_object then null;
end $type$;

alter table materials
  add column if not exists cost_state app.material_cost_state,
  add column if not exists free_reason text,
  add column if not exists cost_quoted_on date,
  add column if not exists cost_source text;

/*
 * Backfilled from what the number already says, because that is the only
 * honest reading available: a price means somebody estimated it, and a zero
 * means nobody has. Nothing is assumed to be free — that has to be asserted.
 */
update materials
   set cost_state = case when unit_cost > 0 then 'estimated'::app.material_cost_state
                         else 'not_costed'::app.material_cost_state end
 where cost_state is null;

alter table materials
  alter column cost_state set default 'not_costed',
  alter column cost_state set not null;

alter table materials drop constraint if exists materials_free_needs_reason;
alter table materials
  add constraint materials_free_needs_reason
  check (cost_state <> 'free' or (free_reason is not null and length(trim(free_reason)) >= 4));

alter table materials drop constraint if exists materials_priced_states_have_a_price;
alter table materials
  add constraint materials_priced_states_have_a_price
  check (cost_state not in ('estimated', 'quoted') or unit_cost > 0);

alter table materials drop constraint if exists materials_free_costs_nothing;
alter table materials
  add constraint materials_free_costs_nothing
  check (cost_state <> 'free' or unit_cost = 0);

/**
 * Keep the state and the number telling the same story.
 *
 * The backfill above ran once. Without this, a material inserted afterwards
 * with a price would carry the column default and claim nobody had costed it —
 * which is the exact confusion this migration exists to remove, arriving by a
 * different door a week later.
 *
 * A price and `not_costed` cannot both be true, so the price wins: somebody put
 * a number there. It becomes `estimated`, which is the weakest of the priced
 * states and the honest one for a figure with no stated source. Going the other
 * way — clearing the price to match the state — would delete somebody's work.
 */
create or replace function app.derive_material_cost_state()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.cost_state = 'not_costed' and new.unit_cost > 0 then
    new.cost_state := 'estimated';
  end if;
  return new;
end;
$$;

drop trigger if exists materials_cost_state on materials;
create trigger materials_cost_state
  before insert or update on materials
  for each row execute function app.derive_material_cost_state();

comment on function app.derive_material_cost_state() is
  'Keeps materials.cost_state and materials.unit_cost telling the same story: a material with a price is never recorded as uncosted. ENGINE support for the material cost warning.';

comment on column materials.cost_state is
  'Whether a zero price means nobody has costed this material or that it genuinely costs nothing. The number is the same either way, so it cannot be inferred — and an estimate built on uncosted material prices as though the material were free.';
comment on column materials.free_reason is
  'Why a material costs nothing. Required when cost_state is free, because "no cost" is a claim somebody has to stand behind.';

create index if not exists materials_uncosted_idx
  on materials (company_id) where cost_state = 'not_costed';

-- -----------------------------------------------------------------------------
-- What a screen reads
-- -----------------------------------------------------------------------------

/**
 * The materials nobody has priced, and what they are already used on.
 *
 * The count is the point. A company with three uncosted materials has an
 * afternoon of phone calls; a company with three hundred has an estimating
 * system that reports material cost as zero and always will.
 */
create or replace view my_uncosted_materials
with (security_invoker = true) as
select m.id,
       m.company_id,
       m.code,
       m.name,
       m.category,
       m.unit,
       m.cost_state,
       m.company_id is not null as is_own,
       (select count(*) from estimate_line_resources r
         where r.material_id = m.id)                       as used_on_lines,
       (select count(distinct l.estimate_version_id)
          from estimate_line_resources r
          join estimate_line_items l on l.id = r.line_item_id
         where r.material_id = m.id)                       as used_on_estimates
from materials m
where m.cost_state = 'not_costed'
  and m.status = 'active';

revoke all on my_uncosted_materials from public, anon;
grant select on my_uncosted_materials to authenticated;

comment on view my_uncosted_materials is
  'Materials with no price, and how much of the estimating already rests on them. A material at zero prices as free, so this is a list of quiet holes in every estimate that uses one.';

-- -----------------------------------------------------------------------------
-- Putting a price on one
-- -----------------------------------------------------------------------------

/**
 * Cost a material, and say where the number came from.
 *
 * A quote and a guess are different claims and the estimate should be able to
 * tell them apart, which is why the source is not optional for either.
 */
create or replace function app.set_material_cost(
  p_material uuid,
  p_unit_cost numeric,
  p_state app.material_cost_state,
  p_source text default null,
  p_quoted_on date default null)
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  select company_id into v_company from materials where id = p_material;
  if not found then
    raise exception 'No such material' using errcode = 'no_data_found';
  end if;
  if v_company is null then
    raise exception 'That material belongs to the shipped catalog; copy it to your library to price it'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.has_permission(v_company, 'libraries.write') then
    raise exception 'You do not have permission to change the libraries'
      using errcode = 'insufficient_privilege';
  end if;

  if p_state in ('estimated', 'quoted') then
    if p_unit_cost is null or p_unit_cost <= 0 then
      raise exception 'A % price has to be above zero', p_state
        using errcode = 'check_violation',
              hint = 'If it genuinely costs nothing, record it as free and say why.';
    end if;
    if p_source is null or length(trim(p_source)) < 3 then
      raise exception 'Say where this price came from'
        using errcode = 'check_violation',
              hint = 'A supplier name, a quote number, or how it was estimated.';
    end if;
  end if;
  if p_state = 'free' and (p_source is null or length(trim(p_source)) < 4) then
    raise exception 'Say why this material costs nothing'
      using errcode = 'check_violation',
            hint = 'Owner-supplied, salvaged on site, included in a subcontract.';
  end if;

  update materials
     set unit_cost = case when p_state = 'free' then 0
                          when p_state = 'not_costed' then unit_cost
                          else p_unit_cost end,
         cost_state = p_state,
         free_reason = case when p_state = 'free' then trim(p_source) else null end,
         cost_source = case when p_state in ('estimated', 'quoted') then trim(p_source) else null end,
         cost_quoted_on = case when p_state = 'quoted' then coalesce(p_quoted_on, current_date) else null end
   where id = p_material;
end;
$$;

create or replace function public.set_material_cost(
  p_material uuid, p_unit_cost numeric, p_state app.material_cost_state,
  p_source text default null, p_quoted_on date default null)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin
  perform app.set_material_cost(p_material, p_unit_cost, p_state, p_source, p_quoted_on);
end; $$;

do $$
begin
  execute 'revoke all on function public.set_material_cost(uuid, numeric, app.material_cost_state, text, date) from public, anon';
  execute 'grant execute on function public.set_material_cost(uuid, numeric, app.material_cost_state, text, date) to authenticated';
end $$;

select app.assert_security_gates();
