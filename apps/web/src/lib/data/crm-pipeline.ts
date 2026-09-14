/**
 * Working the pipeline, and the people in it. WORKFLOW.
 *
 * `loadOpportunities` has read `opportunities` since the CRM went live, and the
 * only writer in the whole system was `convert_lead` — so a row sat forever in
 * the stage it was born in, the win-rate tile could only ever read zero, and
 * the loss-reason line under it never rendered for anybody.
 *
 * `contacts` and `crm_activities` were worse: modeled in migration 0005 with
 * constraints and indexes, and never read or written at all.
 */
import { unwrap, type Query } from './query';

export const STAGES = [
  'identified', 'qualifying', 'estimating', 'proposed', 'negotiating',
  'won', 'lost', 'abandoned',
] as const;
export type Stage = (typeof STAGES)[number];

/** The stages a live opportunity moves through, in the order it moves through them. */
export const OPEN_STAGES: Stage[] = [
  'identified', 'qualifying', 'estimating', 'proposed', 'negotiating',
];

export interface PipelineRow {
  id: string;
  companyId: string;
  customerId: string;
  customerName: string;
  number: string;
  name: string;
  description: string | null;
  stage: Stage;
  estimatedValue: number | null;
  probability: number | null;
  /** Value times probability — what a forecast is actually made of. */
  weightedValue: number | null;
  bidDueAt: string | null;
  expectedAwardAt: string | null;
  expectedStartAt: string | null;
  siteCity: string | null;
  siteState: string | null;
  deliveryMethod: string | null;
  ownerUserId: string | null;
  wonAt: string | null;
  lostAt: string | null;
  lossReason: string | null;
  winningCompetitor: string | null;
  /** Computed, not stored: six weeks in "proposed" is what a review looks for. */
  daysInStage: number;
  isClosed: boolean;
  openActivities: number;
  nextDueAt: string | null;
  updatedAt: string;
}

type RpcCapable = {
  rpc: (fn: string, args: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

const rpc = async <T,>(client: RpcCapable, fn: string, args: Record<string, unknown>) => {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
};

const num = (v: unknown): number | null => (v == null ? null : Number(v));

export const loadPipeline: Query<PipelineRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_pipeline')
    .select('id, company_id, customer_id, customer_name, number, name, description, stage, estimated_value, probability, weighted_value, bid_due_at, expected_award_at, expected_start_at, site_city, site_state, delivery_method, owner_user_id, won_at, lost_at, loss_reason, winning_competitor, days_in_stage, is_closed, open_activities, next_due_at, updated_at')
    .order('bid_due_at', { ascending: true, nullsFirst: false })
    .limit(300)) as Array<Record<string, unknown>>;

  return rows.map((o) => ({
    id: String(o.id),
    companyId: String(o.company_id),
    customerId: String(o.customer_id),
    customerName: String(o.customer_name ?? ''),
    number: String(o.number),
    name: String(o.name),
    description: (o.description as string | null) ?? null,
    stage: o.stage as Stage,
    estimatedValue: num(o.estimated_value),
    probability: num(o.probability),
    weightedValue: num(o.weighted_value),
    bidDueAt: (o.bid_due_at as string | null) ?? null,
    expectedAwardAt: (o.expected_award_at as string | null) ?? null,
    expectedStartAt: (o.expected_start_at as string | null) ?? null,
    siteCity: (o.site_city as string | null) ?? null,
    siteState: (o.site_state as string | null) ?? null,
    deliveryMethod: (o.delivery_method as string | null) ?? null,
    ownerUserId: (o.owner_user_id as string | null) ?? null,
    wonAt: (o.won_at as string | null) ?? null,
    lostAt: (o.lost_at as string | null) ?? null,
    lossReason: (o.loss_reason as string | null) ?? null,
    winningCompetitor: (o.winning_competitor as string | null) ?? null,
    daysInStage: Number(o.days_in_stage ?? 0),
    isClosed: Boolean(o.is_closed),
    openActivities: Number(o.open_activities ?? 0),
    nextDueAt: (o.next_due_at as string | null) ?? null,
    updatedAt: String(o.updated_at ?? ''),
  }));
};

/**
 * Move it along, or close it out.
 *
 * A loss needs a reason — the database refuses one without. That is not
 * bureaucracy: it is the only field that ever answers whether the number was
 * wrong or the relationship was.
 */
export async function moveStage(
  client: RpcCapable, opportunityId: string, stage: Stage,
  reason?: string | null, competitor?: string | null,
): Promise<void> {
  await rpc(client, 'move_opportunity_stage', {
    p_opportunity: opportunityId,
    p_stage: stage,
    p_reason: reason?.trim() || null,
    p_competitor: competitor?.trim() || null,
  });
}

export interface OpportunityEdit {
  name?: string;
  description?: string | null;
  estimatedValue?: number | null;
  probability?: number | null;
  bidDueAt?: string | null;
  expectedAwardAt?: string | null;
  expectedStartAt?: string | null;
  deliveryMethod?: string | null;
}

/** Change what is known. Undefined leaves a field where it was. */
export async function updateOpportunity(
  client: RpcCapable, opportunityId: string, edit: OpportunityEdit,
): Promise<void> {
  await rpc(client, 'update_opportunity', {
    p_opportunity: opportunityId,
    p_name: edit.name?.trim() || null,
    p_description: edit.description ?? null,
    p_estimated_value: edit.estimatedValue ?? null,
    p_probability: edit.probability ?? null,
    p_bid_due_at: edit.bidDueAt || null,
    p_expected_award_at: edit.expectedAwardAt || null,
    p_expected_start_at: edit.expectedStartAt || null,
    p_owner: null,
    p_delivery_method: edit.deliveryMethod ?? null,
  });
}

/* ------------------------------------------------------------------ contacts */

export interface ContactRow {
  id: string;
  companyId: string;
  customerId: string | null;
  vendorId: string | null;
  firstName: string;
  lastName: string;
  fullName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  role: string | null;
  notes: string | null;
  isPrimary: boolean;
  customerName: string | null;
  vendorName: string | null;
}

export const loadContacts: Query<ContactRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_contacts')
    .select('id, company_id, customer_id, vendor_id, first_name, last_name, full_name, title, email, phone, mobile, role, notes, is_primary, customer_name, vendor_name')
    .order('is_primary', { ascending: false })
    .order('last_name')
    .limit(500)) as Array<Record<string, unknown>>;

  return rows.map((c) => ({
    id: String(c.id),
    companyId: String(c.company_id),
    customerId: (c.customer_id as string | null) ?? null,
    vendorId: (c.vendor_id as string | null) ?? null,
    firstName: String(c.first_name),
    lastName: String(c.last_name),
    fullName: String(c.full_name ?? ''),
    title: (c.title as string | null) ?? null,
    email: (c.email as string | null) ?? null,
    phone: (c.phone as string | null) ?? null,
    mobile: (c.mobile as string | null) ?? null,
    role: (c.role as string | null) ?? null,
    notes: (c.notes as string | null) ?? null,
    isPrimary: Boolean(c.is_primary),
    customerName: (c.customer_name as string | null) ?? null,
    vendorName: (c.vendor_name as string | null) ?? null,
  }));
};

export interface ContactEdit {
  id?: string | null;
  customerId?: string | null;
  vendorId?: string | null;
  firstName?: string;
  lastName?: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  role?: string | null;
  notes?: string | null;
  isPrimary?: boolean;
}

/** Add or change somebody. Naming a new primary stands the old one down. */
export async function saveContact(
  client: RpcCapable, edit: ContactEdit,
): Promise<string> {
  return rpc<string>(client, 'save_contact', {
    p_contact: edit.id ?? null,
    p_customer: edit.customerId ?? null,
    p_vendor: edit.vendorId ?? null,
    p_first_name: edit.firstName?.trim() || null,
    p_last_name: edit.lastName?.trim() || null,
    p_title: edit.title ?? null,
    p_email: edit.email ?? null,
    p_phone: edit.phone ?? null,
    p_mobile: edit.mobile ?? null,
    p_role: edit.role ?? null,
    p_notes: edit.notes ?? null,
    p_is_primary: edit.isPrimary ?? false,
  });
}

/** Archived, not deleted: they answered the phone for two years. */
export async function retireContact(client: RpcCapable, contactId: string): Promise<void> {
  await rpc(client, 'retire_contact', { p_contact: contactId });
}

/* ---------------------------------------------------------------- activities */

export const ACTIVITY_TYPES = [
  'call', 'email', 'meeting', 'site_visit', 'note', 'task',
  'proposal_sent', 'follow_up',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface ActivityRow {
  id: string;
  companyId: string;
  customerId: string | null;
  opportunityId: string | null;
  leadId: string | null;
  activityType: ActivityType;
  subject: string;
  body: string | null;
  dueAt: string | null;
  completedAt: string | null;
  assignedTo: string | null;
  createdAt: string;
  customerName: string | null;
  opportunityName: string | null;
  opportunityNumber: string | null;
  leadName: string | null;
  overdue: boolean;
}

export const loadActivities: Query<ActivityRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_crm_activities')
    .select('id, company_id, customer_id, opportunity_id, lead_id, activity_type, subject, body, due_at, completed_at, assigned_to, created_at, customer_name, opportunity_name, opportunity_number, lead_name, overdue')
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(400)) as Array<Record<string, unknown>>;

  return rows.map((a) => ({
    id: String(a.id),
    companyId: String(a.company_id),
    customerId: (a.customer_id as string | null) ?? null,
    opportunityId: (a.opportunity_id as string | null) ?? null,
    leadId: (a.lead_id as string | null) ?? null,
    activityType: a.activity_type as ActivityType,
    subject: String(a.subject),
    body: (a.body as string | null) ?? null,
    dueAt: (a.due_at as string | null) ?? null,
    completedAt: (a.completed_at as string | null) ?? null,
    assignedTo: (a.assigned_to as string | null) ?? null,
    createdAt: String(a.created_at ?? ''),
    customerName: (a.customer_name as string | null) ?? null,
    opportunityName: (a.opportunity_name as string | null) ?? null,
    opportunityNumber: (a.opportunity_number as string | null) ?? null,
    leadName: (a.lead_name as string | null) ?? null,
    overdue: Boolean(a.overdue),
  }));
};

export interface NewActivity {
  activityType: ActivityType;
  subject: string;
  body?: string | null;
  customerId?: string | null;
  opportunityId?: string | null;
  leadId?: string | null;
  dueAt?: string | null;
  /** False records something still to do; true records something that happened. */
  completed?: boolean;
}

export async function logActivity(
  client: RpcCapable, input: NewActivity,
): Promise<string> {
  return rpc<string>(client, 'log_crm_activity', {
    p_activity_type: input.activityType,
    p_subject: input.subject.trim(),
    p_body: input.body?.trim() || null,
    p_customer: input.customerId ?? null,
    p_opportunity: input.opportunityId ?? null,
    p_lead: input.leadId ?? null,
    p_due_at: input.dueAt || null,
    p_completed: input.completed ?? true,
    p_assigned_to: null,
  });
}

export async function completeActivity(client: RpcCapable, id: string): Promise<void> {
  await rpc(client, 'complete_crm_activity', { p_activity: id });
}
