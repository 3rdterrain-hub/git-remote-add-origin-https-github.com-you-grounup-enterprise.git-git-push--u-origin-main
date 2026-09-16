/**
 * A shipped row you can make your own.
 *
 * O-026, open since the libraries screen was built. "Copy to company scope" was
 * a disabled button with the reason written on it — honest, and it left the
 * platform shipping 2,819 services, 8,532 tasks, 700 machines, 56 labor
 * classifications, 42 crews and 2,143 production rates that no company could
 * take one of and make its own.
 *
 * The three properties every copy holds, taken from `customize_assembly` (0129):
 * a second call returns the first copy rather than making another, the
 * platform's own row is never touched, and the copy says where it came from.
 *
 * The one worth arguing about is what is *not* copied. A machine arrives without
 * an hourly rate, because RULE-003 decides which rate prices and a copied rate
 * would insert somebody else's number into this company's own precedence.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '1d4d4d4d-4d4d-4d4d-8d4d-4d4d4d4d4d4d';

describe('a shipped row you can make your own', () => {
  let h: Harness;
  let company = '';

  const asOwner = <T>(fn: () => Promise<T>) => h.asUser(OWNER, fn);
  const one = <T>(sql: string, args: unknown[] = []) =>
    asOwner(() => h.sql<T>(sql, args)).then((r) => r[0]!);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@lib.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@lib.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await asOwner(() => h.sql<{ id: string }>(
      `select app.provision_company('Lib Civil','lib-civil','enterprise') as id`)))[0]!.id;
  }, 180_000);

  describe('a service', () => {
    let shipped = '';
    let mine = '';

    it('copies a shipped service into the company library', async () => {
      shipped = (await one<{ id: string }>(
        `select id from services where company_id is null order by code limit 1`)).id;
      mine = (await one<{ id: string }>(
        `select public.adopt_library_row('service',$1,$2) as id`, [shipped, company])).id;
      const row = await one<{
        company_id: string; source: string; code: string; status: string; origin: string;
      }>(`select company_id, source, code, status, origin from services where id = $1`, [mine]);
      expect(row.company_id).toBe(company);
      /*
       * The owner can approve library rows, so their copy is active and
       * approved. Somebody who cannot gets a draft — a row nobody has looked at
       * should not price a bid.
       */
      expect(row.status).toBe('active');
      expect(row.origin).toBe('company');
      expect(row.source).toMatch(/^Copied from /);
      /* Deterministic, so a second call finds this one. */
      expect(row.code).toContain(company.replace(/-/g, '').slice(0, 6));
    });

    it('returns the same copy the second time instead of making another', async () => {
      // Somebody pressing "make it mine" twice means to work on their copy.
      const again = (await one<{ id: string }>(
        `select public.adopt_library_row('service',$1,$2) as id`, [shipped, company])).id;
      expect(again).toBe(mine);
      const [{ n }] = await asOwner(() => h.sql<{ n: string }>(
        `select count(*) as n from services where company_id = $1`, [company]));
      expect(Number(n)).toBe(1);
    });

    it('leaves the shipped row exactly as it was', async () => {
      const row = await one<{ company_id: string | null; source: string | null }>(
        `select company_id, source from services where id = $1`, [shipped]);
      expect(row.company_id).toBeNull();
      expect(row.source ?? '').not.toMatch(/^Copied from /);
    });

    it('shows up in what the company has taken a copy of', async () => {
      const row = await one<{ kind: string; source: string }>(
        `select kind, source from my_library_copies where id = $1`, [mine]);
      expect(row.kind).toBe('service');
      expect(row.source).toMatch(/^Copied from /);
    });
  });

  describe('a machine', () => {
    it('copies the machine and leaves the rate behind', async () => {
      /*
       * RULE-003 decides which rate prices. A copied rate would arrive carrying
       * this company's own precedence while being somebody else's number.
       */
      const shipped = (await one<{ id: string }>(
        `select id from equipment where company_id is null order by code limit 1`)).id;
      const mine = (await one<{ id: string }>(
        `select public.adopt_library_row('equipment',$1,$2) as id`, [shipped, company])).id;
      const [{ n }] = await asOwner(() => h.sql<{ n: string }>(
        `select count(*) as n from equipment_rates where equipment_id = $1`, [mine]));
      expect(Number(n)).toBe(0);
      const row = await one<{ fuel_gallons_per_hour: string; company_id: string }>(
        `select fuel_gallons_per_hour, company_id from equipment where id = $1`, [mine]);
      expect(row.company_id).toBe(company);
    });
  });

  describe('a crew', () => {
    it('copies the crew and the people in it', async () => {
      // A crew copied without its members is an empty crew, which is what the
      // library shipped for forty-two of them before 0187.
      const shipped = (await one<{ id: string }>(
        `select c.id from crews c where c.company_id is null
           and exists (select 1 from crew_members m where m.crew_id = c.id)
         order by c.code limit 1`)).id;
      const [{ n: before }] = await asOwner(() => h.sql<{ n: string }>(
        `select count(*) as n from crew_members where crew_id = $1`, [shipped]));
      const mine = (await one<{ id: string }>(
        `select public.adopt_library_row('crew',$1,$2) as id`, [shipped, company])).id;
      const [{ n: after }] = await asOwner(() => h.sql<{ n: string }>(
        `select count(*) as n from crew_members where crew_id = $1`, [mine]));
      expect(Number(after)).toBe(Number(before));
      expect(Number(after)).toBeGreaterThan(0);
    });
  });

  describe('a production rate', () => {
    it('keeps the source type it had rather than claiming the company measured it', async () => {
      /*
       * Every confidence figure downstream reads `source_type`. A shipped
       * industry rate copied into a company library is still an industry rate
       * until somebody there measures their own.
       */
      const shipped = (await one<{ id: string; source_type: string }>(
        `select id, source_type from production_rates where company_id is null
         order by code limit 1`));
      const mine = (await one<{ id: string }>(
        `select public.adopt_library_row('production_rate',$1,$2) as id`,
        [shipped.id, company])).id;
      const row = await one<{ source_type: string }>(
        `select source_type from production_rates where id = $1`, [mine]);
      expect(row.source_type).toBe(shipped.source_type);
    });
  });

  describe('who made the copy decides whether it can price', () => {
    it('lands as a draft for somebody who cannot approve library rows', async () => {
      /*
       * `services_active_needs_approver` refuses an active company row with
       * nobody named, and the fix is not to stamp the copier as the approver.
       * A senior estimator can write the libraries and cannot approve them, so
       * their copy waits for somebody who can — RULE-008, in one table.
       */
      const SENIOR = '3f6f6f6f-6f6f-4f6f-8f6f-6f6f6f6f6f6f';
      await h.sql(`insert into auth.users (id, email) values ($1,'se@lib.test')`, [SENIOR]);
      await h.sql(`insert into user_profiles (id, email) values ($1,'se@lib.test')
                   on conflict (id) do nothing`, [SENIOR]);
      await h.asService(() => h.sql(
        `insert into company_memberships (company_id, user_id, role_id, status)
         select $1, $2, r.id, 'active' from roles r where r.key = 'senior_estimator'
         on conflict do nothing`, [company, SENIOR]));

      const shipped = (await one<{ id: string }>(
        `select id from tasks where company_id is null order by code desc limit 1`)).id;
      const mine = (await h.asUser(SENIOR, () => h.sql<{ id: string }>(
        `select public.adopt_library_row('task',$1,$2) as id`, [shipped, company])))[0]!.id;
      const row = await one<{ status: string; approved_by: string | null }>(
        `select status, approved_by from tasks where id = $1`, [mine]);
      expect(row.status).toBe('draft');
      expect(row.approved_by).toBeNull();
    });
  });

  describe('what it refuses', () => {
    it('sends a material to the function that already copied one', async () => {
      // Two implementations of the same copy is how this repository ended up
      // with two lead intakes and two set_material_costs.
      await expect(asOwner(() => h.sql(
        `select public.adopt_library_row('material',
           '00000000-0000-0000-0000-000000000001',$1)`, [company])))
        .rejects.toThrow(/copied by pricing it/);
    });

    it('refuses a library that does not exist', async () => {
      await expect(asOwner(() => h.sql(
        `select public.adopt_library_row('sandwiches',
           '00000000-0000-0000-0000-000000000000',$1)`, [company])))
        .rejects.toThrow(/no library called sandwiches/);
    });

    it('refuses to copy into a company the caller is not in', async () => {
      const STRANGER = '2e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e5e';
      await h.sql(`insert into auth.users (id, email) values ($1,'s@lib.test')`, [STRANGER]);
      await h.sql(`insert into user_profiles (id, email) values ($1,'s@lib.test')
                   on conflict (id) do nothing`, [STRANGER]);
      const shipped = (await one<{ id: string }>(
        `select id from tasks where company_id is null order by code limit 1`)).id;
      await expect(h.asUser(STRANGER, () => h.sql(
        `select public.adopt_library_row('task',$1,$2)`, [shipped, company])))
        .rejects.toThrow(/libraries.write permission/);
    });
  });
});
