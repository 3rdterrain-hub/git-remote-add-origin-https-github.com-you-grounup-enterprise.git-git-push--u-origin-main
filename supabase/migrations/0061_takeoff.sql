-- =============================================================================
-- 0061 — On-screen takeoff, for every trade
--
-- Earthwork takeoff has been complete since the surface work: elevation grids
-- compared cell by cell, cut and fill reported with the coverage actually
-- achieved. What was missing is the measuring every other trade does — a pipe
-- run traced along a plan, a slab outlined, fixtures counted, a roof plane
-- taken off and corrected for pitch.
--
-- Two decisions shape this table and are worth stating plainly.
--
-- **A quantity is not stored.** The geometry is: the points traced, the scale
-- they were traced at, the openings deducted, the pitch, the depth. The
-- quantity follows from those by arithmetic the estimating engine already owns,
-- and storing it as well would create a second copy that can disagree with the
-- shape it came from. This is the same "derive, don't store" rule that governs
-- valid_to on library rates, credential standing, the current metric version
-- and the plan version — and here it also means there is no engine output to
-- forge, so the guard migration 0058 needed is unnecessary rather than absent.
--
-- **A scale records what it was calibrated against.** A drawing scaled off the
-- title block and one calibrated against a dimension string printed on the
-- sheet produce the same number and are not the same claim. Prints get reduced
-- when they are reissued and the stated scale keeps saying what it always said,
-- which is the commonest source of a quietly wrong bid. So the basis is stored,
-- and `measurement_method` is *generated* from it — a calibration cannot claim
-- to be verified unless it names the dimension it was verified against. That
-- feeds the confidence score, which feeds the approval gate, which decides
-- whether the estimate may be issued at all. A measurement taken off an
-- unverified scale cannot quietly become a bid.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The scale a sheet was measured at
-- -----------------------------------------------------------------------------
create table takeoff_calibrations (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  document_sheet_id   uuid not null references document_sheets(id) on delete cascade,

  -- The two points spanning something whose real length is known, in the sheet
  -- space the viewer renders. Stored rather than reduced to a ratio so the
  -- calibration can be shown back on the drawing and re-checked.
  from_x              numeric(14,4) not null,
  from_y              numeric(14,4) not null,
  to_x                numeric(14,4) not null,
  to_y                numeric(14,4) not null,

  -- Feet, because every length in the catalog is feet or derived from it, and a
  -- second length unit here would double the ways a conversion can go wrong.
  known_distance_feet numeric(14,4) not null check (known_distance_feet > 0),

  basis               text not null
                        check (basis in ('known_dimension', 'graphic_scale_bar', 'stated_scale')),
  -- What was measured, in words. A verified calibration must name it.
  reference           text,
  label               text,

  -- Derived, and therefore incapable of disagreeing with the points above.
  span_points         numeric(18,6)
                        generated always as (
                          sqrt(power(to_x - from_x, 2) + power(to_y - from_y, 2))
                        ) stored,

  /*
   * The governance rule, enforced by the column rather than by the application.
   * `known_dimension` with no reference is somebody saying they checked it
   * without saying against what, which is not a check.
   */
  measurement_method  text
                        generated always as (
                          case when basis = 'known_dimension' and reference is not null
                               then 'verified_scale' else 'approximate_scale' end
                        ) stored,

  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Two identical points span nothing and would divide by zero.
  constraint takeoff_calibrations_span check (from_x <> to_x or from_y <> to_y)
);
create index takeoff_calibrations_sheet_idx on takeoff_calibrations(document_sheet_id);
create index takeoff_calibrations_company_idx on takeoff_calibrations(company_id);

create trigger takeoff_calibrations_tenant_parent
  before insert or update on takeoff_calibrations
  for each row execute function app.enforce_tenant_parent('document_sheets', 'document_sheet_id', 'id');

comment on table takeoff_calibrations is
  'The scale a drawing sheet was measured at, and what that scale was checked against. ENTITY. measurement_method is generated: a calibration cannot claim to be verified unless it names the dimension it was verified against, and that value flows into the line confidence score and the approval gate.';
comment on column takeoff_calibrations.basis is
  'known_dimension: checked against a dimension printed on the drawing. graphic_scale_bar: checked against a scale bar — which is drawn on the sheet and reduces with it, so it proves the print is internally consistent and never that it is at the scale it claims. stated_scale: taken from the title block, unverified.';

-- -----------------------------------------------------------------------------
-- A measurement
-- -----------------------------------------------------------------------------
create table takeoff_measurements (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  document_sheet_id   uuid not null references document_sheets(id) on delete cascade,
  calibration_id      uuid references takeoff_calibrations(id) on delete restrict,

  name                text not null check (length(trim(name)) between 1 and 200),
  trade               text,
  kind                text not null check (kind in ('count', 'linear', 'area', 'volume')),
  unit                app.unit_code not null,

  -- The traced shape. An array of {x, y} in the sheet space the calibration was
  -- taken in. This is the measurement; everything else about it follows.
  geometry            jsonb not null,
  -- Openings subtracted from an area: an array of rings, each an array of points.
  deductions          jsonb not null default '[]'::jsonb,
  is_closed           boolean not null default false,

  pitch_rise          numeric(10,4) check (pitch_rise is null or pitch_rise >= 0),
  pitch_run           numeric(10,4) check (pitch_run is null or pitch_run > 0),
  depth_feet          numeric(14,4) check (depth_feet is null or depth_feet > 0),
  width_feet          numeric(14,4) check (width_feet is null or width_feet > 0),
  count_per           numeric(12,4) not null default 1 check (count_per > 0),
  multiplier          numeric(12,4) not null default 1 check (multiplier > 0),

  notes               text,

  /*
   * What was written onto an estimate, and when. Not the current quantity —
   * that is derived from the geometry above whenever anybody asks. Recording
   * the applied figure separately is what lets the platform notice that a
   * measurement has been retraced since it was used to price something.
   */
  applied_line_item_id uuid references estimate_line_items(id) on delete set null,
  applied_quantity     numeric(18,4),
  applied_at           timestamptz,
  applied_by           uuid references auth.users(id) on delete set null,
  applied_engine_version text,

  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- A measured shape needs a scale; a count does not, because counting does not
  -- depend on the calibration being right.
  constraint takeoff_measurements_scale
    check (kind = 'count' or calibration_id is not null),
  constraint takeoff_measurements_geometry
    check (jsonb_typeof(geometry) = 'array' and jsonb_array_length(geometry) >= 1),
  constraint takeoff_measurements_pitch
    check ((pitch_rise is null) = (pitch_run is null)),
  -- A volume needs a depth. Measuring one without is guessing.
  constraint takeoff_measurements_volume_depth
    check (kind <> 'volume' or depth_feet is not null),
  constraint takeoff_measurements_applied
    check (applied_line_item_id is null
           or (applied_quantity is not null and applied_at is not null))
);
create index takeoff_measurements_sheet_idx on takeoff_measurements(document_sheet_id);
create index takeoff_measurements_company_idx on takeoff_measurements(company_id);
create index takeoff_measurements_line_idx on takeoff_measurements(applied_line_item_id)
  where applied_line_item_id is not null;

create trigger takeoff_measurements_tenant_parent
  before insert or update on takeoff_measurements
  for each row execute function app.enforce_tenant_parent('document_sheets', 'document_sheet_id', 'id');

comment on table takeoff_measurements is
  'A quantity measured off a drawing. ENTITY. The row holds the geometry, not the quantity: the number follows from the shape and the scale by arithmetic the estimating engine owns, and a stored copy could disagree with the shape it came from. applied_quantity records what was actually written onto an estimate line, so a measurement retraced afterwards can be told apart from one still in step with its line.';

comment on column takeoff_measurements.geometry is
  'The traced points, in the sheet space the calibration was taken in. This is the measurement. Retracing it changes the quantity everywhere it is read, which is the point.';

/**
 * Which minimum a shape needs.
 *
 * Enforced here rather than by four separate checks, so the rule reads as one
 * rule: a run needs two points, an outline needs three, a count needs one.
 */
create or replace function app.takeoff_geometry_is_sufficient(p_kind text, p_geometry jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  -- Non-array geometry is insufficient rather than an error: check constraints
  -- are evaluated in no guaranteed order, so this one must survive input the
  -- shape constraint beside it would have rejected.
  select jsonb_typeof(p_geometry) = 'array'
     and jsonb_array_length(p_geometry) >= case p_kind
       when 'count'  then 1
       when 'linear' then 2
       else 3
     end;
$$;

alter table takeoff_measurements
  add constraint takeoff_measurements_enough_points
    check (app.takeoff_geometry_is_sufficient(kind, geometry));

/**
 * Has this measurement moved since it was used to price something?
 *
 * Derived from the two timestamps rather than flagged, because a flag has to be
 * cleared by somebody and this cannot be wrong.
 */
create or replace view reporting_takeoff_status
with (security_invoker = true) as
select
  m.id                  as measurement_id,
  m.company_id,
  m.document_sheet_id,
  m.name,
  m.trade,
  m.kind,
  m.unit,
  m.applied_line_item_id,
  m.applied_quantity,
  m.applied_at,
  c.measurement_method,
  c.basis               as scale_basis,
  c.reference           as scale_reference,
  s.sheet_number,
  s.sheet_title,
  s.drawing_scale       as stated_scale,
  m.updated_at,
  -- Retraced after it was applied: the estimate line no longer reflects the
  -- shape on the drawing.
  (m.applied_at is not null and m.updated_at > m.applied_at) as stale_on_line
from takeoff_measurements m
left join takeoff_calibrations c on c.id = m.calibration_id
join document_sheets s on s.id = m.document_sheet_id;

comment on view reporting_takeoff_status is
  'Every measurement with the standing of the scale it was taken at and whether it has been retraced since it was applied to an estimate line. stale_on_line is derived from the timestamps, so it cannot be left set after somebody fixes the line.';

grant select on reporting_takeoff_status to authenticated;
revoke all on reporting_takeoff_status from anon;

-- -----------------------------------------------------------------------------
-- RLS
--
-- Takeoff is estimating: measuring a drawing is how a quantity is arrived at,
-- so it is governed by the permission that governs the estimate it feeds.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['takeoff_calibrations', 'takeoff_measurements'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy %1$s_select on %1$I for select to authenticated
                     using (app.has_permission(company_id, 'estimates.read'))$p$, t);
    execute format($p$create policy %1$s_insert on %1$I for insert to authenticated
                     with check (app.has_permission(company_id, 'estimates.write'))$p$, t);
    execute format($p$create policy %1$s_update on %1$I for update to authenticated
                     using (app.has_permission(company_id, 'estimates.write'))
                     with check (app.has_permission(company_id, 'estimates.write'))$p$, t);
    execute format($p$create policy %1$s_delete on %1$I for delete to authenticated
                     using (app.has_permission(company_id, 'estimates.write'))$p$, t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('revoke all on %I from anon', t);
  end loop;
end $$;

select app.assert_security_gates();
