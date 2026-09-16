-- =============================================================================
-- 0203 — A trade is not a labor group
--
-- `add_wage_rate` (0202) wrote the trade into `labor_group`, and the category
-- guard from 0124 refused it — correctly. They are not the same thing:
--
--   * `labor_group` is the company's own grouping, and it is **user-addable**
--     through `library_categories`. Operator, Labor, Carpentry. A company adds
--     to it, which is exactly why a function may not quietly invent a value for
--     it.
--   * `trade` is what the agreement or the determination calls the work.
--     "Operating Engineer", "Power Equipment Operator". It is the other side's
--     vocabulary, not yours.
--
-- Cramming one into the other would have made every wage sheet fail on a fresh
-- company and, worse, would have grown the category list behind somebody's
-- back. So the group is taken as its own argument and left null when nobody
-- gives one — null is honest, and a company that wants its sheets grouped can
-- say how.
-- =============================================================================

create or replace function app.add_wage_rate(
  p_schedule uuid,
  p_trade text,
  p_class_label text,
  p_base_wage numeric,
  p_fringe_per_hour numeric default 0,
  p_burden_percent numeric default 0,
  p_fringe_is_taxable boolean default false,
  p_classification text default null,
  p_overtime_multiplier numeric default 1.5,
  p_doubletime_multiplier numeric default 2.0,
  p_labor_group text default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_s     wage_schedules%rowtype;
  v_trade text := nullif(trim(coalesce(p_trade, '')), '');
  v_class text := nullif(trim(coalesce(p_class_label, '')), '');
  v_id    uuid;
begin
  select * into v_s from wage_schedules where id = p_schedule;
  if v_s.id is null then
    raise exception 'No such wage sheet' using errcode = 'no_data_found';
  end if;
  perform app.company_for_write(v_s.company_id, 'libraries.write');
  if v_trade is null or v_class is null then
    raise exception 'A rate on a sheet needs its trade and its class'
      using errcode = 'check_violation',
            hint = 'Operating Engineer / Class 2. The pair is what lets the same crew be found on a shop scale, an agreement and a determination.';
  end if;
  if coalesce(p_base_wage, 0) < 0 or coalesce(p_fringe_per_hour, 0) < 0 then
    raise exception 'A wage and a fringe cannot be negative' using errcode = 'check_violation';
  end if;
  if exists (select 1 from labor_rates
              where wage_schedule_id = p_schedule and trade = v_trade and class_label = v_class) then
    raise exception '% (%) is already on that sheet', v_trade, v_class
      using errcode = 'unique_violation';
  end if;

  insert into labor_rates (
    company_id, wage_schedule_id, code, classification, labor_group, trade, class_label,
    base_wage_per_hour, fringe_per_hour, fringe_is_taxable, burden_percent,
    overtime_multiplier, doubletime_multiplier, region, is_union,
    effective_date, expires_on, status, approval_state, source, origin,
    approved_by, approved_at)
  values (v_s.company_id, p_schedule,
          v_s.code || '-' || upper(regexp_replace(v_trade || '-' || v_class, '[^a-zA-Z0-9]+', '', 'g')),
          coalesce(nullif(trim(coalesce(p_classification, '')), ''), v_trade || ', ' || v_class),
          -- Left null unless somebody says. The list is theirs to extend.
          nullif(trim(coalesce(p_labor_group, '')), ''),
          v_trade, v_class,
          coalesce(p_base_wage, 0), coalesce(p_fringe_per_hour, 0),
          coalesce(p_fringe_is_taxable, false), coalesce(p_burden_percent, 0),
          coalesce(p_overtime_multiplier, 1.5), coalesce(p_doubletime_multiplier, 2.0),
          v_s.name, (v_s.basis = 'union'),
          v_s.effective_date, v_s.expires_on,
          app.copy_status(v_s.company_id),
          case when app.has_permission(v_s.company_id, 'libraries.approve')
               then 'approved'::app.approval_state else 'pending'::app.approval_state end,
          'Wage sheet ' || v_s.code, 'company',
          app.copy_approver(v_s.company_id), app.copy_approved_at(v_s.company_id))
  returning id into v_id;
  return v_id;
end;
$$;

drop function if exists public.add_wage_rate(uuid, text, text, numeric, numeric, numeric, boolean, text, numeric, numeric);

create or replace function public.add_wage_rate(
  p_schedule uuid, p_trade text, p_class_label text, p_base_wage numeric,
  p_fringe_per_hour numeric default 0, p_burden_percent numeric default 0,
  p_fringe_is_taxable boolean default false, p_classification text default null,
  p_overtime_multiplier numeric default 1.5, p_doubletime_multiplier numeric default 2.0,
  p_labor_group text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.add_wage_rate(p_schedule, p_trade, p_class_label, p_base_wage,
       p_fringe_per_hour, p_burden_percent, p_fringe_is_taxable, p_classification,
       p_overtime_multiplier, p_doubletime_multiplier, p_labor_group); $$;

revoke all on function public.add_wage_rate(
  uuid, text, text, numeric, numeric, numeric, boolean, text, numeric, numeric, text)
  from public, anon;
grant execute on function public.add_wage_rate(
  uuid, text, text, numeric, numeric, numeric, boolean, text, numeric, numeric, text)
  to authenticated;

-- The same for the rates a scheduled increase carries forward: whatever group
-- the old row had comes across, and nothing is invented for one that had none.
select app.assert_security_gates();
