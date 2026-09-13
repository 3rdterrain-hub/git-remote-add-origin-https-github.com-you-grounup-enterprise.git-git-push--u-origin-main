-- =============================================================================
-- 0168 — The AI builds the estimate; the engine still does the arithmetic
--
-- Asked on 13 September 2026: why can the AI not get the information and build
-- the estimate with the proper crew, equipment, materials and hauling to come
-- up with a number?
--
-- It can, and it should, and the question describes the right design. What it
-- must not do is the multiplication — and that is a much smaller restriction
-- than it sounds, because the multiplication is the part that has to be
-- reproducible.
--
--   * **Selecting** the crew, the machines, the materials and the haul is
--     judgment, and judgment is what a model is good at. That is most of the
--     work in building an estimate and the AI can do all of it.
--   * **Computing** 8,400 CY at 75 CY/hr over 0.83 utilization and 0.85
--     calendar efficiency at $118 an hour is arithmetic, and arithmetic asked
--     of a model twice gives two answers. A bid nobody can reproduce is a bid
--     nobody can defend — not to a customer, not in a claim, and not to the
--     estimator who has to explain it on Monday.
--
-- So a finding may now carry a whole build-up, and accepting it writes the
-- line, the crew, the machines, the materials and the haul in one go. The
-- engine then prices what was written, exactly as it prices a line a person
-- built by hand, and the derivation comes out the same way.
--
-- One rule makes the difference between this and a model inventing a bid: **the
-- AI names library codes, never rates.** It says "Underground utility crew" and
-- "Excavator 20-25 ton"; the library says what they cost, under RULE-003. A
-- code that does not resolve is refused with its reason rather than filled in
-- with a number nobody chose.
-- =============================================================================

/**
 * Resolve one proposed resource against the library and put it on the line.
 *
 * Returns the reason it could not be placed, or null where it was. Reasons are
 * collected rather than raised, because an email that produced eleven good
 * lines and one unmatchable machine should give you eleven lines and a note —
 * not an error and nothing.
 */
create or replace function app.place_proposed_resource(
  p_line uuid, p_company uuid, p_item jsonb)
returns text
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_kind   text := nullif(trim(p_item ->> 'kind'), '');
  v_code   text;
  v_id     uuid;
  v_fields jsonb;
begin
  if v_kind is null or v_kind not in ('labor', 'equipment', 'material', 'trucking',
                                      'subcontract', 'disposal') then
    return format('a resource of kind %s is not something a line carries',
                  coalesce(v_kind, 'unnamed'));
  end if;

  /*
   * Everything the model is allowed to say about money is which library row to
   * use. The rate comes from that row, so an estimate built this way is priced
   * at the company's own approved numbers rather than at a guess.
   */
  v_fields := coalesce(p_item -> 'fields', '{}'::jsonb);

  if v_kind = 'labor' then
    v_code := nullif(trim(p_item ->> 'labor_rate_code'), '');
    if v_code is not null then
      select id into v_id from labor_rates
       where upper(code) = upper(v_code)
         and (company_id = p_company or company_id is null)
         and status = 'active'
       order by company_id nulls last limit 1;
      if v_id is null then
        return format('no labor classification with the code %s', v_code);
      end if;
      v_fields := v_fields || jsonb_build_object('labor_rate_id', v_id);
    elsif (v_fields ->> 'base_rate') is null then
      return 'a crew row needs either a library classification or a wage somebody entered';
    end if;

  elsif v_kind = 'equipment' then
    v_code := nullif(trim(p_item ->> 'equipment_code'), '');
    if v_code is null then
      return 'a machine has to name a library record; a rate on its own is not a machine';
    end if;
    select id into v_id from equipment
     where upper(code) = upper(v_code)
       and (company_id = p_company or company_id is null)
       and status = 'active'
     order by company_id nulls last limit 1;
    if v_id is null then
      return format('no machine with the code %s', v_code);
    end if;
    v_fields := v_fields || jsonb_build_object('equipment_id', v_id);

  elsif v_kind = 'material' then
    v_code := nullif(trim(p_item ->> 'material_code'), '');
    if v_code is null then
      return 'a material has to name a library record so its price is the one you filed';
    end if;
    select id into v_id from materials
     where upper(code) = upper(v_code)
       and (company_id = p_company or company_id is null)
       and status = 'active'
     order by company_id nulls last limit 1;
    if v_id is null then
      return format('no material with the code %s', v_code);
    end if;
    v_fields := v_fields || jsonb_build_object('material_id', v_id);
  end if;

  perform app.save_line_resource(p_line, v_kind, v_fields, null);
  return null;
exception when others then
  -- A single bad row must not cost the estimate the other ten.
  return format('%s row refused: %s', v_kind, sqlerrm);
end;
$$;

comment on function app.place_proposed_resource(uuid, uuid, jsonb) is
  'Resolves one AI-proposed resource against the library and puts it on a line, or returns why it could not. The model names a code; the library supplies the rate under RULE-003. ENGINE.';

revoke all on function app.place_proposed_resource(uuid, uuid, jsonb) from public, anon, authenticated;

/**
 * Accept a finding as a whole line, with what it takes to do the work.
 *
 * Supersedes the quantity-only version in 0119, which wrote a bare line and
 * left somebody to build it up by hand — the very work the model had already
 * done. A payload may now carry a service, a quantity and a list of resources,
 * and all of it lands together.
 *
 * A scope with no quantity is still accepted, at zero, because an email saying
 * "regrade the lot and replace the drive" names real work and no dimensions.
 * The line arrives blocking issue until somebody measures it, which is the
 * honest state rather than a quantity nobody took off.
 *
 * Returns the line. What could not be placed is recorded on the line's notes,
 * so the reason travels with the work rather than living in a toast nobody
 * kept.
 */
create or replace function app.accept_finding_as_line(
  p_finding uuid,
  p_version uuid,
  p_note text default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_f        ai_findings%rowtype;
  v_company  uuid;
  v_status   app.estimate_status;
  v_qty      numeric;
  v_unit     app.unit_code;
  v_service  uuid;
  v_code     text;
  v_line     uuid;
  v_item     jsonb;
  v_problem  text;
  v_problems text[] := '{}';
begin
  select * into v_f from ai_findings where id = p_finding;
  if not found then
    raise exception 'No such finding' using errcode = 'no_data_found';
  end if;

  select v.company_id, v.status into v_company, v_status
  from estimate_versions v where v.id = p_version;
  if v_company is null then
    raise exception 'No such estimate version' using errcode = 'no_data_found';
  end if;
  if v_f.company_id <> v_company then
    raise exception 'That finding belongs to another company'
      using errcode = 'insufficient_privilege';
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
   * Widened from quantity candidates alone. A scope read out of an email is a
   * `scope_item`, and refusing it was refusing the case this exists for.
   */
  if v_f.finding_type not in ('quantity_candidate', 'scope_item', 'service_candidate') then
    raise exception 'A % does not become a line', v_f.finding_type
      using errcode = 'check_violation';
  end if;
  if v_f.state <> 'proposed' then
    raise exception 'That finding has already been %', v_f.state
      using errcode = 'check_violation',
            hint = 'A finding accepted twice would double a quantity somebody entered once.';
  end if;

  v_qty  := nullif(v_f.payload ->> 'quantity', '')::numeric;
  v_unit := nullif(v_f.payload ->> 'unit', '')::app.unit_code;
  if v_qty is not null and v_qty < 0 then
    raise exception 'That finding carries a negative quantity' using errcode = 'check_violation';
  end if;
  /*
   * A quantity candidate claims a measurement, so one with no number is a
   * broken finding and is refused as it always was. A scope item claims only
   * that the work exists — an email saying "regrade the lot and replace the
   * drive" names real work and no dimensions — so it is allowed through at
   * zero. That is only safe because the approval gate below now refuses a line
   * somebody built and never measured.
   */
  if v_qty is null then
    if v_f.finding_type = 'quantity_candidate' then
      raise exception 'That finding carries no usable quantity'
        using errcode = 'check_violation';
    end if;
    v_qty := 0;
  end if;

  -- The service, by its code. Naming the library is the whole discipline here.
  v_code := nullif(trim(v_f.payload ->> 'service_code'), '');
  if v_code is not null then
    select id into v_service from services
     where upper(code) = upper(v_code)
       and (company_id = v_company or company_id is null)
       and status = 'active'
     order by company_id nulls last limit 1;
    if v_service is null then
      v_problems := v_problems || format('no service with the code %s', v_code);
    end if;
  end if;

  v_line := app.add_estimate_line(p_version, v_service, v_f.title, v_qty, coalesce(v_unit, 'LS'));

  -- What it takes to do the work, in the order the model listed it.
  for v_item in
    select value from jsonb_array_elements(coalesce(v_f.payload -> 'resources', '[]'::jsonb))
  loop
    v_problem := app.place_proposed_resource(v_line, v_company, v_item);
    if v_problem is not null then
      v_problems := v_problems || v_problem;
    end if;
  end loop;

  update estimate_line_items
     set origin = 'ai_suggested',
         ai_agent_id = v_f.agent_id,
         ai_accepted_by = auth.uid(),
         ai_accepted_at = now(),
         source_references = coalesce(v_f.sheet_references, '{}'),
         notes = nullif(trim(concat_ws(E'\n',
                   nullif(trim(coalesce(p_note, '')), ''),
                   case when cardinality(v_problems) > 0
                        then 'Not placed from the proposal: '
                             || array_to_string(v_problems, '; ')
                   end)), '')
   where id = v_line;

  /*
   * `reviewed_by` and `reviewed_at`, which the 0008 constraint requires and the
   * trigger checks: an AI finding can never be born accepted, and acceptance
   * without an identified human is refused outright. RULE-008 is not a
   * convention here, it is a check constraint.
   */
  update ai_findings
     set state = 'accepted',
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_note = nullif(trim(coalesce(p_note, '')), ''),
         applied_entity_table = 'estimate_line_items',
         applied_entity_id = v_line
   where id = p_finding;

  return v_line;
end;
$$;

comment on function app.accept_finding_as_line(uuid, uuid, text) is
  'Accepts an AI finding as an estimate line together with the crew, machines, materials and hauling it proposed, each resolved against the library by code. The engine prices what lands, exactly as it prices a line built by hand. WORKFLOW.';

revoke all on function app.accept_finding_as_line(uuid, uuid, text) from public, anon;
grant execute on function app.accept_finding_as_line(uuid, uuid, text) to authenticated;

create or replace function public.accept_finding_as_line(
  p_finding uuid, p_version uuid, p_note text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.accept_finding_as_line(p_finding, p_version, p_note); $$;

revoke all on function public.accept_finding_as_line(uuid, uuid, text) from public, anon;
grant execute on function public.accept_finding_as_line(uuid, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- The gate that lets an unmeasured line through
--
-- Approval already refuses a line with a quantity and no price. It does not
-- refuse the opposite — a line carrying a crew, a machine and a material, and
-- no quantity at all — which prices to zero and sits in the total contributing
-- nothing. Nobody noticed because nothing could create one: the library picker
-- makes bare lines at zero and the engine refuses those outright as having
-- nothing to price.
--
-- A proposed scope can create one, so the gate has to close. A line with
-- resources on it and no measurement is work somebody intends to do and nobody
-- has taken off, and it must not reach a customer at zero.
-- -----------------------------------------------------------------------------
create or replace function app.move_estimate_status(
  p_version uuid, p_status app.estimate_status, p_reason text default null)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_v          estimate_versions%rowtype;
  v_lines      int;
  v_unpriced   int;
  v_unmeasured text;
  v_snapshot   uuid;
begin
  select * into v_v from estimate_versions where id = p_version;
  if not found then
    raise exception 'No such estimate version' using errcode = 'no_data_found';
  end if;

  select count(*), count(*) filter (where total_direct_cost = 0 and measured_quantity > 0)
    into v_lines, v_unpriced
  from estimate_line_items where estimate_version_id = p_version;

  if p_status = 'approved' then
    if v_lines = 0 then
      raise exception 'There is nothing on this estimate to approve'
        using errcode = 'check_violation';
    end if;
    if v_unpriced > 0 then
      raise exception '% line(s) have a quantity and no price. Price it first', v_unpriced
        using errcode = 'check_violation',
              hint = 'Pricing runs the engine over every line and writes what it costs.';
    end if;

    select string_agg(coalesce(nullif(l.line_number, ''), l.description), ', '
                      order by l.sort_order)
      into v_unmeasured
    from estimate_line_items l
    where l.estimate_version_id = p_version
      and coalesce(l.measured_quantity, 0) = 0
      and exists (select 1 from estimate_line_resources r where r.line_item_id = l.id);
    if v_unmeasured is not null then
      raise exception 'These lines carry a build-up and no quantity: %', v_unmeasured
        using errcode = 'check_violation',
              hint = 'Work somebody intends to do and nobody has measured prices at zero. Take it off first.';
    end if;

    /*
     * Not your own — below tier 3. The oldest rule in a bid room: the person
     * who wants the job is not the person who decides the number is right.
     */
    if v_v.created_by = auth.uid() and app.approval_tier(v_v.company_id) < 3 then
      raise exception 'The person who built an estimate cannot be the one who approves it'
        using errcode = 'insufficient_privilege',
              hint = 'Somebody at chief-estimator authority or above has to sign this off.';
    end if;
    perform app.assert_not_expired(p_version);
    perform app.assert_issuable(p_version);
    if v_v.library_snapshot_id is null then
      v_snapshot := app.capture_library_snapshot(p_version);
      update estimate_versions set library_snapshot_id = v_snapshot where id = p_version;
    end if;
  end if;

  if p_status = 'issued' then
    if v_v.status <> 'approved' then
      raise exception 'An estimate is approved before it is issued'
        using errcode = 'check_violation';
    end if;
    perform app.assert_not_expired(p_version);
    perform app.assert_issuable(p_version);
  end if;
  if v_v.status in ('issued', 'awarded', 'lost') and p_status in ('draft', 'in_review') then
    raise exception 'This version has already gone out; make a new version instead'
      using errcode = 'check_violation',
            hint = 'app.revise_estimate_version copies it forward with a reason.';
  end if;

  update estimate_versions
     set status = p_status,
         approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
         approved_at = case when p_status = 'approved' then now() else approved_at end,
         issued_by   = case when p_status = 'issued'   then auth.uid() else issued_by end,
         issued_at   = case when p_status = 'issued'   then now() else issued_at end,
         updated_at = now()
   where id = p_version;

  update estimates e set status = p_status, updated_at = now()
   where e.id = v_v.estimate_id and e.current_version_id = p_version;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (v_v.company_id, auth.uid(),
          case when p_status = 'approved' then 'approve'
               when p_status = 'issued' then 'issue'
               when p_status = 'awarded' then 'award'
               when p_status = 'lost' then 'reject'
               else 'update' end::app.audit_action,
          'public.estimate_versions', p_version::text,
          jsonb_build_object('status', p_status, 'was', v_v.status),
          nullif(trim(coalesce(p_reason, '')), ''));
end;
$$;

select app.assert_security_gates();
