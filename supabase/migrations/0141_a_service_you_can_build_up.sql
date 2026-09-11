-- =============================================================================
-- 0141 — A service you can build up
--
-- Migration 0129 gave a company its own copy of a work sequence: take a
-- platform template, copy it, change the order concrete goes in. It handles the
-- case where a breakdown exists and is somebody else's.
--
-- It does not handle the case where there is no breakdown at all. 465 services
-- arrived from the product master naming work sequences the task library did
-- not contain, and `my_services_without_a_breakdown` was written to list them.
-- The list has a screen now; the screen had nothing to offer, because
-- `customize_assembly` copies an assembly and there is no assembly to copy.
--
-- The block is not the assembly, it is the *service*. Everything that prices a
-- line resolves through `services.default_assembly_id`, and a platform service
-- row is one no tenant may write — correctly. So building up a catalog service
-- is two steps that have to happen together or not at all: the company takes
-- its own copy of the service, and that copy gets an empty sequence to fill.
--
-- One function, one transaction, because a company service pointing at nothing
-- is the state this exists to remove rather than to create.
--
-- Idempotent by construction: called twice it returns the same assembly, so a
-- double-click does not leave two half-built sequences behind.
--
-- Entity: Service. Library: work sequences.
-- =============================================================================

create or replace function app.start_a_breakdown(p_service uuid, p_company uuid)
returns assemblies
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_src      services;
  v_mine     services;
  v_assembly assemblies;
  v_code     text;
  v_suffix   text;
  v_approve  boolean;
begin
  select * into v_src from services where id = p_service;
  if v_src.id is null then
    raise exception 'No such service.' using errcode = 'no_data_found';
  end if;

  if not app.has_permission(p_company, 'libraries.write') then
    raise exception 'Building up a service needs the libraries.write permission.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_src.company_id is not null and v_src.company_id <> p_company then
    raise exception 'That service belongs to another company.'
      using errcode = 'insufficient_privilege';
  end if;

  /*
   * A company row that is live has to name who made it live (migration 0028).
   * Somebody who may write but not approve gets a draft rather than a refusal —
   * the work is theirs to do and the approval is somebody else's to give, and
   * blocking the first on the second is how a library stops being used.
   */
  v_approve := app.has_permission(p_company, 'libraries.approve');
  v_suffix  := substring(replace(p_company::text, '-', '') from 1 for 6);

  -- 1. The company's own copy of the service, unless it already has one -------
  if v_src.company_id = p_company then
    v_mine := v_src;
  else
    v_code := left(v_src.code, 30) || '-' || v_suffix;

    select * into v_mine from services
     where company_id = p_company and code = v_code;

    if v_mine.id is null then
      insert into services (company_id, code, name, industry, industry_pack_id,
                            category, subcategory, description, default_unit,
                            supported_units, pricing_method, cost_code_id,
                            status, source, origin, approved_by, approved_at)
      values (p_company, v_code, v_src.name, v_src.industry, v_src.industry_pack_id,
              v_src.category, v_src.subcategory, v_src.description, v_src.default_unit,
              v_src.supported_units, v_src.pricing_method, v_src.cost_code_id,
              case when v_approve then 'active' else 'draft' end::app.record_status,
              'Copied from ' || v_src.code || ' to build up', 'company',
              case when v_approve then auth.uid() end,
              case when v_approve then now() end)
      returning * into v_mine;
    end if;
  end if;

  -- 2. The sequence it points at, unless it already points at one ------------
  if v_mine.default_assembly_id is not null then
    select * into v_assembly from assemblies where id = v_mine.default_assembly_id;
    if v_assembly.id is not null then
      return v_assembly;                       -- already started; nothing to do
    end if;
  end if;

  v_code := left('SEQ-' || v_mine.code, 36);

  select * into v_assembly from assemblies
   where company_id = p_company and code = v_code;

  if v_assembly.id is null then
    insert into assemblies (company_id, code, name, service_id, assembly_type,
                            quantity_unit, description, status, source, origin,
                            approved_by, approved_at)
    values (p_company, v_code, v_mine.name, v_mine.id, 'Standard',
            v_mine.default_unit,
            'Started from ' || v_src.code || ', which had no breakdown.',
            case when v_approve then 'active' else 'draft' end::app.record_status,
            'Started for ' || v_mine.code, 'company',
            case when v_approve then auth.uid() end,
            case when v_approve then now() end)
    returning * into v_assembly;
  end if;

  update services set default_assembly_id = v_assembly.id, updated_at = now()
   where id = v_mine.id;

  return v_assembly;
end;
$$;

comment on function app.start_a_breakdown(uuid, uuid) is
  'Give a service with no work sequence one to fill, taking the company its own copy of the service first. The catalog service is untouched — everything that prices a line resolves through services.default_assembly_id, and a platform row is one no tenant may write.';

create or replace function public.start_a_breakdown(p_service uuid, p_company uuid)
returns assemblies
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$ begin return app.start_a_breakdown(p_service, p_company); end; $$;

revoke all on function app.start_a_breakdown(uuid, uuid) from public, anon;
revoke all on function public.start_a_breakdown(uuid, uuid) from public, anon;
grant execute on function app.start_a_breakdown(uuid, uuid) to authenticated;
grant execute on function public.start_a_breakdown(uuid, uuid) to authenticated;

select app.assert_security_gates();
