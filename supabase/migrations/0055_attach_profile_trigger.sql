-- =============================================================================
-- 0055 — The trigger the platform described and never attached
--
-- @implements CPF-000006
--
-- `app.handle_new_user()` creates the application profile when Supabase Auth
-- creates a user. It has existed since migration 0011, it is correct, it is
-- idempotent — and **nothing ever attached it**. Its own comment reads "Attach
-- with: create trigger on_auth_user_created after insert on auth.users ...",
-- which is an instruction sitting in a database rather than a trigger.
--
-- On a real deployment that means somebody signs up, Supabase Auth creates the
-- row, and no `user_profiles` record appears. Every join that resolves a person
-- finds nothing: the audit ledger's actor email added in migration 0050,
-- membership provisioning, the approver on a library row. The first user of the
-- platform would have no profile.
--
-- It survived because the test harness creates `auth.users` itself and every
-- test inserted its own profile alongside the user, so no test ever exercised
-- the path a real sign-up takes. The harness now carries `raw_user_meta_data`
-- as Supabase does, and this trigger runs in the tests too — so the production
-- sign-up path is exercised by every suite that creates a user.
--
-- Creating a trigger on `auth.users` from a migration is the pattern Supabase
-- documents for exactly this; `supabase db push` runs with the privileges it
-- needs.
-- =============================================================================

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

comment on function app.handle_new_user is
  'Creates the application profile when Supabase Auth creates a user. Attached to auth.users by migration 0055 — it spent forty-four migrations as an instruction in a comment, which meant a real sign-up produced no profile at all. Idempotent, so a caller that also writes the profile explicitly is harmless.';

select app.assert_security_gates();
