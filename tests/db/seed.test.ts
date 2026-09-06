import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness, type Harness } from './harness.js';

describe('global seed library loads into a real database', () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness({ seed: true }); });
  afterAll(async () => { await h?.db.close(); });

  it('loads every catalog record from the governed v2.0 package', async () => {
    /*
     * The catalog rows specifically, not the whole library. The trade packs
     * add hundreds more and are counted separately — this test is about the
     * governed v2.0 package arriving intact, and folding the two together
     * would mean neither number said anything.
     *
     * Catalog codes are `SVC-0001`-shaped; a pack's carry its trade,
     * `SVC-EL-0001`, which is why the prefixes were chosen that way.
     */
    const counts = await h.sql<{ t: string; c: number }>(`
      select 'services' t, count(*)::int c from services
        where company_id is null and code ~ '^SVC-[0-9]+$'
      union all select 'tasks', count(*)::int from tasks
        where company_id is null and code ~ '^TSK-[0-9]+$'
      union all select 'labor_rates', count(*)::int from labor_rates where company_id is null
      union all select 'equipment', count(*)::int from equipment where company_id is null
      union all select 'production_rates', count(*)::int from production_rates
        where company_id is null and code ~ '^PR-[0-9]+$'
      union all select 'assemblies', count(*)::int from assemblies
        where company_id is null and code ~ '^ASM-[0-9]+$'
      union all select 'condition_modifiers', count(*)::int from condition_modifiers where company_id is null
      union all select 'pricing_profiles', count(*)::int from pricing_profiles where company_id is null
      union all select 'crews', count(*)::int from crews where company_id is null
      order by 1`);
    const map = Object.fromEntries(counts.map((r) => [r.t, r.c]));
    expect(map).toEqual({
      assemblies: 188,
      condition_modifiers: 20,
      crews: 8,
      equipment: 17,
      labor_rates: 12,
      pricing_profiles: 3,
      production_rates: 1452,
      services: 188,
      tasks: 2783,
    });
  });

  it('computes the burdened labor rate as a generated column', async () => {
    const [op1] = await h.sql<{ base: string; burdened: string }>(
      `select base_wage_per_hour base, burdened_cost_per_hour burdened from labor_rates where code = 'LAB-OP1'`);
    expect(Number(op1!.base)).toBe(40);
    expect(Number(op1!.burdened)).toBe(54);   // 40 x 1.35
  });

  it('links every production rate to a task', async () => {
    const [row] = await h.sql<{ orphans: number }>(
      `select count(*)::int orphans from production_rates where company_id is null and task_id is null`);
    expect(row!.orphans).toBe(0);
  });

  it('links assemblies to their services and back again', async () => {
    const [row] = await h.sql<{ unlinked: number }>(
      `select count(*)::int unlinked from assemblies where company_id is null and service_id is null`);
    expect(row!.unlinked).toBe(0);
    const [svc] = await h.sql<{ without_default: number }>(
      `select count(*)::int without_default from services where company_id is null and default_assembly_id is null`);
    expect(svc!.without_default).toBe(0);
  });

  /*
   * The property that actually decides whether the shipped library is worth
   * anything, and the one nothing checked.
   *
   * Every seeded service pointed at an assembly and every rate hung off a task,
   * both asserted above — but `assembly_components` was empty, so no service
   * reached a single task or a single rate and not one of the 188 could be
   * priced. Two true statements about the ends of a chain with no middle.
   */
  it('lets every service reach the tasks it is made of, and a rate for them', async () => {
    /*
     * Stated as a property rather than a count, because the count changes every
     * time a trade pack is added and the property must not. A service that
     * cannot reach a rate prices at zero, and one that prices at zero on a bid
     * is the most expensive kind of silence.
     */
    const [row] = await h.sql<{ services: number; with_tasks: number; with_rates: number }>(
      `select (select count(*)::int from services
                where company_id is null and status = 'active') as services,
              (select count(distinct s.id)::int from services s
                 join assembly_components ac on ac.assembly_id = s.default_assembly_id
                  and ac.component_kind = 'task'
                where s.company_id is null and s.status = 'active') as with_tasks,
              (select count(distinct s.id)::int from services s
                 join assembly_components ac on ac.assembly_id = s.default_assembly_id
                  and ac.component_kind = 'task'
                 join production_rates pr on pr.task_id = ac.task_id and pr.status = 'active'
                where s.company_id is null and s.status = 'active') as with_rates`);
    expect(row!.services).toBeGreaterThanOrEqual(188);
    expect(row!.with_tasks, 'a service with no tasks cannot be priced').toBe(row!.services);
    expect(row!.with_rates, 'a service with no production rate prices at zero').toBe(row!.services);
  });

  /*
   * The shipped catalog is heavy civil and nothing else, so a contractor
   * outside those trades opened the library and found nothing for their work.
   * The trade packs are the rest, kept in the repository because they are ours.
   */
  it('covers the trades a contractor outside heavy civil actually works in', async () => {
    const rows = await h.sql<{ industry: string }>(
      `select distinct industry from services where company_id is null`);
    const trades = rows.map((r) => r.industry);
    for (const needed of [
      'Electrical', 'Mechanical', 'Plumbing', 'Concrete', 'Rough Carpentry',
      'Roofing and Waterproofing', 'Drywall and Plaster', 'Finishes',
      'Doors, Windows and Glazing', 'Masonry and Structural Steel',
      'Thermal and Moisture Protection', 'Landscaping and Irrigation',
      'Survey and Aerial Services',
    ]) {
      expect(trades, `no services for ${needed}`).toContain(needed);
    }
  });

  it('says which rates nobody has sourced, three separate ways', async () => {
    /*
     * A rate nobody can source is the same defect as a typed price. The
     * difference between a defect and an honest starting point is whether the
     * platform tells you which one you are looking at — so a pack rate carries
     * `seed_benchmark`, which the engine warns about by name; `pending`
     * approval, so the engine says to approve it or substitute a company
     * actual before issuing; and a confidence below what the sourced rates
     * carry, so an estimate built on them scores for what it is.
     */
    const rows = await h.sql<{ st: string; cs: string; c: number }>(
      `select approval_state::text st, confidence_score::text cs, count(*)::int c
         from production_rates where company_id is null
        group by 1, 2 order by 3 desc`);
    const unsourced = rows.find((r) => r.st === 'pending');
    expect(unsourced, 'the trade packs should carry pending rates').toBeDefined();
    expect(Number(unsourced!.cs)).toBeLessThan(0.45);

    // And every one of them is a seed benchmark, which the engine warns on.
    const [wrong] = await h.sql<{ c: number }>(
      `select count(*)::int c from production_rates
        where company_id is null and approval_state = 'pending'
          and source_type <> 'seed_benchmark'`);
    expect(wrong!.c).toBe(0);
  });

  it('keeps the sourced heavy-civil rates distinguishable from the packs', async () => {
    // A company measuring its own production replaces the packs first; the
    // catalog rates were sourced and should not be swept up with them.
    const [row] = await h.sql<{ sourced: number; unsourced: number }>(
      `select count(*) filter (where approval_state = 'not_required')::int sourced,
              count(*) filter (where approval_state = 'pending')::int unsourced
         from production_rates where company_id is null`);
    expect(row!.sourced).toBeGreaterThan(0);
    expect(row!.unsourced).toBeGreaterThan(0);
  });

  /*
   * The seed and migration 0089 have to agree about what a service is measured
   * in, and the agreement is fragile in a specific way: migrations run before
   * the seed on a fresh database, so 0089 updates rows that do not exist yet
   * and whatever the seed says is what survives. The correction has been lost
   * once already, to a regeneration of the seed that did not know about it.
   */
  it('measures every service the way migration 0089 says, not the way the catalog does', async () => {
    const sql = await readFile(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'migrations',
           '0089_what_a_service_is_measured_in.sql'), 'utf8');
    const expected = new Map<string, string>();
    for (const m of sql.matchAll(/\('(SVC-\d+)',\s*'([A-Z]+)'/g)) expected.set(m[1]!, m[2]!);
    expect(expected.size).toBe(188);

    /*
     * The catalog's services. A trade pack states its own units in its own
     * file and is not in 0089's table, which is the correction to a catalog
     * that shipped every service as a lump sum.
     */
    const rows = await h.sql<{ code: string; unit: string }>(
      `select code, default_unit::text as unit from services
        where company_id is null and code ~ '^SVC-[0-9]+$'`);
    const wrong = rows.filter((r) => expected.get(r.code) !== r.unit);
    expect(wrong.map((w) => `${w.code}: ${w.unit} should be ${expected.get(w.code)}`)).toEqual([]);
  });

  it('gives every service a cost code, so a line can be rolled up to a budget', async () => {
    const [row] = await h.sql<{ codes: number; unlinked: number }>(
      `select (select count(*)::int from cost_codes where company_id is null) as codes,
              (select count(*)::int from services
                where company_id is null and cost_code_id is null) as unlinked`);
    expect(row!.codes).toBeGreaterThanOrEqual(188);
    // The one that matters: a line with no cost code cannot be rolled up
    // against a budget, whichever trade it came from.
    expect(row!.unlinked).toBe(0);
  });

  it('lists a task at most once per assembly', async () => {
    // A duplicate component doubles that task's hours and cost in every
    // estimate priced from the assembly, and reads as a real line.
    const [row] = await h.sql<{ dupes: number }>(
      `select count(*)::int dupes from (
         select assembly_id, task_id from assembly_components
          where component_kind = 'task'
          group by 1, 2 having count(*) > 1) d`);
    expect(row!.dupes).toBe(0);
  });

  it('gives every equipment item a seed rate at the lowest precedence tier', async () => {
    const rows = await h.sql<{ code: string; source: string; hourly: string }>(
      `select e.code, r.source, r.hourly_rate hourly from equipment e
       join equipment_rates r on r.equipment_id = e.id
       where e.company_id is null and e.code = 'EQ-EX-20'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe('global_seed');
    expect(Number(rows[0]!.hourly)).toBe(112.5);
  });

  it('expands every condition modifier into explicit per-target factors', async () => {
    const rows = await h.sql<{ code: string; factors: Record<string, number> }>(
      `select code, factors from condition_modifiers where company_id is null order by code`);
    expect(rows.length).toBe(20);
    for (const r of rows) {
      const keys = Object.keys(r.factors);
      expect(keys.length).toBeGreaterThan(0);
      for (const k of keys) expect(r.factors[k]).toBeGreaterThan(0);
    }
    const rock = rows.find((r) => r.code === 'MOD-ROCK')!;
    expect(rock.factors).toEqual({ labor_cost: 1.35, equipment_cost: 1.35, production: 0.65 });
  });

  it('rejects a condition modifier that names an unknown target', async () => {
    await expect(
      h.sql(`insert into condition_modifiers (code, name, factors, application_rule)
             values ('BAD','Bad','{"morale":0.9}'::jsonb,'x')`),
    ).rejects.toThrow(/unknown target "morale"/);
  });

  it('rejects a condition modifier factor that is not positive', async () => {
    await expect(
      h.sql(`insert into condition_modifiers (code, name, factors, application_rule)
             values ('BAD2','Bad','{"production":0}'::jsonb,'x')`),
    ).rejects.toThrow(/must be a positive number/);
  });

  it('builds crews from the shipped labor classifications', async () => {
    const rows = await h.sql<{ classification: string; headcount: number }>(
      `select l.classification, m.headcount from crews c
       join crew_members m on m.crew_id = c.id
       join labor_rates l on l.id = m.labor_rate_id
       where c.code = 'CRW-EW-02' order by l.code`);
    expect(rows.length).toBe(5);
    const total = rows.reduce((a, r) => a + r.headcount, 0);
    expect(total).toBe(6);
  });

  it('loads the plan catalog and the AI agent registry', async () => {
    /*
     * What is offered, rather than how many rows exist. The catalog keeps the
     * withdrawn five-tier ladder and two unlisted plans for the history of
     * companies still on them, so a bare count says nothing about what a
     * visitor can buy — which is the thing worth asserting.
     */
    const offered = await h.sql<{ id: string }>(
      `select id from plans where is_active and is_public order by sort_order`);
    expect(offered.map((p) => p.id)).toEqual(['free', 'grounup']);
    const [agents] = await h.sql<{ c: number }>(`select count(*)::int c from ai_agents`);
    expect(agents!.c).toBe(15);
  });

  it('makes it impossible to configure an AI agent with write authority', async () => {
    await expect(
      h.sql(`insert into ai_agents (id, name, domain, responsibility, default_authority)
             values ('AGT-ROGUE','Rogue','x','x','autonomous')`),
    ).rejects.toThrow();
  });
});


/*
 * The seed is applied by a deployment, and a deployment happens more than once.
 *
 * `supabase db push` applies migrations and nothing else, so the catalog — the
 * library, the plan catalog the checkout validates against, and the AI agent
 * row every finding references — is loaded separately. The deploy workflow now
 * does that on every run, which is only safe if every statement in both files
 * can be applied twice. One of them could not: the equipment rate insert
 * carried no `on conflict` and would have failed the second deployment.
 */
describe('the seed can be applied twice', () => {
  let h: Harness;

  beforeAll(async () => { h = await createHarness({ seed: true }); }, 180_000);
  afterAll(async () => { await h?.db.close(); });

  it('replays every seed file without error', async () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'seed');
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const sql = await readFile(join(dir, file), 'utf8');
      await expect(h.db.exec(sql), `${file} is not idempotent`).resolves.toBeDefined();
    }
  });

  it('leaves the catalog the same size it was', async () => {
    // Idempotent means unchanged, not merely un-erroring: a seed that inserted
    // a second copy of every row would also "succeed".
    const counts = () => h.sql<{ tbl: string; n: string }>(
      `select 'tasks' as tbl, count(*)::text as n from tasks where company_id is null
       union all select 'equipment_rates', count(*)::text from equipment_rates where company_id is null
       union all select 'labor_rates', count(*)::text from labor_rates where company_id is null
       union all select 'production_rates', count(*)::text from production_rates where company_id is null
       union all select 'assemblies', count(*)::text from assemblies where company_id is null
       union all select 'assembly_components', count(*)::text from assembly_components where company_id is null
       union all select 'cost_codes', count(*)::text from cost_codes where company_id is null
       union all select 'plans', count(*)::text from plans
       union all select 'ai_agents', count(*)::text from ai_agents
       order by 1`);

    const before = await counts();
    for (const row of before) expect(Number(row.n), row.tbl).toBeGreaterThan(0);

    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'seed');
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
      await h.db.exec(await readFile(join(dir, file), 'utf8'));
    }

    // Unchanged, not merely un-erroring: a seed that inserted a second copy of
    // every row would also "succeed".
    expect(await counts()).toEqual(before);
  });
});
