-- =============================================================================
-- 0054 — A notice anybody could rewrite, and a read receipt shared by everybody
--
-- The notification layer produces real controls: a recordable safety incident,
-- a credential withdrawn or lapsed, a machine down, a service due, a superseded
-- design still on a machine. Each carries a severity, a deep link and the entity
-- it concerns. Two things about how they are held were wrong.
--
--   * **The update policy grants far more than its comment claims.** It reads
--     "A user may only mark their own notifications read or dismissed", and row
--     level security cannot restrict columns — it restricts rows. So any member
--     could update `title`, `body`, `severity` or `action_path` on their own
--     notification *and on every company-wide one*, because a company-wide
--     notice has `user_id is null` and the policy admits it. A critical safety
--     notice naming an employee whose certification has lapsed could be
--     retitled, or quietly downgraded from critical to info, by anyone in the
--     company.
--
--   * **Read state lived on the shared row.** `read_at` and `dismissed_at` were
--     columns on `notifications`, and a company-wide notice is one row seen by
--     every member — so the first person to read it would have marked it read
--     for everybody. Read state is personal and it was stored somewhere shared.
--
-- Neither had surfaced, because nothing writes either column: 22 of the 23
-- screens read demonstration fixtures, so no inbox exists to mark anything
-- read. Both are the kind of defect that appears the day the feature is built.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- What a notice says is fixed once it is raised
-- -----------------------------------------------------------------------------
/**
 * A notification is a record of something that happened, so its content does
 * not change. Nothing about it is editable at all now that read state has moved
 * off the row — the same shape as the append-only ledgers, arrived at from the
 * other direction.
 *
 * Deleting one is still allowed where the policies permit it: a notice that
 * should never have been raised can be withdrawn, which is different from one
 * being quietly reworded.
 */
create or replace function app.forbid_notification_edit()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'Notification % is a record of an event and its content cannot be changed. Mark it read through notification_receipts, or delete it if it should not have been raised.',
    old.id
    using errcode = 'restrict_violation';
end;
$$;

-- -----------------------------------------------------------------------------
-- Read state belongs to the reader
-- -----------------------------------------------------------------------------
create table notification_receipts (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  notification_id uuid not null references notifications(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  read_at         timestamptz,
  dismissed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (notification_id, user_id)
);
create index notification_receipts_tenant_idx on notification_receipts(company_id);
create index notification_receipts_user_idx on notification_receipts(user_id, notification_id);

comment on table notification_receipts is
  'Whether one person has read or dismissed one notification. ENTITY. Read state is personal, and a company-wide notice is a single row seen by every member — holding the timestamp on that row would have let the first reader mark it read for the whole company.';

create trigger notification_receipts_tenant_parent
  before insert or update on notification_receipts
  for each row execute function app.enforce_tenant_parent('notifications', 'notification_id', 'id');

alter table notification_receipts enable row level security;
alter table notification_receipts force row level security;

-- A receipt is nobody else's business, including inside the same company.
create policy notification_receipts_all on notification_receipts for all to authenticated
  using (user_id = auth.uid() and app.is_member(company_id))
  with check (user_id = auth.uid() and app.is_member(company_id));

grant select, insert, update, delete on notification_receipts to authenticated;

select app.attach_standard_triggers('public.notification_receipts'::regclass);

-- -----------------------------------------------------------------------------
-- Retire the columns that held it
-- -----------------------------------------------------------------------------
/*
 * All three were written by nothing. `read_at` and `dismissed_at` are replaced
 * by the receipts above. `emailed_at` recorded a delivery that cannot happen:
 * the platform sends no email, and a timestamp for an action nothing performs
 * is the defect this build has spent its time removing rather than one to keep.
 */
drop index if exists notifications_user_unread_idx;
alter table notifications
  drop column read_at,
  drop column dismissed_at,
  drop column emailed_at;

drop policy if exists notifications_update on notifications;

create trigger forbid_notification_edit
  before update on notifications
  for each row execute function app.forbid_notification_edit();

comment on table notifications is
  'An event somebody should see. ENTITY. Content is fixed once raised — row level security restricts rows and not columns, so the old update policy that meant to allow marking a notice read in fact allowed rewriting the title and severity of every company-wide one. Read state is per person, in notification_receipts.';

select app.assert_security_gates();
