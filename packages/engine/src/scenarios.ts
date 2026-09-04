/**
 * Scenario pricing.
 *
 * A single number is a poor answer to "what will this cost". The honest answer
 * is a range, with the reason it is a range: production could be 15% worse in
 * wet ground, fuel could be up a quarter by the time the work runs, the
 * measured quantity could be 5% out.
 *
 * A scenario states those assumptions explicitly and prices the estimate under
 * them. Three properties make that trustworthy, and each is enforced:
 *
 *   * **The base scenario is the estimate.** Pricing the base must return
 *     exactly the unadjusted figure, to the cent. A base that drifts means the
 *     scenario machinery is changing the answer rather than exploring it.
 *   * **Every adjustment is named and reversible.** A scenario is a list of
 *     stated changes to stated drivers, not an opaque multiplier on the total.
 *     "High is base plus 20%" tells an estimator nothing they can defend.
 *   * **One driver at a time is measurable.** Sensitivity varies a single
 *     driver and reports what the price did, which is how an estimator finds
 *     the thing actually worth managing.
 */

import { money, roundTo, safeDivide } from './numeric.js';
import { calculateEstimate, type EstimateInput, type EstimateResult } from './estimate.js';

/**
 * The drivers a scenario may move.
 *
 * Deliberately a closed set. An open one would let a scenario adjust something
 * the derivation cannot explain, and an unexplained price movement is the thing
 * this module exists to prevent.
 */
export type ScenarioDriver =
  | 'quantity'
  | 'production'
  | 'labor_wage'
  | 'labor_burden'
  | 'equipment_rate'
  | 'fuel_price'
  | 'material_cost'
  | 'subcontract_cost'
  | 'waste'
  | 'calendar_efficiency'
  | 'contingency';

export const SCENARIO_DRIVERS: readonly ScenarioDriver[] = [
  'quantity', 'production', 'labor_wage', 'labor_burden', 'equipment_rate',
  'fuel_price', 'material_cost', 'subcontract_cost', 'waste',
  'calendar_efficiency', 'contingency',
];

/** What each driver means when it moves, so a report can say it in words. */
export const DRIVER_LABELS: Readonly<Record<ScenarioDriver, string>> = Object.freeze({
  quantity: 'measured quantity',
  production: 'production rate',
  labor_wage: 'labor wage',
  labor_burden: 'labor burden',
  equipment_rate: 'equipment hourly rate',
  fuel_price: 'fuel price',
  material_cost: 'material unit cost',
  subcontract_cost: 'subcontract cost',
  waste: 'waste allowance',
  calendar_efficiency: 'calendar efficiency',
  contingency: 'contingency percent',
});

export interface ScenarioAdjustment {
  driver: ScenarioDriver;
  /** Multiplier on the driver. 1.15 is 15% more; 0.85 is 15% less. */
  factor: number;
  /** Why this scenario assumes it. Required: an unexplained factor is noise. */
  rationale: string;
}

export interface Scenario {
  id: string;
  name: string;
  kind: 'low' | 'base' | 'high' | 'custom';
  adjustments: readonly ScenarioAdjustment[];
}

const MIN_FACTOR = 0.01;
const MAX_FACTOR = 100;

function assertFactor(f: number, driver: ScenarioDriver): number {
  if (!Number.isFinite(f) || f < MIN_FACTOR || f > MAX_FACTOR) {
    throw new RangeError(
      `${driver} factor must be between ${MIN_FACTOR} and ${MAX_FACTOR}, received ${f}`,
    );
  }
  return f;
}

/** Collapse a scenario's adjustments into one factor per driver. */
function factorsOf(scenario: Scenario): Map<ScenarioDriver, number> {
  const out = new Map<ScenarioDriver, number>();
  for (const a of scenario.adjustments) {
    if (!SCENARIO_DRIVERS.includes(a.driver)) {
      throw new RangeError(`Unknown scenario driver ${JSON.stringify(a.driver)}`);
    }
    assertFactor(a.factor, a.driver);
    if (!a.rationale.trim()) {
      throw new RangeError(
        `${scenario.id}: the ${DRIVER_LABELS[a.driver]} adjustment has no rationale. `
        + 'A factor nobody can explain is not an assumption, it is noise.',
      );
    }
    if (out.has(a.driver)) {
      // Two factors on one driver could mean either compounded or replaced.
      // Refusing is better than picking one and being wrong quietly.
      throw new RangeError(
        `${scenario.id} adjusts ${DRIVER_LABELS[a.driver]} twice. State one factor per driver.`,
      );
    }
    out.set(a.driver, a.factor);
  }
  return out;
}

/**
 * Apply a scenario's factors to an estimate input.
 *
 * Production and calendar efficiency move *inversely* to cost: a 0.85
 * production factor means the crew is slower, which makes the job cost more.
 * Every other driver moves with cost. Getting that backwards is the classic
 * scenario bug, and it produces a low case that is more expensive than the high.
 */
export function applyScenario(input: EstimateInput, scenario: Scenario): EstimateInput {
  const f = factorsOf(scenario);
  if (f.size === 0) return structuredClone(input) as EstimateInput;

  const g = (d: ScenarioDriver): number => f.get(d) ?? 1;
  const next = structuredClone(input) as EstimateInput;

  const lines = next.lines.map((line) => {
    const l = { ...line } as Record<string, unknown>;

    l.quantity = {
      ...line.quantity,
      measured: roundTo(line.quantity.measured * g('quantity'), 6),
      ...(line.quantity.wastePercent !== undefined
        ? { wastePercent: roundTo(line.quantity.wastePercent * g('waste'), 6) }
        : {}),
    };

    if (line.productionRate) {
      l.productionRate = {
        ...line.productionRate,
        ratePerHour: roundTo(line.productionRate.ratePerHour * g('production'), 6),
      };
    }

    if (line.crew) {
      l.crew = {
        ...line.crew,
        members: line.crew.members.map((m) => ({
          ...m,
          classification: {
            ...m.classification,
            baseWagePerHour: money(m.classification.baseWagePerHour * g('labor_wage')),
            burdenPercent: roundTo(m.classification.burdenPercent * g('labor_burden'), 6),
          },
        })),
      };
    }

    if (line.equipment) {
      l.equipment = line.equipment.map((e) => ({
        ...e,
        rate: { ...e.rate, hourlyRate: money(e.rate.hourlyRate * g('equipment_rate')) },
      }));
    }

    if (line.materials) {
      l.materials = line.materials.map((m) => ({
        ...m,
        unitCost: money(m.unitCost * g('material_cost')),
      }));
    }

    if (line.fuelPricePerGallon !== undefined) {
      l.fuelPricePerGallon = money(line.fuelPricePerGallon * g('fuel_price'));
    }
    if (line.subcontractCost !== undefined) {
      l.subcontractCost = money(line.subcontractCost * g('subcontract_cost'));
    }
    if (line.calendarEfficiency !== undefined) {
      // Efficiency is a fraction of a day actually worked; it cannot exceed 1.
      l.calendarEfficiency = Math.min(1, roundTo(line.calendarEfficiency * g('calendar_efficiency'), 6));
    }
    return l as unknown as EstimateInput['lines'][number];
  });

  const contingencyFactor = g('contingency');
  const profile = contingencyFactor === 1 ? next.pricingProfile : {
    ...next.pricingProfile,
    components: next.pricingProfile.components.map((c) =>
      c.code.toLowerCase().includes('conting')
        ? { ...c, percent: roundTo(c.percent * contingencyFactor, 6) }
        : c),
  };

  return { ...next, lines, pricingProfile: profile };
}

export interface ScenarioResult {
  scenario: Scenario;
  result: EstimateResult;
  directCost: number;
  totalPrice: number;
  bidPrice: number;
  /** Difference from the base scenario, in money and as a fraction. */
  deltaFromBase: number;
  deltaPercentFromBase: number;
  derivation: string;
}

export interface ScenarioComparison {
  base: ScenarioResult;
  scenarios: readonly ScenarioResult[];
  lowest: ScenarioResult;
  highest: ScenarioResult;
  /** Highest bid less lowest bid. */
  spread: number;
  spreadPercentOfBase: number;
  derivation: readonly string[];
  warnings: readonly string[];
}

export class ScenarioSetError extends Error {}

/**
 * Price an estimate under every scenario and compare them.
 *
 * Exactly one scenario must be the base, and pricing it must reproduce the
 * unadjusted estimate to the cent. That identity is asserted here rather than
 * assumed: if the base moves, the machinery is changing the answer instead of
 * exploring it, and every other scenario is measured against a number that is
 * already wrong.
 */
export function priceScenarios(
  input: EstimateInput,
  scenarios: readonly Scenario[],
): ScenarioComparison {
  const bases = scenarios.filter((s) => s.kind === 'base');
  if (bases.length !== 1) {
    throw new ScenarioSetError(
      `A scenario set needs exactly one base to measure the others against; found ${bases.length}.`,
    );
  }
  const ids = scenarios.map((s) => s.id);
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate) throw new ScenarioSetError(`Duplicate scenario id ${duplicate}.`);

  const unadjusted = calculateEstimate(input);
  const priced = scenarios.map((scenario) => {
    const result = calculateEstimate(applyScenario(input, scenario));
    return { scenario, result };
  });

  const baseEntry = priced.find((p) => p.scenario.kind === 'base')!;
  if (baseEntry.result.bidPrice !== unadjusted.bidPrice) {
    throw new ScenarioSetError(
      `The base scenario priced at ${baseEntry.result.bidPrice} but the estimate prices at `
      + `${unadjusted.bidPrice}. The base must reproduce the estimate exactly, or every other `
      + 'scenario is measured against a number that is already wrong.',
    );
  }
  const basePrice = baseEntry.result.bidPrice;

  const results: ScenarioResult[] = priced.map(({ scenario, result }) => {
    const delta = money(result.bidPrice - basePrice);
    const factors = factorsOf(scenario);
    const stated = [...factors.entries()]
      .map(([d, f]) => `${DRIVER_LABELS[d]} x${f}`)
      .join(', ');
    return {
      scenario, result,
      directCost: result.totalDirectCost,
      totalPrice: result.price.totalPrice,
      bidPrice: result.bidPrice,
      deltaFromBase: delta,
      deltaPercentFromBase: basePrice > 0 ? roundTo(safeDivide(delta, basePrice), 6) : 0,
      derivation: scenario.kind === 'base'
        ? `${scenario.name}: the estimate as priced, ${basePrice}`
        : `${scenario.name}: ${stated || 'no adjustments'} -> ${result.bidPrice}`
          + ` (${delta >= 0 ? '+' : ''}${delta} from base)`,
    };
  });

  const sorted = [...results].sort((a, b) => a.bidPrice - b.bidPrice);
  const lowest = sorted[0]!;
  const highest = sorted[sorted.length - 1]!;
  const spread = money(highest.bidPrice - lowest.bidPrice);

  const warnings: string[] = [];
  const low = results.find((r) => r.scenario.kind === 'low');
  const high = results.find((r) => r.scenario.kind === 'high');
  if (low && high && low.bidPrice > high.bidPrice) {
    // Almost always a driver applied the wrong way round: production and
    // calendar efficiency move inversely to cost.
    warnings.push(
      `The low scenario (${low.bidPrice}) prices above the high scenario (${high.bidPrice}). `
      + 'Check the direction of the production and calendar efficiency factors.',
    );
  }
  if (basePrice > 0 && spread / basePrice > 0.5) {
    warnings.push(
      `The scenarios span ${roundTo((spread / basePrice) * 100, 1)}% of the base price. `
      + 'A range that wide usually means an assumption needs resolving rather than pricing.',
    );
  }

  return {
    base: results.find((r) => r.scenario.kind === 'base')!,
    scenarios: results,
    lowest, highest, spread,
    spreadPercentOfBase: basePrice > 0 ? roundTo(safeDivide(spread, basePrice), 6) : 0,
    derivation: [
      `${results.length} scenario(s) against a base of ${basePrice}`,
      ...results.map((r) => `  ${r.derivation}`),
      `  spread ${lowest.bidPrice} to ${highest.bidPrice} = ${spread}`,
    ],
    warnings,
  };
}

export interface SensitivityEntry {
  driver: ScenarioDriver;
  label: string;
  factor: number;
  bidPrice: number;
  delta: number;
  deltaPercent: number;
  /** Price change per 1% change in the driver. The comparable number. */
  elasticity: number;
}

export interface SensitivityReport {
  basePrice: number;
  factor: number;
  entries: readonly SensitivityEntry[];
  /** The driver whose movement costs the most. What is worth managing. */
  mostSensitive: SensitivityEntry | null;
  derivation: readonly string[];
}

/**
 * Vary one driver at a time and report what the price did.
 *
 * This is the question an estimator actually asks — "what if fuel rises 15%?"
 * — and answering it one driver at a time is what makes the answer usable.
 * Moving several at once tells you the total moved, not which lever to pull.
 */
export function analyzeSensitivity(
  input: EstimateInput,
  options: { factor?: number; drivers?: readonly ScenarioDriver[] } = {},
): SensitivityReport {
  const factor = options.factor ?? 1.1;
  assertFactor(factor, 'quantity');
  if (factor === 1) {
    throw new RangeError('A sensitivity factor of 1 moves nothing and measures nothing.');
  }
  const drivers = options.drivers ?? SCENARIO_DRIVERS;
  const basePrice = calculateEstimate(input).bidPrice;
  const changePercent = Math.abs(factor - 1) * 100;

  const entries: SensitivityEntry[] = drivers.map((driver) => {
    const scenario: Scenario = {
      id: `SENS-${driver}`, name: `${DRIVER_LABELS[driver]} x${factor}`, kind: 'custom',
      adjustments: [{ driver, factor, rationale: `Sensitivity probe at x${factor}` }],
    };
    const bidPrice = calculateEstimate(applyScenario(input, scenario)).bidPrice;
    const delta = money(bidPrice - basePrice);
    return {
      driver, label: DRIVER_LABELS[driver], factor, bidPrice, delta,
      deltaPercent: basePrice > 0 ? roundTo(safeDivide(delta, basePrice), 6) : 0,
      elasticity: money(safeDivide(delta, changePercent)),
    };
  });

  const ranked = [...entries].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const mostSensitive = ranked[0] && ranked[0].delta !== 0 ? ranked[0] : null;

  return {
    basePrice, factor, entries: ranked, mostSensitive,
    derivation: [
      `Base ${basePrice}; each driver moved to x${factor} independently`,
      ...ranked.map((e) =>
        `  ${e.label}: ${e.bidPrice} (${e.delta >= 0 ? '+' : ''}${e.delta}, `
        + `${e.elasticity >= 0 ? '+' : ''}${e.elasticity} per 1% move)`),
    ],
  };
}
