-- =============================================================================
-- 0122 — The clock on the wall
--
-- `time_entries` has been in this schema since migration 0015 and it is a
-- *timecard*: eight straight hours and two of overtime, typed in for a day that
-- is already over. It is what payroll needs and it is not what a person does at
-- 6:41 in the morning standing at a job trailer.
--
-- What they do is punch. This migration adds the punch — the fact of it, with
-- the minute and the place and the job it was against — and derives the day
-- from the punches rather than asking anyone to remember it.
--
-- Three things follow from a punch being a fact rather than a number:
--
--   * It is append-only. There is no update policy and no delete policy on this
--     table. A mistake is corrected by voiding the punch, which writes a reason
--     and leaves the original where it was, because "I clocked in at 6:41" and
--     "somebody said I clocked in at 7:00" are different claims and a payroll
--     dispute needs to be able to tell them apart.
--
--   * The order is enforced. You cannot clock in twice, take a break you are
--     not on the clock for, or clock out of a break without ending it. The
--     database refuses rather than guessing, because every guess here is a
--     guess about what somebody is owed.
--
--   * Punching *yourself* in needs no permission beyond being the employee. The
--     existing `time_entries` policy requires `projects.write` to insert, which
--     is correct for a supervisor filling in a crew's week and absurd as the
--     price of admission for a laborer recording their own start. Punching
--     somebody *else* in is a different act and needs `hr.write`.
--
-- Hours are not stored here. `app.punch_day` pairs the punches and returns what
-- they add up to; migration 0123 posts that to the timecard under a company's
-- own overtime rule. Deriving it means a voided punch changes the answer, which
-- is the entire point.
-- =============================================================================

do $type$ begin
  create type app.punch_kind as enum ('in', 'out', 'break_start', 'break_end');
exception when duplicate_object then null;
end $type$;

comment on type app.punch_kind is
  'The four things a person can do at a time clock. Breaks are punched rather than deducted as a fixed number, because an unpaid half hour a crew did not take is a wage claim.';

create table if not exists time_punches (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  employee_id       uuid not null references employees(id) on delete cascade,
  kind              app.punch_kind not null,
  punched_at        timestamptz not null default now(),

  -- What the time is against. Null is honest for a shop day with no job number.
  project_id        uuid references projects(id) on delete set null,
  project_task_id   uuid references project_tasks(id) on delete set null,
  cost_code_id      uuid references cost_codes(id) on delete set null,

  -- Where it was punched, when the device offered to say.
  latitude          numeric(9,6),
  longitude         numeric(9,6),
  accuracy_meters   numeric(8,1) check (accuracy_meters is null or accuracy_meters >= 0),

  source            text not null default 'web'
                      check (source in ('web', 'mobile', 'kiosk', 'supervisor', 'import')),
  device_label      text,
  note              text,

  -- The login that recorded it, which is not always the employee it is for.
  punched_by        uuid references auth.users(id) on delete set null,

  -- A correction. The row stays; it stops counting.
  voided_at         timestamptz,
  voided_by         uuid references auth.users(id) on delete set null,
  void_reason       text,

  created_at        timestamptz not null default now()
);

alter table time_punches drop constraint if exists time_punches_void_is_explained;
alter table time_punches add constraint time_punches_void_is_explained
  check (voided_at is null or (voided_by is not null and coalesce(btrim(void_reason), '') <> ''));

alter table time_punches drop constraint if exists time_punches_position_is_a_pair;
alter table time_punches add constraint time_punches_position_is_a_pair
  check ((latitude is null) = (longitude is null));

alter table time_punches drop constraint if exists time_punches_position_is_on_earth;
alter table time_punches add constraint time_punches_position_is_on_earth
  check (latitude is null
         or (latitude between -90 and 90 and longitude between -180 and 180));

create index if not exists time_punches_employee_idx
  on time_punches(employee_id, punched_at desc);
create index if not exists time_punches_live_idx
  on time_punches(employee_id, punched_at desc) where voided_at is null;
create index if not exists time_punches_company_day_idx
  on time_punches(company_id, punched_at desc) where voided_at is null;
create index if not exists time_punches_project_idx
  on time_punches(project_id, punched_at desc) where project_id is not null and voided_at is null;

drop trigger if exists time_punches_tenant_parent on time_punches;
create trigger time_punches_tenant_parent
  before insert or update on time_punches
  for each row execute function app.enforce_tenant_parent('employees', 'employee_id', 'id');

-- -----------------------------------------------------------------------------
-- A permission a foreman can hold
-- -----------------------------------------------------------------------------

/*
 * Punching a crew in is the ordinary morning of a foreman at a job trailer, and
 * before this there was no role that could do it. `hr.write` — the permission
 * guarding the employee record itself — is held by the owner and the
 * administrator and nobody else, which is right for editing somebody's hourly
 * rate and much too much for recording that they showed up.
 *
 * So the act gets its own permission. A foreman who holds it can punch the crew
 * and read the board; they still cannot open an employee record.
 */
update roles set permissions = array(
  select distinct unnest(permissions || array['time.punch_crew'])
) where company_id is null
    and key in ('owner', 'admin', 'project_manager', 'superintendent', 'foreman');

-- -----------------------------------------------------------------------------
-- Who a punch is for
-- -----------------------------------------------------------------------------

/**
 * The employee record belonging to the signed-in user, in a given company.
 *
 * Field staff often have no login at all — the `employees.user_id` comment has
 * said so since 0015 — so this returning null is an ordinary state and means
 * "this person punches at a kiosk, not as themselves".
 */
create or replace function app.employee_for_user(p_company uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select e.id
  from employees e
  where e.company_id = p_company
    and e.user_id = auth.uid()
    and e.status <> 'terminated'
  order by e.created_at
  limit 1;
$$;

comment on function app.employee_for_user(uuid) is
  'The employee row for the signed-in user in one company, or null when they have no employee record there.';

/** Is this punch the caller recording their own time? */
create or replace function app.punching_for_self(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from employees e
    where e.id = p_employee and e.user_id = auth.uid()
  );
$$;

-- -----------------------------------------------------------------------------
-- The order punches have to come in
-- -----------------------------------------------------------------------------

/**
 * What the employee's clock says right now: the kind of their last live punch,
 * or null when they have never punched or last punched out.
 *
 * `p_before` exists so the sequence check can ask what the state was at the
 * moment of a punch being inserted, rather than what it is now — otherwise a
 * kiosk uploading yesterday's punches after a signal drop would be judged
 * against today.
 */
create or replace function app.clock_state(p_employee uuid, p_before timestamptz default null)
returns app.punch_kind
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select p.kind
  from time_punches p
  where p.employee_id = p_employee
    and p.voided_at is null
    and (p_before is null or p.punched_at < p_before)
  order by p.punched_at desc, p.created_at desc
  limit 1;
$$;

comment on function app.clock_state(uuid, timestamptz) is
  'The last live punch kind for an employee: in, out, break_start, break_end, or null when they have never punched.';

/**
 * Which punches may follow which, and what to say when one may not.
 *
 * Clocking out while on break is refused rather than absorbed. Treating the
 * break as ending at the punch-out would credit the whole break as worked; the
 * other reading credits nothing after the break began. Both are inventions
 * about somebody's pay, so the clock says what is wrong and lets them fix it.
 */
create or replace function app.punch_refusal(p_state app.punch_kind, p_kind app.punch_kind)
returns text
language sql
immutable
as $$
  select case
    when p_kind = 'in'          and p_state = 'in'          then 'Already clocked in. Clock out before starting another shift.'
    when p_kind = 'in'          and p_state = 'break_start' then 'On break. End the break instead of clocking in again.'
    when p_kind = 'in'          and p_state = 'break_end'   then 'Already clocked in. Clock out before starting another shift.'
    when p_kind = 'out'         and p_state is null         then 'Not clocked in, so there is nothing to clock out of.'
    when p_kind = 'out'         and p_state = 'out'         then 'Already clocked out.'
    when p_kind = 'out'         and p_state = 'break_start' then 'On break. End the break before clocking out.'
    when p_kind = 'break_start' and p_state is null         then 'Not clocked in. Clock in before starting a break.'
    when p_kind = 'break_start' and p_state = 'out'         then 'Not clocked in. Clock in before starting a break.'
    when p_kind = 'break_start' and p_state = 'break_start' then 'Already on break.'
    when p_kind = 'break_end'   and p_state is distinct from 'break_start'
                                                            then 'Not on break, so there is no break to end.'
    else null
  end;
$$;

create or replace function app.enforce_punch_sequence()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_state    app.punch_kind;
  v_refusal  text;
  v_previous timestamptz;
  v_status   text;
  v_exported timestamptz;
begin
  if new.punched_at > now() + interval '2 minutes' then
    raise exception 'A punch cannot be in the future. % is % ahead of now.',
      new.punched_at, justify_interval(new.punched_at - now())
      using errcode = 'check_violation';
  end if;

  select e.status into v_status from employees e where e.id = new.employee_id;
  if v_status in ('terminated', 'applicant') then
    raise exception 'Employee is %; a % employee cannot punch a clock.', v_status, v_status
      using errcode = 'check_violation';
  end if;

  /*
   * A day that has gone to payroll is closed here for the same reason
   * `app.enforce_time_entry_lock` closes the timecard: the money is out.
   */
  select te.exported_at into v_exported
  from time_entries te
  where te.employee_id = new.employee_id
    and te.work_date = (new.punched_at at time zone 'UTC')::date
    and te.exported_at is not null
  limit 1;
  if v_exported is not null then
    raise exception 'The timecard for % was exported to payroll on %. Punches for that day are closed; post an adjusting entry instead.',
      (new.punched_at at time zone 'UTC')::date, v_exported::date
      using errcode = 'restrict_violation';
  end if;

  select max(p.punched_at) into v_previous
  from time_punches p
  where p.employee_id = new.employee_id and p.voided_at is null and p.id <> new.id;

  if v_previous is not null and new.punched_at < v_previous then
    raise exception 'Punches are recorded in order. The last punch for this employee was at %, which is after %.',
      v_previous, new.punched_at
      using errcode = 'check_violation';
  end if;

  v_state := app.clock_state(new.employee_id, new.punched_at);
  v_refusal := app.punch_refusal(v_state, new.kind);
  if v_refusal is not null then
    raise exception '%', v_refusal using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_punch_sequence on time_punches;
create trigger enforce_punch_sequence
  before insert on time_punches
  for each row execute function app.enforce_punch_sequence();

-- -----------------------------------------------------------------------------
-- Punching
-- -----------------------------------------------------------------------------

/**
 * Record a punch.
 *
 * `p_employee` defaults to the caller's own employee record. Passing somebody
 * else's is supervising, and needs `hr.write` in their company.
 */
create or replace function app.punch(
  p_company        uuid,
  p_kind           app.punch_kind,
  p_employee       uuid    default null,
  p_project        uuid    default null,
  p_task           uuid    default null,
  p_cost_code      uuid    default null,
  p_note           text    default null,
  p_latitude       numeric default null,
  p_longitude      numeric default null,
  p_accuracy       numeric default null,
  p_source         text    default 'web',
  p_device         text    default null,
  p_at             timestamptz default null
)
returns time_punches
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_employee uuid := coalesce(p_employee, app.employee_for_user(p_company));
  v_row      time_punches;
begin
  if not app.is_member(p_company) then
    raise exception 'You are not a member of that company.' using errcode = 'insufficient_privilege';
  end if;

  if v_employee is null then
    raise exception 'There is no employee record for you in this company, so there is nothing to clock in. Ask an administrator to add you, or punch at a kiosk.'
      using errcode = 'no_data_found';
  end if;

  if not app.punching_for_self(v_employee)
     and not app.has_permission(p_company, 'time.punch_crew')
     and not app.has_permission(p_company, 'hr.write') then
    raise exception 'Recording time for another employee needs the time.punch_crew permission.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from employees e where e.id = v_employee and e.company_id = p_company) then
    raise exception 'That employee is not in this company.' using errcode = 'insufficient_privilege';
  end if;

  insert into time_punches (
    company_id, employee_id, kind, punched_at,
    project_id, project_task_id, cost_code_id,
    latitude, longitude, accuracy_meters,
    source, device_label, note, punched_by
  ) values (
    p_company, v_employee, p_kind, coalesce(p_at, now()),
    p_project, p_task, p_cost_code,
    p_latitude, p_longitude, p_accuracy,
    case when p_employee is not null and not app.punching_for_self(v_employee)
         then 'supervisor' else coalesce(p_source, 'web') end,
    p_device, nullif(btrim(p_note), ''), auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.clock_in(
  p_company uuid, p_project uuid default null, p_task uuid default null,
  p_cost_code uuid default null, p_note text default null,
  p_latitude numeric default null, p_longitude numeric default null,
  p_accuracy numeric default null, p_employee uuid default null,
  p_source text default 'web', p_device text default null)
returns time_punches
language sql
security definer
set search_path = public, pg_catalog
as $$
  select app.punch(p_company, 'in', p_employee, p_project, p_task, p_cost_code,
                   p_note, p_latitude, p_longitude, p_accuracy, p_source, p_device);
$$;

create or replace function public.clock_out(
  p_company uuid, p_note text default null,
  p_latitude numeric default null, p_longitude numeric default null,
  p_accuracy numeric default null, p_employee uuid default null,
  p_source text default 'web', p_device text default null)
returns time_punches
language sql
security definer
set search_path = public, pg_catalog
as $$
  select app.punch(p_company, 'out', p_employee, null, null, null,
                   p_note, p_latitude, p_longitude, p_accuracy, p_source, p_device);
$$;

create or replace function public.start_break(
  p_company uuid, p_note text default null, p_employee uuid default null)
returns time_punches
language sql
security definer
set search_path = public, pg_catalog
as $$
  select app.punch(p_company, 'break_start', p_employee, null, null, null, p_note);
$$;

create or replace function public.end_break(
  p_company uuid, p_note text default null, p_employee uuid default null)
returns time_punches
language sql
security definer
set search_path = public, pg_catalog
as $$
  select app.punch(p_company, 'break_end', p_employee, null, null, null, p_note);
$$;

/**
 * Void a punch, leaving it in place.
 *
 * Only the employee's most recent live punch can be voided, and only by
 * somebody who could have made it. Voiding out of the middle of a day would
 * leave a sequence the state machine would never have permitted — two clock-ins
 * with nothing between them — and there is no honest way to compute a day like
 * that. Older mistakes are corrected on the timecard, which is the record
 * payroll reads and which already has an approval trail on it.
 */
create or replace function public.void_punch(p_punch uuid, p_reason text)
returns time_punches
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row  time_punches;
  v_last uuid;
begin
  select * into v_row from time_punches where id = p_punch;
  if v_row.id is null then
    raise exception 'No such punch.' using errcode = 'no_data_found';
  end if;
  if not app.is_member(v_row.company_id) then
    raise exception 'You are not a member of that company.' using errcode = 'insufficient_privilege';
  end if;
  if not app.punching_for_self(v_row.employee_id)
     and not app.has_permission(v_row.company_id, 'time.punch_crew')
     and not app.has_permission(v_row.company_id, 'hr.write') then
    raise exception 'Voiding another employee''s punch needs the time.punch_crew permission.'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why the punch is being voided. It stays on the record either way.'
      using errcode = 'check_violation';
  end if;
  if v_row.voided_at is not null then
    raise exception 'That punch was already voided on %.', v_row.voided_at::date
      using errcode = 'check_violation';
  end if;

  select p.id into v_last
  from time_punches p
  where p.employee_id = v_row.employee_id and p.voided_at is null
  order by p.punched_at desc, p.created_at desc
  limit 1;

  if v_last is distinct from p_punch then
    raise exception 'Only the most recent punch can be voided. Correct an earlier one on the timecard instead.'
      using errcode = 'restrict_violation';
  end if;

  update time_punches
     set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
   where id = p_punch
  returning * into v_row;

  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- What the punches add up to
-- -----------------------------------------------------------------------------

/**
 * One employee's day, paired.
 *
 * `worked_minutes` is time between a clock-in and the matching clock-out, less
 * any break inside it. `open` is true when they are still on the clock, in
 * which case the total is what they have worked *so far* — a running number
 * shown on a screen, never a number posted to payroll.
 *
 * The pairing walks the punches in order rather than joining in-to-out, because
 * a day with a break in it has three intervals and a join has to be told how to
 * find them. A walk just reads what happened.
 */
create or replace function app.punch_day(p_employee uuid, p_day date)
returns table (
  employee_id     uuid,
  work_date       date,
  first_in        timestamptz,
  last_out        timestamptz,
  worked_minutes  numeric,
  break_minutes   numeric,
  punch_count     integer,
  open            boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  r            record;
  v_on         timestamptz;   -- when the current worked interval began
  v_break      timestamptz;   -- when the current break began
  v_worked     numeric := 0;
  v_break_mins numeric := 0;
  v_first      timestamptz;
  v_last       timestamptz;
  v_count      integer := 0;
  v_open       boolean := false;
begin
  for r in
    select p.kind, p.punched_at
    from time_punches p
    where p.employee_id = p_employee
      and p.voided_at is null
      and (p.punched_at at time zone 'UTC')::date = p_day
    order by p.punched_at, p.created_at
  loop
    v_count := v_count + 1;
    if r.kind = 'in' then
      v_on := r.punched_at;
      v_first := coalesce(v_first, r.punched_at);
    elsif r.kind = 'break_start' then
      v_break := r.punched_at;
    elsif r.kind = 'break_end' then
      if v_break is not null then
        v_break_mins := v_break_mins + extract(epoch from (r.punched_at - v_break)) / 60;
        v_break := null;
      end if;
    elsif r.kind = 'out' then
      if v_on is not null then
        v_worked := v_worked + extract(epoch from (r.punched_at - v_on)) / 60;
        v_on := null;
      end if;
      v_last := r.punched_at;
    end if;
  end loop;

  /*
   * Still on the clock. Count up to now so the screen can show a running total,
   * and say so, so nothing downstream mistakes it for a finished day.
   */
  if v_on is not null then
    v_open := true;
    v_worked := v_worked + extract(epoch from (now() - v_on)) / 60;
    if v_break is not null then
      v_break_mins := v_break_mins + extract(epoch from (now() - v_break)) / 60;
    end if;
  end if;

  return query select
    p_employee, p_day, v_first, v_last,
    round(greatest(v_worked - v_break_mins, 0), 2),
    round(v_break_mins, 2),
    v_count,
    v_open;
end;
$$;

comment on function app.punch_day(uuid, date) is
  'Pairs one employee''s punches for one day into worked and break minutes. Breaks are subtracted from worked time. `open` is true while they are still on the clock, and the total is then a running one.';

-- -----------------------------------------------------------------------------
-- Views
-- -----------------------------------------------------------------------------

/** Every punch the caller is allowed to see, with the names spelled out. */
create or replace view my_time_punches as
select
  p.id, p.company_id, p.employee_id,
  e.full_name        as employee_name,
  e.employee_number,
  p.kind, p.punched_at,
  (p.punched_at at time zone 'UTC')::date as work_date,
  p.project_id, pr.name as project_name,
  p.project_task_id, p.cost_code_id, cc.code as cost_code,
  p.latitude, p.longitude, p.accuracy_meters,
  p.source, p.device_label, p.note,
  p.punched_by,
  (p.punched_by is distinct from e.user_id) as punched_by_somebody_else,
  p.voided_at, p.voided_by, p.void_reason,
  (p.voided_at is not null) as voided,
  p.created_at
from time_punches p
join employees e on e.id = p.employee_id
left join projects pr on pr.id = p.project_id
left join cost_codes cc on cc.id = p.cost_code_id;

/**
 * Who is on the clock, right now.
 *
 * Every active employee appears, including the ones who have not punched today,
 * because "nobody has clocked in on the north job" is the question a
 * superintendent is actually asking and an empty list cannot answer it.
 */
create or replace view my_time_clock as
select
  e.id                as employee_id,
  e.company_id,
  e.full_name         as employee_name,
  e.employee_number,
  e.status,
  app.clock_state(e.id) as state,
  case app.clock_state(e.id)
    when 'in'          then 'On the clock'
    when 'break_end'   then 'On the clock'
    when 'break_start' then 'On break'
    else 'Off the clock'
  end                 as standing,
  last_punch.punched_at as since,
  last_punch.project_id,
  pr.name             as project_name,
  today.worked_minutes,
  today.break_minutes,
  today.open          as still_open
from employees e
left join lateral (
  select p.punched_at, p.project_id
  from time_punches p
  where p.employee_id = e.id and p.voided_at is null
  order by p.punched_at desc, p.created_at desc
  limit 1
) last_punch on true
left join projects pr on pr.id = last_punch.project_id
left join lateral app.punch_day(e.id, (now() at time zone 'UTC')::date) today on true
where e.status not in ('terminated', 'applicant');

-- -----------------------------------------------------------------------------
-- Access
-- -----------------------------------------------------------------------------

/*
 * Written by hand rather than through `app.apply_tenant_rls`, for two reasons
 * the helper cannot express: an employee reaches their own punches without
 * holding an HR permission, and nobody updates or deletes a punch at all. The
 * absence of those two policies is the append-only guarantee — `void_punch` is
 * security definer and is the only way a punch ever changes.
 */
/*
 * And a person can read their own employee record.
 *
 * `employees` has been behind `hr.read` since migration 0016, which is right
 * for a payroll list and means an employee cannot see the row that *is* them —
 * so every view joining `employees` returned nothing to the person it was
 * about, this one included. A second select policy fixes that; policies are
 * OR'd, so `hr.read` still opens the whole roster and nothing else widens.
 */
drop policy if exists employees_select_self on employees;
create policy employees_select_self on employees for select to authenticated
  using (employees.user_id = auth.uid() and app.is_member(employees.company_id));

alter table time_punches enable row level security;
alter table time_punches force row level security;

drop policy if exists time_punches_select on time_punches;
create policy time_punches_select on time_punches for select to authenticated
  using (
    app.is_member(time_punches.company_id)
    and (app.punching_for_self(time_punches.employee_id)
         or app.has_permission(time_punches.company_id, 'time.punch_crew')
         or app.has_permission(time_punches.company_id, 'hr.read'))
  );

drop policy if exists time_punches_insert on time_punches;
create policy time_punches_insert on time_punches for insert to authenticated
  with check (
    app.is_member(company_id)
    and (app.punching_for_self(employee_id)
         or app.has_permission(company_id, 'time.punch_crew')
         or app.has_permission(company_id, 'hr.write'))
  );

revoke all on table time_punches from anon;
grant select, insert on table time_punches to authenticated;

revoke all on my_time_punches from public, anon;
revoke all on my_time_clock from public, anon;
grant select on my_time_punches to authenticated;
grant select on my_time_clock to authenticated;

alter view my_time_punches set (security_invoker = on);
alter view my_time_clock set (security_invoker = on);

revoke all on function app.punch(uuid, app.punch_kind, uuid, uuid, uuid, uuid, text, numeric, numeric, numeric, text, text, timestamptz) from public, anon;
grant execute on function app.punch(uuid, app.punch_kind, uuid, uuid, uuid, uuid, text, numeric, numeric, numeric, text, text, timestamptz) to authenticated;

revoke all on function public.clock_in(uuid, uuid, uuid, uuid, text, numeric, numeric, numeric, uuid, text, text) from public, anon;
grant execute on function public.clock_in(uuid, uuid, uuid, uuid, text, numeric, numeric, numeric, uuid, text, text) to authenticated;
revoke all on function public.clock_out(uuid, text, numeric, numeric, numeric, uuid, text, text) from public, anon;
grant execute on function public.clock_out(uuid, text, numeric, numeric, numeric, uuid, text, text) to authenticated;
revoke all on function public.start_break(uuid, text, uuid) from public, anon;
grant execute on function public.start_break(uuid, text, uuid) to authenticated;
revoke all on function public.end_break(uuid, text, uuid) from public, anon;
grant execute on function public.end_break(uuid, text, uuid) to authenticated;
revoke all on function public.void_punch(uuid, text) from public, anon;
grant execute on function public.void_punch(uuid, text) to authenticated;

select app.attach_standard_triggers('time_punches');
select app.guard_suspension('time_punches');
