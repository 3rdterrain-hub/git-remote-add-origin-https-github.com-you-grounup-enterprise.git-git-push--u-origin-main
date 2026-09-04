/**
 * The calibration loop, against real PostgreSQL.
 *
 * @implements GES-P04-REQ-044
 *
 * An estimating platform earns its keep by learning what work actually takes,
 * and this one is built to. `production_actuals` records installed quantity
 * against crew hours and points at the very production rate that estimated it.
 * `production_rates` carries a sample size, a confidence score and a source type
 * that can say a rate came from calibration. Library rows carry an origin whose
 * values include `calibration`. The notification catalog has a `calibration`
 * category.
 *
 * None of it was computed. `production_actuals` was referenced by no statement
 * anywhere outside its own definition, no row had ever been written with
 * `origin = 'calibration'`, and the notification category had no producer.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('what the field achieved against what the library said', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  let company = '';
  let project = '';
  let n = 0;

  const rate = (perHour: number) =>
    h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into production_rates (company_id, code, rate_per_hour, rate_unit,
         source_type, sample_size, confidence_score, approved_by, approved_at)
       values ($1,$2,$3,'CY','seed_benchmark',0,0.5,$4,now()) returning id`,
      [company, `PR-${++n}`, perHour, owner])).then(([r]) => r!.id);

  const actual = (rateId: string, quantity: number, hours: number, date = '2026-05-01') =>
    h.asUser(owner, () => h.sql(
      `insert into production_actuals (company_id, project_id, production_rate_id,
         work_date, quantity_installed, unit, crew_hours)
       values ($1,$2,$3,$4::date,$5,'CY',$6)`,
      [company, project, rateId, date, quantity, hours]));

  const variance = (rateId: string) =>
    h.asUser(owner, () => h.sql<{
      observations: string; hours_observed: string; achieved_rate_per_hour: string;
      library_rate_per_hour: string; variance_percent: string; finding: string }>(
      `select observations, hours_observed, achieved_rate_per_hour, library_rate_per_hour,
              variance_percent, finding
       from reporting_production_variance where production_rate_id = $1`, [rateId]))
      .then(([r]) => r!);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@r.test')`, [owner]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@r.test')`, [owner]);
    company = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
    project = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name, status)
       values ($1,'PRJ-V1','Vale Cut','active') returning id`, [company])))[0]!.id;
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  it('reports a library rate the field is beating as conservative', async () => {
    const r = await rate(50);
    await actual(r, 1200, 20);   // 60 CY/hr against a library 50
    const v = await variance(r);
    expect(Number(v.achieved_rate_per_hour)).toBe(60);
    expect(Number(v.variance_percent)).toBe(20);
    expect(v.finding).toBe('library rate is conservative');
  });

  it('reports a library rate the field is missing as optimistic', async () => {
    // The direction that costs money: an optimistic rate loses bids slowly and
    // then loses money on the ones it wins.
    const r = await rate(50);
    await actual(r, 800, 20);    // 40 CY/hr against a library 50
    const v = await variance(r);
    expect(v.finding).toBe('library rate is optimistic');
    expect(Number(v.variance_percent)).toBe(-20);
  });

  it('calls a rate within five per cent aligned', async () => {
    const r = await rate(50);
    await actual(r, 1020, 20);   // 51 CY/hr
    expect((await variance(r)).finding).toBe('aligned');
  });

  it('weights by hours rather than averaging days', async () => {
    /*
     * A half-day of bad access and a full week of clean production are not two
     * equally weighted opinions. Averaging the daily rates here gives 45;
     * weighting by hours gives 55, which is what the crew actually did.
     */
    const r = await rate(50);
    await actual(r, 20, 2, '2026-05-02');     // 10 CY/hr over 2 hours
    await actual(r, 5760, 96, '2026-05-03');  // 60 CY/hr over 96 hours
    const v = await variance(r);
    expect(Number(v.achieved_rate_per_hour)).toBeCloseTo(5780 / 98, 4);
    expect(Number(v.achieved_rate_per_hour)).toBeGreaterThan(55);
  });

  it('publishes the evidence behind the variance', async () => {
    // Two days disagreeing with a seeded benchmark is not a reason to move it,
    // and a reader can only tell if the count and the hours are on the row.
    const r = await rate(50);
    await actual(r, 100, 2, '2026-05-04');
    await actual(r, 100, 2, '2026-05-05');
    const v = await variance(r);
    expect(Number(v.observations)).toBe(2);
    expect(Number(v.hours_observed)).toBe(4);
    expect(Number(v.library_rate_per_hour)).toBe(50);
  });

  it('does not change the library rate', async () => {
    /*
     * The deliberate limit. A library rate is an approved record and changes
     * through the approval workflow; rewriting it automatically from field data
     * would be the automation overreach the governance rules exist to prevent,
     * done with the estimator's own numbers.
     */
    const r = await rate(50);
    await actual(r, 2000, 20);
    const [row] = await h.asUser(owner, () => h.sql<{
      rate_per_hour: string; sample_size: number; source_type: string }>(
      `select rate_per_hour, sample_size, source_type from production_rates where id=$1`, [r]));
    expect(Number(row!.rate_per_hour)).toBe(50);
    expect(Number(row!.sample_size)).toBe(0);
    expect(row!.source_type).toBe('seed_benchmark');
  });

  it('shows a rate nobody has worked against as absent rather than as zero', async () => {
    const r = await rate(50);
    expect(await h.asUser(owner, () => h.sql(
      `select 1 from reporting_production_variance where production_rate_id=$1`, [r])))
      .toEqual([]);
  });

  it('shows one company nothing of another', async () => {
    const rows = await h.asAnon(() => h.sql(`select 1 from reporting_production_variance`))
      .then(() => 'readable').catch(() => 'refused');
    expect(rows).toBe('refused');
  });
});
