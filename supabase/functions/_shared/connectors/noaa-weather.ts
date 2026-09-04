/**
 * NOAA / National Weather Service weather adapter.
 *
 * Chosen as the reference implementation because api.weather.gov requires no
 * credentials, which means this adapter — and the whole runtime around it — is
 * verifiable end to end without anyone's vendor account.
 *
 * What it produces is not decoration. A weather day is a contractual event: it
 * decides whether a delay is excusable, whether a concrete pour was placed
 * outside its temperature window, and whether a schedule slip is the
 * contractor's problem or the owner's. Recording it from an official source
 * with a station identifier is the difference between a claim that survives and
 * one that becomes an argument about who remembers the day correctly.
 *
 * API shape (api.weather.gov):
 *   GET /points/{lat},{lon}                 -> resolves the grid + station list
 *   GET /gridpoints/{office}/{x},{y}/stations
 *   GET /stations/{id}/observations?start=&end=
 *
 * Observations are metric. Every conversion to the units GrounUp stores happens
 * here and is unit tested, because a silent metric/imperial slip is the classic
 * way this kind of integration produces plausible nonsense.
 */

import {
  ConnectorError, requireNumber, requireString,
  type ConnectorAdapter, type ConnectorContext, type FetchResult,
  type NormalizedRecord, type SkippedRecord,
} from './types.ts';

const BASE = 'https://api.weather.gov';

/** NWS asks every client to identify itself; an anonymous client gets blocked. */
const USER_AGENT = '(GrounUp Enterprise, integrations@grounup.example)';

export const CELSIUS_TO_F = (c: number): number => c * 9 / 5 + 32;
export const MM_TO_INCHES = (mm: number): number => mm / 25.4;
export const MS_TO_MPH = (ms: number): number => ms * 2.236_936_292_054_402;
export const M_TO_MILES = (m: number): number => m / 1609.344;

/** Round the way the daily report stores it, rather than carrying float noise. */
function round(value: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/**
 * A single NWS observation, reduced to what matters.
 * `null` is preserved rather than coerced to zero: "no precipitation reading"
 * and "no precipitation" are different facts, and only one of them supports a
 * rain-day claim.
 */
interface Observation {
  timestamp: string;
  temperatureC: number | null;
  precipitationMm: number | null;
  windSpeedMs: number | null;
  windGustMs: number | null;
  visibilityM: number | null;
  description: string | null;
}

/** NWS wraps every measurement as { value, unitCode, qualityControl }. */
function readQuantity(raw: unknown): number | null {
  if (raw === null || typeof raw !== 'object') return null;
  const q = raw as { value?: unknown; qualityControl?: unknown };
  if (typeof q.value !== 'number' || !Number.isFinite(q.value)) return null;
  // NWS flags observations that failed validation. Using one would put a
  // number the weather service itself rejected into a contractual record.
  if (typeof q.qualityControl === 'string' && ['X', 'Q', 'B'].includes(q.qualityControl)) return null;
  return q.value;
}

export function parseObservation(feature: unknown): Observation | null {
  if (feature === null || typeof feature !== 'object') return null;
  const props = (feature as { properties?: unknown }).properties;
  if (props === null || typeof props !== 'object') return null;
  const p = props as Record<string, unknown>;
  if (typeof p.timestamp !== 'string') return null;
  return {
    timestamp: p.timestamp,
    temperatureC: readQuantity(p.temperature),
    precipitationMm: readQuantity(p.precipitationLastHour),
    windSpeedMs: readQuantity(p.windSpeed),
    windGustMs: readQuantity(p.windGust),
    visibilityM: readQuantity(p.visibility),
    description: typeof p.textDescription === 'string' && p.textDescription !== ''
      ? p.textDescription : null,
  };
}

export interface DailyWeather {
  date: string;
  highF: number | null;
  lowF: number | null;
  precipitationIn: number | null;
  maxWindMph: number | null;
  maxGustMph: number | null;
  minVisibilityMi: number | null;
  summary: string;
  observationCount: number;
  /** Hours the temperature sat below 32 °F, which governs concrete and compaction. */
  freezingHours: number;
}

/**
 * Roll hourly observations up into the calendar day, in the site's own time
 * zone offset. A UTC rollup puts an evening thunderstorm on the wrong day,
 * which is precisely the day a delay claim turns on.
 */
export function summarizeByDay(
  observations: readonly Observation[],
  utcOffsetHours: number,
): DailyWeather[] {
  const byDay = new Map<string, Observation[]>();
  for (const o of observations) {
    const t = new Date(o.timestamp);
    if (Number.isNaN(t.getTime())) continue;
    const local = new Date(t.getTime() + utcOffsetHours * 3_600_000);
    const day = local.toISOString().slice(0, 10);
    const bucket = byDay.get(day);
    if (bucket) bucket.push(o); else byDay.set(day, [o]);
  }

  const out: DailyWeather[] = [];
  for (const [date, obs] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const temps = obs.map((o) => o.temperatureC).filter((v): v is number => v !== null);
    const precip = obs.map((o) => o.precipitationMm).filter((v): v is number => v !== null);
    const winds = obs.map((o) => o.windSpeedMs).filter((v): v is number => v !== null);
    const gusts = obs.map((o) => o.windGustMs).filter((v): v is number => v !== null);
    const vis = obs.map((o) => o.visibilityM).filter((v): v is number => v !== null);
    const descriptions = obs.map((o) => o.description).filter((v): v is string => v !== null);

    // The most frequent description, ties broken by first occurrence.
    const counts = new Map<string, number>();
    for (const d of descriptions) counts.set(d, (counts.get(d) ?? 0) + 1);
    let summary = 'No observation';
    let best = 0;
    for (const d of descriptions) {
      const n = counts.get(d)!;
      if (n > best) { best = n; summary = d; }
    }

    out.push({
      date,
      highF: temps.length ? round(CELSIUS_TO_F(Math.max(...temps)), 0) : null,
      lowF: temps.length ? round(CELSIUS_TO_F(Math.min(...temps)), 0) : null,
      // Hourly precipitation totals sum; a daily maximum would understate a
      // day of steady rain as badly as a sum of daily totals would overstate it.
      precipitationIn: precip.length ? round(MM_TO_INCHES(precip.reduce((a, b) => a + b, 0)), 2) : null,
      maxWindMph: winds.length ? round(MS_TO_MPH(Math.max(...winds)), 0) : null,
      maxGustMph: gusts.length ? round(MS_TO_MPH(Math.max(...gusts)), 0) : null,
      minVisibilityMi: vis.length ? round(M_TO_MILES(Math.min(...vis)), 1) : null,
      summary,
      observationCount: obs.length,
      freezingHours: temps.filter((c) => CELSIUS_TO_F(c) < 32).length,
    });
  }
  return out;
}

export interface WeatherThresholds {
  /** Precipitation at or above this makes the day a candidate rain day. */
  precipitationIn: number;
  /** Sustained wind at or above this stops crane and lift work. */
  windMph: number;
  /** A low at or below this stops concrete and moisture-conditioned fill. */
  lowF: number;
  /** A high at or above this triggers heat-stress protocols. */
  highF: number;
}

export const DEFAULT_THRESHOLDS: Readonly<WeatherThresholds> = Object.freeze({
  precipitationIn: 0.25,
  windMph: 30,
  lowF: 32,
  highF: 95,
});

/**
 * Which thresholds a day exceeded.
 *
 * This is deliberately an observation and not a determination: it says the
 * weather crossed a line, not that a delay is excusable. Whether a day is a
 * compensable weather day is a contract question the superintendent answers,
 * and this is the evidence they answer it with.
 */
export function exceedances(day: DailyWeather, t: WeatherThresholds): string[] {
  const out: string[] = [];
  if (day.precipitationIn !== null && day.precipitationIn >= t.precipitationIn) {
    out.push(`precipitation ${day.precipitationIn} in >= ${t.precipitationIn} in`);
  }
  if (day.maxWindMph !== null && day.maxWindMph >= t.windMph) {
    out.push(`sustained wind ${day.maxWindMph} mph >= ${t.windMph} mph`);
  }
  if (day.lowF !== null && day.lowF <= t.lowF) {
    out.push(`low ${day.lowF} °F <= ${t.lowF} °F`);
  }
  if (day.highF !== null && day.highF >= t.highF) {
    out.push(`high ${day.highF} °F >= ${t.highF} °F`);
  }
  return out;
}

async function getJson(http: ConnectorContext['http'], url: string): Promise<unknown> {
  const res = await http(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' },
  });
  if (!res.ok) {
    // 404 on a station means the site is outside NWS coverage — a config
    // problem the user must fix. 5xx and 429 are the service's problem and
    // will succeed on a retry, so they are marked differently.
    const retryable = res.status >= 500 || res.status === 429;
    throw new ConnectorError(
      `NWS request failed: ${res.status} ${res.statusText} (${url})`, retryable, res.status,
    );
  }
  return await res.json();
}

export const noaaWeatherAdapter: ConnectorAdapter = {
  provider: 'noaa_nws',
  type: 'weather',
  displayName: 'NOAA National Weather Service',
  direction: 'inbound',
  // NWS is an open service. The absence of a credential is itself the reason
  // this adapter can be verified in CI on every commit.
  credentialRequirements: [],

  validateConfig(config) {
    const problems: string[] = [];
    requireString(config, 'projectId', problems);
    requireNumber(config, 'latitude', problems, { min: -90, max: 90 });
    requireNumber(config, 'longitude', problems, { min: -180, max: 180 });
    if (config.utcOffsetHours !== undefined) {
      requireNumber(config, 'utcOffsetHours', problems, { min: -12, max: 14 });
    }
    if (config.stationId !== undefined && typeof config.stationId !== 'string') {
      problems.push('stationId must be a string when provided');
    }
    return problems;
  },

  async fetch(ctx): Promise<FetchResult> {
    const problems = noaaWeatherAdapter.validateConfig(ctx.config);
    if (problems.length) {
      throw new ConnectorError(`Connector is misconfigured: ${problems.join('; ')}`, false);
    }

    const projectId = ctx.config.projectId as string;
    const lat = ctx.config.latitude as number;
    const lon = ctx.config.longitude as number;
    const utcOffsetHours = typeof ctx.config.utcOffsetHours === 'number' ? ctx.config.utcOffsetHours : 0;
    const thresholds: WeatherThresholds = {
      ...DEFAULT_THRESHOLDS,
      ...(typeof ctx.config.thresholds === 'object' && ctx.config.thresholds !== null
        ? ctx.config.thresholds as Partial<WeatherThresholds> : {}),
    };

    const warnings: string[] = [];

    // Resolve the observing station unless one was pinned. Pinning matters:
    // the nearest station can change between runs as stations go offline, and
    // a claim record should name one station for the whole event.
    let stationId = typeof ctx.config.stationId === 'string' ? ctx.config.stationId : null;
    if (!stationId) {
      const point = await getJson(ctx.http, `${BASE}/points/${lat},${lon}`) as {
        properties?: { observationStations?: string };
      };
      const stationsUrl = point?.properties?.observationStations;
      if (typeof stationsUrl !== 'string') {
        throw new ConnectorError(
          `NWS returned no observation stations for ${lat},${lon} — the site may be outside its coverage.`,
          false,
        );
      }
      const stations = await getJson(ctx.http, stationsUrl) as {
        features?: { properties?: { stationIdentifier?: string } }[];
      };
      stationId = stations?.features?.[0]?.properties?.stationIdentifier ?? null;
      if (!stationId) {
        throw new ConnectorError(`NWS listed no usable station near ${lat},${lon}.`, false);
      }
      warnings.push(
        `Station ${stationId} was chosen automatically. Pin it in the connector config so the record names one station for the whole project.`,
      );
    }

    const url = `${BASE}/stations/${encodeURIComponent(stationId)}/observations`
      + `?start=${encodeURIComponent(ctx.since)}&end=${encodeURIComponent(ctx.until)}`;
    const payload = await getJson(ctx.http, url) as { features?: unknown[] };
    const features = Array.isArray(payload?.features) ? payload.features : [];

    const skipped: SkippedRecord[] = [];
    const observations: Observation[] = [];
    for (const [i, f] of features.entries()) {
      const parsed = parseObservation(f);
      if (parsed) observations.push(parsed);
      else skipped.push({ externalId: `${stationId}:${i}`, reason: 'Observation had no usable timestamp' });
    }

    if (observations.length === 0) {
      warnings.push(`Station ${stationId} reported no observations between ${ctx.since} and ${ctx.until}.`);
    }

    const days = summarizeByDay(observations, utcOffsetHours);
    const records: NormalizedRecord[] = days.map((d) => {
      const crossed = exceedances(d, thresholds);
      return {
        target: 'daily_reports',
        // Station-qualified: re-pulling the window updates the same row, and
        // switching stations mid-project produces a visibly different record
        // rather than silently overwriting the old one.
        externalId: `noaa:${stationId}:${d.date}`,
        values: {
          project_id: projectId,
          report_date: d.date,
          weather_summary: d.summary,
          temperature_f: d.highF,
          precipitation_in: d.precipitationIn,
        },
        unmapped: {
          station_id: stationId,
          low_f: d.lowF,
          max_wind_mph: d.maxWindMph,
          max_gust_mph: d.maxGustMph,
          min_visibility_mi: d.minVisibilityMi,
          freezing_hours: d.freezingHours,
          observation_count: d.observationCount,
          threshold_exceedances: crossed,
          // Never an assertion that the day is compensable — only that it
          // crossed a line someone configured. The contract decides the rest.
          weather_day_candidate: crossed.length > 0,
        },
      };
    });

    return {
      records,
      skipped,
      warnings,
      // The window plus the station: re-running the same window against the
      // same station is a no-op, and against a different station is not.
      idempotencyKey: `noaa:${stationId}:${ctx.since}:${ctx.until}`,
    };
  },
};
