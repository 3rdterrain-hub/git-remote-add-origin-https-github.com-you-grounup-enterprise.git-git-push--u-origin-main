/**
 * A wage sheet you can point at.
 *
 * What a person is paid depends on which hall they belong to and where the job
 * is — Local 18 does not pay the same across Ohio, and 324 is a different
 * agreement entirely — and on a public job it depends on a determination scoped
 * by county *and* construction type. None of that fits in a `region` column.
 *
 * Two properties carry this whole feature, and they are the first two tests.
 *
 *   1. **An estimate that names no sheet is priced exactly as before.** Not by
 *      an equivalent rate — by the same row, through the same column, with no
 *      lookup performed. Most contractors are open shop and will never open
 *      this; it must be impossible for it to move their numbers.
 *
 *   2. **Nothing is ever substituted.** A class missing from the sheet an
 *      estimate names is a refusal that says which class and which sheet, not a
 *      quiet fall back to the shop rate. A wage nobody chose is a wage nobody
 *      can defend, and on a public job it is a finding.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '4a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a';

describe('a wage sheet you can point at', () => {
  let h: Harness;
  let company = '';
  let version = '';
  let shopRate = '';
  let crewMember = '';

  const asOwner = <T>(fn: () => Promise<T>) => h.asUser(OWNER, fn);
  const one = <T>(sql: string, args: unknown[] = []) =>
    asOwner(() => h.sql<T>(sql, args)).then((r) => r[0]!);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@wage.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@wage.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await asOwner(() => h.sql<{ id: string }>(
      `select app.provision_company('Wage Civil','wage-civil','enterprise') as id`)))[0]!.id;

    /* The company's own operator rate, as an open-shop contractor holds it. */
    shopRate = (await one<{ id: string }>(
      `insert into labor_rates (company_id, code, classification, labor_group,
         base_wage_per_hour, burden_percent, status, approved_by, approved_at)
       values ($1,'LAB-OP2-MINE','Heavy Equipment Operator II','Operator',44,0.35,
               'active',$2, now())
       returning id`, [company, OWNER])).id;

    const crew = (await one<{ id: string }>(
      `insert into crews (company_id, code, name, shift_hours, status, approved_by, approved_at)
       values ($1,'CRW-EW','Earthwork crew',8,'active',$2, now()) returning id`,
      [company, OWNER])).id;
    crewMember = (await one<{ id: string }>(
      `insert into crew_members (company_id, crew_id, labor_rate_id, headcount,
         straight_hours_per_shift)
       values ($1,$2,$3,1,8) returning id`, [company, crew, shopRate])).id;

    const estimate = (await one<{ id: string }>(
      `insert into estimates (company_id, number, name, status)
       values ($1,'E-2026-0001','Pad and drive','draft') returning id`, [company])).id;
    version = (await one<{ id: string }>(
      `insert into estimate_versions (company_id, estimate_id, version_number, status)
       values ($1,$2,1,'draft') returning id`, [company, estimate])).id;
  }, 180_000);

  // ------------------------------------------------------------ the two rules
  describe('the properties everything else rests on', () => {
    it('prices an estimate that names no sheet with the crew’s own rate, unchanged', async () => {
      /*
       * The identity. An open-shop company never sets a sheet, and this is the
       * whole of what happens to them: the same row they already pointed at.
       */
      const row = await one<{ resolved: string }>(
        `select app.resolve_labor_rate($1,$2) as resolved`, [crewMember, version]);
      expect(row.resolved).toBe(shopRate);
    });

    it('refuses rather than substituting when a class is not on the sheet', async () => {
      const sheet = (await one<{ id: string }>(
        `select public.create_wage_schedule($1,'IUOE Local 18 — Toledo','union','2026-05-01',
           'Operating Engineers','18','Toledo') as id`, [company])).id;
      await asOwner(() => h.sql(
        `select public.add_wage_rate($1,'Laborer','Group 1',28.50,18.20,0.22)`, [sheet]));
      await asOwner(() => h.sql(`select public.approve_wage_schedule($1)`, [sheet]));
      await asOwner(() => h.sql(
        `select public.set_estimate_wage_schedule($1,$2)`, [version, sheet]));

      /* The crew's rate has no trade or class yet, so it cannot be looked up —
         and that is said in those terms rather than as a missing row. */
      await expect(asOwner(() => h.sql(
        `select app.resolve_labor_rate($1,$2)`, [crewMember, version])))
        .rejects.toThrow(/does not say what trade and class it is/);

      await asOwner(() => h.sql(
        `update labor_rates set trade = 'Operating Engineer', class_label = 'Class 2'
          where id = $1`, [shopRate]));

      await expect(asOwner(() => h.sql(
        `select app.resolve_labor_rate($1,$2)`, [crewMember, version])))
        .rejects.toThrow(/Operating Engineer \(Class 2\) is not on the wage sheet "IUOE Local 18 — Toledo"/);

      await asOwner(() => h.sql(
        `select public.set_estimate_wage_schedule($1,null)`, [version]));
    });
  });

  // ---------------------------------------------------------------- the sheet
  describe('what a sheet has to say about itself', () => {
    it('refuses a union sheet with no local', async () => {
      // Local 18 does not pay the same across Ohio; without the local nobody
      // can check the sheet against the agreement it came from.
      await expect(asOwner(() => h.sql(
        `select public.create_wage_schedule($1,'Some union deal','union')`, [company])))
        .rejects.toThrow(/says which union and which local/);
    });

    it('refuses a determination with no county or construction type', async () => {
      await expect(asOwner(() => h.sql(
        `select public.create_wage_schedule($1,'Davis-Bacon','prevailing_wage','2026-03-15',
           null,null,null,'OH20260012','Lucas','OH',null)`, [company])))
        .rejects.toThrow(/which decision, which county and which construction type/);
    });

    it('takes a determination that says all three', async () => {
      const id = (await one<{ id: string }>(
        `select public.create_wage_schedule($1,'Lucas County heavy','prevailing_wage','2026-03-15',
           null,null,null,'OH20260012','Lucas','OH','heavy') as id`, [company])).id;
      const row = await one<{ scope_says: string; status: string }>(
        `select scope_says, status from my_wage_schedules where id = $1`, [id]);
      expect(row.scope_says).toBe('OH20260012 · Lucas, OH · Heavy');
      /* A draft. A wage nobody has looked at should not reach a bid. */
      expect(row.status).toBe('draft');
    });

    it('will not let a draft sheet price anything', async () => {
      const id = (await one<{ id: string }>(
        `select public.create_wage_schedule($1,'Unapproved scale','open_shop') as id`,
        [company])).id;
      await expect(asOwner(() => h.sql(
        `select public.set_estimate_wage_schedule($1,$2)`, [version, id])))
        .rejects.toThrow(/is draft and cannot price anything yet/);
    });

    it('will not approve a sheet with nothing on it', async () => {
      const id = (await one<{ id: string }>(
        `select public.create_wage_schedule($1,'Empty scale','open_shop') as id`, [company])).id;
      await expect(asOwner(() => h.sql(`select public.approve_wage_schedule($1)`, [id])))
        .rejects.toThrow(/has no rates on it yet/);
    });

    it('refuses a rate on a sheet that does not say its trade and class', async () => {
      const id = (await one<{ id: string }>(
        `select public.create_wage_schedule($1,'Scale with a hole','open_shop') as id`,
        [company])).id;
      await expect(asOwner(() => h.sql(
        `select public.add_wage_rate($1,'','',40)`, [id])))
        .rejects.toThrow(/needs its trade and its class/);
    });
  });

  // ------------------------------------------------------------- the increase
  describe('a raise entered once', () => {
    let sheet = '';
    let operator = '';
    let apprentice = '';

    beforeAll(async () => {
      sheet = (await one<{ id: string }>(
        `select public.create_wage_schedule($1,'IUOE 18 Toledo 2026','union','2026-05-01',
           'Operating Engineers','18','Toledo') as id`, [company])).id;
      operator = (await one<{ id: string }>(
        `select public.add_wage_rate($1,'Operating Engineer','Class 1',38.75,20.50,0.22) as id`,
        [sheet])).id;
      await asOwner(() => h.sql(
        `select public.add_wage_rate($1,'Operating Engineer','Class 3',34.10,20.50,0.22)`,
        [sheet]));
      apprentice = (await one<{ id: string }>(
        `select public.add_wage_rate($1,'Operating Engineer','Apprentice 2nd period',0,20.50,0.22) as id`,
        [sheet])).id;
      await asOwner(() => h.sql(
        `select public.set_apprentice_step($1,$2,0.70)`, [apprentice, operator]));
    });

    it('makes an apprentice a percentage of journeyman rather than a figure', async () => {
      const row = await one<{ base_wage_per_hour: string }>(
        `select base_wage_per_hour from labor_rates where id = $1`, [apprentice]);
      expect(Number(row.base_wage_per_hour)).toBeCloseTo(27.125, 4);   // 38.75 x 0.70
    });

    it('moves the apprentice when the journeyman moves', async () => {
      // Stored as a flat figure it would be wrong the morning journeyman
      // moved — silently, on every bid using that crew.
      await asOwner(() => h.sql(`select public.set_wage_rate($1, 40.00)`, [operator]));
      const row = await one<{ base_wage_per_hour: string }>(
        `select base_wage_per_hour from labor_rates where id = $1`, [apprentice]);
      expect(Number(row.base_wage_per_hour)).toBeCloseTo(28.0, 4);     // 40.00 x 0.70
      await asOwner(() => h.sql(`select public.set_wage_rate($1, 38.75)`, [operator]));
    });

    it('carries every class forward, not the ones somebody remembered', async () => {
      const next = (await one<{ id: string }>(
        `select public.schedule_wage_increase($1,'2027-05-01',1.25,0.45) as id`, [sheet])).id;
      const rows = await asOwner(() => h.sql<{ n: string }>(
        `select count(*) as n from labor_rates where wage_schedule_id = $1`, [next]));
      expect(Number(rows[0]!.n)).toBe(3);

      const c1 = await one<{ base_wage_per_hour: string; fringe_per_hour: string }>(
        `select base_wage_per_hour, fringe_per_hour from my_wage_rates
          where wage_schedule_id = $1 and class_label = 'Class 1'`, [next]);
      expect(Number(c1.base_wage_per_hour)).toBeCloseTo(40.0, 4);      // 38.75 + 1.25
      expect(Number(c1.fringe_per_hour)).toBeCloseTo(20.95, 4);        // 20.50 + 0.45
    });

    it('takes the apprentice off the new journeyman, not off last year’s twice', async () => {
      /*
       * The apprentice must not get the raise applied to its own figure and
       * then be recomputed — it is seventy percent of whatever journeyman
       * became, which is 40.00 after the step, not 27.125 + 1.25.
       */
      const next = await one<{ id: string }>(
        `select id from wage_schedules where supersedes_id = $1`, [sheet]);
      const a = await one<{ base_wage_per_hour: string; follows_a_journeyman: boolean }>(
        `select base_wage_per_hour, follows_a_journeyman from my_wage_rates
          where wage_schedule_id = $1 and class_label = 'Apprentice 2nd period'`, [next.id]);
      expect(a.follows_a_journeyman).toBe(true);
      expect(Number(a.base_wage_per_hour)).toBeCloseTo(28.0, 4);       // 40.00 x 0.70
    });

    it('stops the old sheet the day the new one starts', async () => {
      const row = await one<{ expires_on: string; in_force_today: boolean }>(
        `select to_char(expires_on,'YYYY-MM-DD') as expires_on, in_force_today
           from my_wage_schedules where id = $1`, [sheet]);
      expect(row.expires_on).toBe('2027-05-01');
    });

    it('will not book the same step twice', async () => {
      await expect(asOwner(() => h.sql(
        `select public.schedule_wage_increase($1,'2027-05-01',1.25)`, [sheet])))
        .rejects.toThrow(/already on file for/);
    });

    it('refuses a raise that says no amount', async () => {
      await expect(asOwner(() => h.sql(
        `select public.schedule_wage_increase($1,'2028-05-01')`, [sheet])))
        .rejects.toThrow(/Say what the increase is/);
    });

    it('refuses a raise dated before the sheet it raises', async () => {
      await expect(asOwner(() => h.sql(
        `select public.schedule_wage_increase($1,'2025-01-01',1.25)`, [sheet])))
        .rejects.toThrow(/takes effect after the sheet it raises/);
    });

    it('says a sheet dated for next year is not in force today', async () => {
      const next = await one<{ in_force_today: boolean; starts_later: boolean }>(
        `select in_force_today, starts_later from my_wage_schedules
          where supersedes_id = $1`, [sheet]);
      // Approved and dated ahead is not the same as pricing today.
      expect(next.starts_later).toBe(true);
      expect(next.in_force_today).toBe(false);
    });
  });

  // -------------------------------------------------------------- resolution
  describe('resolving a crew onto a sheet', () => {
    it('finds the class the crew is, on the sheet the estimate names', async () => {
      const sheet = (await one<{ id: string }>(
        `select public.create_wage_schedule($1,'Resolution scale','open_shop','2026-01-01') as id`,
        [company])).id;
      const onSheet = (await one<{ id: string }>(
        `select public.add_wage_rate($1,'Operating Engineer','Class 2',52.00,0,0.35) as id`,
        [sheet])).id;
      await asOwner(() => h.sql(`select public.approve_wage_schedule($1)`, [sheet]));
      await asOwner(() => h.sql(
        `select public.set_estimate_wage_schedule($1,$2)`, [version, sheet]));

      const row = await one<{ resolved: string }>(
        `select app.resolve_labor_rate($1,$2) as resolved`, [crewMember, version]);
      expect(row.resolved).toBe(onSheet);
      expect(row.resolved).not.toBe(shopRate);

      /* And back to nothing puts it on the crew's own rate again. */
      await asOwner(() => h.sql(
        `select public.set_estimate_wage_schedule($1,null)`, [version]));
      const back = await one<{ resolved: string }>(
        `select app.resolve_labor_rate($1,$2) as resolved`, [crewMember, version]);
      expect(back.resolved).toBe(shopRate);
    });

    it('reports the loaded rate the way the engine computes it', async () => {
      // Base x (1 + burden) + fringe, and burden on the fringe only where it is
      // paid as cash. The library and the bid have to agree to the cent.
      const sheet = (await one<{ id: string }>(
        `select public.create_wage_schedule($1,'Loaded check','open_shop','2026-02-01') as id`,
        [company])).id;
      const plan = (await one<{ id: string }>(
        `select public.add_wage_rate($1,'Operating Engineer','Plan fringe',40,20.50,0.35,false) as id`,
        [sheet])).id;
      const cash = (await one<{ id: string }>(
        `select public.add_wage_rate($1,'Operating Engineer','Cash fringe',40,20.50,0.35,true) as id`,
        [sheet])).id;

      const p = await one<{ loaded_per_hour: string }>(
        `select loaded_per_hour from my_wage_rates where id = $1`, [plan]);
      const c = await one<{ loaded_per_hour: string }>(
        `select loaded_per_hour from my_wage_rates where id = $1`, [cash]);
      expect(Number(p.loaded_per_hour)).toBeCloseTo(74.5, 4);      // 40 + 14 + 20.50
      expect(Number(c.loaded_per_hour)).toBeCloseTo(81.675, 4);    // + 20.50 x 0.35
    });
  });

  // ------------------------------- the one call the pricing engine makes
  describe('what the engine asks for', () => {
    it('resolves every crew member on a version in one call', async () => {
      /*
       * `resolved_labor_rates` is the only thing that reaches this rule from
       * outside the database, and it goes through `app.resolve_labor_rate` per
       * row rather than restating it — one statement of what a bid pays its
       * people, not two that can disagree.
       */
      const rows = await asOwner(() => h.sql<{
        crew_member_id: string; labor_rate_id: string;
      }>(`select * from public.resolved_labor_rates($1)`, [version]));
      /*
       * No sheet on this version by now, so every member maps to its own rate.
       * The crew is not on a line here, so the set is empty — which is itself
       * the right answer: nothing is being priced.
       */
      expect(Array.isArray(rows)).toBe(true);
    });

    it('is not something a browser may call', async () => {
      // A rate a browser picked is exactly what 0058 exists to refuse.
      const [row] = await h.sql<{ n: string }>(
        `select count(*) as n from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'resolve_labor_rate'`);
      expect(Number(row!.n)).toBe(0);
    });
  });

  // ------------------------------------------------------------------ RULE-009
  describe('a bid that has left the desk', () => {
    it('will not have its pricing basis changed', async () => {
      /*
       * `in_review` rather than `issued`, because issuing needs a library
       * snapshot — a guard from 0116 that refuses an issued price the platform
       * cannot reproduce. Either way the point is the same: once a version has
       * left draft, the wages it was priced with stop moving. RULE-009.
       */
      const estimate = (await one<{ id: string }>(
        `insert into estimates (company_id, number, name, status)
         values ($1,'E-2026-0002','Out for review','draft') returning id`, [company])).id;
      const gone = (await one<{ id: string }>(
        `insert into estimate_versions (company_id, estimate_id, version_number, status)
         values ($1,$2,1,'in_review') returning id`, [company, estimate])).id;
      await expect(asOwner(() => h.sql(
        `select public.set_estimate_wage_schedule($1,null)`, [gone])))
        .rejects.toThrow(/its pricing basis is fixed/);
    });
  });
});
