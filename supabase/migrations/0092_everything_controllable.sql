-- =============================================================================
-- 0092 — Everything controllable
--
-- Four things an operator could see and not change.
--
-- **Allowances.** AI credits and storage are the two things that cost real
-- money to serve, and the only lever was the plan — which is the same for
-- everybody. Giving one customer more meant editing `entitlements` by hand,
-- and the Stripe webhook upserts that whole row, so the change would survive
-- exactly until the next invoice. This is the identical problem migration 0064
-- solved for features, and it gets the identical answer: overrides in their own
-- table that compose over the plan rather than editing it.
--
-- **The trial.** `plans.trial_days` has been readable on the packages screen
-- since it existed and writable nowhere. Deciding a trial is fourteen days and
-- then not being able to make it thirty is a strange kind of control.
--
-- **A company's plan.** `change-subscription` exists and checks
-- `billing.manage` *on that company* — which an operator, deliberately a member
-- of no company, does not have. So the one function for moving a customer
-- between plans was unreachable from the console that exists to move customers
-- between plans.
--
-- **Deleting a company.** Migration 0072 made it possible and nothing made it
-- reachable. A customer who asks to be deleted has to be deletable.
--
-- The through-line: an operator could read everything and change almost
-- nothing, and every gap had the same cause — the control existed for a
-- company member and the operator is not one.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Allowances that survive the next invoice
-- -----------------------------------------------------------------------------
create table allowance_overrides (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  /*
   * The same five keys `app.plan_limit` already understands. A closed list
   * rather than free text, because an override on a key nothing reads is an
   * override that appears to work.
   */
  allowance     text not null check (allowance in (
    'max_seats', 'max_active_estimates', 'max_active_projects',
    'storage_gb', 'ai_credits_per_month')),
  -- Null is unlimited, which is a real and useful setting.
  amount        int check (amount is null or amount >= 0),
  unlimited     boolean not null default false,
  reason        text not null check (length(trim(reason)) >= 5),
  granted_by    uuid references auth.users(id) on delete set null,
  valid_until   timestamptz,
  revoked_at    timestamptz,
  revoked_by    uuid references auth.users(id) on delete set null,
  revoke_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Either a number or unlimited, never both and never neither.
  constraint allowance_overrides_shape check (unlimited = (amount is null))
);

comment on table allowance_overrides is
  'More (or less) of a metered allowance for one company. ENTITY. Composes over the plan rather than editing the entitlement, for the same reason feature overrides do: the Stripe webhook upserts the whole entitlement row, so a hand-edited allowance would survive exactly until the next invoice.';

create unique index if not exists allowance_overrides_one_live
  on allowance_overrides (company_id, allowance) where revoked_at is null;
create index if not exists allowance_overrides_company on allowance_overrides (company_id);

select app.apply_tenant_rls('allowance_overrides');
select app.attach_standard_triggers('public.allowance_overrides'::regclass);
select app.guard_suspension('allowance_overrides');

-- A customer reads their own; writes go through the function below.
drop policy if exists allowance_overrides_insert on allowance_overrides;
drop policy if exists allowance_overrides_update on allowance_overrides;
drop policy if exists allowance_overrides_delete on allowance_overrides;

/*
 * `plan_limit` learns about overrides. An override wins over the entitlement,
 * which wins over the plan — the same precedence feature overrides already
 * have, so there is one rule for both rather than two that look alike.
 */
create or replace function app.plan_limit(p_company uuid, p_key text)
returns int
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
declare
  v        int;
  v_live   boolean;
  v_over   allowance_overrides%rowtype;
begin
  if p_key not in ('max_seats', 'max_active_estimates', 'max_active_projects',
                   'storage_gb', 'ai_credits_per_month') then
    raise exception 'Unknown plan limit "%".', p_key using errcode = 'invalid_parameter_value';
  end if;

  select * into v_over from allowance_overrides o
   where o.company_id = p_company and o.allowance = p_key and o.revoked_at is null
     and (o.valid_until is null or o.valid_until > now());
  if found then
    -- Unlimited is null, which is what every caller already reads as unlimited.
    return v_over.amount;
  end if;

  select exists (select 1 from entitlements e
                  where e.company_id = p_company and e.is_active
                    and (e.valid_until is null or e.valid_until > now()))
    into v_live;

  if v_live then
    execute format(
      'select e.%I from entitlements e where e.company_id = $1 and e.is_active
         and (e.valid_until is null or e.valid_until > now())', p_key)
    into v using p_company;
  else
    execute format('select p.%I from plans p where p.id = $1', p_key)
    into v using app.effective_plan(p_company);
  end if;

  return v;
end;
$$;

comment on function app.plan_limit(uuid, text) is
  'The numeric limit a company is entitled to, or NULL for unlimited. An override wins over the entitlement, which wins over the plan — the same precedence feature overrides have, so there is one rule rather than two that look alike. A lapsed entitlement returns the free plan''s allowance rather than NULL.';

create or replace function app.set_allowance(
  p_company uuid, p_allowance text, p_amount int, p_reason text,
  p_valid_until timestamptz default null)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_id uuid;
begin
  if not app.operator_can('features.manage') then
    raise exception 'You do not have permission to change a company''s allowances'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'Say why this company gets a different allowance'
      using errcode = 'check_violation';
  end if;
  if p_amount is not null and p_amount < 0 then
    raise exception 'An allowance is zero or more, or unlimited'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from companies where id = p_company) then
    raise exception 'Company % not found', p_company using errcode = 'no_data_found';
  end if;

  update allowance_overrides
     set revoked_at = now(), revoked_by = auth.uid(),
         revoke_reason = 'Replaced: ' || trim(p_reason)
   where company_id = p_company and allowance = p_allowance and revoked_at is null;

  insert into allowance_overrides
    (company_id, allowance, amount, unlimited, reason, granted_by, valid_until)
  values (p_company, p_allowance, p_amount, p_amount is null,
          trim(p_reason), auth.uid(), p_valid_until)
  returning id into v_id;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (p_company, auth.uid(), 'update', 'public.allowance_overrides', v_id::text,
          jsonb_build_object('allowance', p_allowance, 'amount', p_amount,
                             'unlimited', p_amount is null),
          trim(p_reason));
  return v_id;
end;
$$;

create or replace function app.clear_allowance(
  p_company uuid, p_allowance text, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
begin
  if not app.operator_can('features.manage') then
    raise exception 'You do not have permission to change a company''s allowances'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'Say why it is going back to the plan' using errcode = 'check_violation';
  end if;

  update allowance_overrides
     set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = trim(p_reason)
   where company_id = p_company and allowance = p_allowance and revoked_at is null;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (p_company, auth.uid(), 'delete', 'public.allowance_overrides', p_allowance,
          jsonb_build_object('allowance', p_allowance), trim(p_reason));
end;
$$;

-- -----------------------------------------------------------------------------
-- The trial, which was readable and not writable
-- -----------------------------------------------------------------------------
create or replace function app.set_plan_trial(p_plan text, p_days int, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_before int;
begin
  if not app.operator_can('pricing.manage') then
    raise exception 'You do not have permission to change the trial'
      using errcode = 'insufficient_privilege';
  end if;
  if p_days is null or p_days < 0 or p_days > 365 then
    raise exception 'A trial runs between nothing and a year' using errcode = 'check_violation';
  end if;

  select trial_days into v_before from plans where id = p_plan;
  if v_before is null then
    raise exception 'Plan % does not exist', p_plan using errcode = 'no_data_found';
  end if;

  update plans set trial_days = p_days, updated_at = now() where id = p_plan;

  /*
   * Companies already on a trial keep the one they were given. Shortening a
   * trial somebody is halfway through is a change of terms after the fact, and
   * lengthening it silently is a promise nobody made — either way, what they
   * signed up to is what they get.
   */
  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (null, auth.uid(), 'update', 'public.plans', p_plan,
          jsonb_build_object('trial_days', p_days, 'was', v_before),
          coalesce(nullif(trim(coalesce(p_reason, '')), ''),
                   'Trial changed from the operator console'));
end;
$$;

-- -----------------------------------------------------------------------------
-- Moving a company between plans
--
-- `change-subscription` checks `billing.manage` on the company, which an
-- operator does not have and should not. This is the operator's path: it moves
-- the entitlement, and it says plainly that it does not move Stripe.
-- -----------------------------------------------------------------------------
create or replace function app.set_company_plan(
  p_company uuid, p_plan text, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_plan plans%rowtype;
  v_paying boolean;
begin
  if not app.operator_can('features.manage') then
    raise exception 'You do not have permission to move a company between plans'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'Say why this company is moving' using errcode = 'check_violation';
  end if;

  select * into v_plan from plans where id = p_plan;
  if not found then
    raise exception 'Plan % does not exist', p_plan using errcode = 'no_data_found';
  end if;

  /*
   * A company with a live Stripe subscription is refused, and deliberately.
   * Moving their entitlement here would leave GrounUp saying one thing and
   * Stripe billing another until somebody noticed — which is the disagreement
   * the operator dashboard already counts. Their plan changes in Stripe, and
   * the webhook brings it back.
   */
  select exists (select 1 from subscriptions s
                  where s.company_id = p_company
                    and s.status in ('trialing', 'active', 'past_due'))
    into v_paying;
  if v_paying then
    raise exception 'That company has a live Stripe subscription'
      using errcode = 'check_violation',
            hint = 'Change it in Stripe and the webhook will bring it back, or end the '
                   'subscription first. Moving it here would leave the two disagreeing.';
  end if;

  insert into entitlements (company_id, plan_id, is_active, features, max_seats,
                            max_active_estimates, max_active_projects, storage_gb,
                            ai_credits_per_month, source, granted_by, grant_reason)
  values (p_company, v_plan.id, true, v_plan.features, v_plan.max_seats,
          v_plan.max_active_estimates, v_plan.max_active_projects, v_plan.storage_gb,
          v_plan.ai_credits_per_month, 'manual_grant', auth.uid(), trim(p_reason))
  on conflict (company_id) do update set
    plan_id = excluded.plan_id, is_active = true, features = excluded.features,
    max_seats = excluded.max_seats,
    max_active_estimates = excluded.max_active_estimates,
    max_active_projects = excluded.max_active_projects,
    storage_gb = excluded.storage_gb,
    ai_credits_per_month = excluded.ai_credits_per_month,
    source = 'manual_grant', granted_by = excluded.granted_by,
    grant_reason = excluded.grant_reason, valid_until = null, updated_at = now();

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (p_company, auth.uid(), 'update', 'public.entitlements', p_company::text,
          jsonb_build_object('plan', p_plan, 'source', 'manual_grant'), trim(p_reason));
end;
$$;

-- -----------------------------------------------------------------------------
-- Deleting a company
--
-- Migration 0072 made it possible and nothing made it reachable. A customer who
-- asks to be deleted has to be deletable, and a platform that cannot honor that
-- has a compliance problem rather than a housekeeping one.
-- -----------------------------------------------------------------------------
/*
 * The append-only ledgers block the cascade.
 *
 * `library_row_versions`, `plan_versions` and the rest carry
 * `app.forbid_mutation()`, which refuses every DELETE — including the one
 * Postgres issues on its own while cascading a company away. So a company
 * could not actually be deleted, by anybody, for the second time in this
 * schema's life: migration 0072 found the same thing in `protect_last_owner`
 * and fixed it the same way.
 *
 * The distinction is the one 0072 drew. During a cascade the parent row is
 * already gone by the time the child trigger runs, so a guard can ask whether
 * the company still exists: if it does not, this delete is the cascade rather
 * than somebody editing history, and history is going with the company it
 * belonged to.
 *
 * An edit is still refused, which is the whole point of the ledger. What is
 * permitted is a row leaving because the tenant it described has left.
 */
create or replace function app.forbid_mutation_except_cascade()
returns trigger
language plpgsql security definer set search_path = public, pg_catalog
as $$
begin
  -- The cascade that removes the row along with its company.
  if tg_op = 'DELETE' and old.company_id is not null
     and not exists (select 1 from companies c where c.id = old.company_id) then
    return old;
  end if;

  /*
   * And the cascade that keeps the row and lets go of the company. Migration
   * 0072 made `audit_events.company_id` nullable on delete precisely so the
   * ledger survives the tenant it recorded — which means the cascade issues an
   * UPDATE, and a guard that refused every update refused that one too.
   *
   * Narrow on purpose: only the company reference going to null, and only when
   * the company is already gone. Every other update is still refused, which is
   * what makes the ledger a ledger.
   */
  if tg_op = 'UPDATE' and old.company_id is not null and new.company_id is null
     and not exists (select 1 from companies c where c.id = old.company_id)
     and to_jsonb(new) - 'company_id' = to_jsonb(old) - 'company_id' then
    return new;
  end if;

  raise exception
    'Table %.% is append-only; % is not permitted. Create a new version instead.',
    tg_table_schema, tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

comment on function app.forbid_mutation_except_cascade() is
  'The append-only guard for tenant-owned ledgers. Refuses every edit, and permits exactly one delete: the cascade that runs when the company the row described has already been removed. Migration 0072 drew the same distinction in protect_last_owner, and this is the other half of it.';

/*
 * Applied to every append-only table that a company cascades into. A loop over
 * the catalog rather than a list, because the list is the thing that was wrong
 * — nobody wrote one and nobody noticed the tables that had been added since.
 */
do $$
declare
  r record;
  v_count int := 0;
begin
  for r in
    select distinct c.relname, t.tgname
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'company_id'
                       and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and not t.tgisinternal
      and p.proname = 'forbid_mutation'
  loop
    execute format('drop trigger if exists %I on public.%I', r.tgname, r.relname);
    /*
     * Update and delete only. An append-only table permits INSERT by
     * definition — that is what append-only means — and the first version of
     * this loop recreated the guard over INSERT as well, which stopped the
     * audit ledger recording anything at all.
     */
    execute format(
      'create trigger %I before update or delete on public.%I
         for each row execute function app.forbid_mutation_except_cascade()',
      r.tgname, r.relname);
    v_count := v_count + 1;
  end loop;
  raise notice 'Re-guarded % append-only tenant ledgers', v_count;
end $$;

/*
 * And the audit trigger, which was the last thing standing in the way.
 *
 * Every table `attach_standard_triggers` covers writes an `audit_events` row
 * on delete, referencing the company the row belonged to. During a cascade
 * that company is already gone, so the insert fails the foreign key and the
 * whole deletion rolls back.
 *
 * Copied from migration 0050 with one guard added, rather than rewritten:
 * this function is attached to well over a hundred tables and the request
 * context it assembles is not something to reconstruct from memory.
 */
create or replace function app.audit_row()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_prior   jsonb;
  v_new     jsonb;
  v_id      text;
  v_action  app.audit_action;
  v_ctx     record;
  v_email   text;
begin
  if tg_op = 'DELETE' then
    v_prior := to_jsonb(old);
    v_new := null;
    v_action := 'delete';
  elsif tg_op = 'UPDATE' then
    v_prior := to_jsonb(old);
    v_new := to_jsonb(new);
    v_action := 'update';
    -- Nothing actually changed; do not pad the ledger with empty events.
    -- updated_at is excluded from the comparison because app.set_updated_at()
    -- has already stamped it on this same row, so including it would make
    -- every no-op update look like a change and this branch unreachable.
    if (v_prior - 'updated_at') = (v_new - 'updated_at') then
      return new;
    end if;
  else
    v_prior := null;
    v_new := to_jsonb(new);
    v_action := 'insert';
  end if;

  v_company := coalesce(v_new ->> 'company_id', v_prior ->> 'company_id')::uuid;

  /*
   * The company is going, and its deletion is already recorded once by
   * `app.delete_company` with the reason somebody gave. Recording every row it
   * ever owned on the way out would be thousands of entries all saying the
   * same thing, burying the one worth reading — and the insert would fail the
   * foreign key anyway, rolling the whole deletion back.
   */
  if v_company is not null
     and not exists (select 1 from companies c where c.id = v_company) then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  v_id := coalesce(v_new ->> 'id', v_prior ->> 'id');

  select * into v_ctx from app.request_context();

  -- A named user's email, or the label a service-role caller states for itself.
  -- Never both, and null rather than a guess.
  if auth.uid() is not null then
    select email into v_email from user_profiles where id = auth.uid();
  end if;
  v_email := coalesce(v_email, v_ctx.actor_label);

  insert into audit_events (company_id, actor_id, actor_email, action, entity_table, entity_id,
                            prior_state, new_state, correlation_id, ip_address, user_agent)
  values (v_company, auth.uid(), v_email, v_action,
          tg_table_schema || '.' || tg_table_name, v_id, v_prior, v_new,
          v_ctx.correlation_id, v_ctx.ip_address, v_ctx.user_agent);

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

/*
 * The library version log, for the same reason.
 *
 * Every library table a company can override records a version row on change,
 * including the deletes a cascade issues. During a cascade the company is
 * already gone, so the insert fails its foreign key and the deletion rolls
 * back — and even if it did not, the history of a library that no longer
 * belongs to anybody is history of nothing.
 */
create or replace function app.record_library_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $lib$
declare
  v_row jsonb;
  v_id uuid;
  v_company uuid;
  v_next int;
  v_op text;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old); v_op := 'delete';
  else
    v_row := to_jsonb(new); v_op := lower(tg_op);
  end if;

  v_id := (v_row ->> 'id')::uuid;
  v_company := nullif(v_row ->> 'company_id', '')::uuid;

  -- The company is going and taking its library with it.
  if v_company is not null
     and not exists (select 1 from companies c where c.id = v_company) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next
  from library_row_versions
  where source_table = tg_table_name and source_id = v_id;

  -- A delete is recorded as a version carrying the row as it last stood, so
  -- the history says what was removed rather than merely stopping.
  insert into library_row_versions
    (company_id, source_table, source_id, version_number, valid_from, operation, payload, changed_by)
  values (v_company, tg_table_name, v_id, v_next, clock_timestamp(), v_op, v_row, auth.uid());

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$lib$;

create or replace function app.delete_company(
  p_company uuid, p_confirm_name text, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_name text;
begin
  if not app.operator_can('companies.manage') then
    raise exception 'You do not have permission to delete a company'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) < 10 then
    raise exception 'Say why, at length. Nothing about this is reversible'
      using errcode = 'check_violation';
  end if;

  select name into v_name from companies where id = p_company;
  if v_name is null then
    raise exception 'Company % not found', p_company using errcode = 'no_data_found';
  end if;
  /*
   * The name has to be typed. Not for show: this is the one action on the
   * platform with no undo, and the difference between deleting Ridgeline and
   * deleting Ridgeline Excavating is one click in a dropdown.
   */
  if lower(trim(coalesce(p_confirm_name, ''))) <> lower(trim(v_name)) then
    raise exception 'Type the company name exactly to confirm'
      using errcode = 'check_violation',
            hint = 'This deletes everything they ever made and cannot be undone.';
  end if;
  if exists (select 1 from subscriptions s
              where s.company_id = p_company
                and s.status in ('trialing', 'active', 'past_due')) then
    raise exception 'That company still has a live Stripe subscription'
      using errcode = 'check_violation',
            hint = 'Cancel it first, or they will keep being charged for an account '
                   'that no longer exists.';
  end if;

  /*
   * Recorded before the deletion, because afterwards there is no company to
   * record it against — `audit_events.company_id` is set null on delete
   * (migration 0072), so the row survives and correctly stops pointing at
   * something that is gone.
   */
  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (p_company, auth.uid(), 'delete', 'public.companies', p_company::text,
          jsonb_build_object('name', v_name), trim(p_reason));

  delete from companies where id = p_company;
end;
$$;

-- Grants
do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'app.set_allowance(uuid, text, integer, text, timestamptz)',
    'app.clear_allowance(uuid, text, text)',
    'app.set_plan_trial(text, integer, text)',
    'app.set_company_plan(uuid, text, text)',
    'app.delete_company(uuid, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

create or replace function public.set_allowance(
  p_company uuid, p_allowance text, p_amount int, p_reason text,
  p_valid_until timestamptz default null)
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin return app.set_allowance(p_company, p_allowance, p_amount, p_reason, p_valid_until); end; $$;

create or replace function public.clear_allowance(
  p_company uuid, p_allowance text, p_reason text)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.clear_allowance(p_company, p_allowance, p_reason); end; $$;

create or replace function public.set_plan_trial(p_plan text, p_days int, p_reason text)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.set_plan_trial(p_plan, p_days, p_reason); end; $$;

create or replace function public.set_company_plan(p_company uuid, p_plan text, p_reason text)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.set_company_plan(p_company, p_plan, p_reason); end; $$;

create or replace function public.delete_company(
  p_company uuid, p_confirm_name text, p_reason text)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.delete_company(p_company, p_confirm_name, p_reason); end; $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.set_allowance(uuid, text, integer, text, timestamptz)',
    'public.clear_allowance(uuid, text, text)',
    'public.set_plan_trial(text, integer, text)',
    'public.set_company_plan(uuid, text, text)',
    'public.delete_company(uuid, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- What the free plan gives away, decided rather than migrated
--
-- `plans` carries the caps and the feature list, both set by seed and editable
-- nowhere. So deciding the free tier should allow three seats instead of two,
-- or should include scheduling, meant writing a migration — which is not a
-- decision that should need a deployment.
--
-- The features are validated against a catalog for the same reason permission
-- keys are: a typo in a free-text array is a feature that exists, is granted,
-- and grants nothing. `app.has_entitlement` has always matched on exact string
-- equality, so `'scheduleing'` would have been silently worth nothing.
-- -----------------------------------------------------------------------------
create table feature_catalog (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  label       text not null,
  description text not null,
  -- Whether refusing it actually stops anything. A feature key nothing gates
  -- is a promise on a pricing page and nothing in the product.
  enforced    boolean not null default true,
  sort_order  int not null default 0
);

comment on table feature_catalog is
  'Every feature a plan can include. LIBRARY. `enforced` says whether the database actually refuses the work when the key is absent — a feature nobody gates is a line on a pricing page and nothing in the product, and this is where that difference is visible rather than assumed.';

alter table feature_catalog enable row level security;
alter table feature_catalog force row level security;
create policy feature_catalog_select on feature_catalog for select to authenticated
  using (true);
grant select on feature_catalog to authenticated;
revoke all on feature_catalog from anon;

insert into feature_catalog (key, label, description, enforced, sort_order) values
  ('estimating',      'Estimating', 'Production-based estimating and the pricing engine.', false, 10),
  ('takeoff',         'On-screen takeoff', 'Measuring from drawings, for every trade.', false, 20),
  ('master_libraries','Master libraries', 'Services, tasks, assemblies, rates and materials.', false, 30),
  ('crm_basic',       'Leads and customers', 'Customers, contacts and the lead intake form.', false, 40),
  ('crm_full',        'The full CRM pipeline', 'Opportunities and the sales pipeline.', true, 50),
  ('proposals',       'Proposals', 'Issuing a priced proposal from an estimate.', false, 60),
  ('documents',       'Documents', 'Drawings, submittals and the document store.', false, 70),
  ('projects',        'Project management', 'Running the work once it is won.', true, 80),
  ('job_cost',        'Job cost', 'Committed cost, actuals and cost to complete.', false, 90),
  ('field_production','Field production', 'Daily reports and what the crew achieved.', true, 100),
  ('change_orders',   'Change orders', 'Priced changes against a contract.', true, 110),
  ('scheduling',      'Scheduling', 'Activities, dependencies and the critical path.', true, 120),
  ('procurement',     'Procurement', 'Vendors, requests for quotation and purchase orders.', true, 130),
  ('fleet',           'Fleet and equipment', 'Machines, maintenance, fuel and assets.', true, 140),
  ('workforce',       'Workforce', 'Employees, crews, credentials and time.', true, 150),
  ('safety',          'Safety and quality', 'Incidents, inspections and toolbox talks.', true, 160),
  ('survey',          'Survey and design surfaces', 'Surfaces, comparisons and machine control.', true, 170),
  ('finance',         'Finance', 'Contracts, payables and pay applications.', true, 180),
  ('divisions',       'Divisions', 'Separate divisions inside one company.', true, 190),
  ('api_access',      'API access', 'Programmatic access with an issued key.', true, 200),
  ('calibration',     'Production calibration', 'Tuning library rates from what the field achieved.', true, 210),
  ('ai_plan_review',  'AI plan review', 'Reading a drawing set and reporting what it found.', false, 220),
  ('reports',         'Reports', 'The reporting views and exports.', false, 230),
  ('analytics',       'Analytics', 'Metrics, trends and the business intelligence surface.', false, 240)
on conflict (key) do update set
  label = excluded.label, description = excluded.description,
  enforced = excluded.enforced, sort_order = excluded.sort_order;

drop trigger if exists feature_catalog_frozen on feature_catalog;
create trigger feature_catalog_frozen
  before insert or update or delete on feature_catalog
  for each row execute function app.forbid_mutation();

/** What a plan allows. Null is unlimited, and unlimited is a real answer. */
create or replace function app.set_plan_limits(
  p_plan text, p_max_seats int, p_max_estimates int, p_max_projects int,
  p_storage_gb int, p_ai_credits int, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_before jsonb;
begin
  if not app.operator_can('pricing.manage') then
    raise exception 'You do not have permission to change what a plan allows'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from plans where id = p_plan) then
    raise exception 'Plan % does not exist', p_plan using errcode = 'no_data_found';
  end if;
  if coalesce(p_max_seats, 1) < 1 or coalesce(p_max_estimates, 1) < 1
     or coalesce(p_max_projects, 1) < 1 or coalesce(p_storage_gb, 1) < 1
     or coalesce(p_ai_credits, 0) < 0 then
    raise exception 'A limit is a positive number, or nothing for unlimited'
      using errcode = 'check_violation';
  end if;

  select jsonb_build_object('max_seats', max_seats,
                            'max_active_estimates', max_active_estimates,
                            'max_active_projects', max_active_projects,
                            'storage_gb', storage_gb,
                            'ai_credits_per_month', ai_credits_per_month)
    into v_before from plans where id = p_plan;

  update plans set
    max_seats = p_max_seats, max_active_estimates = p_max_estimates,
    max_active_projects = p_max_projects, storage_gb = p_storage_gb,
    ai_credits_per_month = p_ai_credits, updated_at = now()
  where id = p_plan;

  /*
   * Companies already on the plan feel this immediately, because `plan_limit`
   * reads the plan rather than a copy — except where their entitlement carries
   * its own numbers from a paid subscription, which keeps what they bought.
   */
  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            prior_state, new_state, reason)
  values (null, auth.uid(), 'update', 'public.plans', p_plan, v_before,
          jsonb_build_object('max_seats', p_max_seats,
                             'max_active_estimates', p_max_estimates,
                             'max_active_projects', p_max_projects,
                             'storage_gb', p_storage_gb,
                             'ai_credits_per_month', p_ai_credits),
          coalesce(nullif(trim(coalesce(p_reason, '')), ''),
                   'Plan limits changed from the operator console'));
end;
$$;

/** What a plan includes. Validated, because a typo grants nothing silently. */
create or replace function app.set_plan_features(
  p_plan text, p_features text[], p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_before text[];
  v_unknown text[];
begin
  if not app.operator_can('pricing.manage') then
    raise exception 'You do not have permission to change what a plan includes'
      using errcode = 'insufficient_privilege';
  end if;

  select features into v_before from plans where id = p_plan;
  if v_before is null then
    raise exception 'Plan % does not exist', p_plan using errcode = 'no_data_found';
  end if;

  select array_agg(f) into v_unknown
  from unnest(coalesce(p_features, '{}')) f
  where f <> '*' and not exists (select 1 from feature_catalog c where c.key = f);
  if v_unknown is not null then
    raise exception 'No such feature: %', array_to_string(v_unknown, ', ')
      using errcode = 'foreign_key_violation',
            hint = 'A key that is not in the catalog grants nothing, silently.';
  end if;

  update plans set features = coalesce(p_features, '{}'), updated_at = now()
   where id = p_plan;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            prior_state, new_state, reason)
  values (null, auth.uid(), 'update', 'public.plans', p_plan,
          jsonb_build_object('features', v_before),
          jsonb_build_object('features', coalesce(p_features, '{}')),
          coalesce(nullif(trim(coalesce(p_reason, '')), ''),
                   'Plan features changed from the operator console'));
end;
$$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'app.set_plan_limits(text, integer, integer, integer, integer, integer, text)',
    'app.set_plan_features(text, text[], text)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

create or replace function public.set_plan_limits(
  p_plan text, p_max_seats int, p_max_estimates int, p_max_projects int,
  p_storage_gb int, p_ai_credits int, p_reason text)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.set_plan_limits(p_plan, p_max_seats, p_max_estimates,
       p_max_projects, p_storage_gb, p_ai_credits, p_reason); end; $$;

create or replace function public.set_plan_features(
  p_plan text, p_features text[], p_reason text)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.set_plan_features(p_plan, p_features, p_reason); end; $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.set_plan_limits(text, integer, integer, integer, integer, integer, text)',
    'public.set_plan_features(text, text[], text)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- One company, everything about it
-- -----------------------------------------------------------------------------
create or replace view admin_company_controls as
select
  c.id                                    as company_id,
  c.name,
  c.slug,
  c.created_at,
  app.effective_plan(c.id)                as plan_id,
  p.name                                  as plan_name,
  e.source                                as entitlement_source,
  e.is_active                             as entitlement_active,
  e.valid_until                           as access_valid_until,
  s.status                                as subscription_status,
  s.stripe_subscription_id,
  -- What they are allowed, after every override, which is what the estimator
  -- actually runs into rather than what the plan says.
  app.plan_limit(c.id, 'max_seats')             as max_seats,
  app.plan_limit(c.id, 'max_active_estimates')  as max_active_estimates,
  app.plan_limit(c.id, 'max_active_projects')   as max_active_projects,
  app.plan_limit(c.id, 'storage_gb')            as storage_gb,
  app.plan_limit(c.id, 'ai_credits_per_month')  as ai_credits_per_month,
  -- And which of those are overrides rather than the plan.
  (select array_agg(o.allowance order by o.allowance) from allowance_overrides o
    where o.company_id = c.id and o.revoked_at is null
      and (o.valid_until is null or o.valid_until > now())) as overridden,
  app.is_suspended(c.id)                  as suspended,
  (select count(*) from entitlement_overrides ov
    where ov.company_id = c.id and ov.revoked_at is null) as feature_overrides,
  (select kind from company_billing_terms bt
    where bt.company_id = c.id and bt.revoked_at is null) as terms
from companies c
left join entitlements e on e.company_id = c.id
left join plans p on p.id = app.effective_plan(c.id)
left join lateral (
  select st.status, st.stripe_subscription_id from subscriptions st
  where st.company_id = c.id order by st.created_at desc limit 1
) s on true
where app.operator_can('companies.read');

comment on view admin_company_controls is
  'Everything about one company that an operator can change, with the allowances resolved through their overrides — what the estimator actually runs into rather than what the plan says.';

grant select on admin_company_controls to authenticated;
revoke all on admin_company_controls from anon;

select app.assert_security_gates();
