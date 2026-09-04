-- =============================================================================
-- 0042 — Evaluating the metric the public API already promised to evaluate
--
-- The gateway publishes `GET /metrics/{metricKey}` with the summary "Evaluate a
-- governed metric", and that summary is generated straight into the OpenAPI
-- specification third parties read. The handler returns the *definition* — the
-- key, the name, the description and the expression as text. It returns no
-- number. A consumer asking for gross margin receives a sentence of SQL.
--
-- It is the same defect this build has found throughout the platform — a claim
-- nothing computes — and this is the one instance published to people outside
-- the company.
--
-- 0040 recorded which view each metric comes from and narrowed who may write an
-- expression; 0041 corrected the two that named a view that could not produce
-- them, and a test now runs all sixteen against their sources. That is what
-- makes evaluation safe to build, and it is why it was not built first.
--
-- Two boundaries this deliberately keeps:
--
--   * **Only the platform's own definitions are executed.** A company may
--     define its own metric — the column is SQL text and 0040 restricted
--     writing it to `company.manage` — and the platform still will not run it.
--     Where a company has overridden a metric, this refuses to answer rather
--     than quietly returning the platform's number under the company's name.
--   * **A tenant must always be named.** The function takes a company and
--     filters on it. The API gateway holds an API key rather than a user, so it
--     necessarily runs as the service role with row level security bypassed;
--     the signature makes it impossible to ask for a metric without saying
--     whose. For an ordinary authenticated caller, `security invoker` means the
--     reporting views apply their own tenancy on top.
-- =============================================================================

/**
 * The current value of a platform-defined metric for one company.
 *
 * Dynamic SQL, which needs saying plainly. The expression is interpolated
 * because an expression is not an identifier and cannot be parameterized. It is
 * safe here for reasons that are structural rather than hopeful:
 *
 *   - the row is selected with `company_id is null`, so the text can only have
 *     come from a platform migration;
 *   - 0040's policies refuse any insert or update whose `company_id` is null,
 *     so no tenant of any privilege can author one;
 *   - the view name is quoted as an identifier, schema-qualified, and already
 *     constrained to `^reporting_[a-z_]+$`;
 *   - the company is passed as a bind parameter, never interpolated.
 */
create or replace function app.evaluate_metric(p_key text, p_company uuid)
returns numeric
language plpgsql
stable
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_metric   metric_definitions%rowtype;
  v_override boolean;
  v_value    numeric;
begin
  select * into v_metric from metric_definitions
   where key = p_key and company_id is null and is_active;

  if not found then
    raise exception 'No active platform metric named %.', p_key
      using errcode = '22023';
  end if;

  -- A company's own definition wins for every other purpose in the platform,
  -- and the platform does not execute one. Returning the platform's number
  -- under a name the company has redefined would be a wrong answer wearing a
  -- right label.
  select exists (select 1 from metric_definitions
                  where key = p_key and company_id = p_company and is_active)
    into v_override;
  if v_override then
    raise exception 'Metric % is overridden by a company definition, which the platform does not execute.', p_key
      using errcode = '0A000';
  end if;

  if v_metric.source_view is null then
    raise exception 'Metric % names no source view and cannot be evaluated.', p_key
      using errcode = '22023';
  end if;

  execute format('select (%s)::numeric from public.%I where company_id = $1',
                 v_metric.expression, v_metric.source_view)
     into v_value
    using p_company;

  return v_value;
end;
$$;

grant execute on function app.evaluate_metric(text, uuid) to authenticated, service_role;

comment on function app.evaluate_metric(text, uuid) is
  'The current value of a platform-defined metric for one company. Executes only definitions the platform authored, refuses where a company has overridden the metric, and always requires a company — the gateway runs as the service role, so the tenant filter cannot be left to a caller to remember.';

/**
 * Every metric that can be evaluated, and its value.
 *
 * The screen that shows a number and the API that returns one now read the same
 * function, so the two cannot report different figures for the same metric.
 * Metrics a company has overridden are absent rather than wrong: the view lists
 * what the platform can answer for.
 */
create or replace view reporting_metric_values
with (security_invoker = true) as
select
  c.id                                as company_id,
  m.key,
  m.name,
  m.description,
  m.domain,
  m.unit,
  m.grain,
  m.source_view,
  m.higher_is_better,
  m.target_value,
  app.evaluate_metric(m.key, c.id)    as value
from companies c
cross join metric_definitions m
where m.company_id is null
  and m.is_active
  and m.source_view is not null
  and not exists (select 1 from metric_definitions o
                   where o.key = m.key and o.company_id = c.id and o.is_active);

comment on view reporting_metric_values is
  'Governed metrics with their current values, per company. Reads app.evaluate_metric, so a screen and the public API cannot disagree about the same metric. A metric a company has overridden is omitted, because the platform does not execute a definition it did not author.';

grant select on reporting_metric_values to authenticated;
revoke all on reporting_metric_values from anon;

-- -----------------------------------------------------------------------------
-- A metric that was reported under is retired, not deleted
-- -----------------------------------------------------------------------------
/*
 * 0040 gave metric definitions a version history and left the delete policy
 * alone, which made the two contradict each other: the version table is
 * append-only, the version rows cascade from the definition, and so a delete
 * failed with "metric_definition_versions is append-only" — an error about a
 * table the caller never named, for an operation the policy said they could
 * perform.
 *
 * The error was pointing at the right answer. A metric somebody reported a
 * number under cannot be made to have never existed; `is_active` already exists
 * and is what retirement means. So deletion is refused deliberately, with a
 * message that says what to do instead, and the policy that promised otherwise
 * is withdrawn rather than left to fail at the bottom of a cascade.
 */
create or replace function app.forbid_metric_deletion()
returns trigger
language plpgsql
as $$
begin
  -- The test is in the body rather than in a trigger WHEN clause, which cannot
  -- contain a subquery. A definition with no published version has never been
  -- reported under and may still be removed.
  if exists (select 1 from metric_definition_versions v where v.metric_id = old.id) then
    raise exception
      'Metric "%" has published versions and cannot be deleted. Set is_active = false to retire it; a number was reported under this definition.',
      old.key
      using errcode = 'restrict_violation';
  end if;
  return old;
end;
$$;

create trigger metric_definitions_no_delete
  before delete on metric_definitions
  for each row execute function app.forbid_metric_deletion();

-- Withdrawn: it could never have succeeded. A permission to do something
-- impossible is the same defect as a control that enforces nothing.
drop policy if exists metric_definitions_delete on metric_definitions;

comment on column metric_definitions.is_active is
  'Whether this metric is offered. Retirement rather than deletion: a definition a number was reported under keeps its history, and an inactive company override falls back to the platform definition rather than leaving the metric unanswerable.';

select app.assert_security_gates();
