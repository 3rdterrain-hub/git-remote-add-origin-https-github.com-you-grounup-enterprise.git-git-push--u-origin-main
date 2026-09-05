-- =============================================================================
-- 0095 — A plan of your own, and money by the period you asked for
--
-- Three things the console could not do, all of them things somebody running
-- this actually wants on a Tuesday.
--
-- **A plan for one customer.** "GrounUp should have a custom plan for companies
-- of my choosing, like mine, where I can customize it for them." The catalog
-- has always been fixed at seed time: five withdrawn tiers, the paid plan, the
-- free one, and two unadvertised ones. Making a sixth meant a migration. It
-- should mean filling in a form — a plan that is not on the pricing page, with
-- whatever limits and features that customer negotiated.
--
-- **Choosing the plan when the company is created.** `create_company_for` has
-- always put everybody on `grounup`, which is right for a normal signup and
-- wrong for the customer you are creating the company *for*, who is usually
-- the one on different terms.
--
-- **Money by week, month or year.** `admin_earnings_by_month` reports one
-- grain because a view can only have one shape. A function can take the grain
-- as an argument, which is what somebody comparing a slow week to a good one
-- actually needs.
-- =============================================================================

/**
 * Make a plan.
 *
 * Private by default. A plan created here is for a named customer or a
 * negotiated arrangement, and putting it on the public pricing page is a
 * separate decision made deliberately rather than a checkbox somebody leaves
 * ticked.
 */
create or replace function app.create_plan(
  p_id text, p_name text, p_tagline text, p_description text,
  p_max_seats int, p_max_estimates int, p_max_projects int,
  p_storage_gb int, p_ai_credits int, p_features text[],
  p_trial_days int default 0, p_is_public boolean default false)
returns text
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_unknown text[];
begin
  if not app.operator_can('pricing.manage') then
    raise exception 'You do not have permission to create a plan'
      using errcode = 'insufficient_privilege';
  end if;
  if p_id !~ '^[a-z][a-z0-9_]{1,40}$' then
    raise exception 'A plan id is lower case letters, digits and underscores'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from plans where id = p_id) then
    raise exception 'There is already a plan called %', p_id
      using errcode = 'unique_violation';
  end if;
  if p_name is null or length(trim(p_name)) < 2 then
    raise exception 'A plan needs a name' using errcode = 'check_violation';
  end if;

  -- The same validation `set_plan_features` does, for the same reason: a key
  -- that is not in the catalog grants nothing, silently.
  select array_agg(f) into v_unknown
  from unnest(coalesce(p_features, '{}')) f
  where f <> '*' and not exists (select 1 from feature_catalog c where c.key = f);
  if v_unknown is not null then
    raise exception 'No such feature: %', array_to_string(v_unknown, ', ')
      using errcode = 'foreign_key_violation';
  end if;

  insert into plans (id, name, tagline, description, tier, is_public, is_active,
                     max_seats, max_companies, max_active_estimates, max_active_projects,
                     storage_gb, ai_credits_per_month, features, trial_days, sort_order)
  values (p_id, trim(p_name), nullif(trim(coalesce(p_tagline, '')), ''),
          nullif(trim(coalesce(p_description, '')), ''),
          -- Above everything sold, because a negotiated plan is not a rung on
          -- a ladder and nothing should treat it as the next step up.
          100, coalesce(p_is_public, false), true,
          p_max_seats, null, p_max_estimates, p_max_projects,
          p_storage_gb, p_ai_credits, coalesce(p_features, '{}'),
          greatest(coalesce(p_trial_days, 0), 0),
          (select coalesce(max(sort_order), 0) + 10 from plans));

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (null, auth.uid(), 'insert', 'public.plans', p_id,
          jsonb_build_object('name', p_name, 'public', coalesce(p_is_public, false),
                             'features', coalesce(p_features, '{}')),
          'Plan created from the operator console');
  return p_id;
end;
$$;

/** On the pricing page, or sold by hand. Retired, or still sold. */
create or replace function app.set_plan_visibility(
  p_plan text, p_is_public boolean, p_is_active boolean, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_before jsonb;
begin
  if not app.operator_can('pricing.manage') then
    raise exception 'You do not have permission to change what is on sale'
      using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object('is_public', is_public, 'is_active', is_active)
    into v_before from plans where id = p_plan;
  if v_before is null then
    raise exception 'Plan % does not exist', p_plan using errcode = 'no_data_found';
  end if;
  /*
   * Retiring the plan somebody is on does not move them — an entitlement holds
   * its own terms — but it does stop anybody else buying it, which is the
   * point. Refusing to retire a plan with customers on it would mean never
   * being able to stop selling anything.
   */
  update plans set is_public = coalesce(p_is_public, is_public),
                   is_active = coalesce(p_is_active, is_active),
                   updated_at = now()
   where id = p_plan;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            prior_state, new_state, reason)
  values (null, auth.uid(), 'update', 'public.plans', p_plan, v_before,
          jsonb_build_object('is_public', p_is_public, 'is_active', p_is_active),
          coalesce(nullif(trim(coalesce(p_reason, '')), ''),
                   'Visibility changed from the operator console'));
end;
$$;

/*
 * Creating a company on a chosen plan.
 *
 * The plan defaulted to `grounup`, which is right for an ordinary signup and
 * wrong for the customer somebody is creating a company *for* — who is usually
 * the one on different terms in the first place.
 */
create or replace function app.create_company_for(
  p_owner_email text, p_name text, p_reason text,
  p_slug text default null, p_plan text default 'grounup')
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
  if not exists (select 1 from plans where id = coalesce(p_plan, 'grounup') and is_active) then
    raise exception 'Plan % does not exist, or is retired', p_plan
      using errcode = 'no_data_found';
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

  v_company := app.provision_company_for(v_owner, trim(p_name), v_slug,
                                         coalesce(p_plan, 'grounup'));

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (v_company, auth.uid(), 'insert', 'public.companies', v_company::text,
          jsonb_build_object('name', trim(p_name), 'slug', v_slug,
                             'plan', coalesce(p_plan, 'grounup'),
                             'owner', lower(trim(p_owner_email))),
          trim(p_reason));
  return v_company;
end;
$$;

-- -----------------------------------------------------------------------------
-- Money by the period somebody asked for
--
-- A view has one shape. Comparing a slow week to a good one, or this year to
-- last, needs the grain to be an argument.
-- -----------------------------------------------------------------------------
create or replace function app.earnings(
  p_grain text default 'month', p_periods int default 24)
returns table (
  period            timestamptz,
  invoiced_cents    bigint,
  paid_cents        bigint,
  outstanding_cents bigint,
  refunded_cents    bigint,
  net_cents         bigint,
  invoices          bigint,
  paying_companies  bigint
)
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
declare
  v_step interval;
  v_n    int := least(greatest(coalesce(p_periods, 24), 1), 260);
begin
  if not app.operator_can('billing.read') then
    return;
  end if;
  v_step := case p_grain
    when 'week'  then interval '1 week'
    when 'month' then interval '1 month'
    when 'year'  then interval '1 year'
    else null end;
  if v_step is null then
    raise exception 'Money is reported by week, month or year, not "%"', p_grain
      using errcode = 'invalid_parameter_value';
  end if;

  return query
  select
    p.period,
    coalesce(i.invoiced, 0)::bigint,
    coalesce(i.paid, 0)::bigint,
    (coalesce(i.invoiced, 0) - coalesce(i.paid, 0))::bigint,
    coalesce(r.refunded, 0)::bigint,
    (coalesce(i.paid, 0) - coalesce(r.refunded, 0))::bigint,
    coalesce(i.n, 0)::bigint,
    coalesce(i.companies, 0)::bigint
  from (
    select generate_series(
      date_trunc(p_grain, now()) - (v_n - 1) * v_step,
      date_trunc(p_grain, now()), v_step) as period
  ) p
  left join lateral (
    select sum(bi.amount_due_cents) as invoiced, sum(bi.amount_paid_cents) as paid,
           count(*) as n, count(distinct bi.company_id) as companies
    from billing_invoices bi
    -- By the period the invoice covers, not the day it was raised. An invoice
    -- issued on the thirty-first for the following month is next month's money.
    where date_trunc(p_grain, coalesce(bi.period_start, bi.created_at)) = p.period
      and bi.status <> 'void'
  ) i on true
  left join lateral (
    select sum(rr.amount_cents) as refunded
    from refund_requests rr
    where rr.state = 'applied' and rr.kind = 'refund'
      and date_trunc(p_grain, rr.applied_at) = p.period
  ) r on true
  order by p.period desc;
end;
$$;

comment on function app.earnings(text, int) is
  'Money by week, month or year: invoiced, paid, outstanding, refunded and net. The grain is an argument because a view has one shape and comparing a slow week to a good one needs both. Grouped by the period an invoice covers rather than the day it was raised.';

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'app.create_plan(text, text, text, text, integer, integer, integer, integer, integer, text[], integer, boolean)',
    'app.set_plan_visibility(text, boolean, boolean, text)',
    'app.create_company_for(text, text, text, text, text)',
    'app.earnings(text, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

create or replace function public.create_plan(
  p_id text, p_name text, p_tagline text, p_description text,
  p_max_seats int, p_max_estimates int, p_max_projects int,
  p_storage_gb int, p_ai_credits int, p_features text[],
  p_trial_days int default 0, p_is_public boolean default false)
returns text language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin return app.create_plan(p_id, p_name, p_tagline, p_description, p_max_seats,
       p_max_estimates, p_max_projects, p_storage_gb, p_ai_credits, p_features,
       p_trial_days, p_is_public); end; $$;

create or replace function public.set_plan_visibility(
  p_plan text, p_is_public boolean, p_is_active boolean, p_reason text)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.set_plan_visibility(p_plan, p_is_public, p_is_active, p_reason); end; $$;

create or replace function public.create_company_for(
  p_owner_email text, p_name text, p_reason text,
  p_slug text default null, p_plan text default 'grounup')
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin return app.create_company_for(p_owner_email, p_name, p_reason, p_slug, p_plan); end; $$;

create or replace function public.earnings(p_grain text default 'month', p_periods int default 24)
returns table (
  period timestamptz, invoiced_cents bigint, paid_cents bigint,
  outstanding_cents bigint, refunded_cents bigint, net_cents bigint,
  invoices bigint, paying_companies bigint)
language sql stable security invoker set search_path = public, pg_catalog
as $$ select * from app.earnings(p_grain, p_periods); $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.create_plan(text, text, text, text, integer, integer, integer, integer, integer, text[], integer, boolean)',
    'public.set_plan_visibility(text, boolean, boolean, text)',
    'public.create_company_for(text, text, text, text, text)',
    'public.earnings(text, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

-- The four-argument form is dropped: with a default on the fifth, a
-- four-argument call would match both and Postgres would refuse it.
drop function if exists public.create_company_for(text, text, text, text);
drop function if exists app.create_company_for(text, text, text, text);

select app.assert_security_gates();
