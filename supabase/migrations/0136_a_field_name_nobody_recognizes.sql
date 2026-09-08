-- =============================================================================
-- 0136 — A field name nobody recognizes
--
-- The markup typed on an estimate line had never once been saved.
--
-- `update_estimate_line` takes the fields to change as a jsonb object and reads
-- the ones it knows: `p_fields ? 'markup_override'`, `p_fields ? 'unit'`, and
-- so on. The markup cell sent `markupOverride`. No key matched, every column
-- kept its old value through `coalesce`, the function returned without an
-- error, and the screen refetched and showed the number it had before.
--
-- Nothing failed. That is the whole problem. A typo in a field name costs
-- nothing at the moment of writing and everything at the moment somebody trusts
-- the number — and it is invisible in review, because the call site reads
-- exactly like the four beside it that happen to be spelled right.
--
-- The line-detail panel spelled it `markup_override` and worked, so the same
-- value was saveable from one place and silently discarded from another. That
-- is worse than broken: it is intermittent by location.
--
-- So an unknown key is an error. The function names what it does not recognize
-- and lists what it takes, because the fix for this is always one word and the
-- only hard part is finding out which word.
-- =============================================================================

/**
 * Change what an estimator may change about a line.
 *
 * Unchanged from 0118 except for the guard at the top. Every column, every
 * permission check and every frozen-version rule is the same.
 */
create or replace function app.update_estimate_line(p_line uuid, p_fields jsonb)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_status  app.estimate_status;
  v_known   constant text[] := array[
    'description', 'line_number', 'measured_quantity', 'quantity_expression',
    'unit', 'waste_percent', 'waste_basis', 'loss_percent', 'markup_override',
    'production_modifier', 'production_rate_id', 'crew_id', 'client_visible',
    'notes', 'sort_order'
  ];
  v_unknown text[];
begin
  if jsonb_typeof(p_fields) <> 'object' then
    raise exception 'The fields to change are given as an object.'
      using errcode = 'invalid_parameter_value';
  end if;

  /*
   * Before anything else, because a call that names a field this function does
   * not have is a call that was going to change nothing and say it worked.
   */
  select array_agg(k order by k) into v_unknown
    from jsonb_object_keys(p_fields) k
   where k <> all (v_known);

  if v_unknown is not null then
    raise exception 'An estimate line has no % — nothing would have been saved.',
      case when array_length(v_unknown, 1) = 1
           then format('field called "%s"', v_unknown[1])
           else format('fields called %s', array_to_string(v_unknown, ', ')) end
      using errcode = 'undefined_column',
            hint = format('It takes: %s. Field names are the column names, so markup_override rather than markupOverride.',
                          array_to_string(v_known, ', '));
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
  if v_status not in ('draft', 'in_review') then
    raise exception 'This version is %; make a new version to change it', v_status
      using errcode = 'check_violation',
            hint = 'app.revise_estimate_version copies it forward with a reason.';
  end if;

  update estimate_line_items l
     set description       = coalesce(p_fields->>'description', l.description),
         line_number       = coalesce(p_fields->>'line_number', l.line_number),
         measured_quantity = coalesce((p_fields->>'measured_quantity')::numeric,
                                      l.measured_quantity),
         quantity_expression = case
                                 when p_fields ? 'quantity_expression'
                                 then nullif(trim(coalesce(p_fields->>'quantity_expression', '')), '')
                                 else l.quantity_expression end,
         unit              = coalesce((p_fields->>'unit')::app.unit_code, l.unit),
         waste_percent     = coalesce((p_fields->>'waste_percent')::numeric, l.waste_percent),
         waste_basis       = coalesce(p_fields->>'waste_basis', l.waste_basis),
         loss_percent      = coalesce((p_fields->>'loss_percent')::numeric, l.loss_percent),
         markup_override   = case when p_fields ? 'markup_override'
                                  then (p_fields->>'markup_override')::numeric
                                  else l.markup_override end,
         production_modifier = coalesce((p_fields->>'production_modifier')::numeric,
                                        l.production_modifier),
         production_rate_id  = case when p_fields ? 'production_rate_id'
                                    then (p_fields->>'production_rate_id')::uuid
                                    else l.production_rate_id end,
         crew_id             = case when p_fields ? 'crew_id'
                                    then (p_fields->>'crew_id')::uuid
                                    else l.crew_id end,
         client_visible    = coalesce((p_fields->>'client_visible')::boolean, l.client_visible),
         notes             = coalesce(p_fields->>'notes', l.notes),
         sort_order        = coalesce((p_fields->>'sort_order')::int, l.sort_order),
         updated_at        = now()
   where l.id = p_line;
end;
$$;

comment on function app.update_estimate_line(uuid, jsonb) is
  'Changes what an estimator may change about a line. Refuses a field name it does not recognize rather than silently writing nothing, because a misspelled key returns success and leaves the old number on the screen. ENGINE for the estimate line editors.';

select app.assert_security_gates();
