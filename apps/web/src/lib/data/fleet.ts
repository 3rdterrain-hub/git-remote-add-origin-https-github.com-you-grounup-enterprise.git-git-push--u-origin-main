/**
 * Fleet, read from the governed schema.
 *
 * Maintenance due is computed here from the meter rather than read from a
 * column, because that is how the platform models it: a schedule records the
 * interval and the meter reading at the last service, and the machine records
 * where its meter is now. P12 established the same rule for the notification
 * that fires — driven by the meter crossing the interval rather than by a
 * clock, because that is how heavy equipment is serviced.
 */
import { unwrap, type Query } from './query';
import { rateInForce } from './library';
import { supabase } from '@/lib/supabase';
import { ASSETS, MAINTENANCE_DUE, WORK_ORDERS, FUEL_TRANSACTIONS } from '@/data/fleet';

export interface AssetRow {
  id: string; assetNumber: string; name: string; assetClass: string | null;
  make: string | null; model: string | null; modelYear: number | null;
  ownership: string; currentHours: number; fuelType: string | null;
  assignedProject: string | null; assignedOperator: string | null;
  status: string; location: string | null; lastTelemetryAt: string | null;
  acquisitionCost: number | null;
  /** Read so the detail panel can correct one that was typed wrong. */
  serialNumber: string | null;
  /** The catalog rate this machine is estimated at, if it is linked to one. */
  equipmentCode: string | null;
  /**
   * What this machine bills at, from the equipment library, by RULE-003.
   *
   * Null when nobody has priced it. The fleet screen read this out of
   * `EQUIPMENT_SPECS` — eight demo machines carrying invented rates — and
   * subtracted a real asset's ownership cost from it. Real equipment codes do
   * not appear in that constant, so the lookup fell through to zero and the
   * "spread" was the ownership cost with a minus sign in front of it.
   */
  hourlyRate: number | null;
  /**
   * Hours the meter actually moved in the last thirty days.
   *
   * Not a utilization percentage. The sample dataset carried one and nothing in
   * the platform computes it: a percentage needs an assumed denominator —
   * hours available per day, working days per month — and inventing one would
   * put a made-up ratio beside a real replacement decision. Hours run is
   * measured, and it answers the same question without the invention.
   */
  hoursLast30: number | null;
}

export interface MaintenanceRow {
  id: string; assetNumber: string; assetName: string; scheduleName: string;
  intervalHours: number | null; lastPerformedHours: number | null;
  currentHours: number; hoursRemaining: number | null;
}

export interface WorkOrderRow {
  id: string; number: string; assetNumber: string; assetName: string;
  title: string; type: string; priority: string; status: string;
  openedAt: string; completedAt: string | null; downtimeHours: number;
  laborCost: number; partsCost: number; outsideCost: number; resolution: string | null;
}

export interface FuelRow {
  id: string; transactedAt: string; assetNumber: string | null; assetName: string;
  gallons: number; pricePerGallon: number; totalCost: number;
  location: string | null; source: string; project: string | null;
  exception: string | null;
  /** Who drew the fuel, where the transaction names an employee. */
  operator: string | null;
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const maybeNum = (v: unknown): number | null =>
  (v === null || v === undefined ? null : Number(v));

const one = <T,>(v: unknown): T | null =>
  (Array.isArray(v) ? (v as T[])[0] : (v as T | null)) ?? null;

export const loadAssets: Query<AssetRow[]> = async (client) => {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const rows = unwrap(await client
    .from('assets')
    .select('id, asset_number, name, asset_class, make, model, model_year, ownership, current_hours, fuel_type, home_location, serial_number, last_telemetry_at, acquisition_cost, status, projects(number), employees(full_name), equipment(code, equipment_rates(source, hourly_rate))')
    .is('disposed_on', null)
    .order('asset_number')) as Array<Record<string, unknown>>;

  /*
   * The earliest reading still inside the window, per machine. Hours run is the
   * current meter less that reading — and a meter replacement resets the count,
   * so those readings are excluded rather than producing a negative.
   */
  const readings = unwrap(await client
    .from('meter_readings')
    .select('asset_id, hours, reading_at')
    .gte('reading_at', since)
    .eq('is_meter_replacement', false)
    .not('hours', 'is', null)
    .order('reading_at', { ascending: true })) as Array<Record<string, unknown>>;
  const earliest = new Map<string, number>();
  for (const r of readings) {
    const id = String(r.asset_id);
    if (!earliest.has(id)) earliest.set(id, Number(r.hours));
  }

  return rows.map((a) => ({
    id: String(a.id),
    assetNumber: String(a.asset_number),
    name: String(a.name),
    assetClass: (a.asset_class as string | null) ?? null,
    make: (a.make as string | null) ?? null,
    model: (a.model as string | null) ?? null,
    modelYear: a.model_year == null ? null : Number(a.model_year),
    ownership: String(a.ownership),
    currentHours: Number(a.current_hours ?? 0),
    fuelType: (a.fuel_type as string | null) ?? null,
    assignedProject: one<{ number: string }>(a.projects)?.number ?? null,
    assignedOperator: one<{ full_name: string }>(a.employees)?.full_name ?? null,
    status: String(a.status),
    location: (a.home_location as string | null) ?? null,
    serialNumber: (a.serial_number as string | null) ?? null,
    lastTelemetryAt: (a.last_telemetry_at as string | null) ?? null,
    acquisitionCost: a.acquisition_cost == null ? null : Number(a.acquisition_cost),
    equipmentCode: one<{ code: string }>(a.equipment)?.code ?? null,
    hourlyRate: rateInForce(
      (one<{ equipment_rates?: Array<{ source: unknown; hourly_rate: unknown }> }>(a.equipment)
        ?.equipment_rates) ?? []),
    hoursLast30: (() => {
      const from = earliest.get(String(a.id));
      if (from == null) return null;      // nothing recorded in the window
      return Math.max(Number(a.current_hours ?? 0) - from, 0);
    })(),
  }));
};

/**
 * What is due, derived from where each meter actually is.
 *
 * A schedule with no hour interval is not hour-driven — it may run on miles or
 * on a calendar — so it reports no hours remaining rather than a misleading
 * zero, and the page shows it as not applicable rather than as due now.
 */
export const loadMaintenanceDue: Query<MaintenanceRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('maintenance_schedules')
    .select('id, name, interval_hours, last_performed_hours, assets(asset_number, name, current_hours)')
    .eq('is_active', true)) as Array<Record<string, unknown>>;
  return rows
    .map((s) => {
      const asset = one<{ asset_number: string; name: string; current_hours: number }>(s.assets);
      const current = Number(asset?.current_hours ?? 0);
      const interval = s.interval_hours == null ? null : Number(s.interval_hours);
      const last = s.last_performed_hours == null ? null : Number(s.last_performed_hours);
      return {
        id: String(s.id),
        assetNumber: asset?.asset_number ?? '—',
        assetName: asset?.name ?? '—',
        scheduleName: String(s.name),
        intervalHours: interval,
        lastPerformedHours: last,
        currentHours: current,
        hoursRemaining: interval == null ? null : (last ?? 0) + interval - current,
      };
    })
    .sort((a, b) => (a.hoursRemaining ?? Infinity) - (b.hoursRemaining ?? Infinity));
};

export const loadWorkOrders: Query<WorkOrderRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('work_orders')
    .select('id, number, title, work_order_type, priority, status, opened_at, completed_at, downtime_hours, labor_cost, parts_cost, outside_cost, resolution, assets(asset_number, name)')
    .order('opened_at', { ascending: false })
    .limit(100)) as Array<Record<string, unknown>>;
  return rows.map((w) => {
    const asset = one<{ asset_number: string; name: string }>(w.assets);
    return {
      id: String(w.id),
      number: String(w.number),
      assetNumber: asset?.asset_number ?? '—',
      assetName: asset?.name ?? '—',
      title: String(w.title),
      type: String(w.work_order_type),
      priority: String(w.priority),
      status: String(w.status),
      openedAt: String(w.opened_at),
      completedAt: (w.completed_at as string | null) ?? null,
      downtimeHours: Number(w.downtime_hours ?? 0),
      laborCost: Number(w.labor_cost ?? 0),
      partsCost: Number(w.parts_cost ?? 0),
      outsideCost: Number(w.outside_cost ?? 0),
      resolution: (w.resolution as string | null) ?? null,
    };
  });
};

/**
 * Fuel, with the job it was burned on.
 *
 * The project is shown because since migration 0038 it decides something: fuel
 * with a project posts to that job's cost, and fuel without one posts nothing,
 * because the platform does not guess which job to charge.
 */
export const loadFuel: Query<FuelRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('fuel_transactions')
    .select('id, transacted_at, gallons, price_per_gallon, total_cost, location, source, exception_flag, assets(asset_number, name), projects(number), employees(full_name)')
    .order('transacted_at', { ascending: false })
    .limit(100)) as Array<Record<string, unknown>>;
  return rows.map((f) => {
    const asset = one<{ asset_number: string; name: string }>(f.assets);
    return {
      id: String(f.id),
      transactedAt: String(f.transacted_at),
      assetNumber: asset?.asset_number ?? null,
      assetName: asset?.name ?? 'Unassigned',
      gallons: Number(f.gallons ?? 0),
      pricePerGallon: Number(f.price_per_gallon ?? 0),
      totalCost: Number(f.total_cost ?? 0),
      location: (f.location as string | null) ?? null,
      source: String(f.source),
      project: one<{ number: string }>(f.projects)?.number ?? null,
      exception: (f.exception_flag as string | null) ?? null,
      operator: one<{ full_name: string }>(f.employees)?.full_name ?? null,
    };
  });
};

/** The sample dataset in the same shapes. */
export const demonstrationAssets = (): AssetRow[] =>
  ASSETS.map((a) => ({
    id: a.id, assetNumber: a.assetNumber, name: a.name, assetClass: a.assetClass,
    make: a.make, model: a.model, modelYear: a.modelYear, ownership: a.ownership,
    currentHours: a.currentHours, fuelType: a.fuelType,
    assignedProject: a.assignedProject, assignedOperator: a.assignedOperator,
    status: a.status, location: a.location, lastTelemetryAt: a.lastTelemetryAt,
    acquisitionCost: a.acquisitionCost,
    serialNumber: null,
    equipmentCode: a.equipmentCode,
    /* The sample fleet carries no rates; the library is where they live. */
    hourlyRate: null,
    // The sample dataset carries a utilization ratio; hours run is what the
    // platform can measure, so the demonstration path reports the same shape.
    hoursLast30: Math.round(a.utilization30d * 30 * 10),
  }));

export const demonstrationMaintenance = (): MaintenanceRow[] =>
  MAINTENANCE_DUE.map((m) => ({
    id: m.id, assetNumber: m.assetNumber, assetName: m.assetName,
    scheduleName: m.scheduleName, intervalHours: m.intervalHours,
    lastPerformedHours: m.lastPerformedHours, currentHours: m.currentHours,
    hoursRemaining: m.hoursRemaining,
  }));

export const demonstrationWorkOrders = (): WorkOrderRow[] =>
  WORK_ORDERS.map((w) => ({
    id: w.id, number: w.number, assetNumber: w.assetNumber, assetName: w.assetName,
    title: w.title, type: w.type, priority: w.priority, status: w.status,
    openedAt: w.openedAt, completedAt: w.completedAt ?? null,
    downtimeHours: w.downtimeHours, laborCost: w.laborCost,
    partsCost: w.partsCost, outsideCost: w.outsideCost, resolution: w.resolution ?? null,
  }));

export const demonstrationFuel = (): FuelRow[] =>
  FUEL_TRANSACTIONS.map((f) => ({
    id: f.id, transactedAt: f.transactedAt, assetNumber: f.assetNumber,
    assetName: f.assetName, gallons: f.gallons, pricePerGallon: f.pricePerGallon,
    totalCost: f.gallons * f.pricePerGallon, location: f.location, source: f.source,
    project: null, exception: f.exception ?? null, operator: f.operator ?? null,
  }));

// ---------------------------------------------------------------------------
// Adding a machine, and raising a work order against one
//
// Both buttons shipped in the Fleet header with no handler at all, so a company
// could not record the first machine it owns — and with no assets, every figure
// on the screen was zero and every tab was empty. Migration 0161 added the
// writers; these are the calls.
// ---------------------------------------------------------------------------

export interface NewAsset {
  name: string;
  assetClass?: string | null;
  make?: string | null;
  model?: string | null;
  modelYear?: number | null;
  serialNumber?: string | null;
  ownership?: string;
  meterType?: string;
  fuelType?: string | null;
  acquisitionCost?: number | null;
  acquiredOn?: string | null;
  /** The catalog rate this machine is estimated at. Optional, and a later decision. */
  equipmentId?: string | null;
}

/** Record a machine the company owns. Returns its id. */
export async function createAsset(companyId: string, asset: NewAsset): Promise<string> {
  if (!supabase) throw new Error('Not connected.');
  const { data, error } = await supabase.rpc('create_asset', {
    p_company: companyId,
    p_name: asset.name,
    p_asset_class: asset.assetClass ?? null,
    p_make: asset.make ?? null,
    p_model: asset.model ?? null,
    p_model_year: asset.modelYear ?? null,
    p_serial_number: asset.serialNumber ?? null,
    p_ownership: asset.ownership ?? 'owned',
    p_meter_type: asset.meterType ?? 'hours',
    p_fuel_type: asset.fuelType ?? null,
    p_acquisition_cost: asset.acquisitionCost ?? null,
    p_acquired_on: asset.acquiredOn ?? null,
    p_equipment_id: asset.equipmentId ?? null,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export interface NewWorkOrder {
  assetId: string;
  title: string;
  workOrderType?: string;
  priority?: string;
  description?: string | null;
}

/**
 * Raise a work order against one machine.
 *
 * No company is passed: it is read off the asset in the database, because a
 * work order that is not about a specific machine is not a work order.
 */
export async function createWorkOrder(order: NewWorkOrder): Promise<string> {
  if (!supabase) throw new Error('Not connected.');
  const { data, error } = await supabase.rpc('create_work_order', {
    p_asset: order.assetId,
    p_title: order.title,
    p_work_order_type: order.workOrderType ?? 'corrective',
    p_priority: order.priority ?? 'normal',
    p_description: order.description ?? null,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

// -----------------------------------------------------------------------------
// The rest of the doors
//
// `create_asset` and `create_work_order` (0161) were the whole of Fleet's write
// side. A machine could be entered and never corrected; a work order could be
// opened and never closed; and nothing anywhere could record a meter reading,
// which is the number every maintenance interval, every utilization figure and
// `notify_maintenance_due` are all computed from.
// -----------------------------------------------------------------------------

type RpcCapable = {
  rpc: (fn: string, args: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

const rpc = async (fn: string, args: Record<string, unknown>) => {
  if (!supabase) throw new Error('Not connected.');
  const { data, error } = await (supabase as unknown as RpcCapable).rpc(fn, args);
  if (error) throw new Error(error.message);
  return data === null || data === undefined ? '' : String(data);
};

/**
 * Record what the meter says.
 *
 * `isReplacement` is the one way a reading may go down, and it is stated rather
 * than inferred: guessing which low readings are replacements would eventually
 * write off a machine's service history.
 */
export async function recordMeterReading(input: {
  assetId: string; hours?: number | null; miles?: number | null;
  readingAt?: string | null; source?: string; isReplacement?: boolean;
}): Promise<string> {
  return rpc('record_meter_reading', {
    p_asset: input.assetId,
    p_hours: input.hours ?? null,
    p_miles: input.miles ?? null,
    p_reading_at: input.readingAt || new Date().toISOString(),
    p_source: input.source ?? 'manual',
    p_is_replacement: input.isReplacement ?? false,
  });
}

/** Record a fuel purchase. Flagged where it looks wrong, never refused. */
export async function recordFuel(companyId: string, input: {
  gallons: number; pricePerGallon: number; transactedAt?: string | null;
  assetId?: string | null; employeeId?: string | null; projectId?: string | null;
  fuelType?: string; odometerHours?: number | null; odometerMiles?: number | null;
  cardLast4?: string | null; vendorName?: string | null; location?: string | null;
  source?: string;
}): Promise<string> {
  return rpc('record_fuel', {
    p_company: companyId,
    p_gallons: input.gallons,
    p_price: input.pricePerGallon,
    p_transacted_at: input.transactedAt || new Date().toISOString(),
    p_asset: input.assetId ?? null,
    p_employee: input.employeeId ?? null,
    p_project: input.projectId ?? null,
    p_fuel_type: input.fuelType ?? 'diesel',
    p_odometer_hours: input.odometerHours ?? null,
    p_odometer_miles: input.odometerMiles ?? null,
    p_card_last4: input.cardLast4 ?? null,
    p_vendor_name: input.vendorName ?? null,
    p_location: input.location ?? null,
    p_source: input.source ?? 'manual',
  });
}

/** Attribute an unmatched fuel ticket to a machine, or mark it looked at. */
export async function resolveFuelException(input: {
  transactionId: string; assetId?: string | null; clear?: boolean;
}): Promise<void> {
  await rpc('resolve_fuel_exception', {
    p_transaction: input.transactionId,
    p_asset: input.assetId ?? null,
    p_clear: input.clear ?? true,
  });
}

/** Create or edit a service interval. One of hours, miles or days is required. */
export async function setMaintenanceSchedule(input: {
  assetId: string; name: string; intervalHours?: number | null;
  intervalMiles?: number | null; intervalDays?: number | null;
  lastPerformedHours?: number | null; scheduleId?: string | null;
}): Promise<string> {
  return rpc('set_maintenance_schedule', {
    p_asset: input.assetId,
    p_name: input.name.trim(),
    p_hours: input.intervalHours ?? null,
    p_miles: input.intervalMiles ?? null,
    p_days: input.intervalDays ?? null,
    p_last_hours: input.lastPerformedHours ?? null,
    p_schedule: input.scheduleId ?? null,
  });
}

/** Stop watching a service, keeping the work orders that closed against it. */
export async function retireMaintenanceSchedule(scheduleId: string): Promise<void> {
  await rpc('retire_maintenance_schedule', { p_schedule: scheduleId });
}

/** Change an open work order. Completing and canceling have their own doors. */
export async function updateWorkOrder(input: {
  workOrderId: string; title?: string | null; status?: string | null;
  priority?: string | null; description?: string | null; failureCode?: string | null;
  scheduledFor?: string | null; assignedTo?: string | null; vendorId?: string | null;
  scheduleId?: string | null; laborHours?: number | null; laborCost?: number | null;
  partsCost?: number | null; outsideCost?: number | null; downtimeHours?: number | null;
}): Promise<void> {
  await rpc('update_work_order', {
    p_work_order: input.workOrderId,
    p_title: input.title?.trim() || null,
    p_status: input.status ?? null,
    p_priority: input.priority ?? null,
    p_description: input.description ?? null,
    p_failure_code: input.failureCode ?? null,
    p_scheduled_for: input.scheduledFor || null,
    p_assigned_to: input.assignedTo ?? null,
    p_vendor: input.vendorId ?? null,
    p_schedule: input.scheduleId ?? null,
    p_labor_hours: input.laborHours ?? null,
    p_labor_cost: input.laborCost ?? null,
    p_parts_cost: input.partsCost ?? null,
    p_outside_cost: input.outsideCost ?? null,
    p_downtime_hours: input.downtimeHours ?? null,
  });
}

/**
 * Close a work order with what was actually done.
 *
 * The resolution is required — the next person to open this machine reads it
 * and nothing else. A meter reading given here resets a preventive interval
 * from exactly that number rather than from whatever was last recorded.
 */
export async function completeWorkOrder(input: {
  workOrderId: string; resolution: string; downtimeHours?: number | null;
  laborHours?: number | null; laborCost?: number | null; partsCost?: number | null;
  outsideCost?: number | null; meterHours?: number | null; completedAt?: string | null;
}): Promise<void> {
  await rpc('complete_work_order', {
    p_work_order: input.workOrderId,
    p_resolution: input.resolution.trim(),
    p_downtime_hours: input.downtimeHours ?? null,
    p_labor_hours: input.laborHours ?? null,
    p_labor_cost: input.laborCost ?? null,
    p_parts_cost: input.partsCost ?? null,
    p_outside_cost: input.outsideCost ?? null,
    p_meter_hours: input.meterHours ?? null,
    p_completed_at: input.completedAt || new Date().toISOString(),
  });
}

/** Cancel a work order that should not have been raised, with the reason. */
export async function cancelWorkOrder(workOrderId: string, reason: string): Promise<void> {
  await rpc('cancel_work_order', { p_work_order: workOrderId, p_reason: reason.trim() });
}

/** Correct a machine's details, or say where it is and who is on it. */
export async function updateAsset(input: {
  assetId: string; name?: string | null; assetClass?: string | null;
  make?: string | null; model?: string | null; modelYear?: number | null;
  serialNumber?: string | null; vin?: string | null; licensePlate?: string | null;
  ownership?: string | null; meterType?: string | null; fuelType?: string | null;
  homeLocation?: string | null; equipmentId?: string | null; projectId?: string | null;
  operatorId?: string | null; notes?: string | null; acquisitionCost?: number | null;
  acquiredOn?: string | null;
}): Promise<void> {
  await rpc('update_asset', {
    p_asset: input.assetId,
    p_name: input.name?.trim() || null,
    p_asset_class: input.assetClass?.trim() || null,
    p_make: input.make?.trim() || null,
    p_model: input.model?.trim() || null,
    p_model_year: input.modelYear ?? null,
    p_serial_number: input.serialNumber?.trim() || null,
    p_vin: input.vin?.trim() || null,
    p_license_plate: input.licensePlate?.trim() || null,
    p_ownership: input.ownership ?? null,
    p_meter_type: input.meterType ?? null,
    p_fuel_type: input.fuelType ?? null,
    p_home_location: input.homeLocation?.trim() || null,
    p_equipment: input.equipmentId ?? null,
    p_project: input.projectId ?? null,
    p_operator: input.operatorId ?? null,
    p_notes: input.notes ?? null,
    p_acquisition_cost: input.acquisitionCost ?? null,
    p_acquired_on: input.acquiredOn || null,
  });
}

/** Put a machine down, or back in service. Disposal is its own door. */
export async function setAssetStatus(
  assetId: string, status: string, note?: string | null,
): Promise<void> {
  await rpc('set_asset_status', {
    p_asset: assetId, p_status: status, p_note: note?.trim() || null,
  });
}

/** Take a machine off the books. Refused while work orders are open. */
export async function disposeAsset(
  assetId: string, disposedOn: string, note?: string | null,
): Promise<void> {
  await rpc('dispose_asset', {
    p_asset: assetId, p_disposed_on: disposedOn, p_note: note?.trim() || null,
  });
}

export interface AssetServiceRow {
  scheduleId: string;
  name: string;
  intervalHours: number | null;
  intervalMiles: number | null;
  intervalDays: number | null;
  lastPerformedAt: string | null;
  lastPerformedHours: number | null;
  /** Negative when overdue, which is the number a shop actually looks for. */
  hoursRemaining: number | null;
  daysRemaining: number | null;
  openWorkOrders: number;
}

/** The service intervals on one machine. */
export const loadAssetServices = (assetId: string): Query<AssetServiceRow[]> =>
  async (client) => {
    if (!assetId) return [];
    const rows = unwrap(await client
      .from('my_maintenance_due')
      .select('schedule_id, name, interval_hours, interval_miles, interval_days, '
        + 'last_performed_at, last_performed_hours, hours_remaining, days_remaining, '
        + 'open_work_orders')
      .eq('asset_id', assetId)
      .order('name')) as unknown as Array<Record<string, unknown>>;
    return rows.map((s) => ({
      scheduleId: String(s.schedule_id),
      name: String(s.name),
      intervalHours: maybeNum(s.interval_hours),
      intervalMiles: maybeNum(s.interval_miles),
      intervalDays: maybeNum(s.interval_days),
      lastPerformedAt: (s.last_performed_at as string | null) ?? null,
      lastPerformedHours: maybeNum(s.last_performed_hours),
      hoursRemaining: maybeNum(s.hours_remaining),
      daysRemaining: maybeNum(s.days_remaining),
      openWorkOrders: num(s.open_work_orders),
    }));
  };

export interface AssetMeterRow {
  currentHours: number;
  currentMiles: number;
  /** The earliest reading still inside the window, so the difference is real work. */
  hours30DaysAgo: number | null;
  readingCount: number;
  lastReadingAt: string | null;
  openWorkOrders: number;
  downtime30Days: number;
}

/** What one machine's meter has actually done. */
export const loadAssetMeter = (assetId: string): Query<AssetMeterRow | null> =>
  async (client) => {
    if (!assetId) return null;
    const rows = unwrap(await client
      .from('my_asset_meters')
      .select('current_hours, current_miles, hours_30_days_ago, reading_count, '
        + 'last_reading_at, open_work_orders, downtime_30_days')
      .eq('asset_id', assetId)
      .limit(1)) as unknown as Array<Record<string, unknown>>;
    const m = rows[0];
    if (!m) return null;
    return {
      currentHours: num(m.current_hours),
      currentMiles: num(m.current_miles),
      hours30DaysAgo: maybeNum(m.hours_30_days_ago),
      readingCount: num(m.reading_count),
      lastReadingAt: (m.last_reading_at as string | null) ?? null,
      openWorkOrders: num(m.open_work_orders),
      downtime30Days: num(m.downtime_30_days),
    };
  };
