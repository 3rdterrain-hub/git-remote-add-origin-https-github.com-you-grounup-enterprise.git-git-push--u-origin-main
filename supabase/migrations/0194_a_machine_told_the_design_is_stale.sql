-- =============================================================================
-- 0194 — A machine that can be told the design it holds is stale
--
-- 0193 gave machine control its first writers, and two of them immediately ran
-- into a guard that was stating its rule too widely.
--
-- `enforce_assignment_file_published` (0048) is the rule "a machine is only
-- ever sent a published file", written as "no update to an assignment naming an
-- unpublished file". Those are not the same sentence, and the gap only became
-- visible once anything could reach the states it covers:
--
--   * **Withdrawing a design could not take it off a single machine.** Marking
--     the carriers as no longer carrying it is an update naming a withdrawn
--     file, so it was refused — leaving the withdrawn design recorded as live
--     on every machine that had it.
--   * **An operator could not confirm a design the office had since replaced.**
--     The confirmation is a fact about what happened on the machine, not a
--     send; refusing it left the record saying the machine had never been heard
--     from at all.
--
-- The rule now fires where a send actually happens: an assignment created, an
-- assignment pointed at a different file, or a stood-down assignment made
-- current again. Everything else is history being written down, and history
-- does not need permission.
--
-- WORKFLOW.
-- =============================================================================

/**
 * A machine is only ever *sent* a published file — and that is all this refuses.
 *
 * 0048 wrote the rule as "no update to an assignment naming an unpublished
 * file", which is wider than the rule it was stating, and the difference only
 * became visible once anything could reach those states. Two ordinary things
 * were impossible:
 *
 *   * **Standing an assignment down.** Withdrawing a design has to mark the
 *     machines that carry it as no longer carrying it — and that update names a
 *     withdrawn file, so it was refused. A withdrawn design could not be taken
 *     off a single machine.
 *   * **Acknowledging.** An operator confirming they have the file is a fact
 *     about what happened, not a send. If the office superseded the design in
 *     the meantime, the confirmation was refused and the record kept saying the
 *     machine had never been heard from.
 *
 * So the check now fires where a send actually happens: an assignment created,
 * an assignment pointed at a different file, or a stood-down assignment made
 * current again. Everything else is history being written down.
 */
create or replace function app.enforce_assignment_file_published()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_file machine_control_files%rowtype;
  v_asset text;
  v_sending boolean;
begin
  v_sending := tg_op = 'INSERT'
    or new.machine_control_file_id is distinct from old.machine_control_file_id
    or (new.is_current and not old.is_current);
  if not v_sending then
    return new;
  end if;

  select * into v_file from machine_control_files where id = new.machine_control_file_id;
  if not found then
    return new;
  end if;

  if v_file.status <> 'published' then
    select asset_number || ' ' || name into v_asset from assets where id = new.asset_id;
    raise exception
      'Machine control file "%" is % and cannot be sent to %. A machine runs a published design or none.',
      v_file.name, v_file.status, coalesce(v_asset, 'a machine')
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

comment on function app.enforce_assignment_file_published() is
  'Refuses to send a machine a design that is not published. Standing an assignment down, and an operator acknowledging one, are records of what happened rather than sends, and are allowed whatever became of the file since.';
