-- =============================================================================
-- 0117 — Bid it in the unit you bid in
--
-- `services.supported_units` says which units a service is normally measured
-- in, and since migration 0097 `add_estimate_line` has refused any other:
--
--     raise exception '% is not measured in %', v_service.name, v_unit
--
-- The reasoning was sound and the rule was wrong. A unit the catalog did not
-- anticipate is not a mistake — it is a company that bids topsoil by the load
-- rather than the cubic yard, aggregate by the ton where the catalog says cubic
-- yard, or fencing by the panel. The catalog is GrounUp's opinion about how a
-- trade is usually measured, and a contractor's own way of selling their work
-- outranks it.
--
-- So the unit becomes the estimator's choice, and the catalog's list becomes
-- what it always should have been: a recommendation, offered first.
--
-- What is *not* given up is the warning. A production rate is measured in a
-- unit, and a rate of 240 CY/hr says nothing about a line bid in loads. Where
-- the unit is off the service's list, the line simply carries no production
-- rate — `app.production_rate_candidates` already ranks a rate in the line's own
-- unit first and the line takes none when none matches — and
-- `app.line_unit_note` gives a screen the sentence to say why. The estimator
-- gets their unit and is told what it costs them.
-- =============================================================================

/**
 * Add a line from the library.
 *
 * As migration 0115 left it, minus the unit refusal. A unit outside the
 * service's list is allowed and simply finds no rate measured that way, which
 * is the honest consequence rather than a prohibition.
 */
create or replace function app.add_estimate_line(
  p_version uuid,
  p_service uuid default null,
  p_description text default null,
  p_quantity numeric default 0,
  p_unit app.unit_code default null)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_status  app.estimate_status;
  v_service services%rowtype;
  v_unit    app.unit_code;
  v_desc    text;
  v_rate    uuid;
  v_sort    int;
  v_id      uuid;
begin
  select v.company_id, v.status into v_company, v_status
  from estimate_versions v where v.id = p_version;
  if v_company is null then
    raise exception 'No such estimate version' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'estimates.write') then
    raise exception 'You do not have permission to change this estimate'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status not in ('draft', 'in_review') then
    raise exception 'This version is %; make a new version to change it', v_status
      using errcode = 'check_violation',
            hint = 'app.revise_estimate_version copies it forward with a reason.';
  end if;

  if p_service is not null then
    select * into v_service from services s
    where s.id = p_service
      and (s.company_id = v_company or s.company_id is null)
      and s.status = 'active';
    if not found then
      raise exception 'That service is not in your library' using errcode = 'no_data_found';
    end if;
  end if;

  v_unit := coalesce(p_unit, v_service.default_unit, 'LS');
  v_desc := coalesce(nullif(trim(coalesce(p_description, '')), ''), v_service.name);
  if v_desc is null then
    raise exception 'A line needs a description, or a service to take one from'
      using errcode = 'check_violation';
  end if;

  /*
   * No unit refusal. The catalog's list is a recommendation; how a company
   * sells its work is the company's. A unit the catalog did not anticipate
   * finds no production rate measured that way, and that is the whole cost of
   * the choice — stated by `app.line_unit_note`, not prevented here.
   */
  if v_service.id is not null then
    select c.rate_id into v_rate
    from app.production_rate_candidates(v_service.id, v_unit, v_company) c
    where c.rank = 1 and c.unit_matches;
  end if;

  select coalesce(max(sort_order), 0) + 10 into v_sort
  from estimate_line_items where estimate_version_id = p_version;

  insert into estimate_line_items (
    company_id, estimate_version_id, sort_order, description, service_id,
    cost_code_id, measured_quantity, unit, production_rate_id, created_by)
  values (
    v_company, p_version, v_sort, v_desc, v_service.id,
    v_service.cost_code_id, greatest(coalesce(p_quantity, 0), 0), v_unit, v_rate,
    auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

/**
 * What to say about a line measured off its service's list.
 *
 * Null when there is nothing to say. A sentence when the estimator has chosen a
 * unit the catalog did not anticipate — which is allowed, and has a consequence
 * they should be able to read rather than discover in a price.
 */
create or replace function app.line_unit_note(p_line uuid)
returns text
language plpgsql
stable
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_unit      app.unit_code;
  v_service   uuid;
  v_name      text;
  v_supported app.unit_code[];
  v_rate      uuid;
begin
  select l.unit, l.service_id, l.production_rate_id, s.name, s.supported_units
    into v_unit, v_service, v_rate, v_name, v_supported
  from estimate_line_items l
  left join services s on s.id = l.service_id
  where l.id = p_line;

  if v_service is null or v_supported is null then
    return null;
  end if;
  if v_unit = any (v_supported) then
    return null;
  end if;

  return format(
    '%s is normally measured in %s. This line is bid in %s, which is your call — but no '
    || 'production rate in the library is measured that way, so %s',
    v_name,
    array_to_string(v_supported, ', '),
    v_unit,
    case when v_rate is null
      then 'the hours come from the crew and machines on the line rather than from production.'
      else 'check the rate under it still means what you think.' end);
end;
$$;

comment on function app.line_unit_note(uuid) is
  'The sentence to show when a line is bid in a unit its service does not list. ENGINE support: the unit is the estimator''s choice, and this is what that choice costs.';

create or replace function public.line_unit_note(p_line uuid)
returns text language plpgsql stable security invoker set search_path = public, pg_catalog
as $$ begin return app.line_unit_note(p_line); end; $$;

do $$
begin
  execute 'revoke all on function public.line_unit_note(uuid) from public, anon';
  execute 'grant execute on function public.line_unit_note(uuid) to authenticated';
end $$;

select app.assert_security_gates();
