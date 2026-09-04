-- =============================================================================
-- 0059 — Signing up has to produce a company
--
-- `app.provision_company()` has existed since migration 0011. It creates the
-- company, makes the caller its owner, seeds a default pricing profile with
-- overhead, profit and contingency so the first estimate can be priced
-- immediately, starts the plan trial with a bounded expiry, and audits all of
-- it. It is correct, it is granted to `authenticated`, and **nothing has ever
-- called it outside the test suite.**
--
-- So the real sign-up path ends like this: Supabase Auth creates the user,
-- migration 0055's trigger creates the profile, and there it stops. No company,
-- no membership, no role. Every screen resolves to an empty list, permanently,
-- because row level security correctly shows a person with no membership
-- nothing at all. There is currently no way to become a customer of this
-- platform.
--
-- The same shape as migration 0055 one file later: a capability fully built and
-- never connected to the thing that needs it.
--
-- Two problems stood between the function and a sign-up form, and both are
-- solved here rather than in the browser:
--
--   * **The slug is globally unique.** Two companies called Ridgeline
--     Construction produce the same slug and the second sign-up fails on a
--     constraint. Deriving the slug in the browser and hoping is a race: two
--     people can be told the same slug is free.
--   * **A double submit creates two companies.** A slow network and an
--     impatient click would leave a person owning two identical tenants with
--     the trial split between them.
--
-- Both are handled in one function that runs in one transaction, because that
-- is the only place they can be handled correctly.
-- =============================================================================

/**
 * A URL-safe slug for a company name.
 *
 * Not unique on its own — uniqueness is settled inside the transaction that
 * inserts, where it can actually be guaranteed.
 */
create or replace function app.slugify(p_text text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select nullif(
    substring(
      trim(both '-' from
        regexp_replace(
          regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'),
          '-+', '-', 'g')),
      1, 60),
    '');
$$;

comment on function app.slugify(text) is
  'A company name reduced to the slug alphabet. Deliberately not unique: uniqueness is resolved by app.create_my_company inside the inserting transaction, because a uniqueness check in the browser is a race two people can both win.';

/**
 * Create the caller's company, from a name alone.
 *
 * The one call a sign-up form needs. It derives a slug, resolves a collision by
 * suffixing, and hands off to `app.provision_company()` — which remains the
 * single place a company is actually built, so a tenant created here and one
 * created by a test are the same object with the same defaults.
 *
 * Returning the existing company for a repeated identical name makes a double
 * submit harmless. Deliberately narrow: it matches on the caller's own active
 * ownership and the same name, so somebody who genuinely wants a second company
 * called "Ridgeline Construction" is only prevented from creating it by
 * accident within the same breath. That is the right trade for a sign-up form,
 * where an accidental duplicate is common and a deliberate one is not.
 */
create or replace function app.create_my_company(
  p_name    text,
  p_plan_id text default 'starter'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user    uuid := auth.uid();
  v_base    text;
  v_slug    text;
  v_company uuid;
  v_try     int := 0;
begin
  if v_user is null then
    raise exception 'Sign in before creating a company'
      using errcode = 'insufficient_privilege';
  end if;

  if p_name is null or length(trim(p_name)) < 2 then
    raise exception 'A company needs a name'
      using errcode = 'check_violation';
  end if;

  -- A repeated submit of the same name returns what the first one made.
  select c.id into v_company
  from companies c
  join company_memberships m on m.company_id = c.id
  where m.user_id = v_user and m.is_owner and m.status = 'active'
    and lower(trim(c.name)) = lower(trim(p_name))
  limit 1;
  if v_company is not null then
    return v_company;
  end if;

  v_base := app.slugify(p_name);
  if v_base is null then
    -- A name of nothing but punctuation still has to produce a valid slug.
    v_base := 'company';
  end if;

  loop
    v_slug := case when v_try = 0 then v_base
                   else substring(v_base, 1, 54) || '-' || v_try end;
    begin
      v_company := app.provision_company(p_name, v_slug, p_plan_id);
      return v_company;
    exception when unique_violation then
      v_try := v_try + 1;
      -- A name whose slug is taken a hundred times over is not a collision any
      -- more; it is somebody hammering the form, and it should stop.
      if v_try > 100 then
        raise exception 'Could not find an available address for "%"', p_name
          using errcode = 'check_violation',
                hint = 'Try a more specific company name.';
      end if;
    end;
  end loop;
end;
$$;

revoke all on function app.create_my_company(text, text) from public, anon;
grant execute on function app.create_my_company(text, text) to authenticated;

comment on function app.create_my_company(text, text) is
  'Creates the caller''s company from a name, resolving the globally unique slug inside the transaction that inserts it. The one call a sign-up form makes. Repeating the same name returns the company the first call created, so a double submit cannot split a trial across two tenants.';

/**
 * The companies the caller belongs to, and what they are there.
 *
 * A sign-up form needs to know whether to show itself; an application shell
 * needs to know where to send somebody. Both questions are the same one, and
 * answering it with a view rather than a client-side join means the answer
 * cannot differ between the two callers.
 */
create or replace view my_companies
with (security_invoker = true) as
select
  c.id            as company_id,
  c.name,
  c.slug,
  m.is_owner,
  m.status        as membership_status,
  r.key           as role_key,
  r.name          as role_name,
  r.approval_tier,
  e.plan_id,
  e.is_active     as entitlement_active,
  e.valid_until   as entitlement_valid_until,
  e.source        as entitlement_source,
  c.created_at
from companies c
join company_memberships m on m.company_id = c.id and m.user_id = auth.uid()
join roles r on r.id = m.role_id
left join lateral (
  select plan_id, is_active, valid_until, source
  from entitlements en
  where en.company_id = c.id
  order by en.created_at desc
  limit 1
) e on true;

comment on view my_companies is
  'Where the signed-in person belongs, what they are there, and the standing of that company''s entitlement. One answer for the sign-up form and the application shell, so the two cannot disagree about whether somebody has a company.';

grant select on my_companies to authenticated;
revoke all on my_companies from anon;

select app.assert_security_gates();
