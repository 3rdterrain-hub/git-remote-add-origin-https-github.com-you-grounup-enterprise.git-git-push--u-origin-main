-- =============================================================================
-- 0030 — Plan versioning, and the audit gaps behind it
--
-- The plan catalog was a live table with no history. `entitlements.features`
-- was copied from whatever `plans.features` said at the moment a webhook
-- arrived, so editing a plan silently re-termed every existing subscriber on
-- their next event, and nothing in the platform could answer "what did this
-- customer actually buy in March".
--
-- That is the same defect the library snapshots fixed for estimates: a figure
-- somebody agreed to, resolved against a table that has since moved. Commercial
-- terms need the same treatment, and for the same reason — a customer disputing
-- a bill and a contractor defending an estimate are asking the identical
-- question.
--
-- Two differences from library snapshots, both deliberate:
--
--   * **Versions are shared, not copied per subscriber.** A plan has a handful
--     of versions and thousands of subscribers; copying terms per subscriber
--     would duplicate the catalog for no gain.
--   * **A version is published by trigger, not by discipline.** Changing a
--     commercial term on `plans` publishes a new version automatically. A rule
--     that depends on somebody remembering is not a rule.
-- =============================================================================

create table plan_versions (
  id                    uuid primary key default gen_random_uuid(),
  plan_id               text not null references plans(id) on delete restrict,
  version               int not null check (version > 0),

  -- The commercial terms as published. Copied, not referenced: a version has
  -- to keep saying what it said after the plan moves on.
  name                  text not null,
  tier                  int not null,
  max_seats             int,
  max_companies         int,
  max_active_estimates  int,
  max_active_projects   int,
  storage_gb            int,
  ai_credits_per_month  int,
  features              text[] not null default '{}',
  trial_days            int not null default 0,

  published_at          timestamptz not null default now(),
  -- Null for a version the trigger published from a catalog edit; set when a
  -- person publishes deliberately.
  published_by          uuid references auth.users(id) on delete set null,
  change_reason         text,

  unique (plan_id, version)
);
create index plan_versions_plan_idx on plan_versions(plan_id, version desc);

-- A published version is what somebody was sold. Editing it rewrites the terms
-- of a sale that already happened.
create trigger plan_versions_immutable
  before update or delete on plan_versions
  for each row execute function app.forbid_mutation();

comment on table plan_versions is
  'Commercial terms as published, append-only. ENTITY. A subscription points at the version it was sold under, so terms cannot change beneath a customer.';

comment on column plan_versions.features is
  'The feature keys this version grants. Copied from the plan at publication, because the plan will move and this must not.';

/**
 * Publish a new version whenever a plan's commercial terms change.
 *
 * Only the terms matter. Editing a tagline, a description or a sort order is
 * marketing copy and does not re-term anybody, so it publishes nothing — a
 * version per typo would make the history unreadable and would not protect
 * anyone.
 */
create or replace function app.publish_plan_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_latest plan_versions%rowtype;
  v_next   int;
begin
  select * into v_latest
  from plan_versions
  where plan_id = new.id
  order by version desc
  limit 1;

  if found
     and v_latest.name = new.name
     and v_latest.tier = new.tier
     and v_latest.max_seats is not distinct from new.max_seats
     and v_latest.max_companies is not distinct from new.max_companies
     and v_latest.max_active_estimates is not distinct from new.max_active_estimates
     and v_latest.max_active_projects is not distinct from new.max_active_projects
     and v_latest.storage_gb is not distinct from new.storage_gb
     and v_latest.ai_credits_per_month is not distinct from new.ai_credits_per_month
     and v_latest.features = new.features
     and v_latest.trial_days = new.trial_days
  then
    return new;
  end if;

  v_next := coalesce(v_latest.version, 0) + 1;

  insert into plan_versions (
    plan_id, version, name, tier, max_seats, max_companies, max_active_estimates,
    max_active_projects, storage_gb, ai_credits_per_month, features, trial_days,
    published_by, change_reason)
  values (
    new.id, v_next, new.name, new.tier, new.max_seats, new.max_companies,
    new.max_active_estimates, new.max_active_projects, new.storage_gb,
    new.ai_credits_per_month, new.features, new.trial_days,
    auth.uid(),
    case when v_next = 1 then 'Initial publication' else 'Commercial terms changed' end);

  return new;
end;
$$;

create trigger plans_publish_version
  after insert or update on plans
  for each row execute function app.publish_plan_version();

-- Publish version 1 for every plan already in the catalog.
insert into plan_versions (
  plan_id, version, name, tier, max_seats, max_companies, max_active_estimates,
  max_active_projects, storage_gb, ai_credits_per_month, features, trial_days, change_reason)
select p.id, 1, p.name, p.tier, p.max_seats, p.max_companies, p.max_active_estimates,
       p.max_active_projects, p.storage_gb, p.ai_credits_per_month, p.features, p.trial_days,
       'Initial publication'
from plans p
where not exists (select 1 from plan_versions v where v.plan_id = p.id);

/**
 * The version currently on sale for a plan.
 *
 * Derived as the highest version rather than carried as a flag, because
 * plan_versions is append-only and an append-only table cannot maintain one.
 */
create or replace function app.current_plan_version(p_plan text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select v.id from plan_versions v
  where v.plan_id = p_plan
  order by v.version desc
  limit 1;
$$;

grant execute on function app.current_plan_version(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Pin the terms onto what was sold
-- -----------------------------------------------------------------------------
alter table subscriptions
  add column plan_version_id uuid references plan_versions(id) on delete restrict;

alter table entitlements
  add column plan_version_id uuid references plan_versions(id) on delete restrict;

comment on column subscriptions.plan_version_id is
  'The commercial terms this subscription was sold under. Null only for rows written before versioning existed.';

comment on column entitlements.plan_version_id is
  'The version these limits and features came from. What a customer is entitled to is answerable from this row alone.';

-- Existing rows point at the version their plan was on when versioning began.
update subscriptions s
   set plan_version_id = app.current_plan_version(s.plan_id)
 where s.plan_version_id is null;

update entitlements e
   set plan_version_id = app.current_plan_version(e.plan_id)
 where e.plan_version_id is null and e.plan_id is not null;

/**
 * Entitlement must agree with the version it names.
 *
 * Without this the row could grant a feature set the version does not contain,
 * which is exactly the drift versioning exists to stop.
 */
create or replace function app.enforce_entitlement_matches_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v plan_versions%rowtype;
begin
  if new.plan_version_id is null then
    return new;
  end if;

  select * into v from plan_versions where id = new.plan_version_id;

  if v.plan_id <> new.plan_id then
    raise exception
      'Entitlement names plan % but version % belongs to plan %.',
      new.plan_id, new.plan_version_id, v.plan_id
      using errcode = 'check_violation';
  end if;

  -- A manual grant is allowed to differ, because that is what a manual grant
  -- is; it already has to name who granted it and why.
  if new.source = 'manual_grant' then
    return new;
  end if;

  if new.is_active and new.features <> v.features then
    raise exception
      'Entitlement for company % grants % but plan version % publishes %. Entitlement cannot exceed the terms it was sold under.',
      new.company_id, new.features, v.version, v.features
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger entitlements_match_version
  before insert or update on entitlements
  for each row execute function app.enforce_entitlement_matches_version();

-- -----------------------------------------------------------------------------
-- The audit gaps
--
-- Migration 0011 attached the standard triggers by looping over every table
-- that existed then. Nothing runs that loop for tables added afterwards, so
-- everything from 0026 onward arrived unaudited — including a work calendar
-- whose holidays move every date on a project schedule.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['work_calendars', 'work_calendar_exceptions', 'plan_versions'] loop
    perform app.attach_standard_triggers(format('public.%I', t)::regclass);
  end loop;
end $$;

-- attach_standard_triggers re-adds an audit trigger to plan_versions, which is
-- append-only and audits itself by existing. Drop it rather than write every
-- published version into the ledger twice.
drop trigger if exists audit_row on plan_versions;

/**
 * What Stripe sent cannot be rewritten.
 *
 * `stripe_events` is the idempotency ledger the whole billing story rests on,
 * and it was neither audited nor immutable: the payload of a processed event
 * could be edited afterwards with no trace. It cannot be fully append-only,
 * because processing state legitimately advances, so the record is frozen and
 * the processing columns are left free.
 */
create or replace function app.forbid_stripe_event_rewrite()
returns trigger
language plpgsql
as $$
begin
  if new.id <> old.id
     or new.type <> old.type
     or new.payload <> old.payload
     or new.livemode <> old.livemode
     or new.received_at <> old.received_at then
    raise exception
      'The record of Stripe event % cannot be rewritten. Only its processing state may change.',
      old.id
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger stripe_events_record_immutable
  before update on stripe_events
  for each row execute function app.forbid_stripe_event_rewrite();

comment on function app.forbid_stripe_event_rewrite() is
  'Freezes what Stripe sent while leaving processing_state, attempts and processed_at free to advance.';

/*
 * Two more ledgers that were neither audited nor append-only.
 *
 * `api_requests` is the record of what callers asked for and what they were
 * told, cited as evidence in the security verification. `ai_messages` is the
 * transcript an AI finding's provenance chain runs through. Nothing writes to
 * either after insert, and a log that can be edited is not evidence.
 */
create trigger api_requests_immutable
  before update or delete on api_requests
  for each row execute function app.forbid_mutation();

create trigger ai_messages_immutable
  before update or delete on ai_messages
  for each row execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- RLS and grants
-- -----------------------------------------------------------------------------

-- Readable by any authenticated user, and by nobody else.
--
-- The privilege gate in 0012 refuses the anonymous role anything beyond the
-- live plan catalog, and it refused this table when the grant was written
-- wider. It was right to: a visitor comparing prices reads `plans` and
-- `plan_prices`. Version history answers "what was I sold", which is a question
-- only a customer has, and a customer is signed in.
alter table plan_versions enable row level security;
alter table plan_versions force row level security;
create policy plan_versions_select on plan_versions for select to authenticated
  using (exists (select 1 from plans p where p.id = plan_versions.plan_id and p.is_active));

grant select on plan_versions to authenticated;

select app.assert_security_gates();
