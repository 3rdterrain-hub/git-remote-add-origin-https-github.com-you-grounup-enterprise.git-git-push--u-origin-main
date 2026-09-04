/**
 * Connector runtime and the NOAA adapter.
 *
 * Every case here runs against recorded NWS payloads through an injected fetch,
 * so the suite needs no network, no credentials and no vendor account — which
 * is the reason NOAA was chosen as the reference adapter.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  noaaWeatherAdapter, parseObservation, summarizeByDay, exceedances,
  CELSIUS_TO_F, MM_TO_INCHES, MS_TO_MPH, M_TO_MILES, DEFAULT_THRESHOLDS,
} from '../../supabase/functions/_shared/connectors/noaa-weather.ts';
import { runConnector, buildRegistry } from '../../supabase/functions/_shared/connectors/runner.ts';
import { ConnectorError, type ConnectorContext, type HttpFetch } from '../../supabase/functions/_shared/connectors/types.ts';

// ---------------------------------------------------------------- fixtures
/** Shaped exactly as api.weather.gov returns them. */
function obs(timestamp: string, o: {
  tempC?: number | null; precipMm?: number | null; windMs?: number | null;
  gustMs?: number | null; visM?: number | null; text?: string; qc?: string;
} = {}) {
  const q = (v: number | null | undefined, unit: string) =>
    v === undefined ? { value: null, unitCode: unit, qualityControl: 'V' }
      : { value: v, unitCode: unit, qualityControl: o.qc ?? 'V' };
  return {
    properties: {
      timestamp,
      temperature: q(o.tempC, 'wmoUnit:degC'),
      precipitationLastHour: q(o.precipMm, 'wmoUnit:mm'),
      windSpeed: q(o.windMs, 'wmoUnit:m_s-1'),
      windGust: q(o.gustMs, 'wmoUnit:m_s-1'),
      visibility: q(o.visM, 'wmoUnit:m'),
      textDescription: o.text ?? 'Cloudy',
    },
  };
}

const OBSERVATIONS = {
  features: [
    // 2026-08-24 local (UTC-4): a rain day.
    obs('2026-08-24T10:53:00+00:00', { tempC: 18.3, precipMm: 5.1, windMs: 4.2, visM: 12_875, text: 'Rain' }),
    obs('2026-08-24T14:53:00+00:00', { tempC: 21.1, precipMm: 8.4, windMs: 6.7, gustMs: 11.2, visM: 4_827, text: 'Heavy Rain' }),
    obs('2026-08-24T18:53:00+00:00', { tempC: 19.4, precipMm: 3.0, windMs: 5.1, visM: 8_047, text: 'Rain' }),
    // 2026-08-25 local: clear and workable.
    obs('2026-08-25T14:53:00+00:00', { tempC: 26.7, precipMm: 0, windMs: 3.1, visM: 16_093, text: 'Clear' }),
    obs('2026-08-25T18:53:00+00:00', { tempC: 24.4, precipMm: 0, windMs: 2.6, visM: 16_093, text: 'Clear' }),
    // 2026-08-26 local: a hard freeze — concrete and moisture-conditioned fill stop.
    obs('2026-08-26T12:53:00+00:00', { tempC: -3.9, windMs: 8.9, gustMs: 15.6, visM: 16_093, text: 'Clear' }),
    obs('2026-08-26T16:53:00+00:00', { tempC: -1.1, windMs: 7.7, visM: 16_093, text: 'Clear' }),
  ],
};

function fetchFor(map: Record<string, unknown>, log?: string[]): HttpFetch {
  return async (url) => {
    log?.push(url);
    // Longest match wins: the observations URL is itself under /stations/{id},
    // so a first-match lookup would hand back the station list.
    const key = Object.keys(map)
      .filter((k) => url.includes(k))
      .sort((a, b) => b.length - a.length)[0];
    if (key === undefined) {
      return {
        ok: false, status: 404, statusText: 'Not Found',
        json: async () => ({}), text: async () => 'not found',
      };
    }
    return {
      ok: true, status: 200, statusText: 'OK',
      json: async () => map[key], text: async () => JSON.stringify(map[key]),
    };
  };
}

function context(over: Partial<ConnectorContext> = {}): ConnectorContext {
  return {
    companyId: '00000000-0000-0000-0000-0000000000c1',
    connectorId: '00000000-0000-0000-0000-0000000000e1',
    config: {
      projectId: '00000000-0000-0000-0000-0000000000p1',
      latitude: 41.5806, longitude: -83.6, stationId: 'KTOL', utcOffsetHours: -4,
    },
    credentials: {},
    since: '2026-08-24T00:00:00Z',
    until: '2026-08-27T00:00:00Z',
    http: fetchFor({ '/observations': OBSERVATIONS }),
    now: () => new Date('2026-09-02T12:00:00Z'),
    ...over,
  };
}

// ------------------------------------------------------------- conversions
describe('unit conversion', () => {
  it('converts the freezing and boiling points exactly', () => {
    expect(CELSIUS_TO_F(0)).toBe(32);
    expect(CELSIUS_TO_F(100)).toBe(212);
    expect(CELSIUS_TO_F(-40)).toBe(-40);
  });

  it('converts millimeters to inches against the definition', () => {
    expect(MM_TO_INCHES(25.4)).toBeCloseTo(1, 10);
  });

  it('converts meters per second to miles per hour', () => {
    expect(MS_TO_MPH(1)).toBeCloseTo(2.2369362920544, 10);
  });

  it('converts meters to statute miles', () => {
    expect(M_TO_MILES(1609.344)).toBeCloseTo(1, 10);
  });
});

// ------------------------------------------------------------- parsing
describe('observation parsing', () => {
  it('reads a well-formed observation', () => {
    const o = parseObservation(obs('2026-08-24T10:53:00+00:00', { tempC: 18.3, precipMm: 5.1 }));
    expect(o?.temperatureC).toBe(18.3);
    expect(o?.precipitationMm).toBe(5.1);
  });

  it('rejects an observation the weather service itself failed', () => {
    // Quality control 'X' means NWS rejected the reading. Using it would put a
    // number the source disowns into a contractual record.
    const o = parseObservation(obs('2026-08-24T10:53:00+00:00', { tempC: 999, qc: 'X' }));
    expect(o?.temperatureC).toBeNull();
  });

  it('keeps a missing reading null rather than calling it zero', () => {
    const o = parseObservation(obs('2026-08-24T10:53:00+00:00', { tempC: 18.3 }));
    // "No precipitation reading" and "no precipitation" are different facts,
    // and only one of them supports a rain-day claim.
    expect(o?.precipitationMm).toBeNull();
  });

  it('returns null for a payload with no timestamp', () => {
    expect(parseObservation({ properties: { temperature: { value: 3 } } })).toBeNull();
    expect(parseObservation(null)).toBeNull();
    expect(parseObservation('nonsense')).toBeNull();
  });
});

// ------------------------------------------------------------- daily rollup
describe('daily rollup', () => {
  const parsed = OBSERVATIONS.features.map(parseObservation).filter((o) => o !== null);

  it('buckets observations into the site day, not the UTC day', () => {
    const days = summarizeByDay(parsed, -4);
    expect(days.map((d) => d.date)).toEqual(['2026-08-24', '2026-08-25', '2026-08-26']);
  });

  it('sums hourly precipitation rather than taking a maximum', () => {
    const days = summarizeByDay(parsed, -4);
    // 5.1 + 8.4 + 3.0 = 16.5 mm = 0.649… in
    expect(days[0].precipitationIn).toBe(0.65);
  });

  it('reports the high and low of the day in Fahrenheit', () => {
    const days = summarizeByDay(parsed, -4);
    expect(days[0].highF).toBe(70);  // 21.1 C
    expect(days[0].lowF).toBe(65);   // 18.3 C
  });

  it('counts hours below freezing, which is what stops a pour', () => {
    const days = summarizeByDay(parsed, -4);
    expect(days[2].freezingHours).toBe(2);
    expect(days[1].freezingHours).toBe(0);
  });

  it('takes the most frequent description as the summary', () => {
    const days = summarizeByDay(parsed, -4);
    expect(days[0].summary).toBe('Rain');
    expect(days[1].summary).toBe('Clear');
  });

  it('moves a late-evening observation to the correct local day', () => {
    // 03:00 UTC on the 25th is 23:00 on the 24th at UTC-4. Filed under the
    // 25th it would put a storm on the wrong day — the exact day a delay
    // claim turns on.
    const late = [parseObservation(obs('2026-08-25T03:00:00+00:00', { tempC: 15, precipMm: 20 }))!];
    expect(summarizeByDay(late, -4)[0].date).toBe('2026-08-24');
    expect(summarizeByDay(late, 0)[0].date).toBe('2026-08-25');
  });
});

// ------------------------------------------------------------- thresholds
describe('threshold exceedances', () => {
  const parsed = OBSERVATIONS.features.map(parseObservation).filter((o) => o !== null);
  const days = summarizeByDay(parsed, -4);

  it('flags the rain day on precipitation', () => {
    expect(exceedances(days[0], DEFAULT_THRESHOLDS)).toContain('precipitation 0.65 in >= 0.25 in');
  });

  it('flags nothing on a clear workable day', () => {
    expect(exceedances(days[1], DEFAULT_THRESHOLDS)).toEqual([]);
  });

  it('flags the freeze on temperature', () => {
    expect(exceedances(days[2], DEFAULT_THRESHOLDS).some((e) => e.includes('low'))).toBe(true);
  });

  it('honors a project-specific threshold', () => {
    // A site whose contract defines a rain day at 1 inch gets 1 inch.
    expect(exceedances(days[0], { ...DEFAULT_THRESHOLDS, precipitationIn: 1 })).toEqual([]);
  });
});

// ------------------------------------------------------------- config
describe('configuration validation', () => {
  it('accepts a complete configuration', () => {
    expect(noaaWeatherAdapter.validateConfig(context().config)).toEqual([]);
  });

  it('rejects a latitude outside the possible range', () => {
    const problems = noaaWeatherAdapter.validateConfig({
      projectId: 'p', latitude: 200, longitude: -83.6,
    });
    expect(problems.some((p) => p.includes('latitude'))).toBe(true);
  });

  it('rejects a missing project', () => {
    const problems = noaaWeatherAdapter.validateConfig({ latitude: 41.5, longitude: -83.6 });
    expect(problems).toContain('projectId is required and must be a non-empty string');
  });
});

// ------------------------------------------------------------- fetch
describe('the adapter end to end', () => {
  it('produces one daily record per observed day', async () => {
    const result = await noaaWeatherAdapter.fetch(context());
    expect(result.records).toHaveLength(3);
    expect(result.records.every((r) => r.target === 'daily_reports')).toBe(true);
  });

  it('qualifies the external id by station and date so a rerun updates in place', async () => {
    const result = await noaaWeatherAdapter.fetch(context());
    expect(result.records[0].externalId).toBe('noaa:KTOL:2026-08-24');
    const rerun = await noaaWeatherAdapter.fetch(context());
    expect(rerun.records.map((r) => r.externalId)).toEqual(result.records.map((r) => r.externalId));
    expect(rerun.idempotencyKey).toBe(result.idempotencyKey);
  });

  it('changes the idempotency key when the station changes', async () => {
    const a = await noaaWeatherAdapter.fetch(context());
    const b = await noaaWeatherAdapter.fetch(context({
      config: { ...context().config, stationId: 'KDTW' },
    }));
    expect(b.idempotencyKey).not.toBe(a.idempotencyKey);
  });

  it('maps only into columns the daily report actually has', async () => {
    const result = await noaaWeatherAdapter.fetch(context());
    const columns = ['project_id', 'report_date', 'weather_summary', 'temperature_f', 'precipitation_in'];
    for (const r of result.records) {
      expect(Object.keys(r.values).sort()).toEqual([...columns].sort());
    }
  });

  it('keeps everything it could not map rather than discarding it', async () => {
    const result = await noaaWeatherAdapter.fetch(context());
    expect(result.records[0].unmapped).toMatchObject({
      station_id: 'KTOL', max_gust_mph: 25, freezing_hours: 0,
    });
  });

  it('marks a candidate weather day without asserting it is compensable', async () => {
    const result = await noaaWeatherAdapter.fetch(context());
    expect(result.records[0].unmapped?.weather_day_candidate).toBe(true);
    expect(result.records[1].unmapped?.weather_day_candidate).toBe(false);
    // The record says a threshold was crossed. It never says the delay is
    // excusable — that is a contract question, answered by a person.
    expect(JSON.stringify(result.records[0].unmapped)).not.toMatch(/excusable|compensable_delay/);
  });

  it('resolves a station when none is pinned, and says it did', async () => {
    const log: string[] = [];
    const http = fetchFor({
      '/points/': { properties: { observationStations: 'https://api.weather.gov/gridpoints/CLE/40,50/stations' } },
      '/stations': { features: [{ properties: { stationIdentifier: 'KTOL' } }] },
      '/observations': OBSERVATIONS,
    }, log);
    const result = await noaaWeatherAdapter.fetch(context({
      http, config: { projectId: 'p1', latitude: 41.5806, longitude: -83.6, utcOffsetHours: -4 },
    }));
    expect(log[0]).toContain('/points/41.5806,-83.6');
    expect(result.records[0].externalId).toContain('KTOL');
    expect(result.warnings.some((w) => w.includes('chosen automatically'))).toBe(true);
  });

  it('refuses a site outside NWS coverage rather than returning nothing', async () => {
    const http = fetchFor({ '/points/': { properties: {} } });
    await expect(noaaWeatherAdapter.fetch(context({
      http, config: { projectId: 'p1', latitude: 0, longitude: 0 },
    }))).rejects.toThrow(/outside its coverage/);
  });

  it('classifies a 500 as retryable and a 404 as not', async () => {
    const status = (code: number): HttpFetch => async () => ({
      ok: false, status: code, statusText: 'x',
      json: async () => ({}), text: async () => '',
    });
    await expect(noaaWeatherAdapter.fetch(context({ http: status(503) })))
      .rejects.toMatchObject({ retryable: true });
    await expect(noaaWeatherAdapter.fetch(context({ http: status(404) })))
      .rejects.toMatchObject({ retryable: false });
  });

  it('warns rather than failing when the station reported nothing', async () => {
    const result = await noaaWeatherAdapter.fetch(context({
      http: fetchFor({ '/observations': { features: [] } }),
    }));
    expect(result.records).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('no observations'))).toBe(true);
  });

  it('skips an unusable observation and reports it instead of dropping it', async () => {
    const result = await noaaWeatherAdapter.fetch(context({
      http: fetchFor({ '/observations': { features: [{ properties: { temperature: { value: 3 } } }] } }),
    }));
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/timestamp/);
  });
});

// ------------------------------------------------------------- runner
describe('the connector runtime', () => {
  const writer = (n = Infinity) => vi.fn(async (records: readonly unknown[]) => Math.min(records.length, n));

  it('records a successful run with the counts that were actually written', async () => {
    const write = writer();
    const { run } = await runConnector(noaaWeatherAdapter, context(), write);
    expect(run.status).toBe('succeeded');
    expect(run.recordsRead).toBe(3);
    expect(run.recordsWritten).toBe(3);
    expect(run.idempotencyKey).toBe('noaa:KTOL:2026-08-24T00:00:00Z:2026-08-27T00:00:00Z');
  });

  it('fails a misconfigured connector without calling the remote system', async () => {
    const http = vi.fn();
    const { run } = await runConnector(
      noaaWeatherAdapter,
      context({ config: { latitude: 41.5 }, http: http as unknown as HttpFetch }),
      writer(),
    );
    expect(run.status).toBe('failed');
    expect(run.errorMessage).toMatch(/Configuration is invalid/);
    // Retrying a bad config produces the same failure three times and buries
    // the real cause, so it is not retried and the network is never touched.
    expect(http).not.toHaveBeenCalled();
  });

  it('retries a retryable failure up to the limit', async () => {
    let calls = 0;
    const flaky = { ...noaaWeatherAdapter, fetch: async () => {
      calls++;
      throw new ConnectorError('upstream 503', true, 503);
    } };
    const { run } = await runConnector(flaky, context(), writer(), {
      maxAttempts: 3, sleep: async () => {}, backoffMs: () => 0,
    });
    expect(calls).toBe(3);
    expect(run.status).toBe('failed');
    expect(run.errorMessage).toContain('503');
  });

  it('does not retry a failure that will fail identically', async () => {
    let calls = 0;
    const broken = { ...noaaWeatherAdapter, fetch: async () => {
      calls++;
      throw new ConnectorError('station does not exist', false, 404);
    } };
    await runConnector(broken, context(), writer(), { maxAttempts: 3, sleep: async () => {} });
    expect(calls).toBe(1);
  });

  it('reports partial when the write did not take everything', async () => {
    const { run } = await runConnector(noaaWeatherAdapter, context(), async () => {
      throw new Error('unique violation on daily_reports');
    });
    expect(run.status).toBe('partial');
    expect(run.errorMessage).toContain('unique violation');
  });

  it('reports partial when the adapter skipped records', async () => {
    const { run } = await runConnector(noaaWeatherAdapter, context({
      http: fetchFor({ '/observations': { features: [{ properties: {} }] } }),
    }), writer());
    expect(run.status).toBe('partial');
    expect(run.recordsSkipped).toBe(1);
  });

  it('never throws — a failed run is a row, not an exception', async () => {
    const exploding = { ...noaaWeatherAdapter, fetch: async () => { throw new TypeError('undefined is not a function'); } };
    const { run } = await runConnector(exploding, context(), writer());
    expect(run.status).toBe('failed');
    expect(run.errorMessage).toContain('undefined is not a function');
  });

  it('stamps the run with the injected clock so a run is reproducible', async () => {
    const { run } = await runConnector(noaaWeatherAdapter, context(), writer());
    expect(run.startedAt).toBe('2026-09-02T12:00:00.000Z');
    expect(run.finishedAt).toBe('2026-09-02T12:00:00.000Z');
  });
});

describe('the adapter registry', () => {
  it('keys adapters by type and provider', () => {
    const r = buildRegistry([noaaWeatherAdapter]);
    expect(r.get('weather:noaa_nws')).toBe(noaaWeatherAdapter);
  });

  it('refuses two adapters claiming the same slot', () => {
    expect(() => buildRegistry([noaaWeatherAdapter, noaaWeatherAdapter]))
      .toThrow(/Duplicate connector adapter/);
  });
});
