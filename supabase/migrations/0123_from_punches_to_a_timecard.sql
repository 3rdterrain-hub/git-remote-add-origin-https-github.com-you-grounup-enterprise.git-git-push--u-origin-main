-- =============================================================================
-- 0123 — From punches to a timecard
--
-- Migration 0122 records what happened. This one turns it into what somebody is
-- paid, which is a different question and has a rule attached to it that varies
-- by company and by state.
--
-- The default is the federal one: overtime after forty hours in a week, and no
-- daily overtime at all. That is deliberately the *narrower* rule. Defaulting to
-- eight-hours-a-day — which is California's rule, and the one most software
-- assumes — would silently pay overtime that most employers do not owe, and a
-- payroll number nobody asked for is worse than one they have to go set.
--
-- No rounding by default either. The seven-minute rule is legal in most places
-- and is also the single most common way a time system quietly shorts people,
-- so it is off until a company turns it on and says which way it rounds.
--
-- What comes out is ordinary `time_entries` rows with `source = 'clock'`. They
-- go through the same approval and the same payroll export as a typed timecard,
-- because from payroll's side they are one.
-- =============================================================================

create table if not exists overtime_policies (
  id                        uuid primary key default gen_random_uuid(),
  company_id                uuid not null unique references companies(id) on delete cascade,

  -- Null means the company has no daily overtime, which is the federal position.
  daily_overtime_after      numeric(5,2) check (daily_overtime_after is null or daily_overtime_after > 0),
  daily_doubletime_after    numeric(5,2) check (daily_doubletime_after is null or daily_doubletime_after > 0),
  weekly_overtime_after     numeric(6,2) check (weekly_overtime_after is null or weekly_overtime_after > 0),

  -- 0 is Sunday, matching `extract(dow)`.
  week_starts_on            int not null default 0 check (week_starts_on between 0 and 6),

  -- 1 means no rounding. Anything else rounds each worked interval.
  rounding_minutes          int not null default 1
                              check (rounding_minutes in (1, 5, 6, 10, 15)),
  rounding_direction        text not null default 'nearest'
                              check (rounding_direction in ('nearest', 'up', 'down')),

  updated_by                uuid references auth.users(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

alter table overtime_policies drop constraint if exists overtime_policies_tiers_ascend;
alter table overtime_policies add constraint overtime_policies_tiers_ascend
  check (daily_doubletime_after is null
         or daily_overtime_after is null
         or daily_doubletime_after > daily_overtime_after);

comment on table overtime_policies is
  'One company''s overtime rule. Absent, the federal rule applies: overtime after 40 hours in a week, no daily overtime, no rounding.';

drop trigger if exists set_updated_at on overtime_policies;
create trigger set_updated_at
  before update on overtime_policies
  for each row execute function app.set_updated_at();

select app.apply_tenant_rls('overtime_policies', null, 'company.manage');
select app.attach_standard_triggers('overtime_policies');
select app.guard_suspension('overtime_policies');

/** The company's rule, or the federal one when they have not set one. */
create or replace function app.overtime_policy(p_company uuid)
returns overtime_policies
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v overtime_policies;
begin
  select * into v from overtime_policies where company_id = p_company;
  if v.id is null then
    v.company_id             := p_company;
    v.daily_overtime_after   := null;
    v.daily_doubletime_after := null;
    v.weekly_overtime_after  := 40;
    v.week_starts_on         := 0;
    v.rounding_minutes       := 1;
    v.rounding_direction     := 'nearest';
  end if;
  return v;
end;
$$;

create or replace function public.set_overtime_policy(
  p_company uuid,
  p_daily_overtime_after numeric default null,
  p_daily_doubletime_after numeric default null,
  p_weekly_overtime_after numeric default 40,
  p_week_starts_on int default 0,
  p_rounding_minutes int default 1,
  p_rounding_direction text default 'nearest'
)
returns overtime_policies
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v overtime_policies;
begin
  if not app.has_permission(p_company, 'company.manage') then
    raise exception 'Setting the overtime rule needs the company.manage permission.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into overtime_policies (
    company_id, daily_overtime_after, daily_doubletime_after, weekly_overtime_after,
    week_starts_on, rounding_minutes, rounding_direction, updated_by)
  values (p_company, p_daily_overtime_after, p_daily_doubletime_after, p_weekly_overtime_after,
          p_week_starts_on, p_rounding_minutes, p_rounding_direction, auth.uid())
  on conflict (company_id) do update set
    daily_overtime_after   = excluded.daily_overtime_after,
    daily_doubletime_after = excluded.daily_doubletime_after,
    weekly_overtime_after  = excluded.weekly_overtime_after,
    week_starts_on         = excluded.week_starts_on,
    rounding_minutes       = excluded.rounding_minutes,
    rounding_direction     = excluded.rounding_direction,
    updated_by             = auth.uid()
  returning * into v;

  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- A timecard can say where it came from
-- -----------------------------------------------------------------------------

/*
 * `time_entries.source` has listed manual, mobile, kiosk, import and
 * daily_report since 0015. None of them means "the clock computed this", and
 * the difference matters: posting replaces its own rows and must be able to
 * tell them from a line somebody typed.
 */
alter table time_entries drop constraint if exists time_entries_source_check;
alter table time_entries add constraint time_entries_source_check
  check (source in ('manual', 'mobile', 'kiosk', 'import', 'daily_report', 'clock'));

-- -----------------------------------------------------------------------------
-- The intervals a day is made of
-- -----------------------------------------------------------------------------

/**
 * One employee's worked intervals for a day, in order, with the job each was
 * against.
 *
 * A break splits the interval it falls in rather than being subtracted at the
 * end, so a crew that clocks in on one job, breaks, and comes back on another
 * produces three rows and the hours land on the right cost codes.
 *
 * An open interval — still on the clock — is not returned. A day is posted when
 * it is finished.
 */
create or replace function app.punch_intervals(p_employee uuid, p_day date)
returns table (
  started_at      timestamptz,
  ended_at        timestamptz,
  minutes         numeric,
  project_id      uuid,
  project_task_id uuid,
  cost_code_id    uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  r        record;
  v_from   timestamptz;
  v_proj   uuid;
  v_task   uuid;
  v_code   uuid;
  v_paused boolean := false;
begin
  for r in
    select p.kind, p.punched_at, p.project_id, p.project_task_id, p.cost_code_id
    from time_punches p
    where p.employee_id = p_employee
      and p.voided_at is null
      and (p.punched_at at time zone 'UTC')::date = p_day
    order by p.punched_at, p.created_at
  loop
    if r.kind = 'in' then
      v_from := r.punched_at;
      v_proj := r.project_id; v_task := r.project_task_id; v_code := r.cost_code_id;
      v_paused := false;

    elsif r.kind = 'break_start' and v_from is not null then
      if r.punched_at > v_from then
        started_at := v_from; ended_at := r.punched_at;
        minutes := round(extract(epoch from (r.punched_at - v_from)) / 60, 4);
        project_id := v_proj; project_task_id := v_task; cost_code_id := v_code;
        return next;
      end if;
      v_from := null;
      v_paused := true;

    elsif r.kind = 'break_end' and v_paused then
      v_from := r.punched_at;
      v_paused := false;

    elsif r.kind = 'out' and v_from is not null then
      if r.punched_at > v_from then
        started_at := v_from; ended_at := r.punched_at;
        minutes := round(extract(epoch from (r.punched_at - v_from)) / 60, 4);
        project_id := v_proj; project_task_id := v_task; cost_code_id := v_code;
        return next;
      end if;
      v_from := null;
      v_paused := false;
    end if;
  end loop;
end;
$$;

/** Apply a company's rounding rule to a number of minutes. */
create or replace function app.round_minutes(p_minutes numeric, p_to int, p_direction text)
returns numeric
language sql
immutable
as $$
  select case
    when p_to is null or p_to <= 1 then p_minutes
    when p_direction = 'up'   then ceil(p_minutes / p_to) * p_to
    when p_direction = 'down' then floor(p_minutes / p_to) * p_to
    else round(p_minutes / p_to) * p_to
  end::numeric;
$$;

-- -----------------------------------------------------------------------------
-- Posting
-- -----------------------------------------------------------------------------

/**
 * Turn a finished day of punches into timecard rows.
 *
 * Overtime is assigned to the hours that were *actually* worked past the
 * threshold — the walk carries a running total for the day and for the week, and
 * each interval is split where it crosses a line. A crew that spends the morning
 * on one job and the afternoon on another does not have its overtime smeared
 * proportionally across both; it lands on the afternoon, which is when it was
 * earned and which job cost is entitled to know.
 *
 * Re-posting a day replaces the rows this function wrote and leaves everything
 * else alone. A typed entry somebody made by hand is not clock-sourced and is
 * never touched. An approved or exported clock row stops the posting rather than
 * being overwritten, because by then somebody has signed for it.
 */
create or replace function public.post_punches_to_timecard(p_employee uuid, p_day date)
returns setof time_entries
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_company    uuid;
  v_policy     overtime_policies;
  v_week_start date;
  v_open       boolean;
  v_locked     int;
  v_week_to_date numeric := 0;
  r            record;
  v_day_mins   numeric := 0;
  v_ot_at      numeric;   -- daily overtime threshold in minutes, or null
  v_dt_at      numeric;
  v_wk_at      numeric;   -- weekly overtime threshold in minutes, or null
  v_mins       numeric;
  v_straight   numeric;
  v_over       numeric;
  v_double     numeric;
  v_take       numeric;
begin
  select e.company_id into v_company from employees e where e.id = p_employee;
  if v_company is null then
    raise exception 'No such employee.' using errcode = 'no_data_found';
  end if;
  if not app.punching_for_self(p_employee)
     and not app.has_permission(v_company, 'time.punch_crew')
     and not app.has_permission(v_company, 'hr.write') then
    raise exception 'Posting another employee''s time needs the time.punch_crew permission.'
      using errcode = 'insufficient_privilege';
  end if;

  select open into v_open from app.punch_day(p_employee, p_day);
  if v_open then
    raise exception 'That day is still open — the employee has not clocked out. A day is posted once it is finished.'
      using errcode = 'check_violation';
  end if;

  select count(*) into v_locked
  from time_entries te
  where te.employee_id = p_employee and te.work_date = p_day
    and te.source = 'clock'
    and (te.exported_at is not null or te.approval_state = 'approved');
  if v_locked > 0 then
    raise exception 'The clock hours for % were already approved or exported. Post an adjusting entry instead of re-posting.', p_day
      using errcode = 'restrict_violation';
  end if;

  v_policy := app.overtime_policy(v_company);
  v_ot_at := v_policy.daily_overtime_after * 60;
  v_dt_at := v_policy.daily_doubletime_after * 60;
  v_wk_at := v_policy.weekly_overtime_after * 60;

  /*
   * The week this day sits in, under the company's own week-start day, and the
   * straight hours already posted in it. Only straight hours count toward the
   * weekly threshold — hours already paid as overtime cannot cross it twice.
   */
  v_week_start := p_day - ((extract(dow from p_day)::int - v_policy.week_starts_on + 7) % 7);
  select coalesce(sum(te.straight_hours) * 60, 0) into v_week_to_date
  from time_entries te
  where te.employee_id = p_employee
    and te.work_date >= v_week_start and te.work_date < p_day;

  delete from time_entries te
  where te.employee_id = p_employee and te.work_date = p_day and te.source = 'clock';

  for r in select * from app.punch_intervals(p_employee, p_day) loop
    v_mins := app.round_minutes(r.minutes, v_policy.rounding_minutes, v_policy.rounding_direction);
    if v_mins <= 0 then continue; end if;

    v_straight := 0; v_over := 0; v_double := 0;

    /*
     * Consume the interval a slice at a time, each slice priced by where the
     * running day total stands when it is worked.
     */
    while v_mins > 0 loop
      if v_dt_at is not null and v_day_mins >= v_dt_at then
        v_take := v_mins;
        v_double := v_double + v_take;
      elsif v_dt_at is not null and v_ot_at is not null and v_day_mins >= v_ot_at then
        v_take := least(v_mins, v_dt_at - v_day_mins);
        v_over := v_over + v_take;
      elsif v_ot_at is not null and v_day_mins >= v_ot_at then
        v_take := v_mins;
        v_over := v_over + v_take;
      elsif v_ot_at is not null then
        v_take := least(v_mins, v_ot_at - v_day_mins);
        -- Straight so far as the day goes; the week may still push it over.
        if v_wk_at is not null and v_week_to_date >= v_wk_at then
          v_over := v_over + v_take;
        elsif v_wk_at is not null and v_week_to_date + v_take > v_wk_at then
          v_over      := v_over + (v_week_to_date + v_take - v_wk_at);
          v_straight  := v_straight + (v_wk_at - v_week_to_date);
          v_week_to_date := v_wk_at;
        else
          v_straight := v_straight + v_take;
          v_week_to_date := v_week_to_date + v_take;
        end if;
      else
        v_take := v_mins;
        if v_wk_at is not null and v_week_to_date >= v_wk_at then
          v_over := v_over + v_take;
        elsif v_wk_at is not null and v_week_to_date + v_take > v_wk_at then
          v_over      := v_over + (v_week_to_date + v_take - v_wk_at);
          v_straight  := v_straight + (v_wk_at - v_week_to_date);
          v_week_to_date := v_wk_at;
        else
          v_straight := v_straight + v_take;
          v_week_to_date := v_week_to_date + v_take;
        end if;
      end if;

      v_day_mins := v_day_mins + v_take;
      v_mins := v_mins - v_take;
    end loop;

    return query
      insert into time_entries (
        company_id, employee_id, project_id, project_task_id, cost_code_id,
        work_date, straight_hours, overtime_hours, doubletime_hours,
        source, approval_state, created_by, notes)
      values (
        v_company, p_employee, r.project_id, r.project_task_id, r.cost_code_id,
        p_day,
        round(v_straight / 60, 2), round(v_over / 60, 2), round(v_double / 60, 2),
        'clock', 'pending', auth.uid(),
        'Posted from the time clock')
      returning *;
  end loop;
end;
$$;

comment on function public.post_punches_to_timecard(uuid, date) is
  'Turns one finished day of punches into time_entries with source = clock, splitting straight, overtime and doubletime by the company overtime policy. Replaces its own previous output for that day; never touches a hand-typed entry.';

/** The days that have punches on them and no timecard rows yet. */
create or replace view my_unposted_days as
select
  d.company_id,
  d.employee_id,
  e.full_name as employee_name,
  d.work_date,
  d.punches,
  d.has_a_clock_out
from (
  select
    p.company_id,
    p.employee_id,
    (p.punched_at at time zone 'UTC')::date as work_date,
    count(*)                                as punches,
    bool_or(p.kind = 'out')                 as has_a_clock_out
  from time_punches p
  where p.voided_at is null
  group by p.company_id, p.employee_id, (p.punched_at at time zone 'UTC')::date
) d
join employees e on e.id = d.employee_id
where not exists (
  select 1 from time_entries te
  where te.employee_id = d.employee_id
    and te.work_date = d.work_date
    and te.source = 'clock'
);

revoke all on my_unposted_days from public, anon;
grant select on my_unposted_days to authenticated;
alter view my_unposted_days set (security_invoker = on);

revoke all on function public.post_punches_to_timecard(uuid, date) from public, anon;
grant execute on function public.post_punches_to_timecard(uuid, date) to authenticated;
revoke all on function public.set_overtime_policy(uuid, numeric, numeric, numeric, int, int, text) from public, anon;
grant execute on function public.set_overtime_policy(uuid, numeric, numeric, numeric, int, int, text) to authenticated;
