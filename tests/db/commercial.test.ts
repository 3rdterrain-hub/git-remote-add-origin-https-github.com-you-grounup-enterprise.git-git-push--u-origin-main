/**
 * Contracts, change orders and claims, against real PostgreSQL.
 *
 * These three tables had no tests at all, and the traceability matrix counted
 * them as tested because a mapping rule said so. What the tests found once they
 * existed: nothing protected a commercial record after it was agreed, a claim
 * deadline could be typed instead of derived from the contract clause, and a
 * claim could cite supporting records that do not exist or belong to another
 * company.
 *
 * RULE-009 makes an issued estimate immutable. An issued estimate is an offer.
 * These are the obligations that follow it.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('commercial records', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  const rival = '22222222-2222-4222-8222-222222222222';
  let company = '';
  let rivalCompany = '';
  let project = '';
  let rivalProject = '';
  let contract = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@r.test'), ($2,'r@k.test')`, [owner, rival]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@r.test'), ($2,'r@k.test') on conflict (id) do nothing`, [owner, rival]);
    company = (await h.asUser(owner, () =>
      h.sql<{ id: string }>(`select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
    rivalCompany = (await h.asUser(rival, () =>
      h.sql<{ id: string }>(`select app.provision_company('Kesler','kesler','enterprise') as id`)))[0]!.id;

    await h.asUser(owner, async () => {
      project = (await h.sql<{ id: string }>(
        `insert into projects (company_id, number, name) values ($1,'PRJ-C1','Contract test')
         returning id`, [company]))[0]!.id;
      contract = (await h.sql<{ id: string }>(
        `insert into contracts (company_id, project_id, number, title, original_value,
           executed_on, notice_days, claim_days, liquidated_damages_per_day, status)
         values ($1,$2,'C-100','Maumee Phase 2',2500000,'2026-04-01',7,21,2500,'executed')
         returning id`, [company, project]))[0]!.id;
    });

    await h.asUser(rival, async () => {
      rivalProject = (await h.sql<{ id: string }>(
        `insert into projects (company_id, number, name) values ($1,'PRJ-C2','Theirs')
         returning id`, [rivalCompany]))[0]!.id;
    });
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  // ------------------------------------------------------------------ frozen
  describe('an agreed contract cannot be rewritten', () => {
    it('lets a draft be corrected freely', async () => {
      const [draft] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into contracts (company_id, project_id, number, title, original_value, notice_days)
         values ($1,$2,'C-DRAFT','Draft',100,5) returning id`, [company, project]));
      await h.asUser(owner, () => h.sql(
        `update contracts set original_value = 200, notice_days = 10 where id = $1`, [draft!.id]));
      const [after] = await h.sql<{ original_value: string }>(
        `select original_value from contracts where id=$1`, [draft!.id]);
      expect(Number(after!.original_value)).toBe(200);
    });

    it('refuses to change the value of an executed contract', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `update contracts set original_value = 3000000 where id = $1`, [contract])))
        .rejects.toThrow(/agreed terms cannot be changed.*change order/);
    });

    it('refuses to change the notice clause a claim deadline derives from', async () => {
      // The sharpest case: editing notice_days would move the deadline on
      // claims that have already been filed under it.
      await expect(h.asUser(owner, () => h.sql(
        `update contracts set notice_days = 30 where id = $1`, [contract])))
        .rejects.toThrow(/agreed terms cannot be changed/);
    });

    it('refuses to change liquidated damages or retainage', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `update contracts set liquidated_damages_per_day = 0 where id = $1`, [contract])))
        .rejects.toThrow(/agreed terms cannot be changed/);
      await expect(h.asUser(owner, () => h.sql(
        `update contracts set retainage_percent = 0 where id = $1`, [contract])))
        .rejects.toThrow(/agreed terms cannot be changed/);
    });

    it('still allows the administrative fields and the status to move', async () => {
      // A contract legitimately goes executed -> active -> closed, and the
      // stored document path may be corrected.
      await h.asUser(owner, () => h.sql(
        `update contracts set status='active', storage_path='contracts/c-100.pdf' where id=$1`, [contract]));
      const [after] = await h.sql<{ status: string; storage_path: string }>(
        `select status, storage_path from contracts where id=$1`, [contract]);
      expect(after!.status).toBe('active');
      expect(after!.storage_path).toBe('contracts/c-100.pdf');
    });
  });

  describe('an executed change order cannot be repriced', () => {
    const co = (number: string, status = 'potential', price = 50000) =>
      h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into change_orders (company_id, project_id, number, title, reason, status,
           price_impact, cost_impact, decided_at)
         values ($1,$2,$3,'Extra rock excavation','Differing site condition',$4,$5,$6,
                 case when $4 in ('approved','rejected') then now() else null end)
         returning id`, [company, project, number, status, price, price * 0.8]));

    it('lets a potential change order be priced and repriced', async () => {
      const [c] = await co('CO-1');
      await h.asUser(owner, () => h.sql(
        `update change_orders set price_impact = 62000 where id=$1`, [c!.id]));
      const [after] = await h.sql<{ price_impact: string }>(
        `select price_impact from change_orders where id=$1`, [c!.id]);
      expect(Number(after!.price_impact)).toBe(62000);
    });

    it('refuses to reprice an approved change order', async () => {
      const [c] = await co('CO-2', 'approved');
      await expect(h.asUser(owner, () => h.sql(
        `update change_orders set price_impact = 1 where id=$1`, [c!.id])))
        .rejects.toThrow(/impact cannot be changed.*new change order/);
    });

    it('lets an approved change order advance to executed without changing its impact', async () => {
      const [c] = await co('CO-3', 'approved');
      await h.asUser(owner, () => h.sql(
        `update change_orders set status='executed', executed_at=now() where id=$1`, [c!.id]));
      const [after] = await h.sql<{ status: string }>(
        `select status from change_orders where id=$1`, [c!.id]);
      expect(after!.status).toBe('executed');
    });

    it('refuses to move an executed change order back', async () => {
      const [c] = await co('CO-4', 'approved');
      await h.asUser(owner, () => h.sql(
        `update change_orders set status='executed', executed_at=now() where id=$1`, [c!.id]));
      await expect(h.asUser(owner, () => h.sql(
        `update change_orders set status='potential' where id=$1`, [c!.id])))
        .rejects.toThrow(/impact cannot be changed/);
    });

    it('refuses to change the schedule impact of an executed change order', async () => {
      const [c] = await co('CO-5', 'approved');
      await expect(h.asUser(owner, () => h.sql(
        `update change_orders set schedule_impact_days = 14 where id=$1`, [c!.id])))
        .rejects.toThrow(/impact cannot be changed/);
    });
  });

  // --------------------------------------------------------------- deadlines
  describe('a claim deadline is derived, not typed', () => {
    /** The driver hands dates back as Date objects; compare them as ISO days. */
    const day = (v: unknown) => new Date(v as string).toISOString().slice(0, 10);

    const claim = (number: string, over: Record<string, string> = {}) =>
      h.asUser(owner, () => h.sql<{ id: string; notice_due_on: unknown; claim_due_on: unknown }>(
        `insert into claims (company_id, project_id, contract_id, number, title, claim_type,
           description, event_date, notice_due_on, claim_due_on)
         values ($1,$2,$3,$4,'Rock at MH-4','differing_site_condition',
                 'Solid rock encountered two feet above the elevation shown.','2026-06-01',$5,$6)
         returning id, notice_due_on, claim_due_on`,
        [company, project, contract, number, over.notice ?? null, over.claim ?? null]));

    it('computes both deadlines from the contract clauses', async () => {
      // 7 days notice and 21 days to claim, from a 1 June event.
      const [c] = await claim('CL-1');
      expect(day(c!.notice_due_on)).toBe('2026-06-08');
      expect(day(c!.claim_due_on)).toBe('2026-06-22');
    });

    it('accepts a supplied deadline that agrees with the contract', async () => {
      const [c] = await claim('CL-2', { notice: '2026-06-08', claim: '2026-06-22' });
      expect(day(c!.notice_due_on)).toBe('2026-06-08');
    });

    it('refuses a deadline that disagrees with the clause', async () => {
      // The previous version derived only when the column was null, so this
      // silently bypassed the contract.
      await expect(claim('CL-3', { notice: '2026-07-01' }))
        .rejects.toThrow(/Notice is due 2026-06-08 under the contract's 7 day clause/);
    });

    it('names the override mechanism rather than just refusing', async () => {
      await expect(claim('CL-4', { claim: '2026-08-01' }))
        .rejects.toThrow(/value override on claims\.claim_due_on, with a reason and an approver/);
    });

    it('re-derives when the event date moves', async () => {
      const [c] = await claim('CL-5');
      await h.asUser(owner, () => h.sql(
        `update claims set event_date = '2026-06-10' where id=$1`, [c!.id]));
      const [after] = await h.sql<{ notice_due_on: unknown }>(
        `select notice_due_on from claims where id=$1`, [c!.id]);
      // Correcting the event date has to move the deadline with it; the
      // stale stored value is not a caller asserting a different deadline.
      expect(day(after!.notice_due_on)).toBe('2026-06-17');
    });

    it('leaves a claim with no contract alone', async () => {
      const rows = await h.asUser(owner, () => h.sql<{ notice_due_on: string | null }>(
        `insert into claims (company_id, project_id, number, title, claim_type, description, event_date)
         values ($1,$2,'CL-NC','No contract','other','Recorded before the contract was loaded.','2026-06-01')
         returning notice_due_on`, [company, project]));
      expect(rows[0]!.notice_due_on).toBeNull();
    });
  });

  // ---------------------------------------------------------------- evidence
  describe('supporting evidence has to exist', () => {
    let report = '';
    let rivalReport = '';

    beforeAll(async () => {
      report = (await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into daily_reports (company_id, project_id, report_date)
         values ($1,$2,'2026-06-01') returning id`, [company, project])))[0]!.id;
      rivalReport = (await h.asUser(rival, () => h.sql<{ id: string }>(
        `insert into daily_reports (company_id, project_id, report_date)
         values ($1,$2,'2026-06-01') returning id`, [rivalCompany, rivalProject])))[0]!.id;
    });

    const cite = (number: string, reports: string[]) =>
      h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into claims (company_id, project_id, contract_id, number, title, claim_type,
           description, event_date, supporting_daily_reports)
         values ($1,$2,$3,$4,'Cited','delay','Delay from the rock encountered at MH-4.',
                 '2026-06-01',$5::uuid[])
         returning id`, [company, project, contract, number, reports]));

    it('accepts a claim citing its own records', async () => {
      const rows = await cite('CL-E1', [report]);
      expect(rows[0]!.id).toBeTruthy();
    });

    it('refuses a claim citing a record that does not exist', async () => {
      // A claim resting on evidence that is not there.
      await expect(cite('CL-E2', ['33333333-3333-4333-8333-333333333333']))
        .rejects.toThrow(/cites daily report\(s\) .* that do not exist in this company/);
    });

    it('refuses a claim citing another company records', async () => {
      // Rendering this claim would have been a cross-tenant read.
      await expect(cite('CL-E3', [rivalReport]))
        .rejects.toThrow(/do not exist in this company/);
    });

    it('checks evidence again when it is added later', async () => {
      const [c] = await cite('CL-E4', [report]);
      await expect(h.asUser(owner, () => h.sql(
        `update claims set supporting_documents = array['44444444-4444-4444-8444-444444444444']::uuid[]
         where id=$1`, [c!.id])))
        .rejects.toThrow(/cites document\(s\)/);
    });

    it('accepts an empty citation list', async () => {
      const rows = await cite('CL-E5', []);
      expect(rows[0]!.id).toBeTruthy();
    });
  });

  // -------------------------------------------------------------- resolution
  describe('a resolved claim cannot be re-awarded', () => {
    let settled = '';

    beforeAll(async () => {
      settled = (await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into claims (company_id, project_id, contract_id, number, title, claim_type,
           description, event_date, notice_given_on, cost_claimed, status)
         values ($1,$2,$3,'CL-S1','Settled','delay','Delay claim, settled.',
                 '2026-06-01','2026-06-05',180000,'submitted')
         returning id`, [company, project, contract])))[0]!.id;
      await h.asUser(owner, () => h.sql(
        `update claims set status='settled', cost_awarded=120000, time_awarded_days=9,
           resolution='Settled at mediation for $120,000 and nine days.', resolved_on='2026-09-01'
         where id=$1`, [settled]));
    });

    it('requires a resolution and a date to settle', async () => {
      const [c] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into claims (company_id, project_id, number, title, claim_type, description,
           event_date, notice_given_on, status)
         values ($1,$2,'CL-S2','Open','delay','A second delay claim.','2026-06-01','2026-06-05','submitted')
         returning id`, [company, project]));
      await expect(h.asUser(owner, () => h.sql(
        `update claims set status='denied' where id=$1`, [c!.id])))
        .rejects.toThrow(/claims_resolved/);
    });

    it('refuses to change what was awarded', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `update claims set cost_awarded = 200000 where id=$1`, [settled])))
        .rejects.toThrow(/award cannot be changed.*new claim/);
    });

    it('refuses to rewrite the reasoning', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `update claims set resolution = 'Something else' where id=$1`, [settled])))
        .rejects.toThrow(/award cannot be changed/);
    });

    it('refuses to reopen a settled claim', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `update claims set status='negotiating' where id=$1`, [settled])))
        .rejects.toThrow(/award cannot be changed/);
    });

    it('still refuses to advance past potential without a notice date', async () => {
      // The constraint that was already there: most construction claims are
      // lost on the notice clause rather than on their merits.
      await expect(h.asUser(owner, () => h.sql(
        `insert into claims (company_id, project_id, number, title, claim_type, description,
           event_date, status)
         values ($1,$2,'CL-S3','No notice','delay','No notice given.','2026-06-01','submitted')`,
        [company, project])))
        .rejects.toThrow(/claims_notice/);
    });
  });

  // ----------------------------------------------------------------- tenancy
  describe('tenancy', () => {
    it('never shows one company another company contracts', async () => {
      const rows = await h.asUser(rival, () => h.sql(
        `select id from contracts where project_id = $1`, [project]));
      expect(rows).toEqual([]);
    });

    it('never shows one company another company claims', async () => {
      const rows = await h.asUser(rival, () => h.sql(
        `select id from claims where project_id = $1`, [project]));
      expect(rows).toEqual([]);
    });

    it('refuses a contract attached to another company project', async () => {
      await expect(h.asUser(owner, () => h.sql(
        `insert into contracts (company_id, project_id, number, title, original_value)
         values ($1,$2,'C-X','Theirs',1)`, [company, rivalProject])))
        .rejects.toThrow();
    });

    it('shows an anonymous caller nothing', async () => {
      await expect(h.asAnon(() => h.sql(`select id from contracts limit 1`))).rejects.toThrow();
    });
  });
});

describe('commercial authority', () => {
  let h: Harness;
  const boss = '44444444-4444-4444-8444-444444444444';
  const junior = '55555555-5555-4555-8555-555555555555';
  let company = '';
  let project = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'boss@r.test'), ($2,'jr@r.test')`,
      [boss, junior]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'boss@r.test'), ($2,'jr@r.test') on conflict (id) do nothing`,
      [boss, junior]);
    company = (await h.asUser(boss, () =>
      h.sql<{ id: string }>(`select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;

    // A project engineer: write access to projects, and a low approval tier.
    const [role] = await h.sql<{ id: string; approval_tier: number }>(
      `select id, approval_tier from roles where key='project_manager' and company_id is null`);
    await h.sql(
      `insert into company_memberships (company_id, user_id, role_id, status, joined_at)
       values ($1,$2,$3,'active',now())`, [company, junior, role!.id]);

    project = (await h.asUser(boss, () => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name) values ($1,'PRJ-A1','Authority')
       returning id`, [company])))[0]!.id;

    // Anything at or above $250,000 needs tier 4 — an owner signature.
    await h.asUser(boss, () => h.sql(
      `insert into commercial_authority_limits (company_id, record_type, threshold_value, required_tier)
       values ($1,'change_order',250000,4), ($1,'change_order',25000,3)`, [company]));
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  const propose = (user: string, number: string, price: number, status = 'potential') =>
    h.asUser(user, () => h.sql<{ id: string }>(
      `insert into change_orders (company_id, project_id, number, title, reason, status,
         price_impact, decided_at)
       values ($1,$2,$3,'Extra work','Owner request',$4,$5,
               case when $4 in ('approved','rejected') then now() else null end)
       returning id`, [company, project, number, status, price]));

  it('resolves the tier a value requires', async () => {
    const rows = await h.asUser(boss, () => h.sql<{ t: number }>(
      `select app.required_authority_tier($1,'change_order',$2) as t`, [company, 300000]));
    expect(Number(rows[0]!.t)).toBe(4);
    const low = await h.asUser(boss, () => h.sql<{ t: number }>(
      `select app.required_authority_tier($1,'change_order',$2) as t`, [company, 30000]));
    expect(Number(low[0]!.t)).toBe(3);
    const none = await h.asUser(boss, () => h.sql<{ t: number }>(
      `select app.required_authority_tier($1,'change_order',$2) as t`, [company, 1000]));
    expect(Number(none[0]!.t)).toBe(0);
  });

  it('treats a large credit as seriously as a large charge', async () => {
    const rows = await h.asUser(boss, () => h.sql<{ t: number }>(
      `select app.required_authority_tier($1,'change_order',$2) as t`, [company, -300000]));
    expect(Number(rows[0]!.t)).toBe(4);
  });

  it('lets anybody propose a change order of any size', async () => {
    // Proposing is not committing.
    const rows = await propose(junior, 'CO-A1', 900000);
    expect(rows[0]!.id).toBeTruthy();
  });

  it('refuses a commitment above the acting user authority, naming both tiers', async () => {
    await expect(propose(junior, 'CO-A2', 900000, 'approved'))
      .rejects.toThrow(/requires approval tier 4; you hold tier \d/);
  });

  it('lets the owner commit the same change order', async () => {
    const rows = await propose(boss, 'CO-A3', 900000, 'approved');
    expect(rows[0]!.id).toBeTruthy();
  });

  it('applies the highest threshold the value meets', async () => {
    // $30,000 needs tier 3, not tier 4.
    const [c] = await propose(junior, 'CO-A4', 30000);
    const [tier] = await h.asUser(junior, () => h.sql<{ t: number }>(
      `select app.approval_tier($1) as t`, [company]));
    if (Number(tier!.t) >= 3) {
      await h.asUser(junior, () => h.sql(
        `update change_orders set status='approved', decided_at=now() where id=$1`, [c!.id]));
      const [after] = await h.sql<{ status: string }>(
        `select status from change_orders where id=$1`, [c!.id]);
      expect(after!.status).toBe('approved');
    } else {
      await expect(h.asUser(junior, () => h.sql(
        `update change_orders set status='approved', decided_at=now() where id=$1`, [c!.id])))
        .rejects.toThrow(/requires approval tier 3/);
    }
  });

  it('leaves a company with no limits unrestricted', async () => {
    // The platform must not invent a signing policy nobody set.
    const other = '66666666-6666-4666-8666-666666666666';
    await h.sql(`insert into auth.users (id, email) values ($1,'free@x.test')`, [other]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'free@x.test') on conflict (id) do nothing`, [other]);
    const free = (await h.asUser(other, () => h.sql<{ id: string }>(
      `select app.provision_company('Free','free','enterprise') as id`)))[0]!.id;
    const p = (await h.asUser(other, () => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name) values ($1,'PRJ-F','Free') returning id`,
      [free])))[0]!.id;
    const rows = await h.asUser(other, () => h.sql<{ id: string }>(
      `insert into change_orders (company_id, project_id, number, title, reason, status,
         price_impact, decided_at)
       values ($1,$2,'CO-F','Huge','Owner request','approved',5000000,now()) returning id`,
      [free, p]));
    expect(rows[0]!.id).toBeTruthy();
  });

  it('checks a contract at execution, not before', async () => {
    /*
     * A company-defined contracts role: it can read and write a contract, and
     * sits at approval tier 2. Exactly the case the authority rule exists for
     * — permitted to touch the record, not authorized to commit it.
     *
     * A company role rather than a seeded one because none of the seeded roles
     * holds both `finance.read` and `estimates.approve`: contracts are written
     * under the estimating permission and read under the finance one, so the
     * seeded roles can each do one half.
     */
    const senior = '77777777-7777-4777-8777-777777777777';
    await h.sql(`insert into auth.users (id, email) values ($1,'se@r.test')`, [senior]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'se@r.test') on conflict (id) do nothing`, [senior]);
    const [role] = await h.sql<{ id: string }>(
      `insert into roles (company_id, key, name, description, permissions, approval_tier)
       values ($1,'contract_admin','Contract Administrator','Drafts contracts, cannot execute them.',
               array['projects.read','finance.read','estimates.read','estimates.approve'], 2)
       returning id`, [company]);
    await h.sql(
      `insert into company_memberships (company_id, user_id, role_id, status, joined_at)
       values ($1,$2,$3,'active',now())`, [company, senior, role!.id]);

    await h.asUser(boss, () => h.sql(
      `insert into commercial_authority_limits (company_id, record_type, threshold_value, required_tier)
       values ($1,'contract',100000,4)`, [company]));

    // A draft of any size is fine: drafting is not executing.
    const rows = await h.asUser(senior, () => h.sql<{ id: string }>(
      `insert into contracts (company_id, project_id, number, title, original_value)
       values ($1,$2,'C-A1','Draft',5000000) returning id`, [company, project]));
    expect(rows[0]!.id).toBeTruthy();

    await expect(h.asUser(senior, () => h.sql(
      `update contracts set status='executed', executed_on='2026-04-01' where id=$1`, [rows[0]!.id])))
      .rejects.toThrow(/requires approval tier 4; you hold tier 2/);
  });

  it('forces row level security on the limits themselves', async () => {
    const [row] = await h.sql<{ rls: boolean; forced: boolean }>(
      `select relrowsecurity as rls, relforcerowsecurity as forced
       from pg_class where relname='commercial_authority_limits'`);
    expect(row!.rls).toBe(true);
    expect(row!.forced).toBe(true);
  });
});

describe('purchase order authority', () => {
  let h: Harness;
  const boss = '88888888-8888-4888-8888-888888888888';
  const buyer = '99999999-9999-4999-8999-999999999999';
  let company = '';
  let project = '';
  let vendor = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'b@p.test'), ($2,'buy@p.test')`,
      [boss, buyer]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'b@p.test'), ($2,'buy@p.test') on conflict (id) do nothing`,
      [boss, buyer]);
    company = (await h.asUser(boss, () =>
      h.sql<{ id: string }>(`select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;

    // A buyer: full procurement rights, approval tier 1.
    const [role] = await h.sql<{ id: string }>(
      `insert into roles (company_id, key, name, description, permissions, approval_tier)
       values ($1,'buyer','Buyer','Raises and issues purchase orders.',
               array['projects.read','procurement.read','procurement.write',
                     'finance.read','finance.write'], 1)
       returning id`, [company]);
    await h.sql(
      `insert into company_memberships (company_id, user_id, role_id, status, joined_at)
       values ($1,$2,$3,'active',now())`, [company, buyer, role!.id]);

    project = (await h.asUser(boss, () => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name) values ($1,'PRJ-P1','Procurement')
       returning id`, [company])))[0]!.id;
    vendor = (await h.asUser(boss, () => h.sql<{ id: string }>(
      `insert into vendors (company_id, code, name) values ($1,'STONECO','Stoneco')
       returning id`, [company])))[0]!.id;

    // Anything at or above $100,000 needs an owner.
    await h.asUser(boss, () => h.sql(
      `insert into commercial_authority_limits (company_id, record_type, threshold_value, required_tier)
       values ($1,'purchase_order',100000,4)`, [company]));
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  const po = (user: string, number: string, amount: number, status = 'draft') =>
    h.asUser(user, () => h.sql<{ id: string }>(
      `insert into purchase_orders (company_id, project_id, vendor_id, number, title, status,
         committed_amount, issued_at)
       values ($1,$2,$3,$4,'Aggregate supply',$5,$6,
               case when $5 <> 'draft' then now() else null end)
       returning id`, [company, project, vendor, number, status, amount]));

  it('accepts the new record type on a limit', async () => {
    const [row] = await h.asUser(boss, () => h.sql<{ t: number }>(
      `select app.required_authority_tier($1,'purchase_order',$2) as t`, [company, 250000]));
    expect(Number(row!.t)).toBe(4);
  });

  it('lets a buyer draft a purchase order of any size', async () => {
    // Working one up is not committing to it.
    const rows = await po(buyer, 'PO-1', 900000);
    expect(rows[0]!.id).toBeTruthy();
  });

  it('refuses to let the buyer issue it', async () => {
    await expect(po(buyer, 'PO-2', 900000, 'issued'))
      .rejects.toThrow(/Committing purchase_order of 900,000.00 requires approval tier 4; you hold tier 1/);
  });

  it('refuses to let the buyer issue a draft they already raised', async () => {
    const [c] = await po(buyer, 'PO-3', 500000);
    await expect(h.asUser(buyer, () => h.sql(
      `update purchase_orders set status='issued', issued_at=now() where id=$1`, [c!.id])))
      .rejects.toThrow(/requires approval tier 4/);
  });

  it('lets the owner issue the same commitment', async () => {
    const rows = await po(boss, 'PO-4', 900000, 'issued');
    expect(rows[0]!.id).toBeTruthy();
  });

  it('leaves a commitment below the threshold to the buyer', async () => {
    const rows = await po(buyer, 'PO-5', 50000, 'issued');
    expect(rows[0]!.id).toBeTruthy();
  });

  it('still governs a purchase order after it starts receiving', async () => {
    // The states after issued are all committed states; the commitment does
    // not stop being one because material arrived.
    const [row] = await h.asUser(boss, () => h.sql<{ t: number }>(
      `select app.required_authority_tier($1,'purchase_order',$2) as t`, [company, 100000]));
    expect(Number(row!.t)).toBe(4);
    await expect(po(buyer, 'PO-6', 150000, 'partially_received'))
      .rejects.toThrow(/requires approval tier 4/);
  });
});
