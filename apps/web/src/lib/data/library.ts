/**
 * The company's own library: reading it, and adding to it.
 *
 * Every library table is three-tier. A row with no company and no group is the
 * catalog GrounUp ships; a row with a group is a corporate standard; a row with
 * a company is that company's own. Row level security lets a member read all
 * three and write only the last, which is what keeps a shared catalog
 * trustworthy — no tenant can edit the seed everyone else prices from.
 *
 * So "edit a catalog service" is not a thing that happens. What happens is that
 * a company creates its own row, and this module says so plainly rather than
 * letting somebody discover it when their change silently does nothing.
 */
import { unwrap, type Query } from './query';

/** Matches the three tiers the rest of the application already names. */
export type Scope = 'global' | 'group' | 'company';

export interface ServiceRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  subcategory: string | null;
  industry: string | null;
  defaultUnit: string;
  supportedUnits: string[];
  pricingMethod: string;
  status: string;
  version: string;
  scope: Scope;
  /** Only a company's own rows may be changed. */
  editable: boolean;
  taskCount: number;
}

export interface TaskRow {
  id: string;
  code: string;
  name: string;
  defaultUnit: string;
  category: string | null;
  productionRequired: boolean;
  crewRequired: boolean;
  equipmentRequired: boolean;
  materialRequired: boolean;
  safetyReviewRequired: boolean;
  status: string;
  scope: Scope;
  editable: boolean;
}

/** Embedded rows arrive as an object or a single-element array by join shape. */
const one = <T,>(v: unknown): T | null =>
  (Array.isArray(v) ? (v as T[])[0] : (v as T | null)) ?? null;

const scopeOf = (companyId: unknown, groupId: unknown): Scope =>
  companyId ? 'company' : groupId ? 'group' : 'global';

export const loadServices: Query<ServiceRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('services')
    .select('id, code, name, description, category, subcategory, industry, default_unit, supported_units, pricing_method, status, version, company_id, enterprise_group_id, tasks(count)')
    .order('code')
    .limit(2000)) as Array<Record<string, unknown>>;
  return rows.map((s) => {
    const scope = scopeOf(s.company_id, s.enterprise_group_id);
    const counted = s.tasks as Array<{ count: number }> | null;
    return {
      id: String(s.id),
      code: String(s.code),
      name: String(s.name),
      description: (s.description as string | null) ?? null,
      category: (s.category as string | null) ?? null,
      subcategory: (s.subcategory as string | null) ?? null,
      industry: (s.industry as string | null) ?? null,
      defaultUnit: String(s.default_unit),
      supportedUnits: (s.supported_units as string[]) ?? [],
      pricingMethod: String(s.pricing_method),
      status: String(s.status),
      version: String(s.version),
      scope,
      editable: scope === 'company',
      taskCount: counted?.[0]?.count ?? 0,
    };
  });
};

export const loadTasks: Query<TaskRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('tasks')
    .select('id, code, name, default_unit, category, production_required, crew_required, equipment_required, material_required, safety_review_required, status, company_id, enterprise_group_id')
    .order('code')
    .limit(4000)) as Array<Record<string, unknown>>;
  return rows.map((t) => {
    const scope = scopeOf(t.company_id, t.enterprise_group_id);
    return {
      id: String(t.id),
      code: String(t.code),
      name: String(t.name),
      defaultUnit: String(t.default_unit),
      category: (t.category as string | null) ?? null,
      productionRequired: Boolean(t.production_required),
      crewRequired: Boolean(t.crew_required),
      equipmentRequired: Boolean(t.equipment_required),
      materialRequired: Boolean(t.material_required),
      safetyReviewRequired: Boolean(t.safety_review_required),
      status: String(t.status),
      scope,
      editable: scope === 'company',
    };
  });
};

type Writer = {
  from: (t: string) => {
    insert: (v: Record<string, unknown>) => {
      select: (c: string) => { single: () =>
        PromiseLike<{ data: unknown; error: { message: string } | null }> };
    };
    update: (v: Record<string, unknown>) => {
      eq: (c: string, v: string) =>
        PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
  };
};

export interface ServiceInput {
  companyId: string;
  code: string;
  name: string;
  description?: string | null;
  category?: string | null;
  subcategory?: string | null;
  industry?: string | null;
  defaultUnit: string;
  supportedUnits: string[];
}

/**
 * Add a service to the company's own library.
 *
 * `supported_units` must contain `default_unit` — the database refuses
 * otherwise, and a service whose default is not among the units it supports is
 * a service nothing can price. Included here so the caller does not have to
 * remember, and the constraint still holds if they get it wrong anyway.
 */
export async function createService(client: Writer, input: ServiceInput): Promise<string> {
  const units = Array.from(new Set([input.defaultUnit, ...input.supportedUnits]));
  const { data, error } = await client.from('services').insert({
    company_id: input.companyId,
    code: input.code.trim(),
    name: input.name.trim(),
    description: input.description?.trim() || null,
    category: input.category?.trim() || null,
    subcategory: input.subcategory?.trim() || null,
    industry: input.industry?.trim() || null,
    default_unit: input.defaultUnit,
    supported_units: units,
    // The company wrote it, so it says so. `catalog` is what GrounUp ships.
    origin: 'company',
    source: 'Added in the library screen',
  }).select('id').single();
  if (error) throw new Error(error.message);
  return String((data as { id: string }).id);
}

export interface TaskInput {
  companyId: string;
  code: string;
  name: string;
  defaultUnit: string;
  category?: string | null;
  productionRequired?: boolean;
  crewRequired?: boolean;
  equipmentRequired?: boolean;
  materialRequired?: boolean;
  safetyReviewRequired?: boolean;
}

export async function createTask(client: Writer, input: TaskInput): Promise<string> {
  const { data, error } = await client.from('tasks').insert({
    company_id: input.companyId,
    code: input.code.trim(),
    name: input.name.trim(),
    default_unit: input.defaultUnit,
    category: input.category?.trim() || null,
    production_required: input.productionRequired ?? true,
    crew_required: input.crewRequired ?? true,
    equipment_required: input.equipmentRequired ?? true,
    material_required: input.materialRequired ?? false,
    safety_review_required: input.safetyReviewRequired ?? false,
    origin: 'company',
    source: 'Added in the library screen',
  }).select('id').single();
  if (error) throw new Error(error.message);
  return String((data as { id: string }).id);
}

/**
 * Retire a row rather than deleting it.
 *
 * An estimate priced last March points at this row, and a library snapshot
 * records what it said. Deleting it would break the first and orphan the
 * second; retiring it stops it being chosen again and changes nothing that has
 * already happened.
 */
export async function retireRow(
  client: Writer, table: 'services' | 'tasks', id: string,
): Promise<void> {
  const { error } = await client.from(table).update({ status: 'retired' }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function updateService(
  client: Writer, id: string, patch: Partial<ServiceInput>,
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) body.name = patch.name.trim();
  if (patch.description !== undefined) body.description = patch.description?.trim() || null;
  if (patch.category !== undefined) body.category = patch.category?.trim() || null;
  if (patch.subcategory !== undefined) body.subcategory = patch.subcategory?.trim() || null;
  if (patch.defaultUnit !== undefined) body.default_unit = patch.defaultUnit;
  if (patch.supportedUnits !== undefined && patch.defaultUnit !== undefined) {
    body.supported_units = Array.from(new Set([patch.defaultUnit, ...patch.supportedUnits]));
  }
  const { error } = await client.from('services').update(body).eq('id', id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Hauling and disposal
//
// Company-scoped rather than three-tier: a haul rate is a negotiated position
// with a specific trucker, and there is no sensible catalog default for one.
// ---------------------------------------------------------------------------
export interface TruckingRateRow {
  id: string; code: string; name: string; truckType: string;
  capacity: number; capacityUnit: string;
  hourlyRate: number; preliminaryUnitRate: number | null;
  loadMinutes: number; dumpMinutes: number; delayMinutes: number;
  loadedSpeedMph: number; emptySpeedMph: number;
  vendorName: string | null; status: string;
}

export const loadTruckingRates: Query<TruckingRateRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('trucking_rates')
    .select('id, code, name, truck_type, capacity, capacity_unit, hourly_rate, preliminary_unit_rate, load_minutes, dump_minutes, delay_minutes, loaded_speed_mph, empty_speed_mph, status, vendors(name)')
    .order('code')) as Array<Record<string, unknown>>;
  return rows.map((t) => ({
    id: String(t.id), code: String(t.code), name: String(t.name),
    truckType: String(t.truck_type),
    capacity: Number(t.capacity ?? 0), capacityUnit: String(t.capacity_unit),
    hourlyRate: Number(t.hourly_rate ?? 0),
    preliminaryUnitRate: t.preliminary_unit_rate == null ? null : Number(t.preliminary_unit_rate),
    loadMinutes: Number(t.load_minutes ?? 0),
    dumpMinutes: Number(t.dump_minutes ?? 0),
    delayMinutes: Number(t.delay_minutes ?? 0),
    loadedSpeedMph: Number(t.loaded_speed_mph ?? 0),
    emptySpeedMph: Number(t.empty_speed_mph ?? 0),
    vendorName: one<{ name: string }>(t.vendors)?.name ?? null,
    status: String(t.status),
  }));
};

export interface DisposalSiteRow {
  id: string; code: string; name: string;
  materialTypes: string[]; tippingFee: number; feeUnit: string;
  city: string | null; stateProvince: string | null;
  acceptsContaminated: boolean; status: string;
}

export const loadDisposalSites: Query<DisposalSiteRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('disposal_sites')
    .select('id, code, name, material_types, tipping_fee, fee_unit, city, state_province, accepts_contaminated, status')
    .order('code')) as Array<Record<string, unknown>>;
  return rows.map((d) => ({
    id: String(d.id), code: String(d.code), name: String(d.name),
    materialTypes: (d.material_types as string[]) ?? [],
    tippingFee: Number(d.tipping_fee ?? 0), feeUnit: String(d.fee_unit),
    city: (d.city as string | null) ?? null,
    stateProvince: (d.state_province as string | null) ?? null,
    acceptsContaminated: Boolean(d.accepts_contaminated),
    status: String(d.status),
  }));
};

// ---------------------------------------------------------------------------
// Subcontractors and other vendors
// ---------------------------------------------------------------------------
export interface VendorRow {
  id: string; code: string; name: string; vendorType: string;
  contactName: string | null; email: string | null; phone: string | null;
  city: string | null; stateProvince: string | null;
  /**
   * Derived here rather than stored, so it cannot be stale: an expiry date is a
   * fact and "expired" is a fact about today.
   */
  insuranceExpiresOn: string | null;
  insuranceLapsed: boolean;
  isQualified: boolean;
  performanceScore: number | null;
  status: string;
}

export const loadVendors: Query<VendorRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('vendors')
    .select('id, code, name, vendor_type, contact_name, email, phone, city, state_province, insurance_expires_on, is_qualified, performance_score, status')
    .order('name')
    .limit(1000)) as Array<Record<string, unknown>>;
  const today = new Date().toISOString().slice(0, 10);
  return rows.map((v) => {
    const expires = (v.insurance_expires_on as string | null) ?? null;
    return {
      id: String(v.id), code: String(v.code), name: String(v.name),
      vendorType: String(v.vendor_type),
      contactName: (v.contact_name as string | null) ?? null,
      email: (v.email as string | null) ?? null,
      phone: (v.phone as string | null) ?? null,
      city: (v.city as string | null) ?? null,
      stateProvince: (v.state_province as string | null) ?? null,
      insuranceExpiresOn: expires,
      insuranceLapsed: expires !== null && expires < today,
      isQualified: Boolean(v.is_qualified),
      performanceScore: v.performance_score == null ? null : Number(v.performance_score),
      status: String(v.status),
    };
  });
};

export interface VendorInput {
  companyId: string; code: string; name: string; vendorType: string;
  contactName?: string | null; email?: string | null; phone?: string | null;
  city?: string | null; stateProvince?: string | null;
  insuranceExpiresOn?: string | null;
}

export async function createVendor(client: Writer, input: VendorInput): Promise<string> {
  const { data, error } = await client.from('vendors').insert({
    company_id: input.companyId,
    code: input.code.trim(),
    name: input.name.trim(),
    vendor_type: input.vendorType,
    contact_name: input.contactName?.trim() || null,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    city: input.city?.trim() || null,
    state_province: input.stateProvince?.trim() || null,
    insurance_expires_on: input.insuranceExpiresOn || null,
    // Qualification is a decision somebody makes after checking, not a default.
    is_qualified: false,
  }).select('id').single();
  if (error) throw new Error(error.message);
  return String((data as { id: string }).id);
}

export interface TruckingRateInput {
  companyId: string; code: string; name: string; truckType: string;
  capacity: number; capacityUnit: string; hourlyRate: number;
  loadMinutes: number; dumpMinutes: number; delayMinutes: number;
  loadedSpeedMph: number; emptySpeedMph: number;
}

export async function createTruckingRate(
  client: Writer, input: TruckingRateInput,
): Promise<string> {
  const { data, error } = await client.from('trucking_rates').insert({
    company_id: input.companyId,
    code: input.code.trim(), name: input.name.trim(),
    truck_type: input.truckType,
    capacity: input.capacity, capacity_unit: input.capacityUnit,
    hourly_rate: input.hourlyRate,
    load_minutes: input.loadMinutes, dump_minutes: input.dumpMinutes,
    delay_minutes: input.delayMinutes,
    loaded_speed_mph: input.loadedSpeedMph, empty_speed_mph: input.emptySpeedMph,
  }).select('id').single();
  if (error) throw new Error(error.message);
  return String((data as { id: string }).id);
}
