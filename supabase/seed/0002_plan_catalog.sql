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
