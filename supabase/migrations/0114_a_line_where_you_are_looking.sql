-- =============================================================================
-- 0114 — A line where you are looking, in the order you want it
--
-- `estimate_line_items.sort_order` has existed since migration 0006 and every
-- screen reads it. Nothing has ever written it except `add_estimate_line`,
-- which appends: max + 10, always at the bottom.
--
-- That leaves an estimator two things they cannot do, and both are ordinary.
--
--   * **Insert where they are looking.** Remembering a line belongs between the
--     eighth and ninth means adding it at the bottom and having no way to move
--     it — so the sequence a bid is read in stops matching the sequence the
--     work happens in.
--   * **Reorder.** A proposal is read top to bottom by somebody deciding
--     whether to award it. The order is part of the document.
--
-- Both are one operation underneath: rewrite the order of one version's lines.
-- `app.renumber_estimate_lines` does that, in tens, so the numbers stay
-- readable and there is room between them. Renumbering rather than picking a
-- value between two neighbors is deliberate — fractional insertion runs out of
-- room after about fifty inserts in the same gap, silently, and the estimator
-- who hits it has no idea why the line went to the wrong place.
--
-- Order is kept within a parent. A child line belongs under its parent (0066's
-- hierarchy), and moving one out from under it by reordering would change what
-- the line means, not where it sits. Moving across parents is refused with a
-- reason rather than done quietly.
-- =============================================================================

/**
 * Rewrite one version's line order as 10, 20, 30.
 *
 * Siblings are numbered within their parent, so a child's order is independent
 * of its parent's — two children of different parents may both be 10 and that
 * is correct, because they are never compared with each other.
 */
create or replace function app.renumber_estimate_lines(p_version uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  update estimate_line_items l
     set sort_order = n.rank * 10
    from (
      select id,
             row_number() over (
               partition by coalesce(parent_line_id, '00000000-0000-0000-0000-000000000000'::uuid)
               order by sort_order, created_at, id) as rank
        from estimate_line_items
       where estimate_version_id = p_version
    ) n
   where l.id = n.id
     and l.sort_order is distinct from n.rank * 10;
end;
$$;

comment on function app.renumber_estimate_lines(uuid) is
  'Rewrites an estimate version''s line order as 10, 20, 30 within each parent. WORKFLOW support for inserting and moving a line.';

/**
 * Add a line immediately after another one.
 *
 * The library lookup, the unit, the description and the production rate are
 * `app.add_estimate_line`'s job and are not repeated here — this places what
 * that produced. Doing it any other way would give the plus button on a row
 * different behavior from the button at the top of the table, which is the
 * kind of difference nobody discovers until a line prices strangely.
 */
create or replace function app.insert_estimate_line_after(
  p_line uuid,
  p_service uuid default null,
  p_description text default null,
  p_quantity numeric default 0,
  p_unit app.unit_code default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_version uuid;
  v_parent  uuid;
  v_after   int;
  v_new     uuid;
begin
  select estimate_version_id, parent_line_id, sort_order
    into v_version, v_parent, v_after
  from estimate_line_items where id = p_line;
  if v_version is null then
    raise exception 'No such estimate line' using errcode = 'no_data_found';
  end if;

  v_new := app.add_estimate_line(v_version, p_service, p_description, p_quantity, p_unit);

  /*
   * Half a step past the line it follows, then renumbered. The half step only
   * has to survive until the renumber two statements later, so it cannot run
   * out of room the way a permanent fractional order would.
   */
  update estimate_line_items
     set parent_line_id = v_parent,
         sort_order = v_after + 5
   where id = v_new;

  perform app.renumber_estimate_lines(v_version);
  return v_new;
end;
$$;

/**
 * Move a line to sit after another, or to the top.
 *
 * `p_after` null means first. Both lines must be siblings: a line's parent says
 * what it is part of, and changing that by dragging would be a different
 * operation wearing the same gesture.
 */
create or replace function app.move_estimate_line(
  p_line uuid,
  p_after uuid default null)
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_version uuid;
  v_company uuid;
  v_status  app.estimate_status;
  v_parent  uuid;
  v_after_version uuid;
  v_after_parent  uuid;
  v_order   uuid[];
  i         int;
begin
  select l.estimate_version_id, l.parent_line_id, v.company_id, v.status
    into v_version, v_parent, v_company, v_status
  from estimate_line_items l
  join estimate_versions v on v.id = l.estimate_version_id
  where l.id = p_line;
  if v_version is null then
    raise exception 'No such estimate line' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'estimates.write') then
    raise exception 'You do not have permission to change this estimate'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status not in ('draft', 'in_review') then
    raise exception 'This version is %; make a new version to change it', v_status
      using errcode = 'check_violation',
            hint = 'app.revise_estimate_version copies it forward with a reason.';
  end if;

  if p_after is not null then
    if p_after = p_line then
      raise exception 'A line cannot be moved after itself' using errcode = 'check_violation';
    end if;
    select estimate_version_id, parent_line_id into v_after_version, v_after_parent
    from estimate_line_items where id = p_after;
    if v_after_version is null then
      raise exception 'No such estimate line to move after' using errcode = 'no_data_found';
    end if;
    if v_after_version <> v_version then
      raise exception 'Those lines are on different estimates'
        using errcode = 'check_violation';
    end if;
    if v_after_parent is distinct from v_parent then
      raise exception 'A line can be reordered among the lines it sits beside, not moved under a different one'
        using errcode = 'check_violation',
              hint = 'Change what it is part of by editing the line rather than by moving it.';
    end if;
  end if;

  -- The siblings in their current order, with this line taken out of it.
  select array_agg(id order by sort_order, created_at, id) into v_order
  from estimate_line_items
  where estimate_version_id = v_version
    and parent_line_id is not distinct from v_parent
    and id <> p_line;
  v_order := coalesce(v_order, '{}'::uuid[]);

  -- Put it back where it was asked for.
  if p_after is null then
    v_order := array_prepend(p_line, v_order);
  else
    declare v_out uuid[] := '{}'::uuid[];
    begin
      foreach i in array array(select generate_series(1, coalesce(array_length(v_order, 1), 0))) loop
        v_out := v_out || v_order[i];
        if v_order[i] = p_after then
          v_out := v_out || p_line;
        end if;
      end loop;
      v_order := v_out;
    end;
  end if;

  for i in 1 .. coalesce(array_length(v_order, 1), 0) loop
    update estimate_line_items set sort_order = i * 10 where id = v_order[i];
  end loop;
end;
$$;

comment on function app.move_estimate_line(uuid, uuid) is
  'Moves an estimate line among the lines it sits beside. WORKFLOW. Refuses to move one under a different parent, because that changes what the line is part of rather than where it sits.';

-- -----------------------------------------------------------------------------
-- The doors a browser uses
-- -----------------------------------------------------------------------------

create or replace function public.insert_estimate_line_after(
  p_line uuid, p_service uuid default null, p_description text default null,
  p_quantity numeric default 0, p_unit app.unit_code default null)
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin
  return app.insert_estimate_line_after(p_line, p_service, p_description, p_quantity, p_unit);
end; $$;

create or replace function public.move_estimate_line(p_line uuid, p_after uuid default null)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.move_estimate_line(p_line, p_after); end; $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.insert_estimate_line_after(uuid, uuid, text, numeric, app.unit_code)',
    'public.move_estimate_line(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

select app.assert_security_gates();
