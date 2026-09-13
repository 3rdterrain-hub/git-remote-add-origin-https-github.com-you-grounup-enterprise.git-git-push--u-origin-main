/**
 * Which job you are standing on.
 *
 * `time_punches` has carried coordinates since 0122 and `punch_in` has taken
 * them as arguments; projects have carried coordinates since 0007. Nothing put
 * the two together, so somebody standing on a job still had to find it in a
 * list.
 *
 * What these hold down is mostly the restraint. A job with no fence is never
 * suggested however near it is, because a radius invented for every project
 * would put people on the wrong one. Being inside a fence and being assigned to
 * the job are separate facts, because somebody sent to cover a job is standing
 * on it all the same. And none of it punches anybody in: a phone crossing a
 * fence is not a person starting work.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('which job you are standing on', () => {
  let h: Harness;
  const foreman = '11111111-1111-4111-8111-111111111111';
  const rival = '22222222-2222-4222-8222-222222222222';
  let mine = '';
  let theirs = '';
  let fenced = '';
  let unfenced = '';
  let faraway = '';
  let employee = '';

  /* A yard in Toledo, and a job four hundred meters away from it. */
  const YARD = { lat: 41.6639, lon: -83.5552 };
  const NEAR = { lat: 41.6675, lon: -83.5552 };   // ~400m north
  const FAR  = { lat: 41.7639, lon: -83.5552 };   // ~11km north

  const as = <T,>(who: string, q: string, p?: unknown[]) =>
    h.asUser(who, () => h.sql<T extends object ? T : never>(q, p));
  const asForeman = <T,>(q: string, p?: unknown[]) => as<T>(foreman, q, p);

  const project = async (company: string, number: string, lat: number, lon: number,
                         radius: number | null, who: string) => {
    const [r] = await h.asService(() => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name, status, latitude, longitude,
                             geofence_radius_meters)
       values ($1,$2,$3,'active',$4,$5,$6) returning id`,
      [company, number, `Job ${number}`, lat, lon, radius]));
    return r!.id;
  };

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, mail] of [[foreman, 'f@r.test'], [rival, 'r@k.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, mail]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, mail]);
    }
    mine = (await asForeman<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`))[0]!.id;
    theirs = (await as<{ id: string }>(rival,
      `select app.provision_company('Kesler','kesler','enterprise') as id`))[0]!.id;

    employee = (await asForeman<{ id: string }>(
      `select app.create_employee($1,'Tyree','Myers',null,null,'full_time',
                                  null,null,null,true) as id`, [mine]))[0]!.id;

    fenced   = await project(mine, 'PRJ-A', NEAR.lat, NEAR.lon, 800, foreman);
    unfenced = await project(mine, 'PRJ-B', NEAR.lat, NEAR.lon, null, foreman);
    faraway  = await project(mine, 'PRJ-C', FAR.lat,  FAR.lon,  800, foreman);
    await project(theirs, 'PRJ-Z', NEAR.lat, NEAR.lon, 800, rival);

    await h.asService(() => h.sql(
      `insert into resource_assignments
         (company_id, project_id, resource_kind, employee_id, starts_on, ends_on)
       values ($1,$2,'employee',$3, current_date - 1, current_date + 1)`,
      [mine, fenced, employee]));
  }, 240_000);

  afterAll(async () => { await h?.db.close(); });

  describe('how far away things are', () => {
    it('measures a few hundred meters the way a tape would', async () => {
      const [r] = await asForeman<{ m: string }>(
        `select app.meters_between($1,$2,$3,$4) as m`,
        [YARD.lat, YARD.lon, NEAR.lat, NEAR.lon]);
      expect(Number(r!.m)).toBeGreaterThan(350);
      expect(Number(r!.m)).toBeLessThan(450);
    });

    it('is zero for the same point, not a rounding artifact', async () => {
      const [r] = await asForeman<{ m: string }>(
        `select app.meters_between($1,$2,$1,$2) as m`, [YARD.lat, YARD.lon]);
      expect(Number(r!.m)).toBe(0);
    });

    it('has no answer when a coordinate is missing', async () => {
      const [r] = await asForeman<{ m: string | null }>(
        `select app.meters_between($1,$2,null,null) as m`, [YARD.lat, YARD.lon]);
      expect(r!.m).toBeNull();
    });
  });

  describe('what is near me', () => {
    it('puts the nearest job first', async () => {
      const rows = await asForeman<{ number: string }>(
        `select number from app.my_jobs_nearby($1,$2)`, [YARD.lat, YARD.lon]);
      expect(rows[0]!.number).toMatch(/^PRJ-[AB]$/);
      expect(rows.map((r) => r.number)).toContain('PRJ-C');
    });

    it('says I am inside a fence I am inside', async () => {
      const rows = await asForeman<{ number: string; inside: boolean }>(
        `select number, inside from app.my_jobs_nearby($1,$2)`, [YARD.lat, YARD.lon]);
      expect(rows.find((r) => r.number === 'PRJ-A')!.inside).toBe(true);
    });

    it('never suggests a job with no fence, however near it is', async () => {
      const rows = await asForeman<{ number: string; inside: boolean;
                                    distance_meters: string }>(
        `select number, inside, distance_meters from app.my_jobs_nearby($1,$2)`,
        [YARD.lat, YARD.lon]);
      const b = rows.find((r) => r.number === 'PRJ-B')!;
      // Same coordinates as the fenced one, so distance cannot be the reason.
      expect(Number(b.distance_meters)).toBeLessThan(450);
      expect(b.inside).toBe(false);
    });

    it('is outside a fence eleven kilometers away', async () => {
      const rows = await asForeman<{ number: string; inside: boolean }>(
        `select number, inside from app.my_jobs_nearby($1,$2)`, [YARD.lat, YARD.lon]);
      expect(rows.find((r) => r.number === 'PRJ-C')!.inside).toBe(false);
    });

    it('separates being inside from being assigned', async () => {
      const rows = await asForeman<{ number: string; inside: boolean; assigned: boolean }>(
        `select number, inside, assigned from app.my_jobs_nearby($1,$2)`,
        [YARD.lat, YARD.lon]);
      expect(rows.find((r) => r.number === 'PRJ-A')!.assigned).toBe(true);
      // Standing on it without being scheduled on it is still standing on it.
      expect(rows.find((r) => r.number === 'PRJ-B')!.assigned).toBe(false);
    });

    it('never shows another company a job of mine', async () => {
      const rows = await as<{ number: string }>(rival,
        `select number from app.my_jobs_nearby($1,$2,50)`, [YARD.lat, YARD.lon]);
      expect(rows.map((r) => r.number)).toEqual(['PRJ-Z']);
    });

    it('answers nothing at all without a position', async () => {
      const rows = await asForeman(`select * from app.my_jobs_nearby(null, null)`);
      expect(rows).toHaveLength(0);
    });

    it('punches nobody in', async () => {
      await asForeman(`select * from app.my_jobs_nearby($1,$2)`, [YARD.lat, YARD.lon]);
      const [r] = await asForeman<{ n: string }>(
        `select count(*) as n from time_punches`);
      expect(Number(r!.n)).toBe(0);
    });
  });

  describe('the fence itself', () => {
    it('refuses one finer than consumer GPS', async () => {
      await expect(asForeman(`select app.set_project_geofence($1, 10)`, [unfenced]))
        .rejects.toThrow(/between 25 and 5000/i);
    });

    it('refuses one that is not a job site', async () => {
      await expect(asForeman(`select app.set_project_geofence($1, 20000)`, [unfenced]))
        .rejects.toThrow(/between 25 and 5000/i);
    });

    it('draws one, and removes it with null', async () => {
      await asForeman(`select app.set_project_geofence($1, 300)`, [unfenced]);
      let [row] = await asForeman<{ geofence_radius_meters: number | null }>(
        `select geofence_radius_meters from projects where id = $1`, [unfenced]);
      expect(row!.geofence_radius_meters).toBe(300);

      await asForeman(`select app.set_project_geofence($1, null)`, [unfenced]);
      [row] = await asForeman<{ geofence_radius_meters: number | null }>(
        `select geofence_radius_meters from projects where id = $1`, [unfenced]);
      expect(row!.geofence_radius_meters).toBeNull();
    });

    it('refuses a job that is not mine, without confirming it exists', async () => {
      const theirProject = (await as<{ id: string }>(rival,
        `select id from projects where company_id = $1 limit 1`, [theirs]))[0]!.id;
      await expect(asForeman(`select app.set_project_geofence($1, 300)`, [theirProject]))
        .rejects.toThrow(/No such project/i);
    });
  });

  describe('what I was asked to do', () => {
    it('shows me my own assignment, with the site on it', async () => {
      const rows = await asForeman<{ project_number: string; today: boolean;
                                     geofence_radius_meters: number | null }>(
        `select project_number, today, geofence_radius_meters from my_assignments`);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.project_number).toBe('PRJ-A');
      expect(rows[0]!.today).toBe(true);
      expect(rows[0]!.geofence_radius_meters).toBe(800);
    });

    it('shows somebody else nothing of mine', async () => {
      const rows = await as(rival, `select * from my_assignments`);
      expect(rows).toHaveLength(0);
    });

    it('carries no money on the task list a phone reads', async () => {
      const cols = await asForeman<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_name = 'my_project_tasks'`);
      const names = cols.map((c) => c.column_name);
      for (const money of ['budgeted_cost', 'budgeted_hours', 'unit_cost', 'total_cost']) {
        expect(names).not.toContain(money);
      }
    });
  });
});
