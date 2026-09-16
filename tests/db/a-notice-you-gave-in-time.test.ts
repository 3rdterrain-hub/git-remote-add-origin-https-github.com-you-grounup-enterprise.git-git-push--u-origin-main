/**
 * A notice you gave in time.
 *
 * `contracts` and `claims` have existed since migration 0023, fully governed,
 * with four constraints and a deadline trigger between them — and no writer of
 * any kind. `app.derive_claim_deadlines` had never fired in its life, because
 * nothing could put a row through it.
 *
 * Two things these tests are really about.
 *
 * **The deadline is derived from the contract, not typed.** That is the entire
 * reason a notice clause is stored as a number of days rather than as quoted
 * prose, and until now nothing had ever used it.
 *
 * **A late notice is recorded, not refused.** Most construction claims are lost
 * on the notice clause rather than on their merits, so refusing a late notice to
 * keep the record clean would hide the most expensive fact a company can know
 * about its own claim. It is accepted, and the lateness is computed and said.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '8b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';

describe('a notice you gave in time', () => {
  let h: Harness;
  let company = '';
  let project = '';
  let contract = '';
  let claim = '';

  const asOwner = <T>(fn: () => Promise<T>) => h.asUser(OWNER, fn);
  const one = <T>(sql: string, args: unknown[] = []) =>
    asOwner(() => h.sql<T>(sql, args)).then((r) => r[0]!);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@claim.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@claim.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await asOwner(() => h.sql<{ id: string }>(
      `select app.provision_company('Claim Civil','claim-civil','enterprise') as id`)))[0]!.id;
    project = (await asOwner(() => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name, status)
       values ($1,'PRJ-C1','Airport apron','active') returning id`, [company])))[0]!.id;
  }, 180_000);

  // ---------------------------------------------------------------- contract
  describe('the contract the claim is argued under', () => {
    it('numbers itself, because the number is unique per company', async () => {
      contract = (await one<{ id: string }>(
        `select public.create_contract($1,'Airport apron, phase 2','unit_price',1250000,
           null,'2026-06-01',7,21,2500,0.10) as id`, [project])).id;
      const row = await one<{ number: string; status: string; notice_clause_on_file: boolean }>(
        `select number, status, notice_clause_on_file from my_contracts where id = $1`, [contract]);
      expect(row.number).toMatch(/^CT-\d{4}-0001$/);
      expect(row.status).toBe('executed');
      expect(row.notice_clause_on_file).toBe(true);
    });

    it('refuses to leave draft without the date it was executed', async () => {
      // Every deadline in a contract runs from somewhere.
      const draft = (await one<{ id: string }>(
        `select public.create_contract($1,'Unsigned change work') as id`, [project])).id;
      await expect(asOwner(() => h.sql(
        `select public.update_contract($1,null,null,null,null,null,null,null,null,null,null,'active')`,
        [draft]))).rejects.toThrow(/records the date it was executed/);
    });

    it('says when a contract has no notice clause on file', async () => {
      const row = await one<{ notice_clause_on_file: boolean }>(
        `select notice_clause_on_file from my_contracts
          where project_id = $1 and title = 'Unsigned change work'`, [project]);
      // Not the same as having no clause — and a claim under it gets no
      // computed deadline rather than an invented one.
      expect(row.notice_clause_on_file).toBe(false);
    });
  });

  // ------------------------------------------------------------------- claim
  describe('opening a claim', () => {
    it('dates its deadlines off the contract rather than taking them', async () => {
      // `app.derive_claim_deadlines` has existed since 0023 and had never once
      // fired, because nothing could create a claim.
      claim = (await one<{ id: string }>(
        `select public.create_claim($1,'Rock at subgrade','differing_site_condition',
           'Solid limestone at elevation 612, twenty feet shallower than the boring log',
           '2026-08-10',$2,84000,11) as id`, [project, contract])).id;
      const row = await one<{
        number: string; status: string; notice_due_on: string; claim_due_on: string;
      }>(`select number, status, to_char(notice_due_on,'YYYY-MM-DD') as notice_due_on,
                 to_char(claim_due_on,'YYYY-MM-DD') as claim_due_on
            from claims where id = $1`, [claim]);
      expect(row.number).toMatch(/^CL-\d{4}-0001$/);
      expect(row.status).toBe('potential');
      /* Seven days and twenty-one days from the event, per the contract. */
      expect(row.notice_due_on).toBe('2026-08-17');
      expect(row.claim_due_on).toBe('2026-08-31');
    });

    it('carries no deadline where the contract has no clause', async () => {
      // Refusing to invent one is the whole point.
      const bare = (await one<{ id: string }>(
        `select public.create_claim($1,'Access blocked','delay',
           'Owner had not cleared the laydown area', '2026-08-12') as id`, [project])).id;
      const row = await one<{ notice_due_on: string | null }>(
        `select notice_due_on from claims where id = $1`, [bare]);
      expect(row.notice_due_on).toBeNull();
    });

    it('refuses a claim about something that has not happened', async () => {
      await expect(asOwner(() => h.sql(
        `select public.create_claim($1,'Next month','delay','Not yet', current_date + 1)`,
        [project]))).rejects.toThrow(/has not happened yet/);
    });

    it('refuses a claim with nothing written down about it', async () => {
      await expect(asOwner(() => h.sql(
        `select public.create_claim($1,'Something','delay','','2026-08-01')`, [project])))
        .rejects.toThrow(/needs to say what happened/);
    });

    it('will not let a claim advance without a notice on record', async () => {
      // `claims_notice`, said in words about the claim.
      await expect(asOwner(() => h.sql(`select public.submit_claim($1)`, [claim])))
        .rejects.toThrow(/no notice on record, and a claim without notice is usually worth nothing/);
    });
  });

  // ------------------------------------------------------------------ notice
  describe('the notice', () => {
    it('refuses a notice dated before the event it is about', async () => {
      await expect(asOwner(() => h.sql(
        `select public.give_claim_notice($1,'2026-08-01')`, [claim])))
        .rejects.toThrow(/cannot be dated before the event it is about \(2026-08-10\)/);
    });

    it('records a late notice rather than refusing it, and says how late', async () => {
      /*
       * The judgment this whole migration turns on. Refusing would keep the
       * record clean and hide the most expensive fact a company can know about
       * its own claim.
       */
      await asOwner(() => h.sql(`select public.give_claim_notice($1,'2026-08-24')`, [claim]));
      const row = await one<{
        status: string; notice_was_late: boolean; notice_days_late: number;
      }>(`select status, notice_was_late, notice_days_late from my_claims where id = $1`, [claim]);
      expect(row.status).toBe('notice_given');
      expect(row.notice_was_late).toBe(true);
      expect(Number(row.notice_days_late)).toBe(7);
    });

    it('will not let the date notice was given be given a second time', async () => {
      await expect(asOwner(() => h.sql(`select public.give_claim_notice($1)`, [claim])))
        .rejects.toThrow(/was already given on/);
    });
  });

  // ---------------------------------------------------------------- evidence
  describe('what the claim is argued from', () => {
    let report = '';

    beforeAll(async () => {
      report = (await one<{ id: string }>(
        `insert into daily_reports (company_id, project_id, report_date)
         values ($1,$2,'2026-08-10') returning id`, [company, project])).id;
    });

    it('attaches a contemporaneous record', async () => {
      // The arrays have been on this table since 0023 and had never been written.
      await asOwner(() => h.sql(
        `select public.attach_claim_support($1,'daily_report',$2)`, [claim, report]));
      const row = await one<{ supporting_reports: number }>(
        `select supporting_reports from my_claims where id = $1`, [claim]);
      expect(Number(row.supporting_reports)).toBe(1);
    });

    it('does not attach the same record twice', async () => {
      await asOwner(() => h.sql(
        `select public.attach_claim_support($1,'daily_report',$2)`, [claim, report]));
      const row = await one<{ supporting_reports: number }>(
        `select supporting_reports from my_claims where id = $1`, [claim]);
      expect(Number(row.supporting_reports)).toBe(1);
    });

    it('refuses evidence from another job', async () => {
      // Which the other side would find, rather than the person who attached it.
      const other = (await one<{ id: string }>(
        `insert into projects (company_id, number, name, status)
         values ($1,'PRJ-C2','North lot','active') returning id`, [company])).id;
      const elsewhere = (await one<{ id: string }>(
        `insert into daily_reports (company_id, project_id, report_date)
         values ($1,$2,'2026-08-10') returning id`, [company, other])).id;
      await expect(asOwner(() => h.sql(
        `select public.attach_claim_support($1,'daily_report',$2)`, [claim, elsewhere])))
        .rejects.toThrow(/not on this project/);
    });

    it('takes one back off', async () => {
      await asOwner(() => h.sql(
        `select public.detach_claim_support($1,'daily_report',$2)`, [claim, report]));
      const row = await one<{ supporting_reports: number }>(
        `select supporting_reports from my_claims where id = $1`, [claim]);
      expect(Number(row.supporting_reports)).toBe(0);
    });
  });

  // -------------------------------------------------------------- resolution
  describe('resolving it', () => {
    it('submits the claim, which is its own act', async () => {
      await asOwner(() => h.sql(
        `select public.submit_claim($1,'2026-08-28',91500,14)`, [claim]));
      const row = await one<{ status: string; cost_claimed: string }>(
        `select status, cost_claimed from claims where id = $1`, [claim]);
      expect(row.status).toBe('submitted');
      expect(Number(row.cost_claimed)).toBe(91500);
    });

    it('refuses a resolution with nothing said about it', async () => {
      // "Denied" with no reason is an outcome nobody can learn from.
      await expect(asOwner(() => h.sql(
        `select public.resolve_claim($1,'denied','no')`, [claim])))
        .rejects.toThrow(/says what was decided and why/);
    });

    it('refuses a settlement that awards nothing', async () => {
      await expect(asOwner(() => h.sql(
        `select public.resolve_claim($1,'settled','Agreed at mediation on 3 October')`,
        [claim]))).rejects.toThrow(/records what was awarded, in money or in time/);
    });

    it('settles it, with what was awarded', async () => {
      await asOwner(() => h.sql(
        `select public.resolve_claim($1,'settled',
           'Settled at mediation: rock quantity agreed from the survey, time granted in full',
           '2026-10-03', 74000, 14)`, [claim]));
      const row = await one<{
        status: string; cost_awarded: string; time_awarded_days: string; resolved_on: string;
      }>(`select status, cost_awarded, time_awarded_days, resolved_on from claims where id = $1`,
        [claim]);
      expect(row.status).toBe('settled');
      expect(Number(row.cost_awarded)).toBe(74000);
      expect(Number(row.time_awarded_days)).toBe(14);
      expect(row.resolved_on).not.toBeNull();
    });

    it('will not reopen a resolved claim through the status door', async () => {
      await expect(asOwner(() => h.sql(
        `select public.set_claim_status($1,'negotiating')`, [claim])))
        .rejects.toThrow(/is settled, and its resolution is the record of what was decided/);
    });

    it('refuses to use the status door for noticing or resolving', async () => {
      const another = (await one<{ id: string }>(
        `select public.create_claim($1,'Winter shutdown','suspension',
           'Owner suspended work for the season', '2026-08-15',$2) as id`,
        [project, contract])).id;
      await expect(asOwner(() => h.sql(
        `select public.set_claim_status($1,'settled')`, [another])))
        .rejects.toThrow(/each their own act/);
    });
  });

  // ---------------------------------------------------------------- tenancy
  describe('another company', () => {
    const STRANGER = '9c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c';

    beforeAll(async () => {
      await h.sql(`insert into auth.users (id, email) values ($1,'s@other.test')`, [STRANGER]);
      await h.sql(`insert into user_profiles (id, email) values ($1,'s@other.test')
                   on conflict (id) do nothing`, [STRANGER]);
      await h.asUser(STRANGER, () => h.sql(
        `select app.provision_company('Other Civil','other-claims','enterprise')`));
    });

    it('cannot open a claim on a project it cannot see', async () => {
      await expect(h.asUser(STRANGER, () => h.sql(
        `select public.create_claim($1,'Theirs','delay','Not mine', '2026-08-01')`, [project])))
        .rejects.toThrow(/No such project|do not have permission/);
    });

    it('sees none of the other company’s claims', async () => {
      const rows = await h.asUser(STRANGER, () => h.sql(`select id from my_claims`));
      expect(rows).toHaveLength(0);
    });
  });
});
