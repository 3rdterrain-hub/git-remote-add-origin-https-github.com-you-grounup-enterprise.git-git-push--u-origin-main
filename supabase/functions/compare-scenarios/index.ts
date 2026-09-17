/**
 * POST /functions/v1/compare-scenarios
 *
 * Price an estimate under stated assumptions, and report which driver moves it
 * most. **Writes nothing.**
 *
 * That is the whole reason this is a separate function from `price-estimate`
 * rather than a mode of it. A price is an engine output: migration 0058 lets
 * exactly one function write one, and it is granted to `service_role` alone.
 * A scenario is not a price — it is a question about a price — so nothing here
 * touches `estimate_versions`, and the answer goes back to the caller and no
 * further. An estimator can ask "what if fuel is up fifteen percent" as many
 * times as they like without changing what the bid says.
 *
 * Two things it answers, and they are different questions:
 *
 *   * **Scenarios.** Low, base and high, each a list of named adjustments with
 *     a stated reason. The estimator supplies them, because an assumption the
 *     platform invented is an assumption nobody can defend to an owner. The
 *     engine refuses a set without exactly one base, and asserts that pricing
 *     the base reproduces the unadjusted estimate to the cent — if the base
 *     moves, the machinery is changing the answer rather than exploring it.
 *
 *   * **Sensitivity.** Every driver moved on its own by one stated factor, and
 *     ranked by what it did to the bid. This invents nothing at all: it is
 *     measurement, not assumption, and it answers the question an estimator
 *     actually has — not "what could go wrong" but "which of these is worth my
 *     attention".
 *
 * Read with the caller's own client, so a version they cannot see is a version
 * they cannot ask about.
 *
 * Deploy: supabase functions deploy compare-scenarios
 */
import { getCaller, requirePermission, isUuid } from '../_shared/auth.ts';
import { fail, json, preflight } from '../_shared/http.ts';
import { buildEstimateInput } from '../_shared/estimate-pricing.ts';
import { loadEstimateSnapshot } from '../_shared/estimate-snapshot.ts';
import { priceScenarios, analyzeSensitivity } from '../_shared/engine/scenarios.js';
import { readScenarios } from '../_shared/scenario-input.ts';

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req);
  if (pre) return pre;
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') return fail('method_not_allowed', 'Use POST.', 405, origin);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const versionId = body.estimateVersionId;
  if (!isUuid(versionId)) {
    return fail('bad_request', 'A valid estimateVersionId is required.', 400, origin);
  }

  const caller = await getCaller(req);
  if (!caller) return fail('unauthenticated', 'Sign in first.', 401, origin);

  const loaded = await loadEstimateSnapshot(caller.client, String(versionId));
  if (!loaded.ok) {
    return fail(loaded.failure.code, loaded.failure.message, loaded.failure.status, origin);
  }
  const { snapshot, version } = loaded;

  /*
   * Reading a price, not writing one. `estimates.read` is the right permission:
   * somebody who may look at a bid may ask what would move it.
   */
  const allowed = await requirePermission(
    caller, String(version.company_id), 'estimates.read');
  if (!allowed.ok) return fail('forbidden', allowed.reason, 403, origin);

  const asOf = typeof body.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.asOf)
    ? body.asOf
    : new Date().toISOString().slice(0, 10);

  const { input, problems } = buildEstimateInput(snapshot, asOf);
  if (problems.length > 0) {
    /*
     * The same holes that stop it being priced stop it being explored. Reported
     * with the list rather than as a generic failure, because a comparison of
     * an estimate that cannot be priced is a comparison of nothing.
     */
    return json({ error: {
      code: 'cannot_price',
      message: 'This estimate cannot be priced yet, so there is nothing to compare.',
      problems,
    } }, 422, origin);
  }

  /* Sensitivity always: it invents nothing and answers the commoner question. */
  const factor = Number(body.sensitivityFactor);
  const sensitivityFactor = Number.isFinite(factor) && factor > 0 && factor !== 1
    ? factor : 1.1;

  let sensitivity;
  try {
    sensitivity = analyzeSensitivity(input, { factor: sensitivityFactor });
  } catch (e) {
    return fail('bad_request', e instanceof Error ? e.message : String(e), 422, origin);
  }

  /* Scenarios only when the caller states them. Nothing is assumed on their behalf. */
  let comparison = null;
  if (body.scenarios !== undefined) {
    const read = readScenarios(body.scenarios);
    if ('error' in read) return fail('bad_request', read.error, 400, origin);
    try {
      comparison = priceScenarios(input, read.scenarios);
    } catch (e) {
      return fail('bad_request', e instanceof Error ? e.message : String(e), 422, origin);
    }
  }

  return json({
    estimateVersionId: versionId,
    asOf,
    sensitivity: {
      basePrice: sensitivity.basePrice,
      factor: sensitivity.factor,
      entries: sensitivity.entries,
      mostSensitive: sensitivity.mostSensitive,
      derivation: sensitivity.derivation,
    },
    comparison: comparison ? {
      base: { name: comparison.base.scenario.name, bidPrice: comparison.base.bidPrice },
      scenarios: comparison.scenarios.map((s) => ({
        id: s.scenario.id,
        name: s.scenario.name,
        kind: s.scenario.kind,
        adjustments: s.scenario.adjustments,
        directCost: s.directCost,
        totalPrice: s.totalPrice,
        bidPrice: s.bidPrice,
        deltaFromBase: s.deltaFromBase,
        deltaPercentFromBase: s.deltaPercentFromBase,
        derivation: s.derivation,
      })),
      lowest: comparison.lowest.scenario.name,
      highest: comparison.highest.scenario.name,
      spread: comparison.spread,
      spreadPercentOfBase: comparison.spreadPercentOfBase,
      derivation: comparison.derivation,
      warnings: comparison.warnings,
    } : null,
  }, 200, origin);
});
