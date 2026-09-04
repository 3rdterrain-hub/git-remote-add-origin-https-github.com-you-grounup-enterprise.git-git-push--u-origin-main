-- =============================================================================
-- GrounUp Enterprise — 0013 Completing the operations surface
--
-- Adds the tables the seven partially-built services still needed: submittals,
-- proposal line detail, notifications, and the AI model/prompt registry.
-- Everything here follows the same tenancy, audit and RLS pattern as 0002-0012.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Submittals (SVC-RFI covers RFIs and submittals; RFIs already existed)
-- -----------------------------------------------------------------------------
create table submittals (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  project_id          uuid references projects(id) on delete cascade,
  estimate_version_id uuid references estimate_versions(id) on delete set null,
  number              text not null,
  title               text not null,
  spec_section        text,
  submittal_type      text not null default 'product_data'
                        check (submittal_type in ('product_data', 'shop_drawing', 'sample',
                                                  'mix_design', 'certificate', 'test_report',
                                                  'closeout', 'other')),
  description         text,
  vendor_id           uuid references vendors(id) on delete set null,
  -- Ball-in-court: who the item is waiting on right now.
  ball_in_court       text not null default 'contractor'
                        check (ball_in_court in ('contractor', 'architect', 'engineer', 'owner', 'vendor', 'closed')),
  status              text not null default 'draft'
                        check (status in ('draft', 'submitted', 'under_review', 'approved',
                                          'approved_as_noted', 'revise_resubmit', 'rejected', 'closed')),
  revision            int not null default 0 check (revision >= 0),
  required_on_site    date,
  lead_time_days      int check (lead_time_days is null or lead_time_days >= 0),
  submitted_at        timestamptz,
  due_at              timestamptz,
  returned_at         timestamptz,
  reviewer_comment    text,
  storage_path        text,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, number),
  -- A returned submittal must record what the reviewer decided.
  constraint submittals_returned
    check (status not in ('approved', 'approved_as_noted', 'revise_resubmit', 'rejected')
           or returned_at is not null),
  -- Resubmission requires a revision bump, so history is never overwritten.
  constraint submittals_resubmit check (status <> 'revise_resubmit' or revision >= 0)
);
create index submittals_company_status_idx on submittals(company_id, status);
create index submittals_project_idx on submittals(project_id) where project_id is not null;
create index submittals_ball_idx on submittals(company_id, ball_in_court) where status not in ('closed', 'approved');

comment on column submittals.ball_in_court is
  'Who owes the next action. This is the field a superintendent actually scans the log for.';

comment on column submittals.required_on_site is
  'Backed off by lead_time_days to give the real submit-by date. A submittal approved after this is late regardless of how fast it was reviewed.';

-- -----------------------------------------------------------------------------
-- Proposal line detail
-- -----------------------------------------------------------------------------
create table proposal_line_items (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  proposal_id       uuid not null references proposals(id) on delete cascade,
  -- The estimate line this was rolled up from, so a proposal number always
  -- traces back to the priced work behind it.
  source_line_item_id uuid references estimate_line_items(id) on delete set null,
  sort_order        int not null default 0,
  section           text,
  description       text not null,
  quantity          numeric(18,4),
  unit              app.unit_code,
  unit_price        numeric(16,4),
  extended_price    numeric(18,2) not null default 0,
  is_alternate      boolean not null default false,
  is_optional       boolean not null default false,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index proposal_line_items_proposal_idx on proposal_line_items(proposal_id, sort_order);

create trigger proposal_line_items_tenant_parent
  before insert or update on proposal_line_items
  for each row execute function app.enforce_tenant_parent('proposals', 'proposal_id', 'id');

-- Issued proposals are commercial documents; freeze them like estimate versions.
alter table proposals add column if not exists issued_by uuid references auth.users(id) on delete set null;
alter table proposals add column if not exists sent_to_email text;
alter table proposals add column if not exists viewed_at timestamptz;

create or replace function app.enforce_proposal_immutability()
returns trigger
language plpgsql
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_mutable constant text[] := array[
    'status', 'updated_at', 'accepted_at', 'accepted_by_name', 'declined_at', 'viewed_at'
  ];
  v_generated text[];
  k text;
begin
  if old.status = 'draft' then
    return new;
  end if;

  -- See app.enforce_pay_application_lock: generated columns are unpopulated in
  -- a BEFORE trigger and are guarded by their source columns instead.
  select coalesce(array_agg(a.attname::text), '{}')
  into v_generated
  from pg_attribute a
  where a.attrelid = tg_relid and a.attnum > 0 and not a.attisdropped
    and a.attgenerated <> '';

  for k in select jsonb_object_keys(v_old) loop
    if k = any (v_mutable) or k = any (v_generated) then continue; end if;
    if (v_old -> k) is distinct from (v_new -> k) then
      raise exception
        'Proposal % is % and its content is fixed; field "%" cannot change. Issue a new proposal instead.',
        old.number, old.status, k
        using errcode = 'restrict_violation';
    end if;
  end loop;
  return new;
end;
$$;

create trigger enforce_proposal_immutability
  before update on proposals
  for each row execute function app.enforce_proposal_immutability();

-- -----------------------------------------------------------------------------
-- Notifications (SVC-NOTIFY)
-- -----------------------------------------------------------------------------
create table notifications (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  -- NULL recipient = a company-wide notice every member sees.
  user_id           uuid references auth.users(id) on delete cascade,
  category          text not null
                      check (category in ('estimate', 'project', 'rfi', 'submittal', 'change_order',
                                          'approval', 'ai_finding', 'calibration', 'billing',
                                          'safety', 'schedule', 'system')),
  severity          text not null default 'info'
                      check (severity in ('info', 'success', 'warning', 'critical')),
  title             text not null,
  body              text,
  -- Deep link into the app, e.g. /app/estimates/<id>.
  action_path       text check (action_path is null or action_path ~ '^/'),
  action_label      text,
  entity_table      text,
  entity_id         text,
  read_at           timestamptz,
  dismissed_at      timestamptz,
  -- Delivery beyond in-app, recorded so a resend is not guesswork.
  emailed_at        timestamptz,
  created_at        timestamptz not null default now()
);
create index notifications_user_unread_idx on notifications(user_id, created_at desc) where read_at is null;
create index notifications_company_idx on notifications(company_id, created_at desc);

comment on column notifications.user_id is
  'NULL addresses the whole company. A member reads it if they belong to the company; a targeted notice reaches only its recipient.';

create table notification_preferences (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  category          text not null,
  in_app            boolean not null default true,
  email             boolean not null default false,
  -- Only notify at or above this severity.
  min_severity      text not null default 'info'
                      check (min_severity in ('info', 'success', 'warning', 'critical')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, user_id, category)
);

-- -----------------------------------------------------------------------------
-- Model and prompt registry (SVC-MODEL)
-- -----------------------------------------------------------------------------
create table ai_models (
  id                text primary key,
  provider          text not null,
  display_name      text not null,
  -- What this model is allowed to be used for.
  capabilities      text[] not null default '{}',
  context_tokens    int check (context_tokens is null or context_tokens > 0),
  input_cost_per_mtok  numeric(12,4) check (input_cost_per_mtok is null or input_cost_per_mtok >= 0),
  output_cost_per_mtok numeric(12,4) check (output_cost_per_mtok is null or output_cost_per_mtok >= 0),
  is_enabled        boolean not null default true,
  is_default        boolean not null default false,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index ai_models_one_default_idx on ai_models(is_default) where is_default;

create table ai_prompts (
  id                uuid primary key default gen_random_uuid(),
  -- NULL company_id = the GrounUp-shipped governed prompt.
  company_id        uuid references companies(id) on delete cascade,
  agent_id          text not null references ai_agents(id) on delete cascade,
  version           text not null,
  system_prompt     text not null,
  tools             jsonb not null default '[]'::jsonb,
  -- Evaluation state, so a prompt cannot be promoted on vibes.
  eval_pass_rate    numeric(5,4) check (eval_pass_rate is null or (eval_pass_rate >= 0 and eval_pass_rate <= 1)),
  eval_sample_size  int check (eval_sample_size is null or eval_sample_size >= 0),
  eval_notes        text,
  state             text not null default 'draft'
                      check (state in ('draft', 'evaluating', 'active', 'retired')),
  activated_by      uuid references auth.users(id) on delete set null,
  activated_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (agent_id, company_id, version),
  -- An active prompt must record who promoted it and its evaluation result.
  constraint ai_prompts_activation
    check (state <> 'active' or (activated_by is not null and activated_at is not null
                                 and eval_pass_rate is not null))
);
create index ai_prompts_agent_idx on ai_prompts(agent_id, state);
create unique index ai_prompts_one_active_idx on ai_prompts(agent_id, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where state = 'active';

comment on constraint ai_prompts_activation on ai_prompts is
  'A prompt cannot go live without an evaluation result and a named human who promoted it. This is RULE-008 applied to the agents themselves.';

-- -----------------------------------------------------------------------------
-- Field operations: labor and equipment logged on a daily report
-- -----------------------------------------------------------------------------
create table daily_report_labor (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  daily_report_id   uuid not null references daily_reports(id) on delete cascade,
  labor_rate_id     uuid references labor_rates(id) on delete set null,
  crew_id           uuid references crews(id) on delete set null,
  classification    text not null,
  headcount         int not null check (headcount > 0),
  straight_hours    numeric(8,2) not null default 0 check (straight_hours >= 0),
  overtime_hours    numeric(8,2) not null default 0 check (overtime_hours >= 0),
  cost_code_id      uuid references cost_codes(id) on delete set null,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index daily_report_labor_report_idx on daily_report_labor(daily_report_id);

create trigger daily_report_labor_tenant_parent
  before insert or update on daily_report_labor
  for each row execute function app.enforce_tenant_parent('daily_reports', 'daily_report_id', 'id');

create table daily_report_equipment (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  daily_report_id   uuid not null references daily_reports(id) on delete cascade,
  equipment_id      uuid references equipment(id) on delete set null,
  description       text not null,
  units             int not null default 1 check (units > 0),
  operating_hours   numeric(8,2) not null default 0 check (operating_hours >= 0),
  idle_hours        numeric(8,2) not null default 0 check (idle_hours >= 0),
  down_hours        numeric(8,2) not null default 0 check (down_hours >= 0),
  fuel_gallons      numeric(10,2) not null default 0 check (fuel_gallons >= 0),
  cost_code_id      uuid references cost_codes(id) on delete set null,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index daily_report_equipment_report_idx on daily_report_equipment(daily_report_id);

create trigger daily_report_equipment_tenant_parent
  before insert or update on daily_report_equipment
  for each row execute function app.enforce_tenant_parent('daily_reports', 'daily_report_id', 'id');

-- A submitted daily report is the contemporaneous record of what happened on a
-- given day; it is evidence in a claim. Freeze it once submitted.
create or replace function app.enforce_daily_report_immutability()
returns trigger
language plpgsql
as $$
begin
  if old.submitted_at is not null and new.submitted_at is not null
     and old.report_date is distinct from new.report_date then
    raise exception 'A submitted daily report cannot change its date'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger enforce_daily_report_immutability
  before update on daily_reports
  for each row execute function app.enforce_daily_report_immutability();

-- -----------------------------------------------------------------------------
-- Change order line detail
-- -----------------------------------------------------------------------------
create table change_order_items (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  change_order_id   uuid not null references change_orders(id) on delete cascade,
  sort_order        int not null default 0,
  description       text not null,
  cost_code_id      uuid references cost_codes(id) on delete set null,
  quantity          numeric(18,4) not null default 0,
  unit              app.unit_code,
  unit_price        numeric(16,4) not null default 0,
  cost_amount       numeric(16,2) not null default 0,
  price_amount      numeric(16,2) not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index change_order_items_co_idx on change_order_items(change_order_id, sort_order);

create trigger change_order_items_tenant_parent
  before insert or update on change_order_items
  for each row execute function app.enforce_tenant_parent('change_orders', 'change_order_id', 'id');
