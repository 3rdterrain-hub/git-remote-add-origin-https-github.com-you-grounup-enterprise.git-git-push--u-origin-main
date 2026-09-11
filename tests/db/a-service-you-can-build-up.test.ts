/**
 * A service nobody can price, given something to fill.
 *
 * Migration 0129 handles the case where a breakdown exists and belongs to
 * somebody else: copy it, change it. It does not handle the case where there is
 * no breakdown at all — 465 services arrived from the product master naming
 * work sequences the task library did not contain, and `customize_assembly`
 * copies an assembly, of which there is none.
 *
 * The block was never the assembly. It was the service: everything that prices
 * a line resolves through `services.default_assembly_id`, and a platform
 * service row is one no tenant may write. So building up a catalog service is
 * two steps that must happen together — the company takes its own copy, and
 * that copy gets an empty sequence — or the result is a company service
 * pointing at nothing, which is the state this exists to remove.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const WRITER = '22222222-2222-4222-8222-222222222222';
const RIVAL = '33333333-3333-4333-8333-333333333333';

describe('starting a breakdown on a service that has none', () => {
  let h: Harness;
  let mine = '';
  let theirs = '';
  let bare = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [[OWNER, 'o@ridge.test'], [WRITER, 'w@ridge.test'],
      [RIVAL, 'r@other.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, email]);
    }
    mine = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','grounup') as id`)))[0]!.id;
    theirs = (await h.asUser(RIVAL, () => h.sql<{ id: string }>(
      `select app.provision_company('Other Co','other-co','grounup') as id`)))[0]!.id;

    /*
     * Senior Estimator: holds `libraries.write` and not `libraries.approve`,
     * which is the whole point of the role and the case this door has to serve.
     */
    await h.asService(() => h.sql(
      `insert into company_memberships (company_id, user_id, role_id, status)
       select $1, $2, r.id, 'active' from roles r where r.key = 'senior_estimator'
       on conflict do nothing`, [mine, WRITER]));

    // A catalog service with no work sequence at all — the case 0129 misses.
    bare = (await h.asService(() => h.sql<{ id: string }>(
      // No category: they are a governed, user-addable list and inventing one
      // here would be testing the fixture rather than the door.
      `insert into services (code, name, default_unit, supported_units,
                             status, source, origin)
       values ('SVC-BARE-0001', 'Sheet pile wall, temporary', 'SF',
               array['SF']::app.unit_code[], 'active', 'GrounUp product master', 'catalog')
       returning id`)))[0]!.id;
  });

  it('lists the service as one nobody can price yet', async () => {
    const rows = await h.asUser(OWNER, () => h.sql<{ code: string; has_no_assembly: boolean }>(
      `select code, has_no_assembly from my_services_without_a_breakdown where code = 'SVC-BARE-0001'`));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.has_no_assembly).toBe(true);
  });

  it('gives the company its own service and an empty sequence to fill', async () => {
    const [a] = await h.asUser(OWNER, () => h.sql<{ id: string; company_id: string; code: string }>(
      `select id, company_id, code from app.start_a_breakdown($1, $2)`, [bare, mine]));

    expect(a!.company_id).toBe(mine);

    const [svc] = await h.sql<{ id: string; company_id: string; default_assembly_id: string }>(
      `select id, company_id, default_assembly_id from services
        where company_id = $1 and code like 'SVC-BARE-0001-%'`, [mine]);
    expect(svc!.default_assembly_id).toBe(a!.id);

    // Empty, deliberately: it is a sequence to fill, not a guess at one.
    const [n] = await h.sql<{ count: number }>(
      `select count(*)::int as count from assembly_components where assembly_id = $1`, [a!.id]);
    expect(n!.count).toBe(0);
  });

  it('leaves the catalog service exactly as it was', async () => {
    // The whole reason for copying: every other company still reads the
    // platform row, and it still has no breakdown until somebody publishes one.
    const [row] = await h.sql<{ company_id: string | null; default_assembly_id: string | null }>(
      `select company_id, default_assembly_id from services where id = $1`, [bare]);
    expect(row!.company_id).toBeNull();
    expect(row!.default_assembly_id).toBeNull();
  });

  it('returns the same sequence when it is asked twice', async () => {
    // A double-click must not leave two half-built sequences behind.
    const [first] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from app.start_a_breakdown($1, $2)`, [bare, mine]));
    const [again] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from app.start_a_breakdown($1, $2)`, [bare, mine]));
    expect(again!.id).toBe(first!.id);

    const [n] = await h.sql<{ count: number }>(
      `select count(*)::int as count from services where company_id = $1 and code like 'SVC-BARE-0001-%'`,
      [mine]);
    expect(n!.count).toBe(1);
  });

  it('takes steps once it has somewhere to put them', async () => {
    const [a] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select id from app.start_a_breakdown($1, $2)`, [bare, mine]));
    const [task] = await h.sql<{ id: string }>(`select id from tasks limit 1`);

    await h.asUser(OWNER, () => h.sql(
      `select public.add_assembly_step($1, $2, 1, 1.0, false)`, [a!.id, task!.id]));

    const [n] = await h.sql<{ count: number }>(
      `select count(*)::int as count from assembly_components where assembly_id = $1`, [a!.id]);
    expect(n!.count).toBe(1);
  });

  it('drops off the list of services nobody can price', async () => {
    // The property the whole thing is for.
    const rows = await h.asUser(OWNER, () => h.sql(
      `select code from my_services_without_a_breakdown
        where company_id = $1 and code like 'SVC-BARE-0001-%'`, [mine]));
    expect(rows).toEqual([]);
  });

  describe('who may do it', () => {
    it('refuses somebody with no permission on the company', async () => {
      await expect(h.asUser(RIVAL, () => h.sql(
        `select app.start_a_breakdown($1, $2)`, [bare, mine])))
        .rejects.toThrow(/libraries.write/);
    });

    it('refuses a service that belongs to another company', async () => {
      const [other] = await h.asService(() => h.sql<{ id: string }>(
        `insert into services (company_id, code, name, default_unit, supported_units,
                               status, source, origin, approved_by, approved_at)
         values ($1, 'SVC-THEIRS', 'Theirs', 'SF', array['SF']::app.unit_code[],
                 'active', 'x', 'company', $2, now())
         returning id`, [theirs, RIVAL]));
      await expect(h.asUser(OWNER, () => h.sql(
        `select app.start_a_breakdown($1, $2)`, [other!.id, mine])))
        .rejects.toThrow(/another company/);
    });

    it('gives a writer who cannot approve a draft rather than a refusal', async () => {
      /*
       * A company row that is live has to name who made it live (0028). The
       * work is theirs to do and the approval is somebody else's to give;
       * blocking the first on the second is how a library stops being used.
       */
      const bare2 = (await h.asService(() => h.sql<{ id: string }>(
        `insert into services (code, name, default_unit, supported_units, status, source, origin)
         values ('SVC-BARE-0002', 'Dewatering wellpoints', 'LF',
                 array['LF']::app.unit_code[], 'active', 'GrounUp product master', 'catalog')
         returning id`)))[0]!.id;

      const [a] = await h.asUser(WRITER, () => h.sql<{ id: string; status: string }>(
        `select id, status from app.start_a_breakdown($1, $2)`, [bare2, mine]));
      expect(a!.status).toBe('draft');

      const [svc] = await h.sql<{ status: string; approved_by: string | null }>(
        `select status, approved_by from services
          where company_id = $1 and code like 'SVC-BARE-0002-%'`, [mine]);
      expect(svc!.status).toBe('draft');
      expect(svc!.approved_by).toBeNull();
    });

    it('shows a rival company none of it', async () => {
      const rows = await h.asUser(RIVAL, () => h.sql(
        `select code from services where code like 'SVC-BARE-0001-%'`));
      expect(rows).toEqual([]);
    });
  });
});
