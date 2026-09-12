-- =============================================================================
-- 0157 — Three buttons on a project, and what they were missing
--
-- `project-detail` was made live in 0142 and shipped with three buttons that did
-- nothing: Daily report, Change order, New RFI. The tables behind them have
-- existed since 0006 and 0007 and are fully governed — a submitted daily report
-- freezes its date (0013), an executed change order refuses edits (0032), an
-- answered RFI must carry its answer — and not one of them had a writer.
--
-- So the project a company runs could be read in detail and could not be
-- *worked*. No day could be recorded, no change priced, no question asked.
--
-- Three functions, each doing the same four things a browser must not be
-- trusted to do for itself:
--
--   * **The company comes from the project**, never from the caller. A browser
--     that could name the company on a write could name somebody else's.
--   * **The permission is checked against that company**: `projects.write` for
--     a day on site and a change to the contract, `estimates.write` for an RFI,
--     which is what 0010 already decided for each table.
--   * **The number is generated here.** A change order is unique per project and
--     an RFI per company, so two people clicking at the same moment would
--     otherwise collide on an index — the same reason 0127 and 0156 generate a
--     code rather than letting a screen pick one.
--   * **Nothing is submitted on creation.** A daily report starts unsubmitted
--     because submitting is what freezes it; a change order starts `potential`
--     because a change nobody has priced is not yet a claim on anybody; an RFI
--     starts `draft` for the same reason. Each is a record somebody is *going*
--     to fill in, and starting it in the state that ends the workflow would be
--     the workflow having no steps.
--
-- Workflow: the three things a project manager does on a live job.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Numbers that do not collide
-- -----------------------------------------------------------------------------

/** CO-001 for this project. Per project, because that is where the index is. */
create or replace function app.next_change_order_number(p_project uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select 'CO-' || lpad((coalesce(max(substring(c.number from '^CO-(\d+)$')::int), 0) + 1)::text, 3, '0')
  from change_orders c
  where c.project_id = p_project and c.number ~ '^CO-\d+$';
$$;

comment on function app.next_change_order_number(uuid) is
  'The next unused CO-000 for one project. WORKFLOW support: change_orders is unique on (project_id, number), so a screen must not pick this itself.';

/** RFI-0001 for this company. Per company, because that is where the index is. */
create or replace function app.next_rfi_number(p_company uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select 'RFI-' || lpad((coalesce(max(substring(r.number from '^RFI-(\d+)$')::int), 0) + 1)::text, 4, '0')
  from rfis r
  where r.company_id = p_company and r.number ~ '^RFI-\d+$';
$$;

comment on function app.next_rfi_number(uuid) is
  'The next unused RFI-0000 for one company. WORKFLOW support: rfis is unique on (company_id, number), across projects and estimates alike.';

-- -----------------------------------------------------------------------------
-- The company a project belongs to, and whether you may write to it
-- -----------------------------------------------------------------------------

/**
 * Resolve the project and check one permission against its owner.
 *
 * Every one of the three writers needs this and none of them should take the
 * company as an argument: a caller who can name the company on a write can name
 * a company that is not theirs, and the only safe answer is to read it off the
 * row being written to.
 */
create or replace function app.project_company_for_write(p_project uuid, p_permission text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  select company_id into v_company from projects where id = p_project;
  if v_company is null then
    raise exception 'No such project' using errcode = 'no_data_found';
  end if;
  if not app.is_member(v_company) then
    -- Said the same way as "no such project", because which of the two it is
    -- tells a stranger whether a project id exists.
    raise exception 'No such project' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, p_permission) then
    raise exception 'You do not have permission to change this project'
      using errcode = 'insufficient_privilege';
  end if;
  return v_company;
end;
$$;

comment on function app.project_company_for_write(uuid, text) is
  'The company owning a project, once the caller is shown to be a member with a stated permission. WORKFLOW support: the three project writers read the company off the project rather than taking it from the browser.';

-- -----------------------------------------------------------------------------
-- A day on site
-- -----------------------------------------------------------------------------

/**
 * Start the daily report for a date.
 *
 * Unsubmitted. Submitting is a separate act because it is what freezes the
 * record — 0013 refuses to move a submitted report's date, on the grounds that
 * it is evidence in a claim — and a report created already frozen could never
 * be filled in.
 *
 * One report per project per day is an index, not a rule this invents, so the
 * duplicate is caught by name rather than by a constraint message.
 */
create or replace function app.create_daily_report(
  p_project uuid,
  p_date date default current_date,
  p_work_performed text default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.project_company_for_write(p_project, 'projects.write');
  v_id      uuid;
begin
  if p_date > current_date then
    raise exception 'A daily report records a day that has happened'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from daily_reports
              where project_id = p_project and report_date = p_date) then
    raise exception 'There is already a daily report for %', to_char(p_date, 'FMDay, FMDD FMMonth YYYY')
      using errcode = 'unique_violation',
            hint = 'Open that one and add to it.';
  end if;

  insert into daily_reports (company_id, project_id, report_date, work_performed)
  values (v_company, p_project, p_date, nullif(trim(coalesce(p_work_performed, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

comment on function app.create_daily_report(uuid, date, text) is
  'Starts the daily report for one day on one project, unsubmitted. WORKFLOW: submitting is separate because submitting is what freezes the record.';

-- -----------------------------------------------------------------------------
-- A change to the contract
-- -----------------------------------------------------------------------------

/**
 * Raise a potential change order.
 *
 * `potential` is the honest starting state: a change nobody has priced and
 * nobody has submitted is not yet a claim on anybody. The cost and schedule
 * impacts are left at zero rather than guessed — they come from pricing the
 * change, and a number typed here would be a number nobody can reproduce.
 */
create or replace function app.create_change_order(
  p_project uuid,
  p_title text,
  p_reason text,
  p_origin text default 'owner_request',
  p_description text default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.project_company_for_write(p_project, 'projects.write');
  v_title   text := nullif(trim(coalesce(p_title, '')), '');
  v_reason  text := nullif(trim(coalesce(p_reason, '')), '');
  v_id      uuid;
begin
  if v_title is null then
    raise exception 'A change order needs a title' using errcode = 'check_violation';
  end if;
  /*
   * The reason is required by the table and required here for a better message.
   * A change order is an argument for money, and one that does not say why is
   * an argument nobody can answer.
   */
  if v_reason is null then
    raise exception 'A change order has to say why the work changed'
      using errcode = 'check_violation';
  end if;

  insert into change_orders (
    company_id, project_id, number, title, description, reason, origin,
    status, created_by)
  values (
    v_company, p_project, app.next_change_order_number(p_project),
    v_title, nullif(trim(coalesce(p_description, '')), ''), v_reason,
    coalesce(nullif(trim(coalesce(p_origin, '')), ''), 'owner_request'),
    'potential', auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

comment on function app.create_change_order(uuid, text, text, text, text) is
  'Raises a potential change order on a project, numbered per project and priced by nothing yet. WORKFLOW: the cost and schedule impacts come from pricing the change, not from this call.';

-- -----------------------------------------------------------------------------
-- A question somebody has to answer
-- -----------------------------------------------------------------------------

/**
 * Raise an RFI against a project.
 *
 * `draft` rather than `open`: an RFI becomes a clock the moment it is issued,
 * and issuing it is a decision separate from writing it down. The number is a
 * company's, not a project's — the same sequence covers RFIs raised against an
 * estimate during a bid, which is what `rfis.estimate_version_id` is for.
 */
create or replace function app.create_rfi(
  p_project uuid,
  p_title text,
  p_question text,
  p_discipline text default null,
  p_priority text default 'normal',
  p_drawing_reference text default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company  uuid := app.project_company_for_write(p_project, 'estimates.write');
  v_title    text := nullif(trim(coalesce(p_title, '')), '');
  v_question text := nullif(trim(coalesce(p_question, '')), '');
  v_id       uuid;
begin
  if v_title is null then
    raise exception 'An RFI needs a title' using errcode = 'check_violation';
  end if;
  if v_question is null then
    raise exception 'An RFI is a question — say what is being asked'
      using errcode = 'check_violation';
  end if;
  if coalesce(p_priority, 'normal') not in ('low', 'normal', 'high', 'critical') then
    raise exception 'Priority is low, normal, high or critical, not %', p_priority
      using errcode = 'check_violation';
  end if;

  insert into rfis (
    company_id, project_id, number, title, question, discipline,
    drawing_reference, priority, status, created_by)
  values (
    v_company, p_project, app.next_rfi_number(v_company),
    v_title, v_question, nullif(trim(coalesce(p_discipline, '')), ''),
    nullif(trim(coalesce(p_drawing_reference, '')), ''),
    coalesce(p_priority, 'normal'), 'draft', auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

comment on function app.create_rfi(uuid, text, text, text, text, text) is
  'Raises an RFI against a project, numbered per company and left in draft. WORKFLOW: issuing an RFI starts a clock, and that is a separate decision from writing it down.';

-- -----------------------------------------------------------------------------
-- The doors a browser uses
-- -----------------------------------------------------------------------------

create or replace function public.create_daily_report(
  p_project uuid, p_date date default current_date, p_work_performed text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_daily_report(p_project, p_date, p_work_performed); $$;

create or replace function public.create_change_order(
  p_project uuid, p_title text, p_reason text,
  p_origin text default 'owner_request', p_description text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_change_order(p_project, p_title, p_reason, p_origin, p_description); $$;

create or replace function public.create_rfi(
  p_project uuid, p_title text, p_question text, p_discipline text default null,
  p_priority text default 'normal', p_drawing_reference text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_rfi(p_project, p_title, p_question, p_discipline,
                            p_priority, p_drawing_reference); $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'app.next_change_order_number(uuid)',
    'app.next_rfi_number(uuid)',
    'app.project_company_for_write(uuid, text)',
    'app.create_daily_report(uuid, date, text)',
    'app.create_change_order(uuid, text, text, text, text)',
    'app.create_rfi(uuid, text, text, text, text, text)',
    'public.create_daily_report(uuid, date, text)',
    'public.create_change_order(uuid, text, text, text, text)',
    'public.create_rfi(uuid, text, text, text, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

select app.assert_security_gates();
