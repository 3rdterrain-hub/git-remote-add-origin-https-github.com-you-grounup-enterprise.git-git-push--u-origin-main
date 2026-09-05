/**
 * POST /functions/v1/create-checkout-session
 *
 * Starts a Stripe Checkout session for a plan the authenticated company
 * administrator selected.
 *
 * Every commercially significant value is resolved server-side from the plan
 * catalog: the browser sends a plan id and an interval, and nothing else it
 * sends can influence what is charged. Card details are collected by Stripe and
 * never touch GrounUp.
 */
import { getCaller, requirePermission, isUuid, adminClient } from '../_shared/auth.ts';
import { stripeClient } from '../_shared/stripe.ts';
import { fail, json, preflight } from '../_shared/http.ts';
import { resolveRequestedPrice } from '../_shared/subscription-state.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const origin = req.headers.get('origin');

  if (req.method !== 'POST') return fail('method_not_allowed', 'Use POST.', 405, origin);

  try {
    const caller = await getCaller(req);
    if (!caller) return fail('unauthenticated', 'Sign in to start a subscription.', 401, origin);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'A JSON body is required.', 400, origin);
    }
    const { companyId, planId, interval, successPath, cancelPath } = body as Record<string, unknown>;

    if (!isUuid(companyId)) return fail('bad_request', 'A valid companyId is required.', 400, origin);

    const permitted = await requirePermission(caller, companyId, 'billing.manage');
    if (!permitted.ok) return fail('forbidden', permitted.reason, 403, origin);

    // Read the catalog through the caller's client: the plan catalog is public,
    // so this needs no elevated privilege.
    const [{ data: plans, error: planErr }, { data: prices, error: priceErr }] = await Promise.all([
      caller.client.from('plans').select('id, is_active, is_public'),
      caller.client.from('plan_prices').select('stripe_price_id, plan_id, interval, is_active, unit_amount_cents'),
    ]);
    if (planErr || priceErr) {
      return fail('catalog_unavailable', 'The plan catalog could not be read.', 503, origin, planErr ?? priceErr);
    }

    const resolved = resolveRequestedPrice(planId, interval, plans ?? [], prices ?? []);
    if (!resolved.ok) return fail('invalid_plan', resolved.error, 400, origin);

    const admin = adminClient();

    // Reuse the company's existing Stripe customer so a second purchase does
    // not create a duplicate customer with a divergent billing history.
    const { data: existing } = await admin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: company } = await admin
      .from('companies')
      .select('name, email')
      .eq('id', companyId)
      .single();

    /*
     * Seats and terms.
     *
     * The plan is priced per seat, and this used to send `quantity: 1` — so a
     * forty-person contractor checked out at the price of one person. The
     * count comes from the same function the usage screen and the operator
     * console read, so what Stripe charges for and what GrounUp reports cannot
     * disagree.
     *
     * A negotiated arrangement travels as its Stripe coupon. A coupon-less
     * arrangement is deliberately not applied here: an operator can record an
     * agreed price before Stripe knows about it, and quietly discounting a
     * checkout on the strength of a row Stripe never saw would put the two
     * out of step in the direction that costs money.
     */
    const { data: seatCount } = await admin
      .rpc('seat_price_cents', { p_company: companyId, p_interval: interval ?? 'month' });
    const { data: seats } = await admin.rpc('billable_seats', { p_company: companyId });
    const quantity = Math.max(1, Number(seats ?? 1));

    const { data: terms } = await admin
      .from('company_billing_terms')
      .select('kind, stripe_coupon_id, applies_in_stripe')
      .eq('company_id', companyId)
      .is('revoked_at', null)
      .maybeSingle();
    const couponId = terms?.applies_in_stripe ? terms.stripe_coupon_id : null;

    const stripe = stripeClient();
    let customerId = existing?.stripe_customer_id as string | undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: company?.name ?? undefined,
        email: caller.email ?? company?.email ?? undefined,
        // The company id is the join back to GrounUp. Every later webhook can
        // resolve its tenant from this without trusting the payload.
        metadata: { grounup_company_id: String(companyId) },
      });
      customerId = customer.id;
    }

    const appUrl = Deno.env.get('APP_URL') ?? '';
    const safePath = (p: unknown, dflt: string) =>
      typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') ? p : dflt;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: resolved.priceId, quantity }],
      // client_reference_id is echoed back on checkout.session.completed and is
      // how the webhook binds a brand-new subscription to its company.
      client_reference_id: String(companyId),
      subscription_data: {
        metadata: {
          grounup_company_id: String(companyId),
          grounup_plan_id: resolved.planId,
        },
      },
      // A recorded arrangement and a promotion code the customer types are
      // mutually exclusive in Stripe; the arrangement wins, because somebody
      // agreed to it.
      ...(couponId ? { discounts: [{ coupon: couponId }] } : { allow_promotion_codes: true }),
      billing_address_collection: 'auto',
      success_url: `${appUrl}${safePath(successPath, '/app/settings/billing')}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}${safePath(cancelPath, '/pricing')}?checkout=canceled`,
    });

    // Usage is recorded, not entitlement. Access changes only on a verified webhook.
    await admin.from('usage_events').insert({
      company_id: companyId,
      user_id: caller.userId,
      metric: 'billing.checkout_started',
      metadata: {
        plan_id: resolved.planId, interval: interval ?? 'month',
        quantity, coupon: couponId, seat_price_cents: seatCount ?? null,
      },
    });

    return json({ url: session.url, sessionId: session.id, planId: resolved.planId }, 200, origin);
  } catch (err) {
    return fail('internal_error', 'The checkout session could not be created.', 500, origin, err);
  }
});
