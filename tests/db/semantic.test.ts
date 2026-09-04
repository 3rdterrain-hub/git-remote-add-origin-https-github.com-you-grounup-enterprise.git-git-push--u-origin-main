import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * The semantic layer.
 *
 * Reporting views are the classic way a well-isolated system springs a leak: a
 * view runs as its owner by default, which bypasses RLS on every table
 * underneath it. These tests assert the isolation directly, and then check that
 * the arithmetic matches what the view's own comments promise — a comment that
 * describes behavior the code does not have is worse than no comment.
 */
describe('semantic layer', () => {
  let h: Harness;
  const alice = '11111111-1111-4111-8111-111111111111';
  const bob = '22222222-2222-4222-8222-222222222222';
  let ridgeline = '';
  let kesler = '';
  let project = '';
  let keslerProject = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'a@r.test'), ($2,'b@k.test')`, [alice, bob]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'a@r.test'), ($2,'b@k.test')`, [alice, bob]);
    ridgeline = (await h.asUser(alice, () =>
      h.sql<{ id: string }>(`select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
    kesler = (await h.asUser(bob, () =>
      h.sql<{ id: string }>(`select app.provision_company('Kesler','kesler','enterprise') as id`)))[0]!.id;

    await h.asUser(alice, async () => {
      project = (await h.sql<{ id: string }>(
        `insert into projects (company_id, number, name, status, contract_value, approved_budget, retainage_percent)
         values ($1,'PRJ-100','Logistics Park','active',1000000,850000,0.05) returning id`,
        [ridgeline]))[0]!.id;

      // An executed change order and one still only approved. Only the
      // executed one is contract value.
      await h.sql(
        `insert into change_orders (company_id, project_id, number, title, reason, origin, status,
                                    cost_impact, price_impact, decided_at, executed_at)
         values ($1,$2,1,'Undercut at MH-4','Differing site condition','differing_site_condition','executed',
                 40000,50000, now(), now()),
                ($1,$2,2,'Added light bases','Owner request','owner_request','approved',
                 8000,10000, now(), null)`,
        [ridgeline, project]);

      // Costs across every bucket the view rolls up.
      await h.sql(
        `insert into project_costs (company_id, project_id, cost_date, cost_type, amount, is_committed)
         values ($1,$2,'2026-08-01','labor',        100000,false),
                ($1,$2,'2026-08-01','labor_burden',  38000,false),
                ($1,$2,'2026-08-01','equipment',     60000,false),
                ($1,$2,'2026-08-01','fuel',          12000,false),
                ($1,$2,'2026-08-01','material',      90000,false),
                ($1,$2,'2026-08-01','subcontract',   70000,false),
                ($1,$2,'2026-08-01','trucking',      25000,false),
                ($1,$2,'2026-08-01','disposal',       5000,false),
                ($1,$2,'2026-08-15','material',     150000,true)`,
        [ridgeline, project]);

      // Two cumulative pay applications. This is the case the view exists for.
      await h.sql(
        `insert into pay_applications (company_id, project_id, application_number, period_start, period_end,
                                       contract_sum, approved_changes,
                                       completed_to_date, stored_materials, retainage_percent, retainage_to_date,
                                       status, submitted_at, approved_at)
         values ($1,$2,1,'2026-07-01','2026-07-31',1000000,50000,200000,0,0.05,10000,'approved', now(), now()),
                ($1,$2,2,'2026-08-01','2026-08-31',1000000,50000,480000,20000,0.05,25000,'approved', now(), now())`,
        [ridgeline, project]);
    });

    await h.asUser(bob, async () => {
      keslerProject = (await h.sql<{ id: string }>(
        `insert into projects (company_id, number, name, status, contract_value)
         values ($1,'K-1','Kesler job','active',500000) returning id`, [kesler]))[0]!.id;
    });
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  // ---------------------------------------------------------------- isolation
  describe('reporting views cannot become an RLS bypass', () => {
    it('declares security_invoker on every reporting view', async () => {
      const rows = await h.sql<{ relname: string; reloptions: string[] | null }>(`
        select c.relname, c.reloptions
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'v' and c.relname like 'reporting_%'
        order by c.relname`);
      expect(rows.length).toBeGreaterThanOrEqual(4);
      for (const r of rows) {
        // Without this the view runs as its owner and reads past RLS on every
        // base table — the single most dangerous default in the whole schema.
        expect(r.reloptions ?? [], `${r.relname} must run as the invoker`)
          .toContain('security_invoker=true');
      }
    });

    it('grants no reporting view to anon', async () => {
      const rows = await h.sql(`
        select table_name, privilege_type
        from information_schema.role_table_grants
        where grantee = 'anon' and table_name like 'reporting_%'`);
      expect(rows).toEqual([]);
    });

    it('shows a member only the projects of their own company', async () => {
      const mine = await h.asUser(alice, () =>
        h.sql<{ company_id: string }>(`select company_id from reporting_project_financials`));
      expect(mine.length).toBeGreaterThan(0);
      for (const r of mine) expect(r.company_id).toBe(ridgeline);
    });

    it('does not leak one company financials into another view read', async () => {
      const theirs = await h.asUser(bob, () =>
        h.sql<{ project_id: string }>(`select project_id from reporting_project_financials`));
      expect(theirs.map((r) => r.project_id)).toEqual([keslerProject]);
    });

    it('returns nothing to an anonymous caller', async () => {
      await expect(h.asAnon(() => h.sql(`select * from reporting_project_financials`)))
        .rejects.toThrow();
    });
  });

  // ------------------------------------------------------------- the maths
  describe('project financials compute what the comments claim', () => {
    const read = () => h.asUser(alice, () =>
      h.sql<Record<string, string>>(
        `select * from reporting_project_financials where project_id = $1`, [project]));

    it('counts executed change orders and not merely approved ones', async () => {
      const r = (await read())[0]!;
      // 50,000 executed; the 10,000 that is only approved is not contract value.
      expect(Number(r.approved_change_orders)).toBe(50000);
      expect(Number(r.revised_contract_value)).toBe(1050000);
    });

    it('takes billed-to-date from the latest application, never a sum', async () => {
      const r = (await read())[0]!;
      // Applications are cumulative: 200,000 then 500,000. Summing them gives
      // 700,000 and would report the project as 67% billed when it is 48%.
      expect(Number(r.billed_to_date)).toBe(500000);
      expect(Number(r.retainage_held)).toBe(25000);
    });

    it('puts burden with labor and fuel with equipment', async () => {
      const r = (await read())[0]!;
      // Reporting burden separately makes labor look cheaper than it is, which
      // is how a crew that is losing money looks fine on a dashboard.
      expect(Number(r.labor_cost)).toBe(138000);
      expect(Number(r.equipment_cost)).toBe(72000);
      expect(Number(r.subcontract_cost)).toBe(100000);
    });

    it('separates committed cost from incurred cost', async () => {
      const r = (await read())[0]!;
      expect(Number(r.actual_cost)).toBe(400000);
      expect(Number(r.committed_cost)).toBe(150000);
    });

    it('measures margin against the revised contract, not the original', async () => {
      const r = (await read())[0]!;
      // 1,050,000 - 400,000. Against the original 1,000,000 it would read
      // 600,000 and punish the project for work that was never in its scope.
      expect(Number(r.gross_profit_to_date)).toBe(650000);
    });

    it('reports a project with no costs at zero rather than null', async () => {
      const r = (await h.asUser(bob, () =>
        h.sql<Record<string, string>>(
          `select * from reporting_project_financials where project_id = $1`, [keslerProject])))[0]!;
      expect(Number(r.actual_cost)).toBe(0);
      expect(Number(r.billed_to_date)).toBe(0);
    });
  });

  // --------------------------------------------------------------- metrics
  describe('metric definitions are governed, not ad hoc', () => {
    it('seeds the global metrics with no owning company', async () => {
      const rows = await h.sql<{ n: number }>(
        `select count(*)::int as n from metric_definitions where company_id is null`);
      expect(rows[0]!.n).toBeGreaterThanOrEqual(16);
    });

    it('gives every metric a description someone can act on', async () => {
      const rows = await h.sql(`
        select key from metric_definitions
        where company_id is null and (description is null or length(description) < 40)`);
      expect(rows).toEqual([]);
    });

    it('states the 200,000-hour basis inside the safety rate definitions', async () => {
      const rows = await h.sql<{ description: string; expression: string }>(
        `select description, expression from metric_definitions
         where company_id is null and key in ('trir','dart_rate')`);
      expect(rows).toHaveLength(2);
      for (const r of rows) {
        expect(r.expression).toContain('200000');
        // The constant is an OSHA convention, not arithmetic anyone can
        // re-derive; a metric that hides it is a metric nobody can check.
        expect(r.description).toMatch(/200,000/);
      }
    });

    it('lets a company override a global metric without touching the global one', async () => {
      await h.asUser(alice, () => h.sql(`
        insert into metric_definitions (company_id, key, name, description, domain, unit, expression, grain)
        values ($1,'trir','TRIR (contract basis)',
                'This owner requires TRIR on a 100,000-hour basis rather than the OSHA 200,000-hour convention.',
                'safety','ratio',
                'case when sum(total_hours) > 0 then sum(recordables) * 100000.0 / sum(total_hours) end',
                'company')`, [ridgeline]));
      const rows = await h.sql<{ company_id: string | null; expression: string }>(
        `select company_id, expression from metric_definitions where key = 'trir'
         order by company_id nulls first`);
      expect(rows).toHaveLength(2);
      expect(rows[0]!.company_id).toBeNull();
      expect(rows[0]!.expression).toContain('200000');
      expect(rows[1]!.expression).toContain('100000');
    });

    it('refuses a second global definition of the same metric', async () => {
      await expect(h.sql(`
        insert into metric_definitions (company_id, key, name, description, domain, unit, expression, grain)
        values (null,'trir','Duplicate','A second global definition of the same key must not be possible.',
                'safety','ratio','sum(1)','company')`)).rejects.toThrow();
    });

    it('refuses a metric key that is not a stable identifier', async () => {
      // Keys are referenced by API callers and dashboards; a key with spaces
      // or punctuation cannot survive being put in a URL.
      await expect(h.sql(`
        insert into metric_definitions (company_id, key, name, description, domain, unit, expression, grain)
        values (null,'Gross Margin %','Bad key','A metric key is referenced by API callers and must be stable.',
                'financial','percent','sum(1)','company')`)).rejects.toThrow();
    });

    it('cannot read another company metric overrides', async () => {
      const rows = await h.asUser(bob, () => h.sql<{ key: string }>(
        `select key from metric_definitions where company_id is not null`));
      expect(rows).toEqual([]);
    });
  });
});
