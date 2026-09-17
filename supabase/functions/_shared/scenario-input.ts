/**
 * What a caller sent, turned into scenarios the engine will accept.
 *
 * Separate from the handler so it can be tested without a server, the same way
 * `estimate-pricing.ts` is. What it refuses matters more than what it accepts:
 *
 *   * a driver the engine cannot move, named with the list of ones it can;
 *   * a factor that is not a positive number;
 *   * and an adjustment with no reason given.
 *
 * That last one is the point. "High is base plus twenty percent" tells an
 * estimator nothing they can defend, and it is the first thing asked about at a
 * bid opening — so a scenario that will not say why is refused here rather than
 * priced and shown.
 */
import {
  SCENARIO_DRIVERS, type Scenario, type ScenarioDriver,
} from './engine/scenarios.js';

/** A scenario as it arrives over the wire, before it is trusted. */
interface ScenarioBody {
  id?: unknown;
  name?: unknown;
  kind?: unknown;
  adjustments?: unknown;
}

const KINDS = ['low', 'base', 'high', 'custom'];

/**
 * Turn what the caller sent into scenarios the engine will accept.
 *
 * Every adjustment must name a driver the engine knows, carry a finite factor,
 * and say why. The rationale is not decoration: "high is base plus twenty
 * percent" tells an estimator nothing they can defend, and this refuses it
 * rather than pricing it.
 */
export function readScenarios(raw: unknown): { scenarios: Scenario[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'scenarios must be an array.' };
  const scenarios: Scenario[] = [];

  for (const [i, entry] of raw.entries()) {
    const s = entry as ScenarioBody;
    const id = typeof s.id === 'string' && s.id.trim() ? s.id.trim() : `S${i + 1}`;
    const name = typeof s.name === 'string' && s.name.trim() ? s.name.trim() : id;
    const kind = typeof s.kind === 'string' && KINDS.includes(s.kind) ? s.kind : 'custom';
    if (!Array.isArray(s.adjustments)) {
      return { error: `Scenario "${name}" has no adjustments.` };
    }

    const adjustments = [];
    for (const a of s.adjustments as Array<Record<string, unknown>>) {
      const driver = String(a.driver ?? '');
      if (!SCENARIO_DRIVERS.includes(driver as ScenarioDriver)) {
        return {
          error: `Scenario "${name}" adjusts "${driver}", which is not something the engine `
            + `can move. It knows: ${SCENARIO_DRIVERS.join(', ')}.`,
        };
      }
      const factor = Number(a.factor);
      if (!Number.isFinite(factor) || factor <= 0) {
        return { error: `Scenario "${name}" gives ${driver} a factor of ${a.factor}.` };
      }
      const rationale = typeof a.rationale === 'string' ? a.rationale.trim() : '';
      if (rationale.length < 3) {
        return {
          error: `Scenario "${name}" moves ${driver} without saying why. An unexplained `
            + 'factor is noise, and it is the first thing an owner asks about.',
        };
      }
      adjustments.push({ driver: driver as ScenarioDriver, factor, rationale });
    }

    scenarios.push({ id, name, kind: kind as Scenario['kind'], adjustments });
  }
  return { scenarios };
}
