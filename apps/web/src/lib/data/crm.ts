/**
 * Customers and the pipeline, read from the governed schema.
 *
 * The CRM has shown a fixture since it was built, and that became actively
 * misleading the moment an estimate could name a client: somebody adds Maumee
 * Development on an estimate, opens the CRM, and sees five invented companies
 * that are not theirs and not the one they just added.
 *
 * Lifetime value is counted from awarded estimates rather than stored on the
 * customer. A stored total is wrong from the first award nobody remembered to
 * add to it, and this platform has the awards.
 */
import { unwrap, type Query } from './query';

export interface CustomerRow {
  id: string;
  code: string;
  name: string;
  customerType: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  paymentTerms: string | null;
  /** Counted from awarded estimates, never a stored total that can go stale. */
  awardedValue: number;
  awardedCount: number;
  /** Bids out with them right now. */
  openValue: number;
  openCount: number;
  lastActivityAt: string | null;
}

export interface OpportunityRow {
  id: string;
  number: string;
  name: string;
  customerName: string | null;
  stage: string;
  estimatedValue: number;
  probability: number | null;
  bidDueAt: string | null;
  expectedAwardAt: string | null;
  lossReason: string | null;
  winningCompetitor: string | null;
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const one = <T,>(v: unknown): T | null =>
  (Array.isArray(v) ? (v as T[])[0] : (v as T | null)) ?? null;

/** Statuses where money is still in play with that customer. */
const OPEN = ['draft', 'in_review', 'approved', 'issued'];

/**
 * Every customer, with what they have actually been worth.
 *
 * Two reads rather than a join with aggregates, because PostgREST cannot group
 * — and because the estimates read is the same shape the estimator screen uses,
 * so the two cannot disagree about what "awarded" means.
 */
export const loadCrmCustomers: Query<CustomerRow[]> = async (client) => {
  const [customers, estimates] = await Promise.all([
    client
      .from('customers')
      .select('id, code, name, customer_type, email, phone, city, state_province, payment_terms, updated_at')
      .eq('status', 'active')
      .order('name')
      .limit(500),
    client
      .from('estimates')
      .select('customer_id, status, updated_at, estimate_versions!estimates_current_version_fk(bid_price, total_price)')
      .not('customer_id', 'is', null)
      .limit(1000),
  ]);

  const rows = unwrap(customers) as Array<Record<string, unknown>>;
  const bids = unwrap(estimates) as Array<Record<string, unknown>>;

  const tally = new Map<string, {
    awarded: number; awardedCount: number; open: number; openCount: number; last: string | null;
  }>();
  for (const e of bids) {
    const id = String(e.customer_id);
    const entry = tally.get(id)
      ?? { awarded: 0, awardedCount: 0, open: 0, openCount: 0, last: null };
    const v = one<Record<string, unknown>>(e.estimate_versions);
    const value = num(v?.bid_price) || num(v?.total_price);
    if (e.status === 'awarded') { entry.awarded += value; entry.awardedCount += 1; }
    else if (OPEN.includes(String(e.status))) { entry.open += value; entry.openCount += 1; }
    const at = String(e.updated_at);
    if (!entry.last || at > entry.last) entry.last = at;
    tally.set(id, entry);
  }

  return rows.map((c) => {
    const t = tally.get(String(c.id));
    return {
      id: String(c.id),
      code: String(c.code),
      name: String(c.name),
      customerType: String(c.customer_type ?? 'commercial'),
      email: (c.email as string | null) ?? null,
      phone: (c.phone as string | null) ?? null,
      city: (c.city as string | null) ?? null,
      state: (c.state_province as string | null) ?? null,
      paymentTerms: (c.payment_terms as string | null) ?? null,
      awardedValue: t?.awarded ?? 0,
      awardedCount: t?.awardedCount ?? 0,
      openValue: t?.open ?? 0,
      openCount: t?.openCount ?? 0,
      // The last time anything happened on one of their bids, which is a truer
      // "last activity" than a timestamp on the customer row that only moves
      // when somebody edits their phone number.
      lastActivityAt: t?.last ?? (c.updated_at as string | null) ?? null,
    };
  });
};

export const loadOpportunities: Query<OpportunityRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('opportunities')
    .select('id, number, name, stage, estimated_value, probability, bid_due_at, expected_award_at, loss_reason, winning_competitor, customers(name)')
    .order('bid_due_at', { ascending: true, nullsFirst: false })
    .limit(300)) as Array<Record<string, unknown>>;

  return rows.map((o) => ({
    id: String(o.id),
    number: String(o.number),
    name: String(o.name),
    customerName: one<{ name: string }>(o.customers)?.name ?? null,
    stage: String(o.stage),
    estimatedValue: num(o.estimated_value),
    probability: o.probability == null ? null : Number(o.probability),
    bidDueAt: (o.bid_due_at as string | null) ?? null,
    expectedAwardAt: (o.expected_award_at as string | null) ?? null,
    lossReason: (o.loss_reason as string | null) ?? null,
    winningCompetitor: (o.winning_competitor as string | null) ?? null,
  }));
};

// -----------------------------------------------------------------------------
// Adding a customer
//
// The `Add customer` button on this page was a `<Button>` with no `onClick`,
// and no `create_customer` existed anywhere in the schema. The only code that
// had ever inserted a customer was the lead-conversion path inside migration
// 0065 — so a company could hold customers only by being found through a public
// web form first.
// -----------------------------------------------------------------------------

type RpcCapable = {
  rpc: (fn: string, args: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

const rpc = async (client: RpcCapable, fn: string, args: Record<string, unknown>) => {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data === null || data === undefined ? '' : String(data);
};

/** What a customer can be, in the schema's own words. */
export const CUSTOMER_TYPES = [
  { value: 'commercial', label: 'Commercial' },
  { value: 'residential', label: 'Residential' },
  { value: 'municipal', label: 'Municipal' },
  { value: 'state_dot', label: 'State DOT' },
  { value: 'federal', label: 'Federal' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'developer', label: 'Developer' },
  { value: 'general_contractor', label: 'General contractor' },
] as const;

export interface NewCustomer {
  name: string;
  customerType?: string;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  postalCode?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
}

/**
 * Add a customer.
 *
 * A second record for the same outfit is refused by the database with the code
 * of the one that already exists, so the screen can say "open that one" rather
 * than quietly making the four-records-for-one-contractor mess that every CRM
 * eventually has.
 */
export async function createCustomer(
  client: RpcCapable, companyId: string, input: NewCustomer,
): Promise<string> {
  return rpc(client, 'create_customer', {
    p_company: companyId,
    p_name: input.name.trim(),
    p_customer_type: input.customerType ?? 'commercial',
    p_email: input.email?.trim() || null,
    p_phone: input.phone?.trim() || null,
    p_city: input.city?.trim() || null,
    p_state: input.state?.trim() || null,
    p_address: input.address?.trim() || null,
    p_postal_code: input.postalCode?.trim() || null,
    p_payment_terms: input.paymentTerms?.trim() || null,
    p_notes: input.notes?.trim() || null,
  });
}

/** Correct a customer, or change their terms. */
export async function updateCustomer(
  client: RpcCapable, customerId: string, input: Partial<NewCustomer> & { status?: string },
): Promise<void> {
  await rpc(client, 'update_customer', {
    p_customer: customerId,
    p_name: input.name?.trim() || null,
    p_customer_type: input.customerType ?? null,
    p_email: input.email?.trim() || null,
    p_phone: input.phone?.trim() || null,
    p_city: input.city?.trim() || null,
    p_state: input.state?.trim() || null,
    p_address: input.address?.trim() || null,
    p_postal_code: input.postalCode?.trim() || null,
    p_payment_terms: input.paymentTerms?.trim() || null,
    p_notes: input.notes?.trim() || null,
    p_status: input.status ?? null,
  });
}
