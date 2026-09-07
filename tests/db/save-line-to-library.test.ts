/**
 * A line you typed becomes a service.
 *
 * The library has been read-only from inside the application since migration
 * 0004: 65,000 platform rows a company may use and no way to add one of its
 * own. `services.origin` has carried a 'company' value the whole time and
 * nothing ever wrote it. So an estimator types "Haul and place 8 inch aggregate
 * base", wins the job, and types it again next month spelled differently.
 *
 * What is tested hardest is what it refuses. Repointing a line changes what an
 * estimate says it is made of, so a frozen version is out; and saving a line
 * that already came from the library would put a second copy into every search
 * from then on.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('a line you typed becomes a service', () => {
  let h: Harness;
  const chief  = '11111111-1111-4111-8111-111111111111';
  const viewer = '22222222-2222-4222-8222-222222222222';
  /** libraries.write, no libraries.approve: the common estimator. */
  const senior = '33333333-3333-4333-8333-333333333333';
  let company = '';
  let versionId = '';
  let n = 0;

  const as = <T,>(who: string, q: string, p?: unknown[]) =>
    h.asUser(who, () => h.sql<T extends object ? T : never>(q, p));
  const sql = <T,>(q: string, p?: unknown[]) => as<T>(chief, q, p);

  /** A typed line: description, no service. */
  const typedLine = async (description: string, unit = 'LS') => {
    const [r] = await sql<{ id: string }>(
      `insert into estimate_line_items
         (company_id, estimate_version_id, line_number, description, unit, measured_quantity)
       values ($1, $2, $3, $4, $5::app.unit_code, 100) returning id`,
      [company, versionId, ++n, description, unit]);
    return r!.id;
  };

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of
      [[chief, 'c@r.test'], [viewer, 'v@r.test'], [senior, 's@r.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, email]);
    }
    company = (await sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`))[0]!.id;
    await h.sql(`insert into company_memberships (company_id, user_id, role_id, status)
                 select $1, $2, r.id, 'active' from roles r
                 where r.company_id is null and r.key = 'viewer' limit 1`, [company, viewer]);
    await h.sql(`insert into company_memberships (company_id, user_id, role_id, status)
                 select $1, $2, r.id, 'active' from roles r
                 where r.company_id is null and r.key = 'senior_estimator' limit 1`,
      [company, senior]);

    const [c] = await sql<{ id: string }>(
      `insert into customers (company_id, code, name) values ($1,'C-1','Northside')
       returning id`, [company]);
    const [e] = await sql<{ id: string }>(
      `insert into estimates (company_id, customer_id, number, name)
       values ($1, $2, 'E-2026-0001', 'Yard expansion') returning id`, [company, c!.id]);
    const [v] = await sql<{ id: string }>(
      `insert into estimate_versions (company_id, estimate_id, version_number, status)
       values ($1, $2, 1, 'draft') returning id`, [company, e!.id]);
    versionId = v!.id;
  }, 300_000);

  afterAll(async () => { await h?.db.close(); });

  // ---------------------------------------------------------------------------
  describe('saving one', () => {
    let lineId = '';
    let serviceId = '';

    it('creates a service carrying the words the estimator used', async () => {
      lineId = await typedLine('Haul and place 8 inch aggregate base', 'CY');
      const [s] = await sql<{ id: string; name: string; default_unit: string }>(
        `select id, name, default_unit::text from save_line_to_library($1, 'Earthwork')`,
        [lineId]);
      serviceId = s!.id;
      expect(s!.name).toBe('Haul and place 8 inch aggregate base');
      expect(s!.default_unit).toBe('CY');
    });

    it('files it against the company, not the platform', async () => {
      const [s] = await sql<{ company_id: string; origin: string }>(
        `select company_id, origin from services where id = $1`, [serviceId]);
      expect(s!.company_id).toBe(company);
      expect(s!.origin).toBe('company');
    });

    it('is live and approved when the person saving it may approve', async () => {
      /*
       * Migration 0028: a live company library row must name who made it live.
       * The owner holds libraries.approve, so saving is approving and the row
       * says who did it — rather than a live row nobody signed for.
       */
      const [s] = await sql<{ status: string; approved_by: string | null }>(
        `select status::text, approved_by from services where id = $1`, [serviceId]);
      expect(s!.status).toBe('active');
      expect(s!.approved_by).toBe(chief);
    });

    it('points the line at it rather than leaving a copy behind', async () => {
      const [l] = await sql<{ service_id: string }>(
        `select service_id from estimate_line_items where id = $1`, [lineId]);
      expect(l!.service_id).toBe(serviceId);
    });

    it('generates a code so nobody has to invent one mid-bid', async () => {
      const [s] = await sql<{ code: string }>(
        `select code from services where id = $1`, [serviceId]);
      expect(s!.code).toBe('C-0001');
    });

    it('never collides with a platform code', async () => {
      const [r] = await sql<{ c: string }>(
        `select count(*)::text as c from services
         where company_id is null and code like 'C-%'`);
      expect(Number(r!.c)).toBe(0);
    });

    it('counts up from the highest, not from the number of rows', async () => {
      const second = await typedLine('Fine grade and compact subgrade', 'SY');
      const [s] = await sql<{ code: string }>(
        `select code from save_line_to_library($1)`, [second]);
      expect(s!.code).toBe('C-0002');
    });

    it('is findable in the library search from then on', async () => {
      const [r] = await sql<{ name: string }>(
        `select name from services
         where company_id = $1 and search_text ilike '%aggregate base%'`, [company]);
      expect(r!.name).toBe('Haul and place 8 inch aggregate base');
    });
  });

  // ---------------------------------------------------------------------------
  describe('saving one without the authority to approve it', () => {
    it('files a draft rather than refusing', async () => {
      /*
       * The common case: an estimator with libraries.write and no approval
       * authority. Refusing would mean the words are lost, which is the whole
       * problem; making it live would put a row nobody signed for into every
       * colleague's search.
       */
      const l = await typedLine('Trench and bed 12 inch storm pipe', 'LF');
      const [s] = await as<{ status: string; approved_by: string | null; origin: string }>(
        senior, `select status::text, approved_by, origin from save_line_to_library($1)`, [l]);
      expect(s!.status).toBe('draft');
      expect(s!.approved_by).toBeNull();
      expect(s!.origin).toBe('company');
    });

    it('still points the line at it, so the estimate is not blocked', async () => {
      const [l] = await sql<{ service_id: string | null }>(
        `select service_id from estimate_line_items
         where description = 'Trench and bed 12 inch storm pipe'
            or service_id = (select id from services
                              where company_id = $1
                                and name = 'Trench and bed 12 inch storm pipe')
         order by created_at desc limit 1`, [company]);
      expect(l!.service_id).toBeTruthy();
    });

    it('keeps it out of everybody else\'s search until it is approved', async () => {
      const [r] = await sql<{ c: string }>(
        `select count(*)::text as c from services
         where company_id = $1 and status = 'active'
           and name = 'Trench and bed 12 inch storm pipe'`, [company]);
      expect(Number(r!.c)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  describe('saving the same thing twice', () => {
    it('returns the one already there rather than making a second', async () => {
      const again = await typedLine('Haul and place 8 inch aggregate base', 'CY');
      const [s] = await sql<{ id: string; code: string }>(
        `select id, code from save_line_to_library($1)`, [again]);
      expect(s!.code).toBe('C-0001');
    });

    it('leaves exactly one service of that name', async () => {
      const [r] = await sql<{ c: string }>(
        `select count(*)::text as c from services
         where company_id = $1 and name = 'Haul and place 8 inch aggregate base'`, [company]);
      expect(Number(r!.c)).toBe(1);
    });

    it('still points the second line at it', async () => {
      const [r] = await sql<{ c: string }>(
        `select count(*)::text as c from estimate_line_items
         where estimate_version_id = $1
           and service_id = (select id from services
                              where company_id = $2 and code = 'C-0001')`,
        [versionId, company]);
      expect(Number(r!.c)).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  describe('what it refuses', () => {
    it('refuses a line that already came from the library', async () => {
      const [existing] = await sql<{ id: string }>(
        `select id from services where company_id = $1 and code = 'C-0001'`, [company]);
      const [l] = await sql<{ id: string }>(
        `insert into estimate_line_items
           (company_id, estimate_version_id, line_number, service_id, description,
            unit, measured_quantity)
         values ($1, $2, $3, $4, 'From the library already', 'LS'::app.unit_code, 10)
         returning id`,
        [company, versionId, ++n, existing!.id]);
      await expect(sql(`select save_line_to_library($1)`, [l!.id]))
        .rejects.toThrow(/already came from the library/);
    });

    it('refuses a description too short to be a service', async () => {
      const l = await typedLine('X');
      await expect(sql(`select save_line_to_library($1)`, [l]))
        .rejects.toThrow(/at least three characters/);
    });

    it('needs libraries.write', async () => {
      const l = await typedLine('Something a viewer typed');
      await expect(as(viewer, `select save_line_to_library($1)`, [l]))
        .rejects.toThrow(/libraries.write/);
    });

    it('refuses once the version is frozen, because it repoints the line', async () => {
      /*
       * `in_review` rather than `approved`: approving a version requires a
       * library snapshot, which is a different rule with its own test. What is
       * checked here is that anything past draft refuses.
       */
      const l = await typedLine('Late addition after the draft closed');
      await sql(`update estimate_versions set status = 'in_review' where id = $1`, [versionId]);
      await expect(sql(`select save_line_to_library($1)`, [l]))
        .rejects.toThrow(/no longer be repointed/);
      await sql(`update estimate_versions set status = 'draft' where id = $1`, [versionId]);
    });

    it('refuses a line that does not exist', async () => {
      await expect(sql(
        `select save_line_to_library('00000000-0000-4000-8000-000000000000')`))
        .rejects.toThrow(/No such line/);
    });

    it('lets nobody reach it anonymously', async () => {
      await h.asAnon(async () => {
        await expect(h.sql(
          `select save_line_to_library('00000000-0000-4000-8000-000000000000')`))
          .rejects.toThrow(/permission denied/);
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('the category it is filed under', () => {
    it('takes the one the estimator picked', async () => {
      const [s] = await sql<{ category: string }>(
        `select category from services where company_id = $1 and code = 'C-0001'`, [company]);
      expect(s!.category).toBe('Earthwork');
    });

    it('accepts none, because ungrouped is better than wrongly grouped', async () => {
      const l = await typedLine('Something with no obvious trade');
      const [s] = await sql<{ category: string | null }>(
        `select category from save_line_to_library($1)`, [l]);
      expect(s!.category).toBeNull();
    });
  });
});
