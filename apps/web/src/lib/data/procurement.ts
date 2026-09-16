/**
 * Entity — what has been asked for, ordered, delivered and held.
 *
 * `procurement.tsx` read `RFQS`, `PURCHASE_ORDERS` and `INVENTORY` from
 * `@/data/finance`. Seven governed tables sat behind it and not one had a
 * reader: `rfqs` and `rfq_responses` (0017), `purchase_orders` and their items,
 * `deliveries`, `inventory_items` and `inventory_transactions`.
 *
 * The governance is already sharp, and the screens should show what it
 * guarantees rather than restate it:
 *
 *   * An awarded RFQ has to name the vendor *and* the reason — `rfqs_award`.
 *     A choice of subcontractor with no stated reason is not a record of a
 *     decision, it is a record of an outcome.
 *   * A delivery that was not accepted has to carry a discrepancy note —
 *     `deliveries_discrepancy`. "Rejected" with no reason tells the vendor
 *     nothing and tells a claim less.
 *   * Inventory cannot reserve more than it holds, and `quantity_available` is
 *     generated from the two so it can never disagree with them.
 *
 * A purchase order carries four running totals — committed, invoiced, received
 * and paid — and the gap between them is the whole question of exposure, so
 * they are read together rather than one at a time.
 */
import { unwrap, type Query } from './query';
import { supabase } from '@/lib/supabase';

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const maybeNum = (v: unknown): number | null =>
  (v === null || v === undefined ? null : Number(v));
const one = <T,>(v: unknown): T | null =>
  (Array.isArray(v) ? (v[0] as T | undefined) ?? null : (v as T | null));

export interface RfqResponseRow {
  id: string;
  vendorName: string;
  quotedAmount: number | null;
  levelingAdjustment: number;
  /**
   * Generated in the database as quoted plus adjustment.
   *
   * Read, never recomputed. The screen adding those two itself is how a page
   * and a database come to hold different opinions about which bid was low.
   */
  leveledAmount: number;
  leadTimeDays: number | null;
  validUntil: string | null;
  status: 'invited' | 'declined' | 'received' | 'leveled' | 'awarded' | 'not_awarded';
  notes: string | null;
}

export interface RfqRow {
  id: string;
  number: string;
  title: string;
  trade: string | null;
  status: 'draft' | 'issued' | 'receiving' | 'leveling' | 'awarded' | 'canceled';
  dueAt: string | null;
  projectNumber: string | null;
  projectId: string | null;
  awardedVendorName: string | null;
  awardReason: string | null;
  /** How many were invited, and how many have actually answered. */
  invited: number;
  responded: number;
  responses: RfqResponseRow[];
  /** The lowest leveled bid among those that answered, or null if none have. */
  lowLeveled: number | null;
}

export const loadRfqs: Query<RfqRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('rfqs')
    .select('id, number, title, trade, status, due_at, award_reason, project_id, '
      + 'projects(number), vendors(name), '
      + 'rfq_responses(id, quoted_amount, leveling_adjustment, leveled_amount, '
      + 'lead_time_days, valid_until, status, notes, vendors(name))')
    .order('number', { ascending: false })) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => {
    const responses = (r.rfq_responses ?? []) as Array<Record<string, unknown>>;
    const answered = responses.filter((x) =>
      x.status === 'received' || x.status === 'leveled' || x.status === 'awarded');
    return {
      id: String(r.id),
      number: String(r.number),
      title: String(r.title),
      trade: (r.trade as string | null) ?? null,
      status: r.status as RfqRow['status'],
      dueAt: (r.due_at as string | null) ?? null,
      projectId: (r.project_id as string | null) ?? null,
      projectNumber: one<{ number: string }>(r.projects)?.number ?? null,
      awardedVendorName: one<{ name: string }>(r.vendors)?.name ?? null,
      awardReason: (r.award_reason as string | null) ?? null,
      invited: responses.length,
      /* Invited and answered are different facts, and the gap is the one that
         decides whether a package is ready to level. */
      responded: answered.length,
      responses: responses.map((x) => ({
        id: String(x.id),
        vendorName: one<{ name: string }>(x.vendors)?.name ?? 'Unnamed vendor',
        quotedAmount: maybeNum(x.quoted_amount),
        levelingAdjustment: num(x.leveling_adjustment),
        leveledAmount: num(x.leveled_amount),
        leadTimeDays: maybeNum(x.lead_time_days),
        validUntil: (x.valid_until as string | null) ?? null,
        status: x.status as RfqResponseRow['status'],
        notes: (x.notes as string | null) ?? null,
      })),
      /*
       * Only bids that actually arrived. A vendor who was invited and has not
       * answered carries a leveled amount of zero from the generated column,
       * and calling that the low bid would award the package to silence.
       */
      lowLeveled: answered.length === 0
        ? null
        : Math.min(...answered.map((x) => num(x.leveled_amount))),
    };
  });
};

export interface PurchaseOrderRow {
  id: string;
  number: string;
  title: string;
  poType: string;
  vendorName: string | null;
  projectNumber: string | null;
  projectId: string | null;
  status: 'draft' | 'issued' | 'partially_received' | 'received' | 'closed' | 'canceled';
  committedAmount: number;
  invoicedAmount: number;
  receivedAmount: number;
  paidAmount: number;
  neededBy: string | null;
  issuedAt: string | null;
  /** Deliveries booked against it, so "partially received" has a number behind it. */
  deliveries: number;
  rejectedDeliveries: number;
}

export const loadPurchaseOrders: Query<PurchaseOrderRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('purchase_orders')
    .select('id, number, title, po_type, status, committed_amount, invoiced_amount, '
      + 'received_amount, paid_amount, needed_by, issued_at, project_id, '
      + 'vendors(name), projects(number), deliveries(id, is_accepted)')
    .order('number', { ascending: false })) as unknown as Array<Record<string, unknown>>;

  return rows.map((p) => {
    const deliveries = (p.deliveries ?? []) as Array<Record<string, unknown>>;
    return {
      id: String(p.id),
      number: String(p.number),
      title: String(p.title),
      poType: String(p.po_type),
      vendorName: one<{ name: string }>(p.vendors)?.name ?? null,
      projectId: (p.project_id as string | null) ?? null,
      projectNumber: one<{ number: string }>(p.projects)?.number ?? null,
      status: p.status as PurchaseOrderRow['status'],
      committedAmount: num(p.committed_amount),
      invoicedAmount: num(p.invoiced_amount),
      receivedAmount: num(p.received_amount),
      paidAmount: num(p.paid_amount),
      neededBy: (p.needed_by as string | null) ?? null,
      issuedAt: (p.issued_at as string | null) ?? null,
      deliveries: deliveries.length,
      rejectedDeliveries: deliveries.filter((d) => d.is_accepted === false).length,
    };
  });
};

export interface InventoryRow {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  unit: string;
  location: string;
  onHand: number;
  reserved: number;
  /** Generated in the database from the two above, so it cannot disagree. */
  available: number;
  reorderPoint: number | null;
  reorderQuantity: number | null;
  unitCost: number;
  /** Whether what is free to use has fallen to where somebody said to reorder. */
  belowReorderPoint: boolean;
}

export const loadInventory: Query<InventoryRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('inventory_items')
    .select('id, sku, name, category, unit, location, quantity_on_hand, quantity_reserved, '
      + 'quantity_available, reorder_point, reorder_quantity, unit_cost')
    .order('name')) as unknown as Array<Record<string, unknown>>;

  return rows.map((i) => {
    const available = num(i.quantity_available);
    const reorderPoint = maybeNum(i.reorder_point);
    return {
      id: String(i.id),
      sku: String(i.sku),
      name: String(i.name),
      category: (i.category as string | null) ?? null,
      unit: String(i.unit),
      location: String(i.location),
      onHand: num(i.quantity_on_hand),
      reserved: num(i.quantity_reserved),
      available,
      reorderPoint,
      reorderQuantity: maybeNum(i.reorder_quantity),
      unitCost: num(i.unit_cost),
      /*
       * Measured against what is *available*, not what is on hand. Stock that
       * is spoken for will not arrive on the next job, so counting it would
       * hide the shortage until somebody went to the yard for it.
       */
      belowReorderPoint: reorderPoint !== null && available <= reorderPoint,
    };
  });
};

// ---------------------------------------------------------------------------
// Buying something, and asking several vendors what it costs
//
// Both header buttons shipped with no handler, so a company could not raise a
// single purchase order — and with none raised, the committed-cost figure that
// makes an overrun visible before the invoice arrives was always zero.
// ---------------------------------------------------------------------------

export interface NewPurchaseOrder {
  vendorId: string;
  title: string;
  poType?: string;
  projectId?: string | null;
}

/** Raise a purchase order in draft. Issuing it is what commits the money. */
export async function createPurchaseOrder(
  companyId: string, order: NewPurchaseOrder,
): Promise<string> {
  if (!supabase) throw new Error('Not connected.');
  const { data, error } = await supabase.rpc('create_purchase_order', {
    p_company: companyId,
    p_vendor: order.vendorId,
    p_title: order.title,
    p_po_type: order.poType ?? 'material',
    p_project_id: order.projectId ?? null,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export interface NewRfq {
  title: string;
  dueAt?: string | null;
  projectId?: string | null;
}

/** Start a request for quotation, in draft. */
export async function createRfq(companyId: string, rfq: NewRfq): Promise<string> {
  if (!supabase) throw new Error('Not connected.');
  const { data, error } = await supabase.rpc('create_rfq', {
    p_company: companyId,
    p_title: rfq.title,
    p_due_at: rfq.dueAt ?? null,
    p_project_id: rfq.projectId ?? null,
  });
  if (error) throw new Error(error.message);
  return String(data);
}


// -----------------------------------------------------------------------------
// The rest of the doors
//
// `create_purchase_order` and `create_rfq` (0162) were the whole write side.
// Nothing could put a line on an order, so every order was worth $0.00 when it
// was issued and the signing limit from 0037 passed for every one of them; and
// nothing could record a vendor's quote, so an RFQ could be sent and nothing
// could come back.
// -----------------------------------------------------------------------------

const rpc = async (fn: string, args: Record<string, unknown>) => {
  if (!supabase) throw new Error('Not connected.');
  const { data, error } = await (supabase as unknown as {
    rpc: (f: string, a: Record<string, unknown>) =>
      PromiseLike<{ data: unknown; error: { message: string } | null }>;
  }).rpc(fn, args);
  if (error) throw new Error(error.message);
  return data === null || data === undefined ? '' : String(data);
};

export interface PoSummaryRow {
  id: string;
  lineCount: number;
  linesOutstanding: number;
  openCommitment: number;
}

/**
 * How many lines each order carries, and how many are still outstanding.
 *
 * Read from `my_purchase_orders`, where the committed figure is the sum of the
 * lines recomputed by trigger — the number the signing limit in 0037 is checked
 * against. The page shows the count so an order with nothing on it is visible
 * before somebody tries to issue it.
 */
export const loadPurchaseOrderSummaries: Query<PoSummaryRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_purchase_orders')
    .select('id, line_count, lines_outstanding, open_commitment')) as unknown as
      Array<Record<string, unknown>>;
  return rows.map((p) => ({
    id: String(p.id),
    lineCount: Number(p.line_count ?? 0),
    linesOutstanding: Number(p.lines_outstanding ?? 0),
    openCommitment: Number(p.open_commitment ?? 0),
  }));
};

export interface PoItemRow {
  id: string;
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  extended: number;
  quantityReceived: number;
  quantityOutstanding: number;
  materialName: string | null;
  costCode: string | null;
}

/** The lines on an order, and how much of each has arrived. */
export const loadPurchaseOrderItems = (purchaseOrderId: string): Query<PoItemRow[]> =>
  async (client) => {
    if (!purchaseOrderId) return [];
    const rows = unwrap(await client
      .from('my_purchase_order_items')
      .select('id, description, quantity, unit, unit_price, extended, '
        + 'quantity_received, quantity_outstanding, material_name, cost_code')
      .eq('purchase_order_id', purchaseOrderId)
      .order('sort_order')) as unknown as Array<Record<string, unknown>>;
    return rows.map((i) => ({
      id: String(i.id),
      description: String(i.description),
      quantity: Number(i.quantity ?? 0),
      unit: (i.unit as string | null) ?? null,
      unitPrice: Number(i.unit_price ?? 0),
      extended: Number(i.extended ?? 0),
      quantityReceived: Number(i.quantity_received ?? 0),
      quantityOutstanding: Number(i.quantity_outstanding ?? 0),
      materialName: (i.material_name as string | null) ?? null,
      costCode: (i.cost_code as string | null) ?? null,
    }));
  };

/** Put a line on a draft order. Refused once the vendor holds it. */
export async function addPurchaseOrderItem(input: {
  purchaseOrderId: string; description: string; quantity: number; unitPrice: number;
  unit?: string | null; materialId?: string | null; costCodeId?: string | null;
}): Promise<string> {
  return rpc('add_purchase_order_item', {
    p_purchase_order: input.purchaseOrderId,
    p_description: input.description.trim(),
    p_quantity: input.quantity,
    p_unit_price: input.unitPrice,
    p_unit: input.unit ?? null,
    p_material: input.materialId ?? null,
    p_cost_code: input.costCodeId ?? null,
  });
}

/** Take a line off a draft order. The committed amount falls with it. */
export async function removePurchaseOrderItem(itemId: string): Promise<void> {
  await rpc('remove_purchase_order_item', { p_item: itemId });
}

/**
 * Issue a draft order.
 *
 * Where the signing limit from 0037 is checked — and where it means something,
 * now that the order is worth the sum of its lines.
 */
export async function issuePurchaseOrder(purchaseOrderId: string): Promise<void> {
  await rpc('issue_purchase_order', { p_purchase_order: purchaseOrderId });
}

/** Record what actually arrived. The order's status follows its lines. */
export async function receivePurchaseOrderItem(
  itemId: string, quantity: number, receivedOn?: string | null,
): Promise<void> {
  await rpc('receive_purchase_order_item', {
    p_item: itemId, p_quantity: quantity, p_received_on: receivedOn || null,
  });
}

export interface RfqQuoteRow {
  id: string;
  vendorId: string;
  vendorName: string;
  quotedAmount: number | null;
  levelingAdjustment: number;
  /** Quote plus adjustment — what two quotes of different scope compare on. */
  leveledAmount: number | null;
  leadTimeDays: number | null;
  validUntil: string | null;
  inclusions: string | null;
  exclusions: string | null;
  status: string;
  leveledRank: number | null;
  isExpired: boolean;
}

/** Quotes against an RFQ, ranked on the leveled figure. */
export const loadRfqResponses = (rfqId: string): Query<RfqQuoteRow[]> =>
  async (client) => {
    if (!rfqId) return [];
    const rows = unwrap(await client
      .from('my_rfq_responses')
      .select('id, vendor_id, vendor_name, quoted_amount, leveling_adjustment, '
        + 'leveled_amount, lead_time_days, valid_until, inclusions, exclusions, '
        + 'status, leveled_rank, is_expired')
      .eq('rfq_id', rfqId)
      .order('leveled_rank', { nullsFirst: false })) as unknown as
        Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      vendorId: String(r.vendor_id),
      vendorName: String(r.vendor_name),
      quotedAmount: r.quoted_amount == null ? null : Number(r.quoted_amount),
      levelingAdjustment: Number(r.leveling_adjustment ?? 0),
      leveledAmount: r.leveled_amount == null ? null : Number(r.leveled_amount),
      leadTimeDays: r.lead_time_days == null ? null : Number(r.lead_time_days),
      validUntil: (r.valid_until as string | null) ?? null,
      inclusions: (r.inclusions as string | null) ?? null,
      exclusions: (r.exclusions as string | null) ?? null,
      status: String(r.status),
      leveledRank: r.leveled_rank == null ? null : Number(r.leveled_rank),
      isExpired: r.is_expired === true,
    }));
  };

/**
 * Record what a vendor quoted.
 *
 * The leveling adjustment is stored beside the quote rather than folded into
 * it, so the quote stays what the vendor actually said and the comparison stays
 * what the estimator decided — two facts, not one edited number.
 */
export async function recordRfqResponse(input: {
  rfqId: string; vendorId: string; quotedAmount?: number | null;
  leadTimeDays?: number | null; validUntil?: string | null;
  inclusions?: string | null; exclusions?: string | null;
  levelingAdjustment?: number; declined?: boolean; notes?: string | null;
}): Promise<string> {
  return rpc('record_rfq_response', {
    p_rfq: input.rfqId,
    p_vendor: input.vendorId,
    p_quoted_amount: input.quotedAmount ?? null,
    p_lead_time_days: input.leadTimeDays ?? null,
    p_valid_until: input.validUntil || null,
    p_inclusions: input.inclusions?.trim() || null,
    p_exclusions: input.exclusions?.trim() || null,
    p_leveling_adjustment: input.levelingAdjustment ?? 0,
    p_declined: input.declined ?? false,
    p_notes: input.notes?.trim() || null,
  });
}

/** Award an RFQ. The reason is required, and it is the one asked about later. */
export async function awardRfq(
  rfqId: string, vendorId: string, reason: string,
): Promise<void> {
  await rpc('award_rfq', { p_rfq: rfqId, p_vendor: vendorId, p_reason: reason.trim() });
}
