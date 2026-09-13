-- =============================================================================
-- 0167 — Talking about the work, on the work
--
-- Nothing in this platform lets one person say something to another. There are
-- `notifications` (the system telling somebody), `announcements` (a super admin
-- telling a company), `email_messages` (outbound), and `ai_messages`
-- (conversations with an agent). A foreman cannot ask the office a question and
-- the office cannot answer.
--
-- Asked for on 13 September 2026 as messaging between crew and office. Built as
-- **comments on records** rather than an inbox, deliberately:
--
--   * A general inbox becomes a second chat app nobody checks, and the
--     conversation ends up detached from the thing it was about. What a job
--     actually needs is *this* change order having three comments and *this*
--     daily report having a question on it.
--   * A decision made in a direct message is a decision with no record, which is
--     what claims are lost on. Every comment here belongs to a record, and the
--     people who can see the record can see the conversation about it.
--
-- One table across fourteen kinds of record rather than fourteen comment
-- tables, and rather than the loose `entity_table`/`entity_id` pair
-- `notifications` carries — a notification pointing at a deleted row is a dead
-- link, and a comment orphaned from its record is evidence nobody can place.
-- The subject is checked to exist and to belong to the same company.
-- =============================================================================

create table if not exists record_comments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,

  -- What is being talked about. Kinds are listed rather than inferred so that
  -- adding one is a decision somebody makes, not a string somebody passes.
  subject_kind  text not null check (subject_kind in (
                  'project', 'schedule_activity', 'change_order', 'rfi',
                  'daily_report', 'safety_incident', 'estimate_version',
                  'pay_application', 'purchase_order', 'claim', 'inspection',
                  'submittal', 'toolbox_talk', 'deficiency')),
  subject_id    uuid not null,

  -- One level of reply. Threads that nest without limit become unreadable on a
  -- phone, which is where a foreman will be reading this.
  parent_id     uuid references record_comments(id) on delete cascade,

  author_id     uuid not null references auth.users(id) on delete cascade,
  body          text not null check (length(trim(body)) between 1 and 8000),

  -- Who was named. Fanned out through the notification machinery that already
  -- exists, rather than a second delivery path beside it.
  mentions      uuid[] not null default '{}',

  edited_at     timestamptz,
  -- Retracted, never deleted. A comment that vanishes from a record somebody is
  -- claiming against is worse than one that says it was withdrawn.
  retracted_at  timestamptz,
  retracted_by  uuid references auth.users(id) on delete set null,
  retract_reason text,

  created_at    timestamptz not null default now(),

  constraint record_comments_retracted
    check (retracted_at is null or retracted_by is not null)
);
create index if not exists record_comments_subject_idx
  on record_comments(subject_kind, subject_id, created_at);
create index if not exists record_comments_company_recent_idx
  on record_comments(company_id, created_at desc);
create index if not exists record_comments_author_idx
  on record_comments(author_id, created_at desc);
create index if not exists record_comments_mentions_idx
  on record_comments using gin (mentions);

comment on table record_comments is
  'What people said about one record, on that record. ENTITY. Comments rather than an inbox, because a decision taken in a direct message is a decision with no record.';

comment on column record_comments.retracted_at is
  'Withdrawn, not removed. The row stays so a record somebody is claiming against does not quietly lose a sentence that was once on it.';

/**
 * The subject has to exist, and it has to be this company's.
 *
 * Written as one function over a name rather than fourteen foreign keys,
 * because the alternative is fourteen nullable columns and a check constraint
 * that has to be rewritten every time a kind is added. The cost is that the
 * check is a trigger instead of a constraint, so it is written to be exact:
 * the row must exist in the named table and carry the same `company_id`.
 */
create or replace function app.enforce_comment_subject()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_table text;
  v_company uuid;
begin
  v_table := case new.subject_kind
    when 'project'          then 'projects'
    when 'schedule_activity'then 'schedule_activities'
    when 'change_order'     then 'change_orders'
    when 'rfi'              then 'rfis'
    when 'daily_report'     then 'daily_reports'
    when 'safety_incident'  then 'safety_incidents'
    when 'estimate_version' then 'estimate_versions'
    when 'pay_application'  then 'pay_applications'
    when 'purchase_order'   then 'purchase_orders'
    when 'claim'            then 'claims'
    when 'inspection'       then 'inspections'
    when 'submittal'        then 'submittals'
    when 'toolbox_talk'     then 'toolbox_talks'
    when 'deficiency'       then 'deficiencies'
  end;

  execute format('select company_id from %I where id = $1', v_table)
    into v_company using new.subject_id;

  if v_company is null then
    raise exception 'There is no % with that id to comment on', replace(new.subject_kind, '_', ' ')
      using errcode = 'foreign_key_violation';
  end if;
  if v_company <> new.company_id then
    raise exception 'That record belongs to another company'
      using errcode = 'insufficient_privilege';
  end if;

  -- A reply belongs to the same subject as the comment it answers.
  if new.parent_id is not null then
    if not exists (select 1 from record_comments p
                    where p.id = new.parent_id
                      and p.subject_kind = new.subject_kind
                      and p.subject_id = new.subject_id) then
      raise exception 'A reply belongs on the same record as the comment it answers'
        using errcode = 'check_violation';
    end if;
    -- One level. A reply to a reply is a reply to the thread.
    if exists (select 1 from record_comments p
                where p.id = new.parent_id and p.parent_id is not null) then
      raise exception 'Replies go one level deep; answer the comment that started the thread'
        using errcode = 'check_violation',
              hint = 'Nested threads are unreadable on the phone somebody is reading this on.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists record_comments_subject on record_comments;
create trigger record_comments_subject
  before insert or update of subject_kind, subject_id, parent_id, company_id on record_comments
  for each row execute function app.enforce_comment_subject();

comment on function app.enforce_comment_subject() is
  'Refuses a comment whose subject does not exist, belongs to another company, or whose reply is on a different record or nested more than one deep.';


-- -----------------------------------------------------------------------------
-- Who may read a conversation
--
-- A comment inherits the sensitivity of what it is about. A remark on a safety
-- incident is not a remark on a purchase order, and letting membership alone
-- decide would put the first in front of everyone who can see the second.
-- Mapped once here so the policy, the poster and any future reader all agree.
-- -----------------------------------------------------------------------------
create or replace function app.comment_read_permission(p_kind text)
returns text language sql immutable set search_path = public, pg_catalog
as $$
  select case p_kind
    when 'project'           then 'projects.read'
    when 'schedule_activity' then 'projects.read'
    when 'daily_report'      then 'projects.read'
    when 'change_order'      then 'finance.read'
    when 'pay_application'   then 'finance.read'
    when 'claim'             then 'finance.read'
    when 'rfi'               then 'projects.read'
    when 'submittal'         then 'projects.read'
    when 'safety_incident'   then 'safety.read'
    when 'toolbox_talk'      then 'safety.read'
    when 'inspection'        then 'quality.read'
    when 'deficiency'        then 'quality.read'
    when 'estimate_version'  then 'estimates.read'
    when 'purchase_order'    then 'procurement.read'
  end;
$$;

comment on function app.comment_read_permission(text) is
  'The permission that reading a comment on this kind of record requires. A comment inherits the sensitivity of its subject.';

/**
 * Say something about a record.
 *
 * Mentions are filtered to people who are actually members of the company
 * before they are stored, because a mention of somebody who cannot see the
 * record is a notification that leads nowhere, and a mention of a stranger is
 * a way to find out whether a user id exists.
 */
create or replace function app.post_comment(
  p_subject_kind text,
  p_subject_id   uuid,
  p_body         text,
  p_parent_id    uuid default null,
  p_mentions     uuid[] default '{}')
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_perm    text;
  v_id      uuid;
  v_mentions uuid[];
  v_author  text;
  v_path    text;
  m         uuid;
begin
  v_perm := app.comment_read_permission(p_subject_kind);
  if v_perm is null then
    raise exception 'Comments are not kept on %', p_subject_kind using errcode = 'check_violation';
  end if;

  execute format('select company_id from %I where id = $1',
                 case p_subject_kind
                   when 'project'           then 'projects'
                   when 'schedule_activity' then 'schedule_activities'
                   when 'change_order'      then 'change_orders'
                   when 'rfi'               then 'rfis'
                   when 'daily_report'      then 'daily_reports'
                   when 'safety_incident'   then 'safety_incidents'
                   when 'estimate_version'  then 'estimate_versions'
                   when 'pay_application'   then 'pay_applications'
                   when 'purchase_order'    then 'purchase_orders'
                   when 'claim'             then 'claims'
                   when 'inspection'        then 'inspections'
                   when 'submittal'         then 'submittals'
                   when 'toolbox_talk'      then 'toolbox_talks'
                   when 'deficiency'        then 'deficiencies'
                 end)
    into v_company using p_subject_id;

  if v_company is null then
    raise exception 'There is no % with that id to comment on', replace(p_subject_kind, '_', ' ')
      using errcode = 'no_data_found';
  end if;
  -- Reading the record is what earns the right to say something about it.
  if not app.has_permission(v_company, v_perm) then
    raise exception 'You do not have permission to comment on that'
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce(array_agg(distinct u), '{}'::uuid[]) into v_mentions
    from unnest(coalesce(p_mentions, '{}'::uuid[])) u
   where exists (select 1 from company_memberships cm
                  where cm.user_id = u and cm.company_id = v_company
                    and cm.status = 'active');

  insert into record_comments (company_id, subject_kind, subject_id, parent_id,
                               author_id, body, mentions)
  values (v_company, p_subject_kind, p_subject_id, p_parent_id,
          auth.uid(), trim(p_body), v_mentions)
  returning id into v_id;

  -- And the people named hear about it, through the one delivery path that
  -- already exists rather than a second one beside it.
  if cardinality(v_mentions) > 0 then
    select coalesce(nullif(trim(full_name), ''), email, 'Somebody')
      into v_author from user_profiles where id = auth.uid();
    v_path := case p_subject_kind
                when 'project' then '/app/projects/' || p_subject_id
                when 'estimate_version' then '/app/estimates/' || p_subject_id
                else null
              end;
    foreach m in array v_mentions loop
      if m <> auth.uid() then
        insert into notifications (company_id, user_id, category, severity,
                                   title, body, action_path, action_label,
                                   entity_table, entity_id)
        values (v_company, m,
                case p_subject_kind
                  when 'change_order' then 'change_order'
                  when 'rfi' then 'rfi'
                  when 'submittal' then 'submittal'
                  when 'safety_incident' then 'safety'
                  when 'toolbox_talk' then 'safety'
                  when 'estimate_version' then 'estimate'
                  when 'schedule_activity' then 'schedule'
                  when 'pay_application' then 'billing'
                  else 'project'
                end,
                'info',
                coalesce(v_author, 'Somebody') || ' mentioned you',
                left(trim(p_body), 280),
                v_path,
                case when v_path is null then null else 'Open it' end,
                p_subject_kind, p_subject_id::text);
      end if;
    end loop;
  end if;

  return v_id;
end;
$$;

comment on function app.post_comment(text, uuid, text, uuid, uuid[]) is
  'Says something about one record, notifying the people named through the existing notification path. Reading the record is what earns the right to comment on it. WORKFLOW.';

/**
 * Correcting what you said, and withdrawing it.
 *
 * Only the author edits, and the edit is stamped: a comment that changed after
 * somebody relied on it should say so on its face. Anyone with the company
 * permission may retract — a foreman who posts the wrong photo on a safety
 * incident at ten at night should not need the author online to take it down —
 * and a retraction keeps the row, with a reason.
 */
create or replace function app.edit_comment(p_comment uuid, p_body text)
returns void language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_c record_comments%rowtype;
begin
  select * into v_c from record_comments where id = p_comment;
  if not found then
    raise exception 'No such comment' using errcode = 'no_data_found';
  end if;
  if v_c.author_id <> auth.uid() then
    raise exception 'Only the person who wrote a comment can change it'
      using errcode = 'insufficient_privilege';
  end if;
  if v_c.retracted_at is not null then
    raise exception 'That comment was withdrawn' using errcode = 'check_violation';
  end if;
  update record_comments
     set body = trim(p_body), edited_at = now()
   where id = p_comment;
end;
$$;

create or replace function app.retract_comment(p_comment uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_c record_comments%rowtype;
begin
  select * into v_c from record_comments where id = p_comment;
  if not found then
    raise exception 'No such comment' using errcode = 'no_data_found';
  end if;
  if v_c.author_id <> auth.uid()
     and not app.has_permission(v_c.company_id, app.comment_read_permission(v_c.subject_kind)) then
    raise exception 'You do not have permission to withdraw that comment'
      using errcode = 'insufficient_privilege';
  end if;
  update record_comments
     set retracted_at = coalesce(retracted_at, now()),
         retracted_by = coalesce(retracted_by, auth.uid()),
         retract_reason = coalesce(retract_reason, nullif(trim(coalesce(p_reason, '')), ''))
   where id = p_comment;
end;
$$;

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------
alter table record_comments enable row level security;
alter table record_comments force row level security;

create policy record_comments_select on record_comments for select to authenticated
  using (app.has_permission(company_id, app.comment_read_permission(subject_kind)));

-- No insert, update or delete policy: every write goes through the functions
-- above, which check the subject, filter the mentions and stamp the edit. A
-- comment inserted straight into the table would skip all three.

revoke all on record_comments from anon;

create or replace view my_record_comments as
select c.id, c.subject_kind, c.subject_id, c.parent_id,
       c.body, c.mentions, c.edited_at, c.retracted_at, c.retract_reason,
       c.created_at, c.author_id,
       coalesce(nullif(trim(p.full_name), ''), p.email) as author_name
  from record_comments c
  left join user_profiles p on p.id = c.author_id;

revoke all on my_record_comments from public, anon;
grant select on my_record_comments to authenticated;
alter view my_record_comments set (security_invoker = on);

comment on view my_record_comments is
  'Comments on records this person may read, with the author''s name resolved.';

revoke all on function app.post_comment(text, uuid, text, uuid, uuid[]) from public, anon;
grant execute on function app.post_comment(text, uuid, text, uuid, uuid[]) to authenticated;
revoke all on function app.edit_comment(uuid, text) from public, anon;
grant execute on function app.edit_comment(uuid, text) to authenticated;
revoke all on function app.retract_comment(uuid, text) from public, anon;
grant execute on function app.retract_comment(uuid, text) to authenticated;

create or replace function public.post_comment(
  p_subject_kind text, p_subject_id uuid, p_body text,
  p_parent_id uuid default null, p_mentions uuid[] default '{}')
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.post_comment(p_subject_kind, p_subject_id, p_body, p_parent_id, p_mentions); $$;

create or replace function public.edit_comment(p_comment uuid, p_body text)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.edit_comment(p_comment, p_body); $$;

create or replace function public.retract_comment(p_comment uuid, p_reason text default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.retract_comment(p_comment, p_reason); $$;

revoke all on function public.post_comment(text, uuid, text, uuid, uuid[]) from public, anon;
grant execute on function public.post_comment(text, uuid, text, uuid, uuid[]) to authenticated;
revoke all on function public.edit_comment(uuid, text) from public, anon;
grant execute on function public.edit_comment(uuid, text) to authenticated;
revoke all on function public.retract_comment(uuid, text) from public, anon;
grant execute on function public.retract_comment(uuid, text) to authenticated;

-- Edited and withdrawn comments both leave the row in place; the audit is what
-- records the words that were there before.
select app.attach_standard_triggers('public.record_comments');

select app.guard_suspension('record_comments');

select app.assert_security_gates();
