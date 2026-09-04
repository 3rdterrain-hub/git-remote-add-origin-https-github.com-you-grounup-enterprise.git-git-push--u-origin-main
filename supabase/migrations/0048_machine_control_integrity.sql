-- =============================================================================
-- 0048 — What a machine is cutting to
--
-- `machine_control_files` is the last link in the chain that starts at a survey
-- and ends at a blade. It is well modeled — versioned, typed by format and
-- vendor, published with an actor and a moment, superseded rather than
-- replaced, checksummed, and assigned to a machine one file at a time. Five
-- things were not enforced, and every one of them ends with a machine cutting
-- to something nobody can account for. All five were reproduced before this was
-- written.
--
--   * **A file could be published with no checksum.** The column exists and its
--     format is constrained; nothing required it. A published file with no
--     digest cannot be proven to be the file the grader loaded, which is the
--     entire reason to record one.
--   * **The surface could be edited after a file was published from it.** The
--     design a machine is running and the design the platform holds diverge
--     silently, and the quantity computed from that surface no longer describes
--     the ground anybody cut.
--   * **A draft file could be assigned to a machine.** Nothing checked status,
--     so a machine could be sent a design nobody had published.
--   * **A superseded file could be assigned**, which is worse: a design that
--     was published and then explicitly replaced.
--   * **Supersession could close a loop.** A superseded by B superseded by A —
--     the same defect the document layer fixed in 0036, on the artifact where
--     "which one is current" is a person on a machine asking what to build.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A published file is a file somebody can verify
-- -----------------------------------------------------------------------------
/*
 * Strict rather than tolerant: a published row with no checksum would fail this
 * migration rather than be quietly grandfathered. Nothing is deployed, and a
 * digest cannot be invented after the fact — a file nobody can verify is
 * exactly what this constraint exists to prevent from existing.
 */
alter table machine_control_files drop constraint if exists mc_published;
alter table machine_control_files
  add constraint mc_published
  check (status <> 'published'
         or (published_at is not null and published_by is not null
             and checksum_sha256 is not null));

comment on constraint mc_published on machine_control_files is
  'A published machine control file records who published it, when, and the digest of what they published. Without the digest there is no way to show that the file on the machine is the file that was approved.';

-- -----------------------------------------------------------------------------
-- The surface a published file was cut from stops moving
-- -----------------------------------------------------------------------------
/**
 * Refuse a change to the geometry of a surface that a published file came from.
 *
 * Not the whole row: a name or a note may still be corrected. What is frozen is
 * everything the file was generated from — the elevations, the grid, and the
 * georeference added in 0047 — because once those move, the design on the
 * machine and the design in the platform are different things and nothing says
 * so.
 *
 * The way forward is the one the rest of the platform already uses: capture a
 * new surface, publish a new file, supersede the old one.
 */
create or replace function app.enforce_published_surface_frozen()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_file text;
begin
  if new.elevations      is not distinct from old.elevations
     and new.cell_size_ft    is not distinct from old.cell_size_ft
     and new.grid_rows       is not distinct from old.grid_rows
     and new.grid_cols       is not distinct from old.grid_cols
     and new.origin_easting  is not distinct from old.origin_easting
     and new.origin_northing is not distinct from old.origin_northing
     and new.storage_path    is not distinct from old.storage_path
  then
    return new;
  end if;

  select f.name into v_file from machine_control_files f
   where f.surface_id = old.id and f.status = 'published' limit 1;

  if v_file is not null then
    raise exception
      'Surface "%" was published to machines as "%" and its geometry is fixed. Capture a new surface and supersede that file; a machine cutting to a design the platform has since changed is cutting to nothing anybody recorded.',
      old.name, v_file
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger enforce_published_surface_frozen
  before update on surfaces
  for each row execute function app.enforce_published_surface_frozen();

-- -----------------------------------------------------------------------------
-- A machine is only ever sent a published file
-- -----------------------------------------------------------------------------
create or replace function app.enforce_assignment_file_published()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_file machine_control_files%rowtype;
  v_asset text;
begin
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

create trigger enforce_assignment_file_published
  before insert or update on machine_assignments
  for each row execute function app.enforce_assignment_file_published();

-- -----------------------------------------------------------------------------
-- A revision chain has to end somewhere
-- -----------------------------------------------------------------------------
/**
 * The same walk the document layer uses, on the artifact where "which one is
 * current" is somebody on a machine asking what to build.
 */
create or replace function app.enforce_mc_supersession_acyclic()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_at    uuid := new.superseded_by_id;
  v_steps int := 0;
  v_path  text := '';
  v_name  text;
begin
  if v_at is null then
    return new;
  end if;

  while v_at is not null loop
    v_steps := v_steps + 1;
    if v_steps > 64 then
      raise exception 'The supersession chain from % is longer than 64 files; refusing to walk further.',
        new.name using errcode = 'restrict_violation';
    end if;

    select name, superseded_by_id into v_name, v_at from machine_control_files where id = v_at;
    v_path := v_path || ' -> ' || coalesce(v_name, '(missing)');

    if v_at = new.id then
      raise exception
        'Superseding % by that file would close a loop:%  -> %. A revision chain has to end somewhere.',
        new.name, v_path, new.name
        using errcode = 'restrict_violation';
    end if;
  end loop;

  return new;
end;
$$;

create trigger mc_supersession_acyclic
  before insert or update of superseded_by_id on machine_control_files
  for each row execute function app.enforce_mc_supersession_acyclic();

-- -----------------------------------------------------------------------------
-- Machines still running the design that was just replaced
-- -----------------------------------------------------------------------------
/**
 * Notify when a file is superseded and machines are still assigned it.
 *
 * Deliberately a notice rather than a refusal. Superseding is how a design
 * revision reaches the field, and refusing it while a machine is assigned would
 * mean the platform's answer to a corrected design is to hold onto the wrong
 * one. What the platform can do is say loudly which machines are still cutting
 * to the old file, and it does — at critical severity, naming them.
 */
create or replace function app.notify_superseded_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_machines text;
begin
  if new.status <> 'superseded'
     or (tg_op = 'UPDATE' and old.status = 'superseded') then
    return new;
  end if;

  select string_agg(a.asset_number || ' ' || a.name, ', ' order by a.asset_number)
    into v_machines
  from machine_assignments m join assets a on a.id = m.asset_id
  where m.machine_control_file_id = new.id and m.is_current;

  if v_machines is null then
    return new;
  end if;

  insert into notifications (company_id, category, severity, title, body,
                             action_path, action_label, entity_table, entity_id)
  values (
    new.company_id, 'project', 'critical',
    'Superseded design still on ' || v_machines,
    'Machine control file "' || new.name || '" was superseded and these machines are still '
      || 'assigned it: ' || v_machines || '. They are cutting to a design that has been replaced.',
    '/app/survey', 'Reassign the machines', 'public.machine_control_files', new.id::text);

  return new;
end;
$$;

create trigger notify_superseded_assignment
  after insert or update of status on machine_control_files
  for each row execute function app.notify_superseded_assignment();

select app.assert_security_gates();
