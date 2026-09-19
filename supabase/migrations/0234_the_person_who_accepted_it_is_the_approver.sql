-- =============================================================================
-- 0234 — The person who accepted it is the approver
--
-- 0233 wrote the calibrated rate `active` and `approved` and named nobody, and
-- `production_rates_active_needs_approver` refused it on the first real run:
-- *a company row that is live must name who made it live.* 0028 has applied
-- that to every library table since the day it was written.
--
-- The fix is not a workaround, it is the thing the design already meant. The
-- whole point of RULE-008 is that a person accepts what the system proposes, so
-- the person who accepted the calibration is the approver of the rate it
-- produced — there is nobody else it could be. `approved_at` goes with it,
-- because `*_approval_complete` says half an approval is not a record, and it
-- is right.
--
-- WORKFLOW.
-- =============================================================================

create or replace function app.accept_production_calibration(
  p_calibration uuid,
  p_note text default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_cal  production_calibrations%rowtype;
  v_old  production_rates%rowtype;
  v_new  uuid;
  v_code text;
  v_who  uuid := auth.uid();
begin
  select * into v_cal from production_calibrations where id = p_calibration;
  if not found then
    raise exception 'No such calibration' using errcode = 'no_data_found';
  end if;
  perform app.company_for_write(v_cal.company_id, 'libraries.write');

  if v_cal.state <> 'pending' then
    raise exception 'That calibration was already %', v_cal.state
      using errcode = 'check_violation';
  end if;

  select * into v_old from production_rates where id = v_cal.production_rate_id;
  if not found then
    raise exception 'The rate this was measured against is gone'
      using errcode = 'no_data_found';
  end if;

  v_code := left(v_old.code || '-CAL-' || to_char(now(), 'YYYYMMDD'), 60);

  insert into production_rates (
    company_id, code, task_id, service_id, crew_id, method_code,
    rate_per_hour, rate_unit, utilization_factor, shift_hours,
    equipment_spread, controlling_resource,
    material_condition, access_condition, weather_condition, region,
    source_type, confidence_score, sample_size,
    approval_state, approved_by, approved_at, status, derived_from_project_id)
  values (
    v_cal.company_id, v_code, v_old.task_id, v_old.service_id, v_old.crew_id,
    v_old.method_code,
    v_cal.proposed_rate_per_hour, v_old.rate_unit,
    v_old.utilization_factor, v_old.shift_hours,
    v_old.equipment_spread, v_old.controlling_resource,
    v_old.material_condition, v_old.access_condition, v_old.weather_condition,
    v_old.region,
    'company_actual',
    least(0.95, 0.5 + (v_cal.sample_size::numeric / 100)),
    v_cal.sample_size,
    /* The person accepting is the approver. There is nobody else it could be. */
    'approved', v_who, now(), 'active',
    (select a.project_id from production_actuals a
      where a.production_rate_id = v_cal.production_rate_id
        and a.company_id = v_cal.company_id
        and a.project_id is not null
      order by a.work_date desc limit 1))
  returning id into v_new;

  update production_calibrations
     set state = 'approved',
         reviewed_by = v_who,
         reviewed_at = now(),
         review_note = nullif(btrim(coalesce(p_note, '')), ''),
         applied_rate_id = v_new,
         updated_at = now()
   where id = p_calibration;

  return v_new;
end;
$$;

comment on function app.accept_production_calibration(uuid, text) is
  'Accepts what the field measured as a new company rate, marked company_actual with its sample size, the project it came from, and the person who accepted it as its approver. The rate it was measured against is left alone: estimates have already priced with it and an issued version cannot change. WORKFLOW.';

select app.assert_security_gates();
