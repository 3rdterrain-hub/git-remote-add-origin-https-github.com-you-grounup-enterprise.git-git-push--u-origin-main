/**
 * Entity — the leads that came in, and what happens to one next.
 *
 * Migration 0005 created `leads`. Migration 0065 built a public intake that
 * writes to it and `convert_lead`, which turns a qualified lead into a customer
 * and an opportunity in one transaction. Migration 0124 recorded where each one
 * came from. Nothing in the application ever read the table: a contractor could
 * publish a form, a stranger could fill it in, the row landed — and it was
 * visible to nobody. The forms screen could say "14 leads taken" and there was
 * no screen on which to see one of the fourteen.
 *
 * So this is the reader, and `convertLead` is the door onto the function that
 * has been sitting behind it since 0065.
 *
 * Stage is moved by an ordinary update because `leads` carries standard tenant
 * RLS with `crm.write` on the write side (migration 0010). Conversion is not,
 * because it is three writes that have to agree — a customer, an opportunity
 * and the lead's own converted columns — and 0065 already does them in one
 * transaction with the checks attached.
 */
import { unwrap, type Query } from './query';
import { supabase } from '@/lib/supabase';

export interface LeadRow {
  id: string;
  companyName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  description: string | null;
  estimatedValue: number | null;
  stage: string;
  source: string | null;
  /** The name of the form it arrived through, when it arrived through one. */
  formName: string | null;
  /** Set only on a public submission; null for a lead somebody typed in. */
  submittedAt: string | null;
  nextFollowUpAt: string | null;
  notes: string | null;
  convertedCustomerId: string | null;
  convertedAt: string | null;
  createdAt: string;
}

/** The stages a lead moves through, in the order 0005 allows. */
export const LEAD_STAGES = ['new', 'contacted', 'qualified', 'unqualified', 'converted'] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

/** What a person may do to a lead at each stage, in that person's words. */
export const STAGE_SAYS: Record<string, string> = {
  new: 'Nobody has spoken to them yet.',
  contacted: 'Someone has been in touch.',
  qualified: 'Real work, worth pricing. Ready to convert.',
  unqualified: 'Not work we want, or not work at all.',
  converted: 'Now a customer with an opportunity against them.',
};

export const loadLeads: Query<LeadRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('leads')
    .select('id, company_name, contact_name, email, phone, city, state_province,'
      + ' project_description, estimated_value, stage, source, submitted_at,'
      + ' next_follow_up_at, notes, converted_customer_id, converted_at, created_at,'
      + ' lead_intake_forms(name)')
    .order('created_at', { ascending: false })) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => {
    const form = r.lead_intake_forms as { name?: unknown } | Array<{ name?: unknown }> | null;
    const named = Array.isArray(form) ? form[0] : form;
    return {
      id: String(r.id),
      companyName: String(r.company_name),
      contactName: (r.contact_name as string | null) ?? null,
      email: (r.email as string | null) ?? null,
      phone: (r.phone as string | null) ?? null,
      city: (r.city as string | null) ?? null,
      state: (r.state_province as string | null) ?? null,
      description: (r.project_description as string | null) ?? null,
      estimatedValue: r.estimated_value === null || r.estimated_value === undefined
        ? null : Number(r.estimated_value),
      stage: String(r.stage),
      source: (r.source as string | null) ?? null,
      formName: named?.name === undefined || named?.name === null ? null : String(named.name),
      submittedAt: (r.submitted_at as string | null) ?? null,
      nextFollowUpAt: (r.next_follow_up_at as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      convertedCustomerId: (r.converted_customer_id as string | null) ?? null,
      convertedAt: (r.converted_at as string | null) ?? null,
      createdAt: String(r.created_at),
    };
  });
};

/**
 * Move a lead along.
 *
 * `converted` is not offered here even though the column allows it, because the
 * table's own constraint refuses that stage without a customer attached and the
 * only thing that can attach one is `convert_lead`. Offering it would produce a
 * check violation a person could do nothing about.
 */
export async function setLeadStage(leadId: string, stage: Exclude<LeadStage, 'converted'>): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  /*
   * Through `update_lead` rather than straight at the table. A direct write
   * would happily set a stage on a lead that has already been converted, and
   * would let 'converted' itself through to a check violation nobody could act
   * on. The refusals belong in one place, and that place is the database.
   */
  const { error } = await supabase.rpc('update_lead', { p_lead: leadId, p_stage: stage });
  if (error) throw new Error(error.message);
}

/** Note for next time — a follow-up date, or what was said on the phone. */
export async function noteOnLead(
  leadId: string,
  patch: {
    notes?: string | null; nextFollowUpAt?: string | null;
    contactName?: string | null; email?: string | null; phone?: string | null;
    description?: string | null; estimatedValue?: number | null;
  },
): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('update_lead', {
    p_lead: leadId,
    p_contact_name: patch.contactName ?? null,
    p_email: patch.email ?? null,
    p_phone: patch.phone ?? null,
    p_description: patch.description ?? null,
    p_estimated_value: patch.estimatedValue ?? null,
    p_follow_up_at: patch.nextFollowUpAt ?? null,
    p_notes: patch.notes ?? null,
  });
  if (error) throw new Error(error.message);
}

/**
 * Turn a qualified lead into a customer and an opportunity.
 *
 * Returns the opportunity id. The function refuses a lead that has not been
 * qualified and refuses one that was already converted, and both of those
 * messages are written to be read by a person, so they are shown as they come.
 */
export async function convertLead(
  leadId: string, opportunityName?: string, estimatedValue?: number | null,
): Promise<string> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { data, error } = await supabase.rpc('convert_lead', {
    p_lead: leadId,
    p_opportunity_name: opportunityName?.trim() ? opportunityName.trim() : null,
    p_estimated_value: estimatedValue ?? null,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

/**
 * Write down a lead that came in some other way.
 *
 * `submit_lead` is the public website form: it takes a form key, is granted to
 * `anon`, rate-limits by IP and carries a honeypot. All of that is right for a
 * form on the open internet and none of it fits somebody writing down a phone
 * call — so until migration 0188 the Leads tab could only ever fill itself from
 * a website, while the Lead-source breakdown directly beneath it counted phone
 * calls, referrals, walk-ins and bid boards that could not exist.
 *
 * `source` is a name from the company's own `lead_source` category list, not a
 * fixed set: a company that wins work a way nobody thought of adds it.
 */
export interface NewLead {
  companyName: string;
  source: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  description?: string | null;
  city?: string | null;
  state?: string | null;
  estimatedValue?: number | null;
  followUpAt?: string | null;
}

export async function createLead(companyId: string, input: NewLead): Promise<string> {
  if (!supabase) throw new Error('Not connected.');
  const { data, error } = await supabase.rpc('create_lead', {
    p_company: companyId,
    p_company_name: input.companyName.trim(),
    p_source: input.source,
    p_contact_name: input.contactName?.trim() || null,
    p_email: input.email?.trim() || null,
    p_phone: input.phone?.trim() || null,
    p_description: input.description?.trim() || null,
    p_city: input.city?.trim() || null,
    p_state: input.state?.trim() || null,
    p_estimated_value: input.estimatedValue ?? null,
    p_follow_up_at: input.followUpAt || null,
  });
  if (error) throw new Error(error.message);
  return String(data);
}
