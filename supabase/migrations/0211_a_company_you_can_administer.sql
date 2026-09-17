-- =============================================================================
-- 0211 — A company you can administer
--
-- `roles`, `company_memberships` and `company_invitations` have existed since
-- migration 0002. Between them they model the whole of team administration:
-- eleven seeded system roles with real permission arrays and approval tiers, a
-- membership join carrying status and ownership, and an invitation table whose
-- token is stored as a SHA-256 hash so a database read cannot be replayed into
-- account access.
--
-- Nothing has ever read or written any of it.
--
-- The Users & roles tab rendered an eleven-row array typed into the JSX, with
-- invented user counts beside each role — 1, 1, 0, 2, 3, 2, 2, 4, 1, 1, 3 — on
-- a screen whose purpose is to tell an owner who can do what in their company.
-- A company could not add a person, change what somebody may do, or take access
-- away, and the numbers it showed instead were fiction.
--
-- Four judgments this migration makes:
--
--   * **A permission you do not hold, you cannot grant.** An administrator with
--     `users.manage` could otherwise mint a role carrying `*` and assign it to
--     themselves. Every permission on a new or edited company role is checked
--     against what the caller actually holds, and `*` is refused outright on a
--     company role. Privilege escalation through the role editor is the obvious
--     attack on this screen and it is closed here rather than left to etiquette.
--   * **An unknown permission is refused, not stored.** The known set is read
--     from the shipped system roles rather than typed, so it cannot drift from
--     what `app.has_permission` will actually match. Same rule as 0136 and 0139
--     for jsonb fields and 0190 for API scopes: a permission that matches
--     nothing produces a role somebody believes grants access it does not.
--   * **Deleting a role says where its people go.** `p_move_to` is required,
--     exactly as `app.delete_library_category` requires it. Removing a role and
--     deciding what happens to the people holding it are different decisions,
--     and `roles.id` is `on delete restrict` from the membership anyway.
--   * **An invitation is shown once.** The raw token is returned to the caller
--     and never stored, matching 0190's API keys. What is written down is the
--     hash, so a database read — or a backup, or a support engineer — cannot be
--     turned into somebody's access to the company.
--
-- WORKFLOW.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- What a screen reads
-- -----------------------------------------------------------------------------

/*
 * The roles available to this company, with the number of people holding each.
 *
 * The count is joined through `companies` rather than taken over the whole
 * membership table. A system role is shared by every tenant on the platform, so
 * counting its members globally would have told a company how many people work
 * at every other company on GrounUp — through a column labeled "Users".
 */
create or replace view my_company_roles
with (security_invoker = true) as
select r.id,
       c.id                                             as company_id,
       r.key,
       r.name,
       r.description,
       r.permissions,
       r.approval_tier,
       r.is_system,
       /* A system role is shipped and shared; only a company's own is editable. */
       (r.company_id is not null)                       as is_editable,
       (select count(*) from company_memberships m
         where m.role_id = r.id
           and m.company_id = c.id
           and m.status in ('active', 'invited'))       as member_count
  from companies c
  join roles r on (r.company_id is null or r.company_id = c.id);

revoke all on my_company_roles from public, anon;
grant select on my_company_roles to authenticated, service_role;

comment on view my_company_roles is
  'Roles this company may assign — the shipped system roles plus its own — each with the number of its own people holding it. LIBRARY view.';

/** Who is in the company, what they may do, and whether they are still active. */
create or replace view my_company_members
with (security_invoker = true) as
select m.id,
       m.company_id,
       m.user_id,
       p.full_name,
       p.email,
       p.job_title,
       p.last_seen_at,
       m.role_id,
       r.key                                            as role_key,
       r.name                                           as role_name,
       r.approval_tier,
       m.status,
       m.is_owner,
       m.invited_at,
       m.joined_at,
       (m.user_id = auth.uid())                         as is_me
  from company_memberships m
  join roles r on r.id = m.role_id
  left join user_profiles p on p.id = m.user_id;

revoke all on my_company_members from public, anon;
grant select on my_company_members to authenticated, service_role;

comment on view my_company_members is
  'The people in this company, with the role each holds. ENTITY view.';

/** Invitations sent, and what became of them. */
create or replace view my_company_invitations
with (security_invoker = true) as
select i.id,
       i.company_id,
       i.email,
       i.role_id,
       r.name                                           as role_name,
       i.invited_by,
       p.full_name                                      as invited_by_name,
       i.expires_at,
       i.accepted_at,
       i.revoked_at,
       i.created_at,
       case
         when i.accepted_at is not null then 'accepted'
         when i.revoked_at  is not null then 'revoked'
         when i.expires_at  <= now()    then 'expired'
         else 'pending'
       end                                              as state
  from company_invitations i
  join roles r on r.id = i.role_id
  left join user_profiles p on p.id = i.invited_by;

revoke all on my_company_invitations from public, anon;
grant select on my_company_invitations to authenticated, service_role;

comment on view my_company_invitations is
  'Invitations this company has sent, and whether each is pending, accepted, revoked or expired. WORKFLOW view.';

-- -----------------------------------------------------------------------------
-- What the shipped roles actually grant, read rather than typed
-- -----------------------------------------------------------------------------

/**
 * Every permission key this platform recognizes.
 *
 * Derived from the shipped system roles instead of being written out here, so
 * it cannot fall behind the seeds the way a second list always does. A
 * permission absent from every system role is one `app.has_permission` would
 * never match, which makes it a typo rather than a capability.
 */
create or replace function app.known_permissions()
returns text[]
language sql stable security definer set search_path = public, pg_catalog
as $$
  select coalesce(array_agg(distinct perm order by perm), '{}')
    from roles r, unnest(r.permissions) perm
   where r.is_system and perm <> '*';
$$;

comment on function app.known_permissions() is
  'The permission keys the shipped system roles grant, which is exactly the set app.has_permission can match. Read from the seeds so a new permission needs no second edit here. LIBRARY.';

/**
 * Refuse any permission the caller does not hold, and any that does not exist.
 *
 * The escalation this closes: `users.manage` is enough to write a role, so
 * without this check an administrator could create a role granting everything
 * and put themselves in it. Holding a permission is the prerequisite for
 * handing it to somebody else.
 */
create or replace function app.assert_grantable(p_company uuid, p_permissions text[])
returns void
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
declare
  v_unknown   text[];
  v_ungranted text[];
begin
  if p_permissions is null or cardinality(p_permissions) = 0 then
    raise exception 'A role that grants nothing gives its holder no way in'
      using errcode = 'check_violation',
            hint = 'Give it the least it needs. A role is easier to widen than to take back.';
  end if;

  if '*' = any (p_permissions) then
    raise exception 'A company role cannot grant every permission'
      using errcode = 'insufficient_privilege',
            hint = 'Only the shipped Owner role holds *. Assign that role instead of recreating it.';
  end if;

  select array_agg(perm) into v_unknown
    from unnest(p_permissions) perm
   where perm <> all (app.known_permissions());
  if v_unknown is not null then
    raise exception 'No such permission: %', array_to_string(v_unknown, ', ')
      using errcode = 'check_violation',
            hint = 'A permission nothing checks would grant access the holder does not get.';
  end if;

  select array_agg(perm) into v_ungranted
    from unnest(p_permissions) perm
   where not app.has_permission(p_company, perm);
  if v_ungranted is not null then
    raise exception 'You cannot grant a permission you do not hold: %',
      array_to_string(v_ungranted, ', ')
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

comment on function app.assert_grantable(uuid, text[]) is
  'Refuses a permission set that is unknown, empty, wildcard, or wider than the caller''s own. Closes privilege escalation through the role editor. WORKFLOW support.';

-- -----------------------------------------------------------------------------
-- Roles a company defines for itself
-- -----------------------------------------------------------------------------

create or replace function app.create_company_role(
  p_company       uuid,
  p_key           text,
  p_name          text,
  p_permissions   text[],
  p_description   text default null,
  p_approval_tier int default 0)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'users.manage');
  v_key     text := lower(nullif(btrim(coalesce(p_key, '')), ''));
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_id      uuid;
begin
  if v_name is null then
    raise exception 'A role needs a name' using errcode = 'check_violation';
  end if;
  if v_key is null then
    v_key := regexp_replace(lower(v_name), '[^a-z0-9]+', '_', 'g');
    v_key := btrim(v_key, '_');
  end if;
  if v_key !~ '^[a-z][a-z0-9_]{1,40}$' then
    raise exception 'A role key is lower case letters, digits and underscores'
      using errcode = 'check_violation', hint = 'For example: yard_foreman.';
  end if;
  if exists (select 1 from roles where key = v_key
              and (company_id is null or company_id = v_company)) then
    raise exception 'There is already a role called %', v_key
      using errcode = 'unique_violation',
            hint = 'One name for one thing — edit that role rather than adding a second.';
  end if;
  if coalesce(p_approval_tier, 0) not between 0 and 4 then
    raise exception 'An approval tier is 0 to 4' using errcode = 'check_violation';
  end if;

  /*
   * A role may not carry an approval tier above the caller's own. Otherwise
   * "who may sign off a senior review" becomes self-service, and the whole
   * point of a tier is that somebody above you holds it.
   */
  if coalesce(p_approval_tier, 0) > (
       select coalesce(max(r.approval_tier), 0) from company_memberships m
         join roles r on r.id = m.role_id
        where m.company_id = v_company and m.user_id = auth.uid()
          and m.status = 'active') then
    raise exception 'You cannot create a role that signs off above your own tier'
      using errcode = 'insufficient_privilege';
  end if;

  perform app.assert_grantable(v_company, p_permissions);

  insert into roles (company_id, key, name, description, permissions, approval_tier, is_system)
  values (v_company, v_key, v_name,
          nullif(btrim(coalesce(p_description, '')), ''),
          p_permissions, coalesce(p_approval_tier, 0), false)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function app.set_company_role(
  p_role          uuid,
  p_name          text default null,
  p_permissions   text[] default null,
  p_description   text default null,
  p_approval_tier int default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_row roles%rowtype;
begin
  select * into v_row from roles where id = p_role;
  if v_row.id is null then
    raise exception 'No such role' using errcode = 'no_data_found';
  end if;
  if v_row.is_system or v_row.company_id is null then
    raise exception 'A shipped role cannot be edited'
      using errcode = 'insufficient_privilege',
            hint = 'Create your own role with the permissions you want and assign that instead.';
  end if;
  perform app.company_for_write(v_row.company_id, 'users.manage');

  if p_permissions is not null then
    perform app.assert_grantable(v_row.company_id, p_permissions);
  end if;
  if p_approval_tier is not null and p_approval_tier not between 0 and 4 then
    raise exception 'An approval tier is 0 to 4' using errcode = 'check_violation';
  end if;

  update roles
     set name          = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
         description   = coalesce(nullif(btrim(coalesce(p_description, '')), ''), description),
         permissions   = coalesce(p_permissions, permissions),
         approval_tier = coalesce(p_approval_tier, approval_tier),
         updated_at    = now()
   where id = p_role;
end;
$$;

/**
 * Remove a company role, saying which role its people move to.
 *
 * `p_move_to` is not optional, for the same reason it is not optional on
 * `app.delete_library_category`: removing a role and deciding what the people
 * holding it may now do are two different decisions, and leaving the second one
 * implicit is how somebody loses access without anybody choosing that.
 */
create or replace function app.delete_company_role(p_role uuid, p_move_to uuid)
returns int
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_row   roles%rowtype;
  v_to    roles%rowtype;
  v_moved int;
begin
  select * into v_row from roles where id = p_role;
  if v_row.id is null then
    raise exception 'No such role' using errcode = 'no_data_found';
  end if;
  if v_row.is_system or v_row.company_id is null then
    raise exception 'A shipped role cannot be removed' using errcode = 'insufficient_privilege';
  end if;
  perform app.company_for_write(v_row.company_id, 'users.manage');

  if p_move_to is null then
    raise exception 'Say which role to move these people into'
      using errcode = 'check_violation',
            hint = 'Removing a role and changing what its people may do are different decisions.';
  end if;
  select * into v_to from roles where id = p_move_to
     and (company_id is null or company_id = v_row.company_id);
  if v_to.id is null then
    raise exception 'That role is not available to this company' using errcode = 'no_data_found';
  end if;
  if v_to.id = v_row.id then
    raise exception 'Move the people to a different role' using errcode = 'check_violation';
  end if;

  update company_memberships set role_id = p_move_to, updated_at = now()
   where role_id = p_role and company_id = v_row.company_id;
  get diagnostics v_moved = row_count;

  update company_invitations set role_id = p_move_to
   where role_id = p_role and accepted_at is null and revoked_at is null;

  delete from roles where id = p_role;
  return v_moved;
end;
$$;

-- -----------------------------------------------------------------------------
-- The people
-- -----------------------------------------------------------------------------

create or replace function app.set_member_role(p_membership uuid, p_role uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_m company_memberships%rowtype;
  v_r roles%rowtype;
begin
  select * into v_m from company_memberships where id = p_membership;
  if v_m.id is null then
    raise exception 'No such member' using errcode = 'no_data_found';
  end if;
  perform app.company_for_write(v_m.company_id, 'users.manage');

  select * into v_r from roles where id = p_role
     and (company_id is null or company_id = v_m.company_id);
  if v_r.id is null then
    raise exception 'That role is not available to this company' using errcode = 'no_data_found';
  end if;

  /*
   * Changing your own role is how an administrator locks themselves out of the
   * screen they are standing on, and the mistake is not recoverable by the
   * person who made it. Somebody else with the permission has to do it.
   */
  if v_m.user_id = auth.uid() then
    raise exception 'You cannot change your own role'
      using errcode = 'insufficient_privilege',
            hint = 'Another administrator or the owner can change it for you.';
  end if;

  update company_memberships set role_id = p_role, updated_at = now()
   where id = p_membership;
end;
$$;

create or replace function app.set_member_status(p_membership uuid, p_status text)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_m company_memberships%rowtype;
begin
  if p_status not in ('active', 'suspended', 'removed') then
    raise exception 'A member is active, suspended or removed' using errcode = 'check_violation';
  end if;
  select * into v_m from company_memberships where id = p_membership;
  if v_m.id is null then
    raise exception 'No such member' using errcode = 'no_data_found';
  end if;
  perform app.company_for_write(v_m.company_id, 'users.manage');

  if v_m.user_id = auth.uid() and p_status <> 'active' then
    raise exception 'You cannot suspend or remove your own access'
      using errcode = 'insufficient_privilege';
  end if;

  /* The last active owner leaving is refused by 0002's guard; this says it
     before the trigger does, in words about people rather than rows. */
  if v_m.is_owner and p_status <> 'active' and (
       select count(*) from company_memberships
        where company_id = v_m.company_id and is_owner and status = 'active') <= 1 then
    raise exception 'A company must keep at least one active owner'
      using errcode = 'check_violation',
            hint = 'Make somebody else an owner first.';
  end if;

  update company_memberships
     set status = p_status,
         joined_at = case when p_status = 'active' then coalesce(joined_at, now()) else joined_at end,
         updated_at = now()
   where id = p_membership;
end;
$$;

comment on function app.set_member_status(uuid, text) is
  'Suspend, restore or remove a person''s access to this company. Refuses the last active owner and refuses acting on yourself. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- Inviting somebody
-- -----------------------------------------------------------------------------

/**
 * Invite a person to the company. Returns the token, once.
 *
 * Nothing about the account is created here, deliberately: this platform never
 * makes somebody an authenticated user as a side effect of an administrator
 * typing their address. The invitation is a claim on a role that the person
 * redeems themselves, and the raw token — the only thing that redeems it — is
 * returned to the caller and never written down.
 */
create or replace function app.invite_member(
  p_company  uuid,
  p_email    text,
  p_role     uuid,
  p_days     int default 14)
returns table (id uuid, token text, expires_at timestamptz)
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'users.manage');
  v_email   text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_r       roles%rowtype;
  v_token   text;
  v_expires timestamptz;
  v_id      uuid;
begin
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That is not an email address' using errcode = 'check_violation';
  end if;
  if coalesce(p_days, 14) not between 1 and 90 then
    raise exception 'An invitation lasts between 1 and 90 days' using errcode = 'check_violation';
  end if;

  select * into v_r from roles where id = p_role
     and (company_id is null or company_id = v_company);
  if v_r.id is null then
    raise exception 'That role is not available to this company' using errcode = 'no_data_found';
  end if;

  if exists (
    select 1 from company_memberships m
      join user_profiles p on p.id = m.user_id
     where m.company_id = v_company and lower(p.email) = v_email
       and m.status in ('active', 'invited', 'suspended')) then
    raise exception '% is already in this company', v_email
      using errcode = 'unique_violation',
            hint = 'Change their role or restore their access instead of inviting them again.';
  end if;
  if exists (
    select 1 from company_invitations
     where company_id = v_company and lower(email) = v_email
       and accepted_at is null and revoked_at is null and expires_at > now()) then
    raise exception '% already has an invitation waiting', v_email
      using errcode = 'unique_violation',
            hint = 'Revoke the first one if you need to send a new link.';
  end if;

  /* Sixty-four hex characters, the same shape and strength as an API key's
     secret, and stored only as its hash. */
  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');
  v_expires := now() + make_interval(days => coalesce(p_days, 14));

  insert into company_invitations (
    company_id, email, role_id, token_hash, invited_by, expires_at)
  values (
    v_company, v_email, p_role, app.hash_api_key(v_token), auth.uid(), v_expires)
  returning company_invitations.id into v_id;

  return query select v_id, v_token, v_expires;
end;
$$;

create or replace function app.revoke_invitation(p_invitation uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_i company_invitations%rowtype;
begin
  select * into v_i from company_invitations where id = p_invitation;
  if v_i.id is null then
    raise exception 'No such invitation' using errcode = 'no_data_found';
  end if;
  perform app.company_for_write(v_i.company_id, 'users.manage');
  if v_i.accepted_at is not null then
    raise exception 'That invitation has already been accepted'
      using errcode = 'check_violation',
            hint = 'Suspend or remove their access instead.';
  end if;
  update company_invitations set revoked_at = now() where id = p_invitation;
end;
$$;

-- -----------------------------------------------------------------------------
-- The doors
-- -----------------------------------------------------------------------------

create or replace function public.create_company_role(
  p_company uuid, p_key text, p_name text, p_permissions text[],
  p_description text default null, p_approval_tier int default 0)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_company_role(p_company, p_key, p_name, p_permissions,
       p_description, p_approval_tier); $$;

create or replace function public.set_company_role(
  p_role uuid, p_name text default null, p_permissions text[] default null,
  p_description text default null, p_approval_tier int default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_company_role(p_role, p_name, p_permissions, p_description,
       p_approval_tier); $$;

create or replace function public.delete_company_role(p_role uuid, p_move_to uuid)
returns int language sql security invoker set search_path = public, pg_catalog
as $$ select app.delete_company_role(p_role, p_move_to); $$;

create or replace function public.set_member_role(p_membership uuid, p_role uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_member_role(p_membership, p_role); $$;

create or replace function public.set_member_status(p_membership uuid, p_status text)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_member_status(p_membership, p_status); $$;

create or replace function public.invite_member(
  p_company uuid, p_email text, p_role uuid, p_days int default 14)
returns table (id uuid, token text, expires_at timestamptz)
language sql security invoker set search_path = public, pg_catalog
as $$ select * from app.invite_member(p_company, p_email, p_role, p_days); $$;

create or replace function public.revoke_invitation(p_invitation uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.revoke_invitation(p_invitation); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.create_company_role(uuid, text, text, text[], text, int)',
    'public.set_company_role(uuid, text, text[], text, int)',
    'public.delete_company_role(uuid, uuid)',
    'public.set_member_role(uuid, uuid)',
    'public.set_member_status(uuid, text)',
    'public.invite_member(uuid, text, uuid, int)',
    'public.revoke_invitation(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
