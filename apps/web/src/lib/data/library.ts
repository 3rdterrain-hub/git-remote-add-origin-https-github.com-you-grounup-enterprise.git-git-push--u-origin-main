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
    .select('id, code, name, description, category, subcategory, industry, default_unit, supported_units, pricing_method, status, version, company_id, enterprise_group_id')
    .order('code')
    .limit(2000)) as Array<Record<string, unknown>>;
  /*
   * `tasks(count)` used to be asked for here and there is no relationship to
   * count over: a service points at an assembly, the assembly lists the tasks.
   * PostgREST rejected the whole request, so the services list on the Master
   * Libraries screen returned an error rather than a library — and the count it
   * was for was never rendered by anything.
   */
  return rows.map((s) => {
    const scope = scopeOf(s.company_id, s.enterprise_group_id);
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
  rpc: (fn: string, args: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: { message: string } | null }>;
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
  /** Which of the three ways this haul is bought. */
  pricingBasis: 'cycle' | 'per_trip' | 'per_unit';
  ratePerTrip: number | null;
  minimumBillableQuantity: number | null;
  chargesWholeTrips: boolean;
  loadMinutes: number; dumpMinutes: number; delayMinutes: number;
  loadedSpeedMph: number; emptySpeedMph: number;
  vendorName: string | null; status: string;
}

export const loadTruckingRates: Query<TruckingRateRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('trucking_rates')
    .select('id, code, name, truck_type, capacity, capacity_unit, hourly_rate, preliminary_unit_rate, pricing_basis, rate_per_trip, minimum_billable_quantity, charges_whole_trips, load_minutes, dump_minutes, delay_minutes, loaded_speed_mph, empty_speed_mph, status, vendors(name)')
    .order('code')) as Array<Record<string, unknown>>;
  return rows.map((t) => ({
    id: String(t.id), code: String(t.code), name: String(t.name),
    truckType: String(t.truck_type),
    capacity: Number(t.capacity ?? 0), capacityUnit: String(t.capacity_unit),
    hourlyRate: Number(t.hourly_rate ?? 0),
    preliminaryUnitRate: t.preliminary_unit_rate == null ? null : Number(t.preliminary_unit_rate),
    pricingBasis: (t.pricing_basis as TruckingRateRow['pricingBasis']) ?? 'cycle',
    ratePerTrip: t.rate_per_trip == null ? null : Number(t.rate_per_trip),
    minimumBillableQuantity: t.minimum_billable_quantity == null
      ? null : Number(t.minimum_billable_quantity),
    chargesWholeTrips: t.charges_whole_trips !== false,
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

/**
 * A haul rate, in whichever of the three shapes it was bought in.
 *
 * Migration 0067 gave the table three pricing bases and a constraint that each
 * one carries its own figure — a trip-priced rate with no trip price is not a
 * rate. This interface predated that and named only the cycle figures, which is
 * half the reason nothing could create a usable row.
 */
export interface TruckingRateInput {
  companyId: string; code: string; name: string; truckType: string;
  capacity: number; capacityUnit: string;
  /** cycle: hourly, with a real cycle. per_trip: a price a load. per_unit: preliminary. */
  pricingBasis: 'cycle' | 'per_trip' | 'per_unit';
  hourlyRate: number;
  ratePerTrip?: number | null;
  preliminaryUnitRate?: number | null;
  /** Billed per trip whether or not the truck is filled. Defaults to capacity. */
  minimumBillableQuantity?: number | null;
  /** True is what "per trip" means; a quote that prorates is worth stating. */
  chargesWholeTrips?: boolean;
  loadMinutes: number; dumpMinutes: number; delayMinutes: number;
  loadedSpeedMph: number; emptySpeedMph: number;
  vendorId?: string | null;
}

/** The columns a haul rate writes, shared by create and update. */
function haulBody(input: Partial<TruckingRateInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.code !== undefined) body.code = input.code.trim();
  if (input.name !== undefined) body.name = input.name.trim();
  if (input.truckType !== undefined) body.truck_type = input.truckType.trim();
  if (input.capacity !== undefined) body.capacity = input.capacity;
  if (input.capacityUnit !== undefined) body.capacity_unit = input.capacityUnit;
  if (input.pricingBasis !== undefined) body.pricing_basis = input.pricingBasis;
  if (input.hourlyRate !== undefined) body.hourly_rate = input.hourlyRate;
  if (input.ratePerTrip !== undefined) body.rate_per_trip = input.ratePerTrip;
  if (input.preliminaryUnitRate !== undefined) {
    body.preliminary_unit_rate = input.preliminaryUnitRate;
  }
  if (input.minimumBillableQuantity !== undefined) {
    body.minimum_billable_quantity = input.minimumBillableQuantity;
  }
  if (input.chargesWholeTrips !== undefined) body.charges_whole_trips = input.chargesWholeTrips;
  if (input.loadMinutes !== undefined) body.load_minutes = input.loadMinutes;
  if (input.dumpMinutes !== undefined) body.dump_minutes = input.dumpMinutes;
  if (input.delayMinutes !== undefined) body.delay_minutes = input.delayMinutes;
  if (input.loadedSpeedMph !== undefined) body.loaded_speed_mph = input.loadedSpeedMph;
  if (input.emptySpeedMph !== undefined) body.empty_speed_mph = input.emptySpeedMph;
  if (input.vendorId !== undefined) body.vendor_id = input.vendorId || null;
  return body;
}

export async function createTruckingRate(
  client: Writer, input: TruckingRateInput,
): Promise<string> {
  const { data, error } = await client.from('trucking_rates').insert({
    company_id: input.companyId,
    ...haulBody(input),
    /*
     * `hourly_rate` is not null on the table, and a trip- or unit-priced haul
     * has no hourly figure. Zero is the honest value there: the basis says
     * which number prices it, and 0067's constraint refuses a basis whose own
     * figure is missing.
     */
    hourly_rate: input.hourlyRate ?? 0,
  }).select('id').single();
  if (error) throw new Error(error.message);
  return String((data as { id: string }).id);
}

/** Change one. Sends only what was given, so nothing unmentioned is blanked. */
export async function updateTruckingRate(
  client: Writer, id: string, patch: Partial<TruckingRateInput>,
): Promise<void> {
  const { error } = await client.from('trucking_rates').update(haulBody(patch)).eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Stop offering one.
 *
 * Archived rather than deleted: an estimate priced from this rate keeps its
 * library snapshot, and a haul profile that vanished would leave the rows that
 * referenced it pointing at nothing anybody could look up.
 */
export async function retireTruckingRate(client: Writer, id: string): Promise<void> {
  const { error } = await client.from('trucking_rates').update({ status: 'archived' }).eq('id', id);
  if (error) throw new Error(error.message);
}

/** The next HAUL-0000 for this company, from the database so two people cannot collide. */
export async function nextHaulCode(
  client: { rpc: (fn: string, args: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: { message: string } | null }> },
  companyId: string,
): Promise<string> {
  const { data, error } = await client.rpc('next_company_haul_code', { p_company: companyId });
  if (error) throw new Error(error.message);
  return String(data);
}

// ---------------------------------------------------------------------------
// Resource costs: set once, priced everywhere
//
// These are the numbers an estimate is built from. Changing one changes what
// every *future* estimate prices at, and changes nothing that has already been
// issued — a library snapshot copies the rows that priced an estimate at the
// moment it was issued, so a bid sent last March still reproduces at the rates
// that were in force then. That is what makes editing a rate safe rather than
// retroactive.
// ---------------------------------------------------------------------------
export type MaterialCostState = 'not_costed' | 'estimated' | 'quoted' | 'free';

export interface MaterialRow {
  id: string; code: string; name: string; category: string | null;
  unit: string; unitCost: number;
  /**
   * Whether a zero means nobody has priced this or that it genuinely costs
   * nothing. Both are `0`, so the screen cannot tell them apart without this
   * and would show `$0.00` for a material nobody has ever costed.
   */
  costState: MaterialCostState;
  freeReason: string | null;
  defaultWastePercent: number; wasteBasis: string | null;
  specification: string | null; quoteReference: string | null;
  quoteDate: string | null;
  status: string; scope: Scope;
  /** True when this row is the company's own, so a write lands on it directly. */
  editable: boolean;
}

export const loadMaterials: Query<MaterialRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('materials')
    .select('id, code, name, category, unit, unit_cost, cost_state, free_reason, default_waste_percent, waste_basis, specification, quote_reference, quote_date, status, company_id, enterprise_group_id')
    .order('code')
    .limit(2000)) as Array<Record<string, unknown>>;
  return rows.map((m) => {
    const scope = scopeOf(m.company_id, m.enterprise_group_id);
    return {
      id: String(m.id), code: String(m.code), name: String(m.name),
      category: (m.category as string | null) ?? null,
      unit: String(m.unit), unitCost: Number(m.unit_cost ?? 0),
      costState: String(m.cost_state ?? 'not_costed') as MaterialRow['costState'],
      freeReason: (m.free_reason as string | null) ?? null,
      defaultWastePercent: Number(m.default_waste_percent ?? 0),
      wasteBasis: (m.waste_basis as string | null) ?? null,
      specification: (m.specification as string | null) ?? null,
      quoteReference: (m.quote_reference as string | null) ?? null,
      quoteDate: (m.quote_date as string | null) ?? null,
      status: String(m.status), scope, editable: scope === 'company',
    };
  });
};

export interface LaborRateRow {
  id: string; code: string; classification: string; laborGroup: string | null;
  baseWagePerHour: number; burdenPercent: number;
  /** Generated by the database from the two above, so it cannot drift. */
  burdenedCostPerHour: number;
  overtimeMultiplier: number; doubletimeMultiplier: number;
  region: string | null; isUnion: boolean;
  effectiveDate: string; status: string; scope: Scope; editable: boolean;
}

export const loadLaborRates: Query<LaborRateRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('labor_rates')
    .select('id, code, classification, labor_group, base_wage_per_hour, burden_percent, burdened_cost_per_hour, overtime_multiplier, doubletime_multiplier, region, is_union, effective_date, status, company_id, enterprise_group_id')
    .order('classification')
    .limit(1000)) as Array<Record<string, unknown>>;
  return rows.map((l) => {
    const scope = scopeOf(l.company_id, l.enterprise_group_id);
    return {
      id: String(l.id), code: String(l.code),
      classification: String(l.classification),
      laborGroup: (l.labor_group as string | null) ?? null,
      baseWagePerHour: Number(l.base_wage_per_hour ?? 0),
      burdenPercent: Number(l.burden_percent ?? 0),
      burdenedCostPerHour: Number(l.burdened_cost_per_hour ?? 0),
      overtimeMultiplier: Number(l.overtime_multiplier ?? 1.5),
      doubletimeMultiplier: Number(l.doubletime_multiplier ?? 2),
      region: (l.region as string | null) ?? null,
      isUnion: Boolean(l.is_union),
      effectiveDate: String(l.effective_date),
      status: String(l.status), scope, editable: scope === 'company',
    };
  });
};

export interface EquipmentRateRow {
  id: string; equipmentId: string; equipmentName: string; equipmentClass: string;
  source: string; hourlyRate: number;
  dailyRate: number | null; weeklyRate: number | null; monthlyRate: number | null;
  effectiveDate: string | null; reference: string | null;
  /** Every rate on an equipment row is company-scoped; the catalog has none. */
  editable: boolean;
}

export const loadEquipmentRates: Query<EquipmentRateRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('equipment_rates')
    .select('id, equipment_id, source, hourly_rate, daily_rate, weekly_rate, monthly_rate, effective_date, reference, company_id, equipment(name, equipment_class)')
    .order('source')
    .limit(2000)) as Array<Record<string, unknown>>;
  return rows.map((e) => {
    const eq = one<{ name: string; equipment_class: string }>(e.equipment);
    return {
      id: String(e.id), equipmentId: String(e.equipment_id),
      equipmentName: eq?.name ?? 'Unknown machine',
      equipmentClass: eq?.equipment_class ?? '',
      source: String(e.source), hourlyRate: Number(e.hourly_rate ?? 0),
      dailyRate: e.daily_rate == null ? null : Number(e.daily_rate),
      weeklyRate: e.weekly_rate == null ? null : Number(e.weekly_rate),
      monthlyRate: e.monthly_rate == null ? null : Number(e.monthly_rate),
      effectiveDate: (e.effective_date as string | null) ?? null,
      reference: (e.reference as string | null) ?? null,
      editable: Boolean(e.company_id),
    };
  });
};

/**
 * Change a cost.
 *
 * Deliberately one function over four tables rather than four near-identical
 * ones: the tables differ in which column holds the money and in nothing else
 * that matters here, and four copies of the same three lines is four places for
 * them to drift.
 *
 * Row level security decides whether the write lands. A catalog row belongs to
 * no company and no policy permits writing one, so an attempt on the shipped
 * catalog is refused by the database rather than by this function remembering.
 */
export type CostTable = 'materials' | 'labor_rates' | 'equipment_rates' | 'trucking_rates';

export async function updateCost(
  client: Writer, table: CostTable, id: string, patch: Record<string, number | string | null>,
): Promise<void> {
  const { error } = await client.from(table).update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Put a price on a material, whoever owns it.
 *
 * A catalog material belongs to no company and every company reads it, so
 * nobody may edit one — which would leave 328 uncosted catalog materials with
 * a padlock on each and no way through. `set_material_cost` copies the catalog
 * row into the company's library and prices the copy, which is the same
 * copy-on-write the templates use.
 *
 * Returns the id that ended up holding the price. On a catalog material that is
 * **not** the id passed in, so a caller that keeps showing the old one is
 * showing the catalog row it did not change.
 */
export interface MaterialCostInput {
  materialId: string;
  companyId: string;
  cost: number;
  state?: MaterialCostState;
  /**
   * Where the price came from, and the database insists on it: a price called
   * estimated or quoted has to name a supplier, a quote or how it was worked
   * out, and a material called free has to say why. A number with no
   * provenance is the thing migration 0121 was written to stop.
   */
  source: string;
  quotedOn?: string | null;
}

export async function setMaterialCost(
  client: Writer, input: MaterialCostInput,
): Promise<string> {
  const { data, error } = await client.rpc('set_material_cost', {
    p_material: input.materialId,
    p_unit_cost: input.cost,
    p_state: input.state ?? 'estimated',
    p_source: input.source,
    p_quoted_on: input.quotedOn ?? null,
    p_company: input.companyId,
  });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as { id?: unknown } | null;
  if (!row?.id) throw new Error('That cost was not saved.');
  return String(row.id);
}

/**
 * What `import_materials` hands back.
 *
 * A count of what went in would hide the two things worth knowing, so the
 * function returns them: what it refused and why, and what it took but somebody
 * should look at. A hundred materials imported with sixty of them filed as
 * "each" is not a successful import.
 */
export interface MaterialImportReport {
  imported: number;
  alreadyThere: number;
  categoriesAdded: number;
  /** Not imported, with the reason — an unconvertible unit, a missing name. */
  rejected: { name: string; reason: string }[];
  /** Imported, and wrong in a way only a person can settle. */
  needsReview: { name: string; unit: string; why: string }[];
  /** False when the caller cannot approve, so the rows landed as drafts. */
  approved: boolean;
}

/**
 * Import a price list into a company's own library.
 *
 * Every decision lives in the database function, in one transaction: the
 * categories are created first because `materials.category` is governed, unit
 * synonyms are mapped but a unit that would need arithmetic is refused by name,
 * and an uncosted row is filed as `not_costed` rather than as free.
 *
 * The rows are the CSV as it arrived — lowercased headers, values as text. The
 * function reads `name`, `category`, `unit`, `unit_cost`, `density` and
 * `waste_pct` and ignores the rest, so an export with extra columns imports
 * without anybody editing it first.
 */
export async function importMaterials(
  client: Writer, companyId: string, rows: Record<string, string>[],
): Promise<MaterialImportReport> {
  const { data, error } = await client.rpc('import_materials', {
    p_company: companyId, p_rows: rows,
  });
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    imported: Number(r.imported ?? 0),
    alreadyThere: Number(r.already_there ?? 0),
    categoriesAdded: Number(r.categories_added ?? 0),
    rejected: (r.rejected as MaterialImportReport['rejected']) ?? [],
    needsReview: (r.needs_review as MaterialImportReport['needsReview']) ?? [],
    approved: Boolean(r.approved),
  };
}

/**
 * What `import_equipment_rates` hands back.
 *
 * `machinesCreated` is the count worth reading twice: a dealer's sheet lists
 * machines you may not have in the catalog, so the function makes them — and a
 * rate sheet never says how much fuel a machine burns or whether it carries an
 * operator. Both change what a line costs, so every machine it created is named
 * on the review list rather than shipped with a guess in it.
 */
export interface EquipmentRateImportReport {
  priced: number;
  machinesCreated: number;
  rejected: { name: string; reason: string }[];
  needsReview: { name: string; why: string }[];
  /** False when the caller cannot approve, so the rates landed pending. */
  approved: boolean;
}

/**
 * Import a dealer rate sheet into a company's equipment library.
 *
 * The rate lands as `tenant_approved`, which under RULE-003 outranks both the
 * regional figure and the published schedule the platform ships — and does not
 * outrank a quote on a specific project, which is correct: a number somebody got
 * for this job beats a number the company uses generally.
 *
 * The function reads `equipment` (or `code`), `hourly_rate`, `daily_rate`,
 * `weekly_rate`, `monthly_rate`, `equipment_class`, `region`, `reference` and
 * `effective_date`, and ignores the rest, so a dealer's export imports without
 * anybody editing it first.
 */
export async function importEquipmentRates(
  client: Writer, companyId: string, rows: Record<string, string>[],
): Promise<EquipmentRateImportReport> {
  const { data, error } = await client.rpc('import_equipment_rates', {
    p_company: companyId, p_rows: rows,
  });
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    priced: Number(r.priced ?? 0),
    machinesCreated: Number(r.machines_created ?? 0),
    rejected: (r.rejected as EquipmentRateImportReport['rejected']) ?? [],
    needsReview: (r.needs_review as EquipmentRateImportReport['needsReview']) ?? [],
    approved: Boolean(r.approved),
  };
}

export interface MaterialInput {
  companyId: string; code: string; name: string; category?: string | null;
  unit: string; unitCost: number;
  defaultWastePercent?: number; wasteBasis?: string | null;
  specification?: string | null; quoteReference?: string | null;
}

export async function createMaterial(client: Writer, input: MaterialInput): Promise<string> {
  const waste = input.defaultWastePercent ?? 0;
  const { data, error } = await client.from('materials').insert({
    company_id: input.companyId,
    code: input.code.trim(), name: input.name.trim(),
    category: input.category?.trim() || null,
    unit: input.unit, unit_cost: input.unitCost,
    default_waste_percent: waste,
    // A waste factor must state its basis — the database says so, and stating
    // it here means the message is about the material rather than a constraint.
    waste_basis: waste > 0 ? (input.wasteBasis?.trim() || 'Company standard allowance') : null,
    specification: input.specification?.trim() || null,
    quote_reference: input.quoteReference?.trim() || null,
    origin: 'company',
    source: 'Added in the library screen',
  }).select('id').single();
  if (error) throw new Error(error.message);
  return String((data as { id: string }).id);
}

/**
 * A crew somebody put together and kept.
 *
 * `crews` and `crew_members` have been in the schema since migration 0004 and
 * no screen has ever read one, so a company that set up its standard three-man
 * pipe crew had nowhere to use it. This is the read the estimator needs: the
 * composition, with each member's classification and what it costs loaded.
 */
export interface CrewPresetMember {
  laborRateId: string;
  classification: string;
  headcount: number;
  baseWagePerHour: number;
  burdenPercent: number;
  /** Wage plus burden, as it reads on a rate sheet. */
  burdenedCostPerHour: number;
}

export interface CrewPreset {
  id: string;
  code: string;
  name: string;
  description: string | null;
  shiftHours: number;
  members: CrewPresetMember[];
  scope: Scope;
}

export const loadCrews: Query<CrewPreset[]> = async (client) => {
  const rows = unwrap(await client
    .from('crews')
    .select('id, code, name, description, shift_hours, company_id, enterprise_group_id, crew_members(labor_rate_id, headcount, labor_rates(classification, base_wage_per_hour, burden_percent, burdened_cost_per_hour))')
    .eq('status', 'active')
    .order('name')
    .limit(300)) as Array<Record<string, unknown>>;

  return rows.map((c) => ({
    id: String(c.id),
    code: String(c.code),
    name: String(c.name),
    description: (c.description as string | null) ?? null,
    shiftHours: Number(c.shift_hours ?? 8),
    scope: scopeOf(c.company_id, c.enterprise_group_id),
    members: ((c.crew_members ?? []) as Array<Record<string, unknown>>).map((m) => {
      const rate = (Array.isArray(m.labor_rates) ? m.labor_rates[0] : m.labor_rates) as
        Record<string, unknown> | null;
      return {
        laborRateId: String(m.labor_rate_id),
        classification: String(rate?.classification ?? 'Labor'),
        headcount: Number(m.headcount ?? 1),
        baseWagePerHour: Number(rate?.base_wage_per_hour ?? 0),
        burdenPercent: Number(rate?.burden_percent ?? 0),
        burdenedCostPerHour: Number(rate?.burdened_cost_per_hour ?? 0),
      };
    }),
  }));
};

/**
 * RULE-003, in the order the rule states it.
 *
 * A quote for this project beats the company's approved rate, which beats a
 * regional figure, which beats what the platform ships. The same array the
 * database uses in `array_position` when it resolves a rate, kept here so the
 * screen and the engine cannot disagree about which one won.
 */
export const RATE_PRECEDENCE =
  ['project_quote', 'tenant_approved', 'regional', 'global_seed'] as const;

/**
 * The rate in force on a machine, by RULE-003, out of whatever rows it carries.
 *
 * Exported because the fleet screen needs the same answer the library gives. It
 * was reading an hourly rate out of `EQUIPMENT_SPECS` — eight demo machines
 * with invented rates — and comparing it against a real asset's ownership cost.
 */
export function rateInForce(
  rates: ReadonlyArray<{ source?: unknown; hourly_rate?: unknown }>,
): number | null {
  const best = RATE_PRECEDENCE
    .map((source) => rates.find((r) => r.source === source))
    .find(Boolean);
  return best?.hourly_rate == null ? null : Number(best.hourly_rate);
}

/**
 * The machines themselves, with whichever rate is in force.
 *
 * `loadEquipmentRates` returns rates; this returns the machine an estimator
 * actually picks, carrying the best rate on it so the row can be filled in
 * without a second read.
 */
export interface EquipmentOption {
  id: string;
  name: string;
  equipmentClass: string;
  hourlyRate: number;
  dailyRate: number | null;
  weeklyRate: number | null;
  monthlyRate: number | null;
  fuelGallonsPerHour: number;
  mobilizationCost: number;
  scope: Scope;
}

export const loadEquipmentOptions: Query<EquipmentOption[]> = async (client) => {
  const rows = unwrap(await client
    .from('equipment')
    .select('id, name, equipment_class, fuel_gallons_per_hour, mobilization_cost, company_id, enterprise_group_id, equipment_rates(source, hourly_rate, daily_rate, weekly_rate, monthly_rate, effective_date)')
    .eq('status', 'active')
    .order('name')
    .limit(500)) as Array<Record<string, unknown>>;

  return rows.map((e) => {
    /*
     * The rate that will actually price the line, chosen by RULE-003.
     *
     * This used to look for `company_owned` first — which is not a value of
     * `app.rate_source` and so never matched — then `tenant_approved`, then
     * whichever row the database happened to return first. Two things followed.
     * `project_quote`, the highest precedence there is, was never preferred at
     * all. And a machine carrying both a regional and a seeded rate showed
     * whichever came back first, so the number on this screen could differ from
     * the number the engine used, with nothing to say which was which.
     *
     * A displayed rate that is not the rate that prices is the same defect as a
     * labor cost that cannot be reproduced by hand: plausible, silent, and
     * wrong exactly when somebody checks.
     */
    const rates = (e.equipment_rates ?? []) as Array<Record<string, unknown>>;
    const best = RATE_PRECEDENCE
      .map((source) => rates.find((r) => r.source === source))
      .find(Boolean) ?? rates[0];
    return {
      id: String(e.id),
      name: String(e.name),
      equipmentClass: String(e.equipment_class ?? 'General'),
      hourlyRate: Number(best?.hourly_rate ?? 0),
      dailyRate: best?.daily_rate == null ? null : Number(best.daily_rate),
      weeklyRate: best?.weekly_rate == null ? null : Number(best.weekly_rate),
      monthlyRate: best?.monthly_rate == null ? null : Number(best.monthly_rate),
      fuelGallonsPerHour: Number(e.fuel_gallons_per_hour ?? 0),
      mobilizationCost: Number(e.mobilization_cost ?? 0),
      scope: scopeOf(e.company_id, e.enterprise_group_id),
    };
  });
};

/**
 * The conditions that change what work takes, and by how much.
 *
 * Rock in the cut, a live lane, night work, frost. Each names a factor per
 * target — production, labor cost, equipment cost — and migration 0004 refuses
 * a factor that names a target the engine does not have, so what is here is
 * what the engine will actually apply.
 */
/**
 * How much is in the library, counted rather than remembered.
 *
 * The four figures across the top of the Master Libraries screen were constants
 * copied out of the generated seed — 188 services, 2,783 tasks — and they stayed
 * at those numbers whatever a company added, copied or retired. The tabs
 * underneath list the real rows, so the page disagreed with itself for anybody
 * who had used it.
 *
 * `head: true` asks PostgREST for the count and none of the rows, and row level
 * security decides what is counted: the caller's own library plus the catalog
 * they are entitled to read, which is exactly what the tabs below list.
 */
export interface LibraryCounts {
  services: number;
  tasks: number;
  assemblies: number;
  productionRates: number;
  labor: number;
  equipment: number;
  crews: number;
}

const countRows = async (
  client: Parameters<Query<unknown>>[0], table: string,
): Promise<number> => {
  const { count, error } = await client.from(table).select('id', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
};

export const loadLibraryCounts: Query<LibraryCounts> = async (client) => {
  const [services, tasks, assemblies, productionRates, labor, equipment, crews] =
    await Promise.all([
      countRows(client, 'services'),
      countRows(client, 'tasks'),
      countRows(client, 'assemblies'),
      countRows(client, 'my_production_rates'),
      countRows(client, 'labor_rates'),
      countRows(client, 'equipment'),
      countRows(client, 'crews'),
    ]);
  return { services, tasks, assemblies, productionRates, labor, equipment, crews };
};

export interface ConditionModifierRow {
  id: string;
  code: string;
  name: string;
  category: string | null;
  /** Target to factor: `{ production: 0.75, labor_cost: 1.15 }`. */
  factors: Record<string, number>;
  applicationRule: string;
  scope: Scope;
  editable: boolean;
}

export const loadConditionModifiers: Query<ConditionModifierRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('condition_modifiers')
    .select('id, code, name, category, factors, application_rule, company_id, enterprise_group_id')
    .eq('status', 'active')
    .order('code')
    .limit(500)) as Array<Record<string, unknown>>;
  return rows.map((m) => {
    const scope = scopeOf(m.company_id, m.enterprise_group_id);
    return {
      id: String(m.id),
      code: String(m.code),
      name: String(m.name),
      category: (m.category as string | null) ?? null,
      factors: (m.factors ?? {}) as Record<string, number>,
      applicationRule: String(m.application_rule ?? ''),
      scope,
      editable: scope === 'company',
    };
  });
};

/**
 * How a company turns cost into price, and the adjustments it stacks to do it.
 *
 * The components come with the profile because a profile without them says
 * nothing: "Standard" is a name, and 10% overhead then 8% profit on the running
 * total is the thing that decides a bid. The method matters for exactly that
 * reason — parallel takes each percentage off the same base, stacked takes the
 * next off the last result, and on ten thousand dollars that is a hundred
 * dollars of difference.
 */
export interface MarkupComponentRow {
  code: string;
  label: string;
  /** A fraction, as every other rate in the schema is. */
  percent: number;
  /**
   * Which base the percentage is taken off. The same closed set the engine and
   * `markup_components` both use — typed here rather than as `string`, so a
   * profile can be handed to `calculatePrice` without a cast that would hide a
   * value the engine cannot read.
   */
  basis: 'profile_default' | 'direct_cost' | 'direct_plus_indirect'
       | 'running_total' | 'marked_up_total';
  sequence: number;
  disclosed: boolean;
}

/** The five bases `markup_components` allows, for narrowing what the row says. */
const MARKUP_BASES = ['profile_default', 'direct_cost', 'direct_plus_indirect',
  'running_total', 'marked_up_total'] as const;

export interface PricingProfileRow {
  id: string;
  code: string;
  name: string;
  method: 'parallel' | 'stacked';
  region: string | null;
  regionalFactor: number;
  escalationPercent: number;
  escalationYears: number;
  isDefault: boolean;
  components: MarkupComponentRow[];
  scope: Scope;
  editable: boolean;
}

export const loadPricingProfiles: Query<PricingProfileRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('pricing_profiles')
    .select('id, code, name, method, region, regional_factor, escalation_percent, escalation_years, is_default, company_id, enterprise_group_id, markup_components(code, label, percent, basis, sequence, disclosed)')
    .eq('status', 'active')
    .order('name')
    .limit(200)) as Array<Record<string, unknown>>;
  return rows.map((p) => {
    const scope = scopeOf(p.company_id, p.enterprise_group_id);
    const components = ((p.markup_components ?? []) as Array<Record<string, unknown>>)
      .map((c) => ({
        code: String(c.code),
        label: String(c.label),
        percent: Number(c.percent ?? 0),
        /* Anything else is a value the engine has no rule for; the profile
           default is what the column itself defaults to. */
        basis: (MARKUP_BASES as readonly string[]).includes(String(c.basis))
          ? (String(c.basis) as MarkupComponentRow['basis'])
          : 'profile_default',
        sequence: Number(c.sequence ?? 10),
        disclosed: Boolean(c.disclosed),
      }))
      .sort((a, b) => a.sequence - b.sequence);
    return {
      id: String(p.id),
      code: String(p.code),
      name: String(p.name),
      method: (p.method === 'stacked' ? 'stacked' : 'parallel') as 'parallel' | 'stacked',
      region: (p.region as string | null) ?? null,
      regionalFactor: Number(p.regional_factor ?? 1),
      escalationPercent: Number(p.escalation_percent ?? 0),
      escalationYears: Number(p.escalation_years ?? 0),
      isDefault: Boolean(p.is_default),
      components,
      scope,
      editable: scope === 'company',
    };
  });
};

export interface UncostedMaterial {
  id: string;
  code: string;
  name: string;
  category: string | null;
  unit: string;
  /** False for a catalog row: pricing it copies it into the company first. */
  isOwn: boolean;
  usedOnLines: number;
  usedOnEstimates: number;
}

/**
 * Materials holding no price, worst first.
 *
 * `my_uncosted_materials` (migration 0133) is narrower than "every row with a
 * null cost", and deliberately: a catalog material nobody has ever put on a
 * line is not a problem to be worked through, it is a catalog of 800 things
 * most companies will never buy. The view returns a company's own uncosted
 * materials, plus any catalog row that is actually on somebody's line — and
 * counts the lines and the estimates, which is what makes an order possible.
 *
 * Ordered here rather than in the view because the ordering is a judgment about
 * what matters — money at risk today before tidiness — and that belongs next to
 * the screen making the claim.
 */
export const loadUncostedMaterials: Query<UncostedMaterial[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_uncosted_materials')
    .select('id, code, name, category, unit, is_own, used_on_lines, used_on_estimates')
    .order('used_on_estimates', { ascending: false })
    .order('used_on_lines', { ascending: false })
    .order('name', { ascending: true })) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    code: String(r.code),
    name: String(r.name),
    category: (r.category as string | null) ?? null,
    unit: String(r.unit),
    isOwn: Boolean(r.is_own),
    usedOnLines: Number(r.used_on_lines ?? 0),
    usedOnEstimates: Number(r.used_on_estimates ?? 0),
  }));
};

export interface HaulPrice {
  pricingBasis: string;
  /** Null on a cycle-priced haul: trips come out of a cycle analysis. */
  tripsPaid: number | null;
  /** Null where the basis cannot answer without a cycle analysis. */
  cost: number | null;
  effectiveRatePerUnit: number | null;
  unusedCapacity: number | null;
}

/**
 * What a quantity costs on one haul rate's own basis.
 *
 * `app.haul_cost` was written in 0067 with its reasoning stated plainly: the
 * trip arithmetic is duplicated from `packages/engine/src/trucking.ts` rather
 * than shared, because "the engine cannot be called from SQL, and a company
 * comparing quotes on a screen should not need an Edge Function round trip per
 * row". A test runs the same cases through both and fails if they disagree.
 *
 * There was no screen. The function had no `public.` wrapper for eighty
 * migrations, so the round trip it was written to avoid was the only way to get
 * the number — and nothing took it. Migration 0147 is the door.
 *
 * A cycle-priced haul answers null rather than a figure, and that is the point
 * of asking the database instead of multiplying in the component: inventing a
 * cost from the hourly rate alone is the shortcut the basis exists to avoid.
 */
export async function haulCost(
  client: Writer, rateId: string, quantity: number,
): Promise<HaulPrice | null> {
  const { data, error } = await client.rpc('haul_cost', {
    p_rate_id: rateId, p_quantity: quantity,
  });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!row) return null;
  const maybe = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    pricingBasis: String(row.pricing_basis),
    tripsPaid: maybe(row.trips_paid),
    cost: maybe(row.cost),
    effectiveRatePerUnit: maybe(row.effective_rate_per_unit),
    unusedCapacity: maybe(row.unused_capacity),
  };
}
