-- =============================================================================
-- 0084 — When a payment fails
--
-- A subscription in `past_due` has shown as an orange badge on the operator
-- console since migration 0064 and nobody has ever been able to act on it. The
-- console could not say how much was owed, why the card was refused, how many
-- times Stripe had already tried, or when it would stop trying — and the
-- customer was told nothing at all until the day their access went.
--
-- That gap is the most expensive one on the platform, because a failed payment
-- is not a customer who decided to leave. It is usually an expired card. They
-- still want the product, they do not know anything is wrong, and every day
-- nobody tells them is a day closer to a cancellation that did not have to
-- happen.
--
-- Two shapes matter here, and they are different.
--
-- **An attempt is an event.** Stripe tries a card, it fails, it tries again
-- three days later. Each of those is a thing that happened at a time, and they
-- are recorded append-only, because "how many times has this card been refused"
-- cannot be answered by a column that gets overwritten.
--
-- **Whether they are still failing is a state, and it is derived.** An invoice
-- that was later paid is not an outstanding problem, and asking
-- `billing_invoices` is more reliable than a flag somebody has to remember to
-- clear. Nothing here stores "resolved".
-- =============================================================================

create table payment_failures (
  id                bigint generated always as identity primary key,
  company_id        uuid not null references companies(id) on delete cascade,
  stripe_invoice_id text not null,
  /*
   * Stripe's own attempt counter, not ours. A retry that arrives twice — which
   * webhooks do — must not read as two refusals, so the pair of invoice and
   * attempt is unique.
   */
  attempt           int not null check (attempt >= 1),
  amount_cents      int not null default 0 check (amount_cents >= 0),
  currency          char(3) not null default 'USD',
  /*
   * Why, in Stripe's words. `card_declined` and `expired_card` are the same
   * outcome and completely different conversations: one is "your bank said no",
   * the other is "you got a new card in June".
   */
  failure_code      text,
  failure_message   text,
  -- When Stripe will try again. Null means it has stopped, which is the moment
  -- somebody has to actually call.
  next_attempt_at   timestamptz,
  occurred_at       timestamptz not null default now(),
  unique (stripe_invoice_id, attempt)
);

comment on table payment_failures is
  'Each time Stripe tried to charge a card and could not. ENTITY, append-only. An attempt is an event, so it is recorded rather than counted into a column — "how many times has this been refused" cannot be answered by a number that gets overwritten. Whether the customer is still failing is derived from the invoice, never stored here.';

create index payment_failures_company on payment_failures (company_id, occurred_at desc);
create index payment_failures_invoice on payment_failures (stripe_invoice_id);

select app.apply_tenant_rls('payment_failures');
-- Written only by the webhook. A customer reads their own; nobody edits one.
drop policy if exists payment_failures_insert on payment_failures;
drop policy if exists payment_failures_update on payment_failures;
drop policy if exists payment_failures_delete on payment_failures;
create trigger payment_failures_append_only
  before update or delete on payment_failures
  for each row execute function app.forbid_mutation();

-- The read-only guard from migration 0082. Every tenant table carries it, and
-- here it costs nothing: the only writer is the webhook, which runs with no
-- signed-in user and is never blocked. Consistency is the point — a table
-- outside the guard is one nobody remembers is outside it.
select app.guard_suspension('payment_failures');

/** Record one refusal. Idempotent, because webhooks arrive more than once. */
create or replace function app.record_payment_failure(
  p_company uuid, p_invoice text, p_attempt int, p_amount_cents int,
  p_currency char(3) default 'USD', p_code text default null,
  p_message text default null, p_next_attempt timestamptz default null)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
begin
  insert into payment_failures
    (company_id, stripe_invoice_id, attempt, amount_cents, currency,
     failure_code, failure_message, next_attempt_at)
  values (p_company, p_invoice, greatest(coalesce(p_attempt, 1), 1),
          coalesce(p_amount_cents, 0), coalesce(p_currency, 'USD'),
          nullif(trim(coalesce(p_code, '')), ''),
          left(nullif(trim(coalesce(p_message, '')), ''), 500),
          p_next_attempt)
  on conflict (stripe_invoice_id, attempt) do nothing;
end;
$$;

revoke all on function app.record_payment_failure(uuid, text, int, int, char, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function app.record_payment_failure(uuid, text, int, int, char, text, text, timestamptz)
  to service_role;

create or replace function public.record_payment_failure(
  p_company uuid, p_invoice text, p_attempt int, p_amount_cents int,
  p_currency char(3) default 'USD', p_code text default null,
  p_message text default null, p_next_attempt timestamptz default null)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.record_payment_failure(p_company, p_invoice, p_attempt,
       p_amount_cents, p_currency, p_code, p_message, p_next_attempt); end; $$;

revoke all on function public.record_payment_failure(uuid, text, int, int, char, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_payment_failure(uuid, text, int, int, char, text, text, timestamptz)
  to service_role;

-- -----------------------------------------------------------------------------
-- What is still outstanding
--
-- Derived from the invoice rather than from a flag. An invoice that was later
-- paid is not a problem, and nothing has to remember to say so.
-- -----------------------------------------------------------------------------
/**
 * One definition of what is still outstanding.
 *
 * A function rather than a view read by both, for a reason worth writing down:
 * `reporting_payment_problems` is security_invoker, so an operator — who is
 * deliberately not a member of any customer company — reads nothing from it.
 * A definer view built on top of an invoker one silently applies the reader's
 * own tenant visibility and returns an empty screen that looks like good news.
 * Both views read this instead, so the customer and the operator see the same
 * facts arrived at the same way.
 */
create or replace function app.payment_problems()
returns table (
  company_id        uuid,
  stripe_invoice_id text,
  attempts          int,
  amount_cents      int,
  currency          char(3),
  first_failed_at   timestamptz,
  last_failed_at    timestamptz,
  failure_code      text,
  failure_message   text,
  next_attempt_at   timestamptz,
  stripe_gave_up    boolean,
  invoice_status    text,
  hosted_invoice_url text
)
language sql stable security definer set search_path = public, pg_catalog
as $$
  select
    f.company_id,
    f.stripe_invoice_id,
    max(f.attempt)                          as attempts,
    max(f.amount_cents)                     as amount_cents,
    max(f.currency)                         as currency,
    min(f.occurred_at)                      as first_failed_at,
    max(f.occurred_at)                      as last_failed_at,
    -- The most recent reason, which is the one worth showing.
    (array_agg(f.failure_code order by f.occurred_at desc))[1]    as failure_code,
    (array_agg(f.failure_message order by f.occurred_at desc))[1] as failure_message,
    (array_agg(f.next_attempt_at order by f.occurred_at desc))[1] as next_attempt_at,
    /*
     * Stripe has stopped trying. Not a guess: a null next attempt on the
     * latest failure is Stripe saying it has given up, and that is the moment
     * a person has to do something rather than wait.
     */
    ((array_agg(f.next_attempt_at order by f.occurred_at desc))[1] is null) as stripe_gave_up,
    i.status,
    i.hosted_invoice_url
  from payment_failures f
  left join billing_invoices i on i.stripe_invoice_id = f.stripe_invoice_id
  -- Still outstanding: paid, void and uncollectible invoices are not problems,
  -- and no flag had to be cleared for that to become true.
  where coalesce(i.status, 'open') not in ('paid', 'void', 'uncollectible')
  group by f.company_id, f.stripe_invoice_id, i.status, i.hosted_invoice_url;
$$;

grant execute on function app.payment_problems() to authenticated, service_role;

comment on function app.payment_problems() is
  'Invoices a company has failed to pay and has not since paid. Outstanding is derived from the invoice rather than from a flag nobody has to remember to clear. The single definition behind both the customer''s view and the operator''s, so the two cannot drift.';

create or replace view reporting_payment_problems
with (security_invoker = true) as
select p.*
from companies c
cross join lateral app.payment_problems() p
where p.company_id = c.id;

comment on view reporting_payment_problems is
  'A company''s own outstanding payments. Which rows come back is decided by RLS on `companies`, so a member sees theirs and nobody else''s.';

grant select on reporting_payment_problems to authenticated;
revoke all on reporting_payment_problems from anon;

create or replace view admin_failing_payments as
select
  p.company_id,
  c.name                                  as company_name,
  p.stripe_invoice_id,
  p.attempts,
  p.amount_cents,
  p.currency,
  p.failure_code,
  p.failure_message,
  p.first_failed_at,
  p.last_failed_at,
  p.next_attempt_at,
  p.stripe_gave_up,
  p.hosted_invoice_url,
  s.status                                as subscription_status,
  s.current_period_end                    as access_until,
  app.billable_seats(p.company_id)        as seats,
  up.email                                as owner_email,
  -- How long this has been going on. The number that turns a list into an
  -- order of who to call first.
  round(extract(epoch from (now() - p.first_failed_at)) / 86400.0)::int as days_failing
from app.payment_problems() p
join companies c on c.id = p.company_id
left join lateral (
  select st.status, st.current_period_end from subscriptions st
  where st.company_id = p.company_id
  order by st.created_at desc limit 1
) s on true
left join lateral (
  select min(pr.email) as email from company_memberships m
  join user_profiles pr on pr.id = m.user_id
  where m.company_id = p.company_id and m.is_owner and m.status = 'active'
) up on true
where app.operator_can('billing.read')
order by p.stripe_gave_up desc, p.first_failed_at;

comment on view admin_failing_payments is
  'Customers whose card is being refused, why, how long it has been going on, and whether Stripe has given up trying. Usually an expired card rather than a decision to leave — which is why the list is ordered by how long it has been failing rather than by how much it is worth.';

grant select on admin_failing_payments to authenticated;
revoke all on admin_failing_payments from anon;

/**
 * The customer's own view of it.
 *
 * They are told before their access goes, not on the day it does. Somebody
 * whose card expired in June does not know anything is wrong, and every day
 * nobody says so is a day closer to a cancellation that did not have to happen.
 */
create or replace view my_payment_problem
with (security_invoker = true) as
select
  p.company_id,
  p.stripe_invoice_id,
  p.amount_cents,
  p.currency,
  p.attempts,
  p.next_attempt_at,
  p.stripe_gave_up,
  p.hosted_invoice_url,
  /*
   * Stripe's decline codes are not a sentence to show a customer. These three
   * cover almost every real case and each says what to actually do; anything
   * else falls back to the general instruction rather than to jargon.
   */
  case p.failure_code
    when 'expired_card'        then 'The card on file has expired.'
    when 'insufficient_funds'  then 'The payment was declined for insufficient funds.'
    when 'card_declined'       then 'The bank declined the payment.'
    else 'The payment did not go through.'
  end                                     as what_happened
from reporting_payment_problems p;

comment on view my_payment_problem is
  'A company''s own outstanding payment, in words rather than in Stripe decline codes. Shown in the application before access is affected, because a failed payment is usually an expired card and the customer does not know.';

grant select on my_payment_problem to authenticated;
revoke all on my_payment_problem from anon;

select app.assert_security_gates();
