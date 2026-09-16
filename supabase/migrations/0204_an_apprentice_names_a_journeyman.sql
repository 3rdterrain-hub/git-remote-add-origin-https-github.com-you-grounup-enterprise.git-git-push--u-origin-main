-- =============================================================================
-- 0204 — An apprentice names a journeyman on the way in, too
--
-- `schedule_wage_increase` (0202) carried `percent_of_journeyman` forward and
-- left `journeyman_rate_id` behind, so every sheet with an apprentice on it
-- failed at the insert: `labor_rates_apprentice_names_its_journeyman` refuses a
-- percentage of nothing, which is right.
--
-- The re-pointing step was already there and already correct — it just ran a
-- moment too late to satisfy a constraint that is checked per row. So the old
-- journeyman comes across on the insert, and the update immediately after moves
-- it to the new sheet's. The constraint holds at every point in between, which
-- is the only version of this that is safe to run inside one transaction.
--
-- Found by the test for the thing one layer further on — that an apprentice
-- takes its step off the *new* journeyman rather than off last year's twice.
-- =============================================================================

create or replace function app.schedule_wage_increase(
  p_schedule uuid,
  p_effective_date date,
  p_wage_increase numeric default 0,
  p_fringe_increase numeric default 0,
  p_wage_percent numeric default 0,
  p_name text default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_s   wage_schedules%rowtype;
  v_new uuid;
  v_n   int;
begin
  select * into v_s from wage_schedules where id = p_schedule;
  if v_s.id is null then
    raise exception 'No such wage sheet' using errcode = 'no_data_found';
  end if;
  perform app.company_for_write(v_s.company_id, 'libraries.write');

  if p_effective_date is null or p_effective_date <= v_s.effective_date then
    raise exception 'A raise takes effect after the sheet it raises (%)', v_s.effective_date
      using errcode = 'check_violation';
  end if;
  if coalesce(p_wage_increase, 0) = 0 and coalesce(p_fringe_increase, 0) = 0
     and coalesce(p_wage_percent, 0) = 0 then
    raise exception 'Say what the increase is'
      using errcode = 'check_violation',
            hint = 'Dollars on the wage, dollars on the fringe, a percentage, or any combination — agreements are written every way.';
  end if;
  if coalesce(p_wage_percent, 0) < 0 or coalesce(p_wage_percent, 0) > 1 then
    raise exception 'A percentage increase is a fraction between 0 and 1'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from wage_schedules
              where supersedes_id = p_schedule and effective_date = p_effective_date) then
    raise exception 'That step is already on file for %', p_effective_date
      using errcode = 'unique_violation';
  end if;

  insert into wage_schedules (
    company_id, code, name, basis, union_name, local_number, district,
    determination_number, county, state_code, construction_type,
    effective_date, supersedes_id, notes, status, created_by)
  values (v_s.company_id,
          v_s.code || '-' || to_char(p_effective_date, 'YYYYMMDD'),
          coalesce(nullif(trim(coalesce(p_name, '')), ''),
                   v_s.name || ' — ' || to_char(p_effective_date, 'FMMonth YYYY')),
          v_s.basis, v_s.union_name, v_s.local_number, v_s.district,
          v_s.determination_number, v_s.county, v_s.state_code, v_s.construction_type,
          p_effective_date, p_schedule,
          'Scheduled increase from ' || v_s.code, 'draft', auth.uid())
  returning id into v_new;

  /*
   * Every class comes forward. A step that carried only the classes somebody
   * remembered would leave the rest silently on last year's money, which is the
   * exact failure this function exists to prevent.
   *
   * Apprentice steps come across as percentages and are recomputed from their
   * new journeyman below, rather than having the raise applied to them twice.
   */
  insert into labor_rates (
    company_id, wage_schedule_id, code, classification, labor_group, trade, class_label,
    base_wage_per_hour, fringe_per_hour, fringe_is_taxable, burden_percent,
    overtime_multiplier, doubletime_multiplier, region, is_union,
    effective_date, status, approval_state, source, origin,
    percent_of_journeyman, journeyman_rate_id)
  select r.company_id, v_new,
         replace(r.code, v_s.code, v_s.code || '-' || to_char(p_effective_date, 'YYYYMMDD')),
         r.classification, r.labor_group, r.trade, r.class_label,
         case when r.percent_of_journeyman is not null then r.base_wage_per_hour
              else round((r.base_wage_per_hour + coalesce(p_wage_increase, 0))
                         * (1 + coalesce(p_wage_percent, 0)), 4) end,
         round(r.fringe_per_hour + coalesce(p_fringe_increase, 0), 4),
         r.fringe_is_taxable, r.burden_percent,
         r.overtime_multiplier, r.doubletime_multiplier, r.region, r.is_union,
         p_effective_date, 'draft',
         'pending'::app.approval_state,
         'Scheduled increase from ' || r.code, 'company',
         r.percent_of_journeyman,
         /*
          * The old journeyman, carried so `labor_rates_apprentice_names_its_journeyman`
          * holds on the way in — an apprentice that names no journeyman is a
          * percentage of nothing. It is re-pointed at the new sheet's journeyman
          * immediately below, before anything can read it.
          */
         r.journeyman_rate_id
    from labor_rates r
   where r.wage_schedule_id = p_schedule
     and r.status <> 'retired';

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'That sheet has no rates to carry forward' using errcode = 'no_data_found';
  end if;

  /* Re-point each apprentice at its journeyman on the *new* sheet, and take
     the step from the new journeyman wage rather than from last year's. */
  update labor_rates a
     set journeyman_rate_id = j.id,
         base_wage_per_hour = round(j.base_wage_per_hour * a.percent_of_journeyman, 4)
    from labor_rates old_a
    join labor_rates old_j on old_j.id = old_a.journeyman_rate_id
    join labor_rates j on j.wage_schedule_id = v_new
                      and j.trade = old_j.trade and j.class_label = old_j.class_label
   where a.wage_schedule_id = v_new
     and a.percent_of_journeyman is not null
     and old_a.wage_schedule_id = p_schedule
     and old_a.trade = a.trade and old_a.class_label = a.class_label;

  /* The old sheet stops the day the new one starts. */
  update wage_schedules set expires_on = p_effective_date, updated_at = now()
   where id = p_schedule;
  update labor_rates set expires_on = p_effective_date, updated_at = now()
   where wage_schedule_id = p_schedule;

  return v_new;
end;
$$;

select app.assert_security_gates();
