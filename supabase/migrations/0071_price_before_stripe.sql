-- =============================================================================
-- 0071 — A price can be decided before payments are wired up
--
-- Migration 0070 required a Stripe price id before a price could be published,
-- reasoning that quoting a number checkout cannot charge is worse than quoting
-- none. That reasoning is sound about the *page* and too strict about the
-- *decision*: deciding what to charge and connecting Stripe are separate acts,
-- and they happen in that order. Refusing to record the first until the second
-- exists means the number lives in somebody's head, which is the worst place
-- for it.
--
-- So a price may now be published without a Stripe id, and is marked as not yet
-- chargeable. Three things follow, and together they are more honest than
-- either of the alternatives:
--
--   * the pricing page shows the real number, because it is the real number;
--   * its button routes to sales rather than to a checkout that would fail;
--   * `resolveRequestedPrice` in the Edge Function already refuses a price it
--     cannot charge, so nothing downstream needed loosening — an unchargeable
--     price simply never resolves.
--
-- The alternative of pasting a placeholder id would have been worse than both:
-- checkout would accept it and fail at Stripe, in front of a customer.
-- =============================================================================

alter table plan_prices
  alter column stripe_price_id drop not null;

/*
 * Derived rather than stored. "Can this be charged" is a fact about whether a
 * Stripe price exists, and a flag somebody sets would be one more thing to
 * forget when the id is finally pasted in.
 */
alter table plan_prices
  add column is_chargeable boolean
    generated always as (stripe_price_id is not null
                         and length(trim(stripe_price_id)) > 0) stored;

comment on column plan_prices.stripe_price_id is
  'The Stripe price this corresponds to, once payments are connected. Null while a price has been decided and Stripe has not been wired up yet — a real and ordinary state, and better recorded than left in somebody''s head.';

comment on column plan_prices.is_chargeable is
  'Generated: whether checkout can actually charge this. A price with no Stripe id is shown on the pricing page and routes to sales, because the number is real even when the plumbing is not.';

/**
 * Publish a price, with or without Stripe behind it yet.
 *
 * Supersedes the 0070 version, which refused a price with no Stripe id. The
 * refusal protected the wrong thing: a customer is harmed by a checkout that
 * fails, not by a published number, and the page can route around an
 * unchargeable price perfectly well.
 */
create or replace function app.set_plan_price(
  p_plan_id         text,
  p_interval        text,
  p_unit_amount_cents int,
  p_stripe_price_id text default null,
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
    currency = excluded.currency,
    is_active = true,
    updated_at = now()
  returning id into v_id;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (null, auth.uid(), 'update', 'public.plan_prices', v_id::text,
          jsonb_build_object('plan', p_plan_id, 'interval', p_interval,
                             'cents', p_unit_amount_cents,
                             'chargeable', nullif(trim(coalesce(p_stripe_price_id, '')), '')
                                             is not null),
          'Price published from the operator console');

  return v_id;
end;
$$;

revoke all on function app.set_plan_price(text, text, int, text, char) from public, anon;
grant execute on function app.set_plan_price(text, text, int, text, char) to authenticated;

comment on function app.set_plan_price(text, text, int, text, char) is
  'Publishes a price. The Stripe price id is optional: deciding what to charge and connecting Stripe are separate acts that happen in that order, and a decision recorded without plumbing is better than one left in somebody''s head. An unchargeable price shows on the pricing page and routes to sales — checkout refuses it on its own, because resolveRequestedPrice has always required a Stripe id.';

select app.assert_security_gates();
