-- =============================================================================
-- GrounUp Enterprise — plan catalog and AI agent registry
--
-- The plan catalog is the authority the Edge Functions validate against, so a
-- browser cannot request a price or a feature set that was never approved.
-- Stripe price ids are inserted separately per environment (see
-- supabase/seed/0003_plan_prices.example.sql).
-- =============================================================================

insert into plans (id, name, tagline, description, tier, is_public, is_active,
                   max_seats, max_companies, max_active_estimates, max_active_projects,
                   storage_gb, ai_credits_per_month, features, trial_days, sort_order) values
  ('starter', 'Starter',
   'For the owner-estimator getting off spreadsheets.',
   'Production-based estimating with the full GrounUp master library, one company and a small crew of users.',
   10, true, true,
   3, 1, 25, 10, 10, 250,
   array['estimating','takeoff','master_libraries','crm_basic','proposals','documents'],
   14, 10),

  ('professional', 'Professional',
   'For the contractor running several jobs at once.',
   'Everything in Starter plus project execution, job cost, field production and AI plan review.',
   20, true, true,
   10, 1, 250, 75, 100, 2000,
   array['estimating','takeoff','master_libraries','crm_basic','crm_full','proposals','documents',
         'projects','job_cost','field_production','change_orders','ai_plan_review','reports'],
   14, 20),

  ('business', 'Business',
   'For the growing company with divisions and a real back office.',
   'Everything in Professional plus divisions, procurement, fleet, scheduling, analytics and the API.',
   30, true, true,
   50, 3, null, null, 500, 10000,
   array['estimating','takeoff','master_libraries','crm_basic','crm_full','proposals','documents',
         'projects','job_cost','field_production','change_orders','ai_plan_review','reports',
         'divisions','procurement','fleet','scheduling','analytics','api_access','calibration'],
   14, 30),

  ('enterprise', 'Enterprise',
   'For multi-company groups that need corporate standards.',
   'Everything in Business plus enterprise groups, corporate standard libraries and dedicated support.',
   40, true, true,
   null, null, null, null, null, null,
   array['*'],
   0, 40),

  ('partner_white_label', 'White Label Partner',
   'Run GrounUp under your own brand.',
   'Enterprise capability plus full white labeling, partner administration and reseller billing.',
   50, false, true,
   null, null, null, null, null, null,
   array['*'],
   0, 50)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- AI agent registry
--
-- Every agent is capped at draft/recommend authority, must cite its sources,
-- and requires human approval for high-impact actions. The table's own check
-- constraint makes a higher authority unconfigurable.
-- -----------------------------------------------------------------------------
insert into ai_agents (id, name, domain, responsibility, default_authority,
                       high_impact_requires_approval, must_cite_sources, prompt_version) values
  ('AGT-EST', 'AI Estimator', 'Estimating',
   'Builds cited scope suggestions, assemblies, production options, estimate drafts and variance explanations.',
   'draft_recommend', true, true, 'v1'),
  ('AGT-DOC', 'AI Document Reader', 'Document Intelligence',
   'Classifies and extracts plans, specifications, reports, addenda, contracts and correspondence.',
   'draft_recommend', true, true, 'v1'),
  ('AGT-TAKEOFF', 'AI Takeoff Assistant', 'Estimating',
   'Suggests measurable items, formulas, locations and review overlays; never finalizes an unreviewed quantity.',
   'draft_recommend', true, true, 'v1'),
  ('AGT-REV', 'AI Revision Analyst', 'Document/Estimating',
   'Compares document revisions and identifies potential scope, quantity, cost and schedule effects.',
   'draft_recommend', true, true, 'v1'),
  ('AGT-PM', 'AI Project Manager', 'Project Management',
   'Summarizes status, drafts actions, detects risks and proposes recovery plans.',
   'draft_recommend', true, true, 'v1'),
  ('AGT-SCH', 'AI Scheduler', 'Scheduling',
   'Builds and evaluates schedule scenarios, resource constraints and recovery options.',
   'draft_recommend', true, true, 'v1'),
  ('AGT-CRM', 'AI CRM Assistant', 'CRM',
   'Qualifies leads, drafts follow-up, summarizes customer history and recommends next activity.',
   'draft_recommend', true, true, 'v1'),
  ('AGT-FLEET', 'AI Fleet Manager', 'Fleet',
   'Analyses utilization, fuel, maintenance risk, assignment and rent-versus-own scenarios.',
   'draft_recommend', true, true, 'v1'),
  ('AGT-PROC', 'AI Procurement Assistant', 'Procurement',
   'Drafts RFQs, compares quotes, identifies shortages and recommends awards subject to approval.',
   'draft_recommend', true, true, 'v1'),
  ('AGT-SAFE', 'AI Safety & Quality Assistant', 'Safety/Quality',
   'Identifies plan and field risks, drafts checklists and routes safety-critical findings to review.',
   'draft_recommend', true, true, 'v1'),
  ('AGT-FIN', 'AI Financial Analyst', 'Finance',
   'Explains margin, WIP, cash, cost trends and forecast scenarios without posting entries.',
   'draft_recommend', true, true, 'v1'),
  ('AGT-HR', 'AI HR Assistant', 'Workforce',
   'Supports onboarding, credential checks and workforce planning; restricted from autonomous protected decisions.',
   'draft_recommend', true, true, 'v1'),
  ('AGT-KB', 'AI Company Knowledge Assistant', 'Knowledge',
   'Answers from company-approved SOPs, manuals, standards, lessons and records.',
   'draft_recommend', true, true, 'v1'),
  ('AGT-EXEC', 'AI Executive Assistant', 'Executive',
   'Combines governed information into prioritized company-level recommendations.',
   'draft_recommend', true, true, 'v1'),
  ('AGT-DRONE', 'AI Drone & Reality Capture Analyst', 'Reality Capture',
   'Interprets approved drone and LiDAR outputs, surfacing volumes and progress with source lineage.',
   'draft_recommend', true, true, 'v1')
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- An enabled agent is an agent that exists
--
-- Fifteen agents are described above and one is implemented. They shipped with
-- is_enabled defaulting to true, so the catalog advertised fourteen assistants
-- that are not there. The descriptions stay — they are the plan — and only the
-- one with an implementation behind it is enabled. A test cross-checks this
-- against governance/registry.json.
-- -----------------------------------------------------------------------------
update ai_agents set is_enabled = (id = 'AGT-DOC');

-- -----------------------------------------------------------------------------
-- The model the analyst actually calls
-- -----------------------------------------------------------------------------
insert into ai_models (id, provider, display_name, capabilities, context_tokens,
                       is_enabled, is_default, notes)
values ('claude-opus-5', 'anthropic', 'Claude Opus 5',
        array['vision', 'long_context', 'structured_output'], 200000, true, true,
        'The model the document analyst calls. Seeded so the catalog describes what runs rather than sitting empty beside a constant in the function.')
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- The prompt the analyst actually runs
--
-- Verbatim from SYSTEM_PROMPT in supabase/functions/_shared/plan-analysis.ts,
-- with a test asserting the two are identical — the same drift-check pattern the
-- rest of this build uses, because a copy nobody compares is how two versions of
-- a prompt start disagreeing.
--
-- State is draft, truthfully: ai_prompts_activation requires an evaluation pass
-- rate and no evaluation exists.
-- -----------------------------------------------------------------------------
insert into ai_prompts (company_id, agent_id, version, system_prompt, state, eval_notes)
values (null, 'AGT-DOC', 'v1', 'You are the GrounUp plan and specification analyst, working for a heavy civil and excavation contractor.

Your job is to read construction documents and report what an experienced estimator would need to know before pricing the work.

WHAT YOU DO
- Identify scope shown or implied on the documents.
- Identify measurable quantities, and say how each was obtained.
- Identify conflicts between documents that disagree.
- Identify information that is missing, ambiguous, or that the documents cannot resolve.
- Identify risks and the assumptions a price would rest on.

WHAT YOU DO NOT DO
- You do not compute costs, prices, production rates, durations, crew sizes or markups. A deterministic engine owns all of that. Report quantities and conditions; never a dollar figure.
- You do not resolve a conflict by choosing a side. Report both sources and what each says.
- You do not invent a dimension, an elevation, a quantity or a specification section that is not in the documents.
- You do not report a measurement as an explicit plan dimension when you scaled it.

EVIDENCE
Every scope item, quantity candidate and conflict MUST cite the sheet number or specification section it came from, and quote the text or detail it rests on. A finding you cannot cite is one you must not report. If you are unsure of a sheet number, say what you can see and lower your confidence rather than guessing an identifier.

MEASUREMENT METHOD
For every quantity, state how it was obtained:
- explicit_dimension: read directly off a dimensioned drawing
- calculated: derived from other explicit dimensions
- schedule_quantity: taken from a drawing schedule
- owner_quantity: taken from the owner or engineer bid quantity
- verified_scale: scaled, with the scale checked against a known dimension
- approximate_scale: scaled without verifying the scale
- derived: from stationing, a structure count or a station range
- estimator_allowance: no measurable basis exists on the documents

CONFIDENCE
Score 0-100 honestly. A dimensioned quantity confirmed on a second sheet is high. A scaled quantity is not. An allowance is low by definition. Understating your confidence costs an estimator a few minutes; overstating it costs them the job.

Report only what the supplied documents support. Silence is better than a plausible invention.', 'draft',
        'Cannot be activated until an evaluation exists: ai_prompts_activation requires a pass rate, and P27 recorded that nothing measures whether this agent is any good. The analyst runs this text compiled into the function; a test asserts the two are identical.')
on conflict (agent_id, company_id, version) do nothing;
