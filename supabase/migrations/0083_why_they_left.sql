-- =============================================================================
-- 0083 — Why they left
--
-- The platform could count cancellations. It could not say why any of them
-- happened, and that is the one number in a subscription business you cannot
-- go back for: a customer who left in March will not answer the question in
-- June, and the free-text comment the cancel screen already sent to Stripe was
-- unreadable from GrounUp and unaggregatable anywhere.
--
-- Three things this file is careful about.
--
-- **What they were worth is captured at the moment, not derived later.** Seats
-- and monthly value are a *level*: once the subscription ends, its items go and
-- `app.subscription_monthly_cents` correctly returns nothing. Reconstructing
-- "what were they paying when they left" after the fact is guesswork, so it is
-- written down while it is still true. This is the same distinction migration
-- 0069 drew between AI credits, which are a flow, and storage, which is not.
--
-- **"We never asked" is a recorded answer, not a missing one.** A cancellation
-- that arrives through a Stripe webhook — the customer clicked cancel in
-- Stripe's own portal, or a card finally failed — has no reason attached, and
-- the reason is genuinely unknown. Filing those under "other" would put a
-- number next to a thing nobody said. They are counted separately, and the
-- proportion of them is itself the useful figure: it says how often the
-- question is reaching anybody.
--
-- **A reason is a library, not free text.** Free text cannot be counted, and a
-- list of seventy unique sentences is a list nobody reads twice. The detail
-- box stays, beside a key.
-- =============================================================================

create table cancellation_reasons (
  key          text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label        text not null,
  description  text not null,
  -- Whether picking this one without saying more is useless. "Something else"
  -- is worthless without the something.
  needs_detail boolean not null default false,
  is_active    boolean not null default true,
  sort_order   int not null default 0
);

comment on table cancellation_reasons is
  'The reasons a customer can give for leaving. LIBRARY. A list rather than free text, because free text cannot be counted and seventy unique sentences is a report nobody reads twice — the detail box sits beside the key rather than instead of it.';

alter table cancellation_reasons enable row level security;
alter table cancellation_reasons force row level security;
-- The list is shown on the customer's own cancel screen, so anybody signed in
-- may read it. Nobody may write one outside a migration.
create policy cancellation_reasons_select on cancellation_reasons for select to authenticated
  using (is_active);
grant select on cancellation_reasons to authenticated;
revoke all on cancellation_reasons from anon;

insert into cancellation_reasons (key, label, description, needs_detail, sort_order) values
  ('too_expensive',   'It costs too much',
   'The price, rather than the product. Distinct from not getting value out of it, which is a different problem with a different fix.', false, 10),
  ('missing_feature', 'It does not do something we need',
   'The single most actionable reason there is, and worthless without the detail.', true, 20),
  ('switched',        'We moved to something else',
   'Which one matters. Losing to the same competitor twice is a pattern.', true, 30),
  ('not_using_it',    'We are not using it',
   'Bought and never adopted. Usually an onboarding failure rather than a product one.', false, 40),
  ('too_hard',        'It was too hard to use',
   'They tried and it did not stick.', false, 50),
  ('work_dried_up',   'The work stopped',
   'Seasonal, or the business shrank. Not a complaint, and often a customer who comes back.', false, 60),
  ('closed_business', 'We closed the business',
   'Nothing to fix. Worth separating so it does not inflate the reasons that are fixable.', false, 70),
  ('other',           'Something else',
   'Kept last and requiring detail, so it is a place for the genuinely unusual rather than the default nobody thought about.', true, 90)
on conflict (key) do update set
  label = excluded.label, description = excluded.description,
  needs_detail = excluded.needs_detail, sort_order = excluded.sort_order;

drop trigger if exists cancellation_reasons_frozen on cancellation_reasons;
create trigger cancellation_reasons_frozen
  before insert or update or delete on cancellation_reasons
  for each row execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- The cancellation itself
-- -----------------------------------------------------------------------------
create table cancellations (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  subscription_id   uuid references subscriptions(id) on delete set null,
  stripe_subscription_id text,

  /*
   * Null means nobody was asked — a cancellation that arrived through a Stripe
   * webhook rather than through the product. Deliberately not defaulted to
   * 'other': "we do not know" and "they said something unusual" are different
   * facts, and conflating them puts a number beside a thing nobody said.
   */
  reason_key        text references cancellation_reasons(key) on delete restrict,
  detail            text check (detail is null or length(detail) <= 2000),
  -- Named when they said they were switching. Losing to the same one twice is
  -- a pattern; losing to it five times is a decision somebody has to make.
  competitor        text check (competitor is null or length(competitor) <= 200),
  would_return      boolean,

  /*
   * What they were worth, written down while it is still true. After the
   * subscription ends its items are gone and the figure cannot be recovered,
   * so this is captured rather than derived — the one place in this schema
   * where storing a computed number is the correct choice.
   */
  seats_at_cancellation   int check (seats_at_cancellation is null or seats_at_cancellation >= 0),
  monthly_cents_at_cancellation bigint
    check (monthly_cents_at_cancellation is null or monthly_cents_at_cancellation >= 0),
  plan_id           text references plans(id) on delete set null,
  months_as_a_customer numeric(6,1),

  immediate         boolean not null default false,
  source            text not null default 'customer'
                      check (source in ('customer', 'operator', 'stripe')),
  canceled_by       uuid references auth.users(id) on delete set null,
  occurred_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),

  constraint cancellations_detail_when_needed check (
    reason_key is null or reason_key not in ('missing_feature', 'switched', 'other')
    or (detail is not null and length(trim(detail)) >= 3)
  )
);

comment on table cancellations is
  'Why a customer left, and what they were worth when they did. ENTITY, append-only. The value is captured rather than derived because a subscription''s items are gone once it ends — this is the one place in the schema where storing a computed number is right. A null reason means nobody was asked, which is a recorded answer and not a missing one.';

comment on column cancellations.reason_key is
  'Null means the cancellation arrived through Stripe rather than through the product, so nobody was asked. Not defaulted to "other": "we do not know" and "they said something unusual" are different facts.';

create index if not exists cancellations_company on cancellations (company_id, occurred_at desc);
create index if not exists cancellations_when on cancellations (occurred_at desc);
create unique index if not exists cancellations_one_per_subscription
  on cancellations (stripe_subscription_id) where stripe_subscription_id is not null;

select app.apply_tenant_rls('cancellations');
-- Recorded once and never rewritten: a reason edited after the fact is not
-- what the customer said.
drop policy if exists cancellations_insert on cancellations;
drop policy if exists cancellations_update on cancellations;
drop policy if exists cancellations_delete on cancellations;
drop trigger if exists cancellations_append_only on cancellations;
create trigger cancellations_append_only
  before update or delete on cancellations
  for each row execute function app.forbid_mutation();

/**
 * Record why a customer is leaving.
 *
 * Called before the subscription is actually canceled, so the seats and the
 * monthly value are still readable. Idempotent per Stripe subscription: the
 * webhook that follows a customer's own cancellation must not file a second,
 * reasonless copy over the one they gave a reason for.
 */
create or replace function app.record_cancellation(
  p_company uuid,
  p_reason text default null,
  p_detail text default null,
  p_competitor text default null,
  p_would_return boolean default null,
  p_immediate boolean default false,
  p_source text default 'customer')
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_sub    subscriptions%rowtype;
  v_id     uuid;
  v_since  timestamptz;
begin
  if p_source not in ('customer', 'operator', 'stripe') then
    raise exception 'A cancellation comes from the customer, an operator or Stripe'
      using errcode = 'check_violation';
  end if;
  /*
   * A person recording one must be able to manage the company's billing. The
   * webhook path runs as service_role, where auth.uid() is null and there is
   * nobody to check — that call is trusted because only Stripe reaches it.
   */
  if auth.uid() is not null
     and not app.has_permission(p_company, 'billing.manage')
     and not app.operator_can('companies.manage') then
    raise exception 'You do not have permission to cancel this subscription'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_sub from subscriptions s
  where s.company_id = p_company
  order by case when s.status in ('trialing','active','past_due','paused') then 0 else 1 end,
           s.created_at desc
  limit 1;

  -- Already recorded, with or without a reason. The first one wins, because
  -- the first is the one somebody actually answered.
  if v_sub.stripe_subscription_id is not null
     and exists (select 1 from cancellations c
                  where c.stripe_subscription_id = v_sub.stripe_subscription_id) then
    select id into v_id from cancellations
     where stripe_subscription_id = v_sub.stripe_subscription_id;
    return v_id;
  end if;

  select min(created_at) into v_since from companies where id = p_company;

  insert into cancellations (
    company_id, subscription_id, stripe_subscription_id,
    reason_key, detail, competitor, would_return,
    seats_at_cancellation, monthly_cents_at_cancellation, plan_id,
    months_as_a_customer, immediate, source, canceled_by)
  values (
    p_company, v_sub.id, v_sub.stripe_subscription_id,
    nullif(trim(coalesce(p_reason, '')), ''),
    nullif(trim(coalesce(p_detail, '')), ''),
    nullif(trim(coalesce(p_competitor, '')), ''),
    p_would_return,
    app.billable_seats(p_company),
    case when v_sub.id is not null then app.subscription_monthly_cents(v_sub.id) end,
    v_sub.plan_id,
    case when v_since is not null
         then round(extract(epoch from (now() - v_since)) / 2629800.0, 1) end,
    coalesce(p_immediate, false), p_source, auth.uid())
  returning id into v_id;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (p_company, auth.uid(), 'insert', 'public.cancellations', v_id::text,
          jsonb_build_object('reason', p_reason, 'source', p_source,
                             'immediate', coalesce(p_immediate, false)),
          coalesce(nullif(trim(coalesce(p_detail, '')), ''),
                   'Subscription canceled'));
  return v_id;
end;
$$;

revoke all on function app.record_cancellation(uuid, text, text, text, boolean, boolean, text)
  from public, anon;
grant execute on function app.record_cancellation(uuid, text, text, text, boolean, boolean, text)
  to authenticated, service_role;

create or replace function public.record_cancellation(
  p_company uuid, p_reason text default null, p_detail text default null,
  p_competitor text default null, p_would_return boolean default null,
  p_immediate boolean default false, p_source text default 'customer')
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin return app.record_cancellation(p_company, p_reason, p_detail, p_competitor,
       p_would_return, p_immediate, p_source); end; $$;

revoke all on function public.record_cancellation(uuid, text, text, text, boolean, boolean, text)
  from public, anon;
grant execute on function public.record_cancellation(uuid, text, text, text, boolean, boolean, text)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Reading it
-- -----------------------------------------------------------------------------
create or replace view admin_churn_reasons as
select
  coalesce(c.reason_key, 'not_asked')     as reason_key,
  coalesce(r.label, 'Nobody was asked')   as label,
  count(*)                                as customers,
  coalesce(sum(c.monthly_cents_at_cancellation), 0) as monthly_cents_lost,
  coalesce(sum(c.seats_at_cancellation), 0) as seats_lost,
  round(avg(c.months_as_a_customer), 1)   as average_months,
  count(*) filter (where c.would_return)  as would_come_back,
  -- The competitors named, so losing to the same one twice reads as a pattern
  -- rather than as two separate bad days.
  array_remove(array_agg(distinct c.competitor), null) as competitors
from cancellations c
left join cancellation_reasons r on r.key = c.reason_key
where c.occurred_at > now() - interval '12 months'
  and app.operator_can('billing.read')
group by 1, 2
order by 3 desc;

comment on view admin_churn_reasons is
  'Why customers left over twelve months, what it cost, and how long they stayed first. "Nobody was asked" is a row rather than an omission — how often it appears says how often the question is reaching anybody.';

grant select on admin_churn_reasons to authenticated;
revoke all on admin_churn_reasons from anon;

create or replace view admin_churn_by_month as
select
  m.month,
  coalesce(x.customers, 0)          as customers_lost,
  coalesce(x.monthly_cents_lost, 0) as monthly_cents_lost,
  coalesce(x.asked, 0)              as gave_a_reason,
  coalesce(g.gained, 0)             as customers_gained
from (
  select generate_series(date_trunc('month', now()) - interval '11 months',
                         date_trunc('month', now()), interval '1 month') as month
) m
left join lateral (
  select count(*) as customers,
         sum(c.monthly_cents_at_cancellation) as monthly_cents_lost,
         count(*) filter (where c.reason_key is not null) as asked
  from cancellations c where date_trunc('month', c.occurred_at) = m.month
) x on true
left join lateral (
  select count(*) as gained from subscriptions s
  where date_trunc('month', s.created_at) = m.month
    and s.status in ('trialing', 'active')
) g on true
where app.operator_can('billing.read')
order by m.month desc;

comment on view admin_churn_by_month is
  'Customers lost and gained by month, with what the losses were worth and how many of them said why. Gained beside lost because either number alone is half a sentence.';

grant select on admin_churn_by_month to authenticated;
revoke all on admin_churn_by_month from anon;

create or replace view admin_cancellations as
select
  c.id, c.company_id, co.name as company_name,
  c.reason_key, r.label as reason_label, c.detail, c.competitor, c.would_return,
  c.seats_at_cancellation, c.monthly_cents_at_cancellation,
  c.months_as_a_customer, c.plan_id, c.immediate, c.source, c.occurred_at,
  -- Whether they came back, which turns a list of losses into a list of
  -- customers who might again.
  exists (select 1 from subscriptions s
           where s.company_id = c.company_id
             and s.status in ('trialing', 'active')
             and s.created_at > c.occurred_at) as came_back
from cancellations c
join companies co on co.id = c.company_id
left join cancellation_reasons r on r.key = c.reason_key
where app.operator_can('billing.read')
order by c.occurred_at desc
limit 200;

comment on view admin_cancellations is
  'Every cancellation with what they said and what they were worth, and whether they have since come back.';

grant select on admin_cancellations to authenticated;
revoke all on admin_cancellations from anon;

/*
 * Deliberately outside the suspension guard migration 0082 put on every other
 * tenant table.
 *
 * A suspended company is usually a company that stopped paying, and a company
 * that stopped paying is exactly the one that wants to cancel. Refusing the
 * write here would trap them in a subscription they are being told to pay for
 * and cannot end — and the reason they gave is the thing this file exists to
 * collect, so it is the last write that should be blocked. The row is
 * append-only either way, so nothing can be rewritten under a suspension.
 */
drop trigger if exists cancellations_suspension on cancellations;

select app.assert_security_gates();
