-- =============================================================================
-- 0116 — Adding several at once
--
-- An estimator shopping the library picks eight things, not one. Until now that
-- was eight round trips from a browser, each its own transaction: if the fifth
-- failed the first four were already on the estimate and the estimator had no
-- way to know which. Half an addition is worse than none, because it looks like
-- a complete one.
--
-- So the whole selection is one call and one transaction. `add_estimate_lines`
-- does not reimplement anything — it calls `app.add_estimate_line` per row, in
-- order, exactly as the single path does, and then places them together where
-- they were asked for. A service that behaves differently when added in a batch
-- would be the kind of difference nobody finds until a bid is wrong.
-- =============================================================================

/**
 * Add several lines in one transaction.
 *
 * `p_lines` is a jsonb array of `{service_id, description, quantity, unit}`,
 * each field optional in the same way the single-line function makes it
 * optional. `p_after` places the whole run directly beneath one existing line;
 * null appends.
 *
 * Returns the ids in the order they were given, so a caller can tell which row
 * of its own selection became which line.
 */
create or replace function app.add_estimate_lines(
  p_version uuid,
  p_lines jsonb,
  p_after uuid default null)
returns uuid[]
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_item  jsonb;
  v_id    uuid;
  v_ids   uuid[] := '{}'::uuid[];
  v_order uuid[];
  v_out   uuid[] := '{}'::uuid[];
  i       int;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Say which lines to add, as a list'
      using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    return v_ids;
  end if;
  /*
   * A cap, because this runs in one transaction and a browser sending ten
   * thousand rows is a mistake rather than a request. Well above any real
   * selection: the library search returns fifty at a time.
   */
  if jsonb_array_length(p_lines) > 200 then
    raise exception 'That is more lines than one addition should carry'
      using errcode = 'check_violation',
            hint = 'Add them in groups; each group is its own transaction.';
  end if;

  if p_after is not null
     and not exists (select 1 from estimate_line_items
                      where id = p_after and estimate_version_id = p_version) then
    raise exception 'That line is not on this estimate' using errcode = 'no_data_found';
  end if;

  for v_item in select * from jsonb_array_elements(p_lines) loop
    v_id := app.add_estimate_line(
      p_version,
      nullif(v_item ->> 'service_id', '')::uuid,
      nullif(v_item ->> 'description', ''),
      coalesce((v_item ->> 'quantity')::numeric, 0),
      nullif(v_item ->> 'unit', '')::app.unit_code);
    v_ids := v_ids || v_id;
  end loop;

  /*
   * The order is written once, from the sequence that was asked for, rather
   * than by choosing numbers between neighbors as each line goes in. Picking
   * values between two existing ones runs out of room silently; writing the
   * whole sequence cannot.
   */
  if p_after is not null then
    select array_agg(id order by sort_order, created_at, id) into v_order
    from estimate_line_items
    where estimate_version_id = p_version
      and parent_line_id is null
      and not (id = any (v_ids));

    foreach i in array array(
      select generate_series(1, coalesce(array_length(v_order, 1), 0))) loop
      v_out := v_out || v_order[i];
      if v_order[i] = p_after then
        v_out := v_out || v_ids;
      end if;
    end loop;

    for i in 1 .. coalesce(array_length(v_out, 1), 0) loop
      update estimate_line_items set sort_order = i * 10 where id = v_out[i];
    end loop;
  end if;

  return v_ids;
end;
$$;

comment on function app.add_estimate_lines(uuid, jsonb, uuid) is
  'Adds several estimate lines in one transaction, calling the single-line path per row so a batch cannot behave differently from an addition of one. WORKFLOW.';

create or replace function public.add_estimate_lines(
  p_version uuid, p_lines jsonb, p_after uuid default null)
returns uuid[] language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin return app.add_estimate_lines(p_version, p_lines, p_after); end; $$;

do $$
begin
  execute 'revoke all on function public.add_estimate_lines(uuid, jsonb, uuid) from public, anon';
  execute 'grant execute on function public.add_estimate_lines(uuid, jsonb, uuid) to authenticated';
end $$;

select app.assert_security_gates();
