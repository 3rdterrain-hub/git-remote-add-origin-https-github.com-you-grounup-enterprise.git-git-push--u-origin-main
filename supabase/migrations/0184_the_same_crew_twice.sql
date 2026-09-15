-- =============================================================================
-- 0184 — The same crew, twice
--
-- Found by using 0183 rather than by reading it. Assigning a crew to an
-- activity twice was accepted without complaint, and the result was two rows
-- claiming 100% of the same crew over the same days. Crew loading then counts
-- one crew as two, equipment utilization counts one machine as two, and the
-- field app shows the same person the same work twice.
--
-- What is refused is narrower than "the same resource twice". A resource
-- legitimately appears more than once on an activity: two weeks on, a fortnight
-- away, two weeks back is three spans and three rows. What cannot be true is
-- **the same resource on the same activity over days that overlap** — that is
-- not a split span, it is a double booking, and the share each row claims is
-- being counted twice.
--
-- An exclusion constraint would be the tidier expression of this, but it needs
-- btree_gist and a daterange, and the table stores two date columns that five
-- readers already select by name. The check lives in the writer, where the
-- message can say which resource and which days rather than naming a
-- constraint.
--
-- WORKFLOW.
-- =============================================================================

create or replace function app.assert_resource_is_free(
  p_activity uuid,
  p_kind     text,
  p_resource uuid,
  p_from     date,
  p_to       date,
  p_except   uuid default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_clash record;
begin
  select r.starts_on, r.ends_on into v_clash
    from resource_assignments r
   where r.schedule_activity_id = p_activity
     and r.resource_kind = p_kind
     and p_resource = case p_kind
           when 'crew' then r.crew_id
           when 'employee' then r.employee_id
           when 'asset' then r.asset_id
           else r.vendor_id end
     and (p_except is null or r.id <> p_except)
     /* Two spans overlap when each starts before the other ends. */
     and r.starts_on <= p_to
     and r.ends_on >= p_from
   limit 1;

  if v_clash is not null then
    raise exception
      'That % is already on this activity from % to %', p_kind,
      to_char(v_clash.starts_on, 'Mon FMDD'), to_char(v_clash.ends_on, 'Mon FMDD')
      using errcode = 'unique_violation',
            hint = 'Change the dates on the assignment that is already there, or '
                 || 'book a span that does not overlap it.';
  end if;
end;
$$;

comment on function app.assert_resource_is_free(uuid, text, uuid, date, date, uuid) is
  'Refuses a second assignment of the same resource to the same activity over overlapping days. A split span is fine; a double booking counts one crew as two. WORKFLOW.';

/** Recreated with the double-booking check. Body otherwise as 0183. */
create or replace function app.assign_resource(
  p_activity   uuid,
  p_kind       text,
  p_crew       uuid default null,
  p_employee   uuid default null,
  p_asset      uuid default null,
  p_vendor     uuid default null,
  p_starts_on  date default null,
  p_ends_on    date default null,
  p_allocation numeric default 1,
  p_notes      text default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_a        schedule_activities%rowtype;
  v_id       uuid;
  v_from     date;
  v_to       date;
  v_resource uuid;
begin
  select * into v_a from schedule_activities where id = p_activity;
  if v_a.id is null then
    raise exception 'No such activity' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_a.company_id, 'projects.write') then
    raise exception 'You do not have permission to staff this project'
      using errcode = 'insufficient_privilege';
  end if;
  if p_kind not in ('crew','employee','asset','subcontractor') then
    raise exception 'Unknown kind of resource %', p_kind
      using errcode = 'check_violation';
  end if;
  if p_allocation is not null and (p_allocation <= 0 or p_allocation > 1) then
    raise exception 'An allocation is a fraction greater than zero and at most one'
      using errcode = 'check_violation';
  end if;

  v_resource := case p_kind
    when 'crew' then p_crew
    when 'employee' then p_employee
    when 'asset' then p_asset
    else p_vendor end;

  if v_resource is null then
    raise exception 'A % assignment needs a % to be chosen', p_kind,
      case p_kind when 'subcontractor' then 'vendor' else p_kind end
      using errcode = 'check_violation';
  end if;

  v_from := coalesce(p_starts_on, v_a.planned_start);
  v_to   := coalesce(p_ends_on, v_a.planned_finish);
  if v_to < v_from then
    raise exception 'An assignment cannot end before it starts'
      using errcode = 'check_violation';
  end if;

  perform app.assert_resource_is_free(p_activity, p_kind, v_resource, v_from, v_to);

  insert into resource_assignments (
    company_id, project_id, schedule_activity_id, resource_kind,
    crew_id, employee_id, asset_id, vendor_id,
    starts_on, ends_on, allocation, notes)
  values (
    v_a.company_id, v_a.project_id, p_activity, p_kind,
    case when p_kind = 'crew' then v_resource end,
    case when p_kind = 'employee' then v_resource end,
    case when p_kind = 'asset' then v_resource end,
    case when p_kind = 'subcontractor' then v_resource end,
    v_from, v_to, coalesce(p_allocation, 1), nullif(btrim(coalesce(p_notes,'')),''))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.assign_resource(uuid, text, uuid, uuid, uuid, uuid, date, date, numeric, text) is
  'Puts a crew, a person, a machine or a subcontractor on an activity, refusing a span that overlaps one the same resource already has there. The first writer of resource_assignments, which had five readers and none. WORKFLOW.';

/** Recreated so moving an assignment cannot move it on top of another. */
create or replace function app.update_resource_assignment(
  p_assignment uuid,
  p_starts_on  date default null,
  p_ends_on    date default null,
  p_allocation numeric default null,
  p_notes      text default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_r    resource_assignments%rowtype;
  v_from date;
  v_to   date;
begin
  select * into v_r from resource_assignments where id = p_assignment;
  if v_r.id is null then
    raise exception 'No such assignment' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_r.company_id, 'projects.write') then
    raise exception 'You do not have permission to staff this project'
      using errcode = 'insufficient_privilege';
  end if;
  if p_allocation is not null and (p_allocation <= 0 or p_allocation > 1) then
    raise exception 'An allocation is a fraction greater than zero and at most one'
      using errcode = 'check_violation';
  end if;

  v_from := coalesce(p_starts_on, v_r.starts_on);
  v_to   := coalesce(p_ends_on, v_r.ends_on);
  if v_to < v_from then
    raise exception 'An assignment cannot end before it starts'
      using errcode = 'check_violation';
  end if;

  if v_r.schedule_activity_id is not null
     and (v_from <> v_r.starts_on or v_to <> v_r.ends_on) then
    perform app.assert_resource_is_free(
      v_r.schedule_activity_id, v_r.resource_kind,
      coalesce(v_r.crew_id, v_r.employee_id, v_r.asset_id, v_r.vendor_id),
      v_from, v_to, p_assignment);
  end if;

  update resource_assignments
     set starts_on  = v_from,
         ends_on    = v_to,
         allocation = coalesce(p_allocation, allocation),
         notes      = coalesce(nullif(btrim(coalesce(p_notes,'')),''), notes),
         updated_at = now()
   where id = p_assignment;
end;
$$;

comment on function app.update_resource_assignment(uuid, date, date, numeric, text) is
  'Changes the dates, the share or the note on an assignment, refusing a move that lands on top of another span of the same resource. WORKFLOW.';
