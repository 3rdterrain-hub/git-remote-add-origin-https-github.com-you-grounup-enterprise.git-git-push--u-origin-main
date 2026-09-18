/**
 * What a bid is priced on, and what it leaves out. ENTITY.
 *
 * `estimate_assumptions` and `estimate_exclusions` were built in migration
 * 0006, given tenant RLS in 0010, and taught to copy themselves onto a new
 * version in 0011 and 0112. Four migrations treat them as real and nothing has
 * ever written a row into either — while `proposal-pdf.ts` passed
 * `inclusions: []` and `exclusions: []` to a document that has always had those
 * sections. The renderer was finished, the tables were finished, and the two
 * had never been introduced. Migration 0232 opened the doors; this is the side
 * the application holds.
 */
import { unwrap, type Query } from './query';
import { supabase } from '@/lib/supabase';

export interface EstimateAssumption {
  id: string;
  estimateVersionId: string;
  lineItemId: string | null;
  code: string | null;
  assumption: string;
  reason: string;
  costImpact: string | null;
  scheduleImpact: string | null;
  /** Per-item, because everything can be shown to the client or held back. */
  isDisclosedToCustomer: boolean;
}

export interface EstimateExclusion {
  id: string;
  estimateVersionId: string;
  exclusion: string;
  category: string | null;
  reason: string;
  sortOrder: number;
}

export const estimateAssumptions =
  (versionId: string): Query<EstimateAssumption[]> => async (client) => {
    const rows = unwrap(await client
      .from('my_estimate_assumptions')
      .select('id, estimate_version_id, line_item_id, code, assumption, reason, cost_impact, schedule_impact, is_disclosed_to_customer')
      .eq('estimate_version_id', versionId)
      .order('created_at', { ascending: true })) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      estimateVersionId: String(r.estimate_version_id),
      lineItemId: (r.line_item_id as string | null) ?? null,
      code: (r.code as string | null) ?? null,
      assumption: String(r.assumption),
      reason: String(r.reason),
      costImpact: (r.cost_impact as string | null) ?? null,
      scheduleImpact: (r.schedule_impact as string | null) ?? null,
      isDisclosedToCustomer: Boolean(r.is_disclosed_to_customer),
    }));
  };

export const estimateExclusions =
  (versionId: string): Query<EstimateExclusion[]> => async (client) => {
    const rows = unwrap(await client
      .from('my_estimate_exclusions')
      .select('id, estimate_version_id, exclusion, category, reason, sort_order')
      .eq('estimate_version_id', versionId)
      .order('sort_order', { ascending: true })) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      estimateVersionId: String(r.estimate_version_id),
      exclusion: String(r.exclusion),
      category: (r.category as string | null) ?? null,
      reason: String(r.reason),
      sortOrder: Number(r.sort_order ?? 0),
    }));
  };

export async function addAssumption(versionId: string, entry: {
  assumption: string;
  reason: string;
  code?: string | null;
  lineItemId?: string | null;
  costImpact?: string | null;
  scheduleImpact?: string | null;
  isDisclosedToCustomer?: boolean;
}): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('add_estimate_assumption', {
    p_version: versionId,
    p_assumption: entry.assumption,
    p_reason: entry.reason,
    p_code: entry.code ?? null,
    p_line: entry.lineItemId ?? null,
    p_cost_impact: entry.costImpact ?? null,
    p_schedule_impact: entry.scheduleImpact ?? null,
    p_disclosed: entry.isDisclosedToCustomer ?? true,
  });
  if (error) throw new Error(error.message);
}

export async function addExclusion(versionId: string, entry: {
  exclusion: string;
  reason: string;
  category?: string | null;
}): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('add_estimate_exclusion', {
    p_version: versionId,
    p_exclusion: entry.exclusion,
    p_reason: entry.reason,
    p_category: entry.category ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function setAssumption(id: string, change: {
  assumption?: string;
  reason?: string;
  costImpact?: string;
  scheduleImpact?: string;
  isDisclosedToCustomer?: boolean;
}): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('set_estimate_assumption', {
    p_assumption: id,
    p_text: change.assumption ?? null,
    p_reason: change.reason ?? null,
    p_cost_impact: change.costImpact ?? null,
    p_schedule_impact: change.scheduleImpact ?? null,
    p_disclosed: change.isDisclosedToCustomer ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function setExclusion(id: string, change: {
  exclusion?: string;
  reason?: string;
  category?: string;
  sortOrder?: number;
}): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('set_estimate_exclusion', {
    p_exclusion: id,
    p_text: change.exclusion ?? null,
    p_reason: change.reason ?? null,
    p_category: change.category ?? null,
    p_sort: change.sortOrder ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function removeAssumption(id: string): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('remove_estimate_assumption', { p_assumption: id });
  if (error) throw new Error(error.message);
}

export async function removeExclusion(id: string): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('remove_estimate_exclusion', { p_exclusion: id });
  if (error) throw new Error(error.message);
}

/**
 * The exclusions an excavating contractor is asked about on nearly every bid.
 *
 * Offered as a starting point, never written automatically. Each still needs a
 * reason typed against it, because the reason is the part that has to be true
 * for this job — "no geotechnical report was provided" is a fact about this
 * set, not a phrase to paste. Migration 0232 refuses one without it.
 */
export const COMMON_EXCLUSIONS: ReadonlyArray<{ exclusion: string; category: string }> = [
  { exclusion: 'Rock excavation', category: 'Earthwork' },
  { exclusion: 'Dewatering', category: 'Earthwork' },
  { exclusion: 'Unsuitable soil removal or replacement', category: 'Earthwork' },
  { exclusion: 'Contaminated material handling or disposal', category: 'Environmental' },
  { exclusion: 'Permits and permit fees', category: 'Administrative' },
  { exclusion: 'Bonds', category: 'Administrative' },
  { exclusion: 'Winter conditions and temporary heat', category: 'Schedule' },
  { exclusion: 'Survey layout beyond the initial control', category: 'Survey' },
  { exclusion: 'Traffic control beyond what is shown', category: 'Traffic' },
  { exclusion: 'Landscaping and final restoration', category: 'Site' },
  { exclusion: 'Utility relocation by the owner or the utility', category: 'Utilities' },
  { exclusion: 'Testing and inspection', category: 'Quality' },
];
