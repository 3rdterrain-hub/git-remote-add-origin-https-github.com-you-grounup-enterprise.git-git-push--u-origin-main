/**
 * POST /functions/v1/stripe-webhook
 *
 * The only writer of subscription and entitlement state.
 *
 * Order of operations matters and is deliberate:
 *   1. Read the raw body as text — the signature is computed over exact bytes,
 *      so parsing first would make verification impossible.
 *   2. Verify the signature. An unverified payload is discarded, never parsed
 *      as an event.
 *   3. Claim the event id in `stripe_events`. The primary key makes this the
 *      idempotency barrier: a replay collides and returns 200 without applying
 *      anything twice.
 *   4. Resolve the tenant from data GrounUp itself wrote, not from the payload.
 *   5. Apply state derived by the pure state machine.
 *
 * This function must be deployed with JWT verification disabled (Stripe does not
 * send a Supabase JWT); the signature check is what authenticates the caller.
 *   supabase functions deploy stripe-webhook --no-verify-jwt
 */
import { adminClient } from '../_shared/auth.ts';
import { verifyWebhook } from '../_shared/stripe.ts';
import { isHandled } from '../_shared/subscription-state.ts';
import { handleEvent } from '../_shared/stripe-events.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const rawBody = await req.text();

  let event;
  try {
    event = await verifyWebhook(req, rawBody);
  } catch (err) {
    // 400 tells Stripe not to retry: a bad signature will never become good.
    console.error('[webhook] signature verification failed', err);
    return new Response('Invalid signature', { status: 400 });
  }

  const admin = adminClient();

  // Idempotency barrier. `ignoreDuplicates` turns the PK collision into a
  // no-op, so a Stripe retry after a timeout cannot double-apply.
  const { data: claimed, error: claimError } = await admin
    .from('stripe_events')
    .upsert(
      {
        id: event.id,
        type: event.type,
        api_version: event.api_version ?? null,
        livemode: event.livemode,
        payload: event as unknown as Record<string, unknown>,
        processing_state: 'received',
      },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    .select('id');

  if (claimError) {
    console.error('[webhook] could not record event', claimError);
    // 500 asks Stripe to retry: the event was never durably recorded.
    return new Response('Could not record event', { status: 500 });
  }

  if (!claimed || claimed.length === 0) {
    console.log(`[webhook] event ${event.id} already processed; ignoring replay`);
    return new Response(JSON.stringify({ received: true, duplicate: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!isHandled(event.type)) {
    await admin.from('stripe_events')
      .update({ processing_state: 'ignored', processed_at: new Date().toISOString() })
      .eq('id', event.id);
    return new Response(JSON.stringify({ received: true, handled: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await handleEvent(admin, event);
    await admin.from('stripe_events')
      .update({ processing_state: 'processed', processed_at: new Date().toISOString() })
      .eq('id', event.id);
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(`[webhook] failed to process ${event.type} ${event.id}`, err);
    await admin.from('stripe_events').update({
      processing_state: 'failed',
      processing_error: String(err),
      attempts: 1,
    }).eq('id', event.id);
    // 500 so Stripe retries; the row stays claimed but is marked failed, and
    // the retry path reads it as already-claimed. An event that is still
    // failed after Stripe gives up can be replayed from the operator console,
    // which runs the same `handleEvent` against the payload stored here.
    return new Response('Processing failed', { status: 500 });
  }
});
