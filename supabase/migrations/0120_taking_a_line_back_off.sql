-- =============================================================================
-- 0120 — Taking a line back off
--
-- An estimate line could be added, edited, priced, reordered, given a crew, a
-- machine, a haul and a production rate — and never removed. There is no
-- `delete_estimate_line` anywhere in this schema and no button anywhere in the
-- application. An estimator who added the wrong service, or added one twice,
-- had two options: set its quantity to zero and leave a line on the bid that
-- says nothing, or start the estimate again.
--
-- It is the plainest kind of missing thing, and it went missing for the reason
-- these usually do: every migration since 0097 has been about getting something
-- *onto* an estimate, and nothing was ever written about taking it off.
--
-- Three rules, and each is the same rule the rest of estimating already keeps.
--
--   * **A frozen version refuses it.** RULE-009 makes an issued or approved
--     version a record of what was agreed; deleting a line from one would
--     change a document somebody signed off. `app.revise_estimate_version`
--     copies it forward and the copy can lose the line.
--
--   * **Children go with it.** `estimate_line_items.parent_line_id` cascades,
--     so a sub-line cannot be orphaned. The count comes back so a screen can
--     say "three lines" rather than "a line" when a parent had two beneath it.
--
--   * **The AI provenance goes with it too.** A line accepted from a finding
--     carries `applied_entity_id` on that finding; deleting the line without
--     clearing it would leave the finding claiming to have become a row that no
--     longer exists, and a second acceptance would then be refused forever.
--     The finding goes back to `proposed` so it can be reconsidered.
-- =============================================================================

/**
 * Remove a line from an open estimate.
 *
 * Returns how many rows went, counting the line and anything beneath it, so the
 * caller can say what happened rather than guess.
 */
create or replace function app.delete_estimate_line(p_line uuid)
returns int
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_status  app.estimate_status;
  v_version uuid;
  v_gone    int;
begin
  select l.company_id, l.estimate_version_id, v.status
    into v_company, v_version, v_status
  from estimate_line_items l
  join estimate_versions v on v.id = l.estimate_version_id
  where l.id = p_line;
  if v_company is null then
    raise exception 'No such estimate line' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'estimates.write') then
    raise exception 'You do not have permission to change this estimate'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status not in ('draft', 'in_review') then
    raise exception 'This version is %; make a new version to change it', v_status
      using errcode = 'check_violation',
            hint = 'app.revise_estimate_version copies it forward, and the copy can lose the line.';
  end if;

  /*
   * A finding that became this line has to stop claiming so. Left pointing at a
   * deleted row it would also stay `accepted` forever, and the quantity it
   * found could never be reconsidered — the worst outcome of a delete is a
   * finding that can no longer be used.
   */
  update ai_findings f
     set state = 'proposed',
         applied_entity_table = null,
         applied_entity_id = null,
         reviewed_by = null,
         reviewed_at = null,
         review_note = null
   where f.applied_entity_table = 'estimate_line_items'
     and f.applied_entity_id in (
       select id from estimate_line_items
        where id = p_line or parent_line_id = p_line);

  with removed as (
    delete from estimate_line_items
     where id = p_line or parent_line_id = p_line
    returning 1
  )
  select count(*) into v_gone from removed;

  perform app.renumber_estimate_lines(v_version);
  return v_gone;
end;
$$;

comment on function app.delete_estimate_line(uuid) is
  'Removes a line and anything beneath it from an open estimate, and returns any AI finding that became it to `proposed` so the quantity can be reconsidered. WORKFLOW. A frozen version refuses it — RULE-009 makes that a document, and a revision is how it changes.';

create or replace function public.delete_estimate_line(p_line uuid)
returns int language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin return app.delete_estimate_line(p_line); end; $$;

do $$
begin
  execute 'revoke all on function public.delete_estimate_line(uuid) from public, anon';
  execute 'grant execute on function public.delete_estimate_line(uuid) to authenticated';
end $$;

select app.assert_security_gates();
