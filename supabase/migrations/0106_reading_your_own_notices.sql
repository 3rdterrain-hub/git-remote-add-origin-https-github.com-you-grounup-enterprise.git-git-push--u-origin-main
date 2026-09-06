-- =============================================================================
-- 0106 — Reading your own notices
--
-- Migration 0054 moved read state off `notifications` and into
-- `notification_receipts`, for a good reason: a company-wide notice is one row
-- seen by every member, so a `read_at` on that row would have let the first
-- person to open it mark it read for everybody.
--
-- It left the writing to somebody else. Marking a notice read means inserting a
-- receipt with the right `company_id`, the right `user_id` and a conflict
-- clause, and doing that from a browser means the browser has to know its own
-- user id and the notification's company — two facts it should not have to
-- carry to perform an action that means "I have seen this".
--
-- So: one function, one argument. It also fills the gap 0054 named in its own
-- header — that nothing wrote either column — which stayed true for the
-- receipts as well until a screen finally read them.
-- =============================================================================

/**
 * I have seen this.
 *
 * Idempotent, because opening a notice twice is not an error and the second
 * open should not move the timestamp: the answer to "when did you first see
 * this" does not change by looking again.
 */
create or replace function app.mark_notification_read(p_notification uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to mark a notice read' using errcode = 'insufficient_privilege';
  end if;

  /*
   * Read through the caller's own visibility rather than as the definer, so a
   * notification belonging to a company they are not in is simply not found.
   * The definer rights exist to write the receipt, not to widen what they see.
   */
  select n.company_id into v_company
  from notifications n
  where n.id = p_notification
    and app.is_member(n.company_id)
    and (n.user_id is null or n.user_id = auth.uid());

  if v_company is null then
    raise exception 'No such notification' using errcode = 'no_data_found';
  end if;

  insert into notification_receipts (company_id, notification_id, user_id, read_at)
  values (v_company, p_notification, auth.uid(), now())
  on conflict (notification_id, user_id) do update
    set read_at = coalesce(notification_receipts.read_at, excluded.read_at),
        updated_at = now();
end;
$$;

comment on function app.mark_notification_read(uuid) is
  'Records that the caller has seen one notice. Idempotent: a second open does not move the timestamp, because the answer to when they first saw it does not change by looking again.';

revoke all on function app.mark_notification_read(uuid) from public, anon;
grant execute on function app.mark_notification_read(uuid) to authenticated;

/** Put one away without deleting it. */
create or replace function app.dismiss_notification(p_notification uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to dismiss a notice' using errcode = 'insufficient_privilege';
  end if;

  select n.company_id into v_company
  from notifications n
  where n.id = p_notification
    and app.is_member(n.company_id)
    and (n.user_id is null or n.user_id = auth.uid());

  if v_company is null then
    raise exception 'No such notification' using errcode = 'no_data_found';
  end if;

  -- Dismissing implies having seen it, so both are recorded rather than
  -- leaving a notice that was put away and never read.
  insert into notification_receipts (company_id, notification_id, user_id,
                                     read_at, dismissed_at)
  values (v_company, p_notification, auth.uid(), now(), now())
  on conflict (notification_id, user_id) do update
    set read_at = coalesce(notification_receipts.read_at, excluded.read_at),
        dismissed_at = coalesce(notification_receipts.dismissed_at, excluded.dismissed_at),
        updated_at = now();
end;
$$;

revoke all on function app.dismiss_notification(uuid) from public, anon;
grant execute on function app.dismiss_notification(uuid) to authenticated;

create or replace function public.mark_notification_read(p_notification uuid)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.mark_notification_read(p_notification); end; $$;

create or replace function public.dismiss_notification(p_notification uuid)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.dismiss_notification(p_notification); end; $$;

revoke all on function public.mark_notification_read(uuid) from public, anon;
revoke all on function public.dismiss_notification(uuid) from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.dismiss_notification(uuid) to authenticated;

/**
 * The caller's inbox: what they may see, and whether they have seen it.
 *
 * A view because the join is the awkward part — a notice is company-wide or
 * personal, and its read state lives in another table keyed by the reader. A
 * screen writing that join itself would get the company-wide case wrong, which
 * is the case that matters: it is the one every member sees.
 *
 * `security_invoker` so row level security still decides which notifications
 * and which receipts are visible; this only saves writing the join.
 */
create or replace view my_notifications
with (security_invoker = true) as
select
  n.id, n.company_id, n.category, n.severity, n.title, n.body,
  n.action_path, n.action_label, n.entity_table, n.entity_id, n.created_at,
  r.read_at, r.dismissed_at
from notifications n
left join notification_receipts r
  on r.notification_id = n.id and r.user_id = auth.uid()
where (n.user_id is null or n.user_id = auth.uid())
  and r.dismissed_at is null;

revoke all on my_notifications from public, anon;
grant select on my_notifications to authenticated;

comment on view my_notifications is
  'What the caller should see and whether they have seen it, with the receipt join written once. Dismissed notices are left out; the row survives, so putting one away is not deleting it.';

select app.assert_security_gates();
