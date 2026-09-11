/**
 * The forecast at the job site, not at the yard.
 *
 * Migration 0105 is titled "Weather where the work is" and keys the forecast
 * `unique (company_id, day)` — one forecast per company, fetched from the
 * coordinates on the company row, which is the yard. The work is not at the
 * yard: `projects` has carried `site_address`, `latitude` and `longitude` since
 * 0007, and `app.award_estimate` copies them forward from the estimate, so the
 * coordinates of the actual site were already sitting there, read by nothing.
 * A contractor in Toledo with a job in Sandusky is sixty miles and one
 * lake-effect band away from the number on their own daily log.
 *
 * Three things are worth holding down here, and each of them is a decision that
 * could have gone the other way.
 *
 *   * **Two partial unique indexes, not one composite.** `unique (company_id,
 *     project_id, day)` treats every null project as distinct, so the yard
 *     would accumulate a row per refresh and nothing would ever notice.
 *   * **The write is a function.** PostgREST infers an ON CONFLICT target from
 *     a column list and cannot carry an index predicate, so the upgrade to
 *     partial indexes makes an upsert from the Edge Function inexpressible.
 *   * **An unknown field name is refused.** The rule from 0136 and 0139. A
 *     payload naming `windGust` where the column is `wind_gust_mph` would write
 *     a null wind and report success, and a day nobody can lose to wind is a
 *     day the schedule quietly gains.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const RIVAL = '22222222-2222-4222-8222-222222222222';

/** Three days: one clear, one washed out, one blown out. */
const DAYS = [
  { day: 0, high_f: 68, low_f: 51, precip_inches: 0, precip_chance: 10, snow_inches: 0,
    wind_gust_mph: 12, code: 1, summary: 'Mostly clear', workable: true, lost_reason: null },
  { day: 1, high_f: 58, low_f: 49, precip_inches: 0.85, precip_chance: 90, snow_inches: 0,
    wind_gust_mph: 18, code: 63, summary: 'Rain', workable: false, lost_reason: 'Rain' },
  { day: 2, high_f: 61, low_f: 44, precip_inches: 0.02, precip_chance: 20, snow_inches: 0,
    wind_gust_mph: 41, code: 3, summary: 'Overcast', workable: false, lost_reason: 'High wind' },
];

describe('weather at the job site', () => {
  let h: Harness;
  let mine = '';
  let theirs = '';
  let project = '';
  let rivalProject = '';

  /** The forecast rows, with `day` turned into a real date off today. */
  const forecast = (offset = 0) => JSON.stringify(DAYS.map((d) => {
    const when = new Date();
    when.setUTCDate(when.getUTCDate() + d.day + offset);
    return { ...d, day: when.toISOString().slice(0, 10) };
  }));

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [[OWNER, 'owner@ridge.test'], [RIVAL, 'rival@other.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, email]);
    }
    mine = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','professional') as id`)))[0]!.id;
    theirs = (await h.asUser(RIVAL, () => h.sql<{ id: string }>(
      `select app.provision_company('Other Co','other-co','professional') as id`)))[0]!.id;

    project = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name, status, site_city, site_state,
                             latitude, longitude)
       values ($1,'PRJ-2601','Sandusky transfer station','active','Sandusky','OH',
               41.448900, -82.707900)
       returning id`, [mine])))[0]!.id;
    rivalProject = (await h.asUser(RIVAL, () => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name, status)
       values ($1,'PRJ-9999','Not yours','active') returning id`, [theirs])))[0]!.id;
  });

  afterAll(async () => { await h?.db.close(); });

  describe('one forecast per place', () => {
    it('keeps the yard and the site apart on the same day', async () => {
      await h.asUser(OWNER, () => h.sql(
        `select app.record_site_weather($1, null, $2::jsonb)`, [mine, forecast()]));
      await h.asUser(OWNER, () => h.sql(
        `select app.record_site_weather($1, $2, $3::jsonb)`, [mine, project, forecast()]));

      const [row] = await h.asUser(OWNER, () => h.sql<{ yard: string; site: string }>(
        `select count(*) filter (where project_id is null)::text as yard,
                count(*) filter (where project_id = $2)::text as site
           from weather_days where company_id = $1`, [mine, project]));
      expect(Number(row!.yard)).toBe(3);
      expect(Number(row!.site)).toBe(3);
    });

    it('replaces a place rather than accumulating a row per refresh', async () => {
      /*
       * The reason for two partial unique indexes. A composite unique over a
       * nullable column constrains nothing at all for the yard — in SQL every
       * null is distinct from every other — so three refreshes would leave nine
       * rows and the dashboard would show each day three times.
       */
      await h.asUser(OWNER, () => h.sql(
        `select app.record_site_weather($1, null, $2::jsonb)`, [mine, forecast()]));
      await h.asUser(OWNER, () => h.sql(
        `select app.record_site_weather($1, null, $2::jsonb)`, [mine, forecast()]));

      const [row] = await h.asUser(OWNER, () => h.sql<{ n: string }>(
        `select count(*)::text as n from weather_days
          where company_id = $1 and project_id is null`, [mine]));
      expect(Number(row!.n)).toBe(3);
    });

    it('refuses a second row for the same site and day', async () => {
      const [day] = await h.asUser(OWNER, () => h.sql<{ day: string }>(
        `select day::text from weather_days where project_id = $1 limit 1`, [project]));
      await expect(h.asUser(OWNER, () => h.sql(
        `insert into weather_days (company_id, project_id, day) values ($1,$2,$3)`,
        [mine, project, day!.day]))).rejects.toThrow();
    });

    it('refuses a project belonging to somebody else', async () => {
      await expect(h.asUser(OWNER, () => h.sql(
        `select app.record_site_weather($1, $2, $3::jsonb)`, [mine, rivalProject, forecast()])))
        .rejects.toThrow(/does not belong to this company/);
    });
  });

  describe('a field name nobody recognizes', () => {
    it('refuses it, and names it, rather than writing a null', async () => {
      /*
       * `windGust` where the column is `wind_gust_mph`: the key matches
       * nothing, the row lands with a null wind, the call returns success, and
       * the day is workable forever after.
       */
      await expect(h.asUser(OWNER, () => h.sql(
        `select app.record_site_weather($1, null, $2::jsonb)`,
        [mine, JSON.stringify([{ day: '2026-09-10', windGust: 41 }])])))
        .rejects.toThrow(/windGust/);
    });

    it('refuses one in the current conditions too', async () => {
      await expect(h.asUser(OWNER, () => h.sql(
        `select app.record_site_weather($1, null, $2::jsonb, $3::jsonb)`,
        [mine, forecast(), JSON.stringify({ temperature: 54 })])))
        .rejects.toThrow(/temperature/);
    });

    it('takes a forecast that names only fields it has', async () => {
      await expect(h.asUser(OWNER, () => h.sql(
        `select app.record_site_weather($1, null, $2::jsonb)`, [mine, forecast()])))
        .resolves.toBeDefined();
    });
  });

  describe('what it is doing right now', () => {
    it('keeps current conditions apart from the day they fall in', async () => {
      /*
       * A seven-day forecast is good for hours; "is it raining on us" is good
       * for minutes. Folding one into the other is how "today's high" comes to
       * mean whatever the temperature was when somebody last opened the page.
       */
      await h.asUser(OWNER, () => h.sql(
        `select app.record_site_weather($1, $2, $3::jsonb, $4::jsonb)`,
        [mine, project, forecast(), JSON.stringify({
          observed_at: new Date().toISOString(), temperature_f: 57.2,
          wind_mph: 14.5, precip_inches: 0.04, code: 61, summary: 'Light rain',
        })]));

      const [row] = await h.asUser(OWNER, () => h.sql<Record<string, unknown>>(
        `select project_id, observed_at, temperature_f, wind_mph, precip_inches, code, summary
           from my_weather_now where project_id = $1`, [project]));
      expect(Number(row!.temperature_f)).toBeCloseTo(57.2, 1);
      expect(row!.summary).toBe('Light rain');
    });

    it('replaces the observation rather than keeping a history of them', async () => {
      await h.asUser(OWNER, () => h.sql(
        `select app.record_site_weather($1, $2, $3::jsonb, $4::jsonb)`,
        [mine, project, forecast(), JSON.stringify({ temperature_f: 61.0, summary: 'Overcast' })]));
      const rows = await h.asUser(OWNER, () => h.sql<{ summary: string }>(
        `select summary from my_weather_now where project_id = $1`, [project]));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.summary).toBe('Overcast');
    });

    it('leaves the yard observation alone when a site is recorded', async () => {
      await h.asUser(OWNER, () => h.sql(
        `select app.record_site_weather($1, null, $2::jsonb, $3::jsonb)`,
        [mine, forecast(), JSON.stringify({ temperature_f: 55.0, summary: 'Cloudy' })]));
      const rows = await h.asUser(OWNER, () => h.sql<{ summary: string }>(
        `select summary from my_weather_now where company_id = $1 and project_id is null`, [mine]));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.summary).toBe('Cloudy');
    });
  });

  describe('how much of the week can be worked', () => {
    it('answers from the site when the site has a forecast of its own', async () => {
      const [row] = await h.asUser(OWNER, () => h.sql<Record<string, unknown>>(
        `select total, workable, efficiency, source from app.workable_days_at($1, $2, 7)`,
        [mine, project]));
      expect(Number(row!.total)).toBe(3);
      expect(Number(row!.workable)).toBe(1);
      expect(row!.source).toBe('site');
    });

    it('falls back to the yard for a project nobody has placed yet, and says so', async () => {
      /*
       * A project created this morning has no site address. A forecast sixty
       * miles away, clearly labeled, beats an empty panel — but the label is
       * not optional, because an efficiency taken from the yard is a different
       * claim from one taken from the site.
       */
      const bare = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
        `insert into projects (company_id, number, name, status)
         values ($1,'PRJ-2602','No address yet','preconstruction') returning id`,
        [mine])))[0]!.id;
      const [row] = await h.asUser(OWNER, () => h.sql<Record<string, unknown>>(
        `select total, workable, source from app.workable_days_at($1, $2, 7)`, [mine, bare]));
      expect(Number(row!.total)).toBe(3);
      expect(row!.source).toBe('yard');
    });

    it('is reachable through the public function a browser can call', async () => {
      const [row] = await h.asUser(OWNER, () => h.sql<{ source: string }>(
        `select source from public.workable_days_at($1, $2, 7)`, [mine, project]));
      expect(row!.source).toBe('site');
    });

    it('is granted to a signed-in person and to nobody else', async () => {
      const [g] = await h.sql<{ authenticated: boolean; anon: boolean }>(
        `select has_function_privilege('authenticated',
                  'public.workable_days_at(uuid, uuid, int)', 'execute') as authenticated,
                has_function_privilege('anon',
                  'public.workable_days_at(uuid, uuid, int)', 'execute') as anon`);
      expect(g!.authenticated).toBe(true);
      expect(g!.anon).toBe(false);
    });
  });

  describe('and only its own', () => {
    it('shows a rival nothing of this company’s site forecast', async () => {
      const rows = await h.asUser(RIVAL, () => h.sql<{ id: string }>(
        `select day::text as id from my_site_weather where project_id = $1`, [project]));
      expect(rows).toHaveLength(0);
    });

    it('shows an anonymous caller nothing at all', async () => {
      await expect(h.asAnon(() => h.sql(`select day from my_site_weather`))).rejects.toThrow();
      await expect(h.asAnon(() => h.sql(`select summary from my_weather_now`))).rejects.toThrow();
    });

    it('leaves the company forecast the dashboard already reads untouched', async () => {
      /*
       * `my_weather` from 0105 is what the week-ahead panel reads. A view that
       * quietly grew a project column would change what that page shows without
       * anybody asking for it.
       */
      const rows = await h.asUser(OWNER, () => h.sql<{ day: string }>(
        `select day::text as day from my_weather`));
      expect(rows.length).toBeGreaterThan(0);
    });
  });
});
