-- =============================================================================
-- 0076 — The things an operator actually has to do to run this
--
-- The console could see the business and change a price. Running one needs
-- four more, and every one of them was previously a job for somebody with a
-- database connection:
--
--   * **Put a company on the platform by hand.** A customer signed on a call,
--     a demo tenant, a migration from a competitor. Signup creates a company
--     for whoever is signing up; there was no way to create one *for* somebody.
--   * **Give an account away.** A pilot, a friend of the business, a nonprofit,
--     the first ten customers. `entitlements.source = 'manual_grant'` has
--     existed since 0009 and nothing could write it.
--   * **Discount an account.** Either a percentage off or an agreed per-seat
--     price. Both are commercial facts about a customer, and neither belongs
--     scattered across Stripe coupons that GrounUp cannot see.
--   * **Decide what each kind of operator may do.** 0074 shipped five roles
--     with fixed permission lists. Which permissions a support person needs is
--     a question about how a business is staffed, not one this file can answer.
--
-- Two rules run through all of it. A commercial arrangement is a *record* —
-- who granted it, why, when it ends — not a flag. And the price a customer
-- pays is *derived* from the list price and their arrangement, never stored,
-- so a discount and a price change cannot disagree.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- What there is to permit
--
-- 0074 wrote permission keys as string literals inside role seeds. That is
-- fine while the lists are fixed and wrong the moment somebody can edit them:
-- a typo becomes a permission that exists, is granted, and grants nothing.
-- -----------------------------------------------------------------------------
create table platform_permissions (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  label       text not null,
  description text not null,
  -- Whether granting this is, on its own, enough to run the platform. These
  -- are the ones a superadmin should think twice about handing out.
  is_powerful boolean not null default false,
  sort_order  int not null default 0
);

comment on table platform_permissions is
  'Every permission an operator role can hold. LIBRARY. A catalog rather than string literals, so a role cannot be granted a permission that does not exist and the console can render the real list rather than a hard-coded copy of it.';

alter table platform_permissions enable row level security;
alter table platform_permissions force row level security;
create policy platform_permissions_select on platform_permissions for select to authenticated
  using (app.is_platform_admin());
grant select on platform_permissions to authenticated;
revoke all on platform_permissions from anon;

insert into platform_permissions (key, label, description, is_powerful, sort_order) values
  ('companies.read',   'See companies',
   'The tenant list: who they are, what plan, how many people, how much they have built. Counts, never contents.', false, 10),
  ('companies.manage', 'Create and configure companies',
   'Put a company on the platform by hand and name its owner.', true, 20),
  ('billing.read',     'See billing',
   'Subscriptions, invoicing standing, and Stripe events that failed.', false, 30),
  ('billing.manage',   'Set commercial terms',
   'Give an account away, discount one, or set an agreed per-seat price.', true, 40),
  ('support.open',     'Open a customer account',
   'Look inside one company''s subscription for an hour, for a stated reason the customer reads. Billing only — never their estimates, projects or documents.', true, 45),
  ('upsell.propose',   'Propose an upsell',
   'Write up why a customer should move, for somebody else to decide.', false, 50),
  ('upsell.decide',    'Decide an upsell',
   'Approve or reject a proposal. Never the person who wrote it.', true, 60),
  ('features.manage',  'Turn features on and off',
   'Grant or withdraw a feature for one company, outside their plan.', true, 70),
  ('pricing.manage',   'Publish prices',
   'Set what the platform charges. Applies to every customer without an arrangement of their own.', true, 80),
  ('operators.manage', 'Manage operators',
   'Take somebody on, change what they may do, or withdraw their access.', true, 90)
on conflict (key) do update set
  label = excluded.label, description = excluded.description,
  is_powerful = excluded.is_powerful, sort_order = excluded.sort_order;

/*
 * Nothing writes this catalog at runtime, and a table that should never change
 * is better frozen than merely left alone: a new permission key that appeared
 * without a migration would be one nothing in the codebase checks for, granted
 * to a role, granting nothing. Adding one is a migration, which drops this
 * trigger, writes, and puts it back.
 */
drop trigger if exists platform_permissions_frozen on platform_permissions;
create trigger platform_permissions_frozen
  before insert or update or delete on platform_permissions
  for each row execute function app.forbid_mutation();

/*
 * Every permission a role holds must be one that exists. Checked as a trigger
 * rather than a foreign key because the column is an array: `'*'` is the
 * wildcard and is not itself a permission.
 */
create or replace function app.validate_role_permissions()
returns trigger language plpgsql set search_path = public, pg_catalog as $$
declare v_unknown text[];
begin
  select array_agg(p) into v_unknown
  from unnest(new.permissions) p
  where p <> '*' and not exists (select 1 from platform_permissions x where x.key = p);
  if v_unknown is not null then
    raise exception 'No such permission: %', array_to_string(v_unknown, ', ')
      using errcode = 'foreign_key_violation',
            hint = 'Permission keys come from platform_permissions.';
  end if;
  return new;
end;
$$;

drop trigger if exists platform_roles_permissions_exist on platform_roles;
create trigger platform_roles_permissions_exist
  before insert or update of permissions on platform_roles
  for each row execute function app.validate_role_permissions();

/** Change what a role may do. The superadmin's own role is not editable. */
create or replace function app.set_role_permissions(
  p_key text, p_permissions text[], p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_before text[];
  v_assignable boolean;
begin
  if not app.operator_can('operators.manage') then
    raise exception 'You do not have permission to change what a role may do'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'Say why the role is changing' using errcode = 'check_violation';
  end if;

  select permissions, assignable into v_before, v_assignable
  from platform_roles where key = p_key;
  if v_before is null then
    raise exception 'There is no operator role called %', p_key using errcode = 'no_data_found';
  end if;
  /*
   * The superadmin role is '*' by definition. Editing it is the one change
   * that could leave the platform with nobody able to grant anything, and it
   * is refused for the same reason the seat cannot be given up from a screen.
   */
  if not v_assignable then
    raise exception 'The % role is fixed', p_key
      using errcode = 'insufficient_privilege';
  end if;
  if p_permissions @> array['*'] then
    raise exception 'Only the superadmin role holds everything'
      using errcode = 'insufficient_privilege',
            hint = 'Grant the permissions the job needs by name.';
  end if;

  update platform_roles set permissions = coalesce(p_permissions, '{}'), updated_at = now()
   where key = p_key;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            prior_state, new_state, reason)
  values (null, auth.uid(), 'update', 'public.platform_roles', p_key,
          jsonb_build_object('permissions', v_before),
          jsonb_build_object('permissions', coalesce(p_permissions, '{}')),
          trim(p_reason));
end;
$$;

/** Add a role of your own, for a job these five do not describe. */
create or replace function app.create_platform_role(
  p_key text, p_name text, p_description text, p_permissions text[])
returns text
language plpgsql security definer set search_path = public, pg_catalog
as $$
begin
  if not app.operator_can('operators.manage') then
    raise exception 'You do not have permission to add an operator role'
      using errcode = 'insufficient_privilege';
  end if;
  if p_permissions @> array['*'] then
    raise exception 'Only the superadmin role holds everything'
      using errcode = 'insufficient_privilege';
  end if;
  if p_description is null or length(trim(p_description)) < 10 then
    raise exception 'Say what this role is for; the next person reading the list will need it'
      using errcode = 'check_violation';
  end if;

  insert into platform_roles (key, name, description, permissions, assignable,
                              is_system, sort_order)
  values (lower(trim(p_key)), trim(p_name), trim(p_description),
          coalesce(p_permissions, '{}'), true, false,
          (select coalesce(max(sort_order), 0) + 10 from platform_roles));

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (null, auth.uid(), 'insert', 'public.platform_roles', lower(trim(p_key)),
          jsonb_build_object('permissions', coalesce(p_permissions, '{}')),
          trim(p_description));
  return lower(trim(p_key));
end;
$$;

-- -----------------------------------------------------------------------------
-- Putting a company on the platform by hand
--
-- `app.provision_company` builds everything a new tenant needs and makes the
-- caller its owner, which is right for signup and useless for an operator, who
-- must never be a member of a customer's company. The body moves into a form
-- that takes the owner explicitly, and signup keeps its behavior by passing
-- itself. One definition of what a new company gets.
-- -----------------------------------------------------------------------------
create or replace function app.provision_company_for(
  p_owner uuid, p_name text, p_slug text, p_plan_id text default 'grounup')
returns uuid
language plpgsql
security definer set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_owner_role uuid;
  v_trial_days int;
begin
  if p_owner is null then
    raise exception 'A company needs an owner' using errcode = 'insufficient_privilege';
  end if;

  select id into v_owner_role from roles where company_id is null and key = 'owner';
  if v_owner_role is null then
    raise exception 'System role "owner" is missing; migrations are incomplete';
  end if;

  insert into companies (name, slug, created_by) values (p_name, p_slug, p_owner)
  returning id into v_company;

  insert into company_memberships (company_id, user_id, role_id, status, is_owner, joined_at)
  values (v_company, p_owner, v_owner_role, 'active', true, now());

  -- Default pricing profile, so the first estimate can be priced immediately.
  -- The owner is recorded as its approver: a live pricing profile must name who
  -- made it live (migration 0028), and for this row that is the person these
  -- defaults belong to — accurate, rather than a way around the constraint.
  insert into pricing_profiles (company_id, code, name, method, is_default, region,
                                origin, approved_by, approved_at)
  values (v_company, 'PP-DEFAULT', 'Company Default', 'parallel', true, null,
          'company', p_owner, now());

  insert into markup_components (company_id, pricing_profile_id, code, label, percent, basis, sequence)
  select v_company, p.id, c.code, c.label, c.percent, 'profile_default', c.sequence
  from pricing_profiles p,
       (values ('OH', 'Overhead', 0.10, 10),
               ('PROFIT', 'Profit', 0.12, 20),
               ('CONT', 'Contingency', 0.03, 30)) as c(code, label, percent, sequence)
  where p.company_id = v_company and p.code = 'PP-DEFAULT';

  update companies
     set default_pricing_profile_id = (select id from pricing_profiles
                                        where company_id = v_company and code = 'PP-DEFAULT')
   where id = v_company;

  /*
   * Start the plan's trial. Entitlement is provisional until Stripe confirms,
   * and `valid_until` bounds it so an unpaid trial cannot run forever.
   *
   * A plan that is not publicly sold is the exception, and deliberately so: it
   * is never reached by checkout, so waiting for a Stripe webhook would mean
   * waiting for something that is never coming. Those plans are provisioned
   * because a contract was signed — which is what makes the entitlement live,
   * and what `enterprise_contract` says about where it came from. Before this,
   * such a company was created with an inactive entitlement and, since
   * migration 0077, immediately fell back to the free plan.
   */
  select trial_days into v_trial_days from plans where id = p_plan_id;
  insert into entitlements (company_id, plan_id, is_active, features, max_seats,
                            max_active_estimates, max_active_projects, storage_gb,
                            ai_credits_per_month, valid_until, source)
  select v_company, pl.id,
         coalesce(v_trial_days, 0) > 0 or not pl.is_public,
         pl.features, pl.max_seats,
         pl.max_active_estimates, pl.max_active_projects, pl.storage_gb,
         pl.ai_credits_per_month,
         case when coalesce(v_trial_days, 0) > 0
              then now() + (v_trial_days || ' days')::interval end,
         case when not pl.is_public then 'enterprise_contract' else 'trial' end
  from plans pl where pl.id = p_plan_id;

  update user_profiles set default_company_id = v_company
   where id = p_owner and default_company_id is null;

  -- No audit event here. Both callers write their own, and the reason differs:
  -- a signup provisioned itself; a company created by hand has an operator and
  -- an explanation behind it.
  return v_company;
end;
$$;

create or replace function app.provision_company(
  p_name text, p_slug text, p_plan_id text default 'grounup')
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  if auth.uid() is null then
    raise exception 'provision_company requires an authenticated user'
      using errcode = 'insufficient_privilege';
  end if;
  v_company := app.provision_company_for(auth.uid(), p_name, p_slug, p_plan_id);

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (v_company, auth.uid(), 'insert', 'public.companies', v_company::text,
          jsonb_build_object('name', p_name, 'slug', p_slug, 'plan', p_plan_id),
          'Company provisioned');
  return v_company;
end;
$$;

/**
 * Create a company for somebody else.
 *
 * The owner is named by the email they signed up with, because an operator
 * knows a customer by their address and not by a uuid. They must already have
 * an account: creating one here would mean this function setting somebody
 * else's credentials, which is not a thing an operator screen should do.
 */
create or replace function app.create_company_for(
  p_owner_email text, p_name text, p_reason text, p_slug text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_owner uuid;
  v_slug  text;
  v_company uuid;
begin
  if not app.operator_can('companies.manage') then
    raise exception 'You do not have permission to create a company'
      using errcode = 'insufficient_privilege';
  end if;
  if p_name is null or length(trim(p_name)) < 2 then
    raise exception 'A company needs a name' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'Say why this company is being created by hand'
      using errcode = 'check_violation';
  end if;

  select id into v_owner from auth.users where lower(email) = lower(trim(p_owner_email));
  if v_owner is null then
    raise exception 'No account here uses %', p_owner_email
      using errcode = 'no_data_found',
            hint = 'They sign up first; then the company can be created for them.';
  end if;

  v_slug := coalesce(nullif(trim(coalesce(p_slug, '')), ''), app.slugify(p_name));
  if exists (select 1 from companies where slug = v_slug) then
    v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  end if;

  v_company := app.provision_company_for(v_owner, trim(p_name), v_slug, 'grounup');

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (v_company, auth.uid(), 'insert', 'public.companies', v_company::text,
          jsonb_build_object('name', trim(p_name), 'slug', v_slug,
                             'owner', lower(trim(p_owner_email))),
          trim(p_reason));
  return v_company;
end;
$$;

-- -----------------------------------------------------------------------------
-- What a customer actually pays
--
-- Three arrangements cover every deal a business like this makes: free,
-- a percentage off, or an agreed per-seat price. Each is a record with a
-- reason, an author and an end date, because "why is this account free?" is a
-- question somebody will ask in two years.
-- -----------------------------------------------------------------------------
create table company_billing_terms (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  kind             text not null check (kind in ('free', 'percent_off', 'fixed_seat_price')),
  percent_off      numeric(5,2) check (percent_off > 0 and percent_off <= 100),
  seat_price_cents int check (seat_price_cents >= 0),
  /*
   * Stripe's own coupon, when there is one. A discount that lives only here
   * would be a discount the customer's invoice never shows — so this records
   * whether the arrangement has been mirrored into Stripe, and
   * `applies_in_stripe` below says so plainly rather than leaving it implied.
   */
  stripe_coupon_id text,
  reason           text not null check (length(trim(reason)) >= 5),
  valid_until      timestamptz,
  granted_by       uuid references auth.users(id) on delete set null,
  revoked_at       timestamptz,
  revoked_by       uuid references auth.users(id) on delete set null,
  revoke_reason    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Exactly the field its kind needs, and no other.
  constraint billing_terms_shape check (
    (kind = 'percent_off')       = (percent_off is not null) and
    (kind = 'fixed_seat_price')  = (seat_price_cents is not null)
  ),
  /*
   * A free account is free in GrounUp regardless of Stripe; the other two are
   * only real once Stripe agrees, since Stripe is what charges the card.
   */
  applies_in_stripe boolean generated always as
    (kind = 'free' or stripe_coupon_id is not null) stored
);

comment on table company_billing_terms is
  'What one company pays, when it is not the list price: free, a percentage off, or an agreed per-seat price. ENTITY. Every arrangement carries who granted it, why, and when it ends, because "why is this account free?" is asked years later. applies_in_stripe is derived, not asserted: a discount Stripe has not been told about does not reduce anybody''s invoice.';

comment on column company_billing_terms.applies_in_stripe is
  'Whether this arrangement actually reaches the customer''s invoice. Free needs nothing from Stripe; a discount needs a coupon, and without one the console shows the arrangement as not yet in effect rather than pretending.';

-- One live arrangement per company. Two would be a question with two answers.
create unique index if not exists company_billing_terms_one_live
  on company_billing_terms (company_id) where revoked_at is null;

create index if not exists company_billing_terms_company on company_billing_terms (company_id);

select app.apply_tenant_rls('company_billing_terms');
select app.attach_standard_triggers('public.company_billing_terms'::regclass);

/*
 * A customer may read their own arrangement — being unable to see why your
 * invoice is what it is would be its own kind of defect — and may not write
 * one. Writes come from the operator functions below, which are definer.
 */
drop policy if exists company_billing_terms_insert on company_billing_terms;
drop policy if exists company_billing_terms_update on company_billing_terms;
drop policy if exists company_billing_terms_delete on company_billing_terms;

/**
 * What one seat costs this company, in cents, for the given interval.
 *
 * Derived from the published price and whatever arrangement is live, so a
 * price change and a discount cannot disagree — there is nowhere for a stale
 * number to be stored. Null means no published price for that interval yet.
 */
create or replace function app.seat_price_cents(
  p_company uuid, p_interval text default 'month')
returns int
language sql stable security definer set search_path = public, pg_catalog
as $$
  with list as (
    select pp.unit_amount_cents
    from plan_prices pp
    join plans pl on pl.id = pp.plan_id
    where pl.is_active and pl.is_public and pp.is_active and pp.interval = p_interval
    order by pp.updated_at desc limit 1
  ), term as (
    select kind, percent_off, seat_price_cents
    from company_billing_terms
    where company_id = p_company and revoked_at is null
      and (valid_until is null or valid_until > now())
    limit 1
  )
  select case
    when (select kind from term) = 'free' then 0
    when (select kind from term) = 'fixed_seat_price' then (select seat_price_cents from term)
    when (select kind from term) = 'percent_off'
      then round((select unit_amount_cents from list)
                 * (1 - (select percent_off from term) / 100.0))::int
    else (select unit_amount_cents from list)
  end;
$$;

grant execute on function app.seat_price_cents(uuid, text) to authenticated, service_role;

comment on function app.seat_price_cents(uuid, text) is
  'What one seat costs this company after their arrangement. Derived from the published price every time it is asked rather than stored, so a price change reaches discounted customers too.';

/** Put a company on non-standard terms. */
create or replace function app.set_billing_terms(
  p_company uuid, p_kind text, p_reason text,
  p_percent_off numeric default null, p_seat_price_cents int default null,
  p_valid_until timestamptz default null, p_stripe_coupon_id text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_id uuid;
begin
  if not app.operator_can('billing.manage') then
    raise exception 'You do not have permission to set commercial terms'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'Say why this account is on different terms'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from companies where id = p_company) then
    raise exception 'Company % not found', p_company using errcode = 'no_data_found';
  end if;

  -- Replacing an arrangement withdraws the old one rather than stacking.
  update company_billing_terms
     set revoked_at = now(), revoked_by = auth.uid(),
         revoke_reason = 'Replaced: ' || trim(p_reason)
   where company_id = p_company and revoked_at is null;

  insert into company_billing_terms
    (company_id, kind, percent_off, seat_price_cents, stripe_coupon_id,
     reason, valid_until, granted_by)
  values (p_company, p_kind, p_percent_off, p_seat_price_cents,
          nullif(trim(coalesce(p_stripe_coupon_id, '')), ''),
          trim(p_reason), p_valid_until, auth.uid())
  returning id into v_id;

  /*
   * A free account is access, not just a price, so the entitlement follows.
   * It is written as an attributed manual grant — the one source `entitlements`
   * has always allowed besides a verified webhook — and bounded by the same end
   * date, so a pilot that was never revoked expires on its own.
   */
  if p_kind = 'free' then
    update entitlements
       set is_active = true, source = 'manual_grant', granted_by = auth.uid(),
           grant_reason = trim(p_reason), valid_until = p_valid_until,
           plan_id = coalesce(plan_id, (select id from plans
                                         where is_active and is_public
                                         order by tier limit 1)),
           updated_at = now()
     where company_id = p_company;
  end if;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (p_company, auth.uid(), 'insert', 'public.company_billing_terms', v_id::text,
          jsonb_build_object('kind', p_kind, 'percent_off', p_percent_off,
                             'seat_price_cents', p_seat_price_cents,
                             'valid_until', p_valid_until,
                             'stripe_coupon_id', nullif(trim(coalesce(p_stripe_coupon_id, '')), '')),
          trim(p_reason));
  return v_id;
end;
$$;

/** Put a company back on the list price. */
create or replace function app.clear_billing_terms(p_company uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_kind text;
begin
  if not app.operator_can('billing.manage') then
    raise exception 'You do not have permission to set commercial terms'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'Say why the arrangement is ending' using errcode = 'check_violation';
  end if;

  select kind into v_kind from company_billing_terms
  where company_id = p_company and revoked_at is null;
  if v_kind is null then
    raise exception 'That company is already on the list price'
      using errcode = 'no_data_found';
  end if;

  update company_billing_terms
     set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = trim(p_reason)
   where company_id = p_company and revoked_at is null;

  /*
   * Ending a free arrangement hands the entitlement back to Stripe. Access
   * stays on only if there is a live subscription to justify it — anything
   * else would leave a comped account quietly free forever.
   */
  if v_kind = 'free' then
    update entitlements e
       set source = 'stripe_webhook', granted_by = null, grant_reason = null,
           valid_until = null,
           is_active = exists (select 1 from subscriptions s
                                where s.company_id = p_company
                                  and s.status in ('trialing', 'active', 'past_due')),
           updated_at = now()
     where e.company_id = p_company;
  end if;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (p_company, auth.uid(), 'update', 'public.company_billing_terms', p_company::text,
          jsonb_build_object('revoked', true, 'was', v_kind), trim(p_reason));
end;
$$;

-- -----------------------------------------------------------------------------
-- Seeing it
-- -----------------------------------------------------------------------------
create or replace view my_billing_terms
with (security_invoker = true) as
select
  t.company_id, t.kind, t.percent_off, t.seat_price_cents, t.reason,
  t.valid_until, t.created_at,
  app.seat_price_cents(t.company_id, 'month') as seat_price_month_cents,
  app.seat_price_cents(t.company_id, 'year')  as seat_price_year_cents
from company_billing_terms t
where t.revoked_at is null;

comment on view my_billing_terms is
  'A company''s own commercial arrangement and what it makes a seat cost. A customer being unable to see why their invoice is what it is would be its own defect.';

grant select on my_billing_terms to authenticated;
revoke all on my_billing_terms from anon;

create or replace view admin_billing_terms as
select
  t.id, t.company_id, c.name as company_name,
  t.kind, t.percent_off, t.seat_price_cents, t.stripe_coupon_id,
  t.applies_in_stripe,
  t.reason, t.valid_until, t.created_at,
  t.granted_by, up.email as granted_by_email,
  app.seat_price_cents(t.company_id, 'month') as seat_price_month_cents,
  app.billable_seats(t.company_id)            as seats,
  app.billable_seats(t.company_id) * app.seat_price_cents(t.company_id, 'month')
                                              as monthly_cents
from company_billing_terms t
join companies c on c.id = t.company_id
left join user_profiles up on up.id = t.granted_by
where t.revoked_at is null and app.operator_can('billing.read');

comment on view admin_billing_terms is
  'Every account not on the list price, what it costs them, and who granted it. The answer to "which accounts are we giving away, and why".';

grant select on admin_billing_terms to authenticated;
revoke all on admin_billing_terms from anon;

-- Wrappers, so the console can reach these through PostgREST.
create or replace function public.create_company_for(
  p_owner_email text, p_name text, p_reason text, p_slug text default null)
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin return app.create_company_for(p_owner_email, p_name, p_reason, p_slug); end; $$;

create or replace function public.set_billing_terms(
  p_company uuid, p_kind text, p_reason text,
  p_percent_off numeric default null, p_seat_price_cents int default null,
  p_valid_until timestamptz default null, p_stripe_coupon_id text default null)
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin return app.set_billing_terms(p_company, p_kind, p_reason, p_percent_off,
       p_seat_price_cents, p_valid_until, p_stripe_coupon_id); end; $$;

create or replace function public.clear_billing_terms(p_company uuid, p_reason text)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.clear_billing_terms(p_company, p_reason); end; $$;

create or replace function public.set_role_permissions(
  p_key text, p_permissions text[], p_reason text)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.set_role_permissions(p_key, p_permissions, p_reason); end; $$;

create or replace function public.create_platform_role(
  p_key text, p_name text, p_description text, p_permissions text[])
returns text language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin return app.create_platform_role(p_key, p_name, p_description, p_permissions); end; $$;

-- PostgREST only exposes `public`, and the checkout function needs both of
-- these to bill for the right number of seats at the right price.
create or replace function public.billable_seats(p_company uuid)
returns int language sql stable security invoker set search_path = public, pg_catalog
as $$ select app.billable_seats(p_company); $$;

create or replace function public.seat_price_cents(
  p_company uuid, p_interval text default 'month')
returns int language sql stable security invoker set search_path = public, pg_catalog
as $$ select app.seat_price_cents(p_company, p_interval); $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'app.create_company_for(text, text, text, text)',
    'app.set_billing_terms(uuid, text, text, numeric, integer, timestamptz, text)',
    'app.clear_billing_terms(uuid, text)',
    'app.set_role_permissions(text, text[], text)',
    'app.create_platform_role(text, text, text, text[])',
    'app.provision_company_for(uuid, text, text, text)',
    'public.create_company_for(text, text, text, text)',
    'public.set_billing_terms(uuid, text, text, numeric, integer, timestamptz, text)',
    'public.clear_billing_terms(uuid, text)',
    'public.set_role_permissions(text, text[], text)',
    'public.create_platform_role(text, text, text, text[])',
    'public.seat_price_cents(uuid, text)',
    'public.billable_seats(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

-- provision_company_for builds a whole tenant and names its owner. Nothing but
-- the two functions above should call it.
revoke execute on function app.provision_company_for(uuid, text, text, text) from authenticated;

select app.assert_security_gates();
