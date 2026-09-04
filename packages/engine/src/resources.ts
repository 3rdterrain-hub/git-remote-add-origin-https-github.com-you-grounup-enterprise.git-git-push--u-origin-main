/**
 * Labor, crew, equipment and fuel.
 *
 * Governing rules:
 *  - RULE-001  Labor, burden, equipment, fuel, material, trucking, disposal and
 *              subcontract cost stay separately visible; nothing is blended.
 *  - RULE-003  Equipment rate hierarchy: project quote > approved tenant rate >
 *              regional rate > global seed. The winning source and its effective
 *              date are retained on the result.
 *  - RULE-010  Every non-company-actual rate carries source, confidence and
 *              review state.
 */

import { assertNonNegative, assertPositive, factor, hours as roundHours, money, roundTo, sumMoney, unitRate } from './numeric.js';

// ---------------------------------------------------------------------------
// Labor
// ---------------------------------------------------------------------------

export interface LaborClassification {
  id: string;
  classification: string;
  group: string;
  baseWagePerHour: number;
  /** Fringe, taxes, insurance and company burden as a fraction of base wage. */
  burdenPercent: number;
  overtimeMultiplier: number;
  doubletimeMultiplier: number;
  region?: string;
  effectiveDate?: string;
  status?: 'active' | 'draft' | 'retired';
}

export interface LoadedLaborRate {
  classificationId: string;
  classification: string;
  baseWagePerHour: number;
  burdenPercent: number;
  burdenPerHour: number;
  /** Base + burden. This is the rate the cost engine multiplies by hours. */
  loadedPerHour: number;
  derivation: string;
}

/** Loaded rate = base x (1 + burden). Burden is reported separately per RULE-001. */
export function loadedLaborRate(labor: LaborClassification): LoadedLaborRate {
  assertNonNegative(labor.baseWagePerHour, `labor ${labor.id} baseWagePerHour`);
  assertNonNegative(labor.burdenPercent, `labor ${labor.id} burdenPercent`);
  const burdenPerHour = unitRate(labor.baseWagePerHour * labor.burdenPercent);
  const loadedPerHour = unitRate(labor.baseWagePerHour + burdenPerHour);
  return {
    classificationId: labor.id,
    classification: labor.classification,
    baseWagePerHour: unitRate(labor.baseWagePerHour),
    burdenPercent: factor(labor.burdenPercent),
    burdenPerHour,
    loadedPerHour,
    derivation: `${unitRate(labor.baseWagePerHour)} base x (1 + ${factor(labor.burdenPercent)} burden) = ${loadedPerHour}/hr loaded`,
  };
}

export interface CrewMember {
  classification: LaborClassification;
  count: number;
  /** Straight-time hours per shift for this member. */
  straightHoursPerShift?: number;
  overtimeHoursPerShift?: number;
  doubletimeHoursPerShift?: number;
}

export interface Crew {
  id: string;
  name: string;
  members: readonly CrewMember[];
  shiftHours: number;
}

export interface CrewCostResult {
  crewId: string;
  crewName: string;
  headcount: number;
  /** Total man-hours the crew delivers across the priced duration. */
  totalLaborHours: number;
  baseWageCost: number;
  burdenCost: number;
  overtimePremiumCost: number;
  /** baseWage + burden + overtime premium. */
  totalLaborCost: number;
  costPerCrewHour: number;
  lines: readonly {
    classificationId: string;
    classification: string;
    count: number;
    hoursEach: number;
    totalHours: number;
    baseWageCost: number;
    burdenCost: number;
    overtimePremiumCost: number;
    totalCost: number;
  }[];
  derivation: string;
  warnings: readonly string[];
}

/**
 * Cost a crew over `shifts` shifts.
 *
 * Overtime is priced as a *premium* on top of straight time rather than as a
 * separate full rate, so the base wage and burden buckets stay comparable
 * across estimates whether or not overtime was worked. Burden applies to the
 * premium as well, because fringe and payroll tax follow gross pay.
 */
export function calculateCrewCost(crew: Crew, shifts: number): CrewCostResult {
  assertNonNegative(shifts, 'shifts');
  assertPositive(crew.shiftHours, `crew ${crew.id} shiftHours`);
  if (crew.members.length === 0) {
    throw new RangeError(`Crew ${crew.id} has no members; a crew must have at least one classification`);
  }

  const warnings: string[] = [];
  const lines: CrewCostResult['lines'] = [];
  let headcount = 0;
  let totalLaborHours = 0;
  const baseWageCosts: number[] = [];
  const burdenCosts: number[] = [];
  const otPremiumCosts: number[] = [];

  for (const member of crew.members) {
    assertPositive(member.count, `crew ${crew.id} member count`);
    const st = member.straightHoursPerShift ?? crew.shiftHours;
    const ot = member.overtimeHoursPerShift ?? 0;
    const dt = member.doubletimeHoursPerShift ?? 0;
    assertNonNegative(st, 'straightHoursPerShift');
    assertNonNegative(ot, 'overtimeHoursPerShift');
    assertNonNegative(dt, 'doubletimeHoursPerShift');

    // Wage and burden are accumulated separately below rather than through the
    // loaded rate, because RULE-001 requires the two buckets to stay visible.
    const hoursEachPerShift = st + ot + dt;
    if (hoursEachPerShift > 16) {
      warnings.push(
        `${member.classification.classification} is scheduled ${hoursEachPerShift} hr/shift; verify the shift plan.`,
      );
    }
    if (member.classification.status === 'retired') {
      warnings.push(`Labor classification ${member.classification.id} is retired and should not price new work.`);
    }

    const totalHours = roundHours(hoursEachPerShift * member.count * shifts);
    const stHours = st * member.count * shifts;
    const otHours = ot * member.count * shifts;
    const dtHours = dt * member.count * shifts;

    const base = member.classification.baseWagePerHour;
    const baseWageCost = base * (stHours + otHours + dtHours);
    const otPremiumBase =
      base * (member.classification.overtimeMultiplier - 1) * otHours +
      base * (member.classification.doubletimeMultiplier - 1) * dtHours;
    const burdenCost = (baseWageCost + otPremiumBase) * member.classification.burdenPercent;

    headcount += member.count;
    totalLaborHours += totalHours;
    baseWageCosts.push(baseWageCost);
    burdenCosts.push(burdenCost);
    otPremiumCosts.push(otPremiumBase);

    (lines as CrewCostResult['lines'][number][]).push({
      classificationId: member.classification.id,
      classification: member.classification.classification,
      count: member.count,
      hoursEach: roundHours(hoursEachPerShift * shifts),
      totalHours,
      baseWageCost: money(baseWageCost),
      burdenCost: money(burdenCost),
      overtimePremiumCost: money(otPremiumBase),
      totalCost: money(baseWageCost + burdenCost + otPremiumBase),
    });
  }

  const baseWageCost = sumMoney(baseWageCosts);
  const burdenCost = sumMoney(burdenCosts);
  const overtimePremiumCost = sumMoney(otPremiumCosts);
  const totalLaborCost = sumMoney([baseWageCost, burdenCost, overtimePremiumCost]);
  const crewHours = crew.shiftHours * shifts;

  return {
    crewId: crew.id,
    crewName: crew.name,
    headcount,
    totalLaborHours: roundHours(totalLaborHours),
    baseWageCost,
    burdenCost,
    overtimePremiumCost,
    totalLaborCost,
    costPerCrewHour: crewHours > 0 ? unitRate(totalLaborCost / crewHours) : 0,
    lines,
    derivation:
      `${headcount} workers x ${crew.shiftHours} hr x ${roundTo(shifts, 2)} shifts = ${roundHours(totalLaborHours)} man-hr; ` +
      `wage ${baseWageCost} + burden ${burdenCost}` +
      (overtimePremiumCost ? ` + OT premium ${overtimePremiumCost}` : '') +
      ` = ${totalLaborCost}`,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Equipment (RULE-003)
// ---------------------------------------------------------------------------

/** Rate sources in descending precedence. Index 0 wins. */
export const EQUIPMENT_RATE_PRECEDENCE = [
  'project_quote',
  'tenant_approved',
  'regional',
  'global_seed',
] as const;
export type EquipmentRateSource = (typeof EQUIPMENT_RATE_PRECEDENCE)[number];

export interface EquipmentRateCandidate {
  source: EquipmentRateSource;
  hourlyRate: number;
  dailyRate?: number;
  weeklyRate?: number;
  monthlyRate?: number;
  effectiveDate?: string;
  expiresOn?: string;
  reference?: string;
}

export interface ResolvedEquipmentRate {
  hourlyRate: number;
  dailyRate?: number;
  weeklyRate?: number;
  monthlyRate?: number;
  source: EquipmentRateSource;
  effectiveDate?: string;
  reference?: string;
  /** Every candidate considered, so the estimator can see what was overridden. */
  consideredSources: readonly EquipmentRateSource[];
  derivation: string;
  warnings: readonly string[];
}

/**
 * Apply the RULE-003 rate hierarchy.
 *
 * `asOf` is required, not optional. It lets a historical estimate re-resolve to
 * the rate that was actually in force when it was priced — and a default of
 * "today" would defeat exactly that: reopening a two-year-old estimate would
 * silently reprice it against the current rate sheet, and the caller would have
 * no indication it had happened. Reading the clock here would also make the
 * engine non-deterministic, which every other guarantee depends on.
 */
export function resolveEquipmentRate(
  candidates: readonly EquipmentRateCandidate[],
  asOf: string,
): ResolvedEquipmentRate {
  if (candidates.length === 0) {
    throw new RangeError('resolveEquipmentRate requires at least one rate candidate');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new RangeError(`asOf must be a YYYY-MM-DD date, received ${JSON.stringify(asOf)}`);
  }
  const warnings: string[] = [];
  const effectiveDay = asOf;

  const usable = candidates.filter((c) => {
    if (c.effectiveDate && c.effectiveDate > effectiveDay) {
      warnings.push(`${c.source} rate is not effective until ${c.effectiveDate}; excluded as of ${effectiveDay}.`);
      return false;
    }
    if (c.expiresOn && c.expiresOn < effectiveDay) {
      warnings.push(`${c.source} rate expired ${c.expiresOn}; excluded as of ${effectiveDay}.`);
      return false;
    }
    return true;
  });

  const pool = usable.length > 0 ? usable : candidates;
  if (usable.length === 0) {
    warnings.push('No rate candidate is currently effective; the highest-precedence rate was used and must be reviewed.');
  }

  let winner = pool[0]!;
  for (const c of pool) {
    if (
      EQUIPMENT_RATE_PRECEDENCE.indexOf(c.source) < EQUIPMENT_RATE_PRECEDENCE.indexOf(winner.source)
    ) {
      winner = c;
    }
  }
  assertNonNegative(winner.hourlyRate, 'hourlyRate');

  if (winner.source === 'global_seed') {
    warnings.push(
      'Equipment is priced from the GrounUp global seed rate. Replace it with a company or vendor rate before issuing.',
    );
  }

  const overridden = pool.filter((c) => c !== winner).map((c) => c.source);
  return {
    hourlyRate: unitRate(winner.hourlyRate),
    ...(winner.dailyRate !== undefined ? { dailyRate: money(winner.dailyRate) } : {}),
    ...(winner.weeklyRate !== undefined ? { weeklyRate: money(winner.weeklyRate) } : {}),
    ...(winner.monthlyRate !== undefined ? { monthlyRate: money(winner.monthlyRate) } : {}),
    source: winner.source,
    ...(winner.effectiveDate !== undefined ? { effectiveDate: winner.effectiveDate } : {}),
    ...(winner.reference !== undefined ? { reference: winner.reference } : {}),
    consideredSources: candidates.map((c) => c.source),
    derivation:
      `${winner.source} rate ${unitRate(winner.hourlyRate)}/hr selected` +
      (overridden.length ? ` over ${overridden.join(', ')}` : '') +
      ` per RULE-003 precedence`,
    warnings,
  };
}

export interface EquipmentItem {
  id: string;
  name: string;
  equipmentClass: string;
  rate: ResolvedEquipmentRate;
  count: number;
  /** Gallons of diesel per operating hour. */
  fuelGallonsPerHour: number;
  /** DEF consumption as a fraction of diesel volume. */
  defPercentOfFuel?: number;
  operatorRequired: boolean;
  mobilizationRequired?: boolean;
  mobilizationCost?: number;
}

export interface EquipmentCostResult {
  totalEquipmentHours: number;
  ownershipCost: number;
  mobilizationCost: number;
  fuelGallons: number;
  defGallons: number;
  fuelCost: number;
  defCost: number;
  /** Ownership + mobilization. Fuel is reported separately per RULE-001. */
  totalEquipmentCost: number;
  lines: readonly {
    equipmentId: string;
    name: string;
    count: number;
    operatingHours: number;
    hourlyRate: number;
    rateSource: EquipmentRateSource;
    ownershipCost: number;
    mobilizationCost: number;
    fuelGallons: number;
    fuelCost: number;
  }[];
  derivation: string;
  warnings: readonly string[];
}

/**
 * Cost an equipment spread over `operatingHoursPerUnit` hours.
 *
 * Fuel is computed from operating hours and burn rate (Section 29) and kept out
 * of `totalEquipmentCost` so that RULE-001's separation survives into the
 * rollup — a reader can always see what the iron cost and what the diesel cost.
 */
export function calculateEquipmentCost(
  items: readonly EquipmentItem[],
  operatingHoursPerUnit: number,
  fuelPricePerGallon: number,
  defPricePerGallon = 0,
): EquipmentCostResult {
  assertNonNegative(operatingHoursPerUnit, 'operatingHoursPerUnit');
  assertNonNegative(fuelPricePerGallon, 'fuelPricePerGallon');
  assertNonNegative(defPricePerGallon, 'defPricePerGallon');

  const warnings: string[] = [];
  const lines: EquipmentCostResult['lines'] = [];
  let totalEquipmentHours = 0;
  let fuelGallons = 0;
  let defGallons = 0;
  const ownershipCosts: number[] = [];
  const mobCosts: number[] = [];

  for (const item of items) {
    assertPositive(item.count, `equipment ${item.id} count`);
    assertNonNegative(item.fuelGallonsPerHour, `equipment ${item.id} fuelGallonsPerHour`);
    const opHours = operatingHoursPerUnit * item.count;
    const ownership = opHours * item.rate.hourlyRate;
    const mob = (item.mobilizationRequired ? (item.mobilizationCost ?? 0) : 0) * item.count;
    const gal = opHours * item.fuelGallonsPerHour;
    const def = gal * (item.defPercentOfFuel ?? 0);

    if (item.mobilizationRequired && !item.mobilizationCost) {
      warnings.push(
        `${item.name} is flagged as requiring mobilization but carries no mobilization cost; the move is unpriced.`,
      );
    }
    for (const w of item.rate.warnings) warnings.push(`${item.name}: ${w}`);

    totalEquipmentHours += opHours;
    fuelGallons += gal;
    defGallons += def;
    ownershipCosts.push(ownership);
    mobCosts.push(mob);

    (lines as EquipmentCostResult['lines'][number][]).push({
      equipmentId: item.id,
      name: item.name,
      count: item.count,
      operatingHours: roundHours(opHours),
      hourlyRate: item.rate.hourlyRate,
      rateSource: item.rate.source,
      ownershipCost: money(ownership),
      mobilizationCost: money(mob),
      fuelGallons: roundTo(gal, 2),
      fuelCost: money(gal * fuelPricePerGallon),
    });
  }

  const ownershipCost = sumMoney(ownershipCosts);
  const mobilizationCost = sumMoney(mobCosts);
  const fuelCost = money(fuelGallons * fuelPricePerGallon);
  const defCost = money(defGallons * defPricePerGallon);

  return {
    totalEquipmentHours: roundHours(totalEquipmentHours),
    ownershipCost,
    mobilizationCost,
    fuelGallons: roundTo(fuelGallons, 2),
    defGallons: roundTo(defGallons, 2),
    fuelCost,
    defCost,
    totalEquipmentCost: sumMoney([ownershipCost, mobilizationCost]),
    lines,
    derivation:
      `${roundHours(totalEquipmentHours)} equipment-hr; ownership ${ownershipCost}` +
      (mobilizationCost ? ` + mobilization ${mobilizationCost}` : '') +
      `; fuel ${roundTo(fuelGallons, 2)} gal @ ${unitRate(fuelPricePerGallon)} = ${fuelCost} (reported separately)`,
    warnings,
  };
}

/** Fuel gallons = operating hours x burn rate (Section 29). */
export function fuelGallons(operatingHours: number, gallonsPerHour: number): number {
  assertNonNegative(operatingHours, 'operatingHours');
  assertNonNegative(gallonsPerHour, 'gallonsPerHour');
  return roundTo(operatingHours * gallonsPerHour, 2);
}
