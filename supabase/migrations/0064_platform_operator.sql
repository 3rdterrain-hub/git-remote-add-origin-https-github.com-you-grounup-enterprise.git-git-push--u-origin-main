-- =============================================================================
-- 0064 — The operator of the platform
--
-- Everything in GrounUp is built so that no company can see another. That is
-- correct for customers and it means the person running the platform has no way
-- to see their own business: no list of companies, no view of who is paying, no
-- way to turn a feature on for a customer who asked, no way to see a webhook
-- that failed. All of it would happen in a SQL console.
--
-- Three decisions, and the first is the one that matters.
--
-- **A platform admin cannot read customer business data.** Not estimates, not
-- projects, not costs, not documents. The temptation is to add
-- `or app.is_platform_admin()` to every row level security policy, which takes
-- ten minutes and gives whoever holds the flag — or steals it — the ability to
-- read every bid every customer has ever priced. What an operator actually
-- needs is *operational* fact: who exists, what plan, is it paying, how much of
-- the allowance is used, did the webhook land. So this migration adds views
-- carrying exactly that and touches not one existing policy.
--
-- **A feature grant is an override, not an edit.** `entitlements` has a unique
-- constraint on `company_id` and the Stripe webhook upserts the whole row on
-- it. An operator writing `features` there directly would see it work, and see
-- it silently reverted by the next invoice — payment succeeded, plan changed,
-- anything. So overrides live in their own table and compose on top, and the
-- webhook can keep rewriting the entitlement without touching them.
--
-- **Every operator action is audited into the customer's own ledger.** The
-- audit rows are company-scoped, so an operator changing a customer's
-- entitlement writes a record that customer can read. An operator action a
-- customer cannot see is the shape of the problem, not the fix.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Who operates the platform
-- -----------------------------------------------------------------------------
create table platform_admins (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  reason       text not null check (length(trim(reason)) >= 5),
  granted_by   uuid references auth.users(id) on delete set null,
  granted_at   timestamptz not null default now(),
  -- Retired rather than deleted, so a past administration is answerable.
  revoked_at   timestamptz,
  revoked_by   uuid references auth.users(id) on delete set null,
  revoke_reason text,
  constraint platform_admins_revoked
    check (revoked_at is null or revoke_reason is not null)
);
-- One live grant per person; a revoked one may sit beside it.
create unique index platform_admins_live_idx
  on platform_admins(user_id) where revoked_at is null;

comment on table platform_admins is
  'People who operate GrounUp itself, as distinct from people who use it. ENTITY, append-and-revoke. Deliberately not a role: roles live inside a company and this is the opposite of that. A platform admin can see operational fact about every tenant and the business data of none.';

/**
 * Is the caller an operator of the platform?
 *
 * `security definer` because a caller cannot be allowed to read the admin list
 * in order to answer it, and stable so it is evaluated once per statement
 * rather than once per row.
 */
create or replace function app.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from platform_admins
    where user_id = auth.uid() and revoked_at is null
  );
$$;

grant execute on function app.is_platform_admin() to authenticated;

comment on function app.is_platform_admin() is
  'Whether the caller operates the platform. Used by the admin views and by nothing in the tenant policies — an operator reads operational fact about a company, never its business data.';

-- The list is readable only by the people on it, and writable by nobody
-- through the API: adding an operator is a deployment act, done with the
-- service role or in a migration, not a button.
alter table platform_admins enable row level security;
alter table platform_admins force row level security;
create policy platform_admins_select on platform_admins for select to authenticated
  using (app.is_platform_admin());
grant select on platform_admins to authenticated;
revoke all on platform_admins from anon;

select app.attach_standard_triggers('public.platform_admins'::regclass);

-- -----------------------------------------------------------------------------
-- Features turned on or off for one company
-- -----------------------------------------------------------------------------
create table entitlement_overrides (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  feature      text not null check (length(trim(feature)) between 1 and 100),
  -- grant: on regardless of plan. revoke: off regardless of plan.
  effect       text not null check (effect in ('grant', 'revoke')),
  reason       text not null check (length(trim(reason)) >= 5),
  granted_by   uuid references auth.users(id) on delete set null,
  granted_at   timestamptz not null default now(),
  -- An override with no end is a decision somebody has to remember. One with an
  -- end looks after itself.
  valid_until  timestamptz,
  revoked_at   timestamptz,
  revoked_by   uuid references auth.users(id) on delete set null,
  revoke_reason text,
  constraint entitlement_overrides_revoked
    check (revoked_at is null or revoke_reason is not null)
);
create unique index entitlement_overrides_live_idx
  on entitlement_overrides(company_id, feature) where revoked_at is null;
create index entitlement_overrides_company_idx on entitlement_overrides(company_id);

comment on table entitlement_overrides is
  'A feature turned on or off for one company by the platform operator, composing on top of whatever the plan grants. ENTITY. Separate from `entitlements` on purpose: that table is upserted whole by the Stripe webhook on company_id, so a grant written there would work and then be silently reverted by the next invoice.';

alter table entitlement_overrides enable row level security;
alter table entitlement_overrides force row level security;

-- A company may read what has been done to it. That is the point of auditing
-- operator actions into the tenant's own view rather than a private log.
create policy entitlement_overrides_select on entitlement_overrides for select to authenticated
  using (app.is_platform_admin() or app.is_member(company_id));
grant select on entitlement_overrides to authenticated;
revoke all on entitlement_overrides from anon;

select app.attach_standard_triggers('public.entitlement_overrides'::regclass);

-- -----------------------------------------------------------------------------
-- Entitlement, recomposed
--
-- Precedence: an explicit revoke beats an explicit grant beats the plan. A
-- revoke has to win, because the reason to turn something off for one customer
-- is usually that it is causing harm.
-- -----------------------------------------------------------------------------
create or replace function app.has_entitlement(p_company uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
    when exists (
      select 1 from entitlement_overrides o
      where o.company_id = p_company and o.feature = p_feature
        and o.effect = 'revoke' and o.revoked_at is null
        and (o.valid_until is null or o.valid_until > now())
    ) then false
    when exists (
      select 1 from entitlement_overrides o
      where o.company_id = p_company and o.feature = p_feature
        and o.effect = 'grant' and o.revoked_at is null
        and (o.valid_until is null or o.valid_until > now())
    ) then true
    else exists (
      select 1 from entitlements e
      where e.company_id = p_company
        and e.is_active
        and (e.valid_until is null or e.valid_until > now())
        and (e.features @> array['*'] or e.features @> array[p_feature])
    )
  end;
$$;

comment on function app.has_entitlement(uuid, text) is
  'Whether a company may use a feature. An operator override is consulted first — a revoke beats a grant beats the plan — and the plan answer is unchanged where no override exists.';

-- -----------------------------------------------------------------------------
-- Turning a feature on and off, with a reason
-- -----------------------------------------------------------------------------
/**
 * Grant or revoke a feature for one company.
 *
 * Refuses without a reason, because "why does this customer have this" is the
 * question somebody asks eighteen months later and nobody can answer.
 *
 * Writes an audit row into that company's own ledger, so the customer can see
 * what the operator did to them. An operator action a customer cannot see is
 * the shape of the problem rather than the fix.
 */
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
  if not app.is_platform_admin() then
    raise exception 'Only a platform operator may change a company''s features'
      using errcode = 'insufficient_privilege';
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

  -- Replacing an override is retiring one and writing another, so the history
  -- of what this customer was given and when survives.
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
                             'valid_until', p_valid_until, 'by', 'platform_operator'),
          p_reason);

  return v_id;
end;
$$;

/** Withdraw an override, returning the company to whatever its plan says. */
create or replace function app.clear_feature_override(
  p_company uuid, p_feature text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if not app.is_platform_admin() then
    raise exception 'Only a platform operator may change a company''s features'
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
          jsonb_build_object('feature', p_feature, 'by', 'platform_operator'), p_reason);
end;
$$;

revoke all on function app.set_feature_override(uuid, text, text, text, timestamptz) from public, anon;
revoke all on function app.clear_feature_override(uuid, text, text) from public, anon;
grant execute on function app.set_feature_override(uuid, text, text, text, timestamptz) to authenticated;
grant execute on function app.clear_feature_override(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- What an operator may see
--
-- Operational fact only. There is no estimate here, no project, no cost, no
-- document — and a test asserts that a platform admin reading those tables gets
-- nothing, because the guarantee is worth more than the comment.
-- -----------------------------------------------------------------------------
/*
 * The one place in this schema a view is NOT security_invoker, and the reason
 * is the whole point of it.
 *
 * An invoker view reads its underlying tables as the caller, and a platform
 * operator is a member of no company — so tenant row level security would
 * filter `companies` to nothing before the admin check below was ever reached,
 * and the operator would see an empty list.
 *
 * A definer view means this view *is* the privileged surface, which is exactly
 * what makes the approach safe: the privilege is bounded by the columns
 * selected here rather than spread across every policy in the database. The
 * `where app.is_platform_admin()` is therefore load-bearing, not decoration,
 * and a test asserts a non-operator gets nothing back.
 */
create or replace view admin_companies as
select
  c.id                                as company_id,
  c.name,
  c.slug,
  c.created_at,
  e.plan_id,
  e.is_active                         as entitlement_active,
  e.source                            as entitlement_source,
  e.valid_until                       as entitlement_valid_until,
  s.status                            as subscription_status,
  s.current_period_end,
  s.cancel_at_period_end,
  m.member_count,
  m.owner_email,
  o.override_count,
  -- Counts, never contents. How much a company is using the platform is the
  -- operator's business; what is in it is not.
  a.estimate_count,
  a.project_count
from companies c
left join entitlements e on e.company_id = c.id
left join lateral (
  select st.status, st.current_period_end, st.cancel_at_period_end
  from subscriptions st where st.company_id = c.id
  order by st.created_at desc limit 1
) s on true
left join lateral (
  select count(*) as member_count,
         min(up.email) filter (where cm.is_owner) as owner_email
  from company_memberships cm
  join user_profiles up on up.id = cm.user_id
  where cm.company_id = c.id and cm.status = 'active'
) m on true
left join lateral (
  select count(*) as override_count from entitlement_overrides ov
  where ov.company_id = c.id and ov.revoked_at is null
) o on true
left join lateral (
  select
    (select count(*) from estimates x where x.company_id = c.id) as estimate_count,
    (select count(*) from projects p where p.company_id = c.id)  as project_count
) a on true
where app.is_platform_admin();

comment on view admin_companies is
  'Every tenant, as the operator of the platform needs to see them: who they are, what plan, whether it is paying, how many people, how much they have built. Counts and never contents — an operator has no business reading a customer''s estimates. Empty for anybody who is not a platform admin.';

grant select on admin_companies to authenticated;
revoke all on admin_companies from anon;

/** Stripe events that arrived and did not finish. The operator's alarm bell. */
-- Definer, for the same reason as admin_companies: stripe_events is not a
-- tenant table the operator has membership in.
create or replace view admin_webhook_health as
select
  se.id                as event_id,
  se.type,
  se.received_at,
  se.processed_at,
  se.processing_state,
  se.processing_error,
  se.attempts,
  se.livemode,
  -- Received and never finished. The alarm bell.
  (se.processed_at is null) as unprocessed
from stripe_events se
where app.is_platform_admin()
order by se.received_at desc;

comment on view admin_webhook_health is
  'Stripe events and whether they finished. A subscription that silently failed to activate is a customer who paid and cannot log in, and before this there was no way to see one.';

grant select on admin_webhook_health to authenticated;
revoke all on admin_webhook_health from anon;

-- -----------------------------------------------------------------------------
-- Reachable from a browser
--
-- The console is a screen, so these have to be callable over PostgREST like
-- everything else. The privilege check stays inside the function underneath: a
-- wrapper granted to `authenticated` is not a hole, because a caller who is not
-- an operator is refused by app.set_feature_override itself.
-- -----------------------------------------------------------------------------
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$ select app.is_platform_admin(); $$;

create or replace function public.set_feature_override(
  p_company uuid, p_feature text, p_effect text, p_reason text,
  p_valid_until timestamptz default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  return app.set_feature_override(p_company, p_feature, p_effect, p_reason, p_valid_until);
end;
$$;

create or replace function public.clear_feature_override(
  p_company uuid, p_feature text, p_reason text)
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  perform app.clear_feature_override(p_company, p_feature, p_reason);
end;
$$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.is_platform_admin()',
    'public.set_feature_override(uuid, text, text, text, timestamptz)',
    'public.clear_feature_override(uuid, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

select app.assert_security_gates();
