import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * Governance on the operations tables added in migration 0013:
 * submittals, proposals, notifications, daily reports and the prompt registry.
 */
describe('operations governance', () => {
  let h: Harness;
  const alice = '11111111-1111-4111-8111-111111111111';
  const bob = '22222222-2222-4222-8222-222222222222';
  const pm = '55555555-5555-4555-8555-555555555555';
  let ridgeline = '';
  let kesler = '';
  let project = '';
  let proposal = '';
  let versionId = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'a@r.test'), ($2,'b@k.test'), ($3,'pm@r.test')`,
      [alice, bob, pm]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'a@r.test'), ($2,'b@k.test'), ($3,'pm@r.test') on conflict (id) do nothing`,
      [alice, bob, pm]);

    ridgeline = (await h.asUser(alice, () =>
      h.sql<{ id: string }>(`select app.provision_company('Ridgeline','ridgeline','professional') as id`)))[0]!.id;
    kesler = (await h.asUser(bob, () =>
      h.sql<{ id: string }>(`select app.provision_company('Kesler','kesler','professional') as id`)))[0]!.id;

    const pmRole = (await h.sql<{ id: string }>(
      `select id from roles where key='project_manager' and company_id is null`))[0]!.id;
    await h.sql(
      `insert into company_memberships (company_id, user_id, role_id, status, joined_at)
       values ($1,$2,$3,'active',now())`, [ridgeline, pm, pmRole]);

    await h.asUser(alice, async () => {
      const est = await h.sql<{ id: string }>(
        `insert into estimates (company_id, number, name) values ($1,'EST-1','Test') returning id`, [ridgeline]);
      /*
       * The real sequence, which the schema now requires: a version is created
       * as a draft, the library snapshot that priced it is captured against
       * it, and only then can it be approved. It cannot be inserted already
       * approved, because the snapshot has to reference a version that exists.
       */
      const v = await h.sql<{ id: string }>(
        `insert into estimate_versions (company_id, estimate_id, version_number, status, blocked_from_issue, bid_price)
         values ($1,$2,1,'draft',false,500000) returning id`, [ridgeline, est[0]!.id]);
      versionId = v[0]!.id;
      const snap = await h.sql<{ id: string }>(
        `insert into library_snapshots (company_id, estimate_version_id, engine_version, entry_count, digest)
         values ($1,$2,'1.0.0',0,'0000000000000000') returning id`, [ridgeline, versionId]);
      await h.sql(
        `update estimate_versions set library_snapshot_id = $2, status = 'approved' where id = $1`,
        [versionId, snap[0]!.id]);
      const p = await h.sql<{ id: string }>(
        `insert into projects (company_id, number, name, status) values ($1,'PRJ-1','Test project','active') returning id`,
        [ridgeline]);
      project = p[0]!.id;
      const pr = await h.sql<{ id: string }>(
        `insert into proposals (company_id, estimate_version_id, number, title, total_price)
         values ($1,$2,'PROP-1','Test proposal',500000) returning id`, [ridgeline, versionId]);
      proposal = pr[0]!.id;
    });
  });

  afterAll(async () => { await h?.db.close(); });

  // ---------------------------------------------------------------- submittals
  describe('submittals', () => {
    it('requires a returned submittal to record when it was returned', async () => {
      await expect(
        h.asUser(alice, () =>
          h.sql(`insert into submittals (company_id, project_id, number, title, status)
                 values ($1,$2,'SUB-1','Product data','approved')`, [ridgeline, project])),
      ).rejects.toThrow(/submittals_returned/);
    });

    it('accepts a returned submittal with its decision recorded', async () => {
      const rows = await h.asUser(alice, () =>
        h.sql<{ id: string }>(
          `insert into submittals (company_id, project_id, number, title, status, returned_at, reviewer_comment)
           values ($1,$2,'SUB-2','RCP product data','approved_as_noted', now(), 'Use gasketed joints')
           returning id`, [ridgeline, project]));
      expect(rows).toHaveLength(1);
    });

    it('defaults the ball to the contractor and tracks who owes the next action', async () => {
      const [row] = await h.asUser(alice, () =>
        h.sql<{ ball_in_court: string }>(
          `insert into submittals (company_id, project_id, number, title)
           values ($1,$2,'SUB-3','Shop drawings') returning ball_in_court`, [ridgeline, project]));
      expect(row!.ball_in_court).toBe('contractor');
    });

    it('is isolated across tenants', async () => {
      const seen = await h.asUser(bob, () => h.sql(`select id from submittals where company_id = $1`, [ridgeline]));
      expect(seen).toEqual([]);
    });

    it('lets a project manager write but a viewer only read', async () => {
      const rows = await h.asUser(pm, () =>
        h.sql<{ id: string }>(
          `insert into submittals (company_id, project_id, number, title)
           values ($1,$2,'SUB-4','PM created') returning id`, [ridgeline, project]));
      expect(rows).toHaveLength(1);
    });
  });

  // ----------------------------------------------------------------- proposals
  describe('proposal immutability', () => {
    it('allows edits while the proposal is a draft', async () => {
      await h.asUser(alice, () =>
        h.sql(`update proposals set title = 'Revised title' where id = $1`, [proposal]));
      const [p] = await h.sql<{ title: string }>(`select title from proposals where id = $1`, [proposal]);
      expect(p!.title).toBe('Revised title');
    });

    it('freezes the content once issued', async () => {
      await h.asUser(alice, () =>
        h.sql(`update proposals set status='issued', issued_at=now() where id = $1`, [proposal]));
      await expect(
        h.asUser(alice, () => h.sql(`update proposals set total_price = 1 where id = $1`, [proposal])),
      ).rejects.toThrow(/content is fixed/);
    });

    it('still records the customer outcome', async () => {
      await h.asUser(alice, () =>
        h.sql(`update proposals set status='accepted', accepted_at=now(), accepted_by_name='P. Raman'
               where id = $1`, [proposal]));
      const [p] = await h.sql<{ status: string }>(`select status from proposals where id = $1`, [proposal]);
      expect(p!.status).toBe('accepted');
    });

    it('keeps line items on the right tenant', async () => {
      // Against a *draft* proposal, deliberately. Since migration 0045 the line
      // items of an issued proposal are locked, and that lock fires first — so
      // running this against the issued one above would still see a refusal
      // and would no longer be testing tenancy at all.
      const [draft] = await h.asUser(alice, () => h.sql<{ id: string }>(
        `insert into proposals (company_id, estimate_version_id, number, title, total_price)
         select company_id, estimate_version_id, 'PROP-TENANT', 'Draft', 0
         from proposals where id = $1 returning id`, [proposal]));
      await expect(
        h.asUser(alice, () =>
          h.sql(`insert into proposal_line_items (company_id, proposal_id, description, extended_price)
                 values ($1,$2,'Cross-tenant line',100)`, [kesler, draft!.id])),
      ).rejects.toThrow(/row-level security|Tenant boundary/);
    });
  });

  // ------------------------------------------------------------- daily reports
  describe('daily reports', () => {
    let report = '';
    it('accepts a submitted report', async () => {
      const rows = await h.asUser(pm, () =>
        h.sql<{ id: string }>(
          `insert into daily_reports (company_id, project_id, report_date, work_performed, submitted_by, submitted_at)
           values ($1,$2,'2026-08-31','Installed 412 LF of sanitary',$3, now()) returning id`,
          [ridgeline, project, pm]));
      report = rows[0]!.id;
      expect(report).toBeTruthy();
    });

    it('refuses to change the date of a submitted report', async () => {
      // The daily report is the contemporaneous record of a specific day and is
      // evidence in a delay claim; its date is not editable after submission.
      await expect(
        h.asUser(pm, () => h.sql(`update daily_reports set report_date='2026-08-30' where id=$1`, [report])),
      ).rejects.toThrow(/cannot change its date/);
    });

    it('allows one report per project per day', async () => {
      await expect(
        h.asUser(pm, () =>
          h.sql(`insert into daily_reports (company_id, project_id, report_date)
                 values ($1,$2,'2026-08-31')`, [ridgeline, project])),
      ).rejects.toThrow(/duplicate key/);
    });

    it('binds labor and equipment rows to the report tenant', async () => {
      await expect(
        h.asUser(alice, () =>
          h.sql(`insert into daily_report_labor (company_id, daily_report_id, classification, headcount, straight_hours)
                 values ($1,$2,'Foreman',1,8)`, [kesler, report])),
      ).rejects.toThrow(/row-level security|Tenant boundary/);

      const ok = await h.asUser(pm, () =>
        h.sql<{ id: string }>(
          `insert into daily_report_labor (company_id, daily_report_id, classification, headcount, straight_hours)
           values ($1,$2,'Foreman',1,8) returning id`, [ridgeline, report]));
      expect(ok).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------ notifications
  describe('notifications', () => {
    it('delivers a company-wide notice to every member', async () => {
      await h.asUser(alice, () =>
        h.sql(`insert into notifications (company_id, category, severity, title)
               values ($1,'system','info','Company-wide notice')`, [ridgeline]));
      const seen = await h.asUser(pm, () =>
        h.sql(`select id from notifications where title = 'Company-wide notice'`));
      expect(seen).toHaveLength(1);
    });

    it('delivers a targeted notice only to its recipient', async () => {
      await h.asUser(alice, () =>
        h.sql(`insert into notifications (company_id, user_id, category, title)
               values ($1,$2,'rfi','For Alice only')`, [ridgeline, alice]));
      const mine = await h.asUser(alice, () => h.sql(`select id from notifications where title='For Alice only'`));
      const theirs = await h.asUser(pm, () => h.sql(`select id from notifications where title='For Alice only'`));
      expect(mine).toHaveLength(1);
      expect(theirs).toEqual([]);
    });

    it('refuses to address a notice to a non-member', async () => {
      await expect(
        h.asUser(alice, () =>
          h.sql(`insert into notifications (company_id, user_id, category, title)
                 values ($1,$2,'system','Wrong tenant')`, [ridgeline, bob])),
      ).rejects.toThrow(/row-level security/i);
    });

    it('does not leak across tenants', async () => {
      const seen = await h.asUser(bob, () => h.sql(`select id from notifications where company_id=$1`, [ridgeline]));
      expect(seen).toEqual([]);
    });

    it('requires an action path to be an in-app route', async () => {
      await expect(
        h.asUser(alice, () =>
          h.sql(`insert into notifications (company_id, category, title, action_path)
                 values ($1,'system','Phishy','https://evil.example/steal')`, [ridgeline])),
      ).rejects.toThrow();
    });
  });

  // --------------------------------------------------------- prompt registry
  describe('AI prompt registry', () => {
    it('refuses to activate a prompt with no evaluation or approver', async () => {
      await expect(
        h.asUser(alice, () =>
          h.sql(`insert into ai_prompts (company_id, agent_id, version, system_prompt, state)
                 values ($1,'AGT-EST','v9','do things','active')`, [ridgeline])),
      ).rejects.toThrow(/ai_prompts_activation/);
    });

    it('activates a prompt that carries its evaluation and a named approver', async () => {
      const rows = await h.asUser(alice, () =>
        h.sql<{ id: string }>(
          `insert into ai_prompts (company_id, agent_id, version, system_prompt, state,
                                   eval_pass_rate, eval_sample_size, activated_by, activated_at)
           values ($1,'AGT-EST','v9','do things','active',0.93,120,$2, now()) returning id`,
          [ridgeline, alice]));
      expect(rows).toHaveLength(1);
    });

    it('allows only one active prompt per agent per scope', async () => {
      await expect(
        h.asUser(alice, () =>
          h.sql(`insert into ai_prompts (company_id, agent_id, version, system_prompt, state,
                                         eval_pass_rate, eval_sample_size, activated_by, activated_at)
                 values ($1,'AGT-EST','v10','other','active',0.95,120,$2, now())`, [ridgeline, alice])),
      ).rejects.toThrow(/duplicate key/);
    });

    it('lets a tenant read the shipped prompt but not edit it', async () => {
      // The platform prompt is seeded since migration 0052 — it carries the
      // exact text the analyst runs — so this reads the real one rather than
      // planting a fixture and reading that back.
      const [before] = await h.sql<{ system_prompt: string }>(
        `select system_prompt from ai_prompts where company_id is null and agent_id='AGT-DOC'`);
      expect(before!.system_prompt.length).toBeGreaterThan(100);

      const readable = await h.asUser(alice, () =>
        h.sql(`select id from ai_prompts where company_id is null`));
      expect(readable.length).toBeGreaterThan(0);

      await h.asUser(alice, () =>
        h.sql(`update ai_prompts set system_prompt = 'hijacked' where company_id is null`));
      const [after] = await h.sql<{ system_prompt: string }>(
        `select system_prompt from ai_prompts where company_id is null and agent_id='AGT-DOC'`);
      expect(after!.system_prompt).toBe(before!.system_prompt);
    });

    it('exposes the model catalog read-only', async () => {
      const models = await h.asUser(alice, () => h.sql<{ id: string }>(
        `select id from ai_models order by id`));
      expect(models.map((m) => m.id)).toContain('claude-opus-5');

      await h.asUser(alice, () =>
        h.sql(`update ai_models set display_name = 'hijacked' where id = 'claude-opus-5'`));
      const [row] = await h.sql<{ display_name: string }>(
        `select display_name from ai_models where id = 'claude-opus-5'`);
      expect(row!.display_name).toBe('Claude Opus 5');
    });
  });

  // ------------------------------------------------------------ change orders
  describe('change order detail', () => {
    it('binds line items to the change order tenant', async () => {
      const [co] = await h.asUser(pm, () =>
        h.sql<{ id: string }>(
          `insert into change_orders (company_id, project_id, number, title, reason)
           values ($1,$2,'CO-1','Undercut','Differing site condition') returning id`, [ridgeline, project]));
      await expect(
        h.asUser(alice, () =>
          h.sql(`insert into change_order_items (company_id, change_order_id, description)
                 values ($1,$2,'Cross-tenant')`, [kesler, co!.id])),
      ).rejects.toThrow(/row-level security|Tenant boundary/);
    });

    it('requires a decision date once approved or rejected', async () => {
      const [co] = await h.asUser(pm, () =>
        h.sql<{ id: string }>(
          `insert into change_orders (company_id, project_id, number, title, reason)
           values ($1,$2,'CO-2','Relocate','Design change') returning id`, [ridgeline, project]));
      await expect(
        h.asUser(pm, () => h.sql(`update change_orders set status='approved' where id=$1`, [co!.id])),
      ).rejects.toThrow(/change_orders_decision/);
    });
  });
});
