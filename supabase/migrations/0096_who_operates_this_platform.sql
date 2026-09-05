-- =============================================================================
-- 0096 — Who operates this platform, in one query
--
-- `loadOperators` asked PostgREST to embed `user_profiles` inside
-- `platform_admins` to get each operator's email. There is no foreign key
-- between them — `platform_admins.user_id` references `auth.users`, which is
-- the right reference and not one PostgREST can follow into `user_profiles` —
-- so every call returned:
--
--   Could not find a relationship between 'platform_admins' and
--   'user_profiles' in the schema cache
--
-- It has been failing since the operator console was built. It went unnoticed
-- because the screen it was on put the operator list third, under two things
-- that worked, so the failure showed as one broken card rather than a broken
-- page. Moving it to the top of the Roles screen made it the whole page, which
-- is how it surfaced.
--
-- Fixed the way every other cross-cutting question on this console is answered:
-- a view that does the join in SQL, gated on the permission, rather than an
-- embed the client has to get right.
-- =============================================================================

create or replace view admin_operators as
select
  a.id,
  a.user_id,
  up.email,
  up.full_name,
  a.role,
  a.role_key,
  r.name                                  as role_name,
  r.permissions,
  a.reason,
  a.granted_at,
  a.granted_by,
  a.revoked_at,
  a.revoke_reason,
  (a.revoked_at is null)                  as active,
  -- What they have actually done lately, so a list of people is also a list of
  -- who is using the access they hold.
  (select max(e.occurred_at) from audit_events e where e.actor_id = a.user_id)
                                          as last_action_at
from platform_admins a
left join user_profiles up on up.id = a.user_id
left join platform_roles r on r.key = a.role_key
where app.operator_can('operators.manage')
order by
  case when a.revoked_at is null then 0 else 1 end,
  a.granted_at desc;

comment on view admin_operators is
  'Everybody who operates this platform, with their email, their role and what it permits. A view rather than a PostgREST embed because `platform_admins.user_id` references `auth.users` — the correct reference, and not one the client can follow into `user_profiles`, which is why the embed had never worked.';

grant select on admin_operators to authenticated;
revoke all on admin_operators from anon;

select app.assert_security_gates();
