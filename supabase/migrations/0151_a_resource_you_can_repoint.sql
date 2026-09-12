-- =============================================================================
-- 0151 — A resource you can repoint
--
-- Migration 0139 made `save_line_resource` refuse a field name it does not
-- recognize, because a key that matches nothing writes nothing and reports
-- success — the `markupOverride` defect, where a markup typed on a line went
-- unsaved for months. The guard works. It asks whether a key is *known*.
--
-- It does not ask whether a known key is *applied*, and six of them are not.
-- `labor_rate_id`, `equipment_id`, `material_id`, `trucking_rate_id`,
-- `disposal_site_id` and `vendor_id` are written on insert and appear in the
-- accepted list, and the UPDATE branch never mentions them. Send one on an
-- existing row and the guard approves it, the update runs, the column keeps
-- what it had, and the call returns the resource id. The same shape as the
-- defect the guard was built to stop, one layer further in.
--
-- Nothing on screen sent them, which is why it went unnoticed: the name of a
-- row already on a line was a plain text box, so an estimator could rename
-- "Crushed stone" to "Pit run" and the row went on pointing at crushed stone.
-- That link is not decoration. `capture_library_snapshot` (0098) reads all six
-- to record what actually priced a version, so the audit trail said one thing
-- and the line said another, and the bid went out.
--
-- Two changes:
--
--   * **The identity columns are applied on update.** Repointing a row at a
--     different library record is now a thing a person can do.
--
--   * **Clearing one is expressible.** `coalesce(new, old)` cannot say "set
--     this to nothing" — null means "leave it", which is right for a number
--     somebody did not send and wrong for a link somebody is removing. These
--     six read key *presence* instead: send `material_id: null` and the link
--     goes, because a row whose name was retyped by hand is no longer the
--     library row it came from, and leaving the old link would be the same lie
--     in the other direction.
--
-- Every other field keeps `coalesce`. A partial send must not blank a column
-- nobody mentioned, which is the reason that shape was chosen in 0108.
--
-- Engine: the line build-up behind the wrench.
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
   *
   * The six library links are the exception, and they read key presence rather
   * than value. For a number, a null means "I did not send this"; for a link,
   * it has to be able to mean "there is no longer one" — a row renamed by hand
   * is not the library row it came from, and a stale link is what
   * `capture_library_snapshot` would go on recording as the thing that priced
   * the bid.
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

         labor_rate_id = case when p_fields ? 'labor_rate_id'
                              then nullif(p_fields->>'labor_rate_id', '')::uuid
                              else r.labor_rate_id end,
         equipment_id  = case when p_fields ? 'equipment_id'
                              then nullif(p_fields->>'equipment_id', '')::uuid
                              else r.equipment_id end,
         material_id   = case when p_fields ? 'material_id'
                              then nullif(p_fields->>'material_id', '')::uuid
                              else r.material_id end,
         trucking_rate_id = case when p_fields ? 'trucking_rate_id'
                              then nullif(p_fields->>'trucking_rate_id', '')::uuid
                              else r.trucking_rate_id end,
         disposal_site_id = case when p_fields ? 'disposal_site_id'
                              then nullif(p_fields->>'disposal_site_id', '')::uuid
                              else r.disposal_site_id end,
         vendor_id     = case when p_fields ? 'vendor_id'
                              then nullif(p_fields->>'vendor_id', '')::uuid
                              else r.vendor_id end,

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
  'Adds or changes one crew member, machine, material, haul or sub on a line. Refuses a field name it does not recognize rather than dropping it in silence, and applies the six library links on update as well as insert — sending one as null removes it, because a row renamed by hand is no longer the library row it came from. ENGINE for the line build-up tabs.';

select app.assert_security_gates();
