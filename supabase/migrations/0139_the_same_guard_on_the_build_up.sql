-- =============================================================================
-- 0139 — The same guard, on the build-up
--
-- Migration 0136 made `update_estimate_line` refuse a field name it does not
-- recognize, after a markup typed on a line turned out never to have been
-- saved: the key was `markupOverride`, the function reads `markup_override`, no
-- key matched, every column kept its value through `coalesce`, and the call
-- returned success.
--
-- `save_line_resource` had the identical shape and the identical exposure. It
-- takes the crew, the equipment, the materials, the hauling and the subs behind
-- the wrench — five tabs, thirty-four fields, every one of them read by name
-- out of a jsonb object. Every key the screens currently send is spelled right;
-- that was checked field by field rather than assumed. But "correct today" is
-- not a property, it is a coincidence, and the failure mode is invisible: the
-- number goes back to what it was and nothing says why.
--
-- So the same rule reaches the build-up. An unknown key names itself and lists
-- what the function takes.
-- =============================================================================

create or replace function app.save_line_resource(
  p_line uuid,
  p_kind text,
  p_fields jsonb,
  p_resource uuid default null)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_status  app.estimate_status;
  v_id      uuid;
  v_sort    int;
  v_known   constant text[] := array[
    'average_speed_mph',
    'base_rate',
    'burden_rate',
    'capacity_unit',
    'description',
    'disposal_site_id',
    'drives_hours',
    'dump_minutes',
    'equipment_id',
    'haul_mode',
    'headcount',
    'hours',
    'includes_disposal',
    'is_owned',
    'labor_rate_id',
    'load_minutes',
    'material_id',
    'minimum_hours',
    'mobilization_cost',
    'notes',
    'production_per_hour',
    'quantity',
    'queue_minutes',
    'rate_basis',
    'role',
    'round_trip_miles',
    'sort_order',
    'standby_days',
    'tons_per_load',
    'truck_capacity',
    'trucking_rate_id',
    'unit',
    'unit_rate',
    'vendor_id'
  ];
  v_unknown text[];
begin
  if jsonb_typeof(p_fields) <> 'object' then
    raise exception 'The fields to save are given as an object.'
      using errcode = 'invalid_parameter_value';
  end if;

  /*
   * An unrecognized key would be dropped in silence, and every column would
   * keep the value it already had while the call reported success. That is
   * exactly how a markup typed on a line went unsaved for months.
   */
  select array_agg(k order by k) into v_unknown
    from jsonb_object_keys(p_fields) k
   where k <> all (v_known);

  /*
   * The list goes in the message rather than the hint. A hint is dropped by
   * most drivers before it reaches anybody, and the whole value of this error
   * is that the fix is one word — the only hard part is finding out which.
   */
  if v_unknown is not null then
    raise exception 'A line resource has no % — nothing would have been saved. It takes: %.',
      case when array_length(v_unknown, 1) = 1
           then format('field called "%s"', v_unknown[1])
           else format('fields called %s', array_to_string(v_unknown, ', ')) end,
      array_to_string(v_known, ', ')
      using errcode = 'undefined_column';
  end if;

  select l.company_id, v.status into v_company, v_status
  from estimate_line_items l
  join estimate_versions v on v.id = l.estimate_version_id
  where l.id = p_line;

  if v_company is null then
    raise exception 'No such estimate line' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'estimates.write') then
    raise exception 'You do not have permission to change this estimate'
      using errcode = 'insufficient_privilege';
  end if;
  /*
   * RULE-009 freezes a version's content. It has always been enforced on the
   * version row and on the line; nothing stopped a machine being added to an
   * approved estimate through its resources.
   */
  if v_status not in ('draft', 'in_review') then
    raise exception 'This version is %; make a new version to change it', v_status
      using errcode = 'check_violation',
            hint = 'app.revise_estimate_version copies it forward with a reason.';
  end if;
  if p_kind not in ('labor', 'equipment', 'material', 'trucking', 'disposal', 'subcontract') then
    raise exception 'A resource is labor, equipment, material, trucking, disposal or subcontract, not %',
      p_kind using errcode = 'check_violation';
  end if;

  if p_resource is null then
    select coalesce(max(sort_order), 0) + 10 into v_sort
    from estimate_line_resources where line_item_id = p_line;

    insert into estimate_line_resources (
      company_id, line_item_id, resource_kind, sort_order,
      description, role, notes,
      quantity, unit, unit_rate, hours, headcount,
      base_rate, burden_rate,
      drives_hours, production_per_hour,
      rate_basis, mobilization_cost, standby_days, minimum_hours, is_owned,
      haul_mode, round_trip_miles, average_speed_mph, truck_capacity,
      tons_per_load, load_minutes, dump_minutes, queue_minutes, includes_disposal,
      labor_rate_id, equipment_id, material_id, trucking_rate_id,
      disposal_site_id, vendor_id)
    values (
      v_company, p_line, p_kind, v_sort,
      p_fields->>'description', p_fields->>'role', p_fields->>'notes',
      coalesce((p_fields->>'quantity')::numeric, 0),
      nullif(p_fields->>'unit', '')::app.unit_code,
      coalesce((p_fields->>'unit_rate')::numeric, 0),
      coalesce((p_fields->>'hours')::numeric, 0),
      (p_fields->>'headcount')::int,
      (p_fields->>'base_rate')::numeric, (p_fields->>'burden_rate')::numeric,
      coalesce((p_fields->>'drives_hours')::boolean, false),
      (p_fields->>'production_per_hour')::numeric,
      coalesce(p_fields->>'rate_basis', 'hour'),
      coalesce((p_fields->>'mobilization_cost')::numeric, 0),
      coalesce((p_fields->>'standby_days')::numeric, 0),
      (p_fields->>'minimum_hours')::numeric,
      coalesce((p_fields->>'is_owned')::boolean, true),
      coalesce(p_fields->>'haul_mode', 'hours'),
      (p_fields->>'round_trip_miles')::numeric,
      (p_fields->>'average_speed_mph')::numeric,
      (p_fields->>'truck_capacity')::numeric,
      (p_fields->>'tons_per_load')::numeric,
      (p_fields->>'load_minutes')::numeric,
      (p_fields->>'dump_minutes')::numeric,
      (p_fields->>'queue_minutes')::numeric,
      coalesce((p_fields->>'includes_disposal')::boolean, false),
      (p_fields->>'labor_rate_id')::uuid, (p_fields->>'equipment_id')::uuid,
      (p_fields->>'material_id')::uuid, (p_fields->>'trucking_rate_id')::uuid,
      (p_fields->>'disposal_site_id')::uuid, (p_fields->>'vendor_id')::uuid)
    returning id into v_id;
    return v_id;
  end if;

  /*
   * An update touches only the keys that were sent. An estimator changing a
   * count should not have to send back the whole row, and a partial send that
   * blanked everything else would be the worst kind of silent loss.
   */
  update estimate_line_resources r
     set description  = coalesce(p_fields->>'description', r.description),
         role         = coalesce(p_fields->>'role', r.role),
         notes        = coalesce(p_fields->>'notes', r.notes),
         quantity     = coalesce((p_fields->>'quantity')::numeric, r.quantity),
         unit         = coalesce(nullif(p_fields->>'unit', '')::app.unit_code, r.unit),
         unit_rate    = coalesce((p_fields->>'unit_rate')::numeric, r.unit_rate),
         hours        = coalesce((p_fields->>'hours')::numeric, r.hours),
         headcount    = coalesce((p_fields->>'headcount')::int, r.headcount),
         base_rate    = coalesce((p_fields->>'base_rate')::numeric, r.base_rate),
         burden_rate  = coalesce((p_fields->>'burden_rate')::numeric, r.burden_rate),
         drives_hours = coalesce((p_fields->>'drives_hours')::boolean, r.drives_hours),
         production_per_hour =
           coalesce((p_fields->>'production_per_hour')::numeric, r.production_per_hour),
         rate_basis   = coalesce(p_fields->>'rate_basis', r.rate_basis),
         mobilization_cost =
           coalesce((p_fields->>'mobilization_cost')::numeric, r.mobilization_cost),
         standby_days = coalesce((p_fields->>'standby_days')::numeric, r.standby_days),
         minimum_hours = coalesce((p_fields->>'minimum_hours')::numeric, r.minimum_hours),
         is_owned     = coalesce((p_fields->>'is_owned')::boolean, r.is_owned),
         haul_mode    = coalesce(p_fields->>'haul_mode', r.haul_mode),
         round_trip_miles =
           coalesce((p_fields->>'round_trip_miles')::numeric, r.round_trip_miles),
         average_speed_mph =
           coalesce((p_fields->>'average_speed_mph')::numeric, r.average_speed_mph),
         truck_capacity = coalesce((p_fields->>'truck_capacity')::numeric, r.truck_capacity),
         tons_per_load = coalesce((p_fields->>'tons_per_load')::numeric, r.tons_per_load),
         load_minutes = coalesce((p_fields->>'load_minutes')::numeric, r.load_minutes),
         dump_minutes = coalesce((p_fields->>'dump_minutes')::numeric, r.dump_minutes),
         queue_minutes = coalesce((p_fields->>'queue_minutes')::numeric, r.queue_minutes),
         includes_disposal =
           coalesce((p_fields->>'includes_disposal')::boolean, r.includes_disposal),
         sort_order   = coalesce((p_fields->>'sort_order')::int, r.sort_order),
         updated_at   = now()
   where r.id = p_resource and r.line_item_id = p_line
  returning r.id into v_id;

  if v_id is null then
    raise exception 'No such resource on that line' using errcode = 'no_data_found';
  end if;
  return v_id;
end;
$$;
comment on function app.save_line_resource(uuid, text, jsonb, uuid) is
  'Adds or changes one crew member, machine, material, haul or sub on a line. Refuses a field name it does not recognize rather than dropping it in silence, because a key that matches nothing writes nothing and reports success. ENGINE for the line build-up tabs.';

select app.assert_security_gates();
