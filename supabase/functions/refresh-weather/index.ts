/**
 * POST /functions/v1/refresh-weather
 *
 * Fetches the forecast for a company's own yard and caches it, with a verdict
 * on each day: can this be worked, and if not, why not.
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
import { getCaller, isUuid } from '../_shared/auth.ts';
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

    const { companyId, force } = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!isUuid(companyId)) {
      return fail('bad_request', 'A valid companyId is required.', 400, origin);
    }

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

    // Fresh enough? Say so and make no external request.
    if (force !== true) {
      const { data: recent } = await caller.client
        .from('weather_days')
        .select('fetched_at')
        .eq('company_id', companyId)
        .order('fetched_at', { ascending: false })
        .limit(1);
      const at = recent?.[0]?.fetched_at as string | undefined;
      if (at && Date.now() - new Date(at).getTime() < CACHE_MINUTES * 60_000) {
        return json({ companyId, refreshed: false, reason: 'cached', fetchedAt: at }, 200, origin);
      }
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

    const days = await forecast(latitude, longitude);
    if (days.length === 0) {
      return fail('forecast_failed', 'The forecast service returned nothing.', 502, origin);
    }

    const fetchedAt = new Date().toISOString();
    const rows = days.map((d) => {
      const blocker = RULES.find((r) => r.test(d));
      return {
        company_id: companyId,
        day: d.day,
        fetched_at: fetchedAt,
        high_f: d.high, low_f: d.low,
        precip_inches: d.precip, precip_chance: d.precipChance,
        snow_inches: d.snow, wind_gust_mph: d.gust,
        code: d.code,
        summary: d.code === null ? null : (CONDITIONS[d.code] ?? 'Unsettled'),
        workable: !blocker,
        lost_reason: blocker?.reason ?? null,
      };
    });

    const { error: writeError } = await caller.client
      .from('weather_days')
      .upsert(rows, { onConflict: 'company_id,day' });
    if (writeError) {
      return fail('write_failed', 'The forecast could not be saved.', 500, origin, writeError);
    }

    const workable = rows.filter((r) => r.workable).length;
    return json({
      companyId,
      refreshed: true,
      fetchedAt,
      days: rows.length,
      workable,
      // The number `calendar_efficiency` has always wanted and never had.
      efficiency: rows.length === 0 ? null : Number((workable / rows.length).toFixed(4)),
    }, 200, origin);
  } catch (err) {
    return fail('internal_error', 'The forecast could not be refreshed.', 500, origin, err);
  }
});

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

/** Seven days, in the units an American jobsite uses. */
async function forecast(latitude: number, longitude: number): Promise<Day[]> {
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
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', '7');

  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) return [];
  const body = await res.json() as { daily?: Record<string, unknown[]> };
  const d = body.daily;
  if (!d || !Array.isArray(d.time)) return [];

  const at = (key: string, i: number): number | null => {
    const v = (d[key] as unknown[] | undefined)?.[i];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };

  return (d.time as string[]).map((day, i) => ({
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
}
