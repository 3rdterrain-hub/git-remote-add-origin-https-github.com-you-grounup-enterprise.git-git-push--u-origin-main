-- =============================================================================
-- 0088 — Telling everybody
--
-- Maintenance on Sunday, a price change next month, a feature worth knowing
-- about. There has been no way to say any of it. The `notifications` table has
-- existed since migration 0018 and is the wrong shape for this: it is one row
-- per person per notice, which for a broadcast means writing a row for every
-- user of the platform, writing more for everybody who signs up afterwards,
-- and cleaning all of them up later. An announcement is one thing that is true
-- for a while; who has seen it is a separate, much smaller fact.
--
-- So: one row for the message, one row per person who dismissed it, and a view
-- that works out what somebody should see right now. Nothing is written when
-- an announcement is published except the announcement.
--
-- Two decisions worth stating.
--
-- **Retracting does not unsend.** A message that went out went out; somebody
-- read it, and a platform that could make that untrue is a platform whose
-- history means nothing. Retracting stops it being shown and records why.
--
-- **Dismissal is one person's.** An estimator clearing a banner must not clear
-- it for the owner who has not read it, which is what per-company dismissal
-- would do and what makes broadcast features quietly useless.
-- =============================================================================

drop trigger if exists platform_permissions_frozen on platform_permissions;

insert into platform_permissions (key, label, description, is_powerful, sort_order) values
  ('announcements.publish', 'Announce something to customers',
   'Put a message in front of every customer, or every customer on a plan. It reaches people who did not ask to hear from you.',
   true, 46)
on conflict (key) do update set
  label = excluded.label, description = excluded.description,
  is_powerful = excluded.is_powerful, sort_order = excluded.sort_order;

create trigger platform_permissions_frozen
  before insert or update or delete on platform_permissions
  for each row execute function app.forbid_mutation();

create table announcements (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (length(trim(title)) between 3 and 120),
  body         text not null check (length(trim(body)) between 10 and 2000),
  kind         text not null default 'info'
                 check (kind in ('info', 'maintenance', 'warning')),
  /*
   * Who sees it. Deliberately three coarse groups rather than a query builder:
   * an audience nobody can describe in a sentence is an audience somebody will
   * eventually get wrong, and getting it wrong here means telling the wrong
   * customers something alarming.
   */
  audience     text not null default 'everyone'
                 check (audience in ('everyone', 'paying', 'free')),
  starts_at    timestamptz not null default now(),
  -- When it stops being true. A maintenance notice for last Sunday is worse
  -- than no notice, so this is required for anything time-bound.
  ends_at      timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  retracted_at timestamptz,
  retracted_by uuid references auth.users(id) on delete set null,
  retract_reason text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint announcements_window check (ends_at is null or ends_at > starts_at),
  constraint announcements_retraction check (
    retracted_at is null or (retracted_by is not null and retract_reason is not null)),
  -- A maintenance notice without an end is a banner that never goes away.
  constraint announcements_maintenance_ends check (kind <> 'maintenance' or ends_at is not null)
);

comment on table announcements is
  'A message shown to customers for a while. ENTITY, one row per message rather than one per reader — a broadcast written as notifications would mean a row for every user, more for everybody who signs up afterwards, and a cleanup job. Retracting stops it being shown and never unsends it.';

create index announcements_live on announcements (starts_at desc)
  where retracted_at is null;

alter table announcements enable row level security;
alter table announcements force row level security;
revoke all on announcements from anon, authenticated;

/*
 * Everybody signed in may read the live ones — the audience is decided by the
 * view below, not by hiding rows, because a policy that filtered by plan would
 * have to know about entitlements and would be a second copy of that rule.
 */
create policy announcements_select on announcements for select to authenticated
  using (retracted_at is null and starts_at <= now()
         and (ends_at is null or ends_at > now()));
grant select on announcements to authenticated;

select app.attach_standard_triggers('public.announcements'::regclass);

create table announcement_dismissals (
  announcement_id uuid not null references announcements(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  dismissed_at    timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

comment on table announcement_dismissals is
  'Who has cleared which announcement. ENTITY. One row per person, not per company: an estimator clearing a banner must not clear it for the owner who has not read it, which is what per-company dismissal would do and what makes a broadcast feature quietly useless.';

alter table announcement_dismissals enable row level security;
alter table announcement_dismissals force row level security;
revoke all on announcement_dismissals from anon;

/*
 * Insert only. Clearing a banner is a thing that happened, and there is no
 * un-clearing it — a row that could be deleted would let somebody make an
 * announcement reappear for a person who had already dealt with it.
 */
create trigger announcement_dismissals_append_only
  before update or delete on announcement_dismissals
  for each row execute function app.forbid_mutation();

create policy announcement_dismissals_own on announcement_dismissals
  for select to authenticated using (user_id = auth.uid());
create policy announcement_dismissals_insert on announcement_dismissals
  for insert to authenticated with check (user_id = auth.uid());
grant select, insert on announcement_dismissals to authenticated;

-- -----------------------------------------------------------------------------
-- Saying it
-- -----------------------------------------------------------------------------
create or replace function app.publish_announcement(
  p_title text, p_body text, p_kind text default 'info',
  p_audience text default 'everyone',
  p_starts timestamptz default null, p_ends timestamptz default null)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_id uuid;
begin
  if not app.operator_can('announcements.publish') then
    raise exception 'You do not have permission to announce something to customers'
      using errcode = 'insufficient_privilege';
  end if;
  if p_kind not in ('info', 'maintenance', 'warning') then
    raise exception 'An announcement is information, maintenance or a warning, not "%"', p_kind
      using errcode = 'check_violation';
  end if;
  if p_audience not in ('everyone', 'paying', 'free') then
    raise exception 'An audience is everyone, the paying customers, or the free ones'
      using errcode = 'check_violation';
  end if;

  insert into announcements
    (title, body, kind, audience, starts_at, ends_at, published_by)
  values (trim(p_title), trim(p_body), p_kind, p_audience,
          coalesce(p_starts, now()), p_ends, auth.uid())
  returning id into v_id;

  /*
   * Recorded against the platform rather than any one customer, because it
   * belongs to no tenant — and it appears on the staff activity screen beside
   * every other thing an operator did.
   */
  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (null, auth.uid(), 'insert', 'public.announcements', v_id::text,
          jsonb_build_object('kind', p_kind, 'audience', p_audience,
                             'ends_at', p_ends),
          'Announced to ' || p_audience || ': ' || trim(p_title));
  return v_id;
end;
$$;

/** Stop showing it. Never unsend it. */
create or replace function app.retract_announcement(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
begin
  if not app.operator_can('announcements.publish') then
    raise exception 'You do not have permission to retract an announcement'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'Say why it is being pulled' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from announcements where id = p_id and retracted_at is null) then
    raise exception 'No live announcement %', p_id using errcode = 'no_data_found';
  end if;

  update announcements
     set retracted_at = now(), retracted_by = auth.uid(),
         retract_reason = trim(p_reason), updated_at = now()
   where id = p_id;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (null, auth.uid(), 'update', 'public.announcements', p_id::text,
          jsonb_build_object('retracted', true),
          'Retracted: ' || trim(p_reason));
end;
$$;

/** Clear it, for me. */
create or replace function app.dismiss_announcement(p_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  insert into announcement_dismissals (announcement_id, user_id)
  values (p_id, auth.uid())
  on conflict (announcement_id, user_id) do nothing;
end;
$$;

-- -----------------------------------------------------------------------------
-- Seeing it
-- -----------------------------------------------------------------------------
/**
 * What this person should be shown right now.
 *
 * The audience is worked out here rather than in a policy, because deciding
 * "paying" means asking about entitlements and a policy that did so would be a
 * second copy of that rule sitting where nobody would think to look for it.
 */
create or replace view my_announcements
with (security_invoker = true) as
select distinct
  a.id, a.title, a.body, a.kind, a.starts_at, a.ends_at
from announcements a
join company_memberships m
  on m.user_id = auth.uid() and m.status = 'active'
where a.retracted_at is null
  and a.starts_at <= now()
  and (a.ends_at is null or a.ends_at > now())
  and (
    a.audience = 'everyone'
    or (a.audience = 'free'   and app.effective_plan(m.company_id) = 'free')
    or (a.audience = 'paying' and app.effective_plan(m.company_id) <> 'free')
  )
  and not exists (
    select 1 from announcement_dismissals d
    where d.announcement_id = a.id and d.user_id = auth.uid()
  )
order by a.starts_at desc;

comment on view my_announcements is
  'The announcements this person should see now: live, within their window, for an audience they belong to, and not already cleared by them. Dismissal is per person — an estimator clearing a banner must not clear it for the owner who has not read it.';

grant select on my_announcements to authenticated;
revoke all on my_announcements from anon;

create or replace view admin_announcements as
select
  a.id, a.title, a.body, a.kind, a.audience,
  a.starts_at, a.ends_at, a.retracted_at, a.retract_reason,
  up.email                                as published_by_email,
  (a.retracted_at is null and a.starts_at <= now()
     and (a.ends_at is null or a.ends_at > now())) as live,
  -- How many people have cleared it. Not how many read it: a dismissal is the
  -- only signal there is, and calling it "read" would be a claim about
  -- somebody's attention that nothing here can support.
  (select count(*) from announcement_dismissals d where d.announcement_id = a.id)
                                          as dismissals
from announcements a
left join user_profiles up on up.id = a.published_by
where app.operator_can('announcements.publish') or app.operator_can('companies.read')
order by a.starts_at desc;

comment on view admin_announcements is
  'Every announcement, live or finished or retracted, with how many people have cleared it. Cleared rather than read — a dismissal is the only signal there is, and calling it "read" would be a claim about somebody''s attention that nothing here can support.';

grant select on admin_announcements to authenticated;
revoke all on admin_announcements from anon;

-- Wrappers.
create or replace function public.publish_announcement(
  p_title text, p_body text, p_kind text default 'info',
  p_audience text default 'everyone',
  p_starts timestamptz default null, p_ends timestamptz default null)
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin return app.publish_announcement(p_title, p_body, p_kind, p_audience,
       p_starts, p_ends); end; $$;

create or replace function public.retract_announcement(p_id uuid, p_reason text)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.retract_announcement(p_id, p_reason); end; $$;

create or replace function public.dismiss_announcement(p_id uuid)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.dismiss_announcement(p_id); end; $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'app.publish_announcement(text, text, text, text, timestamptz, timestamptz)',
    'app.retract_announcement(uuid, text)',
    'app.dismiss_announcement(uuid)',
    'public.publish_announcement(text, text, text, text, timestamptz, timestamptz)',
    'public.retract_announcement(uuid, text)',
    'public.dismiss_announcement(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

select app.assert_security_gates();
