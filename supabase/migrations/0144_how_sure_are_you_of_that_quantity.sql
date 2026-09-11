-- =============================================================================
-- 0144 — How sure are you of that quantity
--
-- The engine scores every line's confidence from four inputs, and three of them
-- are columns on the line: `check_primary_source`, `check_cross_source` and
-- `check_reconciliation`. `estimate-pricing.ts` reads all three and hands them
-- to `scoreConfidence`. They default to false. Nothing in the application has
-- ever written one.
--
-- The consequence is not a cosmetic score. A line with all three false and a
-- hand-entered quantity scores about 30, which is below 80, which routes it to
-- `senior_review`, which sets `blocks_issue`, which sets
-- `blocked_from_issue` on the version, which is the first thing
-- `app.approve_estimate_version` refuses on — and an estimate that cannot be
-- approved cannot be issued, cannot be awarded, and can never become a project.
--
-- So an estimate typed by hand was permanently unbiddable, and the screen could
-- only say "1 line is not confident enough to bid" with no control anywhere
-- that could answer it. The takeoff path sets `measurement_method` when a
-- quantity is measured off a sheet; a line somebody typed had no equivalent.
--
-- This is the twelfth time this repository has produced a complete, tested
-- feature with no door, and the first one that made another feature
-- unreachable rather than merely unused.
--
-- `app.update_estimate_line` is unchanged except for four names in its known
-- list and four columns in its SET. Every permission check and every
-- frozen-version rule is the same, and an unrecognized field name is still
-- refused rather than ignored.
--
-- The first draft of this migration was rebased on 0136 and silently dropped
-- `cost_code_id`, which 0137 had added — so a field that worked yesterday
-- would have started answering "an estimate line has no field called
-- cost_code_id". The suite caught it. A function that is restated in full has
-- to be restated from its *latest* definition, not from the one whose comment
-- reads closest to the change being made.
--
-- Engine: the estimate line editor.
-- =============================================================================

create or replace function app.update_estimate_line(p_line uuid, p_fields jsonb)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_status  app.estimate_status;
  v_code    uuid;
  v_known   constant text[] := array[
    'description', 'line_number', 'measured_quantity', 'quantity_expression',
    'unit', 'waste_percent', 'waste_basis', 'loss_percent', 'markup_override',
    'production_modifier', 'production_rate_id', 'crew_id', 'client_visible',
    'notes', 'sort_order', 'cost_code_id',
    /*
     * How the quantity was arrived at, and what has been checked about it.
     * These are what the engine scores confidence from, and until this
     * migration no caller could set one — so every hand-entered line sat at
     * the score a completely unverified quantity deserves and blocked its own
     * estimate from ever being issued, approved or awarded.
     */
    'measurement_method', 'check_primary_source', 'check_cross_source',
    'check_reconciliation'
  ];
  v_unknown text[];
begin
  if jsonb_typeof(p_fields) <> 'object' then
    raise exception 'The fields to change are given as an object.'
      using errcode = 'invalid_parameter_value';
  end if;

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

  /*
   * A cost code the company cannot read is a cost code that would roll this
   * line up into somebody else's budget. Checked here rather than left to the
   * foreign key, which would take any code in the table.
   */
  if p_fields ? 'cost_code_id' and nullif(p_fields->>'cost_code_id', '') is not null then
    v_code := (p_fields->>'cost_code_id')::uuid;
    if not exists (
      select 1 from cost_codes c
       where c.id = v_code
         and (c.company_id = v_company or c.company_id is null)
         and c.status = 'active')
    then
      raise exception 'That cost code is not one this company can use.'
        using errcode = 'no_data_found';
    end if;
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
         cost_code_id      = case when p_fields ? 'cost_code_id'
                                  then nullif(p_fields->>'cost_code_id', '')::uuid
                                  else l.cost_code_id end,
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
         measurement_method = coalesce((p_fields->>'measurement_method')::app.measurement_method,
                                       l.measurement_method),
         check_primary_source = coalesce((p_fields->>'check_primary_source')::boolean,
                                         l.check_primary_source),
         check_cross_source   = coalesce((p_fields->>'check_cross_source')::boolean,
                                         l.check_cross_source),
         check_reconciliation = coalesce((p_fields->>'check_reconciliation')::boolean,
                                         l.check_reconciliation),
         updated_at        = now()
   where l.id = p_line;
end;
$$;

comment on function app.update_estimate_line(uuid, jsonb) is
  'Changes what an estimator may change about a line, including how the quantity was arrived at and what has been checked about it — the three checks the engine scores confidence from, which no caller could set before migration 0144 and which left every hand-entered estimate permanently unable to be issued. Refuses a field name it does not recognize rather than silently writing nothing. ENGINE for the estimate line editors.';

/*
 * What each check means, where somebody reading the column will find it. These
 * are the estimator's own attestations about a quantity, not something the
 * platform can observe, which is exactly why they need a control rather than a
 * derivation.
 */
comment on column estimate_line_items.check_primary_source is
  'The quantity was taken from the governing document rather than from a summary, a schedule or somebody''s note. Scored by the confidence engine.';
comment on column estimate_line_items.check_cross_source is
  'The quantity was confirmed against a second independent source — a different sheet, a specification, or the owner''s own takeoff. Scored by the confidence engine.';
comment on column estimate_line_items.check_reconciliation is
  'The arithmetic was reproduced and agreed: areas sum to the whole, lengths close, counts match the schedule. Scored by the confidence engine.';

select app.assert_security_gates();
