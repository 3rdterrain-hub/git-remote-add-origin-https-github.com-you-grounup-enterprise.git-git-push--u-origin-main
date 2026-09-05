-- =============================================================================
-- 0077 — Free to install, paid to run a business on
--
-- Everybody gets the product. Estimating, takeoff, the master library, leads,
-- proposals and documents, permanently, at no cost, for a small crew. Running
-- a construction company on it — projects, field production, procurement,
-- fleet, scheduling, workforce, safety, finance — is what a subscription buys.
--
-- Two things were missing before this could be true rather than said.
--
-- **A plan to fall back to.** Signup started a fourteen-day trial on the paid
-- plan and, on day fifteen, `has_entitlement` began returning false for
-- everything. The customer who did not convert lost the estimating they were
-- getting value from, which is the opposite of what a free tier is for. There
-- is now a `free` plan and, more importantly, the *effective* plan is derived:
-- an entitlement that has lapsed falls back to free rather than to nothing. No
-- job has to run at midnight for that to be true, and it cannot be late.
--
-- **Gates that actually hold.** Before this, `has_entitlement` was called from
-- exactly one place in the entire platform. Every other feature boundary was
-- a claim the database did nothing about — a paid module was one API call away
-- for anybody with an anon key. Feature limits now refuse the write, in the
-- database, on the tables that belong to each module.
--
-- What the gates deliberately do *not* do is take anything away. They refuse
-- new rows in a paid module; they never hide or delete what is already there.
-- A company whose subscription lapses can still open, read and export every
-- project it ever ran. Holding a customer's own records hostage to a renewal
-- is not a business model, it is a hostage situation.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The plan everybody has
-- -----------------------------------------------------------------------------
insert into plans (id, name, tagline, description, tier, is_public, is_active,
                   max_seats, max_companies, max_active_estimates, max_active_projects,
                   storage_gb, ai_credits_per_month, features, trial_days, sort_order)
values (
  'free', 'GrounUp Free',
  'The estimating half, free forever.',
  'Production-based estimating, on-screen takeoff, the full GrounUp master library, leads, proposals and documents — for up to two people, permanently, at no cost. Projects, field production, procurement, fleet, scheduling, workforce, safety and finance are what a subscription adds.',
  0, true, true,
  -- Small enough that a company running real work will need seats, generous
  -- enough that an owner-estimator and a partner are never nagged.
  -- Projects are null rather than zero: the count limit is not what keeps them
  -- off the free plan — the feature gate refuses the row outright, with a
  -- message that says which module it is. A zero here would refuse it with
  -- "this plan allows 0 projects", which is a worse way to say the same thing,
  -- and the column will not take zero anyway.
  2, 1, 5, null,
  1, 25,
  array['estimating', 'takeoff', 'master_libraries', 'crm_basic',
        'proposals', 'documents'],
  -- No trial. A trial that ends is the thing this plan exists to replace.
  0, 0)
on conflict (id) do update set
  name = excluded.name, tagline = excluded.tagline, description = excluded.description,
  tier = excluded.tier, is_public = excluded.is_public, is_active = excluded.is_active,
  max_seats = excluded.max_seats, max_companies = excluded.max_companies,
  max_active_estimates = excluded.max_active_estimates,
  max_active_projects = excluded.max_active_projects,
  storage_gb = excluded.storage_gb, ai_credits_per_month = excluded.ai_credits_per_month,
  features = excluded.features, trial_days = excluded.trial_days,
  sort_order = excluded.sort_order;

-- Free is a real price of zero, not the absence of one. It is published like
-- any other price so the pricing page reads one catalog rather than two, and
-- it carries no Stripe id because nothing is ever charged for it — which
-- `is_chargeable` already derives correctly.
insert into plan_prices (plan_id, stripe_price_id, interval, unit_amount_cents,
                         currency, usage_type, is_active)
values ('free', null, 'month', 0, 'USD', 'licensed', true),
       ('free', null, 'year',  0, 'USD', 'licensed', true)
on conflict (plan_id, interval, usage_type) do update set
  unit_amount_cents = 0, is_active = true, updated_at = now();

-- -----------------------------------------------------------------------------
-- Which plan's terms actually apply
-- -----------------------------------------------------------------------------
/**
 * The plan a company is on right now.
 *
 * Derived on every call rather than written by a scheduled job, because a
 * downgrade that depends on a job running is a downgrade that is wrong between
 * the moment a trial ends and the moment the job next runs. A lapsed
 * entitlement lands on `free`, never on nothing.
 */
create or replace function app.effective_plan(p_company uuid)
returns text
language sql stable security definer set search_path = public, pg_catalog
as $$
  select coalesce(
    (select e.plan_id from entitlements e
      where e.company_id = p_company
        and e.is_active
        and (e.valid_until is null or e.valid_until > now())
        and e.plan_id is not null),
    'free');
$$;

grant execute on function app.effective_plan(uuid) to authenticated, service_role;

comment on function app.effective_plan(uuid) is
  'The plan whose terms apply to this company at this instant: their entitlement while it is live, and `free` the moment it is not. Derived rather than stored, so an expiring trial needs nothing to run for the downgrade to be correct.';

/*
 * `has_entitlement` and `plan_limit` both used to read the entitlement row and
 * return "no" or NULL when it had lapsed. They now read the effective plan, so
 * the same lapse lands on the free plan's features and the free plan's limits.
 *
 * The entitlement row is still preferred over the plan catalog while it is
 * live: an enterprise agreement or a support grant writes allowances onto the
 * entitlement that are deliberately not the catalog's.
 */
create or replace function app.has_entitlement(p_company uuid, p_feature text)
returns boolean
language sql stable security definer set search_path = public, pg_catalog
as $$
  select case
    -- An operator override still decides first, either way: a revoke beats a
    -- grant beats the plan, exactly as migration 0064 established.
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
    else coalesce((
      -- The entitlement while it is live, because an enterprise agreement or a
      -- support grant writes features onto it that the catalog does not carry;
      -- the effective plan's own list once it is not, which is the free plan
      -- rather than nothing.
      select f @> array['*'] or f @> array[p_feature]
      from (
        select coalesce(
          (select e.features from entitlements e
            where e.company_id = p_company and e.is_active
              and (e.valid_until is null or e.valid_until > now())),
          (select p.features from plans p where p.id = app.effective_plan(p_company))
        ) as f
      ) x
    ), false)
  end;
$$;

create or replace function app.plan_limit(p_company uuid, p_key text)
returns int
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
declare
  v int;
  v_live boolean;
begin
  if p_key not in ('max_seats', 'max_active_estimates', 'max_active_projects',
                   'storage_gb', 'ai_credits_per_month') then
    raise exception 'Unknown plan limit "%".', p_key using errcode = 'invalid_parameter_value';
  end if;

  select exists (select 1 from entitlements e
                  where e.company_id = p_company and e.is_active
                    and (e.valid_until is null or e.valid_until > now()))
    into v_live;

  if v_live then
    execute format(
      'select e.%I from entitlements e where e.company_id = $1 and e.is_active
         and (e.valid_until is null or e.valid_until > now())', p_key)
    into v using p_company;
  else
    -- Lapsed: the free plan's allowance, not "unlimited".
    execute format('select p.%I from plans p where p.id = $1', p_key)
    into v using app.effective_plan(p_company);
  end if;

  return v;
end;
$$;

comment on function app.plan_limit(uuid, text) is
  'The numeric limit a company is entitled to, or NULL for unlimited. A lapsed entitlement returns the free plan''s allowance rather than NULL: before 0077 a billing gap silently granted unlimited seats, which is the opposite of what "no active entitlement" should mean.';

-- The enforcer names the effective plan rather than the entitlement's, so an
-- expired customer is told they are on Free instead of on the plan they left.
create or replace function app.enforce_plan_count_limit()
returns trigger
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_limit int := app.plan_limit(new.company_id, tg_argv[0]);
  v_count int;
  v_plan  text;
begin
  if v_limit is null then
    return new;
  end if;

  execute format('select count(*) from public.%I where company_id = $1 and (%s)',
                 tg_table_name, tg_argv[2])
  into v_count using new.company_id;

  if v_count >= v_limit then
    select p.name into v_plan from plans p where p.id = app.effective_plan(new.company_id);
    raise exception
      'This plan allows % %. % already has %. Upgrade to add more.',
      v_limit, tg_argv[1], coalesce(v_plan, 'The current plan'), v_count
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Gates that refuse the write
--
-- One trigger function, applied per table with the feature that table belongs
-- to. INSERT only, and deliberately so: what a company already built stays
-- readable, editable and exportable when their subscription ends. They just
-- cannot start anything new in a module they are not paying for.
-- -----------------------------------------------------------------------------
create or replace function app.enforce_feature_entitlement()
returns trigger
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_plan text;
begin
  /*
   * A row with no company belongs to the global library rather than to a
   * tenant — the master equipment list, the standard services. Nobody
   * subscribes to those, so there is nothing to gate.
   */
  if new.company_id is null then
    return new;
  end if;
  if app.has_entitlement(new.company_id, tg_argv[0]) then
    return new;
  end if;
  select p.name into v_plan from plans p where p.id = app.effective_plan(new.company_id);
  raise exception '% is not included in %.', tg_argv[1], coalesce(v_plan, 'this plan')
    using errcode = 'insufficient_privilege',
          hint = 'A subscription includes it. Everything already here stays readable.';
end;
$$;

comment on function app.enforce_feature_entitlement() is
  'Refuses a new row in a module the company is not entitled to. INSERT only — a lapsed subscription never hides, locks or deletes work a customer already did. TG_ARGV: [0] feature key, [1] the module''s name as a person would say it.';

/*
 * Which tables belong to which module. The head of each module is gated rather
 * than every table beneath it: a change order line cannot exist without its
 * change order, so gating the parent gates the tree, and gating both would
 * double the cost of every insert to say the same thing twice.
 */
do $$
declare
  v_map text[][] := array[
    array['projects',               'projects',         'Project management'],
    array['change_orders',          'change_orders',    'Change orders'],
    array['daily_reports',          'field_production', 'Field production'],
    array['purchase_orders',        'procurement',      'Procurement'],
    array['rfqs',                   'procurement',      'Procurement'],
    array['vendors',                'procurement',      'Procurement'],
    array['equipment',              'fleet',            'Fleet management'],
    array['work_orders',            'fleet',            'Fleet maintenance'],
    array['fuel_transactions',      'fleet',            'Fuel tracking'],
    array['assets',                 'fleet',            'Asset management'],
    array['schedule_activities',    'scheduling',       'Scheduling'],
    array['schedule_baselines',     'scheduling',       'Scheduling'],
    array['divisions',              'divisions',        'Divisions'],
    array['api_keys',               'api_access',       'API access'],
    array['production_calibrations','calibration',      'Production calibration'],
    array['employees',              'workforce',        'Workforce records'],
    array['time_entries',           'workforce',        'Time and attendance'],
    array['crews',                  'workforce',        'Crew management'],
    array['safety_incidents',       'safety',           'Safety records'],
    array['inspections',            'safety',           'Inspections'],
    array['toolbox_talks',          'safety',           'Toolbox talks'],
    array['surveys',                'survey',           'Survey and design surfaces'],
    array['surfaces',               'survey',           'Survey and design surfaces'],
    array['contracts',              'finance',          'Contract management'],
    array['ap_invoices',            'finance',          'Accounts payable'],
    array['pay_applications',       'finance',          'Pay applications'],
    array['opportunities',          'crm_full',         'The full CRM pipeline']
  ];
  i int;
begin
  for i in 1 .. array_length(v_map, 1) loop
    if to_regclass('public.' || v_map[i][1]) is null then
      raise exception 'Cannot gate %: no such table', v_map[i][1];
    end if;
    execute format('drop trigger if exists %I on public.%I',
                   v_map[i][1] || '_feature_gate', v_map[i][1]);
    execute format(
      'create trigger %I before insert on public.%I for each row
         execute function app.enforce_feature_entitlement(%L, %L)',
      v_map[i][1] || '_feature_gate', v_map[i][1], v_map[i][2], v_map[i][3]);
  end loop;
end $$;

/*
 * The vocabulary the gates use is newer than the five-tier catalog, so the
 * plans that predate it name their modules in `supabase/seed/0002_plan_catalog.sql`
 * rather than here — the catalog is seed data, and a migration that edited it
 * would be overwritten by the next seed run and quietly do nothing.
 */

-- -----------------------------------------------------------------------------
-- Saying so, on the customer's own screen
-- -----------------------------------------------------------------------------
create or replace view my_plan
with (security_invoker = true) as
select
  c.id                                as company_id,
  app.effective_plan(c.id)            as plan_id,
  p.name                              as plan_name,
  p.tagline,
  p.features,
  (p.features @> array['*'])          as everything_included,
  e.valid_until                       as access_valid_until,
  e.source                            as entitlement_source,
  -- What the free plan would give them, so an upgrade prompt can be specific
  -- about what is being added rather than vague about "more".
  (app.effective_plan(c.id) = 'free') as on_the_free_plan
from companies c
left join entitlements e on e.company_id = c.id
left join plans p on p.id = app.effective_plan(c.id);

comment on view my_plan is
  'Which plan a company is actually on and what it includes, derived. The screen that tells somebody why a button is unavailable reads this rather than guessing from a subscription row.';

grant select on my_plan to authenticated;
revoke all on my_plan from anon;

select app.assert_security_gates();
