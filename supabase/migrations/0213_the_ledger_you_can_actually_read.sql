-- =============================================================================
-- 0213 — The ledger you can actually read
--
-- `audit_events` has been written to since migration 0003 by triggers on every
-- governed table, and the live database holds more than thirty thousand rows.
-- Nothing has ever read it.
--
-- The Company Settings security tab carried a card headed "Audit ledger" with
-- three figures under it: "Events recorded 18,442 — last 90 days", "Retention:
-- No policy set", "Tamper protection: Trigger-enforced". Two of those are true
-- statements about the platform. The first is a number somebody typed, on a
-- screen whose whole subject is records that cannot be altered — and it is not
-- close: the count is an order of magnitude out on this database alone, and it
-- would be a different wrong number for every company that ever read it.
--
-- So the count is counted. Two doors:
--
--   * `my_audit_summary` — how many events, over what span, by how many people.
--   * `my_audit_events` — the last events themselves, because a number on a
--     tile should answer the question it raises, and "18,442 events" raises
--     "which ones?". A ledger nobody can open is not evidence of anything.
--
-- Both are `security_invoker`, so `audit_events_select` decides what comes
-- back: a member with `audit.read` and nobody else. Prior and new state are
-- deliberately not exposed — they hold whole row images of governed tables, and
-- a reader who may see that a rate changed is not automatically a reader who
-- may see every column of the row it changed.
--
-- ENTITY.
-- =============================================================================

create or replace view my_audit_summary
with (security_invoker = true) as
select a.company_id,
       count(*)                                           as event_count,
       count(*) filter (where a.occurred_at > now() - interval '90 days')
                                                          as events_last_90_days,
       count(*) filter (where a.occurred_at > now() - interval '30 days')
                                                          as events_last_30_days,
       count(distinct a.actor_id)                         as actor_count,
       count(distinct a.entity_table)                     as tables_touched,
       min(a.occurred_at)                                 as first_event_at,
       max(a.occurred_at)                                 as last_event_at
  from audit_events a
 group by a.company_id;

revoke all on my_audit_summary from public, anon;
grant select on my_audit_summary to authenticated, service_role;

comment on view my_audit_summary is
  'How much is in this company''s audit ledger and over what span. Counted, because the screen that showed it previously used a number somebody typed. ENTITY view.';

/**
 * The ledger itself, most recent first.
 *
 * `prior_state` and `new_state` are not projected. They are whole row images of
 * governed tables — wage rates, costs, customer records — and the permission to
 * read the ledger is not the same permission as reading every table it records.
 * What is here says who did what to which record and when, which is what an
 * audit question actually asks.
 */
create or replace view my_audit_events
with (security_invoker = true) as
select a.id,
       a.company_id,
       a.occurred_at,
       a.action::text                                     as action,
       a.entity_table,
       a.entity_id,
       a.reason,
       a.correlation_id,
       coalesce(p.full_name, a.actor_email, 'System')     as actor,
       (a.actor_id is null)                               as by_the_platform
  from audit_events a
  left join user_profiles p on p.id = a.actor_id;

revoke all on my_audit_events from public, anon;
grant select on my_audit_events to authenticated, service_role;

comment on view my_audit_events is
  'Who did what to which record, when. Deliberately omits prior_state and new_state: reading the ledger and reading every column of every row it records are different permissions. ENTITY view.';
