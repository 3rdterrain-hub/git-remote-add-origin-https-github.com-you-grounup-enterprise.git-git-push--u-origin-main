/**
 * POST /functions/v1/apply-refund
 *
 * Sends an approved refund or credit to Stripe.
 *
 * The money moves in Stripe; the decision was made in GrounUp. This function
 * is only the wire between them, and it is deliberately incapable of deciding
 * anything:
 *
 *   1. It takes a request id and nothing else. The amount, the kind and the
 *      invoice all come back from `app.claim_refund`, which refuses anything
 *      that is not already approved — so a caller cannot refund an amount
 *      nobody released.
 *   2. Approval happened elsewhere, by somebody who did not ask for it. This
 *      function never checks that rule, because re-implementing it here would
 *      be a second copy of it to get wrong.
 *   3. What Stripe did is written by `finish_refund`, which only service_role
 *      may execute, so an operator cannot mark a refund paid that was not.
 *
 * A credit uses Stripe's customer balance rather than a refund: no money moves,
 * the next invoice is smaller, and a customer who is staying usually prefers
 * that to a card transaction they have to explain to their bookkeeper.
 */
import { getCaller, adminClient } from '../_shared/auth.ts';
import { stripeClient } from '../_shared/stripe.ts';
import { fail, json, preflight } from '../_shared/http.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') return fail('method_not_allowed', 'Use POST.', 405, origin);

  let requestId: string | null = null;

  try {
    const caller = await getCaller(req);
    if (!caller) return fail('unauthenticated', 'Sign in as an operator.', 401, origin);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'A JSON body is required.', 400, origin);
    }
    const { refundId } = body as Record<string, unknown>;
    if (typeof refundId !== 'string' || refundId.length === 0) {
      return fail('bad_request', 'A refundId is required.', 400, origin);
    }
    requestId = refundId;

    const admin = adminClient();
    const { data, error } = await admin.rpc('claim_refund', { p_request: refundId });
    if (error) {
      const notApproved = /not approved/i.test(error.message);
      return fail(notApproved ? 'not_approved' : 'bad_request', error.message,
                  notApproved ? 409 : 400, origin);
    }
    const claimed = (Array.isArray(data) ? data[0] : data) as {
      company_id: string; kind: string; amount_cents: number;
      currency: string; stripe_invoice_id: string | null; reason: string;
    } | null;
    if (!claimed) return fail('not_found', 'That refund is not available to apply.', 404, origin);

    const { data: sub } = await admin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('company_id', claimed.company_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub?.stripe_customer_id) {
      await admin.rpc('finish_refund', {
        p_request: refundId, p_applied: false, p_stripe_refund_id: null,
        p_error: 'That company has no Stripe customer, so there is nothing to refund against.',
      });
      return fail('no_customer', 'That company has no Stripe customer.', 409, origin);
    }

    const stripe = stripeClient();

    if (claimed.kind === 'credit') {
      /*
       * A negative balance transaction is a credit in Stripe's terms: the next
       * invoice draws it down automatically. Recorded with the reason so the
       * entry is legible in Stripe as well as here.
       */
      const entry = await stripe.customers.createBalanceTransaction(sub.stripe_customer_id, {
        amount: -Math.abs(claimed.amount_cents),
        currency: (claimed.currency ?? 'USD').toLowerCase(),
        description: claimed.reason.slice(0, 350),
        metadata: { grounup_refund_request: refundId },
      });
      await admin.rpc('finish_refund', {
        p_request: refundId, p_applied: true, p_stripe_refund_id: entry.id, p_error: null,
      });
      return json({ applied: true, kind: 'credit', stripeId: entry.id }, 200, origin);
    }

    // A refund needs the charge it is against; Stripe resolves that from the
    // invoice's payment intent rather than from anything GrounUp stores.
    if (!claimed.stripe_invoice_id) {
      await admin.rpc('finish_refund', {
        p_request: refundId, p_applied: false, p_stripe_refund_id: null,
        p_error: 'A refund to a card needs the invoice it is against.',
      });
      return fail('no_invoice', 'A refund to a card needs an invoice.', 409, origin);
    }

    /*
     * Typed loosely on purpose. Recent Stripe API versions moved the payment
     * intent behind `confirmation_secret`/`payments` and the SDK types differ
     * between them, so both shapes are read and the failure — if the field is
     * somewhere else again — is recorded against the request rather than
     * thrown as a type error nobody sees.
     */
    const invoice = await stripe.invoices.retrieve(claimed.stripe_invoice_id) as unknown as {
      payment_intent?: string | { id?: string } | null;
      charge?: string | { id?: string } | null;
    };
    const paymentIntent = typeof invoice.payment_intent === 'string'
      ? invoice.payment_intent
      : invoice.payment_intent?.id;
    if (!paymentIntent) {
      await admin.rpc('finish_refund', {
        p_request: refundId, p_applied: false, p_stripe_refund_id: null,
        p_error: 'That invoice has no payment on it to refund.',
      });
      return fail('no_payment', 'That invoice has no payment to refund.', 409, origin);
    }

    const refund = await stripe.refunds.create({
      payment_intent: paymentIntent,
      amount: claimed.amount_cents,
      reason: 'requested_by_customer',
      metadata: { grounup_refund_request: refundId, grounup_company_id: claimed.company_id },
    });

    await admin.rpc('finish_refund', {
      p_request: refundId, p_applied: true, p_stripe_refund_id: refund.id, p_error: null,
    });
    return json({ applied: true, kind: 'refund', stripeId: refund.id }, 200, origin);
  } catch (err) {
    /*
     * A refund that failed at Stripe must say so on the request, or the next
     * person sees one sitting at "approved" with no sign anybody tried — and
     * issues it a second time.
     */
    if (requestId) {
      try {
        await adminClient().rpc('finish_refund', {
          p_request: requestId, p_applied: false, p_stripe_refund_id: null,
          p_error: String(err),
        });
      } catch (recordErr) {
        console.error('[refund] could not record the failure', recordErr);
      }
    }
    return fail('refund_failed',
                'That refund could not be sent to Stripe. The reason is recorded against it.',
                500, origin, err);
  }
});
