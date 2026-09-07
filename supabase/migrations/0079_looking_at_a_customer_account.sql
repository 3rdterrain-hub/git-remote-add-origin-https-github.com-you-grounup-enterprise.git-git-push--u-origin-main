-- =============================================================================
-- 0079 — Opening a customer's account to look at their subscription
--
-- Support cannot answer "why was I charged that" from a list of company names
-- and a plan id. They need the same view the customer has: the subscription,
-- its items and prices, the seats being billed, the invoices, what is included
-- and what has been used, and any arrangement or override in force.
--
-- The obvious way to build this is to let an operator become the customer.
-- That is not what this does, for three reasons that are worth writing down.
--
-- **The blast radius is wrong.** Becoming a customer means seeing their
-- estimates, their margins, their contracts and every document they hold.
-- Answering a billing question needs none of that, and migration 0064 spent
-- seven tests establishing that an operator cannot read customer business
-- data. A support feature should not quietly undo that.
--
-- **It is untraceable.** Actions taken while impersonating are recorded as the
-- customer's own. The customer then reads their audit log and sees themselves
-- doing something they did not do.
--
-- **It is unnecessary.** What support needs is a *view*, not an identity.
--
-- So: an operator opens a support session on one company, saying why. It lasts
-- an hour. It is written into that company's own audit ledger, where the
-- customer can read it. While it is open, one definer view — this file's only
-- new surface — shows that company's billing in full. Nothing else changes:
-- no policy anywhere gains an `or app.is_platform_admin()`, and the operator
-- still cannot read a single estimate.
-- =============================================================================

create table support_sessions (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  operator_id  uuid not null references auth.users(id) on delete cascade,
  reason       text not null check (length(trim(reason)) >= 10),
  /*
   * What this session opens. Only billing exists today, and the column exists
   * so the next scope has to be added deliberately rather than by widening
   * what "a support session" silently means.
   */
  scope        text not null default 'billing' check (scope in ('billing')),
  opened_at    timestamptz not null default now(),
  -- An hour. Long enough for a call, short enough that a session nobody closed
  -- is not still open next week.
  expires_at   timestamptz not null default now() + interval '1 hour',
  closed_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint support_sessions_window check (expires_at > opened_at)
);

comment on table support_sessions is
  'An operator looking at one company''s billing, for a stated reason, for an hour. ENTITY. Not impersonation: it opens a view, never an identity, so nothing an operator does is ever recorded as the customer having done it. The company can read its own sessions.';

create index if not exists support_sessions_live
  on support_sessions (company_id, operator_id) where closed_at is null;
create index if not exists support_sessions_company on support_sessions (company_id, opened_at desc);

alter table support_sessions enable row level security;
alter table support_sessions force row level security;

/*
 * A company reads its own sessions — being unable to see who looked at your
 * account is exactly the property that makes people distrust a platform. An
 * operator reads the ones they opened. Neither may write: sessions are opened
 * and closed through the functions below, which record why.
 */
create policy support_sessions_select on support_sessions for select to authenticated
  using (app.is_member(support_sessions.company_id)
         or operator_id = auth.uid());
grant select on support_sessions to authenticated;
revoke all on support_sessions from anon;

select app.attach_standard_triggers('public.support_sessions'::regclass);

/** Whether this operator currently has this company's billing open. */
create or replace function app.is_supporting(p_company uuid)
returns boolean
language sql stable security definer set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from support_sessions s
    where s.company_id = p_company
      and s.operator_id = auth.uid()
      and s.closed_at is null
      and s.expires_at > now()
  );
$$;

grant execute on function app.is_supporting(uuid) to authenticated, service_role;

comment on function app.is_supporting(uuid) is
  'Whether the signed-in operator has a live support session on this company. Expiry is read rather than swept: a session ends when its hour is up whether or not anything ran to close it.';

/** Open one, saying why. */
create or replace function app.open_support_session(
  p_company uuid, p_reason text, p_minutes int default 60)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_id uuid;
begin
  /*
   * Its own permission rather than `billing.read`.
   *
   * Seeing that an account exists and what it pays is one level of intrusion;
   * opening it and reading its invoices, card brand and usage is another, and
   * folding the two together would mean anybody who could read a revenue
   * report could also open every customer. Somebody in finance reconciling
   * invoices needs the first and not the second.
   *
   * It is not superadmin-only, on purpose: the reason to take support staff on
   * is that they answer billing tickets, and a platform where only one person
   * may look at an account is a platform where one person answers every
   * ticket. Which roles hold it is a staffing decision, set on the Roles
   * screen — including narrowing it to nobody but the superadmin.
   */
  if not app.operator_can('support.open') then
    raise exception 'You do not have permission to open a customer account'
      using errcode = 'insufficient_privilege',
            hint = 'Opening an account is its own permission, separate from reading billing.';
  end if;
  if p_reason is null or length(trim(p_reason)) < 10 then
    raise exception 'Say what you are looking into; the customer reads this'
      using errcode = 'check_violation';
  end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 480 then
    raise exception 'A support session runs between five minutes and eight hours'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from companies where id = p_company) then
    raise exception 'Company % not found', p_company using errcode = 'no_data_found';
  end if;

  -- Reopening replaces rather than stacks, so "who had this open" has one answer.
  update support_sessions set closed_at = now(), updated_at = now()
   where company_id = p_company and operator_id = auth.uid() and closed_at is null;

  insert into support_sessions (company_id, operator_id, reason, expires_at)
  values (p_company, auth.uid(), trim(p_reason),
          now() + (p_minutes || ' minutes')::interval)
  returning id into v_id;

  /*
   * Into the customer's own ledger, not a separate operator log. Somebody
   * reading their account history should find this beside everything else that
   * happened to them, rather than having to know to ask.
   */
  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (p_company, auth.uid(), 'insert', 'public.support_sessions', v_id::text,
          jsonb_build_object('scope', 'billing', 'minutes', p_minutes),
          'Support opened this account''s billing: ' || trim(p_reason));
  return v_id;
end;
$$;

/** Close one before its hour is up. */
create or replace function app.close_support_session(p_company uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
begin
  update support_sessions set closed_at = now(), updated_at = now()
   where company_id = p_company and operator_id = auth.uid() and closed_at is null;
end;
$$;

-- -----------------------------------------------------------------------------
-- What the session opens
--
-- One view, and only while a session is live. `app.operator_can('billing.read')`
-- alone is not enough: the permission says this person may do support, and the
-- session says which account they are doing it on and why.
-- -----------------------------------------------------------------------------
create or replace view admin_company_billing as
select
  c.id                                    as company_id,
  c.name                                  as company_name,
  c.slug,
  c.created_at                            as company_since,

  -- The plan, as the customer's own screen would say it.
  app.effective_plan(c.id)                as plan_id,
  pl.name                                 as plan_name,
  pl.features                             as plan_features,
  e.source                                as entitlement_source,
  e.is_active                             as entitlement_active,
  e.valid_until                           as access_valid_until,
  e.grant_reason,

  -- The subscription, as Stripe reported it.
  s.stripe_subscription_id,
  s.stripe_customer_id,
  s.status                                as subscription_status,
  s.quantity                              as seats_billed,
  s.current_period_start,
  s.current_period_end,
  s.cancel_at_period_end,
  s.canceled_at,
  s.trial_end,
  -- Brand and last four only. The card itself is Stripe's and stays there.
  s.default_payment_method_brand          as card_brand,
  s.default_payment_method_last4          as card_last4,
  coalesce(app.subscription_monthly_cents(s.id), 0) as billed_monthly_cents,

  -- What they are actually using.
  u.seats,
  u.ai_requests_this_period,
  u.ai_credits_included,
  u.storage_gb,
  u.storage_gb_included,

  -- Why their price is what it is.
  t.kind                                  as terms,
  t.percent_off,
  t.seat_price_cents                      as agreed_seat_price_cents,
  t.reason                                as terms_reason,
  app.seat_price_cents(c.id, 'month')     as seat_price_month_cents,

  -- What has been turned on or off for them by hand.
  (select count(*) from entitlement_overrides o
    where o.company_id = c.id and o.revoked_at is null) as live_overrides,

  -- And whether anything Stripe sent about them failed to land, which is the
  -- answer to most "I paid and nothing happened" tickets.
  (select count(*) from stripe_events se
    where se.processed_at is null
      and se.payload -> 'data' -> 'object' ->> 'customer' = s.stripe_customer_id)
                                          as unprocessed_events
from companies c
left join entitlements e on e.company_id = c.id
left join plans pl on pl.id = app.effective_plan(c.id)
left join lateral (
  select st.* from subscriptions st
  where st.company_id = c.id
  order by st.created_at desc limit 1
) s on true
left join lateral (select * from app.company_usage(c.id)) u on true
left join lateral (
  select bt.kind, bt.percent_off, bt.seat_price_cents, bt.reason
  from company_billing_terms bt
  where bt.company_id = c.id and bt.revoked_at is null
) t on true
where app.is_supporting(c.id);

comment on view admin_company_billing is
  'One company''s billing in full, and only while the operator has a live support session on it. Everything a "why was I charged that" call needs and nothing a customer would object to an operator seeing: no estimates, no margins, no documents, and no card number — brand and last four are all Stripe gives us and all anybody needs.';

grant select on admin_company_billing to authenticated;
revoke all on admin_company_billing from anon;

/** The invoices behind it, on the same terms. */
create or replace view admin_company_invoices as
select
  i.company_id,
  i.stripe_invoice_id,
  i.number,
  i.status,
  i.amount_due_cents,
  i.amount_paid_cents,
  i.currency,
  i.period_start,
  i.period_end,
  i.hosted_invoice_url,
  i.created_at
from billing_invoices i
where app.is_supporting(i.company_id)
order by i.created_at desc;

comment on view admin_company_invoices is
  'A company''s invoices while a support session is open on it. The hosted URL is Stripe''s own page, so an operator sends the customer the same document the customer can already see rather than describing it.';

grant select on admin_company_invoices to authenticated;
revoke all on admin_company_invoices from anon;

-- Wrappers, for the console.
create or replace function public.open_support_session(
  p_company uuid, p_reason text, p_minutes int default 60)
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin return app.open_support_session(p_company, p_reason, p_minutes); end; $$;

create or replace function public.close_support_session(p_company uuid)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.close_support_session(p_company); end; $$;

create or replace function public.is_supporting(p_company uuid)
returns boolean language sql stable security invoker set search_path = public, pg_catalog
as $$ select app.is_supporting(p_company); $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'app.open_support_session(uuid, text, integer)',
    'app.close_support_session(uuid)',
    'public.open_support_session(uuid, text, integer)',
    'public.close_support_session(uuid)',
    'public.is_supporting(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

/*
 * Who does support by default. Support and account managers, because handling
 * a customer on a call is the job; finance reconciles invoices and has no
 * reason to open accounts; sales has neither. The superadmin holds it through
 * the wildcard, as it holds everything.
 */
update platform_roles
   set permissions = permissions || array['support.open']
 where key in ('support', 'account_manager')
   and not permissions @> array['support.open'];

-- -----------------------------------------------------------------------------
-- Signing up lands on the plan that is actually sold
--
-- `app.create_my_company` has defaulted to `'starter'` since migration 0059,
-- which was right then and stopped being right when seed 0002 withdrew the
-- five-tier ladder. Since that seed, every self-serve signup has been
-- provisioned onto a plan nobody can buy — with the old three-seat,
-- twenty-five-estimate caps and none of the modules. Nothing failed loudly;
-- the new customer simply got a smaller product than the one advertised.
--
-- Migration 0076 changed `provision_company`'s own default and this was missed,
-- which is exactly why the default lives in two places and now agrees in both.
-- -----------------------------------------------------------------------------
create or replace function app.create_my_company(
  p_name text, p_plan_id text default 'grounup')
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_user    uuid := auth.uid();
  v_base    text;
  v_slug    text;
  v_company uuid;
  v_try     int := 0;
begin
  if v_user is null then
    raise exception 'Sign in before creating a company'
      using errcode = 'insufficient_privilege';
  end if;
  if p_name is null or length(trim(p_name)) < 2 then
    raise exception 'A company needs a name' using errcode = 'check_violation';
  end if;

  -- A repeated submit of the same name returns what the first one made.
  select c.id into v_company
  from companies c
  join company_memberships m on m.company_id = c.id
  where m.user_id = v_user and m.is_owner and m.status = 'active'
    and lower(trim(c.name)) = lower(trim(p_name))
  limit 1;
  if v_company is not null then
    return v_company;
  end if;

  v_base := coalesce(app.slugify(p_name), 'company');

  loop
    v_slug := case when v_try = 0 then v_base
                   else substring(v_base, 1, 54) || '-' || v_try end;
    begin
      return app.provision_company(p_name, v_slug, p_plan_id);
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 100 then
        raise exception 'Could not find an available address for "%"', p_name
          using errcode = 'check_violation',
                hint = 'Try a more specific company name.';
      end if;
    end;
  end loop;
end;
$$;

create or replace function public.create_my_company(
  p_name text, p_plan_id text default 'grounup')
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin return app.create_my_company(p_name, p_plan_id); end; $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'app.create_my_company(text, text)',
    'public.create_my_company(text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

select app.assert_security_gates();
