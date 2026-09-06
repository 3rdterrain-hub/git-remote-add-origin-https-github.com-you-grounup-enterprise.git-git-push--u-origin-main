-- =============================================================================
-- 0104 — A workspace arranged your way
--
-- `user_profiles.preferences` has been a jsonb column since migration 0002 and
-- nothing has ever written to it. The navigation is a constant in the shell:
-- eighteen items in one order down the left, the same for a chief estimator
-- who lives in the estimator and a fleet manager who never opens it.
--
-- A preference belongs to the person, not the company — the same estimator
-- working for two companies wants their own arrangement in both — so it lives
-- on the profile, and it is saved one key at a time.
--
-- Merging rather than replacing is the whole design of the setter. Two screens
-- that each save the whole preferences object will overwrite each other's work
-- the moment somebody has two tabs open, and the loss is silent: the second
-- save looks exactly like a successful one.
-- =============================================================================

/**
 * Save one preference.
 *
 * `jsonb_set` with `create_missing` so a key that is not there yet is added
 * rather than ignored, and the rest of the object is untouched. Passing SQL
 * NULL for the value removes the key, which is how a person goes back to the
 * default rather than to an empty version of the thing.
 */
create or replace function app.set_my_preference(p_key text, p_value jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_prefs jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in to save a preference' using errcode = 'insufficient_privilege';
  end if;
  if p_key is null or p_key !~ '^[a-z][a-z0-9_.]{0,60}$' then
    raise exception 'A preference key is lowercase letters, digits, dots and underscores'
      using errcode = 'check_violation';
  end if;

  update user_profiles
     set preferences = case
           when p_value is null then preferences - p_key
           else jsonb_set(preferences, array[p_key], p_value, true)
         end,
         updated_at = now()
   where id = auth.uid()
  returning preferences into v_prefs;

  if v_prefs is null then
    raise exception 'No profile for the signed-in user' using errcode = 'no_data_found';
  end if;
  return v_prefs;
end;
$$;

comment on function app.set_my_preference(text, jsonb) is
  'Saves one key of the caller''s own preferences, merging into what is there. Merging rather than replacing is deliberate: two tabs each writing the whole object would silently overwrite each other.';

revoke all on function app.set_my_preference(text, jsonb) from public, anon;
grant execute on function app.set_my_preference(text, jsonb) to authenticated;

create or replace function public.set_my_preference(p_key text, p_value jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin return app.set_my_preference(p_key, p_value); end; $$;

revoke all on function public.set_my_preference(text, jsonb) from public, anon;
grant execute on function public.set_my_preference(text, jsonb) to authenticated;

/**
 * The caller's own preferences.
 *
 * A view rather than a direct read of `user_profiles` because the profile also
 * carries a colleague-visible select policy, and preferences are nobody's
 * business but the owner's — a person's arrangement of their own sidebar is
 * not something the rest of the company needs to see.
 */
create or replace view my_preferences
with (security_invoker = true) as
select p.id as user_id, p.preferences, p.locale, p.timezone
from user_profiles p
where p.id = auth.uid();

revoke all on my_preferences from public, anon;
grant select on my_preferences to authenticated;

comment on view my_preferences is
  'The signed-in person''s own preferences, locale and time zone. Narrower than reading user_profiles directly, which colleagues can also select from.';

select app.assert_security_gates();
