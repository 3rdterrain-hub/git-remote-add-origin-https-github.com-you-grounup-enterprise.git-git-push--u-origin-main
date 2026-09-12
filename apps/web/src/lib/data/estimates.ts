/**
 * Estimates: the real ones.
 *
 * The estimating screens have rendered `@/data/operations` since they were
 * built — a fixture of six invented bids with invented values and an invented
 * win rate. That was defensible while nothing could create an estimate. It
 * stopped being defensible with migration 0097, which gave estimating its write
 * path: a person can now create an estimate, add lines from the master library,
 * price them through the deterministic engine, approve one and issue a proposal.
 *
 * Every write below goes through a governed function rather than an insert.
 * That is not ceremony. Creating an estimate has to make three rows agree; a
 * line has to inherit its unit, cost code and production rate from the library
 * or the library is decoration; approving one has to capture the snapshot that
 * makes the price reproducible. None of that belongs in a browser, and a screen
 * that did it with three inserts would get it wrong in a different way each
 * time somebody added a screen.
 */
import { unwrap, type Query } from './query';
import { ESTIMATES } from '@/data/operations';

export type EstimateStatus =
  | 'draft' | 'in_review' | 'approved' | 'issued' | 'awarded' | 'lost' | 'archived';

export interface EstimateRow {
  id: string;
  number: string;
  name: string;
  status: EstimateStatus;
  customerName: string | null;
  customerId: string | null;
  bidDueAt: string | null;
  /** When the price stops being good. Null means it does not expire. */
  expiresAt: string | null;
  /** Derived here from `expiresAt` and the clock — never a stored flag. */
  expired: boolean;
  createdAt: string;
  updatedAt: string;
  currentVersionId: string | null;
  /** The engine's number, not a stored total anybody could type over. */
  bidPrice: number;
  directCost: number;
  /** The engine's own verdict on whether this may go to a customer. */
  blockedFromIssue: boolean;
  confidence: number | null;
  versionNumber: number | null;
  /** Null until the version has been priced. */
  pricedAt: string | null;
}

export interface LineRow {
  id: string;
  sortOrder: number;
  lineNumber: string | null;
  description: string;
  serviceId: string | null;
  serviceName: string | null;
  /** The words the customer reads on the proposal, under the line's own. */
  notes: string | null;
  costCode: string | null;
  unit: string;
  measuredQuantity: number;
  adjustedQuantity: number;
  unitCost: number;
  totalDirectCost: number;
  laborHours: number;
  equipmentHours: number;
  confidenceBand: string;
  blocksIssue: boolean;
  hasProductionRate: boolean;
  /** Whether the customer sees this line at all. It is priced either way. */
  clientVisible: boolean;
  /** This line's own markup as a fraction, or null to use the profile. */
  markupOverride: number | null;
  /** Which budget this line rolls up to, when the company tracks that. */
  costCodeId: string | null;
  /** What the line sells for, and the markup inside it. Engine-written. */
  markupRate: number;
  markupAmount: number;
  totalPrice: number;
  unitPrice: number;
  wastePercent: number;
  /** What the estimator typed to get the quantity, when it was a calculation. */
  quantityExpression: string | null;
  /*
   * A rate this line is priced *at* rather than built up to. Null on an
   * ordinary line; when it is set, the crew, machines and materials below are
   * empty by construction — a line carrying both would report a number nobody
   * could reproduce from what is on it.
   */
  parametricCostPerUnit: number | null;
  parametricBasis: string | null;
  productionModifier: number;
  /*
   * How the quantity was arrived at, and what has been checked about it.
   *
   * These are the three inputs the engine scores confidence from, and the score
   * is what decides whether a line blocks its estimate from being issued. Every
   * layer between the line and the engine carried them and no screen could set
   * one, so a hand-entered estimate sat at the score an unverified quantity
   * deserves and could never be approved, issued or awarded. Migration 0144.
   */
  measurementMethod: string;
  checkPrimarySource: boolean;
  checkCrossSource: boolean;
  checkReconciliation: boolean;
}

/** One crew member, machine, material, truck or subcontract behind a line. */
export interface LineResource {
  id: string;
  kind: 'labor' | 'equipment' | 'material' | 'trucking' | 'disposal' | 'subcontract';
  sortOrder: number;
  description: string | null;
  role: string | null;
  notes: string | null;

  quantity: number;
  unit: string | null;
  unitRate: number;
  hours: number;
  headcount: number | null;

  /** Labor: the wage and the burden separately, so the loaded rate is derived. */
  baseRate: number | null;
  burdenRate: number | null;

  /** Whether this row's production governs the line's hours, and at what rate. */
  drivesHours: boolean;
  productionPerHour: number | null;

  /** Equipment: how it is billed, and what it costs to get there and sit idle. */
  rateBasis: 'hour' | 'day' | 'week' | 'month' | 'unit' | 'lump';
  mobilizationCost: number;
  standbyDays: number;
  minimumHours: number | null;
  isOwned: boolean;

  /** Trucking: hours somebody entered, or a route to compute a cycle from. */
  haulMode: 'hours' | 'trip';
  roundTripMiles: number | null;
  averageSpeedMph: number | null;
  truckCapacity: number | null;
  /** What truckCapacity counts. Null means nobody has said. */
  capacityUnit: string | null;
  tonsPerLoad: number | null;
  loadMinutes: number | null;
  dumpMinutes: number | null;
  queueMinutes: number | null;
  includesDisposal: boolean;

  /** The engine's, never sent. Zero until the estimate has been priced. */
  extendedCost: number;
}

export interface VersionDetail {
  id: string;
  estimateId: string;
  estimateNumber: string;
  estimateName: string;
  customerName: string | null;
  expiresAt: string | null;
  expired: boolean;
  createdAt: string;
  /*
   * Where the work is, off the estimate rather than the version. These have
   * existed since 0006 and were written by nothing until 0148 — and
   * `award_estimate_version` copies them onto the project, which is what lets
   * the site forecast be the site's rather than the yard's.
   */
  siteAddress: string | null;
  siteCity: string | null;
  siteState: string | null;
  versionNumber: number;
  status: EstimateStatus;
  directCost: number;
  indirectCost: number;
  totalMarkup: number;
  totalPrice: number;
  bidPrice: number;
  totalLaborHours: number;
  totalEquipmentHours: number;
  blockedFromIssue: boolean;
  confidence: number | null;
  engineVersion: string | null;
  calculatedAt: string | null;
  /** Set once the version is approved; what makes the price reproducible. */
  librarySnapshotId: string | null;
  approvedAt: string | null;
  issuedAt: string | null;
  costs: Record<string, number>;
  lines: LineRow[];
  /** What the proposal discloses of the build-up, per cost category. */
  show: {
    labor: boolean; equipment: boolean; materials: boolean;
    hauling: boolean; subcontract: boolean;
  };
  /**
   * The estimator's inputs the engine reads off the version. Every one of these
   * changes what the job costs, which is why they belong on the bid rather than
   * on the company: a coastal job in sand does not swell like an inland one in
   * clay, and last quarter's diesel is not this quarter's.
   */
  assumptions: {
    shiftHours: number;
    calendarEfficiency: number;
    fuelPricePerGallon: number;
    defPricePerGallon: number;
    swellPercent: number;
    shrinkPercent: number;
    bidRoundingIncrement: number;
  };
}

/** A service the caller may put on a line, from their library and the platform's. */
export interface LibraryService {
  id: string;
  code: string;
  name: string;
  category: string | null;
  defaultUnit: string;
  supportedUnits: string[];
  /** Whether this is the company's own row or the shipped catalog's. */
  isOwn: boolean;
}

const one = <T,>(v: unknown): T | null =>
  (Array.isArray(v) ? (v as T[])[0] : (v as T | null)) ?? null;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/*
 * The slices of the Supabase client the writers use, written structurally so a
 * test can pass a stub and the real client still satisfies them.
 */
type RpcCapable = {
  rpc: (fn: string, args: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: { message: string } | null }>;
};
type InsertCapable = {
  from: (t: string) => {
    insert: (v: Record<string, unknown>) => {
      select: (c: string) => {
        single: () => PromiseLike<{ data: unknown; error: { message: string } | null }>;
      };
    };
  };
};

const rpc = async <T,>(client: RpcCapable, fn: string, args: Record<string, unknown>) => {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
};

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Every estimate the caller may see, with the current version's numbers.
 *
 * The totals come from the version rather than from the estimate, because the
 * estimate row carries no money at all — the engine owns the number and writes
 * it exactly once, to the version it priced.
 */
export const loadEstimates: Query<EstimateRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('estimates')
    .select('id, number, name, status, bid_due_at, expires_at, created_at, updated_at, current_version_id, customer_id, customers(name), estimate_versions!estimates_current_version_fk(version_number, direct_cost, bid_price, total_price, blocked_from_issue, weighted_confidence, calculated_at)')
    .order('updated_at', { ascending: false })
    .limit(500)) as Array<Record<string, unknown>>;

  return rows.map((e) => {
    const v = one<Record<string, unknown>>(e.estimate_versions);
    return {
      id: String(e.id),
      number: String(e.number),
      name: String(e.name),
      status: e.status as EstimateStatus,
      customerName: one<{ name: string }>(e.customers)?.name ?? null,
      customerId: (e.customer_id as string | null) ?? null,
      bidDueAt: (e.bid_due_at as string | null) ?? null,
      expiresAt: (e.expires_at as string | null) ?? null,
      // Derived at read time. A stored flag would be wrong from the moment the
      // clock passed it until something ran to correct it.
      expired: e.expires_at != null && new Date(String(e.expires_at)) <= new Date(),
      createdAt: String(e.created_at),
      updatedAt: String(e.updated_at),
      currentVersionId: (e.current_version_id as string | null) ?? null,
      // A version that has not been priced reports zero, which is what it is.
      bidPrice: num(v?.bid_price) || num(v?.total_price),
      directCost: num(v?.direct_cost),
      // Absent a version, nothing has cleared it — which is the safe reading.
      blockedFromIssue: v ? Boolean(v.blocked_from_issue) : true,
      confidence: v?.weighted_confidence == null ? null : Number(v.weighted_confidence),
      versionNumber: v?.version_number == null ? null : Number(v.version_number),
      pricedAt: (v?.calculated_at as string | null) ?? null,
    };
  });
};

/** One version, with its lines. The workspace screen's whole subject. */
export const loadVersion = (versionId: string): Query<VersionDetail | null> => async (client) => {
  const rows = unwrap(await client
    .from('estimate_versions')
    .select('id, estimate_id, version_number, status, direct_cost, indirect_cost, total_markup, total_price, bid_price, total_labor_hours, total_equipment_hours, blocked_from_issue, weighted_confidence, engine_version, calculated_at, library_snapshot_id, approved_at, issued_at, cost_labor_wage, cost_labor_burden, cost_equipment, cost_equipment_mob, cost_fuel, cost_material, cost_trucking, cost_disposal, cost_subcontract, cost_other, show_labor, show_equipment, show_materials, show_hauling, show_subcontract, shift_hours, calendar_efficiency, fuel_price_per_gallon, def_price_per_gallon, swell_percent, shrink_percent, bid_rounding_increment, estimates!estimate_versions_estimate_id_fkey(number, name, expires_at, created_at, site_address, site_city, site_state, customers(name))')
    .eq('id', versionId)
    .limit(1)) as Array<Record<string, unknown>>;
  const v = rows[0];
  if (!v) return null;

  const est = one<{ number: string; name: string; expires_at: string | null;
                   created_at: string; site_address: string | null;
                   site_city: string | null; site_state: string | null;
                   customers: unknown }>(v.estimates);
  const lines = unwrap(await client
    .from('estimate_line_items')
    .select('id, sort_order, line_number, description, service_id, cost_code_id, notes, unit, measured_quantity, adjusted_quantity, unit_cost, total_direct_cost, labor_hours, equipment_hours, confidence_band, blocks_issue, production_rate_id, client_visible, markup_override, waste_percent, quantity_expression, production_modifier, parametric_cost_per_unit, parametric_basis, markup_rate, markup_amount, total_price, unit_price, measurement_method, check_primary_source, check_cross_source, check_reconciliation, services(name), cost_codes(code)')
    .eq('estimate_version_id', versionId)
    .order('sort_order')) as Array<Record<string, unknown>>;

  return {
    id: String(v.id),
    estimateId: String(v.estimate_id),
    estimateNumber: est?.number ?? '',
    estimateName: est?.name ?? '',
    customerName: one<{ name: string }>(est?.customers)?.name ?? null,
    expiresAt: est?.expires_at ?? null,
    expired: est?.expires_at != null && new Date(est.expires_at) <= new Date(),
    siteAddress: est?.site_address ?? null,
    siteCity: est?.site_city ?? null,
    siteState: est?.site_state ?? null,
    createdAt: est?.created_at ?? '',
    versionNumber: Number(v.version_number),
    status: v.status as EstimateStatus,
    directCost: num(v.direct_cost),
    indirectCost: num(v.indirect_cost),
    totalMarkup: num(v.total_markup),
    totalPrice: num(v.total_price),
    bidPrice: num(v.bid_price) || num(v.total_price),
    totalLaborHours: num(v.total_labor_hours),
    totalEquipmentHours: num(v.total_equipment_hours),
    blockedFromIssue: Boolean(v.blocked_from_issue),
    confidence: v.weighted_confidence == null ? null : Number(v.weighted_confidence),
    engineVersion: (v.engine_version as string | null) ?? null,
    calculatedAt: (v.calculated_at as string | null) ?? null,
    librarySnapshotId: (v.library_snapshot_id as string | null) ?? null,
    approvedAt: (v.approved_at as string | null) ?? null,
    issuedAt: (v.issued_at as string | null) ?? null,
    // RULE-001: the cost buckets stay separately visible, never rolled into one.
    costs: {
      labor: num(v.cost_labor_wage), burden: num(v.cost_labor_burden),
      equipment: num(v.cost_equipment), mobilization: num(v.cost_equipment_mob),
      fuel: num(v.cost_fuel), material: num(v.cost_material),
      trucking: num(v.cost_trucking), disposal: num(v.cost_disposal),
      subcontract: num(v.cost_subcontract), other: num(v.cost_other),
    },
    lines: lines.map((l) => ({
      id: String(l.id),
      sortOrder: Number(l.sort_order),
      lineNumber: (l.line_number as string | null) ?? null,
      description: String(l.description),
      serviceId: (l.service_id as string | null) ?? null,
      serviceName: one<{ name: string }>(l.services)?.name ?? null,
      costCode: one<{ code: string }>(l.cost_codes)?.code ?? null,
      unit: String(l.unit),
      measuredQuantity: num(l.measured_quantity),
      adjustedQuantity: num(l.adjusted_quantity),
      unitCost: num(l.unit_cost),
      parametricCostPerUnit: l.parametric_cost_per_unit === null
        ? null : num(l.parametric_cost_per_unit),
      parametricBasis: (l.parametric_basis as string | null) ?? null,
      totalDirectCost: num(l.total_direct_cost),
      laborHours: num(l.labor_hours),
      equipmentHours: num(l.equipment_hours),
      confidenceBand: String(l.confidence_band),
      blocksIssue: Boolean(l.blocks_issue),
      measurementMethod: String(l.measurement_method ?? 'explicit_dimension'),
      checkPrimarySource: Boolean(l.check_primary_source),
      checkCrossSource: Boolean(l.check_cross_source),
      checkReconciliation: Boolean(l.check_reconciliation),
      // A line with no rate cannot be priced from production, and the screen
      // should say so before somebody wonders why the number is zero.
      hasProductionRate: l.production_rate_id != null,
      clientVisible: l.client_visible !== false,
      markupOverride: l.markup_override == null ? null : Number(l.markup_override),
      costCodeId: (l.cost_code_id as string | null) ?? null,
      notes: (l.notes as string | null) ?? null,
      markupRate: Number(l.markup_rate ?? 0),
      markupAmount: Number(l.markup_amount ?? 0),
      totalPrice: Number(l.total_price ?? 0),
      unitPrice: Number(l.unit_price ?? 0),
      wastePercent: num(l.waste_percent),
      quantityExpression: (l.quantity_expression as string | null) ?? null,
      productionModifier: l.production_modifier == null ? 1 : Number(l.production_modifier),
    })),
    show: {
      labor: Boolean(v.show_labor),
      equipment: Boolean(v.show_equipment),
      materials: v.show_materials !== false,
      hauling: v.show_hauling !== false,
      subcontract: v.show_subcontract !== false,
    },
    assumptions: {
      shiftHours: num(v.shift_hours),
      calendarEfficiency: num(v.calendar_efficiency),
      fuelPricePerGallon: num(v.fuel_price_per_gallon),
      defPricePerGallon: num(v.def_price_per_gallon),
      swellPercent: num(v.swell_percent),
      shrinkPercent: num(v.shrink_percent),
      bidRoundingIncrement: num(v.bid_rounding_increment),
    },
  };
};

/**
 * Services the caller can put on a line.
 *
 * Row level security returns the company's own rows and the platform catalog
 * together, which is the correct set: a company that has copied a service to
 * change its numbers sees both, and the copy is marked as theirs.
 */
export const searchServices = (
  term: string, category?: string | null,
): Query<LibraryService[]> => async (client) => {
  let q = client
    .from('services')
    .select('id, code, name, category, default_unit, supported_units, company_id')
    .eq('status', 'active');
  const t = term.trim();
  if (t) q = q.ilike('search_text', `%${t}%`);
  /*
   * Narrowing by category is what makes 860 services usable. It is an equality
   * rather than a search because a category is a record since migration 0113,
   * and the value here came from the same list the row was written from.
   */
  if (category) q = q.eq('category', category);
  const rows = unwrap(await q.order('name').limit(50)) as Array<Record<string, unknown>>;
  return rows.map((s) => ({
    id: String(s.id),
    code: String(s.code),
    name: String(s.name),
    category: (s.category as string | null) ?? null,
    defaultUnit: String(s.default_unit),
    supportedUnits: (s.supported_units as string[] | null) ?? [String(s.default_unit)],
    isOwn: s.company_id != null,
  }));
};

export interface ProposalRow {
  id: string;
  number: string;
  title: string;
  customerName: string | null;
  status: 'draft' | 'issued' | 'accepted' | 'declined' | 'expired' | 'withdrawn';
  totalPrice: number;
  validityDays: number;
  coverLetter: string | null;
  paymentTerms: string | null;
  showLineDetail: boolean;
  showUnitPrices: boolean;
  issuedAt: string | null;
  viewedAt: string | null;
  acceptedAt: string | null;
  acceptedByName: string | null;
  declinedAt: string | null;
  estimateVersionId: string;
  estimateNumber: string;
  estimateVersion: number;
}

/** Every proposal the caller may see, newest first. */
export const loadProposals: Query<ProposalRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('proposals')
    .select('id, number, title, status, total_price, validity_days, cover_letter, payment_terms, show_line_detail, show_unit_prices, issued_at, viewed_at, accepted_at, accepted_by_name, declined_at, estimate_version_id, customers(name), estimate_versions(version_number, estimates!estimate_versions_estimate_id_fkey(number))')
    .order('created_at', { ascending: false })
    .limit(200)) as Array<Record<string, unknown>>;

  return rows.map((p) => {
    const v = one<{ version_number: number; estimates: unknown }>(p.estimate_versions);
    return {
      id: String(p.id),
      number: String(p.number),
      title: String(p.title),
      customerName: one<{ name: string }>(p.customers)?.name ?? null,
      status: p.status as ProposalRow['status'],
      totalPrice: num(p.total_price),
      validityDays: Number(p.validity_days ?? 30),
      coverLetter: (p.cover_letter as string | null) ?? null,
      paymentTerms: (p.payment_terms as string | null) ?? null,
      showLineDetail: Boolean(p.show_line_detail),
      showUnitPrices: Boolean(p.show_unit_prices),
      issuedAt: (p.issued_at as string | null) ?? null,
      viewedAt: (p.viewed_at as string | null) ?? null,
      acceptedAt: (p.accepted_at as string | null) ?? null,
      acceptedByName: (p.accepted_by_name as string | null) ?? null,
      declinedAt: (p.declined_at as string | null) ?? null,
      estimateVersionId: String(p.estimate_version_id),
      estimateNumber: one<{ number: string }>(v?.estimates)?.number ?? '',
      estimateVersion: Number(v?.version_number ?? 0),
    };
  });
};

/**
 * Record what the customer said.
 *
 * Accepting moves the estimate to awarded and declining moves it to lost, in
 * the same statement, because they are one fact — see migration 0101. Doing it
 * as two updates from here is how an accepted proposal ends up against a bid
 * the platform still believes is out for decision.
 */
export async function recordProposalOutcome(
  client: RpcCapable,
  input: { proposalId: string; outcome: 'accepted' | 'declined' | 'withdrawn' | 'expired';
           byName?: string; reason?: string },
): Promise<void> {
  await rpc(client, 'record_proposal_outcome', {
    p_proposal: input.proposalId,
    p_outcome: input.outcome,
    p_by_name: input.byName?.trim() || null,
    p_reason: input.reason?.trim() || null,
  });
}

/**
 * Everything behind one line.
 *
 * Read separately from the line rather than embedded, because a workspace shows
 * eight lines and opens one: fetching every crew member on every line to render
 * a table nobody has expanded is work for nothing.
 */
export const loadLineResources = (lineId: string): Query<LineResource[]> => async (client) => {
  const rows = unwrap(await client
    .from('estimate_line_resources')
    .select('id, resource_kind, sort_order, description, role, notes, quantity, unit, unit_rate, hours, headcount, base_rate, burden_rate, drives_hours, production_per_hour, rate_basis, mobilization_cost, standby_days, minimum_hours, is_owned, haul_mode, round_trip_miles, average_speed_mph, truck_capacity, capacity_unit, tons_per_load, load_minutes, dump_minutes, queue_minutes, includes_disposal, extended_cost')
    .eq('line_item_id', lineId)
    .order('sort_order')) as Array<Record<string, unknown>>;

  const maybeNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

  return rows.map((r) => ({
    id: String(r.id),
    kind: r.resource_kind as LineResource['kind'],
    sortOrder: Number(r.sort_order ?? 0),
    description: (r.description as string | null) ?? null,
    role: (r.role as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    quantity: num(r.quantity),
    unit: (r.unit as string | null) ?? null,
    unitRate: num(r.unit_rate),
    hours: num(r.hours),
    headcount: maybeNum(r.headcount),
    baseRate: maybeNum(r.base_rate),
    burdenRate: maybeNum(r.burden_rate),
    drivesHours: Boolean(r.drives_hours),
    productionPerHour: maybeNum(r.production_per_hour),
    rateBasis: (r.rate_basis as LineResource['rateBasis']) ?? 'hour',
    mobilizationCost: num(r.mobilization_cost),
    standbyDays: num(r.standby_days),
    minimumHours: maybeNum(r.minimum_hours),
    isOwned: r.is_owned !== false,
    haulMode: (r.haul_mode as LineResource['haulMode']) ?? 'hours',
    roundTripMiles: maybeNum(r.round_trip_miles),
    averageSpeedMph: maybeNum(r.average_speed_mph),
    truckCapacity: maybeNum(r.truck_capacity),
    capacityUnit: (r.capacity_unit as string | null) ?? null,
    tonsPerLoad: maybeNum(r.tons_per_load),
    loadMinutes: maybeNum(r.load_minutes),
    dumpMinutes: maybeNum(r.dump_minutes),
    queueMinutes: maybeNum(r.queue_minutes),
    includesDisposal: Boolean(r.includes_disposal),
    extendedCost: num(r.extended_cost),
  }));
};

/**
 * Add or change one resource.
 *
 * Sends only the fields that changed. A cost is never among them: migration
 * 0058's guard resets a hand-written engine output on insert rather than
 * refusing it, so a number sent here would vanish without an error — and
 * `app.save_line_resource` does not offer the chance.
 */
export async function saveLineResource(
  client: RpcCapable,
  input: { lineId: string; kind: LineResource['kind'];
           fields: Record<string, unknown>; resourceId?: string | null },
): Promise<string> {
  return rpc<string>(client, 'save_line_resource', {
    p_line: input.lineId,
    p_kind: input.kind,
    p_fields: input.fields,
    p_resource: input.resourceId ?? null,
  });
}

export async function deleteLineResource(client: RpcCapable, id: string): Promise<void> {
  await rpc(client, 'delete_line_resource', { p_resource: id });
}

/** The estimator's own fields on a line. Never a cost — those are the engine's. */
export async function updateLine(
  client: RpcCapable, lineId: string, fields: Record<string, unknown>,
): Promise<void> {
  await rpc(client, 'update_estimate_line', { p_line: lineId, p_fields: fields });
}

/** What the proposal discloses, and the version's own settings. */
export async function updateVersion(
  client: RpcCapable, versionId: string, fields: Record<string, unknown>,
): Promise<void> {
  await rpc(client, 'update_estimate_version', { p_version: versionId, p_fields: fields });
}

/** One adjustment on a bid: overhead, profit, contingency, bond, tax, discount. */
export interface EstimateMarkup {
  code: string;
  label: string;
  /** A fraction, as every other rate in the schema is. */
  percent: number;
  basis: 'profile_default' | 'direct_cost' | 'direct_plus_indirect'
       | 'running_total' | 'marked_up_total';
  sequence: number;
  disclosed: boolean;
  enabled: boolean;
}

/**
 * The adjustments on this bid, or the company profile's when it has none.
 *
 * Both are returned as the same shape with `fromProfile` saying which, because
 * the screen needs to show the numbers either way and needs to say whether
 * changing one changes this bid or every open estimate.
 */
export const loadEstimateMarkups = (versionId: string): Query<{
  markups: EstimateMarkup[]; fromProfile: boolean;
}> => async (client) => {
  const own = unwrap(await client
    .from('estimate_version_markups')
    .select('code, label, percent, basis, sequence, disclosed, enabled')
    .eq('estimate_version_id', versionId)
    .order('sequence')) as Array<Record<string, unknown>>;

  const shape = (rows: Array<Record<string, unknown>>): EstimateMarkup[] => rows.map((m) => ({
    code: String(m.code),
    label: String(m.label),
    percent: num(m.percent),
    basis: (m.basis as EstimateMarkup['basis']) ?? 'profile_default',
    sequence: Number(m.sequence ?? 10),
    disclosed: Boolean(m.disclosed),
    enabled: m.enabled !== false,
  }));

  if (own.length > 0) return { markups: shape(own), fromProfile: false };

  const version = unwrap(await client
    .from('estimate_versions')
    .select('pricing_profile_id')
    .eq('id', versionId)
    .limit(1)) as Array<{ pricing_profile_id: string | null }>;
  const profileId = version[0]?.pricing_profile_id;
  if (!profileId) return { markups: [], fromProfile: true };

  const fromProfile = unwrap(await client
    .from('markup_components')
    .select('code, label, percent, basis, sequence, disclosed')
    .eq('pricing_profile_id', profileId)
    .order('sequence')) as Array<Record<string, unknown>>;
  return { markups: shape(fromProfile), fromProfile: true };
};

/** What this bid is being sold for less than it came to, and why. */
export interface Discount {
  percent: number;
  amount: number;
  reason: string | null;
}

export const loadDiscount = (versionId: string): Query<Discount> => async (client) => {
  const rows = unwrap(await client
    .from('estimate_versions')
    .select('discount_percent, discount_amount, discount_reason')
    .eq('id', versionId)
    .limit(1)) as Array<Record<string, unknown>>;
  const v = rows[0];
  return {
    percent: num(v?.discount_percent),
    amount: num(v?.discount_amount),
    reason: (v?.discount_reason as string | null) ?? null,
  };
};

/**
 * Cut the price.
 *
 * Its own call rather than part of the version update, because it is a
 * different kind of act: the rest of that is how a bid is put together, and
 * this is a decision to sell it for less than it came to.
 */
export async function setEstimateDiscount(
  client: RpcCapable,
  input: { versionId: string; percent?: number; amount?: number; reason?: string | null },
): Promise<void> {
  await rpc(client, 'set_estimate_discount', {
    p_version: input.versionId,
    p_percent: input.percent ?? 0,
    p_amount: input.amount ?? 0,
    p_reason: input.reason?.trim() || null,
  });
}

export async function setEstimateMarkup(
  client: RpcCapable, versionId: string, code: string, fields: Record<string, unknown>,
): Promise<void> {
  await rpc(client, 'set_estimate_markup', {
    p_version: versionId, p_code: code, p_fields: fields,
  });
}

/** Copy the company standard onto this bid so there is something to adjust. */
export async function adoptProfileMarkups(
  client: RpcCapable, versionId: string,
): Promise<number> {
  return rpc<number>(client, 'adopt_profile_markups', { p_version: versionId });
}

export async function removeEstimateMarkup(
  client: RpcCapable, versionId: string, code: string,
): Promise<void> {
  await rpc(client, 'remove_estimate_markup', { p_version: versionId, p_code: code });
}

/** What has moved in the library since this version was priced. */
export interface DriftRow {
  kind: string;
  sourceId: string;
  status: string;
  snapshotUpdatedAt: string | null;
  liveUpdatedAt: string | null;
}

export const loadDrift = (versionId: string): Query<DriftRow[]> => async (client) => {
  const rows = await rpc<Array<Record<string, unknown>>>(
    client as unknown as RpcCapable, 'estimate_drift', { p_version: versionId });
  return (rows ?? [])
    .filter((r) => r.status !== 'unchanged')
    .map((r) => ({
      kind: String(r.kind),
      sourceId: String(r.source_id),
      status: String(r.status),
      snapshotUpdatedAt: (r.snapshot_updated_at as string | null) ?? null,
      liveUpdatedAt: (r.live_updated_at as string | null) ?? null,
    }));
};

// ---------------------------------------------------------------------------
// Writing — every one of these is a governed function, never a bare insert
// ---------------------------------------------------------------------------

export async function createEstimate(
  client: RpcCapable,
  input: { name: string; customerId?: string | null; number?: string | null;
           bidDueAt?: string | null; companyId?: string | null;
           expiresAt?: string | null; description?: string | null;
           siteAddress?: string | null; siteCity?: string | null;
           siteState?: string | null },
): Promise<string> {
  return rpc<string>(client, 'create_estimate', {
    p_name: input.name,
    p_customer_id: input.customerId ?? null,
    p_number: input.number?.trim() || null,
    p_bid_due_at: input.bidDueAt || null,
    p_company: input.companyId ?? null,
    p_expires_at: input.expiresAt || null,
    p_description: input.description?.trim() || null,
    p_site_address: input.siteAddress?.trim() || null,
    p_site_city: input.siteCity?.trim() || null,
    p_site_state: input.siteState?.trim() || null,
  });
}

/**
 * Set where the work is, after the fact.
 *
 * `estimates.site_address`, `site_city` and `site_state` have existed since
 * migration 0006 and were written by nothing until 0148 — not at creation, not
 * afterwards. `award_estimate_version` reads all three and copies them onto the
 * project, so every project ever awarded carried three nulls, and the site
 * forecast reported from the yard with no way for anybody to change that.
 *
 * Separate from creation because the answer often arrives later and changes: a
 * bid invitation naming a county and a parcel becomes a street address once
 * somebody drives out to look at it.
 */
export async function setEstimateSite(
  client: RpcCapable, estimateId: string,
  site: { address?: string | null; city?: string | null; state?: string | null },
): Promise<void> {
  await rpc(client, 'set_estimate_site', {
    p_estimate: estimateId,
    p_site_address: site.address?.trim() || null,
    p_site_city: site.city?.trim() || null,
    p_site_state: site.state?.trim() || null,
  });
}

/** Move or clear the date an estimate's price stops being good. */
export async function setEstimateExpiry(
  client: RpcCapable, estimateId: string, expiresAt: string | null,
): Promise<void> {
  await rpc(client, 'set_estimate_expiry', {
    p_estimate: estimateId, p_expires_at: expiresAt,
  });
}

/**
 * The company the caller is working in.
 *
 * There is no company switcher yet, so this is the sole active membership. Two
 * memberships is a question rather than a default — guessing would file a
 * client under the wrong company, which is the kind of mistake nobody notices
 * until an invoice goes to the wrong place.
 */
export const loadMyCompanyId: Query<string | null> = async (client) => {
  const rows = unwrap(await client
    .from('company_memberships')
    .select('company_id')
    .eq('status', 'active')
    .limit(2)) as Array<{ company_id: string }>;
  return rows.length === 1 ? rows[0]!.company_id : null;
};

export interface CustomerOption { id: string; code: string; name: string; city: string | null }

/** The clients an estimate can be for. */
export const loadCustomers: Query<CustomerOption[]> = async (client) => {
  const rows = unwrap(await client
    .from('customers')
    .select('id, code, name, city')
    .eq('status', 'active')
    .order('name')
    .limit(500)) as Array<Record<string, unknown>>;
  return rows.map((c) => ({
    id: String(c.id), code: String(c.code), name: String(c.name),
    city: (c.city as string | null) ?? null,
  }));
};

/**
 * Add a client without leaving the estimate.
 *
 * The code is generated when nobody gives one, because being made to invent an
 * identifier is how a person ends up with CUST1, CUST-1 and Cust_1 for the same
 * company.
 */
export async function createCustomer(
  client: InsertCapable, input: { companyId: string; name: string; code?: string | null },
): Promise<string> {
  const code = input.code?.trim()
    || `CUS-${input.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase()
        || 'CLIENT'}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const { data, error } = await client
    .from('customers')
    .insert({ company_id: input.companyId, code, name: input.name.trim() })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return String((data as { id: string }).id);
}

/**
 * Add a line.
 *
 * The costs are deliberately not sent and could not be accepted if they were:
 * migration 0058 resets every engine-owned column on insert. A line arrives
 * unpriced and stays that way until the engine has run over it.
 */
export async function addLine(
  client: RpcCapable,
  input: { versionId: string; serviceId?: string | null; description?: string | null;
           quantity?: number; unit?: string | null },
): Promise<string> {
  return rpc<string>(client, 'add_estimate_line', {
    p_version: input.versionId,
    p_service: input.serviceId ?? null,
    p_description: input.description?.trim() || null,
    p_quantity: input.quantity ?? 0,
    p_unit: input.unit ?? null,
  });
}

/**
 * What bidding a line in an off-list unit costs, in a sentence.
 *
 * The unit picker offers every unit on every line, deliberately — a company
 * that bids topsoil by the load rather than the cubic yard is not making a
 * mistake, and migration 0117 stopped refusing it. What it did instead was
 * write the sentence that says what the choice costs: no production rate in the
 * library is measured that way, so the hours stop coming from production and
 * start coming from whatever crew and machines are on the line.
 *
 * `app.line_unit_note` has existed since that migration and nothing ever
 * called it, so an estimator could change LF to EA on a line and be told
 * nothing at all. Null when the unit is one the service lists, which is the
 * ordinary case and wants no sentence.
 */
export async function lineUnitNote(client: RpcCapable, lineId: string): Promise<string | null> {
  const note = await rpc<string | null>(client, 'line_unit_note', { p_line: lineId });
  return note && note.trim().length > 0 ? note : null;
}

/**
 * Change a quantity.
 *
 * The measured quantity is the estimator's input and the only quantity they
 * own; `adjusted_quantity` and `gross_quantity` follow from it by waste, loss
 * and swell the engine applies, and the guard refuses a hand-written one.
 */
/**
 * Set a line's quantity, and the calculation it came from.
 *
 * A governed function rather than a bare update, because the two have to move
 * together: a quantity changed without its expression would leave a stale
 * calculation beside a number it no longer produces. `120 * 4 * 0.667` next to
 * a quantity somebody has since typed over is worse than no calculation at all.
 */
export async function setLineQuantity(
  client: RpcCapable, lineId: string, quantity: number, expression?: string | null,
): Promise<void> {
  await rpc(client, 'set_line_quantity', {
    p_line: lineId,
    p_quantity: Math.max(quantity, 0),
    p_expression: expression?.trim() || null,
  });
}

/**
 * Add a line directly after another.
 *
 * Same library lookup as the button at the top of the table — the unit, the
 * cost code and the production rate all come across — placed where the
 * estimator was looking rather than at the bottom.
 */
export async function insertLineAfter(
  client: RpcCapable,
  input: { afterLineId: string; serviceId?: string | null; description?: string | null;
           quantity?: number; unit?: string | null },
): Promise<string> {
  return rpc<string>(client, 'insert_estimate_line_after', {
    p_line: input.afterLineId,
    p_service: input.serviceId ?? null,
    p_description: input.description?.trim() || null,
    p_quantity: input.quantity ?? 0,
    p_unit: input.unit || null,
  });
}

/**
 * Something from the library to put on a line.
 *
 * One shape for all four kinds, because the picker is one control. What differs
 * is what each carries a rate *of* — a labor rate is per hour and burdened, a
 * machine is per hour and resolved through RULE-003, a material is per its own
 * unit, and a subcontractor has no rate at all until somebody quotes.
 */
export interface LibraryPick {
  id: string;
  code: string | null;
  name: string;
  /** What it costs, in the unit below. Null when the library has no rate. */
  rate: number | null;
  unit: string | null;
  /** A second line under the name: a trade, a class, a phone number. */
  detail: string | null;
  /** Whether it is the company's own row rather than the platform's. */
  isOwn: boolean;
  /** Said out loud when the library has no rate, rather than showing a zero. */
  unpriced: boolean;
}

const like = (term: string) => `%${term.trim()}%`;

/** Crew: the classifications, priced at the burdened hourly cost a line pays. */
export const searchLaborRates = (term: string): Query<LibraryPick[]> => async (client) => {
  let q = client
    .from('labor_rates')
    .select('id, code, classification, labor_group, burdened_cost_per_hour, company_id')
    .eq('status', 'active');
  if (term.trim()) q = q.ilike('classification', like(term));
  const rows = unwrap(await q.order('classification').limit(25)) as unknown as
    Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    code: (r.code as string | null) ?? null,
    name: String(r.classification),
    rate: r.burdened_cost_per_hour === null ? null : Number(r.burdened_cost_per_hour),
    unit: 'HR',
    detail: (r.labor_group as string | null) ?? null,
    isOwn: r.company_id !== null,
    unpriced: r.burdened_cost_per_hour === null,
  }));
};

/**
 * Equipment, through the view that already resolves the rate.
 *
 * `my_unrated_equipment` picks the winner under RULE-003 — a project quote
 * beats a company rate beats a regional one beats the seed — so the number in
 * the picker is the number that will land, and a machine with no rate at all
 * says so instead of showing nothing.
 */
export const searchEquipment = (term: string): Query<LibraryPick[]> => async (client) => {
  let q = client
    .from('my_unrated_equipment')
    .select('id, code, name, equipment_class, brand, model, hourly_rate, rate_state, company_id');
  if (term.trim()) q = q.ilike('name', like(term));
  const rows = unwrap(await q.order('name').limit(25)) as unknown as
    Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    code: (r.code as string | null) ?? null,
    name: String(r.name),
    rate: r.hourly_rate === null ? null : Number(r.hourly_rate),
    unit: 'HR',
    detail: [r.equipment_class, r.brand].filter(Boolean).join(' · ') || null,
    isOwn: r.company_id !== null,
    unpriced: r.rate_state === 'unrated',
  }));
};

/** Materials, priced in whatever unit the library holds them in. */
export const searchMaterials = (term: string): Query<LibraryPick[]> => async (client) => {
  let q = client
    .from('materials')
    .select('id, code, name, category, unit, unit_cost, cost_state, company_id')
    .eq('status', 'active');
  if (term.trim()) q = q.ilike('name', like(term));
  const rows = unwrap(await q.order('name').limit(25)) as unknown as
    Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    code: (r.code as string | null) ?? null,
    name: String(r.name),
    rate: Number(r.unit_cost ?? 0),
    unit: (r.unit as string | null) ?? null,
    detail: (r.category as string | null) ?? null,
    isOwn: r.company_id !== null,
    /* Migration 0121: an uncosted material is a different fact from a free one. */
    unpriced: r.cost_state === 'not_costed',
  }));
};

/** Subcontractors. No rate until somebody quotes, which is the honest state. */
export const searchVendors = (term: string): Query<LibraryPick[]> => async (client) => {
  let q = client
    .from('vendors')
    .select('id, code, name, vendor_type, city, state_province, is_qualified, company_id')
    .eq('status', 'active')
    /* A subcontract line wants subcontractors, not the gravel pit. */
    .in('vendor_type', ['subcontractor', 'service']);
  if (term.trim()) q = q.ilike('name', like(term));
  const rows = unwrap(await q.order('name').limit(25)) as unknown as
    Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    code: (r.code as string | null) ?? null,
    name: String(r.name),
    rate: null,
    unit: null,
    detail: [
      r.is_qualified ? 'qualified' : 'not qualified',
      [r.city, r.state_province].filter(Boolean).join(', '),
    ].filter(Boolean).join(' · ') || null,
    isOwn: r.company_id !== null,
    unpriced: true,
  }));
};

/** The units a truck load is bought in, and what each is for. */
export const HAUL_CAPACITY_UNITS = [
  { unit: 'TON', label: 'Tons per load', note: 'Stone, millings, anything crossing a scale.' },
  { unit: 'CY', label: 'Yards per load', note: 'Topsoil, mulch, spoil — sold by volume.' },
  { unit: 'EA', label: 'Loads', note: 'A machine move or a set piece, priced whole.' },
  { unit: 'LB', label: 'Pounds per load', note: 'Small quantities where a ton is too coarse.' },
] as const;

/**
 * What a load is measured in, alongside how much of it there is.
 *
 * A tri-axle hauling stone is bought by the ton; the same truck hauling topsoil
 * is bought by the yard. The two capacity fields on a haul row never said
 * which, and the screen labeled one of them "Tons/load" — an assumption the
 * schema never made.
 */
export async function setHaulCapacity(
  client: RpcCapable, resourceId: string, capacity: number | null, unit: string | null,
): Promise<void> {
  await rpc(client, 'set_haul_capacity', {
    p_resource: resourceId, p_capacity: capacity, p_unit: unit || null,
  });
}

export interface RepointResult {
  service: string | null;
  unit?: string;
  /** True when the line was already priced, so the unit was left alone. */
  unitHeld?: boolean;
  changed: string[];
}

/**
 * Point a line at a different library service, or take it off the library.
 *
 * The unit, the cost code and the production rate belong to the service rather
 * than to the line, so they follow it — except the unit, which is held back
 * once resources are priced on the line. Rescaling a measured quantity
 * underneath somebody is worse than leaving the unit and saying so, which is
 * what `unitHeld` reports.
 */
export async function setLineService(
  client: RpcCapable, lineId: string, serviceId: string | null, keepDescription = false,
): Promise<RepointResult> {
  const row = await rpc<{
    service: string | null; unit?: string; unit_held?: boolean; changed?: string[];
  }>(client, 'set_line_service', {
    p_line: lineId, p_service: serviceId, p_keep_description: keepDescription,
  });
  return {
    service: row?.service ?? null,
    unit: row?.unit,
    unitHeld: Boolean(row?.unit_held),
    changed: row?.changed ?? [],
  };
}

export interface ResourceSuggestion {
  kind: 'labor' | 'equipment' | 'material' | 'trucking';
  resourceId: string;
  name: string;
  quantityPerUnit: number;
  quantity: number;
  unit: string;
  unitRate: number;
  extendedCost: number;
  isOptional: boolean;
  alreadyOnLine: boolean;
}

/**
 * What the library says this line is made of.
 *
 * A read that changes nothing, so a screen can show what *would* be added
 * before any of it is. `assembly_components` has held the answer since
 * migration 0004 — 8,142 rows in the shipped catalog — and until now nothing
 * read them onto a line: an estimator picking "Mass excavation" got a
 * production rate and an empty resource list, and rebuilt by hand what the
 * library already knew.
 */
export const loadResourceSuggestions = (lineId: string): Query<ResourceSuggestion[]> =>
  async (client) => {
    const rows = unwrap(await client
      .from('my_line_resource_suggestions')
      .select('resource_kind, resource_id, name, quantity_per_unit, quantity, unit,'
        + ' unit_rate, extended_cost, is_optional, already_on_line')
      .eq('line_item_id', lineId)) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      kind: r.resource_kind as ResourceSuggestion['kind'],
      resourceId: String(r.resource_id),
      name: String(r.name ?? 'Unnamed'),
      quantityPerUnit: Number(r.quantity_per_unit ?? 0),
      quantity: Number(r.quantity ?? 0),
      unit: String(r.unit ?? 'LS'),
      unitRate: Number(r.unit_rate ?? 0),
      extendedCost: Number(r.extended_cost ?? 0),
      isOptional: Boolean(r.is_optional),
      alreadyOnLine: Boolean(r.already_on_line),
    }));
  };

/** Returns how many were written, not how many were offered. */
export async function applyResourceSuggestions(
  client: RpcCapable, lineId: string, kinds?: string[],
): Promise<number> {
  return rpc<number>(client, 'apply_line_resource_suggestions', {
    p_line: lineId, p_kinds: kinds ?? null,
  });
}

/**
 * Price this line at a rate instead of building it up.
 *
 * The basis is required by the database and asked for here, because "Sub quote,
 * Delaney Bros, 14 Aug" and "roughly what we got last year" are different
 * numbers and an estimate that cannot tell them apart cannot be reviewed.
 */
export async function setLineUnitCost(
  client: RpcCapable, lineId: string, rate: number, basis: string,
): Promise<void> {
  await rpc(client, 'set_line_unit_cost', {
    p_line: lineId, p_rate: rate, p_basis: basis.trim(),
  });
}

export async function clearLineUnitCost(client: RpcCapable, lineId: string): Promise<void> {
  await rpc(client, 'clear_line_unit_cost', { p_line: lineId });
}

/**
 * Save a typed line into the company's own library.
 *
 * Returns what the library now holds, including whether it is live: somebody
 * with `libraries.approve` saves an approved service, somebody without saves a
 * draft waiting for a reviewer. The screen says which, because "saved" and
 * "saved and everybody can now find it" are different outcomes and the
 * difference is not the estimator's to guess at.
 */
export async function saveLineToLibrary(
  client: RpcCapable,
  input: { lineId: string; category?: string | null; industry?: string | null },
): Promise<{ id: string; code: string; name: string; status: string }> {
  const row = await rpc<{ id: string; code: string; name: string; status: string }>(
    client, 'save_line_to_library', {
      p_line: input.lineId,
      p_category: input.category?.trim() || null,
      p_industry: input.industry?.trim() || null,
    });
  return row;
}

/**
 * Add several lines in one call.
 *
 * One transaction, so a selection of eight is added completely or not at all.
 * Eight separate calls would leave the estimator with five lines and an error,
 * and no way to know which three were missing.
 */
export async function addLines(
  client: RpcCapable,
  input: {
    versionId: string;
    afterLineId?: string | null;
    lines: Array<{ serviceId?: string | null; description?: string | null;
                   quantity?: number; unit?: string | null }>;
  },
): Promise<string[]> {
  const rows = input.lines.map((l) => ({
    service_id: l.serviceId ?? null,
    description: l.description?.trim() || null,
    quantity: l.quantity ?? 0,
    unit: l.unit || null,
  }));
  return rpc<string[]>(client, 'add_estimate_lines', {
    p_version: input.versionId,
    p_lines: rows,
    p_after: input.afterLineId ?? null,
  });
}

/**
 * Take a line off an open estimate.
 *
 * Returns how many rows went, counting anything beneath it, so the screen can
 * say what happened rather than guess. A line accepted from an AI finding
 * returns that finding to `proposed`, so the quantity can be reconsidered
 * instead of being stuck accepted against a row that no longer exists.
 */
export async function deleteLine(
  client: RpcCapable, lineId: string,
): Promise<number> {
  return rpc<number>(client, 'delete_estimate_line', { p_line: lineId });
}

/** Move a line among the lines it sits beside. Null puts it first. */
export async function moveLine(
  client: RpcCapable, lineId: string, afterLineId: string | null,
): Promise<void> {
  await rpc(client, 'move_estimate_line', { p_line: lineId, p_after: afterLineId });
}

export async function setEstimateStatus(
  client: RpcCapable, versionId: string, status: EstimateStatus, reason?: string,
): Promise<void> {
  await rpc(client, 'set_estimate_status', {
    p_version: versionId, p_status: status, p_reason: reason?.trim() || null,
  });
}

/**
 * Copy a frozen version forward as the next one.
 *
 * The only sanctioned way to change an issued estimate. Every refusal that
 * names it says why it exists — the number a bid went out at stays recoverable
 * because the version it went out from is never edited.
 */
export async function reviseVersion(
  client: RpcCapable, versionId: string, reason: string,
): Promise<string> {
  return rpc<string>(client, 'revise_estimate_version', {
    p_version_id: versionId, p_reason: reason.trim(),
  });
}

export async function issueProposal(
  client: RpcCapable,
  input: { versionId: string; title?: string; coverLetter?: string; validityDays?: number },
): Promise<string> {
  return rpc<string>(client, 'issue_proposal', {
    p_version: input.versionId,
    p_title: input.title?.trim() || null,
    p_cover_letter: input.coverLetter?.trim() || null,
    p_validity_days: input.validityDays ?? 30,
  });
}

/**
 * Turn a won bid into a project.
 *
 * `app.award_estimate_version` has done this since migration 0007: it creates
 * the project from the version, copies every priced line into `project_tasks`
 * with its budgeted hours and cost, moves the estimate and the version to
 * `awarded`, and writes an audit event. It had no `public.` wrapper until 0145,
 * so PostgREST could not see it and no screen had ever called it — which is why
 * the Projects page could say "a project appears here when an estimate is
 * awarded" and none ever did.
 *
 * Returns the new project's id, so the caller can open it.
 */
export async function awardVersion(
  client: RpcCapable,
  input: { versionId: string; projectNumber: string; projectName: string },
): Promise<string> {
  return rpc<string>(client, 'award_estimate_version', {
    p_version_id: input.versionId,
    p_project_number: input.projectNumber.trim(),
    p_project_name: input.projectName.trim(),
  });
}

/**
 * The sample estimates, shaped like real ones.
 *
 * Used only when no workspace is configured, and the shell says so on every
 * page. There is deliberately no path from a failed live read to this: a screen
 * that quietly substitutes invented numbers when a query fails is worse than
 * one that says the query failed.
 */
export function demonstrationEstimates(): EstimateRow[] {
  return ESTIMATES.map((e) => ({
    id: e.id,
    number: e.number,
    name: e.name,
    status: e.status as EstimateStatus,
    customerName: e.customer,
    customerId: null,
    bidDueAt: null,
    expiresAt: null,
    expired: false,
    createdAt: e.updatedAt,
    updatedAt: e.updatedAt,
    currentVersionId: null,
    bidPrice: e.value,
    directCost: 0,
    blockedFromIssue: e.blocked,
    confidence: e.confidence || null,
    versionNumber: e.version,
    pricedAt: e.value ? e.updatedAt : null,
  }));
}

/**
 * The cost codes a line may roll up to.
 *
 * Optional, and it was accidentally unreachable: `cost_code_id` has been on the
 * line since migration 0006, `update_estimate_line` never accepted the field,
 * and no screen offered a picker — so the only code a line ever carried was the
 * one it inherited from a library service, chosen by nobody and changeable by
 * no one. Migration 0137 took the field; this is where the list comes from.
 */
export interface CostCodeOption {
  id: string;
  code: string;
  name: string;
  division: string | null;
  /** False for the shipped CSI set, so a picker can say which is which. */
  isOwn: boolean;
}

export const loadCostCodes: Query<CostCodeOption[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_cost_codes')
    .select('id, code, name, division, is_own')
    .order('code')
    .limit(1000)) as Array<Record<string, unknown>>;
  return rows.map((c) => ({
    id: String(c.id),
    code: String(c.code),
    name: String(c.name ?? ''),
    division: (c.division as string | null) ?? null,
    isOwn: Boolean(c.is_own),
  }));
};

export interface LineCondition {
  modifierId: string;
  code: string;
  name: string;
  category: string | null;
  applicationRule: string;
  /** The factors as they stood when applied, not as the library holds them now. */
  appliedFactors: Record<string, number>;
  justification: string;
}

/**
 * The conditions on one line.
 *
 * `estimate_line_modifiers` has existed since migration 0006 and the engine has
 * always read it — `modifiers.combined` multiplies labor, equipment, material,
 * trucking and disposal cost by what comes out. The only writers were the
 * template and revision copiers, so the COND. column rendered `1.0x` as plain
 * text: a number that could never be anything else, on a column that exists to
 * be changed. Migration 0149 is the door.
 */
export const loadLineConditions = (lineId: string): Query<LineCondition[]> => async (client) => {
  const rows = unwrap(await client
    .from('my_line_conditions')
    .select('condition_modifier_id, code, name, category, application_rule, applied_factors, justification')
    .eq('line_item_id', lineId)
    .order('code')) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    modifierId: String(r.condition_modifier_id),
    code: String(r.code),
    name: String(r.name),
    category: (r.category as string | null) ?? null,
    applicationRule: String(r.application_rule ?? ''),
    appliedFactors: (r.applied_factors ?? {}) as Record<string, number>,
    justification: String(r.justification ?? ''),
  }));
};

/**
 * Put a condition on a line, with the reason it applies.
 *
 * The justification is not politeness: a condition multiplies what the work
 * costs, and the table refuses one under ten characters. Asking here means
 * somebody types it once instead of meeting the refusal after choosing.
 */
export async function applyLineCondition(
  client: RpcCapable, lineId: string, modifierId: string, justification: string,
): Promise<void> {
  await rpc(client, 'apply_line_condition', {
    p_line: lineId, p_modifier: modifierId, p_justification: justification.trim(),
  });
}

/** Take one off. A condition applied by mistake is not a revision. */
export async function removeLineCondition(
  client: RpcCapable, lineId: string, modifierId: string,
): Promise<void> {
  await rpc(client, 'remove_line_condition', { p_line: lineId, p_modifier: modifierId });
}
