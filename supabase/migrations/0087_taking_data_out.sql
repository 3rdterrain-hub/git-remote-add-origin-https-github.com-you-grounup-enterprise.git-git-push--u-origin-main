-- =============================================================================
-- 0087 — Taking data out
--
-- An export is the one action that removes a record from every protection this
-- platform has. Row level security, permissions, support sessions, the lot:
-- none of them reach a spreadsheet on somebody's laptop. Everything before this
-- migration has been careful about who may *read* what, and a download is the
-- moment reading stops being the question.
--
-- So the export itself is unremarkable — the rows come from views that already
-- decide who may see them, and a file is assembled from what came back. What
-- this adds is the part that was missing: an export is *recorded*, in the same
-- ledger as everything else, so "who took the customer list, and when" has an
-- answer. `audit_events` has carried an `export` action since migration 0001
-- and nothing had ever written one.
--
-- It is recorded rather than restricted on purpose. An operator who can read
-- the tenant list on screen can copy it by hand, and a platform that pretends
-- otherwise is a platform lying to itself about its own boundaries. What
-- changes an export from unremarkable to answerable is that it leaves a trace.
-- =============================================================================

/**
 * Record that somebody took data out.
 *
 * Called by the console immediately before a file is assembled. It does not
 * gate the export — the views the rows came from already did that — and it
 * deliberately records the *shape* rather than the contents: what was taken and
 * how much of it, never the rows themselves. A ledger that copied the export
 * would be a second copy of the thing the export was worrying about.
 */
create or replace function app.record_export(
  p_what text, p_rows int, p_company uuid default null)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
begin
  if not app.is_platform_admin() then
    raise exception 'Only an operator records a platform export'
      using errcode = 'insufficient_privilege';
  end if;
  if p_what is null or length(trim(p_what)) < 3 then
    raise exception 'An export has to say what it was' using errcode = 'check_violation';
  end if;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (p_company, auth.uid(), 'export', 'public.' || regexp_replace(
            lower(trim(p_what)), '[^a-z0-9_]', '_', 'g'),
          null,
          jsonb_build_object('rows', greatest(coalesce(p_rows, 0), 0)),
          'Exported ' || greatest(coalesce(p_rows, 0), 0) || ' rows of ' || trim(p_what));
end;
$$;

revoke all on function app.record_export(text, int, uuid) from public, anon;
grant execute on function app.record_export(text, int, uuid) to authenticated;

comment on function app.record_export(text, int, uuid) is
  'Records that an operator took data out of the platform. Records the shape — what and how many rows — and never the contents, because a ledger that copied the export would be a second copy of the thing the export was worrying about. Does not gate anything: the views the rows came from already decided who may read them, and somebody who can read a list on screen can copy it by hand.';

create or replace function public.record_export(
  p_what text, p_rows int, p_company uuid default null)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.record_export(p_what, p_rows, p_company); end; $$;

revoke all on function public.record_export(text, int, uuid) from public, anon;
grant execute on function public.record_export(text, int, uuid) to authenticated;

/** What has been taken out, and by whom. */
create or replace view admin_exports as
select
  e.occurred_at,
  e.actor_id                              as operator_id,
  coalesce(e.actor_email, up.email)       as operator_email,
  a.role_key                              as operator_role,
  -- Back to the words somebody typed, from the table-shaped name it was stored
  -- under so it sits beside every other entity in the ledger.
  replace(replace(e.entity_table, 'public.', ''), '_', ' ') as what,
  (e.new_state ->> 'rows')::int           as rows,
  e.company_id,
  c.name                                  as company_name
from audit_events e
join platform_admins a on a.user_id = e.actor_id
left join user_profiles up on up.id = e.actor_id
left join companies c on c.id = e.company_id
where e.action = 'export'
  and e.occurred_at > now() - interval '180 days'
  and app.operator_can('operators.manage')
order by e.occurred_at desc;

comment on view admin_exports is
  'Every time an operator took data out of the platform, and how much. The one action that removes a record from every protection this platform has, so the answer to "who has the customer list" is a query rather than a guess.';

grant select on admin_exports to authenticated;
revoke all on admin_exports from anon;

select app.assert_security_gates();
