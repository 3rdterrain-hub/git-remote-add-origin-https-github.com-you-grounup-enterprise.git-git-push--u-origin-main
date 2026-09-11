/**
 * Everything the project screen reads, read the way the screen reads it.
 *
 * `project-detail.tsx` showed invented daily reports, invented change orders,
 * invented RFIs and invented submittals under a real project number — the
 * billing-page defect one screen over, and worse in one respect, because a
 * daily report is evidence in a claim.
 *
 * Almost all of it already existed and was already tested in isolation. What
 * was never tested is the joint: that one authenticated member can select these
 * exact column lists, with these exact embeds, and gets their own company's
 * rows and nobody else's. So these tests select what the data layer selects.
 *
 * The earned-value view is new, and the reason it is new is the figure it
 * replaces. The fixture screen showed a cost performance index of
 * (budget x percent complete) / actual cost. The live percent complete in
 * `reporting_wip` is cost-to-cost, so the same formula reduces to actual cost
 * over actual cost and prints 1.00 on every project forever while looking like
 * a measurement. The arithmetic below is the check that this one does not.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const RIVAL = '22222222-2222-4222-8222-222222222222';
const SUPER = '33333333-3333-4333-8333-333333333333';

describe('a project you can open', () => {
  let h: Harness;
  let mine = '';
  let theirs = '';
  let project = '';
  let rivalProject = '';
  let report = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });

    for (const [id, email, name] of [
      [OWNER, 'owner@ridge.test', 'Dale Whitcomb'],
      [RIVAL, 'rival@other.test', 'Someone Else'],
      [SUPER, 'super@ridge.test', 'Marcy Kowalski'],
    ] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h.sql(`insert into user_profiles (id, email, full_name) values ($1,$2,$3)
                   on conflict (id) do update set full_name = excluded.full_name`, [id, email, name]);
    }

    mine = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','professional') as id`)))[0]!.id;
    theirs = (await h.asUser(RIVAL, () => h.sql<{ id: string }>(
      `select app.provision_company('Other Co','other-co','professional') as id`)))[0]!.id;

    await h.sql(
      `insert into company_memberships (company_id, user_id, role_id, status, joined_at)
       select $1, $2, r.id, 'active', now() from roles r
        where r.company_id is null and r.key = 'superintendent' limit 1`, [mine, SUPER]);

    await h.asUser(OWNER, async () => {
      const customer = (await h.sql<{ id: string }>(
        `insert into customers (company_id, code, name)
         values ($1,'CUS-0001','Wood County Engineering') returning id`, [mine]))[0]!.id;

      project = (await h.sql<{ id: string }>(
        `insert into projects (company_id, customer_id, number, name, status, contract_type,
                               contract_value, original_budget, approved_budget,
                               site_address, site_city, site_state,
                               planned_start, planned_finish,
                               project_manager_id, superintendent_id)
         values ($1,$2,'PRJ-2601','Sandusky transfer station','active','unit_price',
                 1250000, 980000, 980000,
                 '1400 Venice Rd','Sandusky','OH',
                 current_date - 30, current_date + 90, $3, $4)
         returning id`, [mine, customer, OWNER, SUPER]))[0]!.id;

      /*
       * Two tasks with different budgets and different progress, so a
       * money-weighted percent complete cannot accidentally equal a
       * task-counted one and pass by coincidence.
       */
      await h.sql(
        `insert into project_tasks (company_id, project_id, name, status,
                                    percent_complete, budgeted_cost, actual_cost,
                                    budgeted_hours, actual_hours)
         values ($1,$2,'Site clearing','complete',    1.0, 100000,  90000, 800, 700),
                ($1,$2,'Structure',     'in_progress',0.25, 300000, 120000, 2400, 900)`,
        [mine, project]);

      report = (await h.sql<{ id: string }>(
        `insert into daily_reports (company_id, project_id, report_date, weather_summary,
                                    temperature_f, precipitation_in, work_performed,
                                    delays, delay_hours, crew_count, submitted_by, submitted_at)
         values ($1,$2,current_date - 1,'Overcast',54,0.00,
                 'Set 240 LF of 12 in. RCP storm from MH-4 to MH-6.',
                 null, 0, 7, $3, now())
         returning id`, [mine, project, OWNER]))[0]!.id;

      await h.sql(
        `insert into daily_report_labor (company_id, daily_report_id, classification,
                                         headcount, straight_hours, overtime_hours)
         values ($1,$2,'Operator',2,8,1), ($1,$2,'Laborer',4,8,0)`, [mine, report]);
      await h.sql(
        `insert into daily_report_equipment (company_id, daily_report_id, description,
                                             units, operating_hours, idle_hours, fuel_gallons)
         values ($1,$2,'CAT 336 excavator',1,7.5,0.5,42)`, [mine, report]);
      await h.sql(
        `insert into production_actuals (company_id, project_id, daily_report_id, work_date,
                                         quantity_installed, unit, crew_hours, crew_size)
         values ($1,$2,$3,current_date - 1, 240, 'LF', 48, 6)`, [mine, project, report]);

      const co = (await h.sql<{ id: string }>(
        `insert into change_orders (company_id, project_id, number, title, reason, origin,
                                    status, cost_impact, price_impact, schedule_impact_days,
                                    submitted_at, decided_at, decided_by, executed_at)
         values ($1,$2,'CO-001','Rock excavation at MH-5',
                 'Differing site condition: limestone ledge at 9 ft, not shown on the borings.',
                 'differing_site_condition','executed', 38000, 46000, 4,
                 now() - interval '10 days', now() - interval '3 days', $3, now() - interval '2 days')
         returning id`, [mine, project, OWNER]))[0]!.id;
      await h.sql(
        `insert into change_order_items (company_id, change_order_id, description,
                                         quantity, unit, unit_price, cost_amount, price_amount)
         values ($1,$2,'Rock excavation, machine',180,'CY',255.55,38000,46000)`, [mine, co]);

      await h.sql(
        `insert into rfis (company_id, project_id, number, title, question, discipline,
                           priority, status, cost_impact, submitted_at, due_at)
         values ($1, $2, 'RFI-001','Invert elevation at MH-6 conflicts with profile',
                 'Plan sheet C-401 shows 612.40; the profile shows 611.90. Which governs?',
                 'Civil','high','open',
                 'Up to 60 LF of storm regrade if the profile governs.',
                 now() - interval '4 days', now() + interval '3 days')`,
        [mine, project]);
    });

    // Something of the rival's, so the isolation checks have a target.
    await h.asUser(RIVAL, async () => {
      rivalProject = (await h.sql<{ id: string }>(
        `insert into projects (company_id, number, name, status, approved_budget)
         values ($1,'PRJ-9999','Not yours','active', 500000) returning id`, [theirs]))[0]!.id;
      await h.sql(
        `insert into project_tasks (company_id, project_id, name, percent_complete,
                                    budgeted_cost, actual_cost)
         values ($1,$2,'Theirs',0.5,500000,250000)`, [theirs, rivalProject]);
    });
  });

  afterAll(async () => { await h?.db.close(); });

  describe('the header', () => {
    it('names the customer and the two people, which no embed could resolve', async () => {
      /*
       * `project_manager_id` points at `auth.users`, which no tenant may read,
       * so PostgREST cannot embed a name through it. This view is the only
       * place those ids become words.
       */
      const [row] = await h.asUser(OWNER, () => h.sql<Record<string, unknown>>(
        `select id, number, name, status, contract_type, contract_value,
                approved_budget, site_address, site_city, site_state, latitude, longitude,
                planned_start, planned_finish, customer_name, project_manager, superintendent,
                source_estimate_number, source_version_number
           from my_project where id = $1`, [project]));
      expect(row).toBeDefined();
      expect(row!.number).toBe('PRJ-2601');
      expect(row!.customer_name).toBe('Wood County Engineering');
      expect(row!.project_manager).toBe('Dale Whitcomb');
      expect(row!.superintendent).toBe('Marcy Kowalski');
      // Not awarded from an estimate, and the view says so rather than guessing.
      expect(row!.source_estimate_number).toBeNull();
    });

    it('shows a member of another company nothing', async () => {
      const rows = await h.asUser(RIVAL, () => h.sql<{ id: string }>(
        `select id from my_project`));
      expect(rows.map((r) => r.id)).not.toContain(project);
    });

    it('shows an anonymous caller nothing at all', async () => {
      await expect(h.asAnon(() => h.sql(`select id from my_project`))).rejects.toThrow();
    });
  });

  describe('what the job has earned', () => {
    it('weights progress by money rather than by task count', async () => {
      /*
       * $100k complete and $300k a quarter done is $175k of $400k — 43.75%.
       * Counting tasks would say 62.5%, and counting them is how ten pipe
       * fittings outvote a lift station.
       */
      const [row] = await h.asUser(OWNER, () => h.sql<Record<string, unknown>>(
        `select tasks, tasks_complete, budgeted_cost, earned_value, percent_complete,
                cost_performance_index, hours_performance_index
           from reporting_project_earned_value where project_id = $1`, [project]));
      expect(Number(row!.tasks)).toBe(2);
      expect(Number(row!.earned_value)).toBe(175000);
      expect(Number(row!.percent_complete)).toBeCloseTo(0.4375, 6);
    });

    it('reports a cost performance index that is not one by construction', async () => {
      /*
       * The whole reason this view exists. $175,000 earned against $210,000
       * spent is 0.8333 — margin leaving the job. The formula the fixture used,
       * fed the live cost-to-cost percent complete, would have printed 1.00.
       */
      const [row] = await h.asUser(OWNER, () => h.sql<{ cost_performance_index: string }>(
        `select cost_performance_index from reporting_project_earned_value where project_id = $1`,
        [project]));
      expect(Number(row!.cost_performance_index)).toBeCloseTo(0.8333, 4);
      expect(Number(row!.cost_performance_index)).not.toBe(1);
    });

    it('answers null, never zero, for a project nobody has broken down', async () => {
      const bare = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
        `insert into projects (company_id, number, name, status)
         values ($1,'PRJ-2602','Not broken down yet','preconstruction') returning id`,
        [mine])))[0]!.id;
      const rows = await h.asUser(OWNER, () => h.sql(
        `select percent_complete from reporting_project_earned_value where project_id = $1`,
        [bare]));
      // No tasks means no row at all — which reads as "not computable" rather
      // than as a project sitting at 0%.
      expect(rows).toHaveLength(0);
    });

    it('keeps one company out of another company’s earned value', async () => {
      const rows = await h.asUser(OWNER, () => h.sql<{ project_id: string }>(
        `select project_id from reporting_project_earned_value`));
      expect(rows.map((r) => r.project_id)).not.toContain(rivalProject);
    });
  });

  describe('the tabs, read the way the screen reads them', () => {
    it('reads a daily report with its labor, equipment and production', async () => {
      const [row] = await h.asUser(OWNER, () => h.sql<Record<string, unknown>>(
        `select r.id, r.report_date, r.weather_summary, r.temperature_f, r.precipitation_in,
                r.work_performed, r.delays, r.delay_hours, r.visitors, r.safety_notes,
                r.crew_count, r.submitted_at,
                (select count(*) from daily_report_labor l where l.daily_report_id = r.id) as labor_rows,
                (select count(*) from daily_report_equipment e where e.daily_report_id = r.id) as equipment_rows,
                (select count(*) from production_actuals p where p.daily_report_id = r.id) as production_rows
           from daily_reports r where r.project_id = $1`, [project]));
      expect(row!.crew_count).toBe(7);
      expect(Number(row!.labor_rows)).toBe(2);
      expect(Number(row!.equipment_rows)).toBe(1);
      expect(Number(row!.production_rows)).toBe(1);
    });

    it('computes an achieved rate the database generated, not the screen', async () => {
      // 240 LF over 48 crew-hours is 5 LF an hour, and the column is generated,
      // so a screen cannot show a rate that disagrees with its own inputs.
      const [row] = await h.asUser(OWNER, () => h.sql<{ actual_per_hour: string }>(
        `select actual_per_hour from production_actuals where project_id = $1`, [project]));
      expect(Number(row!.actual_per_hour)).toBeCloseTo(5, 6);
    });

    it('reads a change order with the items that price it', async () => {
      const [row] = await h.asUser(OWNER, () => h.sql<Record<string, unknown>>(
        `select c.id, c.number, c.title, c.reason, c.origin, c.status, c.cost_impact,
                c.price_impact, c.schedule_impact_days, c.submitted_at, c.decided_at,
                (select count(*) from change_order_items i where i.change_order_id = c.id) as items
           from change_orders c where c.project_id = $1`, [project]));
      expect(row!.number).toBe('CO-001');
      expect(Number(row!.price_impact)).toBe(46000);
      expect(Number(row!.items)).toBe(1);
    });

    it('counts an executed change order into the revised contract value', async () => {
      const [row] = await h.asUser(OWNER, () => h.sql<Record<string, unknown>>(
        `select contract_value, approved_change_orders, revised_contract_value
           from reporting_project_financials where project_id = $1`, [project]));
      expect(Number(row!.approved_change_orders)).toBe(46000);
      expect(Number(row!.revised_contract_value)).toBe(1296000);
    });

    it('reads the RFIs and submittals the screen lists', async () => {
      const rfis = await h.asUser(OWNER, () => h.sql<Record<string, unknown>>(
        `select id, number, title, discipline, priority, status, due_at, cost_impact
           from rfis where project_id = $1`, [project]));
      expect(rfis).toHaveLength(1);
      expect(rfis[0]!.priority).toBe('high');

      const submittals = await h.asUser(OWNER, () => h.sql(
        `select id, number, title, spec_section, ball_in_court, status, revision,
                required_on_site, lead_time_days, reviewer_comment
           from submittals where project_id = $1`, [project]));
      expect(submittals).toHaveLength(0);
    });

    it('shows a rival nothing of this project’s field record', async () => {
      const rows = await h.asUser(RIVAL, () => h.sql<{ id: string }>(
        `select id from daily_reports where project_id = $1`, [project]));
      expect(rows).toHaveLength(0);
    });
  });
});
