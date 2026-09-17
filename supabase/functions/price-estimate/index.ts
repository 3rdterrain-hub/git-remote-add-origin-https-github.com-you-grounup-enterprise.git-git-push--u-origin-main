/**
 * POST /functions/v1/price-estimate
 *
 * Price an estimate version with the deterministic engine.
 *
 * This is the only path by which a price comes to exist. Since migration 0058
 * the engine-output columns on `estimate_versions`, `estimate_line_items` and
 * `estimate_line_resources` refuse a hand-written value, and the one function
 * permitted to write them is granted to `service_role` alone. A browser holds
 * the anon key and a user's JWT and can reach neither, however senior the
 * person signed in — pricing is not a permission somebody can hold, it is an
 * operation only this function performs.
 *
 * Three checks stand in front of it, in this order:
 *
 *   1. **Authentication.** No caller, no pricing.
 *   2. **Authorization**, asked of the database through the caller's own
 *      client, so the answer is the one row level security would give.
 *   3. **Loading through the caller's client**, not the admin one. The
 *      estimate is read subject to RLS, so a caller who cannot see a version
 *      cannot cause it to be priced — the service role is used for the write
 *      and for nothing else.
 *
 * `asOf` is the estimate's own date rather than today's, so repricing an old
 * version resolves the rates that were in force when it was written instead of
 * silently repricing it against the current rate sheet.
 *
 * Deploy: supabase functions deploy price-estimate
 */
import { getCaller, requirePermission, isUuid, adminClient } from '../_shared/auth.ts';
import { fail, json, preflight } from '../_shared/http.ts';
import { priceEstimate } from '../_shared/estimate-pricing.ts';
import { loadEstimateSnapshot } from '../_shared/estimate-snapshot.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') return fail('method_not_allowed', 'Use POST.', 405, origin);

  try {
    const caller = await getCaller(req);
    if (!caller) return fail('unauthenticated', 'Sign in to price an estimate.', 401, origin);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const versionId = body.estimateVersionId;
    if (!isUuid(versionId)) {
      return fail('bad_request', 'A valid estimateVersionId is required.', 400, origin);
    }

    /*
     * Read through the caller's own client: row level security decides what
     * they can see, and a version they cannot see is a version they cannot
     * cause to be priced.
     *
     * The loading itself lives in `_shared/estimate-snapshot.ts` so the
     * scenario comparison reads the *same* estimate. Two copies of these
     * selects would drift — adding `fringe_per_hour` already meant editing two
     * of them by hand — and a comparison against a differently-loaded estimate
     * is a comparison of two different jobs.
     */
    const loaded = await loadEstimateSnapshot(caller.client, versionId);
    if (!loaded.ok) {
      return fail(loaded.failure.code, loaded.failure.message, loaded.failure.status, origin);
    }
    const { snapshot, version: row } = loaded;
    const companyId = String(row.company_id);

    const permitted = await requirePermission(caller, companyId, 'estimates.write');
    if (!permitted.ok) return fail('forbidden', permitted.reason, 403, origin);

    /*
     * An issued version is frozen by RULE-009 and repricing it would be refused
     * by the database anyway. Refusing here says why, rather than surfacing a
     * trigger's exception to somebody who pressed a button.
     */
    if (['issued', 'awarded', 'lost', 'archived'].includes(String(row.status))) {
      return fail('conflict',
        `This version is ${row.status} and its price is frozen. Revise it to price again.`,
        409, origin);
    }

    // The estimate's own date, not today's. Repricing a two-year-old version
    // must resolve the rates that were in force when it was written.
    const asOf = typeof body.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.asOf)
      ? body.asOf
      : new Date().toISOString().slice(0, 10);

    let priced;
    try {
      priced = priceEstimate(snapshot, asOf);
    } catch (err) {
      /*
       * The engine refusing to compute is a real answer about the estimate, not
       * a server fault: a rate resolved as of a date with no candidates in
       * force, a quantity that cannot be reconciled. Reported as such.
       */
      return json({ error: {
        code: 'cannot_price',
        message: err instanceof Error ? err.message : 'The estimate could not be priced.',
      } }, 422, origin);
    }

    /*
     * A hole in the estimate stops the write. Pricing around a missing
     * equipment rate would put a confident number on a page that nothing
     * supports, which is the failure this whole boundary exists to prevent.
     */
    if (priced.problems.length > 0) {
      // The standard error envelope, so `callFunction` surfaces the code and
      // message like every other failure — with the problem list carried along
      // so the workspace can point at the lines rather than say "something".
      return json({ error: {
        code: 'incomplete',
        message: `This estimate is missing information the engine needs (${priced.problems.length}).`,
        problems: priced.problems,
      } }, 422, origin);
    }

    // The one writer. Service role, because nothing else may write a price.
    const { error: writeError } = await adminClient().rpc('record_engine_result', {
      p_version_id: versionId,
      p_engine_version: priced.payload.engineVersion,
      p_version: priced.payload.version,
      p_lines: priced.payload.lines,
    });
    if (writeError) return fail('write_failed', writeError.message, 400, origin);

    return json({
      engineVersion: priced.payload.engineVersion,
      directCost: priced.result.totalDirectCost,
      indirectCost: priced.result.indirectCost,
      totalPrice: priced.result.price.totalPrice,
      bidPrice: priced.result.bidPrice,
      grossMarginPercent: priced.result.price.grossMarginPercent,
      weightedConfidence: priced.result.weightedConfidence,
      confidenceBand: priced.result.confidenceBand,
      recommendedContingency: priced.result.recommendedContingency,
      appliedContingency: priced.result.appliedContingency,
      executiveDecision: priced.result.executiveDecision,
      executiveDecisionReason: priced.result.executiveDecisionReason,
      blockedFromIssue: priced.result.blockedFromIssue,
      totalLaborHours: priced.result.totalLaborHours,
      totalDurationDays: priced.result.totalDurationDays,
      warnings: priced.result.warnings,
      lineCount: priced.result.lines.length,
    }, 200, origin);
  } catch (err) {
    return fail('internal_error',
      err instanceof Error ? err.message : 'Pricing failed.', 500, origin);
  }
});
