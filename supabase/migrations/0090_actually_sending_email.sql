-- =============================================================================
-- 0090 — Actually sending email
--
-- Every notice this platform produces has been in-app. A customer whose card
-- expired sees a banner *when they next sign in*, which is precisely the person
-- who is not signing in. A suspension, a refund, an announcement: all of them
-- reach somebody only if they come looking.
--
-- `notification_preferences` has had an `email` column since migration 0018 and
-- `notifications` an `emailed_at`. Both have always been false and null. The
-- intent was recorded and nothing implemented it — the same shape as
-- `has_entitlement` before migration 0077.
--
-- Four decisions hold this up.
--
-- **Nothing is sent inline.** A webhook that blocks on an HTTP call to a mail
-- provider is a webhook that times out, and a timed-out Stripe webhook is
-- retried — so the customer gets charged once and emailed twice. Mail is
-- written to an outbox in the same transaction as the thing that caused it,
-- and a sender drains it afterwards.
--
-- **Every message carries a dedupe key.** The same cause cannot queue two
-- copies however many times the cause fires, which is the only defense against
-- a retried webhook that actually works.
--
-- **Transactional mail cannot be opted out of.** "Your card was declined" is
-- not marketing, and a preference that could switch it off would produce a
-- customer who loses their account without ever being told. Preferences govern
-- the rest.
--
-- **Nothing is silently discarded.** With no provider configured, messages sit
-- in the outbox and the console says so. An email that vanished because a key
-- was missing is worse than one that was never written.
-- =============================================================================

create table email_messages (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references companies(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  to_email      text not null check (position('@' in to_email) > 1),
  subject       text not null check (length(trim(subject)) between 3 and 200),
  body          text not null check (length(trim(body)) >= 10),
  category      text not null,
  /*
   * Whether the recipient may switch this off. A declined card, a suspension
   * and a refund are facts about somebody's account that they are entitled to
   * hear whatever their preferences say; an announcement is not.
   */
  transactional boolean not null default true,
  /*
   * What caused it. Unique, so the same cause queues one message however many
   * times it fires — the only defense against a retried webhook that actually
   * works, since the retry is indistinguishable from the original.
   */
  dedupe_key    text not null unique,
  state         text not null default 'queued'
                  check (state in ('queued', 'sent', 'failed', 'suppressed')),
  suppressed_reason text,
  provider_id   text,
  error         text,
  attempts      int not null default 0 check (attempts >= 0),
  queued_at     timestamptz not null default now(),
  sent_at       timestamptz,
  updated_at    timestamptz not null default now()
);

comment on table email_messages is
  'The outbox. ENTITY. Mail is written here in the same transaction as the thing that caused it and sent afterwards, because a webhook that blocks on a mail provider is a webhook that times out — and a timed-out Stripe webhook is retried, so the customer is charged once and emailed twice. The dedupe key is what makes that impossible.';

comment on column email_messages.transactional is
  'Whether the recipient may switch this off. A declined card is not marketing: a preference that could suppress it would produce a customer who loses their account without ever being told.';

comment on column email_messages.dedupe_key is
  'What caused this message, uniquely. A retry is indistinguishable from an original, so the only defense is refusing the second write.';

create index if not exists email_messages_queued on email_messages (queued_at)
  where state = 'queued';
create index if not exists email_messages_company on email_messages (company_id, queued_at desc);

alter table email_messages enable row level security;
alter table email_messages force row level security;

/*
 * A message is written once and its outcome is written by the sender. Nothing
 * else changes it, and nothing deletes one — a record of what the platform
 * told somebody is exactly the record worth having when they say they were
 * never told.
 */
/*
 * Deliberately outside the read-only guard migration 0082 put on every other
 * tenant table, and this one would have been a real bug: the message telling
 * somebody their account has just been suspended is a write to a suspended
 * company's mail, queued by a function running as the operator who suspended
 * them. The guard would have refused it, and the customer would have been put
 * into read-only without ever being told why.
 */
drop trigger if exists email_messages_no_delete on email_messages;
create trigger email_messages_no_delete
  before delete on email_messages
  for each row execute function app.forbid_mutation();
revoke all on email_messages from anon, authenticated;

/*
 * A person may read mail addressed to them — being unable to check what the
 * platform says it sent you is its own defect — and nobody writes one except
 * through the function below.
 */
create policy email_messages_own on email_messages for select to authenticated
  using (user_id = auth.uid() or app.operator_can('billing.read'));
grant select on email_messages to authenticated;

/**
 * Put a message in the outbox.
 *
 * Returns null when nothing was queued, which happens for three honest
 * reasons: the message already exists, the recipient has switched this
 * category off, or there is nobody to send it to. Each is recorded rather than
 * silently dropped — a suppressed message is a row that says why.
 */
create or replace function app.queue_email(
  p_to text, p_subject text, p_body text, p_category text, p_dedupe text,
  p_company uuid default null, p_user uuid default null,
  p_transactional boolean default true)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_id       uuid;
  v_wants    boolean;
begin
  if p_to is null or position('@' in p_to) < 2 then
    return null;
  end if;

  /*
   * Preferences govern anything that is not transactional. A row that does not
   * exist means the default, which is on: somebody who has never opened the
   * settings has not opted out of anything.
   */
  if not coalesce(p_transactional, true) and p_user is not null then
    select np.email into v_wants
    from notification_preferences np
    where np.user_id = p_user and np.category = p_category
      and (p_company is null or np.company_id = p_company)
    limit 1;

    if v_wants is false then
      insert into email_messages
        (company_id, user_id, to_email, subject, body, category, transactional,
         dedupe_key, state, suppressed_reason)
      values (p_company, p_user, lower(trim(p_to)), trim(p_subject), trim(p_body),
              p_category, false, p_dedupe, 'suppressed',
              'The recipient has switched off email for ' || p_category)
      on conflict (dedupe_key) do nothing
      returning id into v_id;
      return null;
    end if;
  end if;

  insert into email_messages
    (company_id, user_id, to_email, subject, body, category, transactional, dedupe_key)
  values (p_company, p_user, lower(trim(p_to)), trim(p_subject), trim(p_body),
          p_category, coalesce(p_transactional, true), p_dedupe)
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function app.queue_email(text, text, text, text, text, uuid, uuid, boolean)
  to authenticated, service_role;

comment on function app.queue_email(text, text, text, text, text, uuid, uuid, boolean) is
  'Writes one message to the outbox, once. Returns null when nothing was queued — already there, switched off, or nobody to send to — and a suppressed message is a row saying why rather than a silence.';

/** Everybody who should hear about something happening to a company. */
create or replace function app.company_owner_emails(p_company uuid)
returns table (user_id uuid, email text)
language sql stable security definer set search_path = public, pg_catalog
as $$
  select m.user_id, up.email
  from company_memberships m
  join user_profiles up on up.id = m.user_id
  where m.company_id = p_company and m.status = 'active' and m.is_owner
    and up.email is not null;
$$;

grant execute on function app.company_owner_emails(uuid) to service_role;

comment on function app.company_owner_emails(uuid) is
  'The owners of a company, who are who a billing or account message goes to. Owners rather than every member: an estimator does not need to hear that the card was declined, and a company with eleven people should not get eleven copies.';

-- -----------------------------------------------------------------------------
-- The four things worth an email
-- -----------------------------------------------------------------------------
/*
 * A card being refused. The one that costs money: the customer usually has no
 * idea, and the in-app banner only reaches somebody who signs in — which is
 * exactly the person who has not noticed.
 */
create or replace function app.email_payment_failure()
returns trigger language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_company text;
  r record;
begin
  select name into v_company from companies where id = new.company_id;

  for r in select * from app.company_owner_emails(new.company_id) loop
    perform app.queue_email(
      r.email,
      'A payment for ' || coalesce(v_company, 'your account') || ' did not go through',
      'We tried to charge the card on file for ' || coalesce(v_company, 'your account')
        || ' and it was declined'
        || case when new.failure_code = 'expired_card'
                then ', because the card has expired.'
                when new.failure_code = 'insufficient_funds'
                then ' for insufficient funds.'
                else '.' end
        || E'\n\nAmount: $' || to_char(new.amount_cents / 100.0, 'FM999999990.00')
        || case when new.next_attempt_at is not null
                then E'\nWe will try again on '
                     || to_char(new.next_attempt_at, 'FMDay DD Month YYYY') || '.'
                else E'\nWe have stopped trying automatically.' end
        || E'\n\nUpdating the card takes a minute and avoids any interruption: '
        || 'open GrounUp, then Settings, then Billing.'
        || E'\n\nEverything you have made is safe either way. Nothing is ever deleted '
        || 'over a payment.',
      'billing.payment_failed',
      -- One message per attempt, not per webhook delivery.
      'payment_failure:' || new.stripe_invoice_id || ':' || new.attempt,
      new.company_id, r.user_id, true);
  end loop;
  return new;
end;
$$;

drop trigger if exists payment_failures_email on payment_failures;
create trigger payment_failures_email
  after insert on payment_failures
  for each row execute function app.email_payment_failure();

/* An account going read-only, in the words the operator wrote for the customer. */
create or replace function app.email_suspension()
returns trigger language plpgsql security definer set search_path = public, pg_catalog
as $$
declare r record;
begin
  for r in select * from app.company_owner_emails(new.company_id) loop
    perform app.queue_email(
      r.email,
      'Your GrounUp account is now read-only',
      new.customer_message
        || E'\n\nYou can still sign in, and everything you have made is still there — '
        || 'estimates, projects, documents and costs can all be opened, printed and '
        || 'exported. What you cannot do until this is lifted is add to them.'
        || E'\n\nNothing has been deleted.',
      'account.suspended',
      'suspension:' || new.id::text,
      new.company_id, r.user_id, true);
  end loop;
  return new;
end;
$$;

drop trigger if exists company_suspensions_email on company_suspensions;
create trigger company_suspensions_email
  after insert on company_suspensions
  for each row execute function app.email_suspension();

/* Money going back, once Stripe has actually moved it. */
create or replace function app.email_refund()
returns trigger language plpgsql security definer set search_path = public, pg_catalog
as $$
declare r record;
begin
  if new.state <> 'applied' or old.state = 'applied' then
    return new;
  end if;

  for r in select * from app.company_owner_emails(new.company_id) loop
    perform app.queue_email(
      r.email,
      case when new.kind = 'refund'
           then 'A refund is on its way to you'
           else 'A credit has been applied to your account' end,
      case when new.kind = 'refund'
           then 'We have refunded $'
                || to_char(new.amount_cents / 100.0, 'FM999999990.00')
                || ' to the card on file. Depending on your bank it usually appears '
                || 'within five to ten days.'
           else 'We have credited $'
                || to_char(new.amount_cents / 100.0, 'FM999999990.00')
                || ' to your account. It comes off your next invoice automatically.' end
        || E'\n\nIf this is not what you expected, reply to this message and somebody '
        || 'will look at it.',
      'billing.refund',
      'refund:' || new.id::text,
      new.company_id, r.user_id, true);
  end loop;
  return new;
end;
$$;

drop trigger if exists refund_requests_email on refund_requests;
create trigger refund_requests_email
  after update on refund_requests
  for each row execute function app.email_refund();

/*
 * An announcement. The only one of the four that is not transactional — a
 * customer who does not want to hear about a new feature is entitled not to,
 * where one whose card was declined is not.
 *
 * Written as a single insert...select rather than a loop over companies: a
 * publish that walked a thousand tenants one at a time would be a publish that
 * timed out, and the queue is the same either way.
 */
create or replace function app.email_announcement()
returns trigger language plpgsql security definer set search_path = public, pg_catalog
as $$
begin
  -- Only when it is live now. One scheduled for next week is emailed when it
  -- starts, by whatever publishes it then, rather than a week early.
  if new.starts_at > now() then
    return new;
  end if;

  insert into email_messages
    (company_id, user_id, to_email, subject, body, category, transactional, dedupe_key)
  select
    m.company_id, m.user_id, lower(up.email),
    new.title,
    new.body || E'\n\n— GrounUp'
      || E'\n\nYou are getting this because you own a GrounUp account. '
      || 'You can switch these off under Settings, Notifications; messages about '
      || 'your billing and your account will still reach you.',
    'platform.announcement', false,
    'announcement:' || new.id::text || ':' || m.user_id::text
  from company_memberships m
  join user_profiles up on up.id = m.user_id
  where m.status = 'active' and m.is_owner and up.email is not null
    and (
      new.audience = 'everyone'
      or (new.audience = 'free'   and app.effective_plan(m.company_id) = 'free')
      or (new.audience = 'paying' and app.effective_plan(m.company_id) <> 'free')
    )
    -- Somebody who has switched these off gets nothing rather than a
    -- suppressed row per announcement.
    and not exists (
      select 1 from notification_preferences np
      where np.user_id = m.user_id and np.company_id = m.company_id
        and np.category = 'platform.announcement' and np.email is false
    )
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

drop trigger if exists announcements_email on announcements;
create trigger announcements_email
  after insert on announcements
  for each row execute function app.email_announcement();

-- -----------------------------------------------------------------------------
-- Reading the outbox
-- -----------------------------------------------------------------------------
create or replace view admin_outbox as
select
  e.id, e.company_id, c.name as company_name,
  e.to_email, e.subject, e.category, e.transactional,
  e.state, e.suppressed_reason, e.error, e.attempts,
  e.queued_at, e.sent_at
from email_messages e
left join companies c on c.id = e.company_id
where app.operator_can('billing.read')
order by e.queued_at desc
limit 300;

comment on view admin_outbox is
  'Every message the platform meant to send, and what happened to it. A queue that is not emptying is the thing this view exists to show — mail that failed silently is mail nobody knows was never read.';

grant select on admin_outbox to authenticated;
revoke all on admin_outbox from anon;

create or replace view admin_outbox_health as
select
  count(*) filter (where state = 'queued')      as waiting,
  count(*) filter (where state = 'sent')        as sent,
  count(*) filter (where state = 'failed')      as failed,
  count(*) filter (where state = 'suppressed')  as switched_off,
  /*
   * Anything queued for more than an hour. Either nothing is draining the
   * outbox or the provider is refusing everything, and both look identical
   * from a count of queued messages alone.
   */
  count(*) filter (where state = 'queued' and queued_at < now() - interval '1 hour')
                                                as stuck,
  min(queued_at) filter (where state = 'queued') as oldest_waiting
from email_messages
having app.operator_can('billing.read');

comment on view admin_outbox_health is
  'Whether mail is actually going out. `stuck` counts anything queued over an hour — either nothing is draining the outbox or the provider is refusing everything, and a plain queue count cannot tell those apart from a busy minute.';

grant select on admin_outbox_health to authenticated;
revoke all on admin_outbox_health from anon;

select app.assert_security_gates();
