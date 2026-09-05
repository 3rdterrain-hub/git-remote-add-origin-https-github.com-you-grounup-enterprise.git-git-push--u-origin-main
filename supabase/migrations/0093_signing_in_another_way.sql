-- =============================================================================
-- 0093 — Signing in another way
--
-- There has been one way in: an email address and a password somebody has to
-- invent, remember and later reset. Most people arriving at a construction
-- platform already have a Google account on the phone in their hand, and the
-- difference between one tap and inventing a password is the difference
-- between a signup and a bounce.
--
-- The provider itself is configured outside the database — Supabase Auth holds
-- the client ids and secrets, which is where they belong and nowhere this
-- repository should carry them. What the database owns is what happens after:
-- the profile that gets created, and it has been quietly wrong for anybody who
-- did not sign up by email.
--
-- `app.handle_new_user` reads `raw_user_meta_data ->> 'full_name'`, which is
-- the key the email signup form sets because this platform sets it. Google
-- sends `name`. Apple sends a name *once*, on the very first authorization,
-- and never again — so a profile that misses it on that first pass has missed
-- it permanently. Neither would have produced an error. Both would have
-- produced a customer whose name the platform does not know, which shows up as
-- a blank in every place a person is named.
-- =============================================================================

create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name text;
  v_avatar text;
begin
  /*
   * Every key a provider might have put the name under, in the order of how
   * much it is to be trusted. `full_name` is what this platform's own form
   * sets; `name` is what Google and most OAuth providers send; the given and
   * family pair is the fallback for a provider that only sends the parts.
   */
  v_name := coalesce(
    nullif(trim(coalesce(v_meta ->> 'full_name', '')), ''),
    nullif(trim(coalesce(v_meta ->> 'name', '')), ''),
    nullif(trim(
      coalesce(v_meta ->> 'given_name', '') || ' ' ||
      coalesce(v_meta ->> 'family_name', '')), '')
  );

  -- Google and Apple both offer a picture. Stored as given rather than copied
  -- into our own storage: it is their image, hosted by them, and mirroring it
  -- would mean holding a copy of somebody's face for no reason.
  v_avatar := nullif(trim(coalesce(
    v_meta ->> 'avatar_url', v_meta ->> 'picture', '')), '');

  insert into user_profiles (id, email, full_name, avatar_path)
  values (new.id, new.email, v_name, v_avatar)
  on conflict (id) do update set
    /*
     * A second identity linked to the same person fills in what the first one
     * did not, and overwrites nothing. Somebody who signed up by email and set
     * their name, then linked Google, keeps the name they chose.
     */
    full_name = coalesce(user_profiles.full_name, excluded.full_name),
    avatar_path = coalesce(user_profiles.avatar_path, excluded.avatar_path),
    email = coalesce(user_profiles.email, excluded.email);

  return new;
end;
$$;

comment on function app.handle_new_user is
  'Creates the application profile when Supabase Auth creates a user, reading the name from whichever key the provider used — `full_name` from this platform''s own form, `name` from Google, the given and family pair from anything that only sends parts. Apple sends a name once and never again, so missing it on the first pass would miss it permanently. Filling in on conflict rather than overwriting, so linking a second identity never replaces a name somebody chose.';

/*
 * Backfill anybody already affected.
 *
 * If a social identity has already signed in, their profile carries a null
 * name that nothing would ever fix — the trigger only fires on insert, and the
 * row exists.
 */
update user_profiles p
   set full_name = coalesce(
         nullif(trim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), ''),
         nullif(trim(coalesce(u.raw_user_meta_data ->> 'name', '')), ''),
         nullif(trim(
           coalesce(u.raw_user_meta_data ->> 'given_name', '') || ' ' ||
           coalesce(u.raw_user_meta_data ->> 'family_name', '')), '')),
       avatar_path = coalesce(p.avatar_path, nullif(trim(coalesce(
         u.raw_user_meta_data ->> 'avatar_url',
         u.raw_user_meta_data ->> 'picture', '')), ''))
  from auth.users u
 where u.id = p.id
   and p.full_name is null;

select app.assert_security_gates();
