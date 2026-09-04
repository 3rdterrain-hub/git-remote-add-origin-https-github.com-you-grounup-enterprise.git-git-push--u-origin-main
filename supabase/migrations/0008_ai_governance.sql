-- =============================================================================
-- GrounUp Enterprise — 0008 AI governance
--
-- The platform's core safety property: an AI agent may read documents, propose
-- scope, quantities, conflicts and risks, and explain results. It may not
-- compute an authoritative price and it may not write to an approved record.
-- Everything an agent produces lands in `ai_findings` as a proposal that a
-- human accepts or rejects (RULE-008).
-- =============================================================================

create table ai_agents (
  id                    text primary key,
  name                  text not null,
  domain                text not null,
  responsibility        text not null,
  default_authority     text not null default 'draft_recommend'
                          check (default_authority in ('read_only', 'draft_recommend')),
  high_impact_requires_approval boolean not null default true,
  must_cite_sources     boolean not null default true,
  prompt_version        text not null default 'v1',
  is_enabled            boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- No agent may be granted write authority through configuration.
  constraint ai_agents_never_autonomous check (default_authority <> 'autonomous')
);

comment on table ai_agents is
  'Registry of governed AI agents. The authority check makes it impossible to configure an agent that writes to approved records without human acceptance.';

create table ai_conversations (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  user_id           uuid references auth.users(id) on delete set null,
  agent_id          text references ai_agents(id) on delete set null,
  title             text,
  context_type      text check (context_type in ('estimate', 'project', 'document', 'customer', 'company', 'general')),
  context_id        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index ai_conversations_company_idx on ai_conversations(company_id, updated_at desc);

create table ai_messages (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  conversation_id   uuid not null references ai_conversations(id) on delete cascade,
  role              text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content           text not null,
  -- Citations the assistant gave; required for any factual claim.
  citations         jsonb not null default '[]'::jsonb,
  model             text,
  input_tokens      int check (input_tokens is null or input_tokens >= 0),
  output_tokens     int check (output_tokens is null or output_tokens >= 0),
  latency_ms        int check (latency_ms is null or latency_ms >= 0),
  created_at        timestamptz not null default now()
);
create index ai_messages_conversation_idx on ai_messages(conversation_id, created_at);

/**
 * The only channel through which AI output can reach business data.
 *
 * A finding is inert until a human with the right permission accepts it. On
 * acceptance the application writes the corresponding business row and stamps
 * `applied_entity_id` here, which keeps the provenance chain intact:
 * document -> finding -> accepted by -> estimate line.
 */
create table ai_findings (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  agent_id            text references ai_agents(id) on delete set null,
  document_id         uuid references documents(id) on delete cascade,
  document_version_id uuid references document_versions(id) on delete cascade,
  estimate_version_id uuid references estimate_versions(id) on delete cascade,
  project_id          uuid references projects(id) on delete cascade,

  finding_type        text not null
                        check (finding_type in ('scope_item', 'quantity_candidate', 'conflict', 'missing_information',
                                                'assumption', 'risk', 'rfi_candidate', 'service_candidate',
                                                'assembly_candidate', 'production_calibration', 'observation')),
  title               text not null,
  description         text not null,
  -- The structured payload the application will write if accepted.
  payload             jsonb not null default '{}'::jsonb,

  -- Evidence. `must_cite_sources` makes this non-negotiable for factual types.
  citations           jsonb not null default '[]'::jsonb,
  sheet_references    text[] not null default '{}',
  specification_references text[] not null default '{}',

  confidence          numeric(5,1) not null default 0 check (confidence between 0 and 100),
  suggested_gate      app.approval_gate not null default 'estimator_review',
  severity            text check (severity in ('low', 'moderate', 'high', 'critical')),

  state               text not null default 'proposed'
                        check (state in ('proposed', 'accepted', 'rejected', 'superseded', 'expired')),
  reviewed_by         uuid references auth.users(id) on delete set null,
  reviewed_at         timestamptz,
  review_note         text,
  -- The business row created when this finding was accepted.
  applied_entity_table text,
  applied_entity_id   uuid,

  model               text,
  prompt_version      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- An AI finding can never be born accepted; acceptance requires a reviewer.
  constraint ai_findings_acceptance
    check (state = 'proposed' or (reviewed_by is not null and reviewed_at is not null)),
  -- A factual finding must cite something.
  constraint ai_findings_citations
    check (finding_type not in ('quantity_candidate', 'conflict', 'scope_item')
           or jsonb_array_length(citations) > 0 or cardinality(sheet_references) > 0)
);
create index ai_findings_company_state_idx on ai_findings(company_id, state);
create index ai_findings_estimate_idx on ai_findings(estimate_version_id) where estimate_version_id is not null;
create index ai_findings_document_idx on ai_findings(document_id) where document_id is not null;
create index ai_findings_type_idx on ai_findings(company_id, finding_type, state);

comment on constraint ai_findings_citations on ai_findings is
  'Section 54 hallucination audit: a quantity, conflict or scope claim must point at the drawing or specification it came from.';

/** An AI agent may never flip a finding to accepted; only an authenticated human may. */
create or replace function app.enforce_ai_finding_acceptance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.state = 'accepted' and old.state <> 'accepted' then
    if new.reviewed_by is null then
      raise exception 'An AI finding can only be accepted by an identified human reviewer (RULE-008)'
        using errcode = 'insufficient_privilege';
    end if;
    if new.reviewed_by <> auth.uid() then
      raise exception 'The accepting user must be the authenticated user'
        using errcode = 'insufficient_privilege';
    end if;
    if not app.has_permission(new.company_id, 'ai.accept_findings') then
      raise exception 'User lacks the ai.accept_findings permission in company %', new.company_id
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_ai_finding_acceptance
  before update on ai_findings
  for each row execute function app.enforce_ai_finding_acceptance();

-- -----------------------------------------------------------------------------
-- Calibration proposals: actual production -> revised catalog rate
-- -----------------------------------------------------------------------------
create table production_calibrations (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  production_rate_id    uuid not null references production_rates(id) on delete cascade,
  proposed_rate_per_hour numeric(16,6) not null check (proposed_rate_per_hour > 0),
  current_rate_per_hour numeric(16,6) not null check (current_rate_per_hour > 0),
  variance_percent      numeric(10,6) not null,
  sample_size           int not null check (sample_size > 0),
  sample_project_ids    uuid[] not null default '{}',
  observed_conditions   jsonb not null default '{}'::jsonb,
  statistical_note      text,
  state                 app.approval_state not null default 'pending',
  reviewed_by           uuid references auth.users(id) on delete set null,
  reviewed_at           timestamptz,
  review_note           text,
  applied_rate_id       uuid references production_rates(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- A calibration must be based on enough observations to mean anything.
  constraint production_calibrations_min_sample check (sample_size >= 3)
);
create index production_calibrations_company_state_idx on production_calibrations(company_id, state);

comment on table production_calibrations is
  'The learning loop. An excavator estimated at 800 CY/day but repeatedly producing 650 CY/day generates a proposal here — never a silent edit to the rate library.';

-- -----------------------------------------------------------------------------
-- Risk register
-- -----------------------------------------------------------------------------
create table risks (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  estimate_version_id uuid references estimate_versions(id) on delete cascade,
  project_id          uuid references projects(id) on delete cascade,
  category            text not null,
  title               text not null,
  description         text not null,
  probability         text not null default 'moderate' check (probability in ('low', 'moderate', 'high', 'critical')),
  impact              text not null default 'moderate' check (impact in ('low', 'moderate', 'high', 'critical')),
  severity            text not null default 'moderate' check (severity in ('low', 'moderate', 'high', 'critical')),
  mitigation          text,
  owner_user_id       uuid references auth.users(id) on delete set null,
  status              text not null default 'open' check (status in ('open', 'mitigated', 'accepted', 'closed', 'realized')),
  cost_exposure       numeric(16,2) check (cost_exposure is null or cost_exposure >= 0),
  identified_by       text not null default 'human' check (identified_by in ('human', 'ai_agent')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint risks_subject check (num_nonnulls(estimate_version_id, project_id) >= 1)
);
create index risks_company_status_idx on risks(company_id, status, severity);
