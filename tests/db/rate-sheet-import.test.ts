/**
 * A rate sheet from your dealer.
 *
 * Equipment rates were seed-only: they arrived when the catalog was built and
 * could not be added to afterwards except one row at a time. A company with a
 * four-hundred-line rental sheet had four hundred afternoons of typing ahead of
 * them, which in practice means the sheet stays in the inbox and the estimates
 * keep pricing at the published national figure.
 *
 * What this has to get right is the refusals. A rate that arrives wrong is
 * worse than one that does not arrive, because only one of them is visible.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

interface Report {
  priced: number;
  machines_created: number;
  rejected: Array<{ name: string; reason: string }>;
  needs_review: Array<{ name: string; why: string }>;
  approved: boolean;
}

describe('a rate sheet from your dealer', () => {
  let h: Harness;
  const chief  = '11111111-1111-4111-8111-111111111111';
  const senior = '22222222-2222-4222-8222-222222222222';
  const clerk  = '33333333-3333-4333-8333-333333333333';
  let company = '';

  const as = <T,>(who: string, q: string, p?: unknown[]) =>
    h.asUser(who, () => h.sql<T extends object ? T : never>(q, p));
  const sql = <T,>(q: string, p?: unknown[]) => as<T>(chief, q, p);

  const load = (rows: Record<string, string>[], who = chief) =>
    as<{ report: Report }>(who,
      `select import_equipment_rates($1::uuid, $2::jsonb) as report`,
      [company, JSON.stringify(rows)]).then((r) => r[0]!.report);

  beforeAll(async () => {
    h = await createHarness({ seed: 'full' });
    for (const [id, e] of [[chief,'c@r.test'],[senior,'s@r.test'],[clerk,'k@r.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, e]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, e]);
    }
    company = (await sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`))[0]!.id;
    for (const [who, role] of [[senior,'senior_estimator'],[clerk,'estimator']] as const) {
      await h.sql(`insert into company_memberships (company_id, user_id, role_id, status)
                   select $1, $2, r.id, 'active' from roles r
                   where r.company_id is null and r.key = $3 limit 1`, [company, who, role]);
    }
  }, 300_000);

  afterAll(async () => { await h?.db.close(); });

  // ------------------------------------------------------------ the published tier
  describe('what the platform already knows', () => {
    it('ships a published rate on every machine in the schedule', async () => {
      const [r] = await sql<{ machines: string; rated: string }>(
        `select count(*)::text as machines,
                count(*) filter (where exists (
                  select 1 from equipment_rates x
                   where x.equipment_id = e.id and x.source = 'global_seed'))::text as rated
           from equipment e
          where e.company_id is null
            and e.source = 'FEMA Schedule of Equipment Rates 2025'`);
      expect(Number(r!.machines)).toBe(458);
      expect(r!.rated).toBe(r!.machines);
    });

    it('burns no fuel on them, because the rate already includes it', async () => {
      // RULE-001 keeps the buckets apart; this keeps them from overlapping. A
      // fuel-inclusive rate plus a fuel burn charges the same gallon twice.
      const [r] = await sql<{ n: string }>(
        `select count(*)::text as n from equipment
          where company_id is null and source = 'FEMA Schedule of Equipment Rates 2025'
            and fuel_gallons_per_hour <> 0`);
      expect(Number(r!.n)).toBe(0);
    });

    it('carries no operator, because the schedule excludes labor', async () => {
      const [r] = await sql<{ n: string }>(
        `select count(*)::text as n from equipment
          where company_id is null and source = 'FEMA Schedule of Equipment Rates 2025'
            and operator_required`);
      expect(Number(r!.n)).toBe(0);
    });

    it('says where every one of those rates came from', async () => {
      const [r] = await sql<{ n: string }>(
        `select count(*)::text as n from equipment_rates
          where source = 'global_seed' and company_id is null
            and reference like 'FEMA Schedule of Equipment Rates%'`);
      expect(Number(r!.n)).toBe(458);
    });
  });

  // ------------------------------------------------------------------- importing
  describe('bringing a sheet in', () => {
    it('prices a machine the catalog already has', async () => {
      const [m] = await sql<{ code: string; name: string }>(
        `select code, name from equipment where company_id is null
          and source = 'FEMA Schedule of Equipment Rates 2025' limit 1`);
      const report = await load([{
        equipment: m!.name, hourly_rate: '185.50', daily_rate: '1400',
        weekly_rate: '4200', monthly_rate: '11000',
        region: 'Northwest Ohio', reference: 'Cat dealer sheet, September 2026',
      }]);
      expect(report.priced).toBe(1);
      expect(report.rejected).toEqual([]);

      const [r] = await sql<{ hourly: string; daily: string; src: string }>(
        `select r.hourly_rate::text as hourly, r.daily_rate::text as daily, r.source::text as src
           from equipment_rates r join equipment e on e.id = r.equipment_id
          where r.company_id = $1 and e.name = $2`, [company, m!.name]);
      expect(Number(r!.hourly)).toBe(185.5);
      expect(Number(r!.daily)).toBe(1400);
      // The company's own rate outranks the published one under RULE-003.
      expect(r!.src).toBe('tenant_approved');
    });

    it('makes a machine the sheet has and the catalog does not, and says what it had to leave blank', async () => {
      const report = await load([{
        equipment: 'Cat 336 Hydraulic Excavator', equipment_class: 'Earthmoving Equipment',
        hourly_rate: '210.00', reference: 'Cat dealer sheet',
      }]);
      expect(report.machines_created).toBe(1);
      expect(report.needs_review.map((r) => r.why).join(' '))
        .toMatch(/did not say how much fuel it burns or whether it carries an operator/);
    });

    it('refuses a rate sheet line with no hourly rate rather than dividing the day', async () => {
      /*
       * A rental day is a calendar day, not eight hours of work. Dividing it
       * would put an assumption nobody stated at the bottom of every estimate
       * using the machine.
       */
      const report = await load([{
        equipment: 'Cat 320 Excavator', daily_rate: '980', hourly_rate: '',
      }]);
      expect(report.priced).toBe(0);
      expect(report.rejected[0]!.reason).toMatch(/A rental day is a calendar day/);
    });

    it('refuses a negative rate', async () => {
      const report = await load([{ equipment: 'Cat 299D', hourly_rate: '-5' }]);
      expect(report.rejected[0]!.reason).toMatch(/zero or more/);
    });

    it('refuses a line with no machine on it at all', async () => {
      const report = await load([{ equipment: '', hourly_rate: '90' }]);
      expect(report.rejected[0]!.reason).toMatch(/A rate with no equipment on it is not a rate/);
    });

    it('replaces rather than duplicates when the same sheet is loaded twice', async () => {
      const row = { equipment: 'Cat 963 Track Loader', hourly_rate: '145',
                    effective_date: '2026-09-01' };
      await load([row]);
      const second = await load([{ ...row, hourly_rate: '152' }]);
      expect(second.priced).toBe(0);          // nothing new
      const [r] = await sql<{ n: string; hourly: string }>(
        `select count(*)::text as n, max(hourly_rate)::text as hourly
           from equipment_rates r join equipment e on e.id = r.equipment_id
          where r.company_id = $1 and e.name = 'Cat 963 Track Loader'`, [company]);
      expect(Number(r!.n)).toBe(1);
      expect(Number(r!.hourly)).toBe(152);    // and the new price won
    });

    it('creates the equipment class it was given, because the column is governed', async () => {
      await load([{ equipment: 'Cat 745 Articulated Truck',
                    equipment_class: 'Dealer Rental Fleet', hourly_rate: '175' }]);
      const [r] = await sql<{ n: string }>(
        `select count(*)::text as n from library_categories
          where kind = 'equipment_class' and name = 'Dealer Rental Fleet'
            and company_id = $1`, [company]);
      expect(Number(r!.n)).toBe(1);
    });
  });

  // ------------------------------------------------------------------ permission
  describe('who may load one', () => {
    it('refuses somebody who may only read the library', async () => {
      await expect(load([{ equipment: 'Anything', hourly_rate: '10' }], clerk))
        .rejects.toThrow(/libraries.write/);
    });

    it('takes the sheet from somebody who cannot approve, and holds it pending', async () => {
      const report = await load([{ equipment: 'Cat 950 Wheel Loader', hourly_rate: '160' }], senior);
      expect(report.approved).toBe(false);
      const [r] = await sql<{ state: string }>(
        `select approval_state::text as state
           from equipment_rates r join equipment e on e.id = r.equipment_id
          where r.company_id = $1 and e.name = 'Cat 950 Wheel Loader'`, [company]);
      expect(r!.state).toBe('pending');
    });
  });
});
