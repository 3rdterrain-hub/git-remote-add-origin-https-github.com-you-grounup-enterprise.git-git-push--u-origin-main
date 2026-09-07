-- =============================================================================
-- 0129 — A template you can change
--
-- Seed 0006 put nineteen work sequences in the library — the order concrete
-- goes in, the order a bathroom rough-in goes in — and they are platform rows,
-- which means every company can use them and none can change them. That is the
-- right default and the wrong ending. A contractor whose concrete crew strips
-- forms before sawcutting has a sequence that is theirs, and a library that
-- cannot hold it is a library they stop using.
--
-- So: copy on write. `app.customize_assembly` takes a platform template and
-- makes the company its own copy, steps and all, at which point the ordinary
-- add, remove and reorder work on it. The platform's own stays where it is,
-- unchanged, for everybody else — which is the same three-tier shape every
-- library in this schema already has.
--
-- Two things this refuses.
--
-- It will not edit a platform row. Not "should not" — the RLS policy already
-- says a company may not write one, and these functions raise a sentence
-- explaining what to do instead rather than letting the policy return a bare
-- permission error.
--
-- It will not leave a template with a hole in it. Removing step four renumbers
-- the rest, because a sequence that runs 1, 2, 3, 5 is a sequence somebody will
-- eventually read as a missing step.
--
-- And `my_services_without_a_breakdown`, which belongs with this: 465 services
-- arrived from the product master referencing templates the task library did
-- not contain. They are usable — an estimator can build one up by hand — but
-- the gap should be a queue somebody works through, not something found at bid
-- time.
-- =============================================================================

/**
 * Make a company's own copy of a library template.
 *
 * Returns the company's copy, whether it was made now or already existed. A
 * second call is not an error: somebody pressing "customize" twice means to
 * work on their copy, and a duplicate template is worse than a no-op.
 */
create or replace function public.customize_assembly(p_assembly uuid, p_company uuid)
returns assemblies
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_src  assemblies;
  v_copy assemblies;
  v_code text;
begin
  select * into v_src from assemblies where id = p_assembly;
  if v_src.id is null then
    raise exception 'No such assembly.' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(p_company, 'libraries.write') then
    raise exception 'Making your own copy of a template needs the libraries.write permission.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_src.company_id = p_company then
    return v_src;                    -- already theirs
  end if;
  if v_src.company_id is not null then
    raise exception 'That template belongs to another company.'
      using errcode = 'insufficient_privilege';
  end if;

  v_code := left(v_src.code, 30) || '-' || substring(replace(p_company::text, '-', '') from 1 for 6);

  select * into v_copy from assemblies
   where company_id = p_company and code = v_code;
  if v_copy.id is not null then
    return v_copy;
  end if;

  insert into assemblies (company_id, code, name, service_id, assembly_type, quantity_unit,
                          description, status, source, approved_by, approved_at)
  values (p_company, v_code, v_src.name, v_src.service_id, v_src.assembly_type,
          v_src.quantity_unit, v_src.description, 'active',
          'Copied from ' || v_src.code,
          case when app.has_permission(p_company, 'libraries.approve') then auth.uid() end,
          case when app.has_permission(p_company, 'libraries.approve') then now() end)
  returning * into v_copy;

  /* The steps come with it, in the order they were in. */
  insert into assembly_components (company_id, assembly_id, component_kind, task_id,
                                   labor_rate_id, equipment_id, material_id,
                                   nested_assembly_id, quantity_per_unit, unit,
                                   is_optional, notes, sort_order)
  select p_company, v_copy.id, ac.component_kind, ac.task_id,
         ac.labor_rate_id, ac.equipment_id, ac.material_id,
         ac.nested_assembly_id, ac.quantity_per_unit, ac.unit,
         ac.is_optional, ac.notes, ac.sort_order
  from assembly_components ac
  where ac.assembly_id = v_src.id;

  return v_copy;
end;
$$;

/** Refuse politely, and say what to do instead. */
create or replace function app.assert_own_assembly(p_assembly uuid)
returns assemblies
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare v assemblies;
begin
  select * into v from assemblies where id = p_assembly;
  if v.id is null then
    raise exception 'No such template.' using errcode = 'no_data_found';
  end if;
  if v.company_id is null then
    raise exception 'That is one of the templates GrounUp ships, and it is the same one every company reads. Make your own copy of it first and change that.'
      using errcode = 'insufficient_privilege',
            hint = 'customize_assembly(assembly, company) copies it, steps and all.';
  end if;
  if not app.has_permission(v.company_id, 'libraries.write') then
    raise exception 'Changing a template needs the libraries.write permission.'
      using errcode = 'insufficient_privilege';
  end if;
  return v;
end;
$$;

/**
 * Put the steps back on 10, 20, 30.
 *
 * A sequence that runs 1, 2, 3, 5 is one somebody eventually reads as a missing
 * step, so nothing here ever leaves a hole.
 */
create or replace function app.renumber_assembly_steps(p_assembly uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_count int;
begin
  with ordered as (
    select id, row_number() over (order by sort_order, id) * 10 as n
    from assembly_components where assembly_id = p_assembly
  )
  update assembly_components ac
     set sort_order = o.n, updated_at = now()
    from ordered o
   where ac.id = o.id and ac.sort_order is distinct from o.n;

  select count(*) into v_count from assembly_components where assembly_id = p_assembly;
  return v_count;
end;
$$;

/** Add a step. Lands at the end unless a position is given. */
create or replace function public.add_assembly_step(
  p_assembly uuid,
  p_task     uuid,
  p_position int default null,
  p_quantity numeric default 1,
  p_optional boolean default false)
returns assembly_components
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_asm  assemblies;
  v_sort int;
  v_row  assembly_components;
begin
  v_asm := app.assert_own_assembly(p_assembly);
  if not exists (select 1 from tasks t where t.id = p_task
                   and (t.company_id is null or t.company_id = v_asm.company_id)) then
    raise exception 'No such task, or it belongs to another company.' using errcode = 'no_data_found';
  end if;

  if p_position is null then
    select coalesce(max(sort_order), 0) + 10 into v_sort
    from assembly_components where assembly_id = p_assembly;
  else
    /* Make room: everything at or after the position moves down one. */
    v_sort := p_position * 10;
    update assembly_components set sort_order = sort_order + 10
     where assembly_id = p_assembly and sort_order >= v_sort;
  end if;

  insert into assembly_components (company_id, assembly_id, component_kind, task_id,
                                   quantity_per_unit, is_optional, sort_order)
  values (v_asm.company_id, p_assembly, 'task', p_task,
          greatest(coalesce(p_quantity, 1), 0), coalesce(p_optional, false), v_sort)
  returning * into v_row;

  perform app.renumber_assembly_steps(p_assembly);
  return v_row;
end;
$$;

/** Take a step out, and close the gap it leaves. */
create or replace function public.remove_assembly_step(p_step uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_asm uuid;
begin
  select assembly_id into v_asm from assembly_components where id = p_step;
  if v_asm is null then
    raise exception 'No such step.' using errcode = 'no_data_found';
  end if;
  perform app.assert_own_assembly(v_asm);

  delete from assembly_components where id = p_step;
  return app.renumber_assembly_steps(v_asm);
end;
$$;

/** Move a step to a position, counting from one. */
create or replace function public.move_assembly_step(p_step uuid, p_to int)
returns int
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_asm uuid;
begin
  select assembly_id into v_asm from assembly_components where id = p_step;
  if v_asm is null then
    raise exception 'No such step.' using errcode = 'no_data_found';
  end if;
  perform app.assert_own_assembly(v_asm);
  if p_to < 1 then
    raise exception 'A step goes at position one or later.' using errcode = 'check_violation';
  end if;

  /*
   * Half a step above the target, then renumber. Moving to a fraction is how a
   * reorder avoids a swap that has to know which direction it is going.
   */
  update assembly_components
     set sort_order = (p_to * 10) - 5
   where id = p_step;

  return app.renumber_assembly_steps(v_asm);
end;
$$;

/** A template with its steps in order, whoever owns it. */
create or replace view my_assembly_steps as
select
  a.id                as assembly_id,
  a.company_id,
  a.code              as assembly_code,
  a.name              as assembly_name,
  a.assembly_type     as trade,
  (a.company_id is null) as is_platform,
  ac.id               as step_id,
  row_number() over (partition by a.id order by ac.sort_order, ac.id) as step,
  ac.component_kind,
  ac.task_id,
  t.name              as task_name,
  t.category          as task_category,
  t.default_unit      as task_unit,
  ac.quantity_per_unit,
  ac.is_optional,
  ac.sort_order,
  (select pr.rate_per_hour from production_rates pr
    where pr.task_id = ac.task_id and pr.status = 'active'
      and (pr.company_id = a.company_id or pr.company_id is null)
    order by (pr.company_id is not null) desc, pr.confidence_score desc
    limit 1)          as rate_per_hour
from assemblies a
join assembly_components ac on ac.assembly_id = a.id
left join tasks t on t.id = ac.task_id
where a.status = 'active';

/**
 * Services nobody can price yet.
 *
 * 465 arrived from the product master referencing work sequences the task
 * library did not contain. They are worth having — a named, CSI-coded service
 * an estimator can build up by hand beats one that is not there — but the gap
 * belongs on a list rather than in a bid.
 */
create or replace view my_services_without_a_breakdown as
select
  s.id, s.company_id, s.code, s.name, s.industry, s.category, s.default_unit,
  (s.default_assembly_id is null) as has_no_assembly,
  coalesce((select count(*) from assembly_components ac
             where ac.assembly_id = s.default_assembly_id
               and ac.component_kind = 'task'), 0)::int as steps
from services s
where s.status = 'active'
  and (s.default_assembly_id is null
       or not exists (select 1 from assembly_components ac
                       where ac.assembly_id = s.default_assembly_id
                         and ac.component_kind = 'task'));

revoke all on my_assembly_steps from public, anon;
revoke all on my_services_without_a_breakdown from public, anon;
grant select on my_assembly_steps to authenticated;
grant select on my_services_without_a_breakdown to authenticated;
alter view my_assembly_steps set (security_invoker = on);
alter view my_services_without_a_breakdown set (security_invoker = on);

revoke all on function public.customize_assembly(uuid, uuid) from public, anon;
grant execute on function public.customize_assembly(uuid, uuid) to authenticated;
revoke all on function public.add_assembly_step(uuid, uuid, int, numeric, boolean) from public, anon;
grant execute on function public.add_assembly_step(uuid, uuid, int, numeric, boolean) to authenticated;
revoke all on function public.remove_assembly_step(uuid) from public, anon;
grant execute on function public.remove_assembly_step(uuid) to authenticated;
revoke all on function public.move_assembly_step(uuid, int) from public, anon;
grant execute on function public.move_assembly_step(uuid, int) to authenticated;
revoke all on function app.renumber_assembly_steps(uuid) from public, anon;
grant execute on function app.renumber_assembly_steps(uuid) to authenticated;
revoke all on function app.assert_own_assembly(uuid) from public, anon;
grant execute on function app.assert_own_assembly(uuid) to authenticated;
