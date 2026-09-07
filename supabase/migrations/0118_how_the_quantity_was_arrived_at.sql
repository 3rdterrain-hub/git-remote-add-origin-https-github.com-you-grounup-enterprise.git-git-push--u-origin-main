-- =============================================================================
-- 0118 — How the quantity was arrived at
--
-- A quantity is almost never a number somebody knows. It is 120 feet by 4 feet
-- by 8 inches, or 42 footings at 1.2 cubic yards, or a takeoff of 3,180 less
-- the 240 already in place. That arithmetic happens somewhere — a calculator, a
-- spreadsheet, the back of the drawing — and then the answer is typed in.
--
-- What arrives in `measured_quantity` is therefore a number with no account of
-- itself, and the most common expensive mistake in estimating is a decimal
-- point in the wrong place inside a calculation nobody can see. A reviewer
-- looking at 320.16 cubic yards has no way to ask "of what?".
--
-- So the expression is kept beside the number it produced. `quantity_expression`
-- holds what the estimator typed; `measured_quantity` holds what it came to,
-- and stays the only figure anything computes from. The engine is untouched:
-- this is provenance, not arithmetic. `@grounup/engine`'s `evaluateQuantity`
-- does the evaluation, in a parser rather than an interpreter, so an
-- estimator's text is never a code path.
--
-- One rule worth stating: an expression that is *only* a number is not stored.
-- "1800" beside a quantity of 1800 explains nothing and would make every line
-- look calculated.
-- =============================================================================

alter table estimate_line_items
  add column if not exists quantity_expression text
    check (quantity_expression is null
           or length(trim(quantity_expression)) between 1 and 200);

comment on column estimate_line_items.quantity_expression is
  'What the estimator typed to arrive at the measured quantity, when it was a calculation rather than a figure. Provenance for a number a reviewer would otherwise have to take on trust; `measured_quantity` remains the only value anything computes from.';

/**
 * Set a line's quantity, and how it was arrived at.
 *
 * The two move together on purpose. A quantity changed without its expression
 * would leave a stale calculation beside a number it no longer produces, which
 * is worse than no calculation at all — so supplying a quantity and no
 * expression clears the old one.
 */
create or replace function app.set_line_quantity(
  p_line uuid,
  p_quantity numeric,
  p_expression text default null)
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_status  app.estimate_status;
  v_expr    text;
begin
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
  if p_quantity is null or p_quantity < 0 then
    raise exception 'A quantity is zero or more' using errcode = 'check_violation';
  end if;

  /*
   * An expression that is only a number explains nothing. Storing "1800" beside
   * a quantity of 1800 would make every line look calculated and give a
   * reviewer one more thing to read that says nothing.
   */
  v_expr := nullif(trim(coalesce(p_expression, '')), '');
  if v_expr is not null and v_expr ~ '^[0-9]+(\.[0-9]+)?$' then
    v_expr := null;
  end if;

  update estimate_line_items
     set measured_quantity = p_quantity,
         quantity_expression = v_expr
   where id = p_line;
end;
$$;

comment on function app.set_line_quantity(uuid, numeric, text) is
  'Sets a line''s measured quantity together with the calculation it came from. WORKFLOW: the two move as one so a stale expression can never sit beside a number it does not produce.';

create or replace function public.set_line_quantity(
  p_line uuid, p_quantity numeric, p_expression text default null)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.set_line_quantity(p_line, p_quantity, p_expression); end; $$;

do $$
begin
  execute 'revoke all on function public.set_line_quantity(uuid, numeric, text) from public, anon';
  execute 'grant execute on function public.set_line_quantity(uuid, numeric, text) to authenticated';
end $$;

/*
 * The line editor learns the same field, so a screen that edits a line all at
 * once and a screen that edits only the quantity agree about what happens to
 * the expression.
 */
create or replace function app.update_estimate_line(p_line uuid, p_fields jsonb)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_company uuid; v_status app.estimate_status;
begin
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
         unit              = coalesce(nullif(p_fields->>'unit', '')::app.unit_code, l.unit),
         waste_percent     = coalesce((p_fields->>'waste_percent')::numeric, l.waste_percent),
         loss_percent      = coalesce((p_fields->>'loss_percent')::numeric, l.loss_percent),
         waste_basis       = coalesce(p_fields->>'waste_basis', l.waste_basis),
         production_modifier =
           coalesce((p_fields->>'production_modifier')::numeric, l.production_modifier),
         client_visible    = coalesce((p_fields->>'client_visible')::boolean, l.client_visible),
         markup_override   = case when p_fields ? 'markup_override'
                                  then (p_fields->>'markup_override')::numeric
                                  else l.markup_override end,
         notes             = coalesce(p_fields->>'notes', l.notes),
         sort_order        = coalesce((p_fields->>'sort_order')::int, l.sort_order),
         crew_id           = coalesce((p_fields->>'crew_id')::uuid, l.crew_id),
         production_rate_id = coalesce((p_fields->>'production_rate_id')::uuid,
                                       l.production_rate_id),
         updated_at        = now()
   where l.id = p_line;
end;
$$;

select app.assert_security_gates();
