/**
 * Doors for the rest of the toolbar.
 *
 * Nine controls that rendered and could not do anything: Create project, New
 * RFQ, Purchase order, Report incident, Toolbox talk, Pay application, Submit,
 * Add material, Add vendor. Every table behind them has been governed since
 * 0007, 0017 or 0021 and none of them had a writer, so a company could read a
 * screen it had no way of adding to.
 *
 * What these hold down is mostly the refusals: a company the caller does not
 * belong to, a permission they do not hold, a period that ends before it
 * starts, an incident that has not happened yet, a waste factor nobody can
 * check, and a second submission of an application that is already evidence.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('doors for the rest of the toolbar', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  const rival = '22222222-2222-4222-8222-222222222222';
  const viewer = '33333333-3333-4333-8333-333333333333';
  let mine = '';
  let theirs = '';
  let project = '';
  let vendor = '';

  const as = <T,>(who: string, q: string, p?: unknown[]) =>
    h.asUser(who, () => h.sql<T extends object ? T : never>(q, p));
  const asOwner = <T,>(q: string, p?: unknown[]) => as<T>(owner, q, p);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, mail] of [
      [owner, 'o@r.test'], [rival, 'r@k.test'], [viewer, 'v@r.test'],
    ] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, mail]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, mail]);
    }
    mine = (await asOwner<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`))[0]!.id;
    theirs = (await as<{ id: string }>(rival,
      `select app.provision_company('Kesler','kesler','enterprise') as id`))[0]!.id;
    await h.asService(() => h.sql(
      `insert into company_memberships (company_id, user_id, role_id, status)
       select $1, $2, r.id, 'active' from roles r where r.key = 'viewer'
       on conflict do nothing`, [mine, viewer]));

    project = (await asOwner<{ id: string }>(
      `select app.create_project($1, 'Monroe Street storm repair') as id`, [mine]))[0]!.id;
    vendor = (await asOwner<{ id: string }>(
      `select app.create_vendor($1, 'Toledo Aggregates') as id`, [mine]))[0]!.id;
  }, 240_000);

  afterAll(async () => { await h?.db.close(); });

  describe('a job that never had an estimate', () => {
    it('numbers it per company and per year', async () => {
      const [row] = await asOwner<{ number: string; status: string }>(
        `select number, status from projects where id = $1`, [project]);
      expect(row!.number).toMatch(/^PRJ-\d{4}-0001$/);
      expect(row!.status).toBe('preconstruction');
    });

    it('opens with no budget, because nothing priced it', async () => {
      const [row] = await asOwner<{ original_budget: string; approved_budget: string }>(
        `select original_budget, approved_budget from projects where id = $1`, [project]);
      expect(Number(row!.original_budget)).toBe(0);
      expect(Number(row!.approved_budget)).toBe(0);
    });

    it('refuses a project with no name', async () => {
      await expect(asOwner(`select app.create_project($1, '  ')`, [mine]))
        .rejects.toThrow(/needs a name/i);
    });

    it('refuses a customer that is not the callers', async () => {
      const theirCustomer = (await as<{ id: string }>(rival,
        `insert into customers (company_id, code, name) values ($1,'C-1','Kesler Co')
         returning id`, [theirs]))[0]!.id;
      await expect(asOwner(
        `select app.create_project($1, 'Anything', $2::uuid)`, [mine, theirCustomer]))
        .rejects.toThrow(/not one of yours/i);
    });

    it('refuses somebody who only reads', async () => {
      await expect(as(viewer, `select app.create_project($1, 'Anything')`, [mine]))
        .rejects.toThrow(/permission/i);
    });
  });

  describe('buying something', () => {
    it('opens in draft with nothing committed', async () => {
      const [r] = await asOwner<{ id: string }>(
        `select app.create_purchase_order($1, $2, 'Storm structures') as id`, [mine, vendor]);
      const [row] = await asOwner<{ number: string; status: string; committed_amount: string }>(
        `select number, status, committed_amount from purchase_orders where id = $1`, [r!.id]);
      expect(row!.number).toBe('PO-0001');
      expect(row!.status).toBe('draft');
      expect(Number(row!.committed_amount)).toBe(0);
    });

    it('refuses a vendor that is not the callers', async () => {
      const theirVendor = (await as<{ id: string }>(rival,
        `select app.create_vendor($1, 'Kesler Supply') as id`, [theirs]))[0]!.id;
      await expect(asOwner(
        `select app.create_purchase_order($1, $2, 'Anything')`, [mine, theirVendor]))
        .rejects.toThrow(/not one of yours/i);
    });

    it('refuses a purchase order with no title', async () => {
      await expect(asOwner(`select app.create_purchase_order($1, $2, '   ')`, [mine, vendor]))
        .rejects.toThrow(/needs a title/i);
    });
  });

  describe('asking for quotes', () => {
    it('opens in draft, unawarded', async () => {
      const [r] = await asOwner<{ id: string }>(
        `select app.create_rfq($1, 'Aggregate supply') as id`, [mine]);
      const [row] = await asOwner<{ number: string; status: string;
                                   awarded_vendor_id: string | null }>(
        `select number, status, awarded_vendor_id from rfqs where id = $1`, [r!.id]);
      expect(row!.number).toBe('RFQ-0001');
      expect(row!.status).toBe('draft');
      expect(row!.awarded_vendor_id).toBeNull();
    });
  });

  describe('something that happened on site', () => {
    it('records it with the investigation open', async () => {
      const [r] = await asOwner<{ id: string }>(
        `select app.create_safety_incident($1, now() - interval '2 hours',
                'near_miss', 'Bucket swung over a groundman.') as id`, [mine]);
      const [row] = await asOwner<{ number: string; investigation_state: string;
                                   is_osha_recordable: boolean }>(
        `select number, investigation_state, is_osha_recordable
         from safety_incidents where id = $1`, [r!.id]);
      expect(row!.number).toBe('INC-0001');
      expect(row!.investigation_state).toBe('open');
      // Recordability is a determination a person makes, never inferred here.
      expect(row!.is_osha_recordable).toBe(false);
    });

    it('refuses one that has not happened yet', async () => {
      await expect(asOwner(
        `select app.create_safety_incident($1, now() + interval '1 day',
                'near_miss', 'Something.')`, [mine]))
        .rejects.toThrow(/has happened/i);
    });

    it('refuses one with no description', async () => {
      await expect(asOwner(
        `select app.create_safety_incident($1, now(), 'near_miss', '  ')`, [mine]))
        .rejects.toThrow(/description of what happened/i);
    });
  });

  describe('the talk before the shift', () => {
    it('records the topic and who was there', async () => {
      const [r] = await asOwner<{ id: string }>(
        `select app.create_toolbox_talk($1, current_date, 'Trench entry and egress', 7) as id`,
        [mine]);
      const [row] = await asOwner<{ topic: string; attendee_count: number }>(
        `select topic, attendee_count from toolbox_talks where id = $1`, [r!.id]);
      expect(row!.topic).toBe('Trench entry and egress');
      expect(Number(row!.attendee_count)).toBe(7);
    });

    it('refuses a briefing dated in the future', async () => {
      await expect(asOwner(
        `select app.create_toolbox_talk($1, current_date + 1, 'Anything', 1)`, [mine]))
        .rejects.toThrow(/has happened/i);
    });
  });

  describe('asking to be paid', () => {
    let application = '';

    it('reads the contract sum off the project rather than the caller', async () => {
      await h.asService(() => h.sql(
        `update projects set contract_value = 250000, retainage_percent = 0.05
         where id = $1`, [project]));
      const [r] = await asOwner<{ id: string }>(
        `select app.create_pay_application($1, current_date - 30, current_date - 1) as id`,
        [project]);
      application = r!.id;
      const [row] = await asOwner<{ application_number: number; contract_sum: string;
                                   retainage_percent: string; status: string }>(
        `select application_number, contract_sum, retainage_percent, status
         from pay_applications where id = $1`, [application]);
      expect(Number(row!.application_number)).toBe(1);
      expect(Number(row!.contract_sum)).toBe(250000);
      expect(Number(row!.retainage_percent)).toBeCloseTo(0.05, 4);
      expect(row!.status).toBe('draft');
    });

    it('numbers the next one after the last', async () => {
      const [r] = await asOwner<{ id: string }>(
        `select app.create_pay_application($1, current_date - 60, current_date - 31) as id`,
        [project]);
      const [row] = await asOwner<{ application_number: number }>(
        `select application_number from pay_applications where id = $1`, [r!.id]);
      expect(Number(row!.application_number)).toBe(2);
    });

    it('refuses a period that ends before it starts', async () => {
      await expect(asOwner(
        `select app.create_pay_application($1, current_date, current_date - 5)`, [project]))
        .rejects.toThrow(/cannot end before it starts/i);
    });

    it('stamps the time in the same statement that leaves draft', async () => {
      await asOwner(`select app.submit_pay_application($1)`, [application]);
      const [row] = await asOwner<{ status: string; submitted_at: string | null }>(
        `select status, submitted_at from pay_applications where id = $1`, [application]);
      expect(row!.status).toBe('submitted');
      expect(row!.submitted_at).not.toBeNull();
    });

    it('refuses to submit one twice, because it is already evidence', async () => {
      await expect(asOwner(`select app.submit_pay_application($1)`, [application]))
        .rejects.toThrow(/already submitted/i);
    });
  });

  describe('a material and a vendor you can add', () => {
    it('numbers the material and files it under the company', async () => {
      const [r] = await asOwner<{ id: string }>(
        `select app.create_material($1, '6" PVC SDR-35', 'LF', 4.25) as id`, [mine]);
      const [row] = await asOwner<{ code: string; origin: string; company_id: string }>(
        `select code, origin, company_id from materials where id = $1`, [r!.id]);
      expect(row!.code).toMatch(/^M-\d{4}$/);
      expect(row!.origin).toBe('company');
      expect(row!.company_id).toBe(mine);
    });

    it('refuses a waste factor that does not say what it is based on', async () => {
      await expect(asOwner(
        `select app.create_material($1, 'Stone', 'TON', 22.00, null, 0.10, null)`, [mine]))
        .rejects.toThrow(/what it is based on/i);
    });

    it('takes one that does', async () => {
      const [r] = await asOwner<{ id: string }>(
        `select app.create_material($1, 'Stone', 'TON', 22.00, null, 0.10,
                'Supplier allowance on the quote') as id`, [mine]);
      const [row] = await asOwner<{ waste_basis: string }>(
        `select waste_basis from materials where id = $1`, [r!.id]);
      expect(row!.waste_basis).toBe('Supplier allowance on the quote');
    });

    it('adds a vendor unqualified, because qualification is a finding', async () => {
      const [row] = await asOwner<{ code: string; is_qualified: boolean }>(
        `select code, is_qualified from vendors where id = $1`, [vendor]);
      expect(row!.code).toMatch(/^V-\d{4}$/);
      expect(row!.is_qualified).toBe(false);
    });
  });

  describe('the doors a browser uses', () => {
    it('are all reachable under public', async () => {
      const rows = await asOwner<{ proname: string }>(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in (
           'create_project','create_purchase_order','create_rfq','create_safety_incident',
           'create_toolbox_talk','create_pay_application','submit_pay_application',
           'create_material','create_vendor')
         order by p.proname`);
      expect(rows.map((r) => r.proname)).toEqual([
        'create_material', 'create_pay_application', 'create_project',
        'create_purchase_order', 'create_rfq', 'create_safety_incident',
        'create_toolbox_talk', 'create_vendor', 'submit_pay_application',
      ]);
    });

    it('are closed to anybody not signed in', async () => {
      const rows = await h.sql<{ has: boolean }>(
        `select has_function_privilege('anon', p.oid, 'execute') as has
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname like 'create_%'`);
      expect(rows.every((r) => r.has === false)).toBe(true);
    });
  });
});
