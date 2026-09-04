-- =============================================================================
-- 0050 — The audit ledger asked four questions it could not answer
--
-- `audit_events` carries `correlation_id`, `ip_address`, `user_agent` and
-- `actor_email` alongside the actor, the action and the full prior and new
-- state. The state half is excellent and is what makes the ledger worth having.
-- The other four columns were written by nothing — not by the row trigger on
-- every governed table, and not by any of the three other writers in the schema.
-- Every audit row in the platform had them null.
--
-- So the record that exists to answer "who changed this, when, from what, to
-- what" could not answer *from where*, *as part of which request*, or — for a
-- change made through the public API — *by whom at all*, because the gateway
-- authenticates with an API key and runs as the service role, and `auth.uid()`
-- is null for a service role. A named key could create a time entry and the
-- ledger recorded an anonymous insert.
--
-- The context was already there and nobody read it. PostgREST publishes the
-- request headers of every browser request as a transaction-local setting, so
-- the address and the agent are available to the trigger for the asking. The
-- gateway now labels itself the same way, through headers it sets per request.
--
-- Everything here degrades to null rather than failing: a direct psql session
-- has no request headers, and an audit row without an address is still an audit
-- row. A ledger that refused writes when it could not identify the caller would
-- turn an observability gap into an outage.
-- =============================================================================

/**
 * What the current request says about itself.
 *
 * Read from PostgREST's `request.headers`, which is transaction-local — it
 * cannot leak between requests on a pooled connection, which is why this is a
 * header lookup rather than a session variable somebody sets.
 *
 * Every field is optional and every failure is silent by design. Malformed
 * headers are attacker-controlled input; the correct response to an
 * unparseable one is to record nothing for that field, not to refuse the
 * business write that triggered the audit.
 */
create or replace function app.request_context()
returns table (correlation_id uuid, ip_address inet, user_agent text, actor_label text)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  h jsonb;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    h := null;
  end;

  if h is null then
    return query select null::uuid, null::inet, null::text, null::text;
    return;
  end if;

  -- A correlation id the caller supplied. Anything that is not a uuid is
  -- discarded rather than stored, so the column keeps one meaning.
  begin
    correlation_id := coalesce(h ->> 'x-grounup-correlation', h ->> 'x-request-id')::uuid;
  exception when others then
    correlation_id := null;
  end;

  -- x-forwarded-for is a list; the client is the first entry. A proxy appends,
  -- so the rest are infrastructure rather than the caller.
  begin
    ip_address := nullif(trim(split_part(h ->> 'x-forwarded-for', ',', 1)), '')::inet;
  exception when others then
    ip_address := null;
  end;

  user_agent := left(h ->> 'user-agent', 500);
  actor_label := left(h ->> 'x-grounup-actor', 200);
  return next;
end;
$$;

grant execute on function app.request_context() to authenticated, service_role;

comment on function app.request_context() is
  'The address, agent, correlation id and stated actor of the current request, from the transaction-local headers PostgREST publishes. Every field degrades to null rather than failing: an audit row without an address is still an audit row, and a ledger that refused a write it could not attribute would turn an observability gap into an outage.';

/**
 * The row audit, now recording who asked and from where.
 *
 * The state comparison is unchanged — it was right. What is added is the
 * request context, and an actor email resolved from the user profile so the
 * ledger reads without a join, falling back to the label a service-role caller
 * gives for itself.
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

comment on function app.audit_row() is
  'The full-row audit attached to every governed table: who, when, what changed from what to what, and since migration 0050 from where, under which correlation id, and — for a service-role caller such as the public API gateway — the actor it states for itself, because auth.uid() is null for a service role and an anonymous insert is not an audit record.';

select app.assert_security_gates();
