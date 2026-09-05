-- =============================================================================
-- 0073 — The superadmin hires
--
-- Migration 0064 said there was deliberately no way to add an operator from a
-- screen, because it is the most powerful grant in the system. That reasoning
-- holds for **superadmin** and does not hold for **sales**, and treating them
-- the same made an ordinary business act — taking somebody on to sell — into a
-- database chore.
--
-- So the two are separated the way the roles already are:
--
--   * **Sales is hired from the console.** The superadmin grants it, with a
--     reason, and can revoke it. That is a normal management action and it
--     should not require a SQL editor.
--   * **Superadmin is not.** There is one, the database enforces one, and
--     handing it over remains a deliberate act outside the product. A screen
--     that could mint a superadmin is a screen worth attacking.
--
-- The person has to already have an account. GrounUp does not create logins for
-- people — that is the identity provider's job, and inventing a user here would
-- mean this platform issuing credentials it cannot manage.
-- =============================================================================

/**
 * Take somebody on as a sales operator.
 *
 * Addressed by email because that is what a person hiring somebody actually
 * has. Refuses if no account exists rather than creating one: they sign up
 * first, like everybody else, and then they are granted.
 */
create or replace function app.hire_operator(
  p_email  text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user uuid;
  v_id   uuid;
begin
  if not app.is_superadmin() then
    raise exception 'Only the superadmin may take somebody on'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'Say who this is and why they need access'
      using errcode = 'check_violation';
  end if;

  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'No account here uses %', p_email
      using errcode = 'no_data_found',
            hint = 'They sign up first, then you grant them access. '
                   'GrounUp does not create logins for people.';
  end if;

  if exists (select 1 from platform_admins
             where user_id = v_user and revoked_at is null) then
    raise exception '% already has operator access', p_email
      using errcode = 'unique_violation';
  end if;

  /*
   * Sales, always. A screen that could mint a superadmin is a screen worth
   * attacking, and there is exactly one superadmin by construction anyway.
   */
  insert into platform_admins (user_id, reason, role, granted_by)
  values (v_user, trim(p_reason), 'sales', auth.uid())
  returning id into v_id;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (null, auth.uid(), 'insert', 'public.platform_admins', v_id::text,
          jsonb_build_object('role', 'sales', 'email', lower(trim(p_email))),
          trim(p_reason));

  return v_id;
end;
$$;

/**
 * Withdraw operator access.
 *
 * Retires the grant rather than deleting it, so a past administration stays
 * answerable — the same reason `platform_admins` has a `revoked_at` at all.
 *
 * The superadmin's own seat cannot be revoked here. Losing it from a screen
 * would leave a platform with nobody able to grant anything, and recovering
 * from that means the database anyway; handover stays a deliberate act.
 */
create or replace function app.revoke_operator(
  p_user_id uuid,
  p_reason  text
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_role text;
begin
  if not app.is_superadmin() then
    raise exception 'Only the superadmin may withdraw operator access'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'Say why access is being withdrawn'
      using errcode = 'check_violation';
  end if;

  select role into v_role from platform_admins
  where user_id = p_user_id and revoked_at is null;

  if v_role is null then
    raise exception 'That person does not currently hold operator access'
      using errcode = 'no_data_found';
  end if;
  if v_role = 'superadmin' then
    raise exception 'The superadmin seat cannot be given up from a screen'
      using errcode = 'insufficient_privilege',
            hint = 'Losing it here would leave nobody able to grant anything. '
                   'Handover is done in the database, deliberately.';
  end if;

  update platform_admins
     set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = trim(p_reason)
   where user_id = p_user_id and revoked_at is null;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (null, auth.uid(), 'update', 'public.platform_admins', p_user_id::text,
          jsonb_build_object('revoked', true), trim(p_reason));
end;
$$;

revoke all on function app.hire_operator(text, text) from public, anon;
revoke all on function app.revoke_operator(uuid, text) from public, anon;
grant execute on function app.hire_operator(text, text) to authenticated;
grant execute on function app.revoke_operator(uuid, text) to authenticated;

comment on function app.hire_operator(text, text) is
  'Grants sales operator access to somebody who already has an account. Sales only: a screen that could mint a superadmin is a screen worth attacking, and there is exactly one by construction. Refuses to create a login — GrounUp does not issue credentials it cannot manage.';

comment on function app.revoke_operator(uuid, text) is
  'Withdraws operator access, retiring the grant rather than deleting it so a past administration stays answerable. Refuses to give up the superadmin seat: losing it from a screen would leave nobody able to grant anything.';

-- -----------------------------------------------------------------------------
-- Reachable from a browser
-- -----------------------------------------------------------------------------
create or replace function public.hire_operator(p_email text, p_reason text)
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin return app.hire_operator(p_email, p_reason); end; $$;

create or replace function public.revoke_operator(p_user_id uuid, p_reason text)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.revoke_operator(p_user_id, p_reason); end; $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.hire_operator(text, text)',
    'public.revoke_operator(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

select app.assert_security_gates();
