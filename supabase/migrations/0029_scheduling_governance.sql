-- =============================================================================
-- 0029 — Scheduling governance: calendars, calculations, baselines
--
-- The platform already stored schedule activities, four kinds of dependency
-- with lag, `total_float_days` and `is_critical`. It computed none of it. A
-- check constraint required that float and criticality agree with each other,
-- which is a real guarantee about two numbers a person typed.
--
-- Three things were missing, and all three are load-bearing:
--
--   * **A calendar.** A duration in days is not a span of dates until something
--     says which days are worked. Without one, five days from Friday is
--     Wednesday, and the platform had no way to know that.
--   * **Provenance for float.** `total_float_days` could be any number.
--     Float now cannot be stated without naming the calculation that produced
--     it, which is enforced by a constraint rather than by convention.
--   * **A baseline.** "We are three weeks late" is an assertion until there is
--     an approved schedule to be late against.
--
-- The arithmetic itself lives in `@grounup/engine` (`schedule.ts`,
-- `calendar.ts`), deterministic and tested. This migration is where its results
-- are governed: who may write them, what they must reference, and what can
-- never be edited afterwards.
-- =============================================================================

/**
 * Whether an array holds no repeated element.
 *
 * A check constraint cannot contain a subquery, and `distinct` needs one, so
 * the query moves into an immutable function where it is allowed. Used to stop
 * `{1,1,2}` being read as a three-day week.
 */
create or replace function app.array_is_distinct(p_values smallint[])
returns boolean
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select cardinality(p_values) = cardinality(array(select distinct unnest(p_values)));
$$;

-- -----------------------------------------------------------------------------
-- Work calendars
--
-- A LIBRARY: reusable knowledge, not a business record. Company-scoped, because
-- a working week and a holiday list are a company's own — the platform has no
-- business seeding what days a contractor in another state works.
-- -----------------------------------------------------------------------------
create table work_calendars (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  code                text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]*$'),
  name                text not null check (length(trim(name)) > 0),
  description         text,

  -- 0 is Sunday, matching every date library anyone will read this beside.
  -- `cardinality`, not `array_length`: array_length returns NULL for an empty
  -- array, a NULL check passes, and `{}` would have been a legal working week.
  working_weekdays    smallint[] not null
                        check (cardinality(working_weekdays) between 1 and 7),
  -- Hours in a normal working day, for converting durations to crew hours.
  hours_per_day       numeric(5,2) not null default 8
                        check (hours_per_day > 0 and hours_per_day <= 24),
  is_default          boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (company_id, code),
  -- A calendar with no working days would make every schedule on it run
  -- forever looking for the next day somebody works.
  constraint work_calendars_weekdays_valid check (
    working_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
    and app.array_is_distinct(working_weekdays)
  )
);

-- One default per company. A second would make "the company calendar"
-- ambiguous at exactly the moment somebody relies on it.
create unique index work_calendars_one_default
  on work_calendars(company_id) where is_default;

comment on table work_calendars is
  'A working week and the hours in its day. LIBRARY, company-scoped. The engine reads this to turn a duration in working days into a span of dates.';

comment on column work_calendars.working_weekdays is
  'Days of the week normally worked, 0 = Sunday. At least one, at most seven, no duplicates.';

create table work_calendar_exceptions (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  calendar_id         uuid not null references work_calendars(id) on delete cascade,
  exception_date      date not null,
  -- 'holiday' turns a working weekday off; 'working' turns a weekend day on.
  kind                text not null check (kind in ('holiday', 'working')),
  name                text not null check (length(trim(name)) > 0),
  created_at          timestamptz not null default now(),

  -- One row per date per calendar. Without this a date could be listed as both
  -- a holiday and a working exception, and the calendar would mean different
  -- things depending on which row was read first — the engine refuses exactly
  -- that input, and the database should not be able to produce it.
  unique (calendar_id, exception_date)
);
create index work_calendar_exceptions_calendar_idx
  on work_calendar_exceptions(calendar_id, exception_date);

create trigger work_calendar_exceptions_tenant_parent
  before insert or update on work_calendar_exceptions
  for each row execute function app.enforce_tenant_parent('work_calendars', 'calendar_id', 'id');

comment on table work_calendar_exceptions is
  'Holidays and scheduled weekend work. LIBRARY, child of work_calendars. One row per date per calendar, so a date is never both.';

-- -----------------------------------------------------------------------------
-- Schedule calculations
--
-- An ENTITY recording one run of the critical path method: which engine, from
-- which data date, producing which project dates. Append-only, because a
-- calculation is something that happened.
-- -----------------------------------------------------------------------------
create table schedule_calculations (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  project_id          uuid not null references projects(id) on delete cascade,

  -- Where the forward pass started. On an update cycle this is the data date,
  -- not the project start, and the distinction is the whole update cycle.
  data_date           date not null,
  engine_version      text not null check (length(trim(engine_version)) > 0),
  calendar_id         uuid references work_calendars(id) on delete set null,

  project_start       date not null,
  project_finish      date not null,
  duration_working_days int not null check (duration_working_days >= 0),
  required_finish     date,
  -- Working days between the computed finish and the required one. Negative is
  -- late, and negative is the number a scheduler is actually looking for.
  finish_float_days   int,
  critical_path       uuid[] not null default '{}',
  warnings            text[] not null default '{}',

  calculated_by       uuid references auth.users(id) on delete set null,
  calculated_at       timestamptz not null default now(),

  constraint schedule_calculations_span check (project_finish >= project_start)
);
create index schedule_calculations_project_idx
  on schedule_calculations(project_id, calculated_at desc);

create trigger schedule_calculations_tenant_parent
  before insert or update on schedule_calculations
  for each row execute function app.enforce_tenant_parent('projects', 'project_id', 'id');

-- A calculation is a record of a run. Re-running produces a new row; editing
-- an old one rewrites what the schedule said at the time somebody acted on it.
create trigger schedule_calculations_immutable
  before update on schedule_calculations
  for each row execute function app.forbid_mutation();

comment on table schedule_calculations is
  'One run of the critical path method, append-only. ENTITY. The dates on schedule_activities point back here, so a float figure always names the calculation that produced it.';

-- -----------------------------------------------------------------------------
-- Float has to come from somewhere
--
-- Before this, `total_float_days` was a column any caller could set to any
-- number, and the interface displayed it as though the platform had computed
-- it. The constraint below is the difference between a schedule and a picture
-- of one.
-- -----------------------------------------------------------------------------
alter table schedule_activities
  add column calendar_id    uuid references work_calendars(id) on delete set null,
  add column calculation_id uuid references schedule_calculations(id) on delete set null,
  add column early_start    date,
  add column early_finish   date,
  add column late_start     date,
  add column late_finish    date,
  add column free_float_days numeric(8,2);

alter table schedule_activities
  add constraint schedule_activities_float_is_calculated
    check (total_float_days is null or calculation_id is not null),
  add constraint schedule_activities_free_float_is_calculated
    check (free_float_days is null or calculation_id is not null),
  add constraint schedule_activities_early_dates
    check (early_finish is null or early_start is null or early_finish >= early_start),
  add constraint schedule_activities_late_dates
    check (late_finish is null or late_start is null or late_finish >= late_start);

comment on constraint schedule_activities_float_is_calculated on schedule_activities is
  'Float cannot be asserted, only computed. A row carrying total_float_days must name the calculation that produced it.';

comment on column schedule_activities.calculation_id is
  'The critical path run these dates came from. Null means nobody has calculated this schedule yet, which is an honest state and a visible one.';

-- -----------------------------------------------------------------------------
-- Baselines
--
-- An ENTITY: the schedule as approved, kept so today can be read against it.
-- There is deliberately no `is_current` column. The current baseline is the
-- most recent one, derived — the same lesson the library row history taught,
-- where a stored "current" flag and an append-only table cannot both be true.
-- -----------------------------------------------------------------------------
create table schedule_baselines (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  project_id          uuid not null references projects(id) on delete cascade,
  name                text not null check (length(trim(name)) > 0),
  -- The date the schedule was approved, carried as data rather than read from
  -- a clock, so importing a baseline set last March records last March.
  taken_on            date not null,
  -- Why this baseline exists: original award, change order, recovery schedule.
  reason              text not null check (length(trim(reason)) >= 8),
  calculation_id      uuid references schedule_calculations(id) on delete set null,
  approved_by         uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),

  unique (project_id, name)
);
create index schedule_baselines_project_idx
  on schedule_baselines(project_id, taken_on desc, created_at desc);

create trigger schedule_baselines_tenant_parent
  before insert or update on schedule_baselines
  for each row execute function app.enforce_tenant_parent('projects', 'project_id', 'id');

create trigger schedule_baselines_immutable
  before update on schedule_baselines
  for each row execute function app.forbid_mutation();

comment on table schedule_baselines is
  'The schedule as approved. ENTITY, append-only. The current baseline is the most recent by taken_on, derived rather than flagged.';

create table schedule_baseline_activities (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  baseline_id         uuid not null references schedule_baselines(id) on delete cascade,

  -- Deliberately not a foreign key. A baseline has to survive the deletion of
  -- the activity it recorded, or an activity dropped from the schedule would
  -- silently vanish from the variance report instead of showing as removed
  -- work. Existence and tenancy are checked at insert by the trigger below.
  schedule_activity_id uuid not null,

  wbs_code            text,
  name                text not null check (length(trim(name)) > 0),
  planned_start       date not null,
  planned_finish      date not null,
  duration_days       numeric(8,2) not null check (duration_days >= 0),
  total_float_days    numeric(8,2),
  is_critical         boolean not null default false,
  is_milestone        boolean not null default false,
  created_at          timestamptz not null default now(),

  unique (baseline_id, schedule_activity_id),
  constraint schedule_baseline_activities_dates check (planned_finish >= planned_start)
);
create index schedule_baseline_activities_baseline_idx
  on schedule_baseline_activities(baseline_id);

create trigger schedule_baseline_activities_tenant_parent
  before insert or update on schedule_baseline_activities
  for each row execute function app.enforce_tenant_parent('schedule_baselines', 'baseline_id', 'id');

create trigger schedule_baseline_activities_immutable
  before update on schedule_baseline_activities
  for each row execute function app.forbid_mutation();

comment on table schedule_baseline_activities is
  'One activity as it stood when the baseline was taken. ENTITY, append-only. schedule_activity_id carries no foreign key on purpose, so deleting an activity shows up as removed work rather than disappearing.';

/**
 * The baselined activity must exist, and must belong to the same company.
 *
 * The column carries no foreign key so that a later deletion cannot erase the
 * baseline, which means insert-time validation has to do the work the
 * constraint would otherwise have done.
 */
create or replace function app.enforce_baseline_activity_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_owner uuid;
begin
  select company_id into v_owner
  from public.schedule_activities
  where id = new.schedule_activity_id;

  if v_owner is null then
    raise exception 'Cannot baseline schedule activity % because it does not exist.',
      new.schedule_activity_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_owner <> new.company_id then
    raise exception
      'Baseline company % does not own schedule activity % (owned by %). A baseline cannot cross a tenant boundary.',
      new.company_id, new.schedule_activity_id, v_owner
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

create trigger schedule_baseline_activities_activity_guard
  before insert on schedule_baseline_activities
  for each row execute function app.enforce_baseline_activity_tenant();

/**
 * The current baseline for a project: the most recent one taken.
 *
 * Derived rather than flagged. A stored `is_current` on an append-only table
 * cannot be maintained without an update, and an update is exactly what
 * append-only forbids.
 *
 * SECURITY INVOKER, so it sees only what the caller could already read.
 */
create or replace function app.current_schedule_baseline(p_project uuid)
returns uuid
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select b.id
  from schedule_baselines b
  where b.project_id = p_project
  order by b.taken_on desc, b.created_at desc
  limit 1;
$$;

comment on function app.current_schedule_baseline(uuid) is
  'The project''s most recent baseline. Derived, because an append-only table cannot carry a maintained current flag.';

-- -----------------------------------------------------------------------------
-- Variance
--
-- The reason baselines exist. security_invoker, like every reporting view here,
-- so it can never become the way around row level security.
-- -----------------------------------------------------------------------------
create or replace view reporting_schedule_variance
with (security_invoker = true) as
select
  a.company_id,
  a.project_id,
  b.id                                as baseline_id,
  b.name                              as baseline_name,
  b.taken_on                          as baseline_taken_on,
  a.id                                as schedule_activity_id,
  a.wbs_code,
  a.name                              as activity_name,
  ba.planned_start                    as baseline_start,
  ba.planned_finish                   as baseline_finish,
  coalesce(a.early_start, a.planned_start)   as current_start,
  coalesce(a.early_finish, a.planned_finish) as current_finish,
  coalesce(a.early_start, a.planned_start) - ba.planned_start    as start_variance_days,
  coalesce(a.early_finish, a.planned_finish) - ba.planned_finish as finish_variance_days,
  a.total_float_days,
  a.is_critical,
  a.percent_complete,
  a.calculation_id,
  case
    when ba.id is null then 'not_in_baseline'
    when coalesce(a.early_finish, a.planned_finish) > ba.planned_finish then 'behind'
    when coalesce(a.early_finish, a.planned_finish) < ba.planned_finish then 'ahead'
    else 'on_baseline'
  end                                 as status
from schedule_activities a
join schedule_baselines b
  on b.id = app.current_schedule_baseline(a.project_id)
left join schedule_baseline_activities ba
  on ba.baseline_id = b.id and ba.schedule_activity_id = a.id;

comment on view reporting_schedule_variance is
  'Every activity against the project''s current baseline. Variance is in calendar days here because a report row is a date difference; working-day variance is computed by the engine, which knows the calendar.';

-- -----------------------------------------------------------------------------
-- RLS and grants
-- -----------------------------------------------------------------------------
select app.apply_tenant_rls('work_calendars', null, 'projects.write');
select app.apply_tenant_rls('work_calendar_exceptions', null, 'projects.write');
select app.apply_tenant_rls('schedule_calculations', null, 'projects.write');
select app.apply_tenant_rls('schedule_baselines', null, 'projects.write');
select app.apply_tenant_rls('schedule_baseline_activities', null, 'projects.write');

grant select on reporting_schedule_variance to authenticated;
revoke all on reporting_schedule_variance from anon;

select app.assert_security_gates();
