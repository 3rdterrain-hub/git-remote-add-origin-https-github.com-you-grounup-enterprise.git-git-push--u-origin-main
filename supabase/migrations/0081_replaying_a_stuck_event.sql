-- =============================================================================
-- 0081 — Replaying an event that never landed
--
-- The console has shown stuck Stripe events since migration 0064, under a
-- banner that says what one means: a customer who paid and cannot use what
-- they paid for. It has never offered a way to fix one. The instruction in the
-- webhook function was "replay it from the Stripe dashboard" — which works,
-- and which means the person holding the support ticket needs a Stripe login,
-- which support staff should not have.
--
-- A replay is safe for a reason worth stating plainly: `stripe_events` only
-- ever receives a payload whose signature was verified on arrival. Replaying
-- one is replaying something Stripe demonstrably sent. Nothing here accepts a
-- payload from anybody — it can only re-apply a row that is already stored.
--
-- The applying itself is done by the same `handleEvent` the live webhook uses,
-- moved into `_shared/stripe-events.ts` rather than reimplemented. A second
-- implementation would diverge, and it would diverge only on the events that
-- had already failed once.
-- =============================================================================

-- Adding a permission is a migration, which is why the catalog is frozen: the
-- trigger comes off, the row goes in, the trigger goes back on.
drop trigger if exists platform_permissions_frozen on platform_permissions;

insert into platform_permissions (key, label, description, is_powerful, sort_order) values
  ('webhooks.retry', 'Replay a failed Stripe event',
   'Re-apply a payment message that arrived and never finished. The usual answer to "I paid and nothing happened".',
   true, 35)
on conflict (key) do update set
  label = excluded.label, description = excluded.description,
  is_powerful = excluded.is_powerful, sort_order = excluded.sort_order;

create trigger platform_permissions_frozen
  before insert or update or delete on platform_permissions
  for each row execute function app.forbid_mutation();

/*
 * Support holds it, because support is who fields the ticket. Account managers
 * do not: they are on the commercial side of the same customer, and the person
 * closing a renewal should not also be the person who can re-apply a payment.
 */
update platform_roles
   set permissions = permissions || array['webhooks.retry']
 where key = 'support' and not permissions @> array['webhooks.retry'];

-- -----------------------------------------------------------------------------
-- Recording that somebody asked for one
--
-- The replay itself happens in an Edge Function, because applying an event
-- needs Stripe's API for a checkout session and the database cannot call it.
-- What lives here is the request and the outcome, so a replay is as answerable
-- as everything else an operator does.
-- -----------------------------------------------------------------------------
create table stripe_event_replays (
  id           uuid primary key default gen_random_uuid(),
  event_id     text not null references stripe_events(id) on delete cascade,
  operator_id  uuid not null references auth.users(id) on delete set null,
  reason       text not null check (length(trim(reason)) >= 5),
  outcome      text not null default 'requested'
                 check (outcome in ('requested', 'applied', 'failed')),
  error        text,
  requested_at timestamptz not null default now(),
  finished_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table stripe_event_replays is
  'Somebody asking for a failed Stripe event to be applied again, and what happened. ENTITY. A replay changes a customer''s subscription and entitlement, so who asked, why, and whether it worked are all recorded — the same standard every other operator action is held to.';

create index stripe_event_replays_event on stripe_event_replays (event_id, requested_at desc);

alter table stripe_event_replays enable row level security;
alter table stripe_event_replays force row level security;
revoke all on stripe_event_replays from anon, authenticated;

create policy stripe_event_replays_select on stripe_event_replays for select to authenticated
  using (app.operator_can('webhooks.retry'));
grant select on stripe_event_replays to authenticated;

select app.attach_standard_triggers('public.stripe_event_replays'::regclass);

/**
 * Claim a stuck event for replay.
 *
 * Returns the stored payload to the caller — which is the Edge Function
 * running as service_role — so the replay applies exactly what Stripe sent
 * rather than anything the caller supplies. An event that already finished is
 * refused: re-applying a processed event is how a canceled subscription comes
 * back to life.
 */
create or replace function app.claim_event_replay(p_event text, p_reason text)
returns table (replay_id uuid, event_type text, payload jsonb)
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_state text;
  v_id    uuid;
begin
  if not app.operator_can('webhooks.retry') then
    raise exception 'You do not have permission to replay a payment event'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'Say why this is being replayed' using errcode = 'check_violation';
  end if;

  select e.processing_state into v_state from stripe_events e where e.id = p_event;
  if v_state is null then
    raise exception 'No stored event with id %', p_event using errcode = 'no_data_found';
  end if;
  /*
   * Only what never finished. `processed` and `ignored` both mean the platform
   * is already in the state this event describes, and applying it again would
   * write an old subscription over a newer one.
   */
  if v_state not in ('received', 'failed') then
    raise exception 'Event % is already %; there is nothing to replay', p_event, v_state
      using errcode = 'check_violation';
  end if;

  insert into stripe_event_replays (event_id, operator_id, reason)
  values (p_event, auth.uid(), trim(p_reason))
  returning id into v_id;

  return query
    select v_id, e.type, e.payload from stripe_events e where e.id = p_event;
end;
$$;

/** Record how it went, and move the event with it. */
create or replace function app.finish_event_replay(
  p_replay uuid, p_applied boolean, p_error text default null)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_event text;
begin
  select event_id into v_event from stripe_event_replays where id = p_replay;
  if v_event is null then
    raise exception 'No replay %', p_replay using errcode = 'no_data_found';
  end if;

  update stripe_event_replays
     set outcome = case when p_applied then 'applied' else 'failed' end,
         error = case when p_applied then null else left(coalesce(p_error, 'Unknown'), 2000) end,
         finished_at = now(), updated_at = now()
   where id = p_replay;

  update stripe_events
     set processing_state = case when p_applied then 'processed' else 'failed' end,
         processed_at = case when p_applied then now() end,
         processing_error = case when p_applied then null
                                 else left(coalesce(p_error, 'Replay failed'), 2000) end,
         attempts = attempts + 1
   where id = v_event;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  select se.company_id, r.operator_id, 'update', 'public.stripe_events', v_event,
         jsonb_build_object('replayed', true, 'applied', p_applied),
         'Payment event replayed from the operator console: ' || r.reason
  from stripe_event_replays r
  join stripe_events se on se.id = r.event_id
  where r.id = p_replay;
end;
$$;

-- Only the Edge Function running as service_role finishes a replay; an operator
-- asking for one must not also be able to declare it successful.
revoke all on function app.finish_event_replay(uuid, boolean, text) from public, anon, authenticated;
grant execute on function app.finish_event_replay(uuid, boolean, text) to service_role;

revoke all on function app.claim_event_replay(text, text) from public, anon;
grant execute on function app.claim_event_replay(text, text) to authenticated, service_role;

create or replace function public.claim_event_replay(p_event text, p_reason text)
returns table (replay_id uuid, event_type text, payload jsonb)
language sql security invoker set search_path = public, pg_catalog
as $$ select * from app.claim_event_replay(p_event, p_reason); $$;

create or replace function public.finish_event_replay(
  p_replay uuid, p_applied boolean, p_error text default null)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.finish_event_replay(p_replay, p_applied, p_error); end; $$;

revoke all on function public.claim_event_replay(text, text) from public, anon;
grant execute on function public.claim_event_replay(text, text) to authenticated, service_role;
revoke all on function public.finish_event_replay(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.finish_event_replay(uuid, boolean, text) to service_role;

-- -----------------------------------------------------------------------------
-- Seeing them
-- -----------------------------------------------------------------------------
create or replace view admin_stuck_events as
select
  se.id                as event_id,
  se.type,
  se.received_at,
  se.processing_state,
  se.processing_error,
  se.attempts,
  se.livemode,
  se.company_id,
  c.name               as company_name,
  -- Who the event is about, when GrounUp never managed to resolve a company —
  -- which is most of the interesting cases.
  se.payload -> 'data' -> 'object' ->> 'customer'  as stripe_customer_id,
  r.last_attempt,
  r.attempts_by_hand,
  r.last_error
from stripe_events se
left join companies c on c.id = se.company_id
left join lateral (
  select max(x.requested_at) as last_attempt,
         count(*) as attempts_by_hand,
         (array_agg(x.error order by x.requested_at desc)
            filter (where x.error is not null))[1] as last_error
  from stripe_event_replays x where x.event_id = se.id
) r on true
where se.processed_at is null
  and se.processing_state in ('received', 'failed')
  and app.operator_can('billing.read')
order by se.received_at desc;

comment on view admin_stuck_events is
  'Stripe events that arrived and never finished, with what has already been tried by hand. Each row is a customer who may have paid and got nothing, which is why this is the loudest thing on the dashboard.';

grant select on admin_stuck_events to authenticated;
revoke all on admin_stuck_events from anon;

select app.assert_security_gates();
