-- =============================================================================
-- 0105 — Weather where the work is
--
-- Weather is not decoration on a construction dashboard. `estimate_versions`
-- has carried `calendar_efficiency` since 0006 and the schedule engine models
-- weather days; both take a number that somebody guesses. A contractor in
-- Toledo loses days to rain in April and to cold in January, and the platform
-- has never once said how many.
--
-- Two tables. Coordinates are cached on the company because geocoding the same
-- address on every dashboard load is a request nobody needs to make twice, and
-- forecasts are cached because a seven-day forecast does not change between one
-- person opening the page and the next.
--
-- The provider is Open-Meteo, chosen because it needs no API key at all. That
-- is a security decision rather than a convenience one: a key would have to
-- live in a server-side secret, be rotated, and be kept out of the browser,
-- and the simplest way to not leak a credential is to not have one.
-- =============================================================================

alter table companies
  add column latitude  numeric(9,6)  check (latitude is null or latitude between -90 and 90),
  add column longitude numeric(9,6)  check (longitude is null or longitude between -180 and 180),
  add column geocoded_at timestamptz,
  add column geocoded_from text;

comment on column companies.geocoded_from is
  'The address text these coordinates were resolved from. Kept so a company that moves is re-geocoded rather than reporting the weather at the old yard.';

/*
 * A forecast, as it was fetched.
 *
 * Rows rather than a jsonb blob because the question people ask of it is "how
 * many working days does this week have", which is a count over rows and not
 * something to answer by walking JSON in the browser.
 */
create table weather_days (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  day           date not null,
  fetched_at    timestamptz not null default now(),

  high_f        numeric(5,1),
  low_f         numeric(5,1),
  precip_inches numeric(6,2) not null default 0 check (precip_inches >= 0),
  precip_chance int check (precip_chance is null or precip_chance between 0 and 100),
  snow_inches   numeric(6,2) not null default 0 check (snow_inches >= 0),
  wind_gust_mph numeric(6,1) check (wind_gust_mph is null or wind_gust_mph >= 0),
  code          int,
  summary       text,

  /*
   * Whether work can be done, and why not. Stored rather than derived so the
   * thresholds are applied once, by the code that knows them, instead of by
   * every screen that reads a row.
   *
   * This is a cache of the current forecast, not a record of past ones: a
   * refresh replaces the row for a day. Anything that needs to remember what it
   * assumed has to copy the numbers, the way `library_snapshots` copies the
   * rates an estimate was priced from.
   */
  workable      boolean not null default true,
  lost_reason   text,

  unique (company_id, day)
);

create index weather_days_company_day_idx on weather_days(company_id, day);

comment on table weather_days is
  'A cached daily forecast for the company''s own location. Feeds calendar efficiency and the schedule''s weather days, which have always taken a number somebody guessed at.';

comment on column weather_days.workable is
  'Whether the forecast for that day allows work, decided once by the thresholds in the refresh function rather than by every screen that reads the row. A cache of the current forecast: a refresh replaces it, so anything that must remember what it assumed copies the numbers.';

select app.apply_tenant_rls('weather_days', null, null);

/*
 * A suspended account is read-only, and that has to mean everywhere — 0082
 * applies the guard by looping over every tenant table rather than a list
 * somebody maintains, so a new table that forgets it fails the next run. A
 * suspended company simply keeps whatever forecast it last had, which is the
 * right outcome: nothing is lost, and nothing new is written on their behalf.
 */
select app.guard_suspension('weather_days');

/**
 * How many of the next N days can be worked.
 *
 * The figure `calendar_efficiency` has always wanted. Returns null rather than
 * a guess when there is no forecast — an efficiency invented from no data is
 * worse than an empty field, because it looks like it was measured.
 */
create or replace function app.workable_days(p_company uuid, p_days int default 7)
returns table (total int, workable int, efficiency numeric)
language sql stable security definer set search_path = public, pg_catalog
as $$
  select count(*)::int,
         count(*) filter (where w.workable)::int,
         case when count(*) = 0 then null
              else round(count(*) filter (where w.workable)::numeric / count(*), 4) end
  from weather_days w
  where w.company_id = p_company
    and w.day >= current_date
    and w.day < current_date + greatest(coalesce(p_days, 7), 1);
$$;

revoke all on function app.workable_days(uuid, int) from public, anon;
grant execute on function app.workable_days(uuid, int) to authenticated;

/**
 * The forecast for the companies the caller belongs to.
 *
 * A view so the browser reads it through row level security like everything
 * else, rather than through the function that fetches it — reading and
 * refreshing are different operations with different costs, and a dashboard
 * that refreshed the forecast every time somebody opened it would call an
 * external service on every page load.
 */
create or replace view my_weather
with (security_invoker = true) as
select w.company_id, w.day, w.high_f, w.low_f, w.precip_inches, w.precip_chance,
       w.snow_inches, w.wind_gust_mph, w.summary, w.workable, w.lost_reason, w.fetched_at
from weather_days w
where w.day >= current_date - 1
order by w.day;

revoke all on my_weather from public, anon;
grant select on my_weather to authenticated;

comment on view my_weather is
  'The cached forecast for the caller''s own companies, from yesterday forward. Refreshing it is the weather Edge Function''s job; this only reads what was fetched.';

select app.assert_security_gates();
