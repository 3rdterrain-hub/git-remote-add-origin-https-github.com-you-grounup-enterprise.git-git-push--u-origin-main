-- =============================================================================
-- 0143 — Weather at the job site
--
-- Migration 0105 is titled "Weather where the work is" and keys the forecast
-- `unique (company_id, day)` — one forecast per company, fetched from the
-- coordinates on the company row, which is the yard.
--
-- The work is not at the yard. `projects` has carried `site_address`,
-- `latitude` and `longitude` since 0007, and `app.award_estimate` copies them
-- forward from the estimate when a project is created, so the coordinates of
-- the actual site are already sitting there — read by nothing. A contractor in
-- Toledo with a job in Sandusky is sixty miles and one lake-effect band away
-- from the number on their own daily log.
--
-- So: the same table, keyed by the place instead of only the company.
-- `project_id` null still means the yard, which is what every existing row is
-- and what `app.workable_days` and the schedule still ask for. Nothing that
-- reads the company forecast today changes.
--
--   * two partial unique indexes rather than one composite, because
--     `unique (company_id, project_id, day)` treats every null project as
--     distinct and would let the yard accumulate a row per refresh.
--   * `weather_now` is its own table rather than columns on `weather_days`,
--     because current conditions are a point in time and a day is a range, and
--     folding one into the other is how "today's high" ends up meaning
--     whatever the temperature was when somebody last opened the page.
--
-- Entity: Project. Engine: schedule and calendar efficiency.
-- =============================================================================

alter table weather_days
  add column if not exists project_id uuid references projects(id) on delete cascade;

comment on column weather_days.project_id is
  'The job site this forecast is for. Null is the company yard, which is what every row was before this column existed and what calendar efficiency still reads.';

-- One row per place per day. A composite unique over a nullable column would
-- not constrain the yard at all: in SQL every null is distinct from every other.
alter table weather_days drop constraint if exists weather_days_company_id_day_key;
drop index if exists weather_days_yard_day_idx;
drop index if exists weather_days_site_day_idx;
create unique index if not exists weather_days_yard_day_idx
  on weather_days(company_id, day) where project_id is null;
create unique index if not exists weather_days_site_day_idx
  on weather_days(project_id, day) where project_id is not null;
create index if not exists weather_days_project_day_idx
  on weather_days(project_id, day) where project_id is not null;

/*
 * What it is doing right now, where the crew is standing.
 *
 * Separate from the daily forecast because they answer different questions and
 * expire at different rates: a seven-day forecast is good for hours, and
 * "is it raining on us" is good for minutes.
 */
create table if not exists weather_now (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  project_id    uuid references projects(id) on delete cascade,
  observed_at   timestamptz not null,
  fetched_at    timestamptz not null default now(),

  temperature_f numeric(5,1),
  wind_mph      numeric(6,1) check (wind_mph is null or wind_mph >= 0),
  precip_inches numeric(6,2) not null default 0 check (precip_inches >= 0),
  code          int,
  summary       text
);

drop index if exists weather_now_yard_idx;
drop index if exists weather_now_site_idx;
create unique index if not exists weather_now_yard_idx
  on weather_now(company_id) where project_id is null;
create unique index if not exists weather_now_site_idx
  on weather_now(project_id) where project_id is not null;

comment on table weather_now is
  'Current conditions at a place, replaced on each refresh. The yard when project_id is null, otherwise the job site.';

select app.apply_tenant_rls('weather_days', null, null);
select app.apply_tenant_rls('weather_now', null, null);

/*
 * The read-only guard from 0082. Every table carrying a `company_id` needs it,
 * and the invariant test asserts the coverage from the other side — which is
 * how this line came to be here: the test named `weather_now` on the first gate
 * run after the table existed, rather than the table falling outside every
 * suspension until somebody noticed.
 */
select app.guard_suspension('weather_now');

/*
 * The forecast for a place, and how much of it can be worked.
 *
 * `app.workable_days(company)` from 0105 answers for the yard and is what
 * calendar efficiency reads; it is untouched. This is the same question asked
 * of a site, and a site with no forecast of its own falls back to the yard's
 * rather than returning nothing — a project whose coordinates nobody has
 * entered is the ordinary state on the day it is created.
 */
create or replace function app.workable_days_at(
  p_company uuid, p_project uuid default null, p_days int default 7)
returns table (total int, workable int, efficiency numeric, source text)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with site as (
    select count(*)::int as total,
           count(*) filter (where w.workable)::int as workable
    from weather_days w
    where p_project is not null
      and w.project_id = p_project
      and w.day between current_date and current_date + (p_days - 1)
  ),
  yard as (
    select count(*)::int as total,
           count(*) filter (where w.workable)::int as workable
    from weather_days w
    where w.company_id = p_company
      and w.project_id is null
      and w.day between current_date and current_date + (p_days - 1)
  )
  select t.total, t.workable,
         case when t.total = 0 then null
              else round(t.workable::numeric / t.total, 4) end,
         t.source
  from (
    select site.total, site.workable, 'site'::text as source from site where site.total > 0
    union all
    select yard.total, yard.workable, 'yard'::text from yard
     where (select total from site) = 0
  ) t;
$$;

comment on function app.workable_days_at(uuid, uuid, int) is
  'Working days in the window at a job site, falling back to the company yard when the site has no forecast of its own. `source` says which was used, because an efficiency taken from sixty miles away is a different claim from one taken from the site.';

revoke all on function app.workable_days_at(uuid, uuid, int) from public, anon;
grant execute on function app.workable_days_at(uuid, uuid, int) to authenticated;

create or replace function public.workable_days_at(
  p_company uuid, p_project uuid default null, p_days int default 7)
returns table (total int, workable int, efficiency numeric, source text)
language sql stable security invoker set search_path = public, pg_catalog
as $$ select * from app.workable_days_at(p_company, p_project, p_days); $$;

revoke all on function public.workable_days_at(uuid, uuid, int) from public, anon;
grant execute on function public.workable_days_at(uuid, uuid, int) to authenticated;

/*
 * The forecast, per place, for a screen to read.
 *
 * `my_weather` from 0105 is kept exactly as it was — the dashboard reads it and
 * a view that quietly grew a column would change what that page shows without
 * anybody asking. This one carries the project so a job page can filter to its
 * own site.
 */
create or replace view my_site_weather
with (security_invoker = true) as
select w.company_id, w.project_id, w.day, w.high_f, w.low_f, w.precip_inches,
       w.precip_chance, w.snow_inches, w.wind_gust_mph, w.summary, w.workable,
       w.lost_reason, w.fetched_at
from weather_days w
where w.day >= current_date - 1
order by w.day;

revoke all on my_site_weather from public, anon;
grant select on my_site_weather to authenticated;

create or replace view my_weather_now
with (security_invoker = true) as
select n.company_id, n.project_id, n.observed_at, n.fetched_at,
       n.temperature_f, n.wind_mph, n.precip_inches, n.code, n.summary
from weather_now n;

revoke all on my_weather_now from public, anon;
grant select on my_weather_now to authenticated;

comment on view my_site_weather is
  'The cached forecast for the caller''s own companies and their job sites, from yesterday forward. Refreshing it is the weather Edge Function''s job; this only reads what was fetched.';

/*
 * Replace the forecast for one place, in one statement.
 *
 * The write has to be a function rather than an upsert from the Edge Function,
 * and the reason is the two partial unique indexes above. PostgREST infers an
 * ON CONFLICT target from a column list and has no way to carry an index
 * predicate, so `on_conflict=company_id,day` cannot name
 * `... where project_id is null` and Postgres refuses to infer it. The choice
 * was a generated key column existing only to make an upsert expressible, or
 * the write saying plainly what it does: this place's forecast is replaced.
 * A cached forecast *is* a wholesale replacement — 0105 says so in as many
 * words — so the honest one is also the simpler one.
 *
 * Unknown keys are refused rather than ignored, the rule migrations 0136 and
 * 0139 exist for: a payload naming `windGust` where the column is
 * `wind_gust_mph` would write a row with a null wind and report success, and a
 * day nobody can lose to wind is a day the schedule quietly gains.
 *
 * Workflow: refresh the forecast.
 */
create or replace function app.record_site_weather(
  p_company uuid,
  p_project uuid,
  p_days jsonb,
  p_now jsonb default null
)
returns int
language plpgsql
security invoker
set search_path = public, pg_catalog
as $fn$
declare
  v_day_keys constant text[] := array[
    'day', 'high_f', 'low_f', 'precip_inches', 'precip_chance', 'snow_inches',
    'wind_gust_mph', 'code', 'summary', 'workable', 'lost_reason'];
  v_now_keys constant text[] := array[
    'observed_at', 'temperature_f', 'wind_mph', 'precip_inches', 'code', 'summary'];
  v_unknown text[];
  v_fetched timestamptz := now();
  v_written int;
begin
  if jsonb_typeof(p_days) <> 'array' then
    raise exception 'The forecast is given as an array of days.'
      using errcode = 'invalid_parameter_value';
  end if;

  /*
   * A project from another company would put one tenant's job site in another
   * tenant's forecast. Row level security would refuse the insert, but it would
   * refuse it with a policy violation rather than with the sentence that says
   * what was wrong.
   */
  if p_project is not null
     and not exists (select 1 from projects where id = p_project and company_id = p_company) then
    raise exception 'That project does not belong to this company.'
      using errcode = 'foreign_key_violation';
  end if;

  select array_agg(distinct k order by k) into v_unknown
    from jsonb_array_elements(p_days) d, jsonb_object_keys(d) k
   where k <> all (v_day_keys);
  if v_unknown is not null then
    raise exception 'A forecast day has no field called %.', array_to_string(v_unknown, ', ')
      using errcode = 'undefined_column',
            hint = format('It takes: %s.', array_to_string(v_day_keys, ', '));
  end if;

  if p_now is not null and p_now <> 'null'::jsonb then
    if jsonb_typeof(p_now) <> 'object' then
      raise exception 'Current conditions are given as an object.'
        using errcode = 'invalid_parameter_value';
    end if;
    select array_agg(k order by k) into v_unknown
      from jsonb_object_keys(p_now) k where k <> all (v_now_keys);
    if v_unknown is not null then
      raise exception 'Current conditions have no field called %.',
        array_to_string(v_unknown, ', ')
        using errcode = 'undefined_column',
              hint = format('They take: %s.', array_to_string(v_now_keys, ', '));
    end if;
  end if;

  -- The cache for this place, replaced. `is not distinct from` so the yard's
  -- null project matches the yard's rows rather than nothing.
  delete from weather_days
   where company_id = p_company and project_id is not distinct from p_project;

  insert into weather_days
    (company_id, project_id, day, fetched_at, high_f, low_f, precip_inches,
     precip_chance, snow_inches, wind_gust_mph, code, summary, workable, lost_reason)
  select p_company, p_project, (d->>'day')::date, v_fetched,
         (d->>'high_f')::numeric, (d->>'low_f')::numeric,
         coalesce((d->>'precip_inches')::numeric, 0),
         (d->>'precip_chance')::int,
         coalesce((d->>'snow_inches')::numeric, 0),
         (d->>'wind_gust_mph')::numeric,
         (d->>'code')::int, d->>'summary',
         coalesce((d->>'workable')::boolean, true), d->>'lost_reason'
    from jsonb_array_elements(p_days) d;
  get diagnostics v_written = row_count;

  if p_now is not null and p_now <> 'null'::jsonb then
    delete from weather_now
     where company_id = p_company and project_id is not distinct from p_project;
    insert into weather_now
      (company_id, project_id, observed_at, fetched_at, temperature_f, wind_mph,
       precip_inches, code, summary)
    values (p_company, p_project,
            coalesce((p_now->>'observed_at')::timestamptz, v_fetched), v_fetched,
            (p_now->>'temperature_f')::numeric, (p_now->>'wind_mph')::numeric,
            coalesce((p_now->>'precip_inches')::numeric, 0),
            (p_now->>'code')::int, p_now->>'summary');
  end if;

  return v_written;
end;
$fn$;

comment on function app.record_site_weather(uuid, uuid, jsonb, jsonb) is
  'Replaces the cached forecast, and optionally the current conditions, for one place. Null project is the company yard. Refuses a field name it does not recognize rather than writing a row with a null in it.';

revoke all on function app.record_site_weather(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function app.record_site_weather(uuid, uuid, jsonb, jsonb) to authenticated;

create or replace function public.record_site_weather(
  p_company uuid, p_project uuid, p_days jsonb, p_now jsonb default null)
returns int
language plpgsql security invoker set search_path = public, pg_catalog
as $$
begin
  return app.record_site_weather(p_company, p_project, p_days, p_now);
end;
$$;

revoke all on function public.record_site_weather(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.record_site_weather(uuid, uuid, jsonb, jsonb) to authenticated;

select app.assert_security_gates();
