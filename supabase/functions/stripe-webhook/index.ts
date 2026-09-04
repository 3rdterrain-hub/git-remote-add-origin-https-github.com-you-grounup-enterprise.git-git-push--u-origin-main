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
import { deriveState, isHandled, type StripeSubscriptionLike } from '../_shared/subscription-state.ts';

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
    await handleEvent(admin, event, rawBody);
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
    // the retry path reads it as already-claimed. Failed events are replayed
    // from the Stripe dashboard or the reconciliation job.
    return new Response('Processing failed', { status: 500 });
  }
});

// deno-lint-ignore no-explicit-any
type Admin = any;

async function handleEvent(admin: Admin, event: { id: string; type: string; created: number; data: { object: unknown } }, _raw: string) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as {
        client_reference_id?: string | null;
        customer?: string | null;
        subscription?: string | null;
        metadata?: Record<string, string> | null;
      };
      // The company id came from GrounUp when the session was created.
      const companyId = session.client_reference_id ?? session.metadata?.grounup_company_id ?? null;
      if (!companyId || !session.subscription) {
        console.warn(`[webhook] checkout session ${event.id} carries no company or subscription; nothing to apply`);
        return;
      }
      const { stripeClient } = await import('../_shared/stripe.ts');
      const subscription = await stripeClient().subscriptions.retrieve(String(session.subscription));
      await applySubscription(admin, subscription as unknown as StripeSubscriptionLike, companyId, event.id, event.created);
      return;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
    case 'customer.subscription.trial_will_end': {
      const subscription = event.data.object as StripeSubscriptionLike;
      const companyId = await resolveCompany(admin, subscription);
      if (!companyId) {
        console.warn(`[webhook] subscription ${subscription.id} has no resolvable company; skipping`);
        return;
      }
      await applySubscription(admin, subscription, companyId, event.id, event.created);
      return;
    }

    case 'invoice.paid':
    case 'invoice.payment_failed':
    case 'invoice.finalized': {
      const invoice = event.data.object as {
        id: string; customer?: string | null; number?: string | null; status?: string | null;
        amount_due?: number; amount_paid?: number; currency?: string;
        period_start?: number | null; period_end?: number | null;
        hosted_invoice_url?: string | null; invoice_pdf?: string | null;
        created?: number; status_transitions?: { paid_at?: number | null };
      };
      const companyId = await companyForCustomer(admin, invoice.customer ?? null);
      if (!companyId) return;

      await admin.from('billing_invoices').upsert({
        company_id: companyId,
        stripe_invoice_id: invoice.id,
        number: invoice.number ?? null,
        status: invoice.status ?? 'unknown',
        amount_due_cents: invoice.amount_due ?? 0,
        amount_paid_cents: invoice.amount_paid ?? 0,
        currency: (invoice.currency ?? 'usd').toUpperCase(),
        period_start: invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null,
        period_end: invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null,
        hosted_invoice_url: invoice.hosted_invoice_url ?? null,
        invoice_pdf_url: invoice.invoice_pdf ?? null,
        issued_at: invoice.created ? new Date(invoice.created * 1000).toISOString() : null,
        paid_at: invoice.status_transitions?.paid_at
          ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
          : null,
      }, { onConflict: 'stripe_invoice_id' });
      return;
    }
  }
}

/** Resolve the tenant from GrounUp's own records, never from the event alone. */
async function resolveCompany(admin: Admin, subscription: StripeSubscriptionLike): Promise<string | null> {
  const { data: bySub } = await admin
    .from('subscriptions')
    .select('company_id')
    .eq('stripe_subscription_id', subscription.id)
    .maybeSingle();
  if (bySub?.company_id) return bySub.company_id;

  const byCustomer = await companyForCustomer(admin, subscription.customer);
  if (byCustomer) return byCustomer;

  // Metadata is the last resort, and only because GrounUp set it when it
  // created the checkout session.
  const fromMetadata = subscription.metadata?.grounup_company_id ?? null;
  if (!fromMetadata) return null;
  const { data: company } = await admin.from('companies').select('id').eq('id', fromMetadata).maybeSingle();
  return company?.id ?? null;
}

async function companyForCustomer(admin: Admin, customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const { data } = await admin
    .from('subscriptions')
    .select('company_id')
    .eq('stripe_customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.company_id ?? null;
}

async function applySubscription(
  admin: Admin,
  subscription: StripeSubscriptionLike,
  companyId: string,
  eventId: string,
  eventCreated: number,
) {
  const [{ data: plans }, { data: prices }, { data: versions }, { data: existing }] = await Promise.all([
    admin.from('plans').select('id, features, max_seats, max_active_estimates, max_active_projects, storage_gb, ai_credits_per_month'),
    admin.from('plan_prices').select('stripe_price_id, plan_id'),
    admin.from('plan_versions').select(
      'id, plan_id, version, features, max_seats, max_active_estimates, max_active_projects, storage_gb, ai_credits_per_month'),
    // What this subscription is already pinned to, so a customer keeps the
    // terms they bought instead of silently inheriting today's catalog.
    admin.from('subscriptions').select('plan_id, plan_version_id')
      .eq('stripe_subscription_id', subscription.id).maybeSingle(),
  ]);

  const state = deriveState(
    subscription, companyId, plans ?? [], prices ?? [], eventId, eventCreated,
    versions ?? [], existing ?? null);
  for (const w of state.warnings) console.warn(`[webhook] ${w}`);

  const { data: sub, error: subError } = await admin
    .from('subscriptions')
    .upsert(state.subscription, { onConflict: 'stripe_subscription_id' })
    .select('id')
    .single();
  if (subError) throw subError;

  for (const item of state.items) {
    const { error } = await admin.from('subscription_items').upsert(
      { ...item, subscription_id: sub.id },
      { onConflict: 'stripe_item_id' },
    );
    if (error) throw error;
  }

  const { error: entError } = await admin
    .from('entitlements')
    .upsert(state.entitlement, { onConflict: 'company_id' });
  if (entError) throw entError;

  await admin.from('audit_events').insert({
    company_id: companyId,
    action: 'update',
    entity_table: 'public.entitlements',
    entity_id: companyId,
    new_state: state.entitlement as unknown as Record<string, unknown>,
    reason: `Stripe ${eventId}: subscription ${subscription.id} is ${subscription.status}`,
  });
}
