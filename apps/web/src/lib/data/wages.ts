/**
 * Library — the wage sheets a bid is priced from.
 *
 * What a person is paid is not one number in one place. It depends on which
 * hall they belong to and where the job is: Local 18 covers all of Ohio and
 * does not pay the same across it, and crossing into Michigan is Local 324
 * under a different agreement. On public work it depends on a determination
 * scoped by county *and* construction type — heavy, highway, building and
 * residential pay differently for the same trade in the same county.
 *
 * So the unit is the sheet, because the sheet is the document somebody holds.
 *
 * Two properties this module exists to preserve, both enforced in the database
 * rather than here:
 *
 *   1. **An estimate that names no sheet prices exactly as it did before.**
 *      `resolve_labor_rate` returns the crew member's own rate — the same row,
 *      no lookup. Most contractors are open shop and will never open this.
 *   2. **Nothing is ever substituted.** A class missing from the named sheet is
 *      a refusal saying which class and which sheet, never a quiet fall back to
 *      the shop rate.
 */
import { unwrap, type Query } from './query';
import { supabase } from '@/lib/supabase';

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const maybeNum = (v: unknown): number | null =>
  (v === null || v === undefined ? null : Number(v));

/** What kind of sheet this is. Open shop is the default and the common case. */
export const WAGE_BASES = [
  { value: 'open_shop', label: 'Open shop', says: 'What your company pays' },
  { value: 'union', label: 'Union', says: 'An agreement, by local and district' },
  { value: 'prevailing_wage', label: 'Prevailing wage', says: 'A determination, by county and construction type' },
] as const;

/**
 * Heavy, highway, building, residential.
 *
 * Not decoration: the same trade in the same county is paid differently under
 * each, and bidding site work off the building decision is the mistake the
 * database refuses a sheet for not naming.
 */
export const CONSTRUCTION_TYPES = ['heavy', 'highway', 'building', 'residential'] as const;

export interface WageSheet {
  id: string;
  code: string;
  name: string;
  basis: string;
  unionName: string | null;
  localNumber: string | null;
  district: string | null;
  determinationNumber: string | null;
  county: string | null;
  stateCode: string | null;
  constructionType: string | null;
  effectiveDate: string;
  expiresOn: string | null;
  supersedesId: string | null;
  sourceDocumentPath: string | null;
  notes: string | null;
  status: string;
  rateCount: number;
  /** The scope in the words a person would use for it. */
  scopeSays: string;
  /** Approved and dated ahead is not the same as pricing today. */
  inForceToday: boolean;
  startsLater: boolean;
  estimatesUsing: number;
}

export const loadWageSheets: Query<WageSheet[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_wage_schedules')
    .select('id, code, name, basis, union_name, local_number, district, '
      + 'determination_number, county, state_code, construction_type, effective_date, '
      + 'expires_on, supersedes_id, source_document_path, notes, status, rate_count, '
      + 'scope_says, in_force_today, starts_later, estimates_using')
    .order('effective_date', { ascending: false })) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    code: String(r.code),
    name: String(r.name),
    basis: String(r.basis),
    unionName: (r.union_name as string | null) ?? null,
    localNumber: (r.local_number as string | null) ?? null,
    district: (r.district as string | null) ?? null,
    determinationNumber: (r.determination_number as string | null) ?? null,
    county: (r.county as string | null) ?? null,
    stateCode: (r.state_code as string | null) ?? null,
    constructionType: (r.construction_type as string | null) ?? null,
    effectiveDate: String(r.effective_date),
    expiresOn: (r.expires_on as string | null) ?? null,
    supersedesId: (r.supersedes_id as string | null) ?? null,
    sourceDocumentPath: (r.source_document_path as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    status: String(r.status),
    rateCount: num(r.rate_count),
    scopeSays: String(r.scope_says ?? ''),
    inForceToday: r.in_force_today === true,
    startsLater: r.starts_later === true,
    estimatesUsing: num(r.estimates_using),
  }));
};

export interface WageRate {
  id: string;
  wageScheduleId: string;
  trade: string;
  classLabel: string;
  classification: string;
  baseWagePerHour: number;
  fringePerHour: number;
  fringeIsTaxable: boolean;
  burdenPercent: number;
  /** Base x (1 + burden) + fringe, computed the way the engine computes it. */
  loadedPerHour: number;
  percentOfJourneyman: number | null;
  journeymanRateId: string | null;
  journeymanClassification: string | null;
  followsAJourneyman: boolean;
  status: string;
}

export const loadWageRates = (sheetId: string): Query<WageRate[]> =>
  async (client) => {
    if (!sheetId) return [];
    const rows = unwrap(await client
      .from('my_wage_rates')
      .select('id, wage_schedule_id, trade, class_label, classification, base_wage_per_hour, '
        + 'fringe_per_hour, fringe_is_taxable, burden_percent, loaded_per_hour, '
        + 'percent_of_journeyman, journeyman_rate_id, journeyman_classification, '
        + 'follows_a_journeyman, status')
      .eq('wage_schedule_id', sheetId)
      .order('trade')) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      wageScheduleId: String(r.wage_schedule_id),
      trade: String(r.trade),
      classLabel: String(r.class_label),
      classification: String(r.classification),
      baseWagePerHour: num(r.base_wage_per_hour),
      fringePerHour: num(r.fringe_per_hour),
      fringeIsTaxable: r.fringe_is_taxable === true,
      burdenPercent: num(r.burden_percent),
      loadedPerHour: num(r.loaded_per_hour),
      percentOfJourneyman: maybeNum(r.percent_of_journeyman),
      journeymanRateId: (r.journeyman_rate_id as string | null) ?? null,
      journeymanClassification: (r.journeyman_classification as string | null) ?? null,
      followsAJourneyman: r.follows_a_journeyman === true,
      status: String(r.status),
    }));
  };

/* ------------------------------------------------------------------ writers */

const rpc = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
  if (!supabase) throw new Error('No workspace is configured.');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
};

export async function createWageSheet(companyId: string, sheet: {
  name: string; basis: string; effectiveDate: string;
  unionName?: string | null; localNumber?: string | null; district?: string | null;
  determinationNumber?: string | null; county?: string | null; stateCode?: string | null;
  constructionType?: string | null; notes?: string | null;
}): Promise<string> {
  return String(await rpc('create_wage_schedule', {
    p_company: companyId,
    p_name: sheet.name.trim(),
    p_basis: sheet.basis,
    p_effective_date: sheet.effectiveDate,
    p_union_name: sheet.unionName?.trim() || null,
    p_local_number: sheet.localNumber?.trim() || null,
    p_district: sheet.district?.trim() || null,
    p_determination_number: sheet.determinationNumber?.trim() || null,
    p_county: sheet.county?.trim() || null,
    p_state_code: sheet.stateCode?.trim() || null,
    p_construction_type: sheet.constructionType || null,
    p_notes: sheet.notes?.trim() || null,
  }));
}

export async function approveWageSheet(sheetId: string): Promise<void> {
  await rpc('approve_wage_schedule', { p_schedule: sheetId });
}

export async function addWageRate(sheetId: string, rate: {
  trade: string; classLabel: string; baseWage: number;
  fringePerHour?: number; burdenPercent?: number; fringeIsTaxable?: boolean;
  classification?: string | null; laborGroup?: string | null;
}): Promise<string> {
  return String(await rpc('add_wage_rate', {
    p_schedule: sheetId,
    p_trade: rate.trade.trim(),
    p_class_label: rate.classLabel.trim(),
    p_base_wage: rate.baseWage,
    p_fringe_per_hour: rate.fringePerHour ?? 0,
    p_burden_percent: rate.burdenPercent ?? 0,
    p_fringe_is_taxable: rate.fringeIsTaxable ?? false,
    p_classification: rate.classification ?? null,
    p_labor_group: rate.laborGroup ?? null,
  }));
}

/** Correct a wage — the number you actually get paid. */
export async function setWageRate(rateId: string, changes: {
  baseWage?: number | null; fringePerHour?: number | null;
  burdenPercent?: number | null; fringeIsTaxable?: boolean | null;
}): Promise<void> {
  await rpc('set_wage_rate', {
    p_rate: rateId,
    p_base_wage: changes.baseWage ?? null,
    p_fringe_per_hour: changes.fringePerHour ?? null,
    p_burden_percent: changes.burdenPercent ?? null,
    p_fringe_is_taxable: changes.fringeIsTaxable ?? null,
  });
}

export async function setApprenticeStep(
  rateId: string, journeymanId: string, percent: number,
): Promise<void> {
  await rpc('set_apprentice_step', {
    p_rate: rateId, p_journeyman: journeymanId, p_percent: percent,
  });
}

/**
 * Enter a raise once, for a date that has not arrived.
 *
 * The reason the union half is worth having. An agreement carries its steps
 * years ahead and everybody bids at today's rate anyway, because remembering
 * three Mays from now is nobody's job.
 */
export async function scheduleWageIncrease(sheetId: string, step: {
  effectiveDate: string; wageIncrease?: number; fringeIncrease?: number;
  wagePercent?: number; name?: string | null;
}): Promise<string> {
  return String(await rpc('schedule_wage_increase', {
    p_schedule: sheetId,
    p_effective_date: step.effectiveDate,
    p_wage_increase: step.wageIncrease ?? 0,
    p_fringe_increase: step.fringeIncrease ?? 0,
    p_wage_percent: step.wagePercent ?? 0,
    p_name: step.name?.trim() || null,
  }));
}

/** Point an estimate version at a sheet, or `null` to price it as it is now. */
export async function setEstimateWageSheet(
  versionId: string, sheetId: string | null,
): Promise<void> {
  await rpc('set_estimate_wage_schedule', {
    p_version: versionId, p_schedule: sheetId,
  });
}
