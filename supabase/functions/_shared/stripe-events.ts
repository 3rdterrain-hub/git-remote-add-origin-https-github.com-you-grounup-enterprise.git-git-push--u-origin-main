/**
 * Applying one Stripe event.
 *
 * Extracted from the webhook handler so that a retry runs the *same code*
 * rather than a second implementation of it. A retry path that reimplements
 * this would eventually diverge, and the divergence would only ever show up
 * on the events that already failed once — which is the worst place to have a
 * second version of anything.
 *
 * Everything here is deliberately free of HTTP: no request, no signature, no
 * response. It takes an already-verified event and a privileged client, and
 * applies it. Verification belongs to whoever received the event; replaying a
 * stored payload is safe precisely because a payload only reaches
 * `stripe_events` after its signature was checked.
 */
import { deriveState, type StripeSubscriptionLike } from './subscription-state.ts';

export interface StripeEventLike {
  id: string;
  type: string;
  created: number;
  data: { object: unknown };
}

// deno-lint-ignore no-explicit-any
type Admin = any;

export async function handleEvent(admin: Admin, event: StripeEventLike) {
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
      const { stripeClient } = await import('./stripe.ts');
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
        attempt_count?: number; next_payment_attempt?: number | null;
        last_finalization_error?: { code?: string; message?: string } | null;
        payment_intent?: {
          last_payment_error?: { code?: string; decline_code?: string; message?: string };
        } | null;
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

      /*
       * A refusal is an event, so it is recorded rather than counted into a
       * column: "how many times has this card been declined" cannot be
       * answered by a number that gets overwritten. Whether they are still
       * failing is derived from the invoice above, so nothing here has to
       * remember to clear anything when they finally pay.
       */
      if (event.type === 'invoice.payment_failed') {
        const err = invoice.payment_intent?.last_payment_error;
        const { error: failErr } = await admin.rpc('record_payment_failure', {
          p_company: companyId,
          p_invoice: invoice.id,
          p_attempt: invoice.attempt_count ?? 1,
          p_amount_cents: invoice.amount_due ?? 0,
          p_currency: (invoice.currency ?? 'usd').toUpperCase(),
          // The decline code is the specific one and the reason a customer can
          // act on; `code` is the generic wrapper around it.
          p_code: err?.decline_code ?? err?.code
                  ?? invoice.last_finalization_error?.code ?? null,
          p_message: err?.message ?? invoice.last_finalization_error?.message ?? null,
          // Null means Stripe has stopped trying, which is when a person has to.
          p_next_attempt: invoice.next_payment_attempt
            ? new Date(invoice.next_payment_attempt * 1000).toISOString() : null,
        });
        if (failErr) console.error('[webhook] could not record the payment failure', failErr);
      }
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

  /*
   * A subscription that ends without a cancellation on file is one the customer
   * ended somewhere other than in GrounUp — Stripe's own portal, or a card that
   * finally gave up. Recording it with no reason keeps the count complete and
   * is deliberately not filed under "other": nobody was asked, and saying so is
   * the honest answer. `record_cancellation` is idempotent per subscription, so
   * this never overwrites a reason the customer actually gave.
   */
  if (subscription.status === 'canceled' || subscription.status === 'unpaid') {
    const { error: churnError } = await admin.rpc('record_cancellation', {
      p_company: companyId, p_reason: null, p_detail: null, p_competitor: null,
      p_would_return: null, p_immediate: false, p_source: 'stripe',
    });
    if (churnError) console.error('[webhook] could not record the cancellation', churnError);
  }

  await admin.from('audit_events').insert({
    company_id: companyId,
    action: 'update',
    entity_table: 'public.entitlements',
    entity_id: companyId,
    new_state: state.entitlement as unknown as Record<string, unknown>,
    reason: `Stripe ${eventId}: subscription ${subscription.id} is ${subscription.status}`,
  });
}
