-- =============================================================================
-- 0074 — What an operator may do, rather than which of two they are
--
-- The operator side had two roles and nothing between them: superadmin, who can
-- do everything, and sales, who can see everything and change nothing. Every
-- real question about staffing falls in the gap. Somebody handling support
-- needs to see billing and should not be proposing prices. Somebody managing
-- accounts should propose upsells and never touch a feature flag. A bookkeeper
-- should read billing and nothing else.
--
-- The tenant side has solved this since migration 0002: a role carries a list
-- of permission keys, `'*'` grants everything, and `app.has_permission` is the
-- one question every policy asks. This gives the operator side the same shape
-- rather than inventing a second vocabulary — one idea of what a permission is
-- across the whole platform.
--
-- Two things stay outside the permission system on purpose, because they are
-- structural rather than administrative:
--
--   * **There is one superadmin**, still enforced by a partial unique index.
--     It is not a permission somebody can be granted twice.
--   * **The superadmin seat cannot be given up from a screen**, however the
--     permissions are arranged. Losing it there leaves a platform nobody can
--     administer.
-- =============================================================================

create table platform_roles (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name        text not null,
  description text not null,
  -- Permission keys. '*' grants everything, exactly as on the tenant side.
  permissions text[] not null default '{}',
  /*
   * Whether this role may be handed out from the console. The superadmin role
   * exists here so its permissions are described in one place with all the
   * others, and is not assignable: there is one, and the seat is handed over
   * deliberately outside the product.
   */
  assignable  boolean not null default true,
  is_system   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table platform_roles is
  'What a platform operator may do. LIBRARY. The same shape as tenant roles — a list of permission keys where ''*'' grants everything — so there is one idea of what a permission is across the platform rather than two vocabularies.';

alter table platform_roles enable row level security;
alter table platform_roles force row level security;
create policy platform_roles_select on platform_roles for select to authenticated
  using (app.is_platform_admin());
grant select on platform_roles to authenticated;
revoke all on platform_roles from anon;

select app.attach_standard_triggers('public.platform_roles'::regclass);

insert into platform_roles (key, name, description, permissions, assignable, sort_order) values
  ('superadmin', 'Superadmin',
   'Everything. There is one, and the seat is handed over deliberately outside the product.',
   array['*'], false, 0),

  ('sales', 'Sales',
   'Sees how every company is doing and proposes upsells. Changes nothing.',
   array['companies.read', 'upsell.propose'], true, 10),

  ('account_manager', 'Account manager',
   'Sales, plus the billing standing of the accounts they look after — so a renewal conversation starts from what the customer is actually paying.',
   array['companies.read', 'billing.read', 'upsell.propose'], true, 20),

  ('support', 'Support',
   'Sees companies and billing, including webhooks that failed — which is what most "I paid and nothing happened" tickets turn out to be. Proposes nothing.',
   array['companies.read', 'billing.read'], true, 30),

  ('finance', 'Finance',
   'Billing and revenue only. No tenant list beyond what billing shows, and no commercial decisions.',
   array['billing.read'], true, 40)
on conflict (key) do update set
  name = excluded.name, description = excluded.description,
  permissions = excluded.permissions, assignable = excluded.assignable,
  sort_order = excluded.sort_order;

-- -----------------------------------------------------------------------------
-- Attaching a role to a person
-- -----------------------------------------------------------------------------
alter table platform_admins
  add column if not exists role_key text references platform_roles(key) on delete restrict;

-- Everybody already granted keeps what they had.
update platform_admins set role_key = role where role_key is null;

alter table platform_admins
  alter column role_key set not null;

comment on column platform_admins.role is
  'The coarse tier, kept because the one-superadmin index is built on it. What an operator may actually do comes from role_key.';
comment on column platform_admins.role_key is
  'Which platform role this person holds, and therefore which permissions. Separate from `role`, which exists so the database can enforce that there is exactly one superadmin.';

/*
 * `role` and `role_key` say the same thing at two grains: which tier somebody
 * is in, and which permissions they hold. Rather than ask every insert to
 * spell out both and stay consistent, each fills in from the other, and the
 * check constraint below catches the one combination that would be a lie.
 */
create or replace function app.platform_admin_role_agrees()
returns trigger language plpgsql as $$
begin
  if new.role_key is null then
    new.role_key := new.role;
  elsif new.role is null then
    new.role := case when new.role_key = 'superadmin' then 'superadmin' else 'sales' end;
  end if;
  return new;
end;
$$;

drop trigger if exists platform_admins_role_agrees on platform_admins;
create trigger platform_admins_role_agrees
  before insert or update on platform_admins
  for each row execute function app.platform_admin_role_agrees();

-- The two must agree: only the superadmin role belongs to the superadmin tier.
alter table platform_admins drop constraint if exists platform_admins_role_agrees;
alter table platform_admins
  add constraint platform_admins_role_agrees
    check ((role = 'superadmin') = (role_key = 'superadmin'));

/**
 * May this operator do this?
 *
 * The one question every operator-facing function should ask, in place of
 * `app.is_superadmin()` wherever the answer is administrative rather than
 * structural. Mirrors `app.has_permission` on the tenant side, including the
 * `'*'` wildcard and its deliberate lack of prefix matching: there is no
 * `billing.*`, because a permission somebody has to reason about in two steps
 * is one they will eventually reason about wrongly.
 */
create or replace function app.operator_can(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from platform_admins a
    join platform_roles r on r.key = a.role_key
    where a.user_id = auth.uid()
      and a.revoked_at is null
      and (r.permissions @> array['*'] or r.permissions @> array[p_permission])
  );
$$;

grant execute on function app.operator_can(text) to authenticated;

comment on function app.operator_can(text) is
  'Whether the signed-in operator holds a platform permission. Replaces app.is_superadmin() everywhere the question is administrative; is_superadmin remains for the structural cases, where the answer is about the seat rather than about a capability.';

-- -----------------------------------------------------------------------------
-- The functions ask what somebody may do, not who they are
-- -----------------------------------------------------------------------------
create or replace function app.set_feature_override(
  p_company uuid, p_feature text, p_effect text, p_reason text,
  p_valid_until timestamptz default null)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_id uuid;
begin
  if not app.operator_can('features.manage') then
    raise exception 'You do not have permission to change a company''s features'
      using errcode = 'insufficient_privilege',
            hint = 'Sales can propose an upsell; applying one needs features.manage.';
  end if;
  if p_effect not in ('grant', 'revoke') then
    raise exception 'An override is a grant or a revoke, not %', p_effect
      using errcode = 'check_violation';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'An override must say why it exists' using errcode = 'check_violation';
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
                             'valid_until', p_valid_until),
          p_reason);
  return v_id;
end;
$$;

create or replace function app.clear_feature_override(
  p_company uuid, p_feature text, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
begin
  if not app.operator_can('features.manage') then
    raise exception 'You do not have permission to change a company''s features'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'Withdrawing an override must say why' using errcode = 'check_violation';
  end if;

  update entitlement_overrides
     set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = p_reason
   where company_id = p_company and feature = p_feature and revoked_at is null;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (p_company, auth.uid(), 'delete', 'public.entitlement_overrides', p_feature,
          jsonb_build_object('feature', p_feature), p_reason);
end;
$$;

create or replace function app.decide_upsell(
  p_proposal uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_p upsell_proposals%rowtype;
begin
  if not app.operator_can('upsell.decide') then
    raise exception 'You do not have permission to decide an upsell proposal'
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
      using errcode = 'insufficient_privilege';
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
          jsonb_build_object('state', case when p_approve then 'approved' else 'rejected' end),
          coalesce(p_note, v_p.rationale));
end;
$$;

create or replace function app.propose_upsell(
  p_company uuid, p_plan_id text default null, p_features text[] default '{}',
  p_rationale text default null, p_estimated_monthly_cents int default null)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_id uuid;
begin
  if not app.operator_can('upsell.propose') then
    raise exception 'You do not have permission to propose an upsell'
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

create or replace function app.set_plan_price(
  p_plan_id text, p_interval text, p_unit_amount_cents int,
  p_stripe_price_id text default null, p_currency char(3) default 'USD')
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_id uuid;
begin
  if not app.operator_can('pricing.manage') then
    raise exception 'You do not have permission to set a price'
      using errcode = 'insufficient_privilege';
  end if;
  if p_interval not in ('month', 'year') then
    raise exception 'A price is charged by the month or by the year, not %', p_interval
      using errcode = 'check_violation';
  end if;
  if p_unit_amount_cents is null or p_unit_amount_cents < 0 then
    raise exception 'A price must be zero or more' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from plans where id = p_plan_id) then
    raise exception 'Plan % does not exist', p_plan_id using errcode = 'no_data_found';
  end if;

  insert into plan_prices
    (plan_id, stripe_price_id, interval, unit_amount_cents, currency, usage_type, is_active)
  values (p_plan_id, nullif(trim(coalesce(p_stripe_price_id, '')), ''),
          p_interval, p_unit_amount_cents, p_currency, 'licensed', true)
  on conflict (plan_id, interval, usage_type) do update set
    stripe_price_id = excluded.stripe_price_id,
    unit_amount_cents = excluded.unit_amount_cents,
    currency = excluded.currency, is_active = true, updated_at = now()
  returning id into v_id;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (null, auth.uid(), 'update', 'public.plan_prices', v_id::text,
          jsonb_build_object('plan', p_plan_id, 'interval', p_interval,
                             'cents', p_unit_amount_cents),
          'Price published from the operator console');
  return v_id;
end;
$$;

-- The two-argument form is dropped rather than left beside the three-argument
-- one: with a default on the third parameter, `hire_operator(email, reason)`
-- would match both, and Postgres would refuse the call as ambiguous.
drop function if exists public.hire_operator(text, text);
drop function if exists app.hire_operator(text, text);

/**
 * Take somebody on, in a named role.
 *
 * The role is chosen now rather than fixed at sales, and `assignable` is what
 * stops the superadmin role being among the choices — a property of the role
 * rather than a condition somebody has to remember to write here.
 */
create or replace function app.hire_operator(
  p_email text, p_reason text, p_role_key text default 'sales')
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_user uuid;
  v_id   uuid;
  v_assignable boolean;
begin
  if not app.operator_can('operators.manage') then
    raise exception 'You do not have permission to grant operator access'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'Say who this is and why they need access'
      using errcode = 'check_violation';
  end if;

  select assignable into v_assignable from platform_roles where key = p_role_key;
  if v_assignable is null then
    raise exception 'There is no operator role called %', p_role_key
      using errcode = 'no_data_found';
  end if;
  if not v_assignable then
    raise exception 'The % role cannot be granted from a screen', p_role_key
      using errcode = 'insufficient_privilege',
            hint = 'There is one superadmin, and the seat is handed over deliberately.';
  end if;

  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'No account here uses %', p_email
      using errcode = 'no_data_found',
            hint = 'They sign up first, then you grant them access.';
  end if;
  if exists (select 1 from platform_admins where user_id = v_user and revoked_at is null) then
    raise exception '% already has operator access', p_email using errcode = 'unique_violation';
  end if;

  insert into platform_admins (user_id, reason, role, role_key, granted_by)
  values (v_user, trim(p_reason), 'sales', p_role_key, auth.uid())
  returning id into v_id;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (null, auth.uid(), 'insert', 'public.platform_admins', v_id::text,
          jsonb_build_object('role', p_role_key, 'email', lower(trim(p_email))),
          trim(p_reason));
  return v_id;
end;
$$;

/** Change what an operator may do, without taking them off and putting them back. */
create or replace function app.set_operator_role(
  p_user_id uuid, p_role_key text, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_current text;
  v_assignable boolean;
begin
  if not app.operator_can('operators.manage') then
    raise exception 'You do not have permission to change an operator''s role'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'Say why the role is changing' using errcode = 'check_violation';
  end if;

  select role_key into v_current from platform_admins
  where user_id = p_user_id and revoked_at is null;
  if v_current is null then
    raise exception 'That person does not currently hold operator access'
      using errcode = 'no_data_found';
  end if;
  if v_current = 'superadmin' then
    raise exception 'The superadmin role cannot be changed from a screen'
      using errcode = 'insufficient_privilege';
  end if;

  select assignable into v_assignable from platform_roles where key = p_role_key;
  if v_assignable is null then
    raise exception 'There is no operator role called %', p_role_key
      using errcode = 'no_data_found';
  end if;
  if not v_assignable then
    raise exception 'The % role cannot be granted from a screen', p_role_key
      using errcode = 'insufficient_privilege';
  end if;

  update platform_admins set role_key = p_role_key, updated_at = now()
   where user_id = p_user_id and revoked_at is null;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (null, auth.uid(), 'update', 'public.platform_admins', p_user_id::text,
          jsonb_build_object('from', v_current, 'to', p_role_key), trim(p_reason));
end;
$$;

create or replace function app.revoke_operator(p_user_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_role text;
begin
  if not app.operator_can('operators.manage') then
    raise exception 'You do not have permission to withdraw operator access'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'Say why access is being withdrawn' using errcode = 'check_violation';
  end if;

  select role_key into v_role from platform_admins
  where user_id = p_user_id and revoked_at is null;
  if v_role is null then
    raise exception 'That person does not currently hold operator access'
      using errcode = 'no_data_found';
  end if;
  if v_role = 'superadmin' then
    raise exception 'The superadmin seat cannot be given up from a screen'
      using errcode = 'insufficient_privilege',
            hint = 'Losing it here would leave nobody able to grant anything.';
  end if;

  update platform_admins
     set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = trim(p_reason)
   where user_id = p_user_id and revoked_at is null;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (null, auth.uid(), 'update', 'public.platform_admins', p_user_id::text,
          jsonb_build_object('revoked', true), trim(p_reason));
end;
$$;

-- -----------------------------------------------------------------------------
-- The read views follow the permission too
--
-- The three operator views each end in `where app.is_platform_admin()` — the
-- gate that made them safe when there was one kind of operator. With five,
-- "is an operator" is the wrong question: somebody in finance has no reason to
-- see every customer's project counts, and support has no reason to see the
-- upsell pipeline.
--
-- The gate is swapped in place rather than by pasting the view bodies into
-- this file, which would leave two copies of each query to drift apart. Each
-- rewrite is verified: if the substitution did not take, the migration stops
-- rather than leaving a view still gated on the old question.
-- -----------------------------------------------------------------------------
do $$
declare
  v_view text;
  v_perm text;
  v_def  text;
  v_new  text;
  v_pairs text[][] := array[
    array['admin_companies',        'companies.read'],
    array['admin_webhook_health',   'billing.read'],
    array['admin_upsell_potential', 'upsell.propose']
  ];
  i int;
begin
  for i in 1 .. array_length(v_pairs, 1) loop
    v_view := v_pairs[i][1];
    v_perm := v_pairs[i][2];

    v_def := pg_get_viewdef(v_view::regclass, true);
    if position('app.is_platform_admin()' in v_def) = 0 then
      raise exception 'View % is no longer gated on app.is_platform_admin(); re-gating it would be guesswork', v_view;
    end if;

    v_new := replace(v_def, 'app.is_platform_admin()',
                     format('app.operator_can(%L)', v_perm));
    execute format('create or replace view %I as %s', v_view, v_new);

    -- It took, and nothing else did.
    v_def := pg_get_viewdef(v_view::regclass, true);
    if position(format('operator_can(%L', v_perm) in v_def) = 0
       or position('is_platform_admin()' in v_def) > 0 then
      raise exception 'Re-gating % did not take', v_view;
    end if;
  end loop;
end $$;

-- Grants
do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'app.hire_operator(text, text, text)',
    'app.set_operator_role(uuid, text, text)',
    'app.operator_can(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

create or replace function public.operator_can(p_permission text)
returns boolean language sql stable security invoker set search_path = public, pg_catalog
as $$ select app.operator_can(p_permission); $$;

create or replace function public.hire_operator(
  p_email text, p_reason text, p_role_key text default 'sales')
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin return app.hire_operator(p_email, p_reason, p_role_key); end; $$;

create or replace function public.set_operator_role(
  p_user_id uuid, p_role_key text, p_reason text)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.set_operator_role(p_user_id, p_role_key, p_reason); end; $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.operator_can(text)',
    'public.hire_operator(text, text, text)',
    'public.set_operator_role(uuid, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

select app.assert_security_gates();
