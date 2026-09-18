-- =============================================================================
-- 0232 — What a bid is priced on, and what it leaves out
--
-- `estimate_assumptions` and `estimate_exclusions` were built in 0006, given
-- tenant RLS in 0010, and taught to copy themselves when a version is
-- duplicated in 0011 and 0112. Four migrations treat them as real. Nothing has
-- ever written a row into either, and no screen has ever read one.
--
-- The proposal document has carried `inclusions`, `exclusions` and
-- `clarifications` sections since it was written, and `proposal-pdf.ts` passes
-- `inclusions: []` and `exclusions: []` — hard-coded empty, every time. So the
-- renderer was finished, the tables were finished, and the two were never
-- introduced. A contractor sending a bid out of this platform sent one that
-- said nothing about what it was priced on.
--
-- That is the most expensive silence in the product. An excavation bid without
-- exclusions is an offer to do whatever turns up: no rock clause, no dewatering
-- clause, no statement that the geotechnical report was never provided. The
-- money is not lost in the estimate, it is lost in the argument afterwards, and
-- the argument is won or lost by this page.
--
-- Three rules, and 0006 already wrote the first one into a column comment:
--
--   * **An exclusion needs a reason.** "Section 49: an item may not be excluded
--     merely because it is inconvenient to estimate." The column has been `not
--     null` since the day it was created and nothing has ever had to satisfy it.
--   * **An assumption needs a reason too**, for the same cause one layer along:
--     an assumption with no basis is a guess with a serious face on it.
--   * **What the customer sees is decided per item.** `is_disclosed_to_customer`
--     has sat on the table unused; it is the standing rule that everything can
--     be shown to the client, said in one column, and the proposal reads it.
--
-- ENTITY.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Writing them
-- -----------------------------------------------------------------------------
/** The estimate version a caller may change, or a refusal. */
create or replace function app.estimate_version_for_write(p_version uuid)
returns estimate_versions
language plpgsql stable security invoker set search_path = public, pg_catalog
as $$
declare
  v_version estimate_versions%rowtype;
begin
  select * into v_version from estimate_versions where id = p_version;
  if not found then
    raise exception 'No such estimate version' using errcode = 'no_data_found';
  end if;
  perform app.company_for_write(v_version.company_id, 'estimates.write');
  /*
   * RULE-009. An issued version is what somebody was sent; changing what it
   * said it was priced on, after the fact, is changing the offer.
   */
  if v_version.status in ('issued', 'awarded', 'lost', 'archived') then
    raise exception 'That version is % and cannot be changed', v_version.status
      using errcode = 'check_violation',
            hint = 'Start a revision. The assumptions and exclusions are copied onto it.';
  end if;
  return v_version;
end;
$$;

create or replace function app.add_estimate_assumption(
  p_version   uuid,
  p_assumption text,
  p_reason    text,
  p_code      text default null,
  p_line      uuid default null,
  p_cost_impact text default null,
  p_schedule_impact text default null,
  p_disclosed boolean default true)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_version estimate_versions%rowtype := app.estimate_version_for_write(p_version);
  v_text   text := nullif(btrim(coalesce(p_assumption, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id     uuid;
begin
  if v_text is null then
    raise exception 'An assumption has to say what is being assumed'
      using errcode = 'check_violation',
            hint = 'What you priced it as: "Topsoil stripped at 6 inches", "Spoil stays on site".';
  end if;
  if v_reason is null then
    raise exception 'An assumption has to say what it rests on'
      using errcode = 'check_violation',
            hint = 'Where it came from: a sheet, a call, a site visit, or the absence of a report. '
                 || 'An assumption with no basis is a guess with a serious face on.';
  end if;

  insert into estimate_assumptions (
    company_id, estimate_version_id, line_item_id, code, assumption, reason,
    cost_impact, schedule_impact, is_disclosed_to_customer, created_by)
  values (
    v_version.company_id, v_version.id, p_line, nullif(btrim(coalesce(p_code, '')), ''),
    v_text, v_reason,
    nullif(btrim(coalesce(p_cost_impact, '')), ''),
    nullif(btrim(coalesce(p_schedule_impact, '')), ''),
    coalesce(p_disclosed, true), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

comment on function app.add_estimate_assumption(uuid, text, text, text, uuid, text, text, boolean) is
  'Records what a price rests on. The reason is required, because an assumption with no basis is a guess with a serious face on. ENTITY.';

create or replace function app.add_estimate_exclusion(
  p_version   uuid,
  p_exclusion text,
  p_reason    text,
  p_category  text default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_version estimate_versions%rowtype := app.estimate_version_for_write(p_version);
  v_text   text := nullif(btrim(coalesce(p_exclusion, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_next   int;
  v_id     uuid;
begin
  if v_text is null then
    raise exception 'An exclusion has to say what is excluded'
      using errcode = 'check_violation',
            hint = 'What this price does not cover: "Rock excavation", "Dewatering", "Permits".';
  end if;
  /*
   * Section 49, written into this table's own column comment in 0006 and never
   * enforced by anything because nothing ever inserted a row: an item may not
   * be excluded merely because it is inconvenient to estimate.
   */
  if v_reason is null then
    raise exception 'An exclusion has to say why'
      using errcode = 'check_violation',
            hint = 'An item may not be excluded merely because it is inconvenient to estimate. '
                 || 'Say what makes it somebody else''s: no geotechnical report, by others, not shown.';
  end if;

  select coalesce(max(e.sort_order), 0) + 10 into v_next
    from estimate_exclusions e where e.estimate_version_id = v_version.id;

  insert into estimate_exclusions (
    company_id, estimate_version_id, exclusion, category, reason, sort_order)
  values (
    v_version.company_id, v_version.id, v_text,
    nullif(btrim(coalesce(p_category, '')), ''), v_reason, coalesce(v_next, 10))
  returning id into v_id;
  return v_id;
end;
$$;

comment on function app.add_estimate_exclusion(uuid, text, text, text) is
  'Records what a price does not cover, and why. Section 49: an item may not be excluded merely because it is inconvenient to estimate, so the reason is not optional. ENTITY.';

-- -----------------------------------------------------------------------------
-- Changing and retiring them
-- -----------------------------------------------------------------------------
create or replace function app.set_estimate_assumption(
  p_assumption uuid,
  p_text      text default null,
  p_reason    text default null,
  p_cost_impact text default null,
  p_schedule_impact text default null,
  p_disclosed boolean default null)
returns estimate_assumptions
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_row estimate_assumptions%rowtype;
begin
  select * into v_row from estimate_assumptions where id = p_assumption;
  if not found then
    raise exception 'No such assumption' using errcode = 'no_data_found';
  end if;
  perform app.estimate_version_for_write(v_row.estimate_version_id);

  update estimate_assumptions a
     set assumption = coalesce(nullif(btrim(coalesce(p_text, '')), ''), a.assumption),
         reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), a.reason),
         cost_impact = case when p_cost_impact is null then a.cost_impact
                            else nullif(btrim(p_cost_impact), '') end,
         schedule_impact = case when p_schedule_impact is null then a.schedule_impact
                                else nullif(btrim(p_schedule_impact), '') end,
         is_disclosed_to_customer = coalesce(p_disclosed, a.is_disclosed_to_customer),
         updated_at = now()
   where a.id = p_assumption
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function app.set_estimate_exclusion(
  p_exclusion uuid,
  p_text      text default null,
  p_reason    text default null,
  p_category  text default null,
  p_sort      int default null)
returns estimate_exclusions
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_row estimate_exclusions%rowtype;
begin
  select * into v_row from estimate_exclusions where id = p_exclusion;
  if not found then
    raise exception 'No such exclusion' using errcode = 'no_data_found';
  end if;
  perform app.estimate_version_for_write(v_row.estimate_version_id);

  update estimate_exclusions e
     set exclusion = coalesce(nullif(btrim(coalesce(p_text, '')), ''), e.exclusion),
         reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), e.reason),
         category = case when p_category is null then e.category
                         else nullif(btrim(p_category), '') end,
         sort_order = coalesce(p_sort, e.sort_order),
         updated_at = now()
   where e.id = p_exclusion
  returning * into v_row;
  return v_row;
end;
$$;

/*
 * Removed outright rather than archived, and the difference from the library is
 * deliberate. A library row is referred to by history; an exclusion belongs to
 * one unissued version of one estimate, nothing points at it, and a person who
 * typed the wrong one wants it gone rather than grayed out. The moment the
 * version is issued neither of these will run at all.
 */
create or replace function app.remove_estimate_assumption(p_assumption uuid)
returns boolean
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_row estimate_assumptions%rowtype;
begin
  select * into v_row from estimate_assumptions where id = p_assumption;
  if not found then return false; end if;
  perform app.estimate_version_for_write(v_row.estimate_version_id);
  delete from estimate_assumptions where id = p_assumption;
  return true;
end;
$$;

create or replace function app.remove_estimate_exclusion(p_exclusion uuid)
returns boolean
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_row estimate_exclusions%rowtype;
begin
  select * into v_row from estimate_exclusions where id = p_exclusion;
  if not found then return false; end if;
  perform app.estimate_version_for_write(v_row.estimate_version_id);
  delete from estimate_exclusions where id = p_exclusion;
  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reading them
-- -----------------------------------------------------------------------------
create or replace view my_estimate_assumptions
with (security_invoker = true) as
select a.id, a.company_id, a.estimate_version_id, a.line_item_id, a.code,
       a.assumption, a.reason, a.supporting_reference, a.quantity_affected,
       a.cost_impact, a.schedule_impact, a.confidence, a.confirmation_method,
       a.is_disclosed_to_customer, a.created_at
  from estimate_assumptions a;

revoke all on my_estimate_assumptions from public, anon;
grant select on my_estimate_assumptions to authenticated, service_role;

create or replace view my_estimate_exclusions
with (security_invoker = true) as
select e.id, e.company_id, e.estimate_version_id, e.exclusion, e.category,
       e.reason, e.sort_order, e.created_at
  from estimate_exclusions e;

revoke all on my_estimate_exclusions from public, anon;
grant select on my_estimate_exclusions to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Public wrappers
-- -----------------------------------------------------------------------------
create or replace function public.add_estimate_assumption(
  p_version uuid, p_assumption text, p_reason text, p_code text default null,
  p_line uuid default null, p_cost_impact text default null,
  p_schedule_impact text default null, p_disclosed boolean default true)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.add_estimate_assumption(p_version, p_assumption, p_reason, p_code,
                                         p_line, p_cost_impact, p_schedule_impact, p_disclosed); $$;

create or replace function public.add_estimate_exclusion(
  p_version uuid, p_exclusion text, p_reason text, p_category text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.add_estimate_exclusion(p_version, p_exclusion, p_reason, p_category); $$;

create or replace function public.set_estimate_assumption(
  p_assumption uuid, p_text text default null, p_reason text default null,
  p_cost_impact text default null, p_schedule_impact text default null,
  p_disclosed boolean default null)
returns estimate_assumptions language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_estimate_assumption(p_assumption, p_text, p_reason,
                                         p_cost_impact, p_schedule_impact, p_disclosed); $$;

create or replace function public.set_estimate_exclusion(
  p_exclusion uuid, p_text text default null, p_reason text default null,
  p_category text default null, p_sort int default null)
returns estimate_exclusions language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_estimate_exclusion(p_exclusion, p_text, p_reason, p_category, p_sort); $$;

create or replace function public.remove_estimate_assumption(p_assumption uuid)
returns boolean language sql security invoker set search_path = public, pg_catalog
as $$ select app.remove_estimate_assumption(p_assumption); $$;

create or replace function public.remove_estimate_exclusion(p_exclusion uuid)
returns boolean language sql security invoker set search_path = public, pg_catalog
as $$ select app.remove_estimate_exclusion(p_exclusion); $$;

do $grants$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.add_estimate_assumption(uuid, text, text, text, uuid, text, text, boolean)',
    'public.add_estimate_exclusion(uuid, text, text, text)',
    'public.set_estimate_assumption(uuid, text, text, text, text, boolean)',
    'public.set_estimate_exclusion(uuid, text, text, text, int)',
    'public.remove_estimate_assumption(uuid)',
    'public.remove_estimate_exclusion(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $grants$;

select app.assert_security_gates();
