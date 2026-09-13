/**
 * Doors for the people and the machines.
 *
 * Fleet shipped with "Add asset" and "Work order" in its header and Workforce
 * with "Add employee", and not one of the three had a click handler. They were
 * painted on. So a company that signed up could not record a single machine or
 * a single member of staff — and because the clock matches a punch to a login
 * through `employees.user_id` (migration 0122), the person who created the
 * company had nothing to punch and was told so every morning.
 *
 * What these hold down is mostly what the functions refuse: a company the
 * caller does not belong to, a permission they do not hold, a second employee
 * row pointing at the same login, and a number a screen tried to pick for
 * itself. The numbering is the part that cannot be checked by reading — each of
 * these tables is unique on (company_id, number), so two people adding at the
 * same moment must not collide.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('doors for the people and the machines', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  const rival = '22222222-2222-4222-8222-222222222222';
  const viewer = '33333333-3333-4333-8333-333333333333';
  let mine = '';
  let theirs = '';

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

    /* A viewer holds the read permissions and none of the write ones, which is
       what separates somebody who may look at the roster from somebody who may
       add to it. */
    await h.asService(() => h.sql(
      `insert into company_memberships (company_id, user_id, role_id, status)
       select $1, $2, r.id, 'active' from roles r where r.key = 'viewer'
       on conflict do nothing`, [mine, viewer]));
  }, 240_000);

  afterAll(async () => { await h?.db.close(); });

  describe('somebody who works here', () => {
    it('numbers them, so a screen never has to', async () => {
      const [a] = await asOwner<{ id: string }>(
        `select app.create_employee($1,'Dale','Whitfield') as id`, [mine]);
      const [b] = await asOwner<{ id: string }>(
        `select app.create_employee($1,'Marta','Ruiz') as id`, [mine]);
      const rows = await asOwner<{ employee_number: string }>(
        `select employee_number from employees where id in ($1,$2)
         order by employee_number`, [a!.id, b!.id]);
      expect(rows.map((r) => r.employee_number)).toEqual(['EMP-0001', 'EMP-0002']);
    });

    it('starts active, because adding somebody is what that means', async () => {
      const [r] = await asOwner<{ id: string }>(
        `select app.create_employee($1,'Ben','Hollis') as id`, [mine]);
      const [row] = await asOwner<{ status: string; user_id: string | null }>(
        `select status, user_id from employees where id = $1`, [r!.id]);
      expect(row!.status).toBe('active');
      // Not linked to anybody's login unless asked for.
      expect(row!.user_id).toBeNull();
    });

    it('refuses somebody with no name', async () => {
      await expect(asOwner(`select app.create_employee($1,'   ','')`, [mine]))
        .rejects.toThrow(/first and a last name/i);
    });

    it('links the caller to their own record when asked, so they can clock in', async () => {
      const [r] = await asOwner<{ id: string }>(
        `select app.create_employee($1,'Tyree','Myers',null,null,'full_time',
                                    null,null,null,true) as id`, [mine]);
      const [row] = await asOwner<{ user_id: string | null }>(
        `select user_id from employees where id = $1`, [r!.id]);
      expect(row!.user_id).toBe(owner);
    });

    it('refuses a second record for the same login, which punch_in would find twice', async () => {
      await expect(asOwner(
        `select app.create_employee($1,'Tyree','Myers',null,null,'full_time',
                                    null,null,null,true)`, [mine]))
        .rejects.toThrow(/already have an employee record/i);
    });

    it('refuses somebody who only reads the roster', async () => {
      await expect(as(viewer, `select app.create_employee($1,'Ann','Poole')`, [mine]))
        .rejects.toThrow(/permission/i);
    });

    it('refuses a company the caller does not belong to, without confirming it exists',
      async () => {
        await expect(asOwner(`select app.create_employee($1,'Ann','Poole')`, [theirs]))
          .rejects.toThrow(/No such company/i);
      });
  });

  describe('a machine you own', () => {
    it('numbers it and starts it available, never assigned', async () => {
      const [r] = await asOwner<{ id: string }>(
        `select app.create_asset($1,'Excavator 1') as id`, [mine]);
      const [row] = await asOwner<{ asset_number: string; status: string;
                                   assigned_project_id: string | null }>(
        `select asset_number, status, assigned_project_id from assets where id = $1`, [r!.id]);
      expect(row!.asset_number).toBe('EQ-0001');
      expect(row!.status).toBe('available');
      expect(row!.assigned_project_id).toBeNull();
    });

    it('leaves the catalog rate unset rather than guessing one', async () => {
      const [r] = await asOwner<{ id: string }>(
        `select app.create_asset($1,'Dozer 3') as id`, [mine]);
      const [row] = await asOwner<{ equipment_id: string | null }>(
        `select equipment_id from assets where id = $1`, [r!.id]);
      expect(row!.equipment_id).toBeNull();
    });

    it('names a catalog rate that does not exist rather than failing on a key', async () => {
      await expect(asOwner(
        `select app.create_asset($1,'Loader 2',null,null,null,null,null,'owned',
                                 'hours',null,null,null,
                                 '99999999-9999-4999-8999-999999999999'::uuid)`, [mine]))
        .rejects.toThrow(/catalog rate does not exist/i);
    });

    it('refuses a machine with no name', async () => {
      await expect(asOwner(`select app.create_asset($1,'  ')`, [mine]))
        .rejects.toThrow(/needs a name/i);
    });

    it('refuses a company the caller does not belong to', async () => {
      await expect(asOwner(`select app.create_asset($1,'Excavator 9')`, [theirs]))
        .rejects.toThrow(/No such company/i);
    });
  });

  describe('something wrong with a machine', () => {
    let asset = '';
    beforeAll(async () => {
      asset = (await asOwner<{ id: string }>(
        `select app.create_asset($1,'Excavator 4412') as id`, [mine]))[0]!.id;
    });

    it('reads the company off the machine rather than taking it from the caller', async () => {
      const [r] = await asOwner<{ id: string }>(
        `select app.create_work_order($1,'Hydraulic leak, left final drive') as id`, [asset]);
      const [row] = await asOwner<{ company_id: string; number: string; status: string }>(
        `select company_id, number, status from work_orders where id = $1`, [r!.id]);
      expect(row!.company_id).toBe(mine);
      expect(row!.number).toBe('WO-0001');
      expect(row!.status).toBe('open');
    });

    it('opens with no costs on it, because those are what the work took', async () => {
      const [r] = await asOwner<{ id: string }>(
        `select app.create_work_order($1,'Track tension') as id`, [asset]);
      const [row] = await asOwner<{ labor_cost: string; parts_cost: string;
                                   outside_cost: string; downtime_hours: string }>(
        `select labor_cost, parts_cost, outside_cost, downtime_hours
         from work_orders where id = $1`, [r!.id]);
      expect(Number(row!.labor_cost)).toBe(0);
      expect(Number(row!.parts_cost)).toBe(0);
      expect(Number(row!.outside_cost)).toBe(0);
      expect(Number(row!.downtime_hours)).toBe(0);
    });

    it('refuses a work order with no title saying what is wrong', async () => {
      await expect(asOwner(`select app.create_work_order($1,'   ')`, [asset]))
        .rejects.toThrow(/needs a title/i);
    });

    it('refuses a machine that is not the callers, without confirming it exists', async () => {
      const theirAsset = (await as<{ id: string }>(rival,
        `select app.create_asset($1,'Their loader') as id`, [theirs]))[0]!.id;
      await expect(asOwner(`select app.create_work_order($1,'Anything')`, [theirAsset]))
        .rejects.toThrow(/No such (machine|company)/i);
    });
  });

  describe('the doors a browser uses', () => {
    it('are reachable under public, which is the only schema PostgREST exposes', async () => {
      const rows = await asOwner<{ proname: string }>(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('create_employee','create_asset','create_work_order')
         order by p.proname`);
      expect(rows.map((r) => r.proname))
        .toEqual(['create_asset', 'create_employee', 'create_work_order']);
    });

    it('are closed to anybody who is not signed in', async () => {
      const rows = await h.sql<{ proname: string; has: boolean }>(
        `select p.proname, has_function_privilege('anon', p.oid, 'execute') as has
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('create_employee','create_asset','create_work_order')`);
      expect(rows.every((r) => r.has === false)).toBe(true);
    });
  });
});
