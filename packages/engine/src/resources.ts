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
  /**
   * Taxes, insurance and company burden as a fraction of base wage.
   *
   * On an open-shop rate this also carries fringe, because a shop expresses the
   * whole load as one percentage. A union scale or a prevailing wage
   * determination does not: it publishes fringe as a fixed number of dollars an
   * hour, which is `fringePerHour` below. A rate uses one or the other, and the
   * screen showing it says which.
   */
  burdenPercent: number;
  /**
   * Fringe in dollars per hour, as a determination or an agreement publishes it.
   *
   * Zero on an open-shop rate, which is why adding this moves no existing
   * number. Paid on hours *worked* rather than hours *paid*, so it takes no
   * overtime multiplier — that is how Davis-Bacon computes it, and doing it the
   * other way overstates the cost of every overtime hour on a public job.
   */
  fringePerHour?: number;
  /**
   * Whether the fringe is paid as cash in lieu.
   *
   * Cash fringe is wages and carries payroll burden with it; fringe paid into a
   * plan does not. The difference is real money at scale, and it is a fact
   * about how the contractor pays rather than about the determination.
   */
  fringeIsTaxable?: boolean;
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
  /** Stated fringe, in dollars per hour. Zero where the rate carries none. */
  fringePerHour: number;
  /** Burden charged on a cash fringe, which is wages. Zero for plan fringe. */
  fringeBurdenPerHour: number;
  /** Base + burden + fringe. The rate the cost engine multiplies by hours. */
  loadedPerHour: number;
  derivation: string;
}

/**
 * Loaded rate = base x (1 + burden), plus any stated fringe.
 *
 * Burden is reported separately per RULE-001, and so is fringe: a determination
 * is argued line by line, and a single loaded number nobody can take apart is a
 * number nobody can defend against an auditor.
 *
 * With no fringe this is exactly what it has always been, down to the wording of
 * the derivation — which is what makes adding it safe for every open-shop rate
 * already on file.
 */
export function loadedLaborRate(labor: LaborClassification): LoadedLaborRate {
  assertNonNegative(labor.baseWagePerHour, `labor ${labor.id} baseWagePerHour`);
  assertNonNegative(labor.burdenPercent, `labor ${labor.id} burdenPercent`);
  assertNonNegative(labor.fringePerHour ?? 0, `labor ${labor.id} fringePerHour`);
  const burdenPerHour = unitRate(labor.baseWagePerHour * labor.burdenPercent);
  const fringePerHour = unitRate(labor.fringePerHour ?? 0);
  const fringeBurdenPerHour = labor.fringeIsTaxable
    ? unitRate(fringePerHour * labor.burdenPercent)
    : 0;
  const loadedPerHour = unitRate(
    labor.baseWagePerHour + burdenPerHour + fringePerHour + fringeBurdenPerHour,
  );
  return {
    classificationId: labor.id,
    classification: labor.classification,
    baseWagePerHour: unitRate(labor.baseWagePerHour),
    burdenPercent: factor(labor.burdenPercent),
    burdenPerHour,
    fringePerHour,
    fringeBurdenPerHour,
    loadedPerHour,
    derivation: `${unitRate(labor.baseWagePerHour)} base x (1 + ${factor(labor.burdenPercent)} burden)`
      + (fringePerHour
        ? ` + ${fringePerHour} fringe${fringeBurdenPerHour ? ` + ${fringeBurdenPerHour} burden on cash fringe` : ''}`
        : '')
      + ` = ${loadedPerHour}/hr loaded`,
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
    /*
     * Fringe is paid on hours *worked*, not hours *paid*: an overtime hour
     * earns time and a half in wages and one hour of fringe. Multiplying fringe
     * by the overtime factor overstates the cost of every overtime hour on a
     * public job, which is the kind of error that loses a bid without anybody
     * seeing why.
     *
     * It lands in the burden bucket rather than the wage bucket, because it is
     * not the wage — RULE-001, and the same place an open-shop rate's fringe
     * already lands through `burdenPercent`.
     */
    const fringePerHour = member.classification.fringePerHour ?? 0;
    const fringeCost = fringePerHour * (stHours + otHours + dtHours);
    const fringeBurden = member.classification.fringeIsTaxable
      ? fringeCost * member.classification.burdenPercent
      : 0;
    const burdenCost = (baseWageCost + otPremiumBase) * member.classification.burdenPercent
      + fringeCost + fringeBurden;

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
