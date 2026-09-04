/**
 * Metric governance, against real PostgreSQL.
 *
 * The semantic layer ships 16 governed metric definitions, each with a SQL
 * expression describing its calculation. Three things were wrong with it: a
 * read permission gated writes to a column holding SQL text, the expression
 * could be edited under numbers already reported, and no metric named where
 * its number came from — so a definition and the figure beside it could
 * disagree and nothing would notice.
 *
 * The most important test here is the last one: every platform expression is
 * run against the view it names. That is the check that turns a description
 * into something the schema cannot drift away from.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('metric governance', () => {
  let h: Harness;
  const admin = '11111111-1111-4111-8111-111111111111';
  const reader = '22222222-2222-4222-8222-222222222222';
  let company = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'a@r.test'), ($2,'r@r.test')`,
      [admin, reader]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'a@r.test'), ($2,'r@r.test') on conflict (id) do nothing`,
      [admin, reader]);
    company = (await h.asUser(admin, () =>
      h.sql<{ id: string }>(`select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;

    // An estimator: holds reports.read, does not hold company.manage.
    const [role] = await h.sql<{ id: string }>(
      `insert into roles (company_id, key, name, description, permissions, approval_tier)
       values ($1,'analyst','Analyst','Reads reports.',array['reports.read','projects.read'],1)
       returning id`, [company]);
    await h.sql(
      `insert into company_memberships (company_id, user_id, role_id, status, joined_at)
       values ($1,$2,$3,'active',now())`, [company, reader, role!.id]);
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  const define = (user: string, key: string, expression = 'count(*)') =>
    h.asUser(user, () => h.sql<{ id: string }>(
      `insert into metric_definitions (company_id, key, name, description, domain, unit,
         expression, grain)
       values ($1,$2,'Custom','A company metric.','financial','number',$3,'company')
       returning id`, [company, key, expression]));

  describe('a read permission may not gate a write', () => {
    it('refuses a definition from somebody who only reads reports', async () => {
      // The expression column is SQL text. Nothing executes it today, and
      // "safe because nothing reads it yet" is not a control.
      await expect(define(reader, 'sneaky', "count(*) from pg_shadow"))
        .rejects.toThrow(/row-level security/);
    });

    it('accepts one from an administrator', async () => {
      const rows = await define(admin, 'custom_margin');
      expect(rows[0]!.id).toBeTruthy();
    });

    it('refuses an edit from the reader too', async () => {
      const rows = await h.asUser(reader, () => h.sql(
        `update metric_definitions set expression='count(*)' where key='custom_margin'
         returning id`));
      // RLS filters the row out rather than raising, so the update matches none.
      expect(rows).toEqual([]);
    });

    it('never lets anybody write a platform metric', async () => {
      const rows = await h.asUser(admin, () => h.sql(
        `update metric_definitions set expression='0' where company_id is null and key='trir'
         returning id`));
      expect(rows).toEqual([]);
    });
  });

  describe('a definition cannot move under the numbers it produced', () => {
    it('publishes version 1 for every seeded metric', async () => {
      const rows = await h.sql<{ key: string }>(
        `select m.key from metric_definitions m
         where m.company_id is null
           and not exists (select 1 from metric_definition_versions v
                           where v.metric_id = m.id and v.version = 1)`);
      expect(rows.map((r) => r.key)).toEqual([]);
    });

    it('keeps the definition that could not be computed rather than editing it out', async () => {
      // 0041 corrected TRIR and DART. Version 1 is what the platform said
      // before that, and the history is worth nothing if it is rewritten.
      const rows = await h.sql<{ version: number; expression: string }>(
        `select v.version, v.expression from metric_definition_versions v
         join metric_definitions m on m.id = v.metric_id
         where m.company_id is null and m.key = 'trir' order by v.version`);
      expect(rows).toHaveLength(2);
      expect(rows[0]!.expression).toContain('total_hours');
      expect(rows[1]!.expression).toContain('hours_worked');
    });

    it('publishes a new version when the calculation changes', async () => {
      const [m] = await h.sql<{ id: string }>(
        `select id from metric_definitions where key='custom_margin' and company_id=$1`, [company]);
      await h.asUser(admin, () => h.sql(
        `update metric_definitions set expression='sum(amount)' where id=$1`, [m!.id]));
      const rows = await h.sql<{ version: number; expression: string }>(
        `select version, expression from metric_definition_versions where metric_id=$1 order by version`,
        [m!.id]);
      expect(rows).toHaveLength(2);
      expect(rows[0]!.expression).toBe('count(*)');
      expect(rows[1]!.expression).toBe('sum(amount)');
    });

    it('publishes nothing when only the name or target changes', async () => {
      // Renaming a metric does not change what any past number meant.
      const [m] = await h.sql<{ id: string }>(
        `select id from metric_definitions where key='custom_margin' and company_id=$1`, [company]);
      const before = await h.sql(`select 1 from metric_definition_versions where metric_id=$1`, [m!.id]);
      await h.asUser(admin, () => h.sql(
        `update metric_definitions set name='Renamed', target_value=42 where id=$1`, [m!.id]));
      const after = await h.sql(`select 1 from metric_definition_versions where metric_id=$1`, [m!.id]);
      expect(after.length).toBe(before.length);
    });

    it('cannot rewrite a published version', async () => {
      await expect(h.sql(
        `update metric_definition_versions set expression='0' where version=1 and company_id is null`))
        .rejects.toThrow(/append-only/);
    });

    it('derives the current version rather than flagging it', async () => {
      const [m] = await h.sql<{ id: string }>(
        `select id from metric_definitions where key='custom_margin' and company_id=$1`, [company]);
      const [cur] = await h.sql<{ version: number }>(
        `select version from metric_definition_versions where id = app.current_metric_version($1)`,
        [m!.id]);
      expect(Number(cur!.version)).toBe(2);
    });
  });

  describe('a metric names where its number comes from', () => {
    it('gives every platform metric a source view', async () => {
      const rows = await h.sql<{ key: string }>(
        `select key from metric_definitions where company_id is null and source_view is null`);
      expect(rows.map((r) => r.key)).toEqual([]);
    });

    it('names only real reporting views', async () => {
      const rows = await h.sql<{ key: string; source_view: string }>(
        `select m.key, m.source_view from metric_definitions m
         where m.company_id is null
           and not exists (
             select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
             where n.nspname='public' and c.relname = m.source_view and c.relkind='v')`);
      expect(rows).toEqual([]);
    });

    /*
     * The test that turns a description into a guarantee.
     *
     * Every platform expression is executed against the view it names. A
     * definition that references a column the view no longer has fails here
     * rather than being quietly wrong in a report.
     *
     * Safe to execute because these expressions come from the platform's own
     * migration, never from a tenant — which is exactly why the write policy
     * above had to be narrowed first.
     */
    it('runs every platform expression against the view it names', async () => {
      const metrics = await h.sql<{ key: string; expression: string; source_view: string }>(
        `select key, expression, source_view from metric_definitions
         where company_id is null order by key`);
      expect(metrics.length).toBe(16);

      const broken: string[] = [];
      for (const m of metrics) {
        try {
          await h.sql(`select ${m.expression} from ${m.source_view} where false`);
        } catch (e) {
          broken.push(`${m.key}: ${(e as Error).message}`);
        }
      }
      expect(broken).toEqual([]);
    });
  });

  /*
   * The rates themselves.
   *
   * TRIR and DART are what a general contractor is prequalified on and what an
   * insurer rates. Proving the expression parses is not enough — these check
   * the number.
   */
  describe('TRIR and DART', () => {
    let project = '';
    let employee = '';

    const rate = (key: string) =>
      h.sql<{ value: string | null }>(
        `select (select expression from metric_definitions
                 where company_id is null and key = $1) as e`, [key])
        .then(([r]) => h.sql<{ value: string | null }>(
          `select ${(r as unknown as { e: string }).e} as value
           from reporting_safety_rates where company_id = $1`, [company]))
        .then(([r]) => (r!.value === null ? null : Number(r!.value)));

    beforeAll(async () => {
      await h.asUser(admin, async () => {
        [{ id: project }] = await h.sql<{ id: string }>(
          `insert into projects (company_id, number, name, status)
           values ($1,'S-1','Safety','active') returning id`, [company]);
        [{ id: employee }] = await h.sql<{ id: string }>(
          `insert into employees (company_id, employee_number, first_name, last_name)
           values ($1,'E-1','Dana','Ruiz') returning id`, [company]);
        // 200,000 approved hours: the OSHA basis exactly, so a rate reads as
        // the case count and any arithmetic error is visible by eye.
        for (let i = 0; i < 25; i++) {
          await h.sql(
            `insert into time_entries (company_id, employee_id, project_id, work_date,
               straight_hours, approval_state, approved_by, approved_at)
             select $1,$2,$3,'2026-03-02'::date, 8, 'approved', $4, now()
             from generate_series(1,1000)`, [company, employee, project, admin]);
        }
      });
    }, 120_000);

    it('reports zero, not nothing, for a month worked without an incident', async () => {
      // An inner join would have dropped this month entirely and reported the
      // company's rate as though its safe months never happened.
      expect(await rate('trir')).toBe(0);
      expect(await rate('dart_rate')).toBe(0);
    });

    it('computes TRIR from recordables over the 200,000-hour basis', async () => {
      await h.asUser(admin, () => h.sql(
        `insert into safety_incidents (company_id, project_id, number, occurred_at,
           incident_type, description, is_osha_recordable, osha_case_number)
         values ($1,$2,'I-1','2026-03-10','medical_treatment','Laceration.',true,'C-1')`,
        [company, project]));
      // One recordable over exactly 200,000 hours is a TRIR of 1.00.
      expect(await rate('trir')).toBeCloseTo(1, 6);
    });

    it('counts a DART case once however many days it cost', async () => {
      // The defect this replaced added days_restricted — a day count — into a
      // numerator that counts cases. Sixty days would have read as sixty.
      await h.asUser(admin, () => h.sql(
        `insert into safety_incidents (company_id, project_id, number, occurred_at,
           incident_type, description, is_osha_recordable, osha_case_number,
           days_restricted)
         values ($1,$2,'I-2','2026-03-11','restricted_duty','Back strain.',true,'C-2',60)`,
        [company, project]));
      expect(await rate('dart_rate')).toBeCloseTo(1, 6);
      expect(await rate('trir')).toBeCloseTo(2, 6);
    });

    it('leaves a recordable with no days out of DART and in TRIR', async () => {
      await h.asUser(admin, () => h.sql(
        `insert into safety_incidents (company_id, project_id, number, occurred_at,
           incident_type, description, is_osha_recordable, osha_case_number)
         values ($1,$2,'I-3','2026-03-12','medical_treatment','Stitches, full duty.',true,'C-3')`,
        [company, project]));
      expect(await rate('dart_rate')).toBeCloseTo(1, 6);
      expect(await rate('trir')).toBeCloseTo(3, 6);
    });

    it('ignores an incident that is not OSHA recordable', async () => {
      await h.asUser(admin, () => h.sql(
        `insert into safety_incidents (company_id, project_id, number, occurred_at,
           incident_type, description, days_away)
         values ($1,$2,'I-4','2026-03-13','first_aid','Splinter.',0)`,
        [company, project]));
      expect(await rate('trir')).toBeCloseTo(3, 6);
      expect(await rate('dart_rate')).toBeCloseTo(1, 6);
    });

    it('gives no rate for a month with an incident and no approved hours', async () => {
      // A timekeeping gap, not a rate. Dividing by zero here would publish an
      // infinite TRIR off one unapproved timesheet.
      await h.asUser(admin, () => h.sql(
        `insert into safety_incidents (company_id, project_id, number, occurred_at,
           incident_type, description, is_osha_recordable, osha_case_number)
         values ($1,$2,'I-5','2026-06-01','lost_time','Fall.',true,'C-5')`,
        [company, project]));
      const [row] = await h.sql<{ hours_worked: string; recordables: string }>(
        `select hours_worked, recordables from reporting_safety_rates
         where company_id = $1 and month_of = '2026-06-01'`, [company]);
      expect(Number(row!.hours_worked)).toBe(0);
      expect(Number(row!.recordables)).toBe(1);
    });

    it('excludes unapproved hours from the denominator', async () => {
      // A safety rate that moves when somebody edits a timesheet is not a rate.
      // Measured against the rate immediately before, so this asserts the
      // exclusion rather than a constant that earlier cases have to preserve.
      const before = await rate('trir');
      await h.asUser(admin, () => h.sql(
        `insert into time_entries (company_id, employee_id, project_id, work_date,
           straight_hours, approval_state)
         select $1,$2,$3,'2026-03-02'::date, 8, 'pending' from generate_series(1,1000)`,
        [company, employee, project]));
      // 8,000 pending hours. Counted, they would pull the rate down by 4%.
      expect(await rate('trir')).toBeCloseTo(before!, 6);
    });

    it('shows a company only its own rates', async () => {
      const rows = await h.asUser(reader, () => h.sql(
        `select company_id from reporting_safety_rates`));
      expect(rows.every((r) => (r as { company_id: string }).company_id === company)).toBe(true);
    });
  });

  /*
   * The API route summary said "Evaluate a governed metric" and the handler
   * returned the expression as text. These prove the promise is now kept, and
   * that keeping it did not open the door 0040 deliberately closed.
   */
  describe('evaluation', () => {
    it('returns a number for a platform metric', async () => {
      // Four recordables over the 200,000-hour basis: three in March and the
      // June case the timekeeping-gap test added.
      const [row] = await h.asUser(admin, () => h.sql<{ value: string | null }>(
        `select app.evaluate_metric('trir', $1) as value`, [company]));
      expect(Number(row!.value)).toBeCloseTo(4, 6);
    });

    it('agrees with the view a screen would read', async () => {
      const [row] = await h.asUser(admin, () => h.sql<{ value: string | null }>(
        `select value from reporting_metric_values
         where company_id = $1 and key = 'trir'`, [company]));
      expect(Number(row!.value)).toBeCloseTo(4, 6);
    });

    it('refuses a metric the platform did not author', async () => {
      // The whole reason 0040 did not build an evaluator. A company may define
      // a metric; the platform still will not run its SQL.
      await h.asUser(admin, () => h.sql(
        `insert into metric_definitions (company_id, key, name, description, domain,
           unit, expression, grain)
         values ($1,'trir','Our TRIR','Company definition.','safety','ratio',
                 'count(*)','company')`, [company]));
      await expect(h.asUser(admin, () => h.sql(
        `select app.evaluate_metric('trir', $1)`, [company])))
        .rejects.toThrow(/overridden by a company definition/);
    });

    it('omits an overridden metric from the view rather than answering wrongly', async () => {
      const rows = await h.asUser(admin, () => h.sql(
        `select key from reporting_metric_values where company_id = $1 and key = 'trir'`,
        [company]));
      expect(rows).toEqual([]);
      // Every other metric still answers.
      const rest = await h.asUser(admin, () => h.sql(
        `select key from reporting_metric_values where company_id = $1`, [company]));
      expect(rest.length).toBe(15);
      // Retired rather than deleted, and the platform metric comes back.
      await h.asUser(admin, () => h.sql(
        `update metric_definitions set is_active = false
         where company_id = $1 and key = 'trir'`, [company]));
      const back = await h.asUser(admin, () => h.sql(
        `select key from reporting_metric_values where company_id = $1 and key = 'trir'`,
        [company]));
      expect(back).toHaveLength(1);
    });

    it('refuses to delete a metric a number was reported under', async () => {
      // 0040 left a delete policy over an append-only history, so a delete
      // failed deep in a cascade with an error about a table the caller never
      // named. Refused deliberately now, at both layers.

      // No authenticated caller holds a delete policy any more, so the row is
      // simply not theirs to remove and nothing is deleted.
      const removed = await h.asUser(admin, () => h.sql(
        `delete from metric_definitions where company_id = $1 and key = 'custom_margin'
         returning id`, [company]));
      expect(removed).toEqual([]);

      // And a privileged path that bypasses row level security is refused by
      // the trigger, with the alternative named in the message.
      await expect(h.sql(
        `delete from metric_definitions where company_id = $1 and key = 'custom_margin'`,
        [company])).rejects.toThrow(/cannot be deleted.*is_active = false/s);
    });

    it('refuses a metric that does not exist', async () => {
      await expect(h.asUser(admin, () => h.sql(
        `select app.evaluate_metric('no_such_metric', $1)`, [company])))
        .rejects.toThrow(/No active platform metric/);
    });

    it('refuses an inactive metric', async () => {
      await h.sql(`update metric_definitions set is_active = false
                   where company_id is null and key = 'backlog_value'`);
      await expect(h.asUser(admin, () => h.sql(
        `select app.evaluate_metric('backlog_value', $1)`, [company])))
        .rejects.toThrow(/No active platform metric/);
      await h.sql(`update metric_definitions set is_active = true
                   where company_id is null and key = 'backlog_value'`);
    });

    it('evaluates every platform metric without error', async () => {
      // The lineage test proves each expression parses against its view; this
      // proves each one returns through the evaluator, filter and cast
      // included.
      const keys = await h.sql<{ key: string }>(
        `select key from metric_definitions where company_id is null order by key`);
      const broken: string[] = [];
      for (const { key } of keys) {
        try {
          await h.asUser(admin, () => h.sql(`select app.evaluate_metric($1, $2)`, [key, company]));
        } catch (e) { broken.push(`${key}: ${(e as Error).message}`); }
      }
      expect(broken).toEqual([]);
    });

    it('answers for the company it is asked about, not the caller', async () => {
      // The gateway runs as the service role with row level security bypassed,
      // so the company filter is the only thing standing between two tenants.
      const [other] = await h.asUser(admin, () => h.sql<{ id: string }>(
        `select app.provision_company('Other','other-co','starter') as id`));
      const [row] = await h.sql<{ value: string | null }>(
        `select app.evaluate_metric('trir', $1) as value`, [other!.id]);
      expect(row!.value).toBeNull();
    });

    it('shows a member only their own company in the values view', async () => {
      const rows = await h.asUser(reader, () => h.sql<{ company_id: string }>(
        `select distinct company_id from reporting_metric_values`));
      expect(rows.map((r) => r.company_id)).toEqual([company]);
    });
  });

  describe('tenancy', () => {
    it('shows a company its own metric history and the platform default', async () => {
      const rows = await h.asUser(admin, () => h.sql<{ company_id: string | null }>(
        `select distinct company_id from metric_definition_versions`));
      const ids = rows.map((r) => r.company_id);
      expect(ids).toContain(null);
      expect(ids.every((id) => id === null || id === company)).toBe(true);
    });

    it('shows an anonymous caller nothing', async () => {
      await expect(h.asAnon(() => h.sql(`select id from metric_definition_versions limit 1`)))
        .rejects.toThrow();
    });
  });
});
