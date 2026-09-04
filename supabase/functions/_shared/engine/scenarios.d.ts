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
import { type EstimateInput, type EstimateResult } from './estimate.js';
/**
 * The drivers a scenario may move.
 *
 * Deliberately a closed set. An open one would let a scenario adjust something
 * the derivation cannot explain, and an unexplained price movement is the thing
 * this module exists to prevent.
 */
export type ScenarioDriver = 'quantity' | 'production' | 'labor_wage' | 'labor_burden' | 'equipment_rate' | 'fuel_price' | 'material_cost' | 'subcontract_cost' | 'waste' | 'calendar_efficiency' | 'contingency';
export declare const SCENARIO_DRIVERS: readonly ScenarioDriver[];
/** What each driver means when it moves, so a report can say it in words. */
export declare const DRIVER_LABELS: Readonly<Record<ScenarioDriver, string>>;
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
/**
 * Apply a scenario's factors to an estimate input.
 *
 * Production and calendar efficiency move *inversely* to cost: a 0.85
 * production factor means the crew is slower, which makes the job cost more.
 * Every other driver moves with cost. Getting that backwards is the classic
 * scenario bug, and it produces a low case that is more expensive than the high.
 */
export declare function applyScenario(input: EstimateInput, scenario: Scenario): EstimateInput;
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
export declare class ScenarioSetError extends Error {
}
/**
 * Price an estimate under every scenario and compare them.
 *
 * Exactly one scenario must be the base, and pricing it must reproduce the
 * unadjusted estimate to the cent. That identity is asserted here rather than
 * assumed: if the base moves, the machinery is changing the answer instead of
 * exploring it, and every other scenario is measured against a number that is
 * already wrong.
 */
export declare function priceScenarios(input: EstimateInput, scenarios: readonly Scenario[]): ScenarioComparison;
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
export declare function analyzeSensitivity(input: EstimateInput, options?: {
    factor?: number;
    drivers?: readonly ScenarioDriver[];
}): SensitivityReport;
