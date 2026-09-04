-- =============================================================================
-- GrounUp Enterprise — 0009 SaaS commercialization
--
-- Two invariants govern this file:
--
--  1. No card data. The database holds Stripe identifiers and derived state
--     only — never a PAN, CVC or any payment credential.
--  2. Entitlement never comes from the browser. Subscription state is written
--     exclusively from signature-verified Stripe webhooks, replayed
--     idempotently by event id. A success redirect grants nothing.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Governed plan catalog — the single source of truth for what may be sold
-- -----------------------------------------------------------------------------
create table plans (
  id                    text primary key check (id ~ '^[a-z][a-z0-9_]{1,40}$'),
  name                  text not null,
  tagline               text,
  description           text,
  tier                  int not null check (tier between 0 and 100),
  is_public             boolean not null default true,
  is_active             boolean not null default true,
  -- Seat and usage limits. NULL means unlimited.
  max_seats             int check (max_seats is null or max_seats > 0),
  max_companies         int check (max_companies is null or max_companies > 0),
  max_active_estimates  int check (max_active_estimates is null or max_active_estimates > 0),
  max_active_projects   int check (max_active_projects is null or max_active_projects > 0),
  storage_gb            int check (storage_gb is null or storage_gb > 0),
  ai_credits_per_month  int check (ai_credits_per_month is null or ai_credits_per_month >= 0),
  -- Feature keys this plan unlocks, checked by app.has_entitlement().
  features              text[] not null default '{}',
  trial_days            int not null default 0 check (trial_days >= 0),
  sort_order            int not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table plans is
  'The approved plan catalog. Edge Functions validate every requested plan against this table, so the browser cannot invent a price or a feature set.';

/**
 * Stripe price identifiers per plan and interval.
 *
 * Prices live here rather than in frontend constants so a price change is a
 * data change, not a rebuild — and so the amount displayed always matches the
 * amount Stripe will charge.
 */
create table plan_prices (
  id                    uuid primary key default gen_random_uuid(),
  plan_id               text not null references plans(id) on delete cascade,
  stripe_price_id       text not null unique,
  interval              text not null check (interval in ('month', 'year')),
  unit_amount_cents     int not null check (unit_amount_cents >= 0),
  currency              char(3) not null default 'USD',
  -- 'licensed' bills per seat; 'metered' bills on reported usage.
  usage_type            text not null default 'licensed' check (usage_type in ('licensed', 'metered')),
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (plan_id, interval, usage_type)
);
create index plan_prices_plan_idx on plan_prices(plan_id) where is_active;

-- -----------------------------------------------------------------------------
-- Subscriptions
-- -----------------------------------------------------------------------------
create table subscriptions (
  id                        uuid primary key default gen_random_uuid(),
  company_id                uuid not null references companies(id) on delete cascade,
  plan_id                   text not null references plans(id) on delete restrict,
  stripe_customer_id        text not null,
  stripe_subscription_id    text unique,
  status                    app.subscription_status not null default 'incomplete',
  quantity                  int not null default 1 check (quantity > 0),
  current_period_start      timestamptz,
  current_period_end        timestamptz,
  trial_start               timestamptz,
  trial_end                 timestamptz,
  cancel_at_period_end      boolean not null default false,
  canceled_at               timestamptz,
  ended_at                  timestamptz,
  default_payment_method_brand text,
  default_payment_method_last4 char(4),
  -- The webhook event that last advanced this row, for replay diagnosis.
  last_event_id             text,
  last_event_at             timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  -- One live subscription per company keeps entitlement resolution unambiguous.
  constraint subscriptions_period check (current_period_end is null or current_period_start is null or current_period_end > current_period_start)
);
create unique index subscriptions_one_live_per_company_idx
  on subscriptions(company_id)
  where status in ('trialing', 'active', 'past_due', 'unpaid', 'paused');
create index subscriptions_company_idx on subscriptions(company_id);
create index subscriptions_stripe_customer_idx on subscriptions(stripe_customer_id);

comment on column subscriptions.default_payment_method_last4 is
  'Last four digits only, for display. No PAN, expiry or CVC is ever stored.';

create table subscription_items (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  subscription_id       uuid not null references subscriptions(id) on delete cascade,
  stripe_item_id        text not null unique,
  stripe_price_id       text not null,
  plan_price_id         uuid references plan_prices(id) on delete set null,
  quantity              int not null default 1 check (quantity > 0),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index subscription_items_subscription_idx on subscription_items(subscription_id);

-- -----------------------------------------------------------------------------
-- Effective entitlements
-- -----------------------------------------------------------------------------

/**
 * Materialized per-company entitlement, derived from verified webhook state.
 *
 * It exists as a table rather than a view because entitlement must survive a
 * Stripe outage: if the API is unreachable, the last verified state still
 * governs access, and `valid_until` bounds how long that grace lasts.
 */
create table entitlements (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  plan_id               text references plans(id) on delete set null,
  subscription_id       uuid references subscriptions(id) on delete set null,
  is_active             boolean not null default false,
  features              text[] not null default '{}',
  max_seats             int,
  max_active_estimates  int,
  max_active_projects   int,
  storage_gb            int,
  ai_credits_per_month  int,
  -- Access is honored until here even if Stripe is unreachable.
  valid_until           timestamptz,
  source                text not null default 'stripe_webhook'
                          check (source in ('stripe_webhook', 'manual_grant', 'trial', 'enterprise_contract')),
  granted_by            uuid references auth.users(id) on delete set null,
  grant_reason          text,
  updated_at            timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  unique (company_id),
  constraint entitlements_manual_reason check (source <> 'manual_grant' or (granted_by is not null and grant_reason is not null))
);

comment on table entitlements is
  'Effective commercial access per company, written only from verified Stripe webhooks or an explicit, attributed manual grant.';

/**
 * Does a company currently hold a feature?
 *
 * Commercial entitlement is necessary but never sufficient: the caller must
 * still pass the normal RBAC check. Paying for a feature does not grant a user
 * permission to use it.
 */
create or replace function app.has_entitlement(p_company uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from entitlements e
    where e.company_id = p_company
      and e.is_active
      and (e.valid_until is null or e.valid_until > now())
      and (e.features @> array['*'] or e.features @> array[p_feature])
  );
$$;

/** Entitlement AND authorization. This is the check application code should call. */
create or replace function app.can_use(p_company uuid, p_feature text, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select app.has_entitlement(p_company, p_feature) and app.has_permission(p_company, p_permission);
$$;

grant execute on function app.has_entitlement(uuid, text), app.can_use(uuid, text, text)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Usage metering
-- -----------------------------------------------------------------------------
create table usage_events (
  id                bigint generated always as identity primary key,
  company_id        uuid not null references companies(id) on delete cascade,
  user_id           uuid references auth.users(id) on delete set null,
  metric            text not null check (metric ~ '^[a-z][a-z0-9_.]{1,60}$'),
  quantity          numeric(16,4) not null default 1 check (quantity >= 0),
  unit              text not null default 'count',
  entity_table      text,
  entity_id         text,
  metadata          jsonb not null default '{}'::jsonb,
  -- Set once the event has been reported to Stripe for metered billing.
  reported_at       timestamptz,
  stripe_usage_record_id text,
  occurred_at       timestamptz not null default now()
);
create index usage_events_company_metric_idx on usage_events(company_id, metric, occurred_at desc);
create index usage_events_unreported_idx on usage_events(occurred_at) where reported_at is null;

create trigger usage_events_immutable
  before update or delete on usage_events
  for each row when (old.reported_at is not null)
  execute function app.forbid_mutation();

/** Current-period usage for a metric, used for limit enforcement and dashboards. */
create or replace function app.current_usage(p_company uuid, p_metric text)
returns numeric
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(sum(u.quantity), 0)
  from usage_events u
  left join subscriptions s
    on s.company_id = u.company_id
   and s.status in ('trialing', 'active', 'past_due', 'unpaid', 'paused')
  where u.company_id = p_company
    and u.metric = p_metric
    and u.occurred_at >= coalesce(s.current_period_start, date_trunc('month', now()));
$$;

grant execute on function app.current_usage(uuid, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Stripe webhook idempotency ledger
-- -----------------------------------------------------------------------------
create table stripe_events (
  -- Stripe's own event id. The primary key is the idempotency guarantee:
  -- a replayed event collides here and is skipped rather than applied twice.
  id                text primary key,
  type              text not null,
  api_version       text,
  livemode          boolean not null default false,
  company_id        uuid references companies(id) on delete set null,
  payload           jsonb not null,
  processing_state  text not null default 'received'
                      check (processing_state in ('received', 'processed', 'ignored', 'failed')),
  processing_error  text,
  attempts          int not null default 0 check (attempts >= 0),
  received_at       timestamptz not null default now(),
  processed_at      timestamptz
);
create index stripe_events_type_idx on stripe_events(type, received_at desc);
create index stripe_events_unprocessed_idx on stripe_events(received_at) where processing_state in ('received', 'failed');

comment on table stripe_events is
  'Every webhook Stripe delivers, keyed by its event id. Insert-on-conflict-do-nothing gives exactly-once processing across retries and replays.';

-- -----------------------------------------------------------------------------
-- Invoice history (display only; Stripe remains the system of record)
-- -----------------------------------------------------------------------------
create table billing_invoices (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  stripe_invoice_id     text not null unique,
  number                text,
  status                text not null,
  amount_due_cents      int not null default 0,
  amount_paid_cents     int not null default 0,
  currency              char(3) not null default 'USD',
  period_start          timestamptz,
  period_end            timestamptz,
  hosted_invoice_url    text,
  invoice_pdf_url       text,
  issued_at             timestamptz,
  paid_at               timestamptz,
  created_at            timestamptz not null default now()
);
create index billing_invoices_company_idx on billing_invoices(company_id, issued_at desc);
