/**
 * The rate the work actually goes at.
 *
 * A production rate turns a quantity into hours, and hours into crew cost,
 * machine cost, fuel, duration and the schedule. The library ships 2,124 of
 * them and an estimator could not see which one a line was using, change it, or
 * say "that is not what my crew does".
 *
 * The property this file is really about: an override is a record, not a hidden
 * number. A number typed into a private column would price the same and score
 * as though somebody had measured it — which would make the estimate's
 * confidence a lie. Filing it as an `estimator_judgment` rate with its reason
 * keeps the arithmetic and the honesty in the same place.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('the rate the work actually goes at', () => {
  let h: Harness;
  const chief = '11111111-1111-4111-8111-111111111111';
  const rival = '22222222-2222-4222-8222-222222222222';
  let company = '';
  let rivalCompany = '';
  let version = '';
  let line = '';
  let service = '';

  const asChief = <T,>(q: string, p?: unknown[]) =>
    h.asUser(chief, () => h.sql<T extends object ? T : never>(q, p));

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, mail] of [[chief, 'chief@ridge.test'], [rival, 'r@kesler.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, mail]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, mail]);
    }
    company = (await h.asUser(chief, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
    rivalCompany = (await h.asUser(rival, () => h.sql<{ id: string }>(
      `select app.provision_company('Kesler','kesler','enterprise') as id`)))[0]!.id;

    const [s] = await h.sql<{ id: string }>(
      `select s.id from services s
        join assembly_components ac on ac.assembly_id = s.default_assembly_id
        join production_rates pr on pr.task_id = ac.task_id and pr.status = 'active'
       where s.company_id is null and s.status = 'active' and s.default_unit = 'CY'
       group by s.id having count(distinct pr.id) > 1 limit 1`);
    service = s!.id;

    const e = (await h.asUser(chief, () => h.sql<{ id: string }>(
      `select app.create_estimate('Rates', null, null, null, $1) as id`, [company])))[0]!.id;
    version = (await h.asUser(chief, () => h.sql<{ v: string }>(
      `select current_version_id as v from estimates where id = $1`, [e])))[0]!.v;
    line = (await h.asUser(chief, () => h.sql<{ id: string }>(
      `select app.add_estimate_line($1,$2,null,1800) as id`, [version, service])))[0]!.id;
  }, 300_000);

  afterAll(async () => { await h?.db.close(); });

  describe('seeing which rate a line uses', () => {
    it('says what it is, where it came from, and what it implies in hours', async () => {
      const [r] = await asChief<{ rate_code: string; source_type: string;
                                  rate_per_hour: string; hours_at_this_rate: string | null }>(
        `select rate_code, source_type, rate_per_hour, hours_at_this_rate
           from estimate_line_production where line_item_id = $1`, [line]);
      expect(r!.rate_code).toMatch(/^PR-/);
      expect(r!.source_type).toBe('seed_benchmark');
      expect(Number(r!.hours_at_this_rate)).toBeGreaterThan(0);
    });

    it('derives the hours from the quantity and the rate rather than storing them', async () => {
      const [r] = await asChief<{ q: string; rate: string; util: string; hours: string }>(
        `select measured_quantity as q, rate_per_hour as rate,
                utilization_factor as util, hours_at_this_rate as hours
           from estimate_line_production where line_item_id = $1`, [line]);
      const expected = Number(r!.q) / (Number(r!.rate) * Number(r!.util));
      expect(Number(r!.hours)).toBeCloseTo(expected, 1);
    });

    it('offers no hours when the rate is measured in another unit', async () => {
      /*
       * A rate in LF against a line in CY does not describe this line's hours,
       * and a plausible-looking number would be worse than a blank.
       */
      const [other] = await asChief<{ id: string }>(
        `select id from production_rates
          where company_id is null and rate_unit <> 'CY' and status = 'active' limit 1`);
      await h.asService(() => h.sql(
        `update estimate_line_items set production_rate_id = $2 where id = $1`,
        [line, other!.id]));
      const [r] = await asChief<{ hours: string | null }>(
        `select hours_at_this_rate as hours from estimate_line_production
          where line_item_id = $1`, [line]);
      expect(r!.hours).toBeNull();
      // Put it back for the tests that follow.
      const [best] = await asChief<{ rate_id: string }>(
        `select rate_id from app.line_production_options($1) where rank = 1`, [line]);
      await h.asService(() => h.sql(
        `update estimate_line_items set production_rate_id = $2 where id = $1`,
        [line, best!.rate_id]));
    });
  });

  describe('the ordering, in one place', () => {
    it('is the ordering the line was actually built with', async () => {
      /*
       * `add_estimate_line` used to hold this ranking inline. If the two ever
       * disagreed, a screen would explain a choice the code did not make.
       */
      const [best] = await asChief<{ rate_id: string }>(
        `select rate_id from app.line_production_options($1) where rank = 1`, [line]);
      const fresh = (await asChief<{ id: string }>(
        `select app.add_estimate_line($1,$2,null,10) as id`, [version, service]))[0]!.id;
      const [r] = await asChief<{ production_rate_id: string }>(
        `select production_rate_id from estimate_line_items where id = $1`, [fresh]);
      expect(r!.production_rate_id).toBe(best!.rate_id);
    });

    it("puts a rate in the line's own unit ahead of one that is not", async () => {
      const rows = await asChief<{ unit_matches: boolean; rank: number }>(
        `select unit_matches, rank from app.line_production_options($1) order by rank`, [line]);
      const firstMismatch = rows.findIndex((r) => !r.unit_matches);
      if (firstMismatch >= 0) {
        expect(rows.slice(0, firstMismatch).every((r) => r.unit_matches)).toBe(true);
      }
      expect(rows.length).toBeGreaterThan(1);
    });

    it('marks which one the line is on now', async () => {
      const rows = await asChief<{ is_current: boolean }>(
        `select is_current from app.line_production_options($1)`, [line]);
      expect(rows.filter((r) => r.is_current)).toHaveLength(1);
    });
  });

  describe('choosing another', () => {
    it('moves the line onto it', async () => {
      const rows = await asChief<{ rate_id: string }>(
        `select rate_id from app.line_production_options($1)
          where unit_matches and not is_current order by rank limit 1`, [line]);
      if (rows.length === 0) return;
      await asChief(`select app.set_line_production_rate($1,$2)`, [line, rows[0]!.rate_id]);
      const [r] = await asChief<{ production_rate_id: string }>(
        `select production_rate_id from estimate_line_items where id = $1`, [line]);
      expect(r!.production_rate_id).toBe(rows[0]!.rate_id);
    });

    it('refuses a rate measured in a unit the line is not bid in', async () => {
      const [other] = await asChief<{ id: string }>(
        `select id from production_rates
          where company_id is null and rate_unit <> 'CY' and status = 'active' limit 1`);
      await expect(asChief(`select app.set_line_production_rate($1,$2)`, [line, other!.id]))
        .rejects.toThrow(/measured in .* and .* is bid in CY/i);
    });

    it('refuses a rate from another company', async () => {
      const [t] = await asChief<{ id: string }>(
        `select id from tasks where company_id is null limit 1`);
      const theirs = (await h.asUser(rival, () => h.sql<{ id: string }>(
        `select app.record_production_actual($1, 90, 'CY', 4, 'Ours', null, $2) as id`,
        [t!.id, rivalCompany])))[0]!.id;
      await expect(asChief(`select app.set_line_production_rate($1,$2)`, [line, theirs]))
        .rejects.toThrow(/not in your library/i);
    });

    it('can be cleared, because no rate is a real answer for a lump sum', async () => {
      await asChief(`select app.set_line_production_rate($1,null)`, [line]);
      const [r] = await asChief<{ production_rate_id: string | null }>(
        `select production_rate_id from estimate_line_items where id = $1`, [line]);
      expect(r!.production_rate_id).toBeNull();
    });
  });

  describe('overriding it with your own number', () => {
    let overrideId = '';

    beforeAll(async () => {
      overrideId = (await h.asUser(chief, () => h.sql<{ id: string }>(
        `select app.override_line_production($1, 240, 'Our crew ran this at 240 on the last two ponds') as id`,
        [line])))[0]!.id;
    });

    it('files a rate rather than writing a hidden number', async () => {
      const [r] = await asChief<{ source_type: string; company_id: string;
                                  rate_per_hour: string; approval_state: string }>(
        `select source_type, company_id, rate_per_hour, approval_state
           from production_rates where id = $1`, [overrideId]);
      expect(r!.source_type).toBe('estimator_judgment');
      expect(r!.company_id).toBe(company);
      expect(Number(r!.rate_per_hour)).toBe(240);
      expect(r!.approval_state).toBe('pending');
    });

    it('keeps the reason the estimator gave, on the record', async () => {
      const [r] = await asChief<{ controlling_resource: string }>(
        `select controlling_resource from production_rates where id = $1`, [overrideId]);
      expect(r!.controlling_resource).toMatch(/last two ponds/);
    });

    it('points the line at it', async () => {
      const [r] = await asChief<{ production_rate_id: string; is_own_rate: boolean }>(
        `select production_rate_id, is_own_rate from estimate_line_production
          where line_item_id = $1`, [line]);
      expect(r!.production_rate_id).toBe(overrideId);
      expect(r!.is_own_rate).toBe(true);
    });

    it('scores below a measured actual, because it has not been measured', async () => {
      const [r] = await asChief<{ c: string }>(
        `select confidence_score as c from production_rates where id = $1`, [overrideId]);
      expect(Number(r!.c)).toBeLessThan(0.6);
    });

    it('refuses a rate with no reason worth reading', async () => {
      await expect(asChief(
        `select app.override_line_production($1, 300, 'faster')`, [line]))
        .rejects.toThrow(/why this rate is right/i);
    });

    it('refuses a rate of zero or below', async () => {
      await expect(asChief(
        `select app.override_line_production($1, 0, 'Because it is instantaneous')`, [line]))
        .rejects.toThrow(/above zero/i);
    });
  });

  describe('recording what the company has measured', () => {
    let task = '';

    beforeAll(async () => {
      const [t] = await h.sql<{ id: string }>(
        `select id from tasks where company_id is null limit 1`);
      task = t!.id;
    });

    it('files it as a company actual, which outranks the shipped benchmark', async () => {
      const id = (await asChief<{ id: string }>(
        `select app.record_production_actual($1, 310, 'CY', 6, 'Six jobs, 2026', null, $2) as id`,
        [task, company]))[0]!.id;
      const [r] = await asChief<{ source_type: string; sample_size: number;
                                  approval_state: string; confidence_score: string }>(
        `select source_type, sample_size, approval_state, confidence_score
           from production_rates where id = $1`, [id]);
      expect(r!.source_type).toBe('company_actual');
      expect(r!.sample_size).toBe(6);
      expect(r!.approval_state).toBe('approved');
      expect(Number(r!.confidence_score)).toBeGreaterThan(0.8);
    });

    it('grows confidence with the sample, and stops', async () => {
      const one = (await asChief<{ id: string }>(
        `select app.record_production_actual($1, 300, 'CY', 1, 'Once', null, $2) as id`,
        [task, company]))[0]!.id;
      const many = (await asChief<{ id: string }>(
        `select app.record_production_actual($1, 300, 'CY', 40, 'Forty times', null, $2) as id`,
        [task, company]))[0]!.id;
      const rows = await asChief<{ id: string; c: string }>(
        `select id, confidence_score as c from production_rates where id in ($1,$2)`, [one, many]);
      const conf = Object.fromEntries(rows.map((r) => [r.id, Number(r.c)]));
      expect(conf[one]).toBeLessThan(conf[many]!);
      expect(conf[many]).toBeLessThanOrEqual(0.95);
    });

    it('refuses a company actual nobody actually measured', async () => {
      await expect(asChief(
        `select app.record_production_actual($1, 300, 'CY', 0, 'Feels right', null, $2)`,
        [task, company]))
        .rejects.toThrow(/how many times this was measured/i);
    });

    it("shows a company its own rates beside the platform's, and not its neighbor's", async () => {
      const mine = await asChief<{ n: string }>(
        `select count(*) as n from my_production_rates where is_own`);
      const theirs = await h.asUser(rival, () => h.sql<{ n: string }>(
        `select count(*) as n from my_production_rates where is_own`));
      expect(Number(mine[0]!.n)).toBeGreaterThan(0);
      expect(Number(theirs[0]!.n)).toBe(1);
      const [platform] = await asChief<{ n: string }>(
        `select count(*) as n from my_production_rates where not is_own`);
      expect(Number(platform!.n)).toBeGreaterThan(1000);
    });
  });

  describe('a version that is no longer open', () => {
    it('refuses every one of them', async () => {
      const e = (await asChief<{ id: string }>(
        `select app.create_estimate('Frozen rates', null, null, null, $1) as id`,
        [company]))[0]!.id;
      const v = (await asChief<{ v: string }>(
        `select current_version_id as v from estimates where id = $1`, [e]))[0]!.v;
      const l = (await asChief<{ id: string }>(
        `select app.add_estimate_line($1,$2,null,10) as id`, [v, service]))[0]!.id;
      await h.asService(() => h.sql(
        `update estimate_versions set status = 'archived' where id = $1`, [v]));

      await expect(asChief(`select app.set_line_production_rate($1,null)`, [l]))
        .rejects.toThrow(/make a new version/i);
      await expect(asChief(
        `select app.override_line_production($1, 100, 'A perfectly good reason here')`, [l]))
        .rejects.toThrow(/make a new version/i);
    });
  });
});
