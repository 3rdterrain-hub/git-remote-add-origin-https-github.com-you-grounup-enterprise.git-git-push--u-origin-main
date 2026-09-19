import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * The calibration loop, closed.
 *
 * 0051 built the measurement and said so in its own comment: it reports the
 * variance and names its direction, and somebody decides. Nothing was ever
 * built for the deciding, so `production_calibrations` sat since 0008 with no
 * writer and no reader, and no library row ever carried `origin = 'calibration'`.
 *
 * What is worth testing is not the arithmetic — 0051 already owns that — but
 * the governance around it: that a proposal is only a proposal, that thin
 * evidence produces none, and above all that accepting one does not reach back
 * and change the rate an issued estimate was priced with.
 */
describe('a library that learns from the field', () => {
  let h: Harness;
  const owner = '51111111-1111-4111-8111-111111111111';
  let company = '';
  let rateId = '';
  let projectId = '';

  const actual = (date: string, qty: number, hours: number, cond: string) =>
    h.asUser(owner, () => h.sql(
      `insert into production_actuals
         (company_id, project_id, production_rate_id, work_date,
          quantity_installed, unit, crew_hours, material_condition)
       values ($1,$2,$3,$4,$5,'CY',$6,$7)`,
      [company, projectId, rateId, date, qty, hours, cond]));

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [owner, 'cal@r.test']);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2) on conflict (id) do nothing`,
      [owner, 'cal@r.test']);
    company = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company('Calibrate','calibrate','business') as id`)))[0]!.id;

    const [cust] = await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into customers (company_id, code, name) values ($1,'CUS-0001','Owner') returning id`,
      [company]));
    const [proj] = await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into projects (company_id, customer_id, number, name)
       values ($1,$2,'PRJ-0001','Mass excavation') returning id`, [company, cust!.id]));
    projectId = proj!.id;

    /* A library rate of 100 CY an hour, which the field is about to disagree with. */
    const [rate] = await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into production_rates
         (company_id, code, rate_per_hour, rate_unit, source_type, sample_size,
          approved_by, approved_at)
       values ($1,'PR-EXC-MASS',100,'CY','seed_benchmark',0,$2,now()) returning id`,
      [company, owner]));
    rateId = rate!.id;
  });

  afterAll(async () => { await h?.db.close(); });

  describe('with too little evidence', () => {
    it('proposes nothing from two days', async () => {
      await actual('2026-09-01', 650, 10, 'clay');
      await actual('2026-09-02', 640, 10, 'clay');
      const [n] = await h.asUser(owner, () => h.sql<{ n: number }>(
        `select app.propose_production_calibrations($1) as n`, [company]));
      expect(Number(n!.n)).toBe(0);
    });
  });

  describe('with enough evidence', () => {
    it('proposes once, and only once however often it is asked', async () => {
      await actual('2026-09-03', 660, 10, 'clay');
      const [first] = await h.asUser(owner, () => h.sql<{ n: number }>(
        `select app.propose_production_calibrations($1) as n`, [company]));
      expect(Number(first!.n)).toBe(1);

      /* Asked again the same morning. A second proposal is two of the same
         thing and a reviewer cannot tell which is real. */
      const [again] = await h.asUser(owner, () => h.sql<{ n: number }>(
        `select app.propose_production_calibrations($1) as n`, [company]));
      expect(Number(again!.n)).toBe(0);
    });

    it('lands pending, with the evidence a reviewer needs', async () => {
      const [c] = await h.asUser(owner, () => h.sql<{
        state: string; sample_size: number; proposed_rate_per_hour: string;
        current_rate_per_hour: string; statistical_note: string;
        sample_project_ids: string[]; observed_conditions: Record<string, number>;
      }>(`select state, sample_size, proposed_rate_per_hour, current_rate_per_hour,
                 statistical_note, sample_project_ids, observed_conditions
            from my_production_calibrations where production_rate_id = $1`, [rateId]));
      expect(c!.state).toBe('pending');
      expect(c!.sample_size).toBe(3);
      expect(Number(c!.current_rate_per_hour)).toBe(100);
      // 1,950 CY over 30 hours is 65 an hour, against a library rate of 100.
      expect(Number(c!.proposed_rate_per_hour)).toBeCloseTo(65, 1);
      expect(c!.statistical_note).toMatch(/slower/);
      expect(c!.sample_project_ids).toContain(projectId);
      expect(c!.observed_conditions).toHaveProperty('clay');
    });

    it('proposes nothing at all until somebody accepts it', async () => {
      const [r] = await h.asUser(owner, () => h.sql<{ rate_per_hour: string }>(
        `select rate_per_hour from production_rates where id = $1`, [rateId]));
      expect(Number(r!.rate_per_hour)).toBe(100);
    });
  });

  describe('accepting one', () => {
    let newRateId = '';

    it('writes a new rate rather than changing the one estimates used', async () => {
      const [c] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `select id from my_production_calibrations where production_rate_id = $1`, [rateId]));
      const [applied] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `select app.accept_production_calibration($1,'Matches what the crew has been saying') as id`,
        [c!.id]));
      newRateId = applied!.id;
      expect(newRateId).not.toBe(rateId);

      /*
       * The point of the whole design. An issued estimate priced with the old
       * rate, RULE-009 says that version cannot change, so a rate rewritten
       * underneath it would be a price nobody could reproduce.
       */
      const [old] = await h.asUser(owner, () => h.sql<{ rate_per_hour: string; status: string }>(
        `select rate_per_hour, status from production_rates where id = $1`, [rateId]));
      expect(Number(old!.rate_per_hour)).toBe(100);
      expect(old!.status).toBe('active');
    });

    it('marks the new rate as something the field measured', async () => {
      const [r] = await h.asUser(owner, () => h.sql<{
        rate_per_hour: string; source_type: string; sample_size: number;
        derived_from_project_id: string; approval_state: string;
      }>(`select rate_per_hour, source_type, sample_size, derived_from_project_id, approval_state
            from production_rates where id = $1`, [newRateId]));
      expect(Number(r!.rate_per_hour)).toBeCloseTo(65, 1);
      // The one value in the enum that means the field measured it.
      expect(r!.source_type).toBe('company_actual');
      expect(r!.sample_size).toBe(3);
      expect(r!.derived_from_project_id).toBe(projectId);
      expect(r!.approval_state).toBe('approved');
    });

    it('records who decided, and points at what it produced', async () => {
      const [c] = await h.asUser(owner, () => h.sql<{
        state: string; reviewed_by: string; applied_rate_id: string; review_note: string;
      }>(`select state, reviewed_by, applied_rate_id, review_note
            from my_production_calibrations where production_rate_id = $1`, [rateId]));
      expect(c!.state).toBe('approved');
      expect(c!.reviewed_by).toBe(owner);
      expect(c!.applied_rate_id).toBe(newRateId);
      expect(c!.review_note).toBe('Matches what the crew has been saying');
    });

    it('cannot be accepted twice', async () => {
      const [c] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `select id from my_production_calibrations where production_rate_id = $1`, [rateId]));
      await expect(h.asUser(owner, () => h.sql(
        `select app.accept_production_calibration($1)`, [c!.id])))
        .rejects.toThrow(/already approved/i);
    });
  });

  describe('declining one', () => {
    it('insists on a reason, so the same one is not argued twice', async () => {
      const [rate2] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `insert into production_rates
           (company_id, code, rate_per_hour, rate_unit, source_type, sample_size,
            approved_by, approved_at)
         values ($1,'PR-EXC-TRENCH',50,'CY','seed_benchmark',0,$2,now()) returning id`,
        [company, owner]));
      for (const [d, q] of [['2026-09-10', 200], ['2026-09-11', 210], ['2026-09-12', 205]] as const) {
        await h.asUser(owner, () => h.sql(
          `insert into production_actuals
             (company_id, project_id, production_rate_id, work_date,
              quantity_installed, unit, crew_hours, material_condition)
           values ($1,$2,$3,$4,$5,'CY',10,'rock')`,
          [company, projectId, rate2!.id, d, q]));
      }
      await h.asUser(owner, () => h.sql(`select app.propose_production_calibrations($1)`, [company]));
      const [c] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `select id from my_production_calibrations where production_rate_id = $1`, [rate2!.id]));

      await expect(h.asUser(owner, () => h.sql(
        `select app.decline_production_calibration($1,'  ')`, [c!.id])))
        .rejects.toThrow(/say why/i);

      await h.asUser(owner, () => h.sql(
        `select app.decline_production_calibration($1,'Every one of those days was in rock')`,
        [c!.id]));
      const [after] = await h.asUser(owner, () => h.sql<{ state: string; review_note: string }>(
        `select state, review_note from my_production_calibrations where id = $1`, [c!.id]));
      expect(after!.state).toBe('rejected');
      expect(after!.review_note).toMatch(/rock/);
    });
  });
});
