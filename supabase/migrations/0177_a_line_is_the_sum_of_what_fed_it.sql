/**
 * A line is the sum of what fed it.
 *
 * `apply_takeoff_to_line` wrote `measured_quantity = p_quantity`. It
 * overwrote. Trace the six-inch sidewalk in twelve places on a site plan,
 * apply each one to the sidewalk line, and the line ends up holding the
 * twelfth measurement's quantity — not the total. No error and no warning: a
 * number that looks right and is not, which is the most expensive kind this
 * platform can produce.
 *
 * The function's own author knew a line takes more than one measurement. The
 * comment above `source_references` says so — "Appended rather than replaced: a
 * line may be supported by more than one measurement, and dropping the others
 * would lose the argument." The citations accumulated and the quantity did not.
 *
 * Measuring one thing in several places is not an edge case. It is what a site
 * plan is: a sidewalk in twelve runs, curb on four streets, pavement in three
 * lots. Every takeoff product built for estimators accumulates, because the
 * shape and the priced item are not the same object.
 *
 * **Recomputed, never incremented.** The same rule as `refresh_line_conflict_count`
 * in 0170 and the same reason: an increment is a running total that drifts the
 * first time anything is deleted, retraced or applied twice. A trigger recomputes
 * the line from the measurements that point at it, so removing a measurement
 * corrects the line without anybody remembering to, and no writer can go round it.
 *
 * WORKFLOW.
 */

-- -----------------------------------------------------------------------------
-- The sum
-- -----------------------------------------------------------------------------

/**
 * Set a line's measured quantity to the sum of the measurements applied to it.
 *
 * `security definer` because it runs from a trigger on `takeoff_measurements`
 * and has to write a line the caller reaches through a different policy.
 *
 * Silent when the line's version is frozen. A trigger is not the place to
 * refuse an issued estimate — `assert_line_open` already does that at the door,
 * with a sentence that says what to do instead — and a delete of some unrelated
 * measurement must not fail because a line it once fed has since been issued.
 */
create or replace function app.recompute_line_measured_quantity(p_line uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_total  numeric;
  v_status app.estimate_status;
begin
  if p_line is null then return; end if;

  select v.status into v_status
    from estimate_line_items l
    join estimate_versions v on v.id = l.estimate_version_id
   where l.id = p_line;
  if v_status is null or v_status not in ('draft', 'in_review') then
    return;
  end if;

  select coalesce(sum(m.applied_quantity), 0) into v_total
    from takeoff_measurements m
   where m.applied_line_item_id = p_line;

  update estimate_line_items
     set measured_quantity = v_total, updated_at = now()
   where id = p_line;
end;
$$;

comment on function app.recompute_line_measured_quantity(uuid) is
  'Sets a line''s measured quantity to the sum of the measurements applied to it. Recomputed rather than incremented, so a deleted or retraced measurement corrects the line without anybody remembering to. WORKFLOW.';

/**
 * Keep the line in step with its measurements, whatever moved them.
 *
 * Covers the line a measurement moved *to* and the one it moved *from*, so
 * reassigning a shape corrects both ends.
 */
create or replace function app.sync_line_from_measurements()
returns trigger
language plpgsql security definer set search_path = public, pg_catalog
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.applied_line_item_id is not null then
    perform app.recompute_line_measured_quantity(old.applied_line_item_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.applied_line_item_id is not null
     and new.applied_line_item_id is distinct from old.applied_line_item_id then
    perform app.recompute_line_measured_quantity(new.applied_line_item_id);
  elsif tg_op in ('INSERT', 'UPDATE') and new.applied_line_item_id is not null then
    perform app.recompute_line_measured_quantity(new.applied_line_item_id);
  end if;
  return null;
end;
$$;

drop trigger if exists takeoff_measurements_sync_line on takeoff_measurements;
create trigger takeoff_measurements_sync_line
  after insert or update or delete on takeoff_measurements
  for each row execute function app.sync_line_from_measurements();

comment on function app.sync_line_from_measurements() is
  'Recomputes the estimate line whenever a measurement applied to it is written, moved or removed. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- Applying one
-- -----------------------------------------------------------------------------

/**
 * Put a measurement on a line.
 *
 * Rebuilt from the 0147 definition, the only one there has ever been. Every
 * check is unchanged — the company match, `assert_line_open`, the measurement
 * method taken from the calibration rather than from the caller, the appended
 * citation. Two things are different:
 *
 *   * the line's quantity is no longer written here at all; the trigger sums it
 *   * a measurement in a different unit from the ones already on the line is
 *     refused, because adding square feet to cubic yards produces a number with
 *     no meaning and nothing downstream would notice
 */
create or replace function app.apply_takeoff_to_line(
  p_measurement uuid,
  p_line_item   uuid,
  p_quantity    numeric,
  p_engine_version text
)
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_m         takeoff_measurements%rowtype;
  v_method    text;
  v_sheet     text;
  v_reference text;
  v_other     app.unit_code;
begin
  if p_quantity is null or p_quantity < 0 then
    raise exception 'A takeoff quantity must be zero or more'
      using errcode = 'check_violation';
  end if;
  if p_engine_version is null or length(trim(p_engine_version)) = 0 then
    raise exception 'An applied measurement must record which engine measured it'
      using errcode = 'check_violation';
  end if;

  select * into v_m from takeoff_measurements where id = p_measurement;
  if not found then
    raise exception 'Measurement % not found', p_measurement using errcode = 'no_data_found';
  end if;

  if not exists (select 1 from estimate_line_items where id = p_line_item) then
    raise exception 'Estimate line % not found', p_line_item using errcode = 'no_data_found';
  end if;

  if not exists (
    select 1 from estimate_line_items l
    where l.id = p_line_item and l.company_id = v_m.company_id
  ) then
    raise exception 'That measurement and that estimate line belong to different companies'
      using errcode = 'insufficient_privilege';
  end if;

  perform app.assert_line_open(p_line_item);

  /*
   * One unit to a line. Two measurements that do not measure the same kind of
   * thing cannot be added, and a line holding the sum of square feet and cubic
   * yards is worse than a line holding neither.
   */
  select m.unit into v_other
    from takeoff_measurements m
   where m.applied_line_item_id = p_line_item
     and m.id <> p_measurement
   limit 1;
  if v_other is not null and v_other <> v_m.unit then
    raise exception
      'This line is measured in %, and that measurement is in %. A line adds up one unit.',
      v_other, v_m.unit
      using errcode = 'check_violation',
            hint = 'Put it on its own line, or measure it in the same unit.';
  end if;

  if v_m.kind = 'count' then
    v_method := 'derived';
  else
    select c.measurement_method into v_method
    from takeoff_calibrations c where c.id = v_m.calibration_id;
    if v_method is null then
      raise exception 'That measurement has no scale, so there is nothing to say about how it was measured'
        using errcode = 'check_violation';
    end if;
  end if;

  select coalesce(s.sheet_number, 'p.' || s.page_number) into v_sheet
  from document_sheets s where s.id = v_m.document_sheet_id;

  v_reference := format('Takeoff %s on %s (%s)', v_m.name, v_sheet, v_method);

  update estimate_line_items
     set unit               = v_m.unit,
         measurement_method = v_method::app.measurement_method,
         -- Appended rather than replaced: a line may be supported by more than
         -- one measurement, and dropping the others would lose the argument.
         source_references  = (
           select array_agg(distinct r)
           from unnest(source_references || array[v_reference]) r),
         updated_at         = now()
   where id = p_line_item;

  /* The trigger sums the line from this. */
  update takeoff_measurements
     set applied_line_item_id   = p_line_item,
         applied_quantity       = p_quantity,
         applied_at             = now(),
         applied_by             = auth.uid(),
         applied_engine_version = p_engine_version,
         updated_at             = now()
   where id = p_measurement;
end;
$$;

comment on function app.apply_takeoff_to_line(uuid, uuid, numeric, text) is
  'Puts a measurement on an estimate line. The line''s quantity is the sum of every measurement applied to it, recomputed by trigger — before 0177 this overwrote, so a sidewalk traced in twelve runs priced as the twelfth. WORKFLOW.';

/**
 * Take a measurement back off a line.
 *
 * The shape is kept — it is still measured and still drawn on the sheet — and
 * the line falls by that much. Without this the only way to correct a
 * misapplied measurement was to delete the tracing.
 */
create or replace function app.unapply_takeoff(p_measurement uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_m takeoff_measurements%rowtype;
begin
  select * into v_m from takeoff_measurements where id = p_measurement;
  if not found then
    raise exception 'Measurement % not found', p_measurement using errcode = 'no_data_found';
  end if;
  if v_m.applied_line_item_id is null then
    return;
  end if;
  perform app.assert_line_open(v_m.applied_line_item_id);

  update takeoff_measurements
     set applied_line_item_id   = null,
         applied_quantity       = null,
         applied_at             = null,
         applied_by             = null,
         applied_engine_version = null,
         updated_at             = now()
   where id = p_measurement;
end;
$$;

comment on function app.unapply_takeoff(uuid) is
  'Takes a measurement back off its line, keeping the tracing. The line is recomputed without it. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- What a line is made of
-- -----------------------------------------------------------------------------

/**
 * The measurements behind a line's quantity.
 *
 * A quantity nobody can break down is a quantity nobody can check. This is how
 * an estimator answers "where did 4,180 square feet come from" without opening
 * fourteen sheets — and it is the list that shows one of them was traced twice.
 */
create or replace view my_line_measurements as
select m.id,
       m.company_id,
       m.applied_line_item_id as line_item_id,
       m.name,
       m.kind,
       m.unit,
       m.applied_quantity,
       m.applied_at,
       m.document_sheet_id,
       coalesce(nullif(concat_ws(' — ', nullif(s.sheet_number, ''), nullif(s.sheet_title, '')), ''),
                'p.' || s.page_number) as sheet_label,
       d.name as document_name,
       (m.applied_at is not null and m.updated_at > m.applied_at) as retraced_since_applied
  from takeoff_measurements m
  join document_sheets s on s.id = m.document_sheet_id
  join document_versions v on v.id = s.document_version_id
  join documents d on d.id = v.document_id
 where m.applied_line_item_id is not null;

revoke all on my_line_measurements from public, anon;
grant select on my_line_measurements to authenticated;
alter view my_line_measurements set (security_invoker = on);

comment on view my_line_measurements is
  'What a line''s quantity is made of, sheet by sheet. A total nobody can break down is a total nobody can check.';

create or replace function public.unapply_takeoff(p_measurement uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.unapply_takeoff(p_measurement); $$;

do $$
begin
  execute 'revoke all on function public.unapply_takeoff(uuid) from public, anon';
  execute 'grant execute on function public.unapply_takeoff(uuid) to authenticated';
end $$;
