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

const one = <T,>(v: unknown): T | null =>
  (Array.isArray(v) ? (v as T[])[0] : (v as T | null)) ?? null;

export const loadAssets: Query<AssetRow[]> = async (client) => {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const rows = unwrap(await client
    .from('assets')
    .select('id, asset_number, name, asset_class, make, model, model_year, ownership, current_hours, fuel_type, home_location, last_telemetry_at, acquisition_cost, status, projects(number), employees(full_name), equipment(code, equipment_rates(source, hourly_rate))')
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
