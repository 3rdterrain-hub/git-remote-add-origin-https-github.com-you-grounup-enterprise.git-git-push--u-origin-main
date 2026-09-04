-- =============================================================================
-- GrounUp Enterprise — 0003 Access control primitives and the audit ledger
--
-- These functions are what every RLS policy in 0010 calls. They are
-- SECURITY DEFINER because they read company_memberships, which is itself
-- protected by RLS; a plain function would recurse into the policy that called
-- it. search_path is pinned on every one of them so a caller cannot shadow a
-- table name and redirect the lookup.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Who am I, and what may I do?
-- -----------------------------------------------------------------------------

/**
 * Companies the current user may access.
 *
 * Returns an empty set for an unauthenticated request, which makes every
 * tenant policy fail closed: `company_id in (select ...)` over an empty set
 * matches nothing.
 */
create or replace function app.current_company_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select m.company_id
  from company_memberships m
  where m.user_id = auth.uid()
    and m.status = 'active';
$$;

create or replace function app.is_member(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from company_memberships m
    where m.user_id = auth.uid() and m.company_id = p_company and m.status = 'active'
  );
$$;

create or replace function app.is_owner(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from company_memberships m
    where m.user_id = auth.uid() and m.company_id = p_company
      and m.status = 'active' and m.is_owner
  );
$$;

/**
 * Does the current user hold `p_permission` in `p_company`?
 *
 * An owner, or a role carrying the '*' wildcard, passes everything. Otherwise
 * the exact permission key must be present. Wildcards are only honored as the
 * whole-role grant '*' — there is no 'estimates.*' prefix matching, because
 * partial wildcards make it very easy to grant more than intended.
 */
create or replace function app.has_permission(p_company uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from company_memberships m
    join roles r on r.id = m.role_id
    where m.user_id = auth.uid()
      and m.company_id = p_company
      and m.status = 'active'
      and (m.is_owner or r.permissions @> array['*'] or r.permissions @> array[p_permission])
  );
$$;

/** Highest approval tier the user holds in a company (0 when not a member). */
create or replace function app.approval_tier(p_company uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(max(case when m.is_owner then 4 else r.approval_tier end), 0)
  from company_memberships m
  join roles r on r.id = m.role_id
  where m.user_id = auth.uid() and m.company_id = p_company and m.status = 'active';
$$;

/**
 * Project-level narrowing. A membership with an empty project_scope sees every
 * project in the company; a non-empty scope restricts the member to that list.
 */
create or replace function app.can_access_project(p_company uuid, p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from company_memberships m
    where m.user_id = auth.uid()
      and m.company_id = p_company
      and m.status = 'active'
      and (cardinality(m.project_scope) = 0 or p_project = any (m.project_scope))
  );
$$;

grant execute on function
  app.current_company_ids(), app.is_member(uuid), app.is_owner(uuid),
  app.has_permission(uuid, text), app.approval_tier(uuid), app.can_access_project(uuid, uuid)
to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Audit ledger — append only
-- -----------------------------------------------------------------------------
create table audit_events (
  id             bigint generated always as identity primary key,
  company_id     uuid references companies(id) on delete cascade,
  actor_id       uuid references auth.users(id) on delete set null,
  -- Retained even if the user row is later deleted, so the ledger stays readable.
  actor_email    text,
  action         app.audit_action not null,
  entity_table   text not null,
  entity_id      text,
  -- Values are stored as jsonb rather than text so a diff can be computed later.
  prior_state    jsonb,
  new_state      jsonb,
  reason         text,
  -- Ties related events (one approval touching many rows) into a single story.
  correlation_id uuid,
  ip_address     inet,
  user_agent     text,
  occurred_at    timestamptz not null default now()
);

comment on table audit_events is
  'Immutable business and security ledger. UPDATE and DELETE are blocked by trigger; corrections are appended as new events.';

create index audit_events_company_time_idx on audit_events(company_id, occurred_at desc);
create index audit_events_entity_idx on audit_events(entity_table, entity_id);
create index audit_events_actor_idx on audit_events(actor_id, occurred_at desc);
create index audit_events_correlation_idx on audit_events(correlation_id) where correlation_id is not null;

create trigger audit_events_immutable
  before update or delete on audit_events
  for each row execute function app.forbid_mutation();

/**
 * Generic row-level audit trigger.
 *
 * Attached to every governed table. It records the full prior and new state so
 * an auditor can answer "who changed this production rate, when, from what, to
 * what" — the exact question the configurability principle promises can always
 * be answered.
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
  v_id := coalesce(v_new ->> 'id', v_prior ->> 'id');

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id, prior_state, new_state)
  values (v_company, auth.uid(), v_action, tg_table_schema || '.' || tg_table_name, v_id, v_prior, v_new);

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

/**
 * Attaches the standard trigger set to a governed table:
 *   - updated_at maintenance
 *   - full row audit
 */
create or replace function app.attach_standard_triggers(p_table regclass)
returns void
language plpgsql
as $$
declare
  v_name text := split_part(p_table::text, '.', greatest(1, array_length(string_to_array(p_table::text, '.'), 1)));
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = v_name and column_name = 'updated_at'
      and table_schema = coalesce(nullif(split_part(p_table::text, '.', 2), ''), 'public')
  ) then
    execute format('drop trigger if exists set_updated_at on %s', p_table);
    execute format(
      'create trigger set_updated_at before update on %s for each row execute function app.set_updated_at()',
      p_table);
  end if;

  execute format('drop trigger if exists audit_row on %s', p_table);
  execute format(
    'create trigger audit_row after insert or update or delete on %s for each row execute function app.audit_row()',
    p_table);
end;
$$;

-- -----------------------------------------------------------------------------
-- Approval requests — the human gate in front of protected changes
-- -----------------------------------------------------------------------------
create table approval_requests (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  entity_table      text not null,
  entity_id         text not null,
  requested_change  jsonb not null,
  prior_state       jsonb,
  gate              app.approval_gate not null,
  required_tier     int not null default 1 check (required_tier between 1 and 4),
  state             app.approval_state not null default 'pending',
  reason            text not null,
  -- Set when the change originated from an AI agent (RULE-008).
  origin            text not null default 'human' check (origin in ('human', 'ai_agent', 'import', 'calibration')),
  ai_agent_id       text,
  requested_by      uuid references auth.users(id) on delete set null,
  requested_at      timestamptz not null default now(),
  decided_by        uuid references auth.users(id) on delete set null,
  decided_at        timestamptz,
  decision_note     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (state = 'pending' or decided_at is not null)
);

create index approval_requests_company_state_idx on approval_requests(company_id, state);
create index approval_requests_entity_idx on approval_requests(entity_table, entity_id);

comment on table approval_requests is
  'Every protected change routes through here. An AI agent may create a request; only a human with the required approval tier may decide it (RULE-008).';

/** A decider must hold the required approval tier, and may not approve their own request. */
create or replace function app.enforce_approval_authority()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.state in ('approved', 'rejected') and old.state = 'pending' then
    if new.decided_by is null then
      raise exception 'An approval decision must record who made it'
        using errcode = 'restrict_violation';
    end if;
    if new.decided_by = new.requested_by and new.origin = 'human' then
      raise exception 'Segregation of duties: % cannot approve their own request', new.decided_by
        using errcode = 'insufficient_privilege';
    end if;
    if app.approval_tier(new.company_id) < new.required_tier then
      raise exception 'Approval requires tier %, but the deciding user holds tier %',
        new.required_tier, app.approval_tier(new.company_id)
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_approval_authority
  before update on approval_requests
  for each row execute function app.enforce_approval_authority();
