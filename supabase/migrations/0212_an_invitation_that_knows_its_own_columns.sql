-- =============================================================================
-- 0212 — An invitation that knows its own columns
--
-- `app.invite_member` from 0211 declares `returns table (id uuid, token text,
-- expires_at timestamptz)`. In PL/pgSQL those three names are OUT parameters
-- and are in scope for the whole body, so every unqualified `id` or
-- `expires_at` in the function was ambiguous between the parameter and the
-- column of the same name — `where id = p_role` against `roles`, and
-- `and expires_at > now()` against `company_invitations`. Postgres raises
-- rather than guessing, which is the right call and exactly what happened:
-- `column reference "id" is ambiguous`.
--
-- The function is rebuilt with every column reference qualified. Nothing about
-- what it does changes.
-- =============================================================================

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
  v_role    roles%rowtype;
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

  select r.* into v_role from roles r
   where r.id = p_role and (r.company_id is null or r.company_id = v_company);
  if v_role.id is null then
    raise exception 'That role is not available to this company' using errcode = 'no_data_found';
  end if;

  if exists (
    select 1 from company_memberships m
      join user_profiles up on up.id = m.user_id
     where m.company_id = v_company and lower(up.email) = v_email
       and m.status in ('active', 'invited', 'suspended')) then
    raise exception '% is already in this company', v_email
      using errcode = 'unique_violation',
            hint = 'Change their role or restore their access instead of inviting them again.';
  end if;
  if exists (
    select 1 from company_invitations ci
     where ci.company_id = v_company and lower(ci.email) = v_email
       and ci.accepted_at is null and ci.revoked_at is null and ci.expires_at > now()) then
    raise exception '% already has an invitation waiting', v_email
      using errcode = 'unique_violation',
            hint = 'Revoke the first one if you need to send a new link.';
  end if;

  /* Sixty-four hex characters, the same shape and strength as an API key's
     secret, and stored only as its hash. */
  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');
  v_expires := now() + make_interval(days => coalesce(p_days, 14));

  insert into company_invitations as ci (
    company_id, email, role_id, token_hash, invited_by, expires_at)
  values (
    v_company, v_email, p_role, app.hash_api_key(v_token), auth.uid(), v_expires)
  returning ci.id into v_id;

  return query select v_id, v_token, v_expires;
end;
$$;

comment on function app.invite_member(uuid, text, uuid, int) is
  'Invites somebody to the company and returns the raw token once; only its SHA-256 hash is stored, so a database read cannot be replayed into access. Creates no account — the person redeems the invitation themselves. WORKFLOW.';
