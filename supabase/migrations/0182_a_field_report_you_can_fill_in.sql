/**
 * A field report you can fill in, and hand in.
 *
 * `create_daily_report` makes the header and says why it leaves it open:
 * "Unsubmitted, because submitting is what freezes it — and a report created
 * already frozen could never be filled in." It was right about the principle
 * and nothing was ever built on it. Three things are missing and they are the
 * whole of the workflow:
 *
 *   * **nothing writes `daily_report_labor`** — who was on site and for how long
 *   * **nothing writes `daily_report_equipment`** — what ran, idled, broke down
 *     and burned fuel
 *   * **nothing sets `submitted_at`**, so no report has ever been handed in
 *
 * A superintendent can therefore create a day and then do nothing else with it.
 *
 * The cost is not only the missing form. `reporting_labor_reconciliation`
 * (migration 0044) compares the hours a field report claims against the hours
 * approved timecards carry, and it is read by the Workforce screen. With no
 * writer on the report side it can only ever answer **"no daily report"**, for
 * every project, every day, forever — a reconciliation with one side
 * permanently blank, presented as a finding.
 *
 * Submitting is the freeze. Before it, a day is being written down; after it,
 * it is what was reported, and the crew hours in it are evidence in a claim
 * about what happened on site.
 *
 * WORKFLOW.
 */

-- -----------------------------------------------------------------------------
-- Who was on site
-- -----------------------------------------------------------------------------

/**
 * Refuse to change a day that has been handed in.
 *
 * Read from the report rather than passed in, so it cannot be told the wrong
 * answer, and `security definer` because a caller reaching a line may hold no
 * direct select on the header.
 */
create or replace function app.assert_report_open(p_report uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_r daily_reports%rowtype;
begin
  select * into v_r from daily_reports where id = p_report;
  if v_r.id is null then
    raise exception 'No such field report' using errcode = 'no_data_found';
  end if;
  if v_r.submitted_at is not null then
    raise exception
      'The report for % was handed in on %; what was reported does not change',
      v_r.report_date, v_r.submitted_at::date
      using errcode = 'restrict_violation',
            hint = 'Record a correction on today''s report rather than editing a submitted one.';
  end if;
end;
$$;

comment on function app.assert_report_open(uuid) is
  'Refuses a change to a field report that has been handed in. WORKFLOW.';

/**
 * Put a crew on a day.
 *
 * `classification` rather than a person: a daily report is what a
 * superintendent writes at the end of the day — "four operators, ten hours" —
 * and it is reconciled against timecards afterwards rather than being one.
 * Naming every individual is the timecard's job, and asking for it here is how
 * a field report stops being filled in.
 */
create or replace function app.add_report_labor(
  p_report         uuid,
  p_classification text,
  p_headcount      int,
  p_straight_hours numeric,
  p_overtime_hours numeric default 0,
  p_crew           uuid default null,
  p_cost_code      uuid default null,
  p_notes          text default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_id      uuid;
begin
  select company_id into v_company from daily_reports where id = p_report;
  if v_company is null then
    raise exception 'No such field report' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'projects.write') then
    raise exception 'You do not have permission to write this report'
      using errcode = 'insufficient_privilege';
  end if;
  perform app.assert_report_open(p_report);

  if coalesce(btrim(coalesce(p_classification, '')), '') = '' then
    raise exception 'Say what trade or classification was on site'
      using errcode = 'check_violation';
  end if;
  if p_headcount is null or p_headcount < 1 then
    raise exception 'A crew line has at least one person on it'
      using errcode = 'check_violation';
  end if;
  if coalesce(p_straight_hours, 0) + coalesce(p_overtime_hours, 0) <= 0 then
    raise exception 'Say how many hours they worked'
      using errcode = 'check_violation',
            hint = 'A crew on site for no hours is a crew that was not on site.';
  end if;

  insert into daily_report_labor (
    company_id, daily_report_id, crew_id, classification, headcount,
    straight_hours, overtime_hours, cost_code_id, notes)
  values (
    v_company, p_report, p_crew, btrim(p_classification), p_headcount,
    coalesce(p_straight_hours, 0), coalesce(p_overtime_hours, 0), p_cost_code,
    nullif(btrim(coalesce(p_notes, '')), ''))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.add_report_labor(uuid, text, int, numeric, numeric, uuid, uuid, text) is
  'Records a crew on a field report. The only writer of daily_report_labor — without it reporting_labor_reconciliation could only ever answer "no daily report". WORKFLOW.';

/**
 * Put a machine on a day.
 *
 * Operating, idle and down are kept apart because they are three different
 * facts and only one of them is productive. A machine that sat idle for six
 * hours cost money and moved nothing; a machine that was down cost money and
 * belongs in a maintenance conversation. Folding them into "hours" loses the
 * distinction that makes the number worth recording.
 */
create or replace function app.add_report_equipment(
  p_report          uuid,
  p_description     text,
  p_operating_hours numeric,
  p_units           int default 1,
  p_idle_hours      numeric default 0,
  p_down_hours      numeric default 0,
  p_fuel_gallons    numeric default 0,
  p_equipment       uuid default null,
  p_cost_code       uuid default null,
  p_notes           text default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_id      uuid;
begin
  select company_id into v_company from daily_reports where id = p_report;
  if v_company is null then
    raise exception 'No such field report' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'projects.write') then
    raise exception 'You do not have permission to write this report'
      using errcode = 'insufficient_privilege';
  end if;
  perform app.assert_report_open(p_report);

  if coalesce(btrim(coalesce(p_description, '')), '') = '' then
    raise exception 'Say what machine it was' using errcode = 'check_violation';
  end if;
  if coalesce(p_operating_hours, 0) + coalesce(p_idle_hours, 0)
     + coalesce(p_down_hours, 0) <= 0 then
    raise exception 'Say how the machine spent the day'
      using errcode = 'check_violation',
            hint = 'Operating, idle or down — a machine on site did one of the three.';
  end if;

  insert into daily_report_equipment (
    company_id, daily_report_id, equipment_id, description, units,
    operating_hours, idle_hours, down_hours, fuel_gallons, cost_code_id, notes)
  values (
    v_company, p_report, p_equipment, btrim(p_description), greatest(coalesce(p_units, 1), 1),
    coalesce(p_operating_hours, 0), coalesce(p_idle_hours, 0),
    coalesce(p_down_hours, 0), coalesce(p_fuel_gallons, 0), p_cost_code,
    nullif(btrim(coalesce(p_notes, '')), ''))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.add_report_equipment(uuid, text, numeric, int, numeric, numeric, numeric, uuid, uuid, text) is
  'Records a machine on a field report, keeping operating, idle and down apart — only one of the three is productive. WORKFLOW.';

/** Take a line back off a day that has not been handed in. */
create or replace function app.remove_report_line(p_line uuid, p_kind text)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_report  uuid;
begin
  if p_kind = 'labor' then
    select company_id, daily_report_id into v_company, v_report
      from daily_report_labor where id = p_line;
  elsif p_kind = 'equipment' then
    select company_id, daily_report_id into v_company, v_report
      from daily_report_equipment where id = p_line;
  else
    raise exception 'A field report line is labor or equipment, not %', p_kind
      using errcode = 'check_violation';
  end if;

  if v_company is null then
    raise exception 'No such field report line' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'projects.write') then
    raise exception 'You do not have permission to change this report'
      using errcode = 'insufficient_privilege';
  end if;
  perform app.assert_report_open(v_report);

  if p_kind = 'labor' then
    delete from daily_report_labor where id = p_line;
  else
    delete from daily_report_equipment where id = p_line;
  end if;
end;
$$;

comment on function app.remove_report_line(uuid, text) is
  'Removes a crew or machine line from a field report that has not been handed in. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- Handing it in
-- -----------------------------------------------------------------------------

/**
 * Submit the day.
 *
 * The freeze `create_daily_report` has always described and nothing could
 * perform. An empty report is refused: a day with nobody on it and nothing
 * running is not a record of a day, it is a form somebody opened — and once
 * submitted it is evidence, so it has to say something.
 */
create or replace function app.submit_daily_report(p_report uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_r     daily_reports%rowtype;
  v_lines int;
begin
  select * into v_r from daily_reports where id = p_report;
  if v_r.id is null then
    raise exception 'No such field report' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_r.company_id, 'projects.write') then
    raise exception 'You do not have permission to submit this report'
      using errcode = 'insufficient_privilege';
  end if;
  if v_r.submitted_at is not null then
    raise exception 'The report for % was already handed in', v_r.report_date
      using errcode = 'check_violation';
  end if;

  select (select count(*) from daily_report_labor where daily_report_id = p_report)
       + (select count(*) from daily_report_equipment where daily_report_id = p_report)
    into v_lines;
  if v_lines = 0 and coalesce(btrim(coalesce(v_r.work_performed, '')), '') = '' then
    raise exception 'There is nothing on this report to hand in'
      using errcode = 'check_violation',
            hint = 'Say what was done, or put the crew and machines on it first.';
  end if;

  update daily_reports
     set submitted_at = now(), submitted_by = auth.uid(), updated_at = now()
   where id = p_report;
end;
$$;

comment on function app.submit_daily_report(uuid) is
  'Hands a field report in, which is what freezes it. The freeze create_daily_report has described since it was written, and which nothing could perform. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- Doors
-- -----------------------------------------------------------------------------

/*
 * No `my_report_labor` / `my_report_equipment` views.
 *
 * Two were written here and removed before this migration was applied. The
 * crews and machines already come back embedded on the report that
 * `loadDailyReports` reads, carrying every column these would have carried, and
 * a second way to read the same rows is how two screens come to disagree about
 * one day. They earn their place when something needs them across reports —
 * "who was on site this week" — and not before.
 */

create or replace function public.add_report_labor(
  p_report uuid, p_classification text, p_headcount int, p_straight_hours numeric,
  p_overtime_hours numeric default 0, p_crew uuid default null,
  p_cost_code uuid default null, p_notes text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.add_report_labor(p_report, p_classification, p_headcount,
       p_straight_hours, p_overtime_hours, p_crew, p_cost_code, p_notes); $$;

create or replace function public.add_report_equipment(
  p_report uuid, p_description text, p_operating_hours numeric, p_units int default 1,
  p_idle_hours numeric default 0, p_down_hours numeric default 0,
  p_fuel_gallons numeric default 0, p_equipment uuid default null,
  p_cost_code uuid default null, p_notes text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.add_report_equipment(p_report, p_description, p_operating_hours,
       p_units, p_idle_hours, p_down_hours, p_fuel_gallons, p_equipment,
       p_cost_code, p_notes); $$;

create or replace function public.remove_report_line(p_line uuid, p_kind text)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.remove_report_line(p_line, p_kind); $$;

create or replace function public.submit_daily_report(p_report uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.submit_daily_report(p_report); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.add_report_labor(uuid, text, int, numeric, numeric, uuid, uuid, text)',
    'public.add_report_equipment(uuid, text, numeric, int, numeric, numeric, numeric, uuid, uuid, text)',
    'public.remove_report_line(uuid, text)',
    'public.submit_daily_report(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
