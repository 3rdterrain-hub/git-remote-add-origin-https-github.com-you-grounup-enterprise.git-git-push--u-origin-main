-- =============================================================================
-- 0233 — A library that learns from the field
--
-- 0051 built the measurement and stopped there on purpose. Its own words:
-- *"this reports the variance, names its direction, and says how much evidence
-- is behind it. Somebody decides."* Nothing was ever built for the deciding.
--
-- So four places in the schema still anticipate a capability that is absent.
-- `production_calibrations` has had a pending/approved record since 0008 — with
-- a proposed rate, the current rate, the sample size, the projects it came from
-- and the conditions observed — and no writer and no reader. The `calibration`
-- notification category has no producer. `production_rates.origin` admits
-- `calibration` and no row has ever carried it. `derived_from_project_id` has
-- never been set.
--
-- This closes it, and the shape is decided by two rules that already exist
-- rather than by preference:
--
--   * **RULE-008 — the system proposes, a person accepts.** A calibration lands
--     `pending`. Nothing it says reaches a price until somebody with
--     `libraries.write` says so, and their name goes on it.
--   * **A rate is not overwritten.** 0051 is explicit that an automatic rewrite
--     from field data would be exactly the overreach the governance rules exist
--     to prevent — and it would do it with the estimator's own numbers.
--     Accepting therefore writes a *new* rate, marked `company_actual`, and
--     points `applied_rate_id` at it. The old rate stays, because estimates
--     already priced with it and RULE-009 means those cannot change.
--
-- Two numbers, and neither is invented here:
--
--   * **Three observations** is the floor, and it is already a check constraint
--     on the table from 0008. Two days disagreeing with a benchmark is an
--     anecdote.
--   * **Five percent** is the band 0051 already calls "aligned". A rate inside
--     it is not proposed, because a proposal a person has to dismiss is worse
--     than no proposal at all.
--
-- WORKFLOW.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Proposing
-- -----------------------------------------------------------------------------
/**
 * Look at what the field achieved and write down what it suggests.
 *
 * Reads `reporting_production_variance`, which is already hours-weighted, and
 * proposes only where the evidence clears both bars. Idempotent by design: a
 * rate with a proposal still pending is skipped rather than proposed again, so
 * running this twice in a morning does not produce two of everything.
 *
 * Returns how many it wrote, so a screen can say "nothing new to look at"
 * rather than showing an empty list and leaving somebody wondering whether it
 * ran.
 */
create or replace function app.propose_production_calibrations(
  p_company uuid,
  p_min_observations int default 3,
  p_min_variance_percent numeric default 5)
returns int
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'libraries.write');
  v_written int := 0;
  v_row record;
begin
  for v_row in
    select v.production_rate_id, v.library_rate_per_hour, v.achieved_rate_per_hour,
           v.variance_percent, v.observations, v.hours_observed, v.finding
      from reporting_production_variance v
     where v.company_id = v_company
       and v.production_rate_id is not null
       and v.achieved_rate_per_hour is not null
       and v.achieved_rate_per_hour > 0
       and v.observations >= greatest(p_min_observations, 3)
       and abs(coalesce(v.variance_percent, 0)) >= abs(p_min_variance_percent)
       /*
        * A rate already waiting on somebody is not proposed again. Without this
        * a screen opened twice in a morning grows two of everything, and the
        * person reviewing cannot tell which one is the real one.
        */
       and not exists (
         select 1 from production_calibrations c
          where c.production_rate_id = v.production_rate_id
            and c.state = 'pending')
  loop
    insert into production_calibrations (
      company_id, production_rate_id,
      proposed_rate_per_hour, current_rate_per_hour, variance_percent,
      sample_size, sample_project_ids, observed_conditions, statistical_note, state)
    values (
      v_company, v_row.production_rate_id,
      v_row.achieved_rate_per_hour, v_row.library_rate_per_hour, v_row.variance_percent,
      v_row.observations,
      /* Which jobs this came from, so a reviewer can go and look at them. */
      coalesce((select array_agg(distinct a.project_id)
                  from production_actuals a
                 where a.production_rate_id = v_row.production_rate_id
                   and a.company_id = v_company
                   and a.project_id is not null), '{}'),
      /*
        Conditions, so a reviewer can tell a rate that is genuinely wrong from
        one that was measured on a month of rock and rain. 0007 records these on
        every actual for exactly this comparison and nothing has ever read them.
      */
      coalesce((select jsonb_object_agg(k, n) from (
                  select coalesce(a.material_condition, 'unstated') as k, count(*) as n
                    from production_actuals a
                   where a.production_rate_id = v_row.production_rate_id
                     and a.company_id = v_company
                   group by 1) c), '{}'::jsonb),
      format('%s observations over %s crew hours. The library says %s per hour; the field achieved %s, which is %s%% %s.',
             v_row.observations,
             round(v_row.hours_observed, 1),
             round(v_row.library_rate_per_hour, 3),
             round(v_row.achieved_rate_per_hour, 3),
             round(abs(v_row.variance_percent), 1),
             case when v_row.variance_percent < 0 then 'slower' else 'faster' end),
      'pending');
    v_written := v_written + 1;
  end loop;

  return v_written;
end;
$$;

comment on function app.propose_production_calibrations(uuid, int, numeric) is
  'Turns what the field achieved into proposals a person can accept. Writes nothing to any rate: RULE-008, and 0051''s own reasoning that an automatic rewrite from field data would be the overreach the governance rules exist to prevent. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- Deciding
-- -----------------------------------------------------------------------------
/**
 * Accept a calibration, which writes a new rate rather than changing an old one.
 *
 * The old rate is left exactly where it is. Estimates have already priced with
 * it, RULE-009 means those versions cannot change, and a library row rewritten
 * underneath an issued bid is a price nobody can reproduce — the thing
 * migration 0058 exists to prevent, arriving by a side door.
 *
 * The new rate is `company_actual`, which is the one value in
 * `app.production_source` that means the field measured it. It carries the
 * sample size and the project it was derived from, so the next person to ask
 * where a number came from is answered by the row itself.
 */
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

  /*
   * A shipped rate belongs to every company on the platform, so the calibrated
   * copy is written against this company rather than over the original. That is
   * the same reasoning as 0220: your own row is yours to change, somebody
   * else's is not.
   */
  v_code := left(v_old.code || '-CAL-' || to_char(now(), 'YYYYMMDD'), 60);

  insert into production_rates (
    company_id, code, task_id, service_id, crew_id, method_code,
    rate_per_hour, rate_unit, utilization_factor, shift_hours,
    equipment_spread, controlling_resource,
    material_condition, access_condition, weather_condition, region,
    source_type, confidence_score, sample_size,
    approval_state, status, derived_from_project_id)
  values (
    v_cal.company_id, v_code, v_old.task_id, v_old.service_id, v_old.crew_id,
    v_old.method_code,
    v_cal.proposed_rate_per_hour, v_old.rate_unit,
    v_old.utilization_factor, v_old.shift_hours,
    v_old.equipment_spread, v_old.controlling_resource,
    v_old.material_condition, v_old.access_condition, v_old.weather_condition,
    v_old.region,
    'company_actual', 
    /* More evidence, more confidence, and never certainty. */
    least(0.95, 0.5 + (v_cal.sample_size::numeric / 100)),
    v_cal.sample_size,
    'approved', 'active',
    (select a.project_id from production_actuals a
      where a.production_rate_id = v_cal.production_rate_id
        and a.company_id = v_cal.company_id
        and a.project_id is not null
      order by a.work_date desc limit 1))
  returning id into v_new;

  update production_calibrations
     set state = 'approved',
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_note = nullif(btrim(coalesce(p_note, '')), ''),
         applied_rate_id = v_new,
         updated_at = now()
   where id = p_calibration;

  return v_new;
end;
$$;

comment on function app.accept_production_calibration(uuid, text) is
  'Accepts what the field measured as a new company rate, marked company_actual with its sample size and the project it came from. The rate it was measured against is left alone: estimates have already priced with it and an issued version cannot change. WORKFLOW.';

/** Say no, and say why, so the same proposal is not argued twice. */
create or replace function app.decline_production_calibration(
  p_calibration uuid, p_note text)
returns boolean
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_cal production_calibrations%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
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
  /*
   * The reason is required. A rejection with no reason is proposed again next
   * month and declined again by somebody who cannot tell it was already looked
   * at — which is how a review queue stops being read.
   */
  if v_note is null then
    raise exception 'Say why it is being declined'
      using errcode = 'check_violation',
            hint = 'What the field data does not account for: a month of rock, a green crew, one bad site.';
  end if;

  update production_calibrations
     set state = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
         review_note = v_note, updated_at = now()
   where id = p_calibration;
  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reading
-- -----------------------------------------------------------------------------
create or replace view my_production_calibrations
with (security_invoker = true) as
select c.id, c.company_id, c.production_rate_id, pr.code as rate_code, pr.rate_unit,
       c.proposed_rate_per_hour, c.current_rate_per_hour, c.variance_percent,
       c.sample_size, c.sample_project_ids, c.observed_conditions,
       c.statistical_note, c.state, c.reviewed_by, c.reviewed_at, c.review_note,
       c.applied_rate_id, c.created_at
  from production_calibrations c
  left join production_rates pr on pr.id = c.production_rate_id;

revoke all on my_production_calibrations from public, anon;
grant select on my_production_calibrations to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Public wrappers
-- -----------------------------------------------------------------------------
create or replace function public.propose_production_calibrations(
  p_company uuid, p_min_observations int default 3, p_min_variance_percent numeric default 5)
returns int language sql security invoker set search_path = public, pg_catalog
as $$ select app.propose_production_calibrations(p_company, p_min_observations, p_min_variance_percent); $$;

create or replace function public.accept_production_calibration(
  p_calibration uuid, p_note text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.accept_production_calibration(p_calibration, p_note); $$;

create or replace function public.decline_production_calibration(
  p_calibration uuid, p_note text)
returns boolean language sql security invoker set search_path = public, pg_catalog
as $$ select app.decline_production_calibration(p_calibration, p_note); $$;

do $grants$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.propose_production_calibrations(uuid, int, numeric)',
    'public.accept_production_calibration(uuid, text)',
    'public.decline_production_calibration(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $grants$;

select app.assert_security_gates();
