-- =============================================================================
-- 0070 — Setting a price, and claiming the first operator seat
--
-- Two gaps that both end in somebody being told to open a SQL editor.
--
-- **A price could not be set from anywhere.** `plan_prices` is readable by
-- anonymous visitors — it is one of the two tables that is, so the pricing page
-- can render without an account — and writable by nobody at all. The catalog
-- was seeded once and the only way to change a number was to write SQL by hand,
-- which is a poor answer for the one figure a business changes most often.
--
-- **Nobody could become the first operator.** `platform_admins` has no insert
-- policy on purpose: it is the most powerful grant in the system and should not
-- be reachable from a screen. That is right once a platform is running and
-- wrong on the day it is installed, because there is nobody to do the granting.
--
-- The bootstrap is deliberately narrow, and each condition is load-bearing:
--
--   * only when **no live superadmin exists**, so it cannot be used to add a
--     second or to take the seat from somebody;
--   * only by the **earliest-registered account**, so a stranger who signs up
--     on a deployment that has been sitting idle cannot claim it;
--   * and it is **audited**, like every other operator action.
--
-- Taken together it can happen once, to the person who installed the thing.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Setting a price
-- -----------------------------------------------------------------------------
/**
 * Publish a price for a plan.
 *
 * The superadmin's, because a price is the most consequential number the
 * platform publishes: it is what a customer agrees to and what Stripe charges.
 *
 * `stripe_price_id` is required and not generated here. GrounUp does not create
 * prices in Stripe — the object has to exist there first, and pairing our
 * catalog to an id somebody pasted is the honest arrangement. Inventing one
 * would produce a page that quotes a number checkout cannot charge.
 */
create or replace function app.set_plan_price(
  p_plan_id         text,
  p_interval        text,
  p_unit_amount_cents int,
  p_stripe_price_id text,
  p_currency        char(3) default 'USD'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_id uuid;
begin
  if not app.is_superadmin() then
    raise exception 'Only the superadmin may set a price'
      using errcode = 'insufficient_privilege';
  end if;
  if p_interval not in ('month', 'year') then
    raise exception 'A price is charged by the month or by the year, not %', p_interval
      using errcode = 'check_violation';
  end if;
  if p_unit_amount_cents is null or p_unit_amount_cents < 0 then
    raise exception 'A price must be zero or more' using errcode = 'check_violation';
  end if;
  -- Migration 0071 relaxes this: a price may be decided before Stripe is
  -- connected, and is marked not yet chargeable until it is.
  if p_stripe_price_id is null or length(trim(p_stripe_price_id)) = 0 then
    raise exception 'A price needs the Stripe price it corresponds to'
      using errcode = 'check_violation',
            hint = 'Create the price in Stripe first and paste its id (price_...).';
  end if;
  if not exists (select 1 from plans where id = p_plan_id) then
    raise exception 'Plan % does not exist', p_plan_id using errcode = 'no_data_found';
  end if;

  /*
   * Retire the old price rather than overwrite it. A subscription created last
   * month was created at a number, and that number has to remain answerable —
   * the same reason plans are versioned rather than edited.
   */
  update plan_prices set is_active = false, updated_at = now()
   where plan_id = p_plan_id and interval = p_interval and is_active;

  insert into plan_prices
    (plan_id, stripe_price_id, interval, unit_amount_cents, currency, usage_type, is_active)
  values (p_plan_id, trim(p_stripe_price_id), p_interval, p_unit_amount_cents,
          p_currency, 'licensed', true)
  -- The table is unique on (plan_id, interval, usage_type), not on currency:
  -- one plan has one licensed price per interval, and a second currency would
  -- be a second plan rather than a second row.
  on conflict (plan_id, interval, usage_type) do update set
    stripe_price_id = excluded.stripe_price_id,
    unit_amount_cents = excluded.unit_amount_cents,
    currency = excluded.currency,
    is_active = true,
    updated_at = now()
  returning id into v_id;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (null, auth.uid(), 'update', 'public.plan_prices', v_id::text,
          jsonb_build_object('plan', p_plan_id, 'interval', p_interval,
                             'cents', p_unit_amount_cents, 'stripe_price', p_stripe_price_id),
          'Price published from the operator console');

  return v_id;
end;
$$;

revoke all on function app.set_plan_price(text, text, int, text, char) from public, anon;
grant execute on function app.set_plan_price(text, text, int, text, char) to authenticated;

comment on function app.set_plan_price(text, text, int, text, char) is
  'Publishes a price for a plan, retiring the previous one rather than overwriting it — a subscription created last month was created at a number, and that number stays answerable. Requires the Stripe price id: GrounUp does not create prices in Stripe, and quoting a number checkout cannot charge would be worse than quoting none.';

-- -----------------------------------------------------------------------------
-- Claiming the first operator seat
-- -----------------------------------------------------------------------------
/**
 * Become the platform's first superadmin.
 *
 * Refuses in every case except the one it exists for: a fresh installation
 * where nobody holds the seat and the caller is the account that was created
 * first. Both conditions are checked, because either alone is not enough — the
 * first-account test stops a stranger claiming an idle deployment, and the
 * empty-seat test stops it being used to displace somebody.
 */
create or replace function app.claim_first_superadmin()
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user  uuid := auth.uid();
  v_first uuid;
  v_id    uuid;
begin
  if v_user is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from platform_admins
             where role = 'superadmin' and revoked_at is null) then
    raise exception 'This platform already has a superadmin'
      using errcode = 'insufficient_privilege',
            hint = 'Operator access is granted by the superadmin, in the database.';
  end if;

  select id into v_first from auth.users order by created_at, id limit 1;
  if v_first is distinct from v_user then
    raise exception 'Only the first account registered on this platform may claim it'
      using errcode = 'insufficient_privilege';
  end if;

  insert into platform_admins (user_id, reason, role, granted_by)
  values (v_user, 'Claimed the first operator seat on a new installation',
          'superadmin', v_user)
  returning id into v_id;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (null, v_user, 'insert', 'public.platform_admins', v_id::text,
          jsonb_build_object('role', 'superadmin', 'via', 'first_claim'),
          'First operator seat claimed on a new installation');

  return v_id;
end;
$$;

revoke all on function app.claim_first_superadmin() from public, anon;
grant execute on function app.claim_first_superadmin() to authenticated;

comment on function app.claim_first_superadmin() is
  'Lets the person who installed the platform become its first superadmin, once. Refused when a superadmin already exists, and refused to anybody but the earliest-registered account — so it cannot add a second, displace one, or be claimed by a stranger who finds an idle deployment.';

/** Whether the first seat is still unclaimed, so a screen can offer it. */
create or replace function app.superadmin_seat_is_open()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select not exists (
    select 1 from platform_admins where role = 'superadmin' and revoked_at is null);
$$;

grant execute on function app.superadmin_seat_is_open() to authenticated;

-- -----------------------------------------------------------------------------
-- Reachable from a browser
-- -----------------------------------------------------------------------------
create or replace function public.set_plan_price(
  p_plan_id text, p_interval text, p_unit_amount_cents int,
  p_stripe_price_id text, p_currency char(3) default 'USD')
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin
  return app.set_plan_price(p_plan_id, p_interval, p_unit_amount_cents,
                            p_stripe_price_id, p_currency);
end; $$;

create or replace function public.claim_first_superadmin()
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin return app.claim_first_superadmin(); end; $$;

create or replace function public.superadmin_seat_is_open()
returns boolean language sql stable security invoker set search_path = public, pg_catalog
as $$ select app.superadmin_seat_is_open(); $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.set_plan_price(text, text, int, text, char)',
    'public.claim_first_superadmin()',
    'public.superadmin_seat_is_open()'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

select app.assert_security_gates();
