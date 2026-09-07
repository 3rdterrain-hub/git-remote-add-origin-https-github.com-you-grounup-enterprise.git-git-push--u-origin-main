/**
 * A template you can change.
 *
 * Seed 0006 put nineteen work sequences in the library and they are platform
 * rows: every company reads them and none may write one. That is the right
 * default and the wrong ending — a contractor whose concrete crew strips forms
 * before sawcutting has a sequence that is theirs, and a library that cannot
 * hold it is a library they stop using.
 *
 * So the platform row stays untouched and the company gets a copy. What is
 * tested hardest is that the copy is genuinely separate: editing it must not
 * reach the original, and the original must still read the same to everybody
 * else the moment after.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('a template you can change', () => {
  let h: Harness;
  const chief  = '11111111-1111-4111-8111-111111111111';
  const other  = '22222222-2222-4222-8222-222222222222';
  const viewer = '33333333-3333-4333-8333-333333333333';
  let company = '', rival = '', platform = '', mine = '';

  const as = <T,>(who: string, q: string, p?: unknown[]) =>
    h.asUser(who, () => h.sql<T extends object ? T : never>(q, p));
  const sql = <T,>(q: string, p?: unknown[]) => as<T>(chief, q, p);

  /*
   * `step` is cast to text for the driver and ordered on `sort_order`, not on
   * the cast — ordering by the text column sorts 10 before 2, which is a bug in
   * a test rather than in a sequence.
   */
  const steps = (assembly: string) =>
    sql<{ step: string; task_name: string; step_id: string }>(
      `select step::text as step, task_name, step_id from my_assembly_steps
       where assembly_id = $1 order by sort_order`, [assembly]);

  beforeAll(async () => {
    h = await createHarness({ seed: 'full' });
    for (const [id, email] of
      [[chief, 'c@r.test'], [other, 'o@r.test'], [viewer, 'v@r.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, email]);
    }
    company = (await sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`))[0]!.id;
    rival = (await as<{ id: string }>(other,
      `select app.provision_company('Other','other','enterprise') as id`))[0]!.id;
    await h.sql(`insert into company_memberships (company_id, user_id, role_id, status)
                 select $1, $2, r.id, 'active' from roles r
                 where r.company_id is null and r.key = 'viewer' limit 1`, [company, viewer]);

    const [a] = await sql<{ id: string }>(
      `select id from assemblies where company_id is null and code = 'ASM-TT-CONC-STD'`);
    platform = a!.id;
  }, 300_000);

  afterAll(async () => { await h?.db.close(); });

  // ---------------------------------------------------------------------------
  describe('what the library ships', () => {
    it('is a real sequence, in order', async () => {
      const rows = await steps(platform);
      expect(rows.length).toBe(10);
      expect(rows[0]!.task_name).toBe('Layout / verify elevations');
      expect(rows[9]!.task_name).toBe('Cleanup / strip forms');
    });

    it('numbers the steps 1 upward with none repeated', async () => {
      const rows = await steps(platform);
      expect(rows.map((r) => Number(r.step))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it('refuses a change, and says what to do instead', async () => {
      const [t] = await sql<{ id: string }>(
        `select id from tasks where company_id is null limit 1`);
      await expect(sql(`select add_assembly_step($1, $2)`, [platform, t!.id]))
        .rejects.toThrow(/one of the templates GrounUp ships/);
    });

    it('names the way out in the hint rather than only refusing', async () => {
      const [t] = await sql<{ id: string }>(
        `select id from tasks where company_id is null limit 1`);
      const err = await sql(`select add_assembly_step($1, $2)`, [platform, t!.id])
        .then(() => null, (e: unknown) => e as { hint?: string });
      expect(err?.hint ?? '').toMatch(/customize_assembly/);
    });
  });

  // ---------------------------------------------------------------------------
  describe('making it yours', () => {
    it('copies the template, steps and all', async () => {
      const [copy] = await sql<{ id: string; company_id: string; name: string }>(
        `select id, company_id, name from customize_assembly($1, $2)`, [platform, company]);
      mine = copy!.id;
      expect(copy!.company_id).toBe(company);
      expect(copy!.name).toBe('Concrete Template');
      const rows = await steps(mine);
      expect(rows.length).toBe(10);
    });

    it('says where it came from', async () => {
      const [a] = await sql<{ source: string }>(
        `select source from assemblies where id = $1`, [mine]);
      expect(a!.source).toBe('Copied from ASM-TT-CONC-STD');
    });

    it('returns the same copy rather than making a second', async () => {
      const [again] = await sql<{ id: string }>(
        `select id from customize_assembly($1, $2)`, [platform, company]);
      expect(again!.id).toBe(mine);
      const [n] = await sql<{ c: string }>(
        `select count(*)::text as c from assemblies where company_id = $1`, [company]);
      expect(Number(n!.c)).toBe(1);
    });

    it('needs libraries.write', async () => {
      await expect(as(viewer, `select customize_assembly($1, $2)`, [platform, company]))
        .rejects.toThrow(/libraries.write/);
    });
  });

  // ---------------------------------------------------------------------------
  describe('changing your copy', () => {
    it('adds a step at the end', async () => {
      const [t] = await sql<{ id: string }>(
        `select id from tasks where company_id is null and name = 'Cleanup / demobilize' limit 1`);
      await sql(`select add_assembly_step($1, $2)`, [mine, t!.id]);
      const rows = await steps(mine);
      expect(rows.length).toBe(11);
      expect(rows[10]!.task_name).toBe('Cleanup / demobilize');
    });

    it('adds one in the middle and pushes the rest down', async () => {
      const [t] = await sql<{ id: string }>(
        `select id from tasks where company_id is null and name = 'Utility locate / safety prep' limit 1`);
      await sql(`select add_assembly_step($1, $2, 2)`, [mine, t!.id]);
      const rows = await steps(mine);
      expect(rows[1]!.task_name).toBe('Utility locate / safety prep');
      expect(rows[2]!.task_name).toBe('Subgrade prep / compact');
      expect(rows.map((r) => Number(r.step))).toEqual([1,2,3,4,5,6,7,8,9,10,11,12]);
    });

    it('removes one and closes the gap it leaves', async () => {
      /*
       * A sequence that runs 1, 2, 3, 5 is one somebody eventually reads as a
       * missing step, so nothing here ever leaves a hole.
       */
      const before = await steps(mine);
      const victim = before.find((r) => r.task_name === 'Utility locate / safety prep')!;
      await sql(`select remove_assembly_step($1)`, [victim.step_id]);
      const rows = await steps(mine);
      expect(rows.length).toBe(before.length - 1);
      expect(rows.map((r) => Number(r.step)))
        .toEqual(Array.from({ length: rows.length }, (_, i) => i + 1));
      expect(rows.map((r) => r.task_name)).not.toContain('Utility locate / safety prep');
    });

    it('moves one up the order', async () => {
      const before = await steps(mine);
      const last = before[before.length - 1]!;
      await sql(`select move_assembly_step($1, 1)`, [last.step_id]);
      const rows = await steps(mine);
      expect(rows[0]!.task_name).toBe(last.task_name);
      expect(rows.map((r) => Number(r.step)))
        .toEqual(Array.from({ length: rows.length }, (_, i) => i + 1));
    });

    it('refuses a position before the first', async () => {
      const rows = await steps(mine);
      await expect(sql(`select move_assembly_step($1, 0)`, [rows[0]!.step_id]))
        .rejects.toThrow(/position one or later/);
    });

    it('refuses a task belonging to another company', async () => {
      const [t] = await as<{ id: string }>(other,
        `insert into tasks (company_id, code, name, status, approved_by, approved_at)
         values ($1, 'TSK-RIVAL', 'Their own step', 'active', $2, now()) returning id`,
        [rival, other]);
      await expect(sql(`select add_assembly_step($1, $2)`, [mine, t!.id]))
        .rejects.toThrow(/belongs to another company/);
    });
  });

  // ---------------------------------------------------------------------------
  describe('the original is untouched', () => {
    it('still has its ten steps in the order it shipped with', async () => {
      const rows = await steps(platform);
      expect(rows.length).toBe(10);
      expect(rows[0]!.task_name).toBe('Layout / verify elevations');
      expect(rows[9]!.task_name).toBe('Cleanup / strip forms');
    });

    it('reads the same to a company that never customized it', async () => {
      const rows = await as<{ task_name: string }>(other,
        `select task_name from my_assembly_steps where assembly_id = $1 order by step`,
        [platform]);
      expect(rows.length).toBe(10);
    });

    it('does not show one company another one\'s copy', async () => {
      const rows = await as<{ c: string }>(other,
        `select count(*)::text as c from my_assembly_steps where assembly_id = $1`, [mine]);
      expect(Number(rows[0]!.c)).toBe(0);
    });

    it('refuses to let one company customize another one\'s template', async () => {
      await expect(as(other, `select customize_assembly($1, $2)`, [mine, rival]))
        .rejects.toThrow(/belongs to another company/);
    });
  });

  // ---------------------------------------------------------------------------
  describe('the services nobody can price yet', () => {
    it('lists them rather than leaving them to be found at bid time', async () => {
      const [r] = await sql<{ c: string }>(
        `select count(*)::text as c from my_services_without_a_breakdown`);
      expect(Number(r!.c)).toBeGreaterThan(0);
    });

    it('says of each one whether it has an assembly at all', async () => {
      const [r] = await sql<{ has_no_assembly: boolean; steps: number }>(
        `select has_no_assembly, steps from my_services_without_a_breakdown limit 1`);
      expect(typeof r!.has_no_assembly).toBe('boolean');
    });

    it('shows nobody anything anonymously', async () => {
      await h.asAnon(async () => {
        await expect(h.sql(`select * from my_assembly_steps`)).rejects.toThrow(/permission denied/);
        await expect(h.sql(`select * from my_services_without_a_breakdown`))
          .rejects.toThrow(/permission denied/);
      });
    });
  });
});
