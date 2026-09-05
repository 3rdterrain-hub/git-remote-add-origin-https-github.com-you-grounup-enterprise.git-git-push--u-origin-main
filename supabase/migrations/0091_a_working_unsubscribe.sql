-- =============================================================================
-- 0091 — A working unsubscribe
--
-- Migration 0090 sends announcement email that ends "You can switch these off
-- under Settings, Notifications." There is no such screen. `notification_
-- preferences` has existed since migration 0018 and nothing in the application
-- has ever read or written it, so the instruction points at nothing.
--
-- That is the defect this project keeps finding, committed by me in the last
-- migration: the platform asserting something nothing does. It is worse than
-- usual here, because an opt-out that does not work is the one part of bulk
-- email that is not merely rude.
--
-- The table was already right. What was missing was a way for somebody to
-- write their own row, and a list of what there is to choose from — without
-- one, a preferences screen has to hard-code the categories, which is a second
-- copy of a list that lives in the mail-sending code.
-- =============================================================================

create table notification_categories (
  key           text primary key check (key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  label         text not null,
  description   text not null,
  /*
   * Whether somebody may switch it off. False for the things a person is
   * entitled to hear about their own account whatever their preferences say —
   * and the screen shows those as fixed rather than hiding them, because a
   * list that quietly omits what it cannot change reads as a shorter list
   * rather than an honest one.
   */
  optional      boolean not null default true,
  sort_order    int not null default 0
);

comment on table notification_categories is
  'What there is to be notified about. LIBRARY. Exists so a preferences screen reads the same list the mail-sending code uses rather than carrying a second copy of it — the two would drift, and the drift would show up as a category nobody can switch off because the screen has never heard of it.';

alter table notification_categories enable row level security;
alter table notification_categories force row level security;
create policy notification_categories_select on notification_categories
  for select to authenticated using (true);
grant select on notification_categories to authenticated;
revoke all on notification_categories from anon;

insert into notification_categories (key, label, description, optional, sort_order) values
  ('billing.payment_failed', 'A payment did not go through',
   'Sent when the card on file is declined. Cannot be switched off: this is how you find out before your account is affected.', false, 10),
  ('account.suspended', 'Your account is put into read-only',
   'Cannot be switched off. Losing the ability to add work without being told would be worse than any amount of email.', false, 20),
  ('billing.refund', 'A refund or credit is issued',
   'Sent when money actually goes back, not when it is agreed. Cannot be switched off — it is a record of money moving.', false, 30),
  ('platform.announcement', 'News about GrounUp',
   'Maintenance, changes, and things worth knowing about. Switch this off and your billing and account messages still reach you.', true, 40),
  ('project.assignment', 'You are assigned to something',
   'A project, a task or a daily report that names you.', true, 50),
  ('approval.requested', 'Something is waiting on your approval',
   'An estimate, a change order or a purchase order that needs a decision from you.', true, 60),
  ('safety.incident', 'A safety incident is recorded',
   'For the people who need to know the same day.', true, 70)
on conflict (key) do update set
  label = excluded.label, description = excluded.description,
  optional = excluded.optional, sort_order = excluded.sort_order;

create trigger notification_categories_frozen
  before insert or update or delete on notification_categories
  for each row execute function app.forbid_mutation();

/**
 * Set my own preference.
 *
 * Mine, deliberately: notification_preferences is keyed on the person as well
 * as the company, and an owner switching off their colleague's email would be
 * a strange thing for a platform to allow.
 *
 * A category that cannot be switched off is refused rather than silently
 * ignored. A screen that accepted the change and did nothing would be the same
 * defect as the one this migration exists to fix.
 */
create or replace function app.set_notification_preference(
  p_company uuid, p_category text, p_in_app boolean, p_email boolean)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_optional boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if not app.is_member(p_company) then
    raise exception 'You are not a member of that company'
      using errcode = 'insufficient_privilege';
  end if;

  select optional into v_optional from notification_categories where key = p_category;
  if v_optional is null then
    raise exception 'There is nothing called %', p_category using errcode = 'no_data_found';
  end if;
  if not v_optional and (p_email is false or p_in_app is false) then
    raise exception 'You cannot switch off %', p_category
      using errcode = 'check_violation',
            hint = 'Messages about your own billing and account always reach you.';
  end if;

  insert into notification_preferences (company_id, user_id, category, in_app, email)
  values (p_company, auth.uid(), p_category, coalesce(p_in_app, true), coalesce(p_email, true))
  on conflict (company_id, user_id, category) do update
    set in_app = excluded.in_app, email = excluded.email, updated_at = now();
end;
$$;

revoke all on function app.set_notification_preference(uuid, text, boolean, boolean)
  from public, anon;
grant execute on function app.set_notification_preference(uuid, text, boolean, boolean)
  to authenticated;

create or replace function public.set_notification_preference(
  p_company uuid, p_category text, p_in_app boolean, p_email boolean)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.set_notification_preference(p_company, p_category, p_in_app, p_email); end; $$;

revoke all on function public.set_notification_preference(uuid, text, boolean, boolean)
  from public, anon;
grant execute on function public.set_notification_preference(uuid, text, boolean, boolean)
  to authenticated;

/**
 * What I am set to receive.
 *
 * Every category with my choice folded in, rather than only the rows I have
 * written. Somebody who has never opened the screen has no rows at all, and a
 * view that showed only those would show them nothing and imply they receive
 * nothing.
 */
create or replace view my_notification_settings
with (security_invoker = true) as
select
  m.company_id,
  c.key                                   as category,
  c.label,
  c.description,
  c.optional,
  -- The default is on. Somebody who has never looked has not opted out.
  coalesce(np.in_app, true)               as in_app,
  coalesce(np.email, true)                as email
from company_memberships m
cross join notification_categories c
left join notification_preferences np
  on np.company_id = m.company_id and np.user_id = m.user_id and np.category = c.key
where m.user_id = auth.uid() and m.status = 'active'
order by c.sort_order;

comment on view my_notification_settings is
  'Every notification category with this person''s choice folded in. Every category, not only the rows they have written: somebody who has never opened the screen has no rows, and showing only those would tell them they receive nothing.';

grant select on my_notification_settings to authenticated;
revoke all on my_notification_settings from anon;

select app.assert_security_gates();
