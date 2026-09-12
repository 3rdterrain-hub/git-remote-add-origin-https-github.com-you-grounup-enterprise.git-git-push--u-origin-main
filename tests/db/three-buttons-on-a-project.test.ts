/**
 * Three buttons on a project.
 *
 * `project-detail` was made live in migration 0142 and shipped with three
 * buttons that did nothing: Daily report, Change order, New RFI. The tables
 * behind them have existed since 0006 and 0007 and are fully governed — a
 * submitted daily report freezes its date because it is evidence in a claim, an
 * executed change order refuses edits, an answered RFI must carry its answer —
 * and none of them had a writer. A live job could be read in detail and never
 * actually worked.
 *
 * What these hold down is mostly what the functions refuse. The company is read
 * off the project rather than taken from the caller; the permission is the one
 * 0010 already chose per table; the numbers are generated where they cannot
 * collide; and nothing is created in the state that ends its own workflow.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('three buttons on a project', () => {
  let h: Harness;
  const chief = '11111111-1111-4111-8111-111111111111';
  const rival = '22222222-2222-4222-8222-222222222222';
  const superintendent = '33333333-3333-4333-8333-333333333333';
  let mine = '';
  let theirs = '';
  let project = '';
  let theirProject = '';

  const as = <T,>(who: string, q: string, p?: unknown[]) =>
    h.asUser(who, () => h.sql<T extends object ? T : never>(q, p));
  const asChief = <T,>(q: string, p?: unknown[]) => as<T>(chief, q, p);

  const makeProject = (company: string, number: string, who: string) =>
    h.asUser(who, () => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name, status)
       values ($1,$2,'Berm build','active') returning id`, [company, number]))
      .then(([r]) => r!.id);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, mail] of [
      [chief, 'c@r.test'], [rival, 'r@k.test'], [superintendent, 's@r.test'],
    ] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, mail]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, mail]);
    }
    mine = (await asChief<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`))[0]!.id;
    theirs = (await as<{ id: string }>(rival,
      `select app.provision_company('Kesler','kesler','enterprise') as id`))[0]!.id;

    /* A superintendent holds projects.write and not estimates.write, which is
       exactly the split 0010 chose between a daily report and an RFI. */
    await h.asService(() => h.sql(
      `insert into company_memberships (company_id, user_id, role_id, status)
       select $1, $2, r.id, 'active' from roles r where r.key = 'superintendent'
       on conflict do nothing`, [mine, superintendent]));

    project = await makeProject(mine, 'PRJ-2026-0001', chief);
    theirProject = await makeProject(theirs, 'PRJ-2026-0001', rival);
  }, 240_000);

  afterAll(async () => { await h?.db.close(); });

  describe('a day on site', () => {
    it('starts unsubmitted, because submitting is what freezes it', async () => {
      const [r] = await asChief<{ id: string }>(
        `select app.create_daily_report($1, current_date, 'Stripped topsoil') as id`, [project]);
      const [row] = await asChief<{ submitted_at: string | null; work_performed: string }>(
        `select submitted_at, work_performed from daily_reports where id = $1`, [r!.id]);
      expect(row!.submitted_at).toBeNull();
      expect(row!.work_performed).toBe('Stripped topsoil');
    });

    it('refuses a second report for a day already recorded, by name', async () => {
      await expect(asChief(`select app.create_daily_report($1, current_date)`, [project]))
        .rejects.toThrow(/already a daily report/i);
    });

    it('refuses a day that has not happened', async () => {
      await expect(asChief(
        `select app.create_daily_report($1, current_date + 1)`, [project]))
        .rejects.toThrow(/records a day that has happened/i);
    });

    it('lets a superintendent record one', async () => {
      const [r] = await as<{ id: string }>(superintendent,
        `select app.create_daily_report($1, current_date - 1) as id`, [project]);
      expect(r!.id).toBeTruthy();
    });
  });

  describe('a change to the contract', () => {
    it('starts potential and priced at nothing', async () => {
      /*
       * A change nobody has priced is not yet a claim on anybody, and a cost
       * typed into a dialog is a number nobody can reproduce. It comes from
       * pricing the change.
       */
      const [r] = await asChief<{ id: string }>(
        `select app.create_change_order($1,'Rock excavation','Ledge at 9 ft') as id`, [project]);
      const [row] = await asChief<{
        number: string; status: string; cost_impact: string; price_impact: string;
      }>(`select number, status, cost_impact, price_impact from change_orders where id = $1`,
         [r!.id]);
      expect(row!.number).toBe('CO-001');
      expect(row!.status).toBe('potential');
      expect(Number(row!.cost_impact)).toBe(0);
      expect(Number(row!.price_impact)).toBe(0);
    });

    it('numbers the next one without being told', async () => {
      await asChief(`select app.create_change_order($1,'Extra haul','Owner added fill')`, [project]);
      const rows = await asChief<{ number: string }>(
        `select number from change_orders where project_id = $1 order by number`, [project]);
      expect(rows.map((r) => r.number)).toEqual(['CO-001', 'CO-002']);
    });

    it('numbers per project, so two jobs both start at one', async () => {
      const [r] = await as<{ id: string }>(rival,
        `select app.create_change_order($1,'Theirs','Their reason') as id`, [theirProject]);
      const [row] = await as<{ number: string }>(rival,
        `select number from change_orders where id = $1`, [r!.id]);
      expect(row!.number).toBe('CO-001');
    });

    it('insists on a reason, because it is an argument for money', async () => {
      await expect(asChief(`select app.create_change_order($1,'No reason given','  ')`, [project]))
        .rejects.toThrow(/say why the work changed/i);
    });

    it('insists on a title', async () => {
      await expect(asChief(`select app.create_change_order($1,'','A reason')`, [project]))
        .rejects.toThrow(/needs a title/i);
    });
  });

  describe('a question somebody has to answer', () => {
    it('opens in draft, because issuing one starts a clock', async () => {
      const [r] = await asChief<{ id: string }>(
        `select app.create_rfi($1,'Invert conflict at B4','Which invert governs?') as id`,
        [project]);
      const [row] = await asChief<{ number: string; status: string; submitted_at: string | null }>(
        `select number, status, submitted_at from rfis where id = $1`, [r!.id]);
      expect(row!.number).toBe('RFI-0001');
      expect(row!.status).toBe('draft');
      expect(row!.submitted_at).toBeNull();
    });

    it('numbers per company, not per project', async () => {
      /*
       * `rfis` is unique on (company_id, number) and the same sequence covers
       * RFIs raised against an estimate during a bid — which is what
       * `estimate_version_id` on that table is for.
       */
      const second = await makeProject(mine, 'PRJ-2026-0002', chief);
      const [r] = await asChief<{ id: string }>(
        `select app.create_rfi($1,'Another','A question') as id`, [second]);
      const [row] = await asChief<{ number: string }>(
        `select number from rfis where id = $1`, [r!.id]);
      expect(row!.number).toBe('RFI-0002');
    });

    it('insists on the question', async () => {
      await expect(asChief(`select app.create_rfi($1,'A title','   ')`, [project]))
        .rejects.toThrow(/say what is being asked/i);
    });

    it('refuses a priority that is not one', async () => {
      await expect(asChief(
        `select app.create_rfi($1,'T','Q',null,'urgent')`, [project]))
        .rejects.toThrow(/low, normal, high or critical/i);
    });

    it('refuses a superintendent, who may run the job and not raise an RFI', async () => {
      // 0010 put rfis behind estimates.write; the split is deliberate.
      await expect(as(superintendent, `select app.create_rfi($1,'T','Q')`, [project]))
        .rejects.toThrow(/permission/i);
    });
  });

  describe('whose project it is', () => {
    it('will not write to another company project', async () => {
      await expect(as(rival, `select app.create_daily_report($1)`, [project]))
        .rejects.toThrow(/no such project/i);
    });

    it('says the same thing for a project that does not exist', async () => {
      /*
       * Which of the two it is would tell a stranger whether a project id is
       * real, so both answers are identical.
       */
      await expect(as(rival,
        `select app.create_daily_report('00000000-0000-4000-8000-000000000000')`))
        .rejects.toThrow(/no such project/i);
    });

    it('takes the company from the project rather than the caller', async () => {
      const [row] = await asChief<{ n: string }>(
        `select count(*)::text as n from change_orders
          where project_id = $1 and company_id = $2`, [project, mine]);
      expect(Number(row!.n)).toBeGreaterThan(0);
    });
  });

  describe('the doors a browser uses', () => {
    it('exposes all three to authenticated and to nobody else', async () => {
      const rows = await h.sql<{ proname: string; acl: string }>(
        `select p.proname, coalesce(array_to_string(p.proacl, ','), '') as acl
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('create_daily_report','create_change_order','create_rfi')
          order by p.proname`);
      expect(rows.map((r) => r.proname)).toEqual([
        'create_change_order', 'create_daily_report', 'create_rfi',
      ]);
      for (const r of rows) {
        expect(r.acl).toContain('authenticated=X');
        expect(r.acl).not.toContain('anon=X');
      }
    });
  });
});
