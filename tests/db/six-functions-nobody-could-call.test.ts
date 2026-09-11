/**
 * The six the door inventory found, and what each of them turned out to be.
 *
 * Migration 0145 taught the scan to spot an `app.*` function granted to
 * `authenticated` that no other SQL calls — granted on purpose, invisible to
 * PostgREST, reachable by nobody. Six turned up, and they were two different
 * mistakes wearing the same shape: three helpers whose one caller re-implemented
 * them alongside, and three features with no door at all.
 *
 * What these tests hold down is the *joint* in each case, because that is what
 * was missing: not that the function works — several were already tested — but
 * that the place which should ask it does, and that a browser can reach the
 * ones meant for a browser.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const RIVAL = '22222222-2222-4222-8222-222222222222';

describe('six functions nobody could call', () => {
  let h: Harness;
  let mine = '';
  let theirs = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [[OWNER, 'owner@ridge.test'], [RIVAL, 'rival@other.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, email]);
    }
    mine = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','grounup') as id`)))[0]!.id;
    theirs = (await h.asUser(RIVAL, () => h.sql<{ id: string }>(
      `select app.provision_company('Other Co','other-co','grounup') as id`)))[0]!.id;
  });

  afterAll(async () => { await h?.db.close(); });

  // ==========================================================================
  // Helpers whose caller used to re-implement them
  // ==========================================================================
  describe('one definition of expired', () => {
    let version = '';

    beforeAll(async () => {
      version = await h.asUser(OWNER, async () => {
        const est = (await h.sql<{ id: string }>(
          `insert into estimates (company_id, number, name, created_at, expires_at)
           values ($1,'EST-EXP','Expired last week',
                   now() - interval '60 days', now() - interval '7 days')
           returning id`, [mine]))[0]!.id;
        return (await h.sql<{ id: string }>(
          `insert into estimate_versions (company_id, estimate_id, version_number, status)
           values ($1,$2,1,'draft') returning id`, [mine, est]))[0]!.id;
      });
    });

    it('asks the predicate rather than repeating the comparison', async () => {
      /*
       * `assert_not_expired` compared `expires_at <= now()` itself while
       * `estimate_is_expired` sat beside it saying the same thing. They agreed,
       * which is how a second definition survives long enough to stop agreeing.
       */
      const body = (await h.sql<{ src: string }>(
        `select pg_get_functiondef(p.oid) as src
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'assert_not_expired'`))[0]!.src;
      expect(body).toContain('app.estimate_is_expired');
      expect(body).not.toMatch(/v_expires\s*<=\s*now\(\)/);
    });

    it('still refuses the work, with the date in the message', async () => {
      await expect(h.asUser(OWNER, () => h.sql(
        `select app.assert_not_expired($1)`, [version])))
        .rejects.toThrow(/This estimate expired on/);
    });

    it('and the predicate itself answers for the estimate', async () => {
      const [row] = await h.asUser(OWNER, () => h.sql<{ expired: boolean }>(
        `select app.estimate_is_expired(v.estimate_id) as expired
           from estimate_versions v where v.id = $1`, [version]));
      expect(row!.expired).toBe(true);
    });

    it('says no for an estimate with no expiry at all', async () => {
      const other = await h.asUser(OWNER, () => h.sql<{ id: string }>(
        `insert into estimates (company_id, number, name) values ($1,'EST-FOREVER','No expiry')
         returning id`, [mine]));
      const [row] = await h.asUser(OWNER, () => h.sql<{ expired: boolean }>(
        `select app.estimate_is_expired($1) as expired`, [other[0]!.id]));
      expect(row!.expired).toBe(false);
    });
  });

  describe('the takeoff path says what it was trying to do', () => {
    it('calls the guard written for it', async () => {
      const body = (await h.sql<{ src: string }>(
        `select pg_get_functiondef(p.oid) as src
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'apply_takeoff_to_line'`))[0]!.src;
      expect(body).toContain('app.assert_line_open');
    });

    it('decides visibility before it explains anything', async () => {
      /*
       * The ordering is the point and it is a disclosure question, not a
       * cosmetic one. `assert_line_open` is `security definer`, so it can see a
       * line in another company; using it as the existence check would answer a
       * stranger's probe with "that estimate is issued" — confirming the row
       * exists and naming its state. The checks that decide visibility run
       * first, under the caller's own row level security.
       */
      const body = (await h.sql<{ src: string }>(
        `select pg_get_functiondef(p.oid) as src
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'apply_takeoff_to_line'`))[0]!.src;
      const existence = body.indexOf('Estimate line % not found');
      const tenancy = body.indexOf('belong to different companies');
      const open = body.indexOf('app.assert_line_open');
      expect(existence).toBeGreaterThan(-1);
      expect(tenancy).toBeGreaterThan(existence);
      expect(open).toBeGreaterThan(tenancy);
    });

    it('refuses a measurement onto a signed-off line, in words about the estimate', async () => {
      const line = await h.asUser(OWNER, async () => {
        const est = (await h.sql<{ id: string }>(
          `insert into estimates (company_id, number, name) values ($1,'EST-FROZEN','Issued')
           returning id`, [mine]))[0]!.id;
        const v = (await h.sql<{ id: string }>(
          `insert into estimate_versions (company_id, estimate_id, version_number, status)
           values ($1,$2,1,'draft') returning id`, [mine, est]))[0]!.id;
        const l = (await h.sql<{ id: string }>(
          `insert into estimate_line_items (company_id, estimate_version_id, description,
                                            measured_quantity, unit)
           values ($1,$2,'Pipe',10,'LF') returning id`, [mine, v]))[0]!.id;
        /*
         * With the snapshot the approval requires: an issued price the platform
         * cannot reproduce is not a record of anything, and the database says
         * so rather than letting a test pretend otherwise.
         */
        const snap = (await h.sql<{ id: string }>(
          `insert into library_snapshots (company_id, estimate_version_id, engine_version,
                                          entry_count, digest)
           values ($1,$2,'1.0.0',0,'0000000000000000') returning id`, [mine, v]))[0]!.id;
        await h.asService(() => h.sql(
          `update estimate_versions set library_snapshot_id = $2, status = 'approved'
            where id = $1`, [v, snap]));
        return l;
      });
      await expect(h.asUser(OWNER, () => h.sql(
        `select app.assert_line_open($1)`, [line])))
        .rejects.toThrow(/a measurement cannot change a quantity that has been signed off/);
    });
  });

  describe('one definition of the current calculation', () => {
    it('is asked rather than re-sorted', async () => {
      const body = (await h.sql<{ src: string }>(
        `select pg_get_functiondef(p.oid) as src
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'publish_metric_version'`))[0]!.src;
      expect(body).toContain('app.current_metric_version');
    });

    it('publishes a new version when the calculation changes, and not otherwise', async () => {
      const metric = (await h.asService(() => h.sql<{ id: string }>(
        `insert into metric_definitions (company_id, key, name, description, domain,
                                         unit, expression, grain)
         values ($1,'test_metric','Test metric','A metric for the version test',
                 'estimating','count','count(*)','company') returning id`,
        [mine])))[0]!.id;

      const versions = async () => {
        const rows = await h.asService(() => h.sql<{ n: string }>(
          `select count(*)::text as n from metric_definition_versions where metric_id = $1`,
          [metric]));
        return Number(rows[0]?.n ?? -1);
      };
      const first = await versions();

      // Same expression: nothing new to publish.
      await h.asService(() => h.sql(
        `update metric_definitions set name = 'Renamed' where id = $1`, [metric]));
      expect(await versions()).toBe(first);

      // A different calculation is a different version.
      await h.asService(() => h.sql(
        `update metric_definitions set expression = 'count(*) + 1' where id = $1`, [metric]));
      expect(await versions()).toBe(first + 1);

      // And the helper names the one just published.
      const [cur] = await h.asService(() => h.sql<{ version: number }>(
        `select v.version from metric_definition_versions v
          where v.id = app.current_metric_version($1)`, [metric]));
      expect(Number(cur!.version)).toBe(first + 1);
    });
  });

  // ==========================================================================
  // The three that had no door
  // ==========================================================================
  describe('a haul you can price from a screen', () => {
    let rate = '';

    beforeAll(async () => {
      rate = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
        `insert into trucking_rates (company_id, code, name, pricing_basis,
                                     capacity, capacity_unit, hourly_rate,
                                     rate_per_trip, charges_whole_trips)
         values ($1,'TR-TEST','Tri-axle, per trip','per_trip',18,'TON',0,210,true)
         returning id`, [mine])))[0]!.id;
    });

    it('is reachable through public, which is what it was written for', async () => {
      /*
       * Its own comment says the trip arithmetic is duplicated from the engine
       * so "a company comparing quotes on a screen should not need an Edge
       * Function round trip per row". A screen can only reach `public`.
       */
      const [row] = await h.asUser(OWNER, () => h.sql<Record<string, unknown>>(
        `select pricing_basis, trips_paid, cost, effective_rate_per_unit, unused_capacity
           from public.haul_cost($1, 100)`, [rate]));
      expect(row!.pricing_basis).toBe('per_trip');
      // 100 tons at 18 a load is 5.56 loads, charged as 6 whole trips.
      expect(Number(row!.trips_paid)).toBe(6);
      expect(Number(row!.cost)).toBeCloseTo(1260, 2);
    });

    it('shows one company nothing of another company’s rates', async () => {
      const rows = await h.asUser(RIVAL, () => h.sql(
        `select cost from public.haul_cost($1, 100)`, [rate]));
      expect(rows).toHaveLength(0);
    });

    it('is granted to a signed-in person and to nobody else', async () => {
      const [g] = await h.sql<{ authenticated: boolean; anon: boolean }>(
        `select has_function_privilege('authenticated',
                  'public.haul_cost(uuid, numeric)', 'execute') as authenticated,
                has_function_privilege('anon',
                  'public.haul_cost(uuid, numeric)', 'execute') as anon`);
      expect(g!.authenticated).toBe(true);
      expect(g!.anon).toBe(false);
    });
  });

  describe('a search of what the drawings say', () => {
    beforeAll(async () => {
      await h.asUser(OWNER, async () => {
        const doc = (await h.sql<{ id: string }>(
          `insert into documents (company_id, name, document_type)
           values ($1,'Civil set','plan_set') returning id`, [mine]))[0]!.id;
        const ver = (await h.sql<{ id: string }>(
          `insert into document_versions (company_id, document_id, version_number,
                                          storage_path, file_name, mime_type)
           values ($1,$2,1,'civil/v1.pdf','civil-set-v1.pdf','application/pdf')
           returning id`, [mine, doc]))[0]!.id;
        await h.sql(
          `insert into document_sheets (company_id, document_version_id, page_number,
                                        sheet_number, extracted_text)
           values ($1,$2,1,'C-210',
                   'Storm sewer plan and profile. Provide cathodic protection at all '
                   || 'ductile iron fittings within the casing.')`, [mine, ver]);
      });
    });

    it('finds a sheet by what its body says, not only by its number', async () => {
      /*
       * The whole reason the function exists: a drawing whose title block says
       * C-210 and whose body says "cathodic protection" was findable by the
       * first and not the second.
       */
      const rows = await h.asUser(OWNER, () => h.sql<Record<string, unknown>>(
        `select document_name, sheet_number, snippet
           from public.search_document_text('cathodic protection', 10)`));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.sheet_number).toBe('C-210');
      expect(String(rows[0]!.snippet)).toMatch(/cathodic/i);
    });

    it('returns nothing for an empty search rather than everything', async () => {
      const rows = await h.asUser(OWNER, () => h.sql(
        `select document_id from public.search_document_text('   ', 10)`));
      expect(rows).toHaveLength(0);
    });

    it('shows one company nothing of another company’s drawings', async () => {
      // SECURITY INVOKER all the way down, so "permission-filtered" is row
      // level security rather than a filter somebody remembered to write.
      const rows = await h.asUser(RIVAL, () => h.sql(
        `select document_id from public.search_document_text('cathodic protection', 10)`));
      expect(rows).toHaveLength(0);
    });

    it('is granted to a signed-in person and to nobody else', async () => {
      const [g] = await h.sql<{ authenticated: boolean; anon: boolean }>(
        `select has_function_privilege('authenticated',
                  'public.search_document_text(text, int)', 'execute') as authenticated,
                has_function_privilege('anon',
                  'public.search_document_text(text, int)', 'execute') as anon`);
      expect(g!.authenticated).toBe(true);
      expect(g!.anon).toBe(false);
    });
  });

  describe('closing the books', () => {
    let period = '';

    beforeAll(async () => {
      period = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
        `insert into financial_periods (company_id, name, period_start, period_end, status)
         values ($1,'2026-08','2026-08-01','2026-08-31','open') returning id`,
        [mine])))[0]!.id;
    });

    it('is reachable through public', async () => {
      const [row] = await h.asUser(OWNER, () => h.sql<Record<string, unknown>>(
        `select status, closed_by from public.close_financial_period($1, 'Month end')`,
        [period]));
      expect(row!.status).toBe('closed');
      expect(row!.closed_by).toBe(OWNER);
    });

    it('refuses to close a period twice', async () => {
      await expect(h.asUser(OWNER, () => h.sql(
        `select status from public.close_financial_period($1)`, [period])))
        .rejects.toThrow(/already closed/);
    });

    it('refuses to close over a pay application still open', async () => {
      /*
       * The check that makes closing mean anything: a close that silently
       * leaves a draft inside produces a period total that is going to move.
       */
      const open = await h.asUser(OWNER, async () => {
        const p = (await h.sql<{ id: string }>(
          `insert into financial_periods (company_id, name, period_start, period_end, status)
           values ($1,'2026-09','2026-09-01','2026-09-30','open') returning id`,
          [mine]))[0]!.id;
        const project = (await h.sql<{ id: string }>(
          `insert into projects (company_id, number, name) values ($1,'PRJ-CLOSE','Books')
           returning id`, [mine]))[0]!.id;
        await h.sql(
          `insert into pay_applications (company_id, project_id, application_number,
                                         period_start, period_end, status)
           values ($1,$2,1,'2026-09-01','2026-09-30','draft')`, [mine, project]);
        return p;
      });
      await expect(h.asUser(OWNER, () => h.sql(
        `select status from public.close_financial_period($1)`, [open])))
        .rejects.toThrow(/still open/);
    });

    it('shows one company nothing of another company’s periods', async () => {
      await expect(h.asUser(RIVAL, () => h.sql(
        `select status from public.close_financial_period($1)`, [period])))
        .rejects.toThrow(/No such period/);
    });

    it('is granted to a signed-in person and to nobody else', async () => {
      const [g] = await h.sql<{ authenticated: boolean; anon: boolean }>(
        `select has_function_privilege('authenticated',
                  'public.close_financial_period(uuid, text)', 'execute') as authenticated,
                has_function_privilege('anon',
                  'public.close_financial_period(uuid, text)', 'execute') as anon`);
      expect(g!.authenticated).toBe(true);
      expect(g!.anon).toBe(false);
    });
  });
});
