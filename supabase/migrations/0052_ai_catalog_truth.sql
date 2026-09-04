-- =============================================================================
-- 0052 — An enabled agent is an agent that exists
--
-- `ai_agents`, `ai_models` and `ai_prompts` are governed tables with a careful
-- model behind them, and nothing used any of it. `ai_prompts` carries a state
-- across draft, evaluating, active and retired and a constraint that a prompt
-- cannot reach `active` without an activator, a moment **and an evaluation pass
-- rate** — the exact control P27 said was missing when it recorded that nothing
-- measures whether the agent is any good. It is enforced on a table nobody
-- wrote to and nobody read.
--
-- The analyst runs `const MODEL`, `const PROMPT_VERSION` and a `SYSTEM_PROMPT`
-- compiled into the function. `ai_models` and `ai_prompts` were empty.
-- `ai_findings.model` and `prompt_version` are free text naming no governed row.
--
-- And `ai_agents` was seeded with fifteen agents, every one `is_enabled`, of
-- which one exists — so a screen reading the catalog would offer a customer
-- fourteen assistants that are not there.
--
-- The catalog rows are seed data rather than schema, so they are corrected in
-- supabase/seed/0002_plan_catalog.sql, which runs after this. What belongs here
-- is what the column means.
-- =============================================================================

comment on column ai_agents.is_enabled is
  'Whether an implementation of this agent exists and may be offered. Fourteen of the fifteen seeded agents describe intent rather than capability and ship disabled; a test cross-checks the enabled set against the agents registered in governance/registry.json, so an agent cannot be advertised before it is built.';

comment on table ai_prompts is
  'Versioned system prompts per agent. LIBRARY. A prompt cannot reach active without an activator, a moment and an evaluation pass rate — so the seeded prompt is a draft, because no evaluation exists and writing a pass rate to make the row activatable would fabricate the evidence the constraint demands.';

select app.assert_security_gates();
