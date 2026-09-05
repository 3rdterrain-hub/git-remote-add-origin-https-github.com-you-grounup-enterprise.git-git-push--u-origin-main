-- =============================================================================
-- 0086 — What your staff did
--
-- Every operator action on this platform has been audited since migration 0064,
-- and audited into the *customer's* own ledger — deliberately, so a company can
-- read what was done to them. That is the right place for it and it is the
-- wrong place to answer the other question: what did the people I hired do this
-- week.
--
-- Nobody could answer it. The records were spread across every tenant's history
-- with no way to read down the operator axis, and the actions that belong to no
-- tenant at all — publishing a price, editing a role, taking somebody on — sat
-- in rows with a null company that nothing ever looked at.
--
-- This adds no new recording. Everything here already existed; what was missing
-- was a way to read it the other way round. That is the whole change, and it is
-- worth saying because the tempting version of this feature is a second log,
-- which would immediately disagree with the first one.
--
-- Two things it is careful about.
--
-- **A revoked operator's history stays.** The most important week to be able to
-- read is usually the one before somebody was let go, and a view that joined
-- only to live grants would hide exactly that.
--
-- **An action with no reason is visible as such.** Most operator functions
-- demand a reason; the audit triggers on ordinary tables do not. Counting those
-- separately keeps the report honest rather than making a row look unexplained
-- when nobody was ever asked to explain it.
-- =============================================================================

create or replace view admin_operator_activity as
select
  e.id,
  e.occurred_at,
  e.actor_id                              as operator_id,
  coalesce(e.actor_email, up.email)       as operator_email,
  a.role_key                              as operator_role,
  (a.revoked_at is not null)              as operator_since_revoked,
  e.action,
  e.entity_table,
  e.entity_id,
  e.reason,
  e.company_id,
  c.name                                  as company_name,
  /*
   * An action that belongs to no tenant: publishing a price, editing a role,
   * taking somebody on. Those live in rows with a null company and were
   * previously read by nothing at all.
   */
  (e.company_id is null)                  as platform_wide,
  e.ip_address,
  e.correlation_id
from audit_events e
join platform_admins a on a.user_id = e.actor_id
left join user_profiles up on up.id = e.actor_id
left join companies c on c.id = e.company_id
where e.occurred_at > now() - interval '180 days'
  and app.operator_can('operators.manage')
order by e.occurred_at desc
limit 500;

comment on view admin_operator_activity is
  'What the people who operate this platform have done, read down the operator axis rather than the tenant one. No new recording — these are the same rows the customer reads in their own history, joined the other way. Includes operators whose access has since been withdrawn, because the week before somebody was let go is usually the week worth reading.';

grant select on admin_operator_activity to authenticated;
revoke all on admin_operator_activity from anon;

create or replace view admin_operator_summary as
select
  a.user_id                               as operator_id,
  coalesce(up.email, a.user_id::text)     as operator_email,
  a.role_key                              as operator_role,
  (a.revoked_at is not null)              as access_withdrawn,
  a.granted_at,
  /*
   * Counted by the thing acted on rather than by ledger rows.
   *
   * One operator action can leave two entries: the function writes its own,
   * with the reason the operator gave, and `attach_standard_triggers` writes
   * another when the row changes. Both belong in the ledger — one carries the
   * intent and the other the exact before and after — but counting rows would
   * report every action twice, and a screen that says somebody opened two
   * customer accounts when they opened one is worse than no screen.
   */
  -- Filtered on the outer join having matched: a composite of three nulls is
  -- still a value, so counting it distinctly would report one action for an
  -- operator who has done none.
  count(distinct (e.entity_table, e.entity_id, e.action))
    filter (where e.id is not null)       as actions_30_days,
  count(distinct e.company_id) filter (where e.company_id is not null)
                                          as companies_touched,
  count(distinct e.entity_id) filter (where e.entity_table = 'public.refund_requests')
                                          as refund_actions,
  count(distinct e.entity_id) filter (where e.entity_table = 'public.entitlement_overrides')
                                          as feature_actions,
  count(distinct e.entity_id) filter (where e.entity_table = 'public.support_sessions')
                                          as accounts_opened,
  count(distinct e.entity_id) filter (where e.entity_table = 'public.company_billing_terms')
                                          as terms_set,
  /*
   * Ledger entries with no reason on file. Not a count of wrongdoing, and
   * counted in rows rather than actions on purpose: these are mostly the
   * trigger-written half of an action whose other half carries the reason.
   * Reported so the number is visible rather than making an unexplained row
   * look like a deliberate omission.
   */
  count(e.id) filter (where e.reason is null) as ledger_entries_without_a_reason,
  max(e.occurred_at)                      as last_seen
from platform_admins a
left join user_profiles up on up.id = a.user_id
left join audit_events e
  on e.actor_id = a.user_id and e.occurred_at > now() - interval '30 days'
where app.operator_can('operators.manage')
group by a.user_id, up.email, a.role_key, a.revoked_at, a.granted_at
order by count(e.id) desc;

comment on view admin_operator_summary is
  'Each operator and what they have done in thirty days: how much, across how many customers, and how much of it was the powerful kind. Somebody with access and no activity is as worth seeing as somebody with a great deal — an account nobody uses is an account nobody would notice being used.';

grant select on admin_operator_summary to authenticated;
revoke all on admin_operator_summary from anon;

/**
 * Everything one operator did to one company.
 *
 * The question asked when a customer says "who changed this". Ordered oldest
 * first, because the answer is usually a sequence rather than a single row.
 */
create or replace view admin_company_operator_history as
select
  e.occurred_at,
  coalesce(e.actor_email, up.email)       as operator_email,
  a.role_key                              as operator_role,
  e.action,
  e.entity_table,
  e.entity_id,
  e.reason,
  e.company_id
from audit_events e
join platform_admins a on a.user_id = e.actor_id
left join user_profiles up on up.id = e.actor_id
where e.company_id is not null
  and app.operator_can('companies.read')
order by e.occurred_at;

comment on view admin_company_operator_history is
  'Everything an operator has ever done to one company, oldest first. The answer to "who changed this", which is a sequence rather than a single row. Gated on companies.read rather than operators.manage: somebody supporting a customer needs to know what has already been done to them.';

grant select on admin_company_operator_history to authenticated;
revoke all on admin_company_operator_history from anon;

select app.assert_security_gates();
