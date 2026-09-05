/**
 * POST /functions/v1/replay-stripe-event
 *
 * Applies a Stripe event that arrived and never finished.
 *
 * The shape of this is deliberate, and it is the whole security argument:
 *
 *   1. The caller is an operator holding `webhooks.retry`. That is checked by
 *      `app.claim_event_replay` **as the caller**, not here — so the answer
 *      comes from the database rather than from this function remembering to
 *      ask.
 *   2. The payload comes back from that same call, read out of `stripe_events`.
 *      Nothing the caller sends is applied. They name an event id; they cannot
 *      supply an event.
 *   3. A payload only reaches `stripe_events` after its signature was verified
 *      on arrival, so replaying one is replaying something Stripe demonstrably
 *      sent.
 *   4. The applying is `handleEvent` — the same function the live webhook runs,
 *      not a second copy of it.
 *   5. The outcome is written by `finish_event_replay`, which only service_role
 *      may execute: the operator who asked for a replay cannot also be the one
 *      who declares it successful.
 */
import { getCaller, adminClient } from '../_shared/auth.ts';
import { fail, json, preflight } from '../_shared/http.ts';
import { handleEvent, type StripeEventLike } from '../_shared/stripe-events.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const origin = req.headers.get('origin');

  if (req.method !== 'POST') return fail('method_not_allowed', 'Use POST.', 405, origin);

  let claimed: { replay_id: string; event_type: string; payload: unknown } | null = null;

  try {
    const caller = await getCaller(req);
    if (!caller) return fail('unauthenticated', 'Sign in as an operator.', 401, origin);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'A JSON body is required.', 400, origin);
    }
    const { eventId, reason } = body as Record<string, unknown>;
    if (typeof eventId !== 'string' || eventId.length === 0) {
      return fail('bad_request', 'An eventId is required.', 400, origin);
    }
    if (typeof reason !== 'string' || reason.trim().length < 5) {
      return fail('bad_request', 'Say why this is being replayed.', 400, origin);
    }

    /*
     * Claimed through the caller's own client, so the permission check, the
     * "is there anything to replay" check and the record of who asked all
     * happen as them. A refusal here is the database's refusal.
     */
    const { data, error } = await caller.client
      .rpc('claim_event_replay', { p_event: eventId, p_reason: reason.trim() });
    if (error) {
      const denied = /permission/i.test(error.message);
      return fail(denied ? 'forbidden' : 'bad_request', error.message,
                  denied ? 403 : 400, origin);
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return fail('not_found', 'That event is not available to replay.', 404, origin);
    claimed = row as { replay_id: string; event_type: string; payload: unknown };

    const admin = adminClient();
    const event = claimed.payload as StripeEventLike;
    if (!event || typeof event.id !== 'string' || event.id !== eventId) {
      // The stored payload does not describe the event it is filed under. That
      // is a data problem, not a transient failure, and replaying it would
      // apply something to the wrong customer.
      await admin.rpc('finish_event_replay', {
        p_replay: claimed.replay_id, p_applied: false,
        p_error: 'The stored payload does not match the event it is filed under.',
      });
      return fail('corrupt_event', 'That stored event does not match its own id.', 409, origin);
    }

    await handleEvent(admin, event);

    await admin.rpc('finish_event_replay', {
      p_replay: claimed.replay_id, p_applied: true, p_error: null,
    });

    return json({ replayed: true, eventId, type: claimed.event_type }, 200, origin);
  } catch (err) {
    // A replay that fails must say so in the record, or the next person sees an
    // event still marked failed with no sign anybody tried.
    if (claimed) {
      try {
        await adminClient().rpc('finish_event_replay', {
          p_replay: claimed.replay_id, p_applied: false, p_error: String(err),
        });
      } catch (recordErr) {
        console.error('[replay] could not record the failure', recordErr);
      }
    }
    return fail('replay_failed', 'That event could not be applied. The reason is recorded against it.',
                500, origin, err);
  }
});
