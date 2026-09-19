/**
 * What the field measured, offered back to the library. WORKFLOW.
 *
 * Migration 0051 built the measurement and stopped there on purpose — its own
 * words: "this reports the variance, names its direction, and says how much
 * evidence is behind it. Somebody decides." Nothing was ever built for the
 * deciding, so `production_calibrations` sat from 0008 with no writer and no
 * reader, and no library row ever carried a rate the field had proved.
 *
 * Migrations 0233 and 0234 opened it. Nothing here computes anything: the
 * variance is the database's, the proposal is the database's, and this is the
 * door a person opens to agree or disagree with it.
 */
import { unwrap, type Query } from './query';
import { supabase } from '@/lib/supabase';

export interface ProductionCalibration {
  id: string;
  productionRateId: string;
  rateCode: string | null;
  rateUnit: string | null;
  /** What the field achieved, hours-weighted. */
  proposedRatePerHour: number;
  /** What the library says today, and what estimates have been priced with. */
  currentRatePerHour: number;
  variancePercent: number;
  sampleSize: number;
  sampleProjectIds: string[];
  /** How many observations came from each material condition. */
  observedConditions: Record<string, number>;
  statisticalNote: string | null;
  state: 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'not_required';
  reviewNote: string | null;
  reviewedAt: string | null;
  appliedRateId: string | null;
  createdAt: string;
}

export const productionCalibrations: Query<ProductionCalibration[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_production_calibrations')
    .select('id, production_rate_id, rate_code, rate_unit, proposed_rate_per_hour, current_rate_per_hour, variance_percent, sample_size, sample_project_ids, observed_conditions, statistical_note, state, review_note, reviewed_at, applied_rate_id, created_at')
    .order('created_at', { ascending: false })) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    productionRateId: String(r.production_rate_id),
    rateCode: (r.rate_code as string | null) ?? null,
    rateUnit: (r.rate_unit as string | null) ?? null,
    proposedRatePerHour: Number(r.proposed_rate_per_hour ?? 0),
    currentRatePerHour: Number(r.current_rate_per_hour ?? 0),
    variancePercent: Number(r.variance_percent ?? 0),
    sampleSize: Number(r.sample_size ?? 0),
    sampleProjectIds: (r.sample_project_ids as string[] | null) ?? [],
    observedConditions: (r.observed_conditions as Record<string, number> | null) ?? {},
    statisticalNote: (r.statistical_note as string | null) ?? null,
    state: String(r.state) as ProductionCalibration['state'],
    reviewNote: (r.review_note as string | null) ?? null,
    reviewedAt: (r.reviewed_at as string | null) ?? null,
    appliedRateId: (r.applied_rate_id as string | null) ?? null,
    createdAt: String(r.created_at),
  }));
};

/** Ask the field what it has learned. Returns how many proposals were written. */
export async function proposeCalibrations(companyId: string): Promise<number> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { data, error } = await supabase.rpc('propose_production_calibrations', {
    p_company: companyId,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export async function acceptCalibration(id: string, note?: string | null): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('accept_production_calibration', {
    p_calibration: id, p_note: note?.trim() || null,
  });
  if (error) throw new Error(error.message);
}

export async function declineCalibration(id: string, note: string): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('decline_production_calibration', {
    p_calibration: id, p_note: note,
  });
  if (error) throw new Error(error.message);
}
