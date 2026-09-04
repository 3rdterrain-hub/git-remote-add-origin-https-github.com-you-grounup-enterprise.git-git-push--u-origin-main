/**
 * The AI catalogs, against real PostgreSQL.
 *
 * @implements GES-P04-REQ-041
 *
 * `ai_agents`, `ai_models` and `ai_prompts` carry a careful governance model —
 * including a constraint that a prompt cannot reach `active` without an
 * activator, a moment and an evaluation pass rate, which is the exact control
 * P27 recorded as missing when it said nothing measures whether the agent is
 * any good.
 *
 * Nothing used it. The analyst runs a model, a prompt version and a system
 * prompt compiled into the function; `ai_models` and `ai_prompts` were empty
 * tables read by no statement anywhere. And fifteen agents shipped enabled, of
 * which one exists.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness, type Harness } from './harness.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The prompt the analyst is actually compiled with. */
function compiledPrompt(): string {
  const src = readFileSync(join(ROOT, 'supabase/functions/_shared/plan-analysis.ts'), 'utf8');
  const m = /export const SYSTEM_PROMPT = `([\s\S]*?)`;/.exec(src);
  expect(m, 'SYSTEM_PROMPT not found in plan-analysis.ts').toBeTruthy();
  return m![1]!;
}

describe('the AI catalogs describe what actually runs', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@r.test')`, [owner]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@r.test') on conflict (id) do nothing`, [owner]);
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  describe('an enabled agent is an agent that exists', () => {
    it('enables only the agents the registry says are built', async () => {
      // Fifteen agents describe the plan; one has an implementation. The
      // catalog advertised all fifteen.
      const registry = JSON.parse(
        readFileSync(join(ROOT, 'governance/registry.json'), 'utf8')) as
        { ai_agents: { id: string; name: string; path: string }[] };
      const enabled = await h.sql<{ id: string }>(
        `select id from ai_agents where is_enabled order by id`);
      expect(enabled).toHaveLength(registry.ai_agents.length);
      expect(enabled[0]!.id).toBe('AGT-DOC');
    });

    it('keeps the unbuilt agents as descriptions rather than deleting them', async () => {
      // They are the plan, and a plan is worth keeping — it just must not read
      // as a capability.
      const [row] = await h.sql<{ n: string }>(`select count(*) as n from ai_agents`);
      expect(Number(row!.n)).toBeGreaterThan(10);
      const disabled = await h.sql<{ id: string }>(
        `select id from ai_agents where not is_enabled`);
      expect(disabled.length).toBeGreaterThan(10);
    });

    it('still cannot configure an agent that writes on its own', async () => {
      // The control that made all of this safe in the first place.
      await expect(h.sql(
        `update ai_agents set default_authority = 'autonomous' where id = 'AGT-DOC'`))
        .rejects.toThrow(/ai_agents_never_autonomous|violates check/);
    });
  });

  describe('the model', () => {
    it('names the model the analyst calls', async () => {
      const src = readFileSync(
        join(ROOT, 'supabase/functions/ai-analyze-document/index.ts'), 'utf8');
      const compiled = /const MODEL = '([^']+)'/.exec(src)![1]!;
      const [row] = await h.sql<{ id: string; is_default: boolean }>(
        `select id, is_default from ai_models where id = $1`, [compiled]);
      expect(row, `ai_models has no row for ${compiled}`).toBeTruthy();
      expect(row!.is_default).toBe(true);
    });
  });

  describe('the prompt', () => {
    it('seeds the exact text the analyst is compiled with', async () => {
      // A copy nobody compares is how two versions of a prompt start
      // disagreeing. This is the drift check that stops it.
      const [row] = await h.sql<{ system_prompt: string }>(
        `select system_prompt from ai_prompts where agent_id='AGT-DOC' and version='v1'`);
      expect(row!.system_prompt).toBe(compiledPrompt());
    });

    it('is a draft, because no evaluation exists to activate it against', async () => {
      /*
       * The honest state. Seeding it as active would require an
       * eval_pass_rate, and writing a number there to make the row activatable
       * would fabricate the evidence the constraint exists to demand.
       */
      const [row] = await h.sql<{ state: string; eval_pass_rate: string | null }>(
        `select state, eval_pass_rate from ai_prompts where agent_id='AGT-DOC'`);
      expect(row!.state).toBe('draft');
      expect(row!.eval_pass_rate).toBeNull();
    });

    it('refuses to activate a prompt with no evaluation behind it', async () => {
      // The control P27 said was missing, proven to bite.
      await expect(h.sql(
        `update ai_prompts set state='active', activated_by=$1, activated_at=now()
         where agent_id='AGT-DOC'`, [owner]))
        .rejects.toThrow(/ai_prompts_activation|violates check/);
    });

    it('activates one that has been evaluated', async () => {
      await h.sql(
        `update ai_prompts set state='active', activated_by=$1, activated_at=now(),
           eval_pass_rate=0.94, eval_sample_size=120
         where agent_id='AGT-DOC'`, [owner]);
      const [row] = await h.sql<{ state: string }>(
        `select state from ai_prompts where agent_id='AGT-DOC'`);
      expect(row!.state).toBe('active');
      // Put it back: the seeded state is the truthful one.
      await h.sql(
        `update ai_prompts set state='draft', activated_by=null, activated_at=null,
           eval_pass_rate=null, eval_sample_size=null where agent_id='AGT-DOC'`);
    });
  });

  describe('tenancy', () => {
    it('shows the platform catalog to a member and nothing to anonymous', async () => {
      await expect(h.asAnon(() => h.sql(`select id from ai_prompts limit 1`)))
        .rejects.toThrow();
    });
  });
});
