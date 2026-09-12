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
