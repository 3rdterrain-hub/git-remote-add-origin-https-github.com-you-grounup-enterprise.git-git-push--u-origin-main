-- =============================================================================
-- 0125 — A line you typed becomes a service
--
-- An estimator types "Haul and place 8 inch aggregate base" because the library
-- does not have it. The bid goes out, the line is priced, the job is won — and
-- the next time they need it they type it again, spelled slightly differently,
-- with a different unit, and the platform has learned nothing.
--
-- The library has been read-only from inside the application since 0004:
-- 65,000 platform rows a company may use and no way for a company to add one of
-- its own. `services.origin` has had a `'company'` value the whole time and
-- nothing has ever written it.
--
-- Three things this is careful about.
--
-- **It is the same line, not a copy.** The line is repointed at the new service
-- rather than duplicated, so the estimate that prompted it is the first thing
-- using it, and the description it carried becomes the service's name.
--
-- **Saving it is not the same as approving it.** Migration 0028 settled that a
-- live company library row must name who made it live, and this does not work
-- around it. Somebody who holds `libraries.approve` saves a service that is
-- immediately active and approved in their name; somebody who does not saves a
-- draft, usable on the estimate that prompted it and waiting for a reviewer
-- before it reaches anybody else's search. Both carry `origin = 'company'`, so
-- a service typed under time pressure never looks like one the platform ships.
--
-- **The code is generated, not asked for.** An estimator adding a line mid-bid
-- should not have to invent a catalog code, and asking for one is how this
-- feature ends up unused. `C-0001` upward, per company, so it never collides
-- with the platform's own `SVC-` codes.
-- =============================================================================

/**
 * The next company service code.
 *
 * Reads the highest `C-` code the company already has rather than counting
 * rows, so a retired service does not hand its number to the next one — two
 * services sharing a code across time is the kind of thing nobody notices until
 * a report joins on it.
 */
create or replace function app.next_company_service_code(p_company uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select 'C-' || lpad((coalesce(max(substring(s.code from '^C-(\d+)$')::int), 0) + 1)::text, 4, '0')
  from services s
  where s.company_id = p_company and s.code ~ '^C-\d+$';
$$;

/**
 * Save a typed line into the company's own library, and point the line at it.
 *
 * Refuses a line that already came from the library: there would be nothing to
 * learn, and the second copy would compete with the first in every search from
 * then on. Refuses a frozen version too, because repointing a line changes what
 * an approved estimate says it is made of.
 */
create or replace function public.save_line_to_library(
  p_line     uuid,
  p_category text default null,
  p_industry text default null
)
returns services
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_line    estimate_line_items%rowtype;
  v_company uuid;
  v_status  text;
  v_name    text;
  v_service services%rowtype;
  v_units   app.unit_code[];
  v_approve boolean;
begin
  select * into v_line from estimate_line_items where id = p_line;
  if v_line.id is null then
    raise exception 'No such line.' using errcode = 'no_data_found';
  end if;

  select ev.company_id, ev.status::text into v_company, v_status
  from estimate_versions ev where ev.id = v_line.estimate_version_id;

  if not app.is_member(v_company) then
    raise exception 'You are not a member of that company.' using errcode = 'insufficient_privilege';
  end if;
  if not app.has_permission(v_company, 'libraries.write') then
    raise exception 'Saving to the library needs the libraries.write permission.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status <> 'draft' then
    raise exception 'This version is %; its lines can no longer be repointed. Save from a draft.', v_status
      using errcode = 'restrict_violation';
  end if;
  if v_line.service_id is not null then
    raise exception 'That line already came from the library, so there is nothing to add.'
      using errcode = 'check_violation';
  end if;

  v_name := btrim(coalesce(v_line.description, ''));
  if length(v_name) < 3 then
    raise exception 'Give the line a description of at least three characters before saving it.'
      using errcode = 'check_violation';
  end if;

  /*
   * Already there, by name, for this company. Returning it rather than refusing
   * is the same call `app.add_library_category` makes: somebody saving a name
   * that exists means to use it, and an error there is a puzzle rather than a
   * guard.
   */
  select * into v_service
  from services s
  where s.company_id = v_company
    and lower(btrim(s.name)) = lower(v_name)
    and s.status <> 'retired'
  order by s.created_at
  limit 1;

  if v_service.id is null then
    v_units := array[coalesce(v_line.unit, 'LS')]::app.unit_code[];
    /*
     * Approved by the person saving it when they are allowed to approve, and a
     * draft otherwise. The estimate that prompted it points at the row either
     * way, so nobody is blocked; what waits for a reviewer is the service
     * appearing in everybody else's search.
     */
    v_approve := app.has_permission(v_company, 'libraries.approve');
    insert into services (
      company_id, code, name, industry, category, default_unit, supported_units,
      cost_code_id, origin, status, source, approved_by, approved_at)
    values (
      v_company,
      app.next_company_service_code(v_company),
      v_name,
      nullif(btrim(p_industry), ''),
      nullif(btrim(p_category), ''),
      coalesce(v_line.unit, 'LS'),
      v_units,
      v_line.cost_code_id,
      'company',
      (case when v_approve then 'active' else 'draft' end)::app.record_status,
      'Saved from an estimate line',
      case when v_approve then auth.uid() end,
      case when v_approve then now() end)
    returning * into v_service;
  end if;

  update estimate_line_items
     set service_id = v_service.id,
         updated_at = now()
   where id = p_line;

  return v_service;
end;
$$;

comment on function public.save_line_to_library(uuid, text, text) is
  'Promotes a typed estimate line into the company''s own service library and repoints the line at it. WORKFLOW: active and approved when the caller holds libraries.approve, a draft awaiting review otherwise — migration 0028 requires a live company row to name who made it live. Returns an existing service of the same name rather than creating a second one.';

revoke all on function public.save_line_to_library(uuid, text, text) from public, anon;
grant execute on function public.save_line_to_library(uuid, text, text) to authenticated;
revoke all on function app.next_company_service_code(uuid) from public, anon;
grant execute on function app.next_company_service_code(uuid) to authenticated;
