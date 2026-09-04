import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('global seed library loads into a real database', () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness({ seed: true }); });
  afterAll(async () => { await h?.db.close(); });

  it('loads every catalog record from the governed v2.0 package', async () => {
    const counts = await h.sql<{ t: string; c: number }>(`
      select 'services' t, count(*)::int c from services where company_id is null
      union all select 'tasks', count(*)::int from tasks where company_id is null
      union all select 'labor_rates', count(*)::int from labor_rates where company_id is null
      union all select 'equipment', count(*)::int from equipment where company_id is null
      union all select 'production_rates', count(*)::int from production_rates where company_id is null
      union all select 'assemblies', count(*)::int from assemblies where company_id is null
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
    const [plans] = await h.sql<{ c: number }>(`select count(*)::int c from plans`);
    expect(plans!.c).toBe(5);
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
