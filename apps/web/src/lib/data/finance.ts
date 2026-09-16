/**
 * Finance: the pay application, work in progress, payables and cash.
 *
 * Three of these read governed views rather than recomputing anything, which is
 * the point. `reporting_wip` earns revenue on cost-to-cost and returns null
 * where a project has no budget to divide by; `reporting_cash_forecast` buckets
 * real receivables and real payables by month and keeps the amounts whose
 * timing is unknown in a bucket of their own. Both arrived in migration 0057,
 * written because this screen previously did the arithmetic itself — and, for
 * two of the three months on its cash chart, did not do arithmetic at all.
 *
 * The demonstration equivalents carry the same shapes, including the null
 * cases, so the empty and unknown states are exercised without a workspace.
 */
import { unwrap, type Query } from './query';

/** Anything that can make an RPC — the live client, or a test double. */
type RpcCapable = {
  rpc: (fn: string, args: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: { message: string } | null }>;
};
import {
  SCHEDULE_OF_VALUES, PAY_APPLICATIONS, WIP, AP_INVOICES, RETAINAGE_PERCENT,
  payApplicationTotals, PROJECT,
} from '@/data/finance';
import { localDay } from '@/lib/format';
import { supabase } from '@/lib/supabase';

const one = <T,>(v: unknown): T | null =>
  (Array.isArray(v) ? (v as T[])[0] : (v as T | null)) ?? null;

// ---------------------------------------------------------------------------
// The pay application
// ---------------------------------------------------------------------------
export interface PayAppLine {
  id: string; itemNumber: string; description: string; scheduledValue: number;
  previousCompleted: number; thisPeriod: number; storedMaterials: number;
  completedToDate: number;
}

export interface PayApp {
  id: string; number: number; projectId: string | null; projectNumber: string;
  periodStart: string; periodEnd: string;
  contractSum: number; approvedChanges: number; contractSumToDate: number;
  completedToDate: number; storedMaterials: number; totalEarned: number;
  retainagePercent: number; retainageToDate: number;
  previousPayments: number; currentDue: number;
  status: string; paidAt: string | null; amountPaid: number;
  lines: PayAppLine[];
}

const payAppFrom = (r: Record<string, unknown>): PayApp => ({
  id: String(r.id),
  number: Number(r.application_number),
  projectId: (r.project_id as string | null) ?? null,
  projectNumber: one<{ number: string }>(r.projects)?.number ?? '—',
  periodStart: String(r.period_start),
  periodEnd: String(r.period_end),
  contractSum: Number(r.contract_sum ?? 0),
  approvedChanges: Number(r.approved_changes ?? 0),
  contractSumToDate: Number(r.contract_sum_to_date ?? 0),
  completedToDate: Number(r.completed_to_date ?? 0),
  storedMaterials: Number(r.stored_materials ?? 0),
  totalEarned: Number(r.total_earned ?? 0),
  retainagePercent: Number(r.retainage_percent ?? 0),
  retainageToDate: Number(r.retainage_to_date ?? 0),
  previousPayments: Number(r.previous_payments ?? 0),
  currentDue: Number(r.current_due ?? 0),
  status: String(r.status),
  paidAt: (r.paid_at as string | null) ?? null,
  amountPaid: Number(r.amount_paid ?? 0),
  lines: ((r.pay_application_lines as Array<Record<string, unknown>> | null) ?? [])
    .map((l) => ({
      id: String(l.id),
      itemNumber: String(l.item_number),
      description: String(l.description),
      scheduledValue: Number(l.scheduled_value ?? 0),
      previousCompleted: Number(l.previous_completed ?? 0),
      thisPeriod: Number(l.this_period ?? 0),
      storedMaterials: Number(l.stored_materials ?? 0),
      completedToDate: Number(l.completed_to_date ?? 0),
    }))
    .sort((a, b) => a.itemNumber.localeCompare(b.itemNumber)),
});

export const loadPayApplications: Query<PayApp[]> = async (client) => {
  const rows = unwrap(await client
    .from('pay_applications')
    .select('id, project_id, application_number, period_start, period_end, contract_sum, approved_changes, contract_sum_to_date, completed_to_date, stored_materials, total_earned, retainage_percent, retainage_to_date, previous_payments, current_due, status, paid_at, amount_paid, projects(number), pay_application_lines(id, item_number, description, scheduled_value, previous_completed, this_period, stored_materials, completed_to_date)')
    .order('period_end', { ascending: false })
    .limit(50)) as Array<Record<string, unknown>>;
  return rows.map(payAppFrom);
};

// ---------------------------------------------------------------------------
// Work in progress
// ---------------------------------------------------------------------------
export interface WipView {
  projectId: string; projectNumber: string; projectName: string;
  contractValue: number; approvedBudget: number; actualCost: number;
  billedToDate: number;
  /**
   * Cost incurred over approved budget, uncapped. Above 1 means the job has
   * spent more than it was budgeted, which is a thing worth seeing.
   */
  costRatio: number | null;
  /** The same ratio capped at 1, because you cannot earn past the contract. */
  percentComplete: number | null;
  earnedRevenue: number | null;
  /** Positive is over billed, negative is under billed. Null with no budget. */
  overUnderBilled: number | null;
  earnedMargin: number | null;
}

export const loadWip: Query<WipView[]> = async (client) => {
  const rows = unwrap(await client
    .from('reporting_wip')
    .select('project_id, project_number, project_name, contract_value, approved_budget, actual_cost, billed_to_date, cost_ratio, percent_complete, earned_revenue, over_under_billed, earned_margin')
    .order('contract_value', { ascending: false })) as Array<Record<string, unknown>>;
  const num = (v: unknown) => (v == null ? null : Number(v));
  return rows.map((w) => ({
    projectId: String(w.project_id),
    projectNumber: String(w.project_number),
    projectName: String(w.project_name),
    contractValue: Number(w.contract_value ?? 0),
    approvedBudget: Number(w.approved_budget ?? 0),
    actualCost: Number(w.actual_cost ?? 0),
    billedToDate: Number(w.billed_to_date ?? 0),
    costRatio: num(w.cost_ratio),
    percentComplete: num(w.percent_complete),
    earnedRevenue: num(w.earned_revenue),
    overUnderBilled: num(w.over_under_billed),
    earnedMargin: num(w.earned_margin),
  }));
};

// ---------------------------------------------------------------------------
// Payables
// ---------------------------------------------------------------------------
export interface ApInvoiceRow {
  id: string; vendor: string; invoiceNumber: string; invoiceDate: string;
  dueDate: string | null; po: string | null; project: string | null;
  amount: number; tax: number; retainageWithheld: number; amountPaid: number;
  matchStatus: string; status: string;
  vendorId: string; purchaseOrderId: string | null; projectId: string | null;
  balanceDue: number;
  /** Why it cannot be paid, in words, or null when it can. From the view. */
  matchProblem: string | null;
  daysOverdue: number | null;
  /** The same rule the database enforces as a constraint, read back out. */
  blocked: boolean;
}

export const loadPayables: Query<ApInvoiceRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_ap_invoices')
    .select('id, vendor_id, purchase_order_id, project_id, invoice_number, invoice_date, '
      + 'due_date, amount, tax, retainage_withheld, amount_paid, match_status, status, '
      + 'vendor_name, purchase_order_number, project_number, balance_due, payable, '
      + 'match_problem, days_overdue')
    .order('invoice_date', { ascending: false })
    .limit(200)) as unknown as Array<Record<string, unknown>>;
  return rows.map((i) => ({
    id: String(i.id),
    vendorId: String(i.vendor_id),
    purchaseOrderId: (i.purchase_order_id as string | null) ?? null,
    projectId: (i.project_id as string | null) ?? null,
    vendor: String(i.vendor_name),
    invoiceNumber: String(i.invoice_number),
    invoiceDate: String(i.invoice_date),
    dueDate: (i.due_date as string | null) ?? null,
    po: (i.purchase_order_number as string | null) ?? null,
    project: (i.project_number as string | null) ?? null,
    amount: Number(i.amount ?? 0),
    tax: Number(i.tax ?? 0),
    retainageWithheld: Number(i.retainage_withheld ?? 0),
    amountPaid: Number(i.amount_paid ?? 0),
    balanceDue: Number(i.balance_due ?? 0),
    matchStatus: String(i.match_status),
    status: String(i.status),
    /*
     * Said by the view rather than decided again here. The old version derived
     * this from its own copy of the rule; two opinions about which invoices may
     * be paid is one opinion too many.
     */
    matchProblem: (i.match_problem as string | null) ?? null,
    daysOverdue: i.days_overdue === null || i.days_overdue === undefined
      ? null : Number(i.days_overdue),
    blocked: i.payable !== true && String(i.status) !== 'paid',
  }));
};

// ---------------------------------------------------------------------------
// The schedule of values — what the bill is measured against
// ---------------------------------------------------------------------------
export interface SovItem {
  id: string;
  projectId: string;
  projectNumber: string;
  itemNumber: string;
  description: string;
  scheduledValue: number;
  billingBasis: string;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  costCode: string | null;
  billedToDate: number;
  /** Whether it came off the estimate, or was typed in afterwards. */
  fromTheEstimate: boolean;
  sortOrder: number;
}

export const loadScheduleOfValues = (projectId: string): Query<SovItem[]> =>
  async (client) => {
    if (!projectId) return [];
    const rows = unwrap(await client
      .from('my_schedule_of_values')
      .select('id, project_id, project_number, item_number, description, scheduled_value, '
        + 'billing_basis, quantity, unit, unit_price, cost_code, billed_to_date, '
        + 'from_the_estimate, sort_order')
      .eq('project_id', projectId)
      .order('sort_order')) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      projectNumber: String(r.project_number),
      itemNumber: String(r.item_number),
      description: String(r.description),
      scheduledValue: Number(r.scheduled_value ?? 0),
      billingBasis: String(r.billing_basis),
      quantity: r.quantity === null || r.quantity === undefined ? null : Number(r.quantity),
      unit: (r.unit as string | null) ?? null,
      unitPrice: r.unit_price === null || r.unit_price === undefined
        ? null : Number(r.unit_price),
      costCode: (r.cost_code as string | null) ?? null,
      billedToDate: Number(r.billed_to_date ?? 0),
      fromTheEstimate: r.from_the_estimate === true,
      sortOrder: Number(r.sort_order ?? 0),
    }));
  };

export interface PayAppLineRow extends PayAppLine {
  payApplicationId: string;
  sovId: string | null;
  percentComplete: number | null;
  retainage: number;
  balanceToFinish: number;
  applicationStatus: string;
  sortOrder: number;
}

/** One application's lines, read back after every change rather than guessed. */
export const loadPayApplicationLines = (applicationId: string): Query<PayAppLineRow[]> =>
  async (client) => {
    if (!applicationId) return [];
    const rows = unwrap(await client
      .from('my_pay_application_lines')
      .select('id, pay_application_id, sov_id, item_number, description, scheduled_value, '
        + 'previous_completed, this_period, stored_materials, completed_to_date, '
        + 'percent_complete, retainage, balance_to_finish, application_status, sort_order')
      .eq('pay_application_id', applicationId)
      .order('sort_order')) as unknown as Array<Record<string, unknown>>;
    return rows.map((l) => ({
      id: String(l.id),
      payApplicationId: String(l.pay_application_id),
      sovId: (l.sov_id as string | null) ?? null,
      itemNumber: String(l.item_number),
      description: String(l.description),
      scheduledValue: Number(l.scheduled_value ?? 0),
      previousCompleted: Number(l.previous_completed ?? 0),
      thisPeriod: Number(l.this_period ?? 0),
      storedMaterials: Number(l.stored_materials ?? 0),
      completedToDate: Number(l.completed_to_date ?? 0),
      percentComplete: l.percent_complete === null || l.percent_complete === undefined
        ? null : Number(l.percent_complete),
      retainage: Number(l.retainage ?? 0),
      balanceToFinish: Number(l.balance_to_finish ?? 0),
      applicationStatus: String(l.application_status),
      sortOrder: Number(l.sort_order ?? 0),
    }));
  };

// ---------------------------------------------------------------------------
// Cash
// ---------------------------------------------------------------------------
export interface CashMonth {
  /** Null is the unscheduled bucket: real money, unknown timing. */
  month: string | null;
  inflow: number; outflow: number; outflowBlocked: number; net: number;
  receivableCount: number; payableCount: number;
}

export const loadCashForecast: Query<CashMonth[]> = async (client) => {
  const rows = unwrap(await client
    .from('reporting_cash_forecast')
    .select('month, inflow, outflow, outflow_blocked, net, receivable_count, payable_count')
    .order('month', { ascending: true, nullsFirst: false })) as Array<Record<string, unknown>>;
  return rows.map((m) => ({
    month: (m.month as string | null) ?? null,
    inflow: Number(m.inflow ?? 0),
    outflow: Number(m.outflow ?? 0),
    outflowBlocked: Number(m.outflow_blocked ?? 0),
    net: Number(m.net ?? 0),
    receivableCount: Number(m.receivable_count ?? 0),
    payableCount: Number(m.payable_count ?? 0),
  }));
};

// ---------------------------------------------------------------------------
// Demonstration equivalents
// ---------------------------------------------------------------------------
export const demonstrationPayApplications = (): PayApp[] => {
  const t = payApplicationTotals();
  return PAY_APPLICATIONS.map((p) => ({
    id: p.id, number: p.number, projectId: null, projectNumber: PROJECT.number,
    periodStart: p.periodStart, periodEnd: p.periodEnd,
    contractSum: t.scheduled, approvedChanges: t.approvedChanges,
    contractSumToDate: t.scheduled + t.approvedChanges,
    completedToDate: p.status === 'draft' ? t.completedToDate : p.totalEarned,
    storedMaterials: p.status === 'draft' ? t.stored : 0,
    totalEarned: p.totalEarned,
    retainagePercent: RETAINAGE_PERCENT, retainageToDate: p.retainage,
    previousPayments: p.status === 'draft' ? t.previousPayments : 0,
    currentDue: p.currentDue, status: p.status,
    paidAt: p.paidAt ?? null, amountPaid: p.amountPaid,
    lines: p.status !== 'draft' ? [] : SCHEDULE_OF_VALUES.map((s) => ({
      id: s.id, itemNumber: s.itemNumber, description: s.description,
      scheduledValue: s.scheduledValue, previousCompleted: s.previousCompleted,
      thisPeriod: s.thisPeriod, storedMaterials: s.storedMaterials,
      completedToDate: s.previousCompleted + s.thisPeriod + s.storedMaterials,
    })),
  }));
};

export const demonstrationWip = (): WipView[] =>
  WIP.map((w) => {
    // Cost-to-cost, computed the way the view computes it, so the sample and a
    // real workspace agree about what the column means.
    const ratio = w.budget > 0 ? w.actualCost / w.budget : null;
    const capped = ratio == null ? null : Math.min(ratio, 1);
    const earned = capped == null ? null : w.contract * capped;
    return {
      projectId: w.project, projectNumber: w.project, projectName: w.name,
      contractValue: w.contract, approvedBudget: w.budget, actualCost: w.actualCost,
      billedToDate: w.billedToDate,
      costRatio: ratio, percentComplete: capped, earnedRevenue: earned,
      overUnderBilled: earned == null ? null : w.billedToDate - earned,
      earnedMargin: earned && earned > 0 ? (earned - w.actualCost) / earned : null,
    };
  });

const MATCH_PROBLEM: Record<string, string> = {
  quantity_variance: 'Billing for more than has been received',
  price_variance: 'Billing a different price than was ordered',
  unmatched: 'Not matched to its order',
};

export const demonstrationPayables = (): ApInvoiceRow[] =>
  AP_INVOICES.map((i) => ({
    id: i.id, vendorId: `vendor-${i.id}`, purchaseOrderId: null, projectId: null,
    vendor: i.vendor, invoiceNumber: i.invoiceNumber,
    invoiceDate: i.invoiceDate, dueDate: i.dueDate, po: i.po ?? null,
    project: null, amount: i.amount, tax: 0,
    retainageWithheld: i.retainageWithheld, amountPaid: i.amountPaid,
    balanceDue: i.amount - i.retainageWithheld - i.amountPaid,
    matchStatus: i.matchStatus, status: i.status,
    matchProblem: MATCH_PROBLEM[i.matchStatus] ?? null,
    daysOverdue: i.dueDate
      ? Math.round((Date.now() - new Date(`${i.dueDate}T12:00:00`).getTime()) / 86_400_000)
      : null,
    blocked: !['matched', 'no_po'].includes(i.matchStatus) && i.status !== 'paid',
  }));

/**
 * The sample cash forecast, built from the sample payables and the sample
 * application — not from two months somebody typed.
 *
 * The unscheduled bucket is populated on purpose: the sample AP list carries an
 * invoice with no due date, which is the case the real view exists to report
 * honestly, and a demonstration that never shows it would hide the feature.
 */
export const demonstrationCashForecast = (): CashMonth[] => {
  const t = payApplicationTotals();
  const buckets = new Map<string | null, CashMonth>();
  const bucket = (month: string | null) => {
    let b = buckets.get(month);
    if (!b) {
      b = { month, inflow: 0, outflow: 0, outflowBlocked: 0, net: 0, receivableCount: 0, payableCount: 0 };
      buckets.set(month, b);
    }
    return b;
  };
  const monthOf = (iso: string) => `${iso.slice(0, 7)}-01`;

  // One receivable: the draft application, dated net 30 from its period end.
  const due = new Date(`${PAY_APPLICATIONS[0]!.periodEnd}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + 30);
  const inb = bucket(monthOf(localDay(due)));
  inb.inflow += t.currentDue;
  inb.receivableCount += 1;

  for (const i of demonstrationPayables()) {
    if (['paid', 'void'].includes(i.status)) continue;
    const open = i.amount - i.retainageWithheld - i.amountPaid;
    if (open <= 0) continue;
    const b = bucket(i.dueDate ? monthOf(i.dueDate) : null);
    if (i.blocked) b.outflowBlocked += open; else b.outflow += open;
    b.payableCount += 1;
  }

  for (const b of buckets.values()) b.net = b.inflow - b.outflow;
  return [...buckets.values()].sort((a, b) =>
    a.month == null ? 1 : b.month == null ? -1 : a.month.localeCompare(b.month));
};

export interface FinancialPeriod {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  status: 'open' | 'closed';
  closedAt: string | null;
  closedBy: string | null;
  /** Pay applications inside it that are still moving. */
  openPayApplications: number;
}

/**
 * The accounting periods, and what is still open inside each.
 *
 * `financial_periods` and `app.enforce_open_period` have existed since
 * migration 0034 — a posting into a closed period is refused, and so is moving
 * one out of a closed period — and nothing in the application has ever read the
 * table. A company running a month-end close had the machinery and no way to
 * see or operate it.
 *
 * The count of open pay applications is read alongside because it is the thing
 * that will refuse the close: a period shut over a draft produces a total that
 * is going to move, which is the one thing closing is for.
 */
export const loadFinancialPeriods: Query<FinancialPeriod[]> = async (client) => {
  const rows = unwrap(await client
    .from('financial_periods')
    .select('id, name, period_start, period_end, status, closed_at, closed_by')
    .order('period_start', { ascending: false })
    .limit(24)) as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  /*
   * One read for every period rather than one per period. `pay_applications`
   * carries the period it falls in as dates rather than a foreign key, so the
   * overlap is decided here — and it is decided the same way
   * `app.close_financial_period` decides it, by `period_end` falling inside.
   */
  const open = unwrap(await client
    .from('pay_applications')
    .select('period_end, status')
    .in('status', ['draft', 'submitted'])) as Array<Record<string, unknown>>;

  return rows.map((p) => {
    const start = String(p.period_start);
    const end = String(p.period_end);
    return {
      id: String(p.id),
      name: String(p.name),
      periodStart: start,
      periodEnd: end,
      status: p.status === 'closed' ? 'closed' : 'open',
      closedAt: (p.closed_at as string | null) ?? null,
      closedBy: (p.closed_by as string | null) ?? null,
      openPayApplications: open.filter((a) => {
        const at = String(a.period_end);
        return at >= start && at <= end;
      }).length,
    };
  });
};

/**
 * Close a period, after the database checks nothing inside it is still open.
 *
 * `app.close_financial_period` has existed since 0034 and had no `public.`
 * wrapper until 0147, so no browser could call it. The check it carries is the
 * reason it is a function rather than an UPDATE: a close that silently leaves a
 * draft pay application inside produces a period total that is still going to
 * change.
 */
export async function closeFinancialPeriod(
  client: RpcCapable, periodId: string, note?: string,
): Promise<void> {
  const { error } = await client.rpc('close_financial_period', {
    p_period: periodId, p_note: note?.trim() ? note.trim() : null,
  });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Asking to be paid, and handing the ledger to accounting
//
// "Pay application" had no handler, and "Export to accounting" had none either
// — though `record_export` has existed and been tested since 0043 and nothing
// in the application ever called it. The same defect twice on one screen.
// ---------------------------------------------------------------------------

/**
 * Open the next pay application on a project.
 *
 * No company is passed and no contract sum: both are read off the project in
 * the database. That figure is what the whole application is measured against,
 * and a browser that could name it could ask to be paid against a contract that
 * does not exist.
 */
export async function createPayApplication(
  projectId: string, periodStart: string, periodEnd: string,
): Promise<string> {
  if (!supabase) throw new Error('Not connected.');
  const { data, error } = await supabase.rpc('create_pay_application', {
    p_project: projectId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

/**
 * Submit a draft pay application.
 *
 * Leaving draft is what freezes it, so this is the last moment its figures can
 * change. Nothing is passed but the id: what was completed, what is stored and
 * what is held as retainage are the claim being made, and a call that adjusted
 * them on the way out would be submitting something other than what was read.
 */
export async function submitPayApplication(applicationId: string): Promise<void> {
  if (!supabase) throw new Error('Not connected.');
  const { error } = await supabase.rpc('submit_pay_application', {
    p_application: applicationId,
  });
  if (error) throw new Error(error.message);
}

/* ---------------------------------------------------------------------------
 * Writers — migration 0196
 *
 * Before it, Finance had exactly one: `create_pay_application` opened a header.
 * The schedule of values the bill is measured against had no writer at all, and
 * neither did the lines, so an application could be opened and submitted and
 * never filled in.
 *
 * Nothing below sends a total. Completed to date, stored materials, retainage,
 * previous payments and the amount due are recomputed by the database from the
 * lines and from what earlier applications were actually paid — every one of
 * them a figure somebody would otherwise retype off last month's paperwork.
 * ------------------------------------------------------------------------- */

const rpc = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
  if (!supabase) throw new Error('Not connected.');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
};

/** Build the billing schedule from the estimate the project was awarded on. */
export async function buildSovFromEstimate(projectId: string): Promise<number> {
  return Number(await rpc('build_sov_from_estimate', { p_project: projectId }));
}

export async function addSovItem(projectId: string, item: {
  itemNumber: string; description: string; scheduledValue: number;
  billingBasis?: string; quantity?: number | null; unit?: string | null;
  unitPrice?: number | null; costCodeId?: string | null;
}): Promise<string> {
  return String(await rpc('add_sov_item', {
    p_project: projectId,
    p_item_number: item.itemNumber.trim(),
    p_description: item.description.trim(),
    p_scheduled_value: item.scheduledValue,
    p_billing_basis: item.billingBasis ?? 'lump_sum',
    p_quantity: item.quantity ?? null,
    p_unit: item.unit ?? null,
    p_unit_price: item.unitPrice ?? null,
    p_cost_code: item.costCodeId ?? null,
  }));
}

export async function updateSovItem(itemId: string, changes: Partial<{
  itemNumber: string; description: string; scheduledValue: number;
  billingBasis: string; quantity: number; unit: string; unitPrice: number;
}>): Promise<void> {
  await rpc('update_sov_item', {
    p_item: itemId,
    p_item_number: changes.itemNumber ?? null,
    p_description: changes.description ?? null,
    p_scheduled_value: changes.scheduledValue ?? null,
    p_billing_basis: changes.billingBasis ?? null,
    p_quantity: changes.quantity ?? null,
    p_unit: changes.unit ?? null,
    p_unit_price: changes.unitPrice ?? null,
  });
}

export async function removeSovItem(itemId: string): Promise<void> {
  await rpc('remove_sov_item', { p_item: itemId });
}

/** Fill an application with one line per billing item. */
export async function buildPayApplicationLines(applicationId: string): Promise<number> {
  return Number(await rpc('build_pay_application_lines', { p_application: applicationId }));
}

/**
 * Bill a line, by amount or by percent.
 *
 * Never both: two figures that can disagree is one figure too many, and the
 * database refuses the pair rather than picking one.
 */
export async function setPayApplicationLine(lineId: string, billed: {
  thisPeriod?: number | null; percentComplete?: number | null; storedMaterials?: number | null;
}): Promise<void> {
  await rpc('set_pay_application_line', {
    p_line: lineId,
    p_this_period: billed.thisPeriod ?? null,
    p_percent_complete: billed.percentComplete ?? null,
    p_stored_materials: billed.storedMaterials ?? null,
  });
}

export async function removePayApplicationLine(lineId: string): Promise<void> {
  await rpc('remove_pay_application_line', { p_line: lineId });
}

export async function approvePayApplication(applicationId: string): Promise<void> {
  await rpc('approve_pay_application', { p_application: applicationId });
}

export async function rejectPayApplication(
  applicationId: string, reason: string,
): Promise<void> {
  await rpc('reject_pay_application', { p_application: applicationId, p_reason: reason });
}

/** Money arrived. The status follows the arithmetic rather than being chosen. */
export async function recordPayApplicationPayment(
  applicationId: string, amount: number, receivedOn?: string,
): Promise<void> {
  await rpc('record_pay_application_payment', {
    p_application: applicationId,
    p_amount: amount,
    p_received_on: receivedOn ?? new Date().toISOString().slice(0, 10),
  });
}

export async function recordApInvoice(companyId: string, invoice: {
  vendorId: string; invoiceNumber: string; invoiceDate: string; amount: number;
  tax?: number; dueDate?: string | null; purchaseOrderId?: string | null;
  projectId?: string | null; retainageWithheld?: number;
}): Promise<string> {
  return String(await rpc('record_ap_invoice', {
    p_company: companyId,
    p_vendor: invoice.vendorId,
    p_invoice_number: invoice.invoiceNumber.trim(),
    p_invoice_date: invoice.invoiceDate,
    p_amount: invoice.amount,
    p_tax: invoice.tax ?? 0,
    p_due_date: invoice.dueDate || null,
    p_purchase_order: invoice.purchaseOrderId ?? null,
    p_project: invoice.projectId ?? null,
    p_retainage_withheld: invoice.retainageWithheld ?? 0,
  }));
}

/** Re-run the three-way match, after a receipt or a corrected order. */
export async function rematchApInvoice(invoiceId: string): Promise<string> {
  return String(await rpc('rematch_ap_invoice', { p_invoice: invoiceId }));
}

export async function approveApInvoice(invoiceId: string): Promise<void> {
  await rpc('approve_ap_invoice', { p_invoice: invoiceId });
}

export async function setApInvoiceStatus(invoiceId: string, status: string): Promise<void> {
  await rpc('set_ap_invoice_status', { p_invoice: invoiceId, p_status: status });
}

/**
 * Pay a vendor.
 *
 * Refused while the invoice fails its three-way match — the control that stops
 * a company paying for materials it never received. The refusal names which of
 * the three disagrees rather than naming a constraint.
 */
export async function recordApPayment(
  invoiceId: string, amount: number, paidOn?: string,
): Promise<void> {
  await rpc('record_ap_payment', {
    p_invoice: invoiceId,
    p_amount: amount,
    p_paid_on: paidOn ?? new Date().toISOString().slice(0, 10),
  });
}

/* ---------------------------------------------------------------------------
 * The item grain behind the cash forecast
 *
 * `reporting_cash_flow_items` had no reader anywhere, while the cash tab said
 * in its own comment that "bucketing by month is as fine as the view goes; a
 * tighter window would need the item grain". The item grain existed. It is
 * every receivable and payable the forecast is made of, with the reason a
 * payable is blocked carried on the row.
 * ------------------------------------------------------------------------- */

export interface CashFlowItem {
  projectId: string | null;
  /** `in` is money coming, `out` is money going. */
  direction: string;
  source: string;
  sourceId: string;
  reference: string;
  counterparty: string | null;
  amount: number;
  dueOn: string | null;
  /** True where the money cannot move yet — an invoice that fails its match. */
  blocked: boolean;
  blockedReason: string | null;
}

export const loadCashFlowItems: Query<CashFlowItem[]> = async (client) => {
  const rows = unwrap(await client
    .from('reporting_cash_flow_items')
    .select('project_id, direction, source, source_id, reference, counterparty, '
      + 'amount, due_on, blocked, blocked_reason')
    .order('due_on', { ascending: true, nullsFirst: false })
    .limit(500)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    projectId: (r.project_id as string | null) ?? null,
    direction: String(r.direction),
    source: String(r.source),
    sourceId: String(r.source_id),
    reference: String(r.reference),
    counterparty: (r.counterparty as string | null) ?? null,
    amount: Number(r.amount ?? 0),
    dueOn: (r.due_on as string | null) ?? null,
    blocked: r.blocked === true,
    blockedReason: (r.blocked_reason as string | null) ?? null,
  }));
};
