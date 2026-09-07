-- =============================================================================
-- 0068 — One superadmin, and the people who sell for them
--
-- Migration 0064 gave the platform an operator. It gave it exactly one kind of
-- operator, which is wrong for how the business actually runs: somebody sells,
-- and somebody decides. Those are different jobs and giving the first the
-- powers of the second is how a discount nobody approved ends up permanent.
--
-- So there are two roles and the split between them is the point:
--
--   * **superadmin** — one, and only one. Approves everything: a plan change,
--     a feature turned on, a discount. Enforced by a partial unique index
--     rather than by convention, because "there should only be one" is the kind
--     of rule that quietly stops being true.
--   * **sales** — sees what is going on and sells. Can read every tenant's
--     operational standing and *propose* an upsell; can change nothing. A
--     proposal is a record with a rationale attached, which is worth more than
--     the permission they are not being given: six months later somebody can
--     ask why this customer is on that price and get an answer.
--
-- Both are read-only over customer business data, exactly as before. Nothing
-- here widens what an operator can see — only what they can do about it.
--
-- The approval machinery already exists: `approval_requests` has held gates,
-- tiers, requesters and deciders since migration 0003, with a rule that a
-- requester cannot approve their own request. A proposal here is that same
-- shape applied to the platform's own commercial decisions, so a sales admin
-- proposing an upsell to their own account is refused by the mechanism the
-- platform already trusts inside a tenant.
-- =============================================================================

alter table platform_admins
  add column if not exists role text not null default 'sales'
    check (role in ('superadmin', 'sales'));

comment on column platform_admins.role is
  'superadmin approves everything and there is exactly one. sales sees every tenant and can propose an upsell, and can change nothing — a proposal with a rationale is worth more than the permission being withheld.';

/*
 * Exactly one live superadmin.
 *
 * A partial unique index over a constant, which is the only way PostgreSQL
 * expresses "at most one row matching this predicate". Revoked superadmins do
 * not count, so the role can be handed over.
 */
create unique index if not exists platform_admins_one_superadmin
  on platform_admins ((true)) where role = 'superadmin' and revoked_at is null;

/** Is the caller the superadmin? */
create or replace function app.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from platform_admins
    where user_id = auth.uid() and revoked_at is null and role = 'superadmin'
  );
$$;

grant execute on function app.is_superadmin() to authenticated;

comment on function app.is_superadmin() is
  'Whether the caller is the one person who approves platform commercial decisions. Distinct from app.is_platform_admin(), which is true for sales as well and governs what may be seen rather than what may be done.';

-- -----------------------------------------------------------------------------
-- Only the superadmin changes a customer's entitlement
--
-- 0064 permitted any platform admin. Narrowed here rather than left, because
-- the whole reason to have a sales role is that selling and deciding are
-- different jobs.
-- -----------------------------------------------------------------------------
create or replace function app.set_feature_override(
  p_company     uuid,
  p_feature     text,
  p_effect      text,
  p_reason      text,
  p_valid_until timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_id uuid;
begin
  if not app.is_superadmin() then
    raise exception 'Only the superadmin may change a company''s features'
      using errcode = 'insufficient_privilege',
            hint = 'Sales can propose an upsell; approving one is the superadmin''s.';
  end if;
  if p_effect not in ('grant', 'revoke') then
    raise exception 'An override is a grant or a revoke, not %', p_effect
      using errcode = 'check_violation';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'An override must say why it exists'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from companies where id = p_company) then
    raise exception 'Company % not found', p_company using errcode = 'no_data_found';
  end if;

  update entitlement_overrides
     set revoked_at = now(), revoked_by = auth.uid(),
         revoke_reason = 'Replaced: ' || p_reason
   where company_id = p_company and feature = p_feature and revoked_at is null;

  insert into entitlement_overrides
    (company_id, feature, effect, reason, granted_by, valid_until)
  values (p_company, p_feature, p_effect, p_reason, auth.uid(), p_valid_until)
  returning id into v_id;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (p_company, auth.uid(), 'update', 'public.entitlement_overrides', v_id::text,
          jsonb_build_object('feature', p_feature, 'effect', p_effect,
                             'valid_until', p_valid_until, 'by', 'superadmin'),
          p_reason);

  return v_id;
end;
$$;

create or replace function app.clear_feature_override(
  p_company uuid, p_feature text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if not app.is_superadmin() then
    raise exception 'Only the superadmin may change a company''s features'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'Withdrawing an override must say why'
      using errcode = 'check_violation';
  end if;

  update entitlement_overrides
     set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = p_reason
   where company_id = p_company and feature = p_feature and revoked_at is null;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (p_company, auth.uid(), 'delete', 'public.entitlement_overrides', p_feature,
          jsonb_build_object('feature', p_feature, 'by', 'superadmin'), p_reason);
end;
$$;

-- -----------------------------------------------------------------------------
-- What sales proposes
-- -----------------------------------------------------------------------------
create table upsell_proposals (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,

  -- A move up the plan ladder, features turned on, or both.
  proposed_plan_id text references plans(id) on delete set null,
  proposed_features text[] not null default '{}',

  /*
   * Why this customer, now. Required, and the reason the whole mechanism is
   * worth more than simply granting sales the permission: six months later
   * somebody asks why this account is priced this way, and there is an answer.
   */
  rationale       text not null check (length(trim(rationale)) >= 10),
  /** What the proposer thinks it is worth per month, in cents. */
  estimated_monthly_cents int check (estimated_monthly_cents is null or estimated_monthly_cents >= 0),

  state           text not null default 'proposed'
                    check (state in ('proposed', 'approved', 'rejected', 'withdrawn', 'applied')),
  proposed_by     uuid references auth.users(id) on delete set null,
  proposed_at     timestamptz not null default now(),
  decided_by      uuid references auth.users(id) on delete set null,
  decided_at      timestamptz,
  decision_note   text,

  constraint upsell_proposals_decided
    check (state in ('proposed', 'withdrawn') or (decided_by is not null and decided_at is not null)),
  -- A proposal that proposes nothing is not a proposal.
  constraint upsell_proposals_proposes_something
    check (proposed_plan_id is not null or array_length(proposed_features, 1) > 0)
);
create index if not exists upsell_proposals_company_idx on upsell_proposals(company_id);
create index if not exists upsell_proposals_open_idx on upsell_proposals(state, proposed_at desc)
  where state = 'proposed';

comment on table upsell_proposals is
  'A sales admin''s proposal that a customer move up. ENTITY. Sales can create one and change nothing else; the superadmin decides. The rationale is required because the value of this mechanism over simply granting the permission is that the reason survives.';

alter table upsell_proposals enable row level security;
alter table upsell_proposals force row level security;

-- Operators read all of them; nobody else sees any.
create policy upsell_proposals_select on upsell_proposals for select to authenticated
  using (app.is_platform_admin());
-- Sales writes proposals through the function below rather than directly, so
-- no insert or update policy exists at all.
grant select on upsell_proposals to authenticated;
revoke all on upsell_proposals from anon;

select app.attach_standard_triggers('public.upsell_proposals'::regclass);

/**
 * Propose an upsell.
 *
 * Open to any operator, including the superadmin — somebody who can approve a
 * thing should still be able to write down why it was done.
 */
create or replace function app.propose_upsell(
  p_company   uuid,
  p_plan_id   text default null,
  p_features  text[] default '{}',
  p_rationale text default null,
  p_estimated_monthly_cents int default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_id uuid;
begin
  if not app.is_platform_admin() then
    raise exception 'Only a platform operator may propose an upsell'
      using errcode = 'insufficient_privilege';
  end if;
  if p_rationale is null or length(trim(p_rationale)) < 10 then
    raise exception 'A proposal must say why this customer, and why now'
      using errcode = 'check_violation';
  end if;
  if p_plan_id is null and coalesce(array_length(p_features, 1), 0) = 0 then
    raise exception 'A proposal that proposes nothing is not a proposal'
      using errcode = 'check_violation';
  end if;
  if p_plan_id is not null and not exists (select 1 from plans where id = p_plan_id) then
    raise exception 'Plan % does not exist', p_plan_id using errcode = 'no_data_found';
  end if;

  insert into upsell_proposals
    (company_id, proposed_plan_id, proposed_features, rationale,
     estimated_monthly_cents, proposed_by)
  values (p_company, p_plan_id, coalesce(p_features, '{}'), trim(p_rationale),
          p_estimated_monthly_cents, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

/**
 * Decide a proposal.
 *
 * The superadmin's alone, and they may not decide their own — the same
 * segregation the platform already enforces inside a tenant, applied to its own
 * commercial decisions. If the superadmin proposed it, somebody else has to
 * write it up, which is the point rather than an inconvenience.
 *
 * Approving records the decision. It deliberately does **not** apply the
 * override: applying is a separate, audited act, so "we agreed to this" and
 * "this is now live on their account" stay distinguishable.
 */
create or replace function app.decide_upsell(
  p_proposal uuid,
  p_approve  boolean,
  p_note     text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_p upsell_proposals%rowtype;
begin
  if not app.is_superadmin() then
    raise exception 'Only the superadmin may decide an upsell proposal'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_p from upsell_proposals where id = p_proposal;
  if not found then
    raise exception 'Proposal % not found', p_proposal using errcode = 'no_data_found';
  end if;
  if v_p.state <> 'proposed' then
    raise exception 'That proposal is already %', v_p.state using errcode = 'check_violation';
  end if;
  if v_p.proposed_by = auth.uid() then
    raise exception 'The person who proposed a change cannot be the one who approves it'
      using errcode = 'insufficient_privilege',
            hint = 'Have somebody else write it up, or record the decision another way.';
  end if;
  if not p_approve and (p_note is null or length(trim(p_note)) < 5) then
    raise exception 'A rejection has to say why' using errcode = 'check_violation';
  end if;

  update upsell_proposals
     set state = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_proposal;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (v_p.company_id, auth.uid(), 'update', 'public.upsell_proposals', p_proposal::text,
          jsonb_build_object('state', case when p_approve then 'approved' else 'rejected' end,
                             'by', 'superadmin'),
          coalesce(p_note, v_p.rationale));
end;
$$;

revoke all on function app.propose_upsell(uuid, text, text[], text, int) from public, anon;
revoke all on function app.decide_upsell(uuid, boolean, text) from public, anon;
grant execute on function app.propose_upsell(uuid, text, text[], text, int) to authenticated;
grant execute on function app.decide_upsell(uuid, boolean, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Where the potential is
--
-- Selectable upsell potential means the platform showing which customers are
-- worth a call, from what it already knows: who is close to a plan limit, who
-- is on a trial that is nearly up, who is paying for less than they use.
-- Sales selects from that rather than guessing.
-- -----------------------------------------------------------------------------
create or replace view admin_upsell_potential as
select
  c.id                                    as company_id,
  c.name,
  e.plan_id                               as current_plan,
  p.tier                                  as current_tier,
  n.id                                    as next_plan,
  n.name                                  as next_plan_name,
  n.tier                                  as next_tier,

  m.member_count,
  p.max_seats,
  n.max_seats                             as next_max_seats,
  est.active_estimates,
  p.max_active_estimates,

  e.source                                as entitlement_source,
  e.valid_until                           as trial_ends,

  /*
   * Why this customer is worth a call, derived rather than guessed. Ordered so
   * the most concrete reason wins: a limit already reached beats one being
   * approached, which beats a trial running out.
   */
  case
    when p.max_seats is not null and m.member_count >= p.max_seats
      then 'At the seat limit'
    when p.max_active_estimates is not null
         and est.active_estimates >= p.max_active_estimates
      then 'At the estimate limit'
    when p.max_seats is not null and m.member_count >= p.max_seats - 1
      then 'One seat from the limit'
    when e.source = 'trial' and e.valid_until is not null
         and e.valid_until < now() + interval '7 days'
      then 'Trial ends within a week'
    when n.id is not null then 'Room to move up'
  end                                     as signal,

  (select count(*) from upsell_proposals up
    where up.company_id = c.id and up.state = 'proposed') as open_proposals
from companies c
left join entitlements e on e.company_id = c.id
left join plans p on p.id = e.plan_id
-- The next plan up: the cheapest tier above the current one that is still sold.
left join lateral (
  select x.id, x.name, x.tier, x.max_seats
  from plans x
  where x.is_active and x.is_public and x.tier > coalesce(p.tier, -1)
  order by x.tier
  limit 1
) n on true
left join lateral (
  select count(*) as member_count from company_memberships cm
  where cm.company_id = c.id and cm.status = 'active'
) m on true
left join lateral (
  select count(*) as active_estimates from estimates es
  where es.company_id = c.id and es.status in ('draft', 'in_review', 'approved', 'issued')
) est on true
where app.is_platform_admin();

comment on view admin_upsell_potential is
  'Which customers are worth a call, derived from what the platform already knows: at a seat limit, at an estimate limit, a trial about to end, or simply room to move up. Definer like the other admin views, and it carries no customer business data — counts and plan standing only.';

grant select on admin_upsell_potential to authenticated;
revoke all on admin_upsell_potential from anon;

-- -----------------------------------------------------------------------------
-- Reachable from a browser
-- -----------------------------------------------------------------------------
create or replace function public.is_superadmin()
returns boolean
language sql stable security invoker set search_path = public, pg_catalog
as $$ select app.is_superadmin(); $$;

create or replace function public.propose_upsell(
  p_company uuid, p_plan_id text default null, p_features text[] default '{}',
  p_rationale text default null, p_estimated_monthly_cents int default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin
  return app.propose_upsell(p_company, p_plan_id, p_features, p_rationale,
                            p_estimated_monthly_cents);
end; $$;

create or replace function public.decide_upsell(
  p_proposal uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.decide_upsell(p_proposal, p_approve, p_note); end; $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.is_superadmin()',
    'public.propose_upsell(uuid, text, text[], text, int)',
    'public.decide_upsell(uuid, boolean, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

select app.assert_security_gates();
