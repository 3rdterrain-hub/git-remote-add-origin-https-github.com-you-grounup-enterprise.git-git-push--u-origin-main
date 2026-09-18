-- =============================================================================
-- 0231 — A reading that survives being interrupted
--
-- `ai-analyze-document` died on the first real plan set it was given: fourteen
-- scanned pages, and the Supabase worker was killed at its resource limit
-- before the model answered. The platform kills the worker, so the function's
-- own `catch` never runs, so the job it had already opened stayed at
-- `extracting` for as long as anybody cared to look. The screen showed a
-- spinner for a process that had not existed for seven minutes.
--
-- Two separate faults, and the second is the worse one:
--
--   1. The scanned path base64-encoded the whole file into the request. A 25 MB
--      set becomes a 25 MB binary string, then a 33 MB base64 string, then the
--      same 33 MB again inside the serialized request body — on a worker with
--      256 MB and a long stream held open. Reading fewer pages per call would
--      not have helped, because every call did all of that again. That fault is
--      fixed in the function, by uploading the file once and referring to it by
--      id afterwards; `provider_file_id` below is where that id is kept so a
--      resumed run does not upload it a second time.
--
--   2. Nothing ever decided a job was dead. `pages_total` and `pages_processed`
--      have been columns since 0019 and nothing has ever advanced them past the
--      end — the schema anticipated a reading done in pieces and it was never
--      built. A job in pieces is a job that can stop between them, so something
--      has to say when a silence has gone on too long.
--
-- Ten minutes is the silence. A single batch is a minute at the outside, so a
-- job that has not moved in ten has not been slow — it has been killed.
--
-- WORKFLOW.
-- =============================================================================

alter table ingestion_jobs
  add column if not exists provider_file_id text;

comment on column ingestion_jobs.provider_file_id is
  'The reading model''s own id for the uploaded file. Kept so a job resumed in a second invocation refers to the file rather than sending it again — sending it again is what killed the worker.';

/**
 * Close out jobs that stopped moving.
 *
 * Deliberately not a trigger and not a cron. It is called at the start of every
 * analysis, which is the moment somebody is looking at this company's jobs and
 * therefore the moment a stale one matters. A sweep that runs when nobody is
 * watching would close jobs nobody was waiting on.
 *
 * `failed` rather than deleted, and with a message that says what happened
 * rather than "error": a person who asked for a plan set to be read is owed the
 * difference between "the model refused it" and "the reader was cut off".
 */
create or replace function app.abandon_stranded_ingestion_jobs(
  p_company uuid,
  p_minutes int default 10)
returns int
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_closed int;
begin
  update ingestion_jobs j
     set stage = 'failed',
         error_message = format(
           'Stopped after %s of %s pages. The reader was cut off and did not come back; '
           || 'nothing it had already found was lost. Ask for it again to carry on.',
           j.pages_processed, coalesce(j.pages_total, 0)),
         duration_ms = coalesce(j.duration_ms,
           (extract(epoch from (now() - coalesce(j.started_at, j.created_at))) * 1000)::int),
         updated_at = now()
   where j.company_id = p_company
     and j.stage not in ('complete', 'failed')
     and j.updated_at < now() - make_interval(mins => greatest(p_minutes, 1));
  get diagnostics v_closed = row_count;
  return v_closed;
end;
$$;

revoke all on function app.abandon_stranded_ingestion_jobs(uuid, int) from public, anon;
grant execute on function app.abandon_stranded_ingestion_jobs(uuid, int) to authenticated, service_role;

comment on function app.abandon_stranded_ingestion_jobs(uuid, int) is
  'Marks failed any ingestion job this company has that has not moved in the stated number of minutes. A killed worker never runs its own error handler, so without this a job stays at its last stage forever and the screen shows a spinner for a process that no longer exists. WORKFLOW.';

create or replace function public.abandon_stranded_ingestion_jobs(
  p_company uuid, p_minutes int default 10)
returns int language sql security invoker set search_path = public, pg_catalog
as $$ select app.abandon_stranded_ingestion_jobs(p_company, p_minutes); $$;

revoke all on function public.abandon_stranded_ingestion_jobs(uuid, int) from public, anon;
grant execute on function public.abandon_stranded_ingestion_jobs(uuid, int) to authenticated;

select app.assert_security_gates();
