-- =============================================================================
-- 0149 — A condition you can click
--
-- `estimate_line_modifiers` has existed since migration 0006: a line, a
-- condition from the library, the factors it applied, and a justification the
-- table itself insists is at least ten characters long. The engine reads them —
-- `estimate-pricing.ts` builds `modifiers.combined` from exactly this table and
-- the engine multiplies labor, equipment, material, trucking and disposal cost
-- by what comes out.
--
-- The only writers are the template and revision copiers from 0112, which move
-- conditions that already exist from one version to the next. Nothing has ever
-- let a person put one on a line. So the COND. column on the estimate row has
-- rendered `1.0x` as plain gray text since the day it was built — a number that
-- can never be anything else, on a column that exists to be changed.
--
-- Two functions, and the justification is the reason they are functions rather
-- than an insert. A condition multiplies what a job costs; a bid carrying one
-- that nobody explained is the thing the ten-character check was put there to
-- stop, and a screen that could write the row directly could write it empty.
--
-- Engine: the estimate line.
-- =============================================================================

/**
 * Put a condition on a line, with the reason it applies.
 *
 * Re-applying the same condition rewrites the justification rather than
 * failing, because the common edit is somebody improving the wording rather
 * than adding it twice — and `unique (line_item_id, condition_modifier_id)`
 * means the alternative is an error a person can do nothing useful with.
 */
create or replace function app.apply_line_condition(
  p_line uuid,
  p_modifier uuid,
  p_justification text)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_status  app.estimate_status;
  v_factors jsonb;
begin
  select l.company_id, v.status into v_company, v_status
  from estimate_line_items l
  join estimate_versions v on v.id = l.estimate_version_id
  where l.id = p_line;

  if v_company is null then
    raise exception 'That estimate line does not exist' using errcode = 'no_data_found';
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
  if p_justification is null or length(trim(p_justification)) < 10 then
    raise exception 'Say why this condition applies to this line'
      using errcode = 'check_violation',
            hint = 'A condition multiplies what the work costs. Ten characters at least.';
  end if;

  /*
   * The factors are copied onto the row as they stood when it was applied. A
   * library modifier that is later retuned must not silently re-price a bid
   * that already went out — the same reasoning as the library snapshot.
   */
  select m.factors into v_factors
  from condition_modifiers m
  where m.id = p_modifier
    and m.status = 'active'
    and (m.company_id = v_company or m.company_id is null or m.enterprise_group_id is not null);

  if v_factors is null then
    raise exception 'That condition is not one this company can use'
      using errcode = 'no_data_found';
  end if;

  insert into estimate_line_modifiers
    (company_id, line_item_id, condition_modifier_id, justification, applied_factors, applied_by)
  values (v_company, p_line, p_modifier, trim(p_justification), v_factors, auth.uid())
  on conflict (line_item_id, condition_modifier_id) do update
    set justification = excluded.justification,
        applied_factors = excluded.applied_factors,
        applied_by = excluded.applied_by;
end;
$$;

comment on function app.apply_line_condition(uuid, uuid, text) is
  'Puts a condition on an estimate line with the reason it applies, copying the library factors onto the row so a later retune cannot re-price a bid that already went out. The door the COND. column never had.';

revoke all on function app.apply_line_condition(uuid, uuid, text) from public, anon;
grant execute on function app.apply_line_condition(uuid, uuid, text) to authenticated;

create or replace function public.apply_line_condition(
  p_line uuid, p_modifier uuid, p_justification text)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.apply_line_condition(p_line, p_modifier, p_justification); end; $$;

revoke all on function public.apply_line_condition(uuid, uuid, text) from public, anon;
grant execute on function public.apply_line_condition(uuid, uuid, text) to authenticated;

/** Take one off again. A condition applied by mistake is not a revision. */
create or replace function app.remove_line_condition(p_line uuid, p_modifier uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_status  app.estimate_status;
begin
  select l.company_id, v.status into v_company, v_status
  from estimate_line_items l
  join estimate_versions v on v.id = l.estimate_version_id
  where l.id = p_line;

  if v_company is null then
    raise exception 'That estimate line does not exist' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'estimates.write') then
    raise exception 'You do not have permission to change this estimate'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status not in ('draft', 'in_review') then
    raise exception 'This version is %; make a new version to change it', v_status
      using errcode = 'check_violation';
  end if;

  delete from estimate_line_modifiers
   where line_item_id = p_line and condition_modifier_id = p_modifier;
end;
$$;

comment on function app.remove_line_condition(uuid, uuid) is
  'Takes a condition off an estimate line. Allowed while the version is a draft or in review, and refused after, like every other change to what was bid.';

revoke all on function app.remove_line_condition(uuid, uuid) from public, anon;
grant execute on function app.remove_line_condition(uuid, uuid) to authenticated;

create or replace function public.remove_line_condition(p_line uuid, p_modifier uuid)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.remove_line_condition(p_line, p_modifier); end; $$;

revoke all on function public.remove_line_condition(uuid, uuid) from public, anon;
grant execute on function public.remove_line_condition(uuid, uuid) to authenticated;

/**
 * The conditions on a line, for the screen that shows them.
 *
 * The factors as applied, not as the library currently holds them, so what a
 * person reads on a line is what priced it.
 */
create or replace view my_line_conditions
with (security_invoker = true) as
select lm.line_item_id,
       lm.condition_modifier_id,
       lm.company_id,
       m.code,
       m.name,
       m.category,
       m.application_rule,
       lm.applied_factors,
       lm.justification,
       lm.created_at
from estimate_line_modifiers lm
join condition_modifiers m on m.id = lm.condition_modifier_id;

revoke all on my_line_conditions from public, anon;
grant select on my_line_conditions to authenticated;

select app.assert_security_gates();
