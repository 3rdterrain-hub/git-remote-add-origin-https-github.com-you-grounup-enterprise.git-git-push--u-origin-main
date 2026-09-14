-- =============================================================================
-- 0170 — The drawing says one thing and the specification says another
--
-- `document_conflicts` has existed since migration 0006 with the shape of a
-- real conflict: both sides stated in their own words, the sheet each came
-- from, a severity, and whether it moves quantity, cost or schedule. It has an
-- index on the unresolved ones, row level security, and `rfis.conflict_id`
-- pointing at it so a conflict can become a question to the architect.
--
-- **Nothing reads or writes it.** Five mentions in the whole repository and
-- every one is schema.
--
-- That matters more than a missing screen, because the engine already treats a
-- conflict as first class. `confidence.ts` takes twenty-two points off a line
-- for each unresolved one, to a floor of forty-five; `estimate.ts` routes any
-- line carrying one to senior review and refuses "all lines are conflict-free"
-- as an executive decision. `estimate_line_items.conflict_count` is what it
-- reads, and it is a plain column defaulting to zero that nothing has ever
-- incremented. So the most consequential thing an estimator can notice about a
-- drawing set had nowhere to be written down, and every bid has been priced as
-- though the documents agreed.
--
-- The count is **derived, never stored by hand**. A trigger recomputes it from
-- the conflicts themselves whenever one is raised, resolved or removed, so it
-- cannot drift from the rows it is supposed to describe — the lesson migration
-- 0043 paid for when a credential's standing was a date restated as a column.
-- =============================================================================

/**
 * Keep a line's conflict count equal to its unresolved conflicts.
 *
 * Recomputed rather than incremented: a counter that is added to and taken away
 * from is a counter that eventually disagrees with what it counts, and this one
 * is read by the confidence engine.
 */
create or replace function app.refresh_line_conflict_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_line uuid;
begin
  foreach v_line in array array_remove(array[
    case when tg_op <> 'INSERT' then old.line_item_id end,
    case when tg_op <> 'DELETE' then new.line_item_id end], null)
  loop
    update estimate_line_items l
       set conflict_count = (
             select count(*) from document_conflicts c
              where c.line_item_id = l.id and c.resolved_at is null)
     where l.id = v_line;
  end loop;
  return null;
end;
$$;

comment on function app.refresh_line_conflict_count() is
  'Recomputes a line''s conflict count from its unresolved conflicts. Derived rather than incremented, because the confidence engine reads it and a counter that drifts is worse than no counter.';

drop trigger if exists document_conflicts_count on document_conflicts;
create trigger document_conflicts_count
  after insert or update or delete on document_conflicts
  for each row execute function app.refresh_line_conflict_count();

/**
 * Record that two documents disagree.
 *
 * Both sides are required and both are stated in their own words. "The plan and
 * the spec conflict" is not a conflict anybody can resolve; "C1.0 calls for 8
 * inch RCP, specification 33 41 00 calls for 12 inch" is.
 *
 * A conflict may sit on a line, on the version, or on neither — a drawing set
 * can disagree with itself before anybody has taken a quantity off it. Where it
 * names a line, that line's confidence drops by the engine's own rule and the
 * estimate routes to senior review, which is the whole point of recording it.
 */
create or replace function app.raise_document_conflict(
  p_title        text,
  p_description  text,
  p_source_a     text,
  p_source_a_says text,
  p_source_b     text,
  p_source_b_says text,
  p_version      uuid default null,
  p_line         uuid default null,
  p_discipline   text default null,
  p_severity     text default 'moderate',
  p_quantity_impact boolean default false,
  p_cost_impact  boolean default false,
  p_schedule_impact boolean default false,
  p_detected_by  text default 'human')
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_version uuid := p_version;
  v_id      uuid;
begin
  if p_line is not null then
    select l.company_id, l.estimate_version_id into v_company, v_version
      from estimate_line_items l where l.id = p_line;
    if v_company is null then
      raise exception 'No such estimate line' using errcode = 'no_data_found';
    end if;
  elsif v_version is not null then
    select v.company_id into v_company from estimate_versions v where v.id = v_version;
    if v_company is null then
      raise exception 'No such estimate version' using errcode = 'no_data_found';
    end if;
  else
    raise exception 'Say which estimate or line the documents disagree about'
      using errcode = 'check_violation',
            hint = 'A conflict nobody can place is a note, not a conflict.';
  end if;

  if not app.has_permission(v_company, 'estimates.write') then
    raise exception 'You do not have permission to change this estimate'
      using errcode = 'insufficient_privilege';
  end if;
  -- Both sides, in their own words. This is the whole value of the record.
  if coalesce(trim(p_source_a), '') = '' or coalesce(trim(p_source_a_says), '') = ''
     or coalesce(trim(p_source_b), '') = '' or coalesce(trim(p_source_b_says), '') = '' then
    raise exception 'Say what each document is, and what each one says'
      using errcode = 'check_violation',
            hint = 'A conflict stated from one side cannot be resolved by anybody but its author.';
  end if;
  if p_severity not in ('low', 'moderate', 'high', 'critical') then
    raise exception 'Severity is low, moderate, high or critical, not %', p_severity
      using errcode = 'check_violation';
  end if;

  insert into document_conflicts (
    company_id, estimate_version_id, line_item_id, title, description,
    source_a, source_a_says, source_b, source_b_says,
    discipline, severity, quantity_impact, cost_impact, schedule_impact, detected_by)
  values (
    v_company, v_version, p_line, trim(p_title), trim(p_description),
    trim(p_source_a), trim(p_source_a_says), trim(p_source_b), trim(p_source_b_says),
    nullif(trim(coalesce(p_discipline, '')), ''), p_severity,
    p_quantity_impact, p_cost_impact, p_schedule_impact,
    case when p_detected_by = 'ai_agent' then 'ai_agent' else 'human' end)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.raise_document_conflict(text, text, text, text, text, text, uuid, uuid, text, text, boolean, boolean, boolean, text) is
  'Records that two documents disagree, stated from both sides. Where it names a line the confidence engine takes twenty-two points off it and the estimate routes to senior review. WORKFLOW.';

/**
 * Say how it was settled.
 *
 * A resolution is required. A conflict closed with no answer is a conflict
 * somebody will find again on the next revision and resolve differently.
 */
create or replace function app.resolve_document_conflict(p_conflict uuid, p_resolution text)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_c document_conflicts%rowtype;
begin
  select * into v_c from document_conflicts where id = p_conflict;
  if not found then
    raise exception 'No such conflict' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_c.company_id, 'estimates.write') then
    raise exception 'You do not have permission to change this estimate'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(coalesce(p_resolution, '')), '') = '' then
    raise exception 'Say how it was settled' using errcode = 'check_violation',
      hint = 'A conflict closed with no answer is one somebody resolves differently next revision.';
  end if;
  update document_conflicts
     set resolution = trim(p_resolution),
         resolved_at = coalesce(resolved_at, now()),
         resolved_by = coalesce(resolved_by, auth.uid()),
         updated_at = now()
   where id = p_conflict;
end;
$$;

comment on function app.resolve_document_conflict(uuid, text) is
  'Settles a document conflict with the answer that settled it, which restores the confidence the engine took off the line. WORKFLOW.';

/**
 * Ask the architect.
 *
 * `rfis.conflict_id` has pointed at this table since 0006 and nothing has ever
 * set it. A conflict the documents cannot resolve is exactly what an RFI is
 * for, and the question writes itself from the two sides already recorded.
 */
create or replace function app.conflict_to_rfi(
  p_conflict uuid, p_question text default null, p_priority text default 'normal')
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_c   document_conflicts%rowtype;
  v_rfi uuid;
begin
  select * into v_c from document_conflicts where id = p_conflict;
  if not found then
    raise exception 'No such conflict' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_c.company_id, 'estimates.write') then
    raise exception 'You do not have permission to raise an RFI on this estimate'
      using errcode = 'insufficient_privilege';
  end if;
  if v_c.resolved_at is not null then
    raise exception 'That conflict is already settled' using errcode = 'check_violation';
  end if;

  insert into rfis (
    company_id, estimate_version_id, line_item_id, conflict_id, number, title,
    discipline, drawing_reference, specification_reference,
    existing_information, question, priority, status, submitted_at, created_by)
  values (
    v_c.company_id, v_c.estimate_version_id, v_c.line_item_id, v_c.id,
    app.next_rfi_number(v_c.company_id), v_c.title,
    v_c.discipline, v_c.source_a, v_c.source_b,
    v_c.source_a || ' says: ' || v_c.source_a_says || E'\n'
      || v_c.source_b || ' says: ' || v_c.source_b_says,
    coalesce(nullif(trim(coalesce(p_question, '')), ''),
             'Which governs: ' || v_c.source_a || ' or ' || v_c.source_b || '?'),
    case when p_priority in ('low','normal','high','critical') then p_priority else 'normal' end,
    'open', now(), auth.uid())
  returning id into v_rfi;

  return v_rfi;
end;
$$;

comment on function app.conflict_to_rfi(uuid, text, text) is
  'Turns a document conflict into the question it implies, carrying both sides across as the existing information. Sets rfis.conflict_id, which has pointed here since 0006 and was never written. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- Doors
-- -----------------------------------------------------------------------------
create or replace view my_document_conflicts as
select c.id, c.estimate_version_id, c.line_item_id, c.title, c.description,
       c.source_a, c.source_a_says, c.source_b, c.source_b_says,
       c.discipline, c.severity, c.quantity_impact, c.cost_impact, c.schedule_impact,
       c.resolution, c.resolved_at, c.detected_by, c.created_at,
       l.description as line_description,
       e.number as estimate_number,
       (select count(*) from rfis r where r.conflict_id = c.id) as rfi_count
  from document_conflicts c
  left join estimate_line_items l on l.id = c.line_item_id
  left join estimate_versions v on v.id = c.estimate_version_id
  left join estimates e on e.id = v.estimate_id;

revoke all on my_document_conflicts from public, anon;
grant select on my_document_conflicts to authenticated;
alter view my_document_conflicts set (security_invoker = on);

comment on view my_document_conflicts is
  'Where the documents disagree, with the line it lands on and whether it has been asked about.';

create or replace function public.raise_document_conflict(
  p_title text, p_description text, p_source_a text, p_source_a_says text,
  p_source_b text, p_source_b_says text, p_version uuid default null,
  p_line uuid default null, p_discipline text default null,
  p_severity text default 'moderate', p_quantity_impact boolean default false,
  p_cost_impact boolean default false, p_schedule_impact boolean default false,
  p_detected_by text default 'human')
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.raise_document_conflict(p_title, p_description, p_source_a, p_source_a_says,
       p_source_b, p_source_b_says, p_version, p_line, p_discipline, p_severity,
       p_quantity_impact, p_cost_impact, p_schedule_impact, p_detected_by); $$;

create or replace function public.resolve_document_conflict(p_conflict uuid, p_resolution text)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.resolve_document_conflict(p_conflict, p_resolution); $$;

create or replace function public.conflict_to_rfi(
  p_conflict uuid, p_question text default null, p_priority text default 'normal')
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.conflict_to_rfi(p_conflict, p_question, p_priority); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'app.raise_document_conflict(text, text, text, text, text, text, uuid, uuid, text, text, boolean, boolean, boolean, text)',
    'public.raise_document_conflict(text, text, text, text, text, text, uuid, uuid, text, text, boolean, boolean, boolean, text)',
    'app.resolve_document_conflict(uuid, text)',
    'public.resolve_document_conflict(uuid, text)',
    'app.conflict_to_rfi(uuid, text, text)',
    'public.conflict_to_rfi(uuid, text, text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

select app.assert_security_gates();
