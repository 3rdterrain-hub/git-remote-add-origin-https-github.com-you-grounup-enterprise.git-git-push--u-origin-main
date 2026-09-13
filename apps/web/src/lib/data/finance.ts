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
  id: string; number: number; projectNumber: string;
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
    .select('id, application_number, period_start, period_end, contract_sum, approved_changes, contract_sum_to_date, completed_to_date, stored_materials, total_earned, retainage_percent, retainage_to_date, previous_payments, current_due, status, paid_at, amount_paid, projects(number), pay_application_lines(id, item_number, description, scheduled_value, previous_completed, this_period, stored_materials, completed_to_date)')
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
  /** Derived here from the same rule the database enforces as a constraint. */
  blocked: boolean;
}

export const loadPayables: Query<ApInvoiceRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('ap_invoices')
    .select('id, invoice_number, invoice_date, due_date, amount, tax, retainage_withheld, amount_paid, match_status, status, vendors(name), purchase_orders(number), projects(number)')
    .order('invoice_date', { ascending: false })
    .limit(200)) as Array<Record<string, unknown>>;
  return rows.map((i) => {
    const matchStatus = String(i.match_status);
    const status = String(i.status);
    return {
      id: String(i.id),
      vendor: one<{ name: string }>(i.vendors)?.name ?? 'Unknown vendor',
      invoiceNumber: String(i.invoice_number),
      invoiceDate: String(i.invoice_date),
      dueDate: (i.due_date as string | null) ?? null,
      po: one<{ number: string }>(i.purchase_orders)?.number ?? null,
      project: one<{ number: string }>(i.projects)?.number ?? null,
      amount: Number(i.amount ?? 0),
      tax: Number(i.tax ?? 0),
      retainageWithheld: Number(i.retainage_withheld ?? 0),
      amountPaid: Number(i.amount_paid ?? 0),
      matchStatus,
      status,
      // `ap_invoices_pay_requires_match`, read back out. The screen states the
      // control rather than inventing a second opinion about it.
      blocked: !['matched', 'no_po'].includes(matchStatus) && status !== 'paid',
    };
  });
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
    id: p.id, number: p.number, projectNumber: PROJECT.number,
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

export const demonstrationPayables = (): ApInvoiceRow[] =>
  AP_INVOICES.map((i) => ({
    id: i.id, vendor: i.vendor, invoiceNumber: i.invoiceNumber,
    invoiceDate: i.invoiceDate, dueDate: i.dueDate, po: i.po ?? null,
    project: null, amount: i.amount, tax: 0,
    retainageWithheld: i.retainageWithheld, amountPaid: i.amountPaid,
    matchStatus: i.matchStatus, status: i.status,
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
