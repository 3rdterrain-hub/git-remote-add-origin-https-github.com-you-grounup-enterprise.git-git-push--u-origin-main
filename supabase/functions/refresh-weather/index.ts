/**
 * POST /functions/v1/refresh-weather
 *
 * Fetches the forecast for a place and caches it, with a verdict on each day:
 * can this be worked, and if not, why not.
 *
 * The place is the company's yard by default, and a job site when `projectId`
 * is given. That distinction is the whole of migration 0142: `projects` has
 * carried `site_address`, `latitude` and `longitude` since 0007, and
 * `app.award_estimate` copies them forward from the estimate — so the
 * coordinates of the actual site were already in the row, read by nothing. A
 * contractor in Toledo with a job in Sandusky is sixty miles and one
 * lake-effect band away from the number on their own daily log.
 *
 * The verdict is the point. `estimate_versions.calendar_efficiency` has existed
 * since migration 0006 and the schedule engine models weather days; both take a
 * number somebody guesses. A contractor in Toledo loses days to rain in April
 * and to cold in January, and until now nothing in the platform could say how
 * many.
 *
 * **No API key.** Open-Meteo needs none, which is a security decision rather
 * than a convenience one: a key would have to be stored server-side, rotated,
 * and kept out of the browser, and the surest way not to leak a credential is
 * not to have one. Nothing about a public weather forecast is privileged.
 *
 * **Nothing about the company leaves except coordinates.** The geocoding call
 * sends the city and state to resolve them once; the forecast call sends two
 * numbers. No company name, no address line, no person.
 */
import { getCaller, isUuid, type Caller } from '../_shared/auth.ts';
import { fail, json, preflight } from '../_shared/http.ts';

/**
 * When a forecast is fresh enough to reuse.
 *
 * Three hours. A seven-day forecast does not move between one person opening
 * the dashboard and the next, and refetching on every page load would make an
 * external request per view for a number that changes four times a day.
 */
const CACHE_MINUTES = 180;

/**
 * What stops work, and what it is called.
 *
 * These are the thresholds a superintendent actually uses, and they are written
 * out rather than hidden in a score so an estimator can disagree with a
 * specific one. A tenth of an inch is the National Weather Service's own
 * threshold for measurable precipitation and roughly where earthwork stops;
 * freezing is where concrete and asphalt stop; the wind figure is where lifts
 * come down.
 */
const RULES = [
  { test: (d: Day) => d.snow >= 1, reason: 'Snow' },
  { test: (d: Day) => d.precip >= 0.1, reason: 'Rain' },
  { test: (d: Day) => d.high !== null && d.high < 32, reason: 'Below freezing all day' },
  { test: (d: Day) => d.gust !== null && d.gust >= 30, reason: 'High wind' },
] as const;

/** Where the work is, when the caller named a project. */
interface Site {
  id: string;
  latitude: number | null;
  longitude: number | null;
  site_city: string | null;
  site_state: string | null;
}

/** What it is doing right now, as opposed to what the day will be. */
interface Now {
  observedAt: string;
  temperature: number | null;
  wind: number | null;
  precip: number;
  code: number | null;
}

interface Day {
  day: string;
  high: number | null;
  low: number | null;
  precip: number;
  precipChance: number | null;
  snow: number;
  gust: number | null;
  code: number | null;
}

/** WMO weather codes, in the words a person would use. */
const CONDITIONS: Record<number, string> = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Freezing fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy rain showers',
  85: 'Snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorms', 96: 'Thunderstorms with hail', 99: 'Thunderstorms with hail',
};

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') return fail('method_not_allowed', 'Use POST.', 405, origin);

  try {
    const caller = await getCaller(req);
    if (!caller) return fail('unauthenticated', 'Sign in to read the forecast.', 401, origin);

    const { companyId, projectId, force } =
      (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!isUuid(companyId)) {
      return fail('bad_request', 'A valid companyId is required.', 400, origin);
    }
    if (projectId !== undefined && projectId !== null && !isUuid(projectId)) {
      return fail('bad_request', 'projectId must be a project id.', 400, origin);
    }
    const project = (projectId as string | undefined) ?? null;

    /*
     * Read through the caller's own client, so row level security decides
     * whether they may see this company at all. A non-member gets no row and
     * the request stops here rather than at a permission check we wrote.
     */
    const { data: company, error: companyError } = await caller.client
      .from('companies')
      .select('id, city, state_province, postal_code, country, latitude, longitude, geocoded_from')
      .eq('id', companyId)
      .maybeSingle();
    if (companyError) {
      return fail('lookup_failed', 'The company could not be read.', 500, origin, companyError);
    }
    if (!company) return fail('forbidden', 'You are not a member of this company.', 403, origin);

    /*
     * Where the work is. A project with its own coordinates is asked about
     * directly; one with only a site city is geocoded like the yard; one with
     * neither falls back to the yard rather than refusing, because a project
     * created this morning has no site address yet and a forecast from the
     * yard is still better than an empty panel. `source` in the reply says
     * which, so nothing has to guess.
     */
    let site: Site | null = null;
    if (project) {
      const { data, error } = await caller.client
        .from('projects')
        .select('id, latitude, longitude, site_city, site_state')
        .eq('id', project)
        .eq('company_id', companyId)
        .maybeSingle();
      if (error) {
        return fail('lookup_failed', 'The project could not be read.', 500, origin, error);
      }
      if (!data) return fail('not_found', 'That project is not in this company.', 404, origin);
      site = data as unknown as Site;
    }

    // Fresh enough? Say so and make no external request.
    if (force !== true) {
      let recentQuery = caller.client
        .from('weather_days')
        .select('fetched_at')
        .eq('company_id', companyId);
      recentQuery = project
        ? recentQuery.eq('project_id', project)
        : recentQuery.is('project_id', null);
      const { data: recent } = await recentQuery
        .order('fetched_at', { ascending: false })
        .limit(1);
      const at = recent?.[0]?.fetched_at as string | undefined;
      if (at && Date.now() - new Date(at).getTime() < CACHE_MINUTES * 60_000) {
        return json({ companyId, projectId: project, refreshed: false, reason: 'cached',
          fetchedAt: at }, 200, origin);
      }
    }

    /*
     * A site that already knows where it is needs no geocoding and no company
     * address at all. This is the ordinary case once a project has been awarded
     * from an estimate that named a location.
     */
    if (site && site.latitude !== null && site.longitude !== null) {
      return await record(caller, origin, companyId as string, project,
        Number(site.latitude), Number(site.longitude), 'site');
    }
    if (site && site.site_city) {
      const found = await geocode(site.site_city, site.site_state, null);
      if (found) {
        await caller.client.from('projects')
          .update({ latitude: found.latitude, longitude: found.longitude })
          .eq('id', site.id);
        return await record(caller, origin, companyId as string, project,
          found.latitude, found.longitude, 'site');
      }
      // Fall through to the yard rather than refusing: a forecast sixty miles
      // away, clearly labeled, beats no forecast on a job that is running.
    }

    const addressText = [company.city, company.state_province, company.postal_code]
      .filter(Boolean).join(', ');
    if (!addressText) {
      return fail(
        'no_address',
        'This company has no city or postal code, so there is nowhere to report the weather for.',
        422, origin);
    }

    /*
     * Geocode only when the address has changed since last time. A company
     * that has not moved does not need resolving again, and one that has must
     * not keep reporting the weather at the old yard.
     */
    let latitude = company.latitude as number | null;
    let longitude = company.longitude as number | null;
    if (latitude === null || longitude === null || company.geocoded_from !== addressText) {
      const found = await geocode(company.city as string | null,
        company.state_province as string | null, company.country as string | null);
      if (!found) {
        return fail('geocode_failed',
          `Could not find “${addressText}” on the map, so there is no forecast to fetch.`,
          422, origin);
      }
      latitude = found.latitude;
      longitude = found.longitude;
      await caller.client
        .from('companies')
        .update({
          latitude, longitude,
          geocoded_at: new Date().toISOString(),
          geocoded_from: addressText,
        })
        .eq('id', companyId);
    }

    return await record(caller, origin, companyId as string,
      // A site that could not be placed on the map reports the yard, and says so.
      site ? project : null, latitude, longitude, site ? 'yard_for_site' : 'yard');
  } catch (err) {
    return fail('internal_error', 'The forecast could not be refreshed.', 500, origin, err);
  }
});

/**
 * Fetch, judge and store the forecast for one set of coordinates.
 *
 * The write goes through `record_site_weather` rather than an upsert, because
 * one place's forecast is replaced wholesale and the two partial unique indexes
 * migration 0142 uses cannot be named in a PostgREST conflict target. The
 * function is also what refuses a field name nobody recognizes, which an upsert
 * of a mistyped key would have written as a null and reported as a success.
 */
async function record(
  caller: Caller,
  origin: string | null,
  companyId: string,
  projectId: string | null,
  latitude: number,
  longitude: number,
  source: 'site' | 'yard' | 'yard_for_site',
): Promise<Response> {
  const { days, now } = await forecast(latitude, longitude);
  if (days.length === 0) {
    return fail('forecast_failed', 'The forecast service returned nothing.', 502, origin);
  }

  const rows = days.map((d) => {
    const blocker = RULES.find((r) => r.test(d));
    return {
      day: d.day,
      high_f: d.high, low_f: d.low,
      precip_inches: d.precip, precip_chance: d.precipChance,
      snow_inches: d.snow, wind_gust_mph: d.gust,
      code: d.code,
      summary: d.code === null ? null : (CONDITIONS[d.code] ?? 'Unsettled'),
      workable: !blocker,
      lost_reason: blocker?.reason ?? null,
    };
  });

  const { error } = await caller.client.rpc('record_site_weather', {
    p_company: companyId,
    p_project: projectId,
    p_days: rows,
    p_now: now === null ? null : {
      observed_at: now.observedAt,
      temperature_f: now.temperature,
      wind_mph: now.wind,
      precip_inches: now.precip,
      code: now.code,
      summary: now.code === null ? null : (CONDITIONS[now.code] ?? 'Unsettled'),
    },
  });
  if (error) {
    return fail('write_failed', 'The forecast could not be saved.', 500, origin, error);
  }

  const workable = rows.filter((r) => r.workable).length;
  return json({
    companyId,
    projectId,
    source,
    refreshed: true,
    fetchedAt: new Date().toISOString(),
    days: rows.length,
    workable,
    // The number `calendar_efficiency` has always wanted and never had.
    efficiency: Number((workable / rows.length).toFixed(4)),
  }, 200, origin);
}

/** Resolve a city to coordinates. One request, and only when the address moves. */
async function geocode(city: string | null, state: string | null, country: string | null) {
  if (!city) return null;
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', city);
  url.searchParams.set('count', '10');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');
  if (country) url.searchParams.set('countryCode', country);

  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) return null;
  const body = await res.json() as { results?: Array<Record<string, unknown>> };
  const results = body.results ?? [];
  if (results.length === 0) return null;

  /*
   * Prefer a hit in the right state. "Toledo, Ohio" and "Toledo, Spain" are
   * both real, and reporting the wrong one would be a forecast that looks
   * plausible and is completely useless.
   */
  const inState = state
    ? results.find((r) =>
        String(r.admin1 ?? '').toLowerCase() === state.toLowerCase()
        || String(r.admin1_id ?? '') === state)
    : undefined;
  const hit = inState ?? results[0]!;
  return { latitude: Number(hit.latitude), longitude: Number(hit.longitude) };
}

/** Seven days and the current hour, in the units an American jobsite uses. */
async function forecast(
  latitude: number, longitude: number,
): Promise<{ days: Day[]; now: Now | null }> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set('daily', [
    'weather_code', 'temperature_2m_max', 'temperature_2m_min',
    'precipitation_sum', 'snowfall_sum', 'precipitation_probability_max',
    'wind_gusts_10m_max',
  ].join(','));
  url.searchParams.set('temperature_unit', 'fahrenheit');
  url.searchParams.set('precipitation_unit', 'inch');
  url.searchParams.set('wind_speed_unit', 'mph');
  /*
   * `current=` is one extra parameter on the same request rather than a second
   * call. A crew standing in it wants to know whether it is raining now, and a
   * daily high answers a different question — which is why 0142 stores it in
   * its own table rather than folding it into the day.
   */
  url.searchParams.set('current', [
    'temperature_2m', 'precipitation', 'weather_code', 'wind_speed_10m',
  ].join(','));
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', '7');

  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) return { days: [], now: null };
  const body = await res.json() as {
    daily?: Record<string, unknown[]>;
    current?: Record<string, unknown>;
  };
  const d = body.daily;
  if (!d || !Array.isArray(d.time)) return { days: [], now: null };

  const c = body.current;
  const nowNum = (key: string): number | null => {
    const v = c?.[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const now: Now | null = c && typeof c.time === 'string'
    ? {
      observedAt: new Date(c.time as string).toISOString(),
      temperature: nowNum('temperature_2m'),
      wind: nowNum('wind_speed_10m'),
      precip: nowNum('precipitation') ?? 0,
      code: nowNum('weather_code'),
    }
    : null;

  const at = (key: string, i: number): number | null => {
    const v = (d[key] as unknown[] | undefined)?.[i];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };

  const days = (d.time as string[]).map((day, i) => ({
    day,
    high: at('temperature_2m_max', i),
    low: at('temperature_2m_min', i),
    precip: at('precipitation_sum', i) ?? 0,
    // Open-Meteo reports snowfall in centimetres even under inch units.
    snow: (at('snowfall_sum', i) ?? 0) / 2.54,
    precipChance: at('precipitation_probability_max', i),
    gust: at('wind_gusts_10m_max', i),
    code: at('weather_code', i),
  }));

  return { days, now };
}
