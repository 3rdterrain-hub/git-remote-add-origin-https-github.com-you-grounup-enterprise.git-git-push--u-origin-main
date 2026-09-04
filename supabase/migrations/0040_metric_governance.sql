-- =============================================================================
-- 0040 — Metric governance: who may define one, where it comes from, and what
--        it said last quarter
--
-- The semantic layer ships 16 governed metric definitions — gross margin, cost
-- to complete, TRIR, bid hit rate — each with a name, a description, a unit, a
-- grain and a SQL expression. It is a good model, and three things were wrong
-- with it.
--
--   * **A read permission gated a write.** `metric_definitions` accepted an
--     insert or an update from anyone holding `reports.read`, which nearly
--     every role has. The `expression` column is SQL text. Nothing executes it
--     today, so the exposure is latent rather than live — but "safe because
--     nothing reads it yet" is the same sentence as the secret boundary before
--     it was enforced, and it holds exactly as long as nobody writes an
--     evaluator.
--   * **A definition could move under the numbers it produced.** The
--     expression was editable in place, so a margin reported to a bank last
--     quarter and the same metric today are indistinguishable. The fifth
--     appearance of this pattern, after library rates, plan terms, claim
--     deadlines and document revisions.
--   * **A metric named no source.** The definitions and the reporting views
--     compute independently — the views in hand-written SQL, the definitions in
--     text nothing runs — so a metric and the number beside it could disagree
--     and nothing would notice. The safety view's own comment says the rate
--     metrics "are defined in metric_definitions rather than hard-coded here",
--     and nothing computes them from there either.
--
-- What this deliberately does NOT add is an evaluator. Executing a stored
-- expression would turn an inert column into arbitrary SQL running as whatever
-- role evaluated it, and the write policy above means a low-privilege user
-- could have supplied it. Narrowing the policy first, recording the source, and
-- proving by test that each platform expression runs against its source view
-- gets the guarantee without opening that door.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A read permission may not gate a write
-- -----------------------------------------------------------------------------
drop policy if exists metric_definitions_insert on metric_definitions;
drop policy if exists metric_definitions_update on metric_definitions;
drop policy if exists metric_definitions_delete on metric_definitions;

-- Defining what a company measures is configuration, not reporting. There is
-- no `reports.write` permission in the catalog, and inventing one to hold a
-- single table would spread the decision across every role; `company.manage`
-- already means "may configure this company" and is held by owners and
-- administrators only.
create policy metric_definitions_insert on metric_definitions for insert to authenticated
  with check (company_id is not null and app.has_permission(company_id, 'company.manage'));
create policy metric_definitions_update on metric_definitions for update to authenticated
  using (company_id is not null and app.has_permission(company_id, 'company.manage'))
  with check (company_id is not null and app.has_permission(company_id, 'company.manage'));
create policy metric_definitions_delete on metric_definitions for delete to authenticated
  using (company_id is not null and app.has_permission(company_id, 'company.manage'));

comment on column metric_definitions.expression is
  'The SQL expression this metric means. Never executed by the platform: it documents the calculation the reporting views implement, and a test proves each platform expression runs against the view it names. Writing one requires company.manage, because the column is SQL text.';

-- -----------------------------------------------------------------------------
-- A metric names where its number comes from
-- -----------------------------------------------------------------------------
alter table metric_definitions
  add column source_view text
    check (source_view is null or source_view ~ '^reporting_[a-z_]+$');

comment on column metric_definitions.source_view is
  'The reporting view this metric is computed from. Lineage in the only form that can be checked: a test runs the expression against this view and fails if the definition has drifted from the schema.';

update metric_definitions set source_view = 'reporting_project_financials'
 where company_id is null and key in ('gross_profit_to_date', 'gross_margin_percent',
   'cost_to_complete', 'billed_to_date', 'unbilled_cost', 'retainage_held',
   'change_order_ratio', 'labor_cost_ratio', 'backlog_value');

update metric_definitions set source_view = 'reporting_labor_productivity'
 where company_id is null and key in ('premium_hour_ratio', 'hours_worked');

update metric_definitions set source_view = 'reporting_safety_summary'
 where company_id is null and key in ('trir', 'dart_rate', 'open_investigations');

update metric_definitions set source_view = 'reporting_bid_performance'
 where company_id is null and key in ('bid_hit_rate', 'estimates_submitted');

-- -----------------------------------------------------------------------------
-- What the metric said when the number was reported
-- -----------------------------------------------------------------------------
create table metric_definition_versions (
  id                  uuid primary key default gen_random_uuid(),
  metric_id           uuid not null references metric_definitions(id) on delete cascade,
  company_id          uuid references companies(id) on delete cascade,
  version             int not null check (version > 0),

  -- The calculation as published. Copied, because the definition will move and
  -- this must not.
  key                 text not null,
  name                text not null,
  unit                text not null,
  expression          text not null,
  grain               text not null,
  source_view         text,
  higher_is_better    boolean,
  target_value        numeric(18,4),

  published_at        timestamptz not null default now(),
  published_by        uuid references auth.users(id) on delete set null,

  unique (metric_id, version)
);
create index metric_definition_versions_metric_idx
  on metric_definition_versions(metric_id, version desc);

create trigger metric_definition_versions_immutable
  before update or delete on metric_definition_versions
  for each row execute function app.forbid_mutation();

comment on table metric_definition_versions is
  'What a metric meant when a number was reported under it. ENTITY, append-only. A margin quoted to a bank last quarter is answerable from here after the definition changes.';

/**
 * Publish a version whenever the calculation changes.
 *
 * Only the calculation. Renaming a metric or retargeting it does not change
 * what any past number meant, and a version per edit would make the history
 * unreadable — the same rule the plan catalog follows.
 */
create or replace function app.publish_metric_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_latest metric_definition_versions%rowtype;
  v_next   int;
begin
  select * into v_latest from metric_definition_versions
  where metric_id = new.id order by version desc limit 1;

  if found
     and v_latest.expression = new.expression
     and v_latest.unit = new.unit
     and v_latest.grain = new.grain
     and v_latest.source_view is not distinct from new.source_view
  then
    return new;
  end if;

  v_next := coalesce(v_latest.version, 0) + 1;

  insert into metric_definition_versions (
    metric_id, company_id, version, key, name, unit, expression, grain,
    source_view, higher_is_better, target_value, published_by)
  values (
    new.id, new.company_id, v_next, new.key, new.name, new.unit, new.expression,
    new.grain, new.source_view, new.higher_is_better, new.target_value, auth.uid());

  return new;
end;
$$;

create trigger metric_definitions_publish_version
  after insert or update on metric_definitions
  for each row execute function app.publish_metric_version();

-- Version 1 for every definition already seeded.
insert into metric_definition_versions (
  metric_id, company_id, version, key, name, unit, expression, grain,
  source_view, higher_is_better, target_value)
select m.id, m.company_id, 1, m.key, m.name, m.unit, m.expression, m.grain,
       m.source_view, m.higher_is_better, m.target_value
from metric_definitions m
where not exists (select 1 from metric_definition_versions v where v.metric_id = m.id);

/** The calculation currently published for a metric. Derived, not flagged. */
create or replace function app.current_metric_version(p_metric uuid)
returns uuid
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select id from metric_definition_versions
  where metric_id = p_metric order by version desc limit 1;
$$;

grant execute on function app.current_metric_version(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS and grants
-- -----------------------------------------------------------------------------
alter table metric_definition_versions enable row level security;
alter table metric_definition_versions force row level security;

-- A platform metric's history is readable by everyone it applies to; a
-- company's own history is readable only inside that company.
create policy metric_definition_versions_select on metric_definition_versions
  for select to authenticated
  using (company_id is null or app.is_member(company_id));

grant select on metric_definition_versions to authenticated;

select app.assert_security_gates();
