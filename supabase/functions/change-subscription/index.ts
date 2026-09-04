/**
 * POST /functions/v1/change-subscription
 *
 * Upgrades or downgrades a live subscription in place, with proration.
 *
 * The response deliberately does not report new entitlement: Stripe's own
 * `customer.subscription.updated` webhook is what changes access, and the client
 * refetches entitlement after it lands. Returning an optimistic answer here
 * would be the browser-trusts-itself failure this design exists to prevent.
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
    if (!caller) return fail('unauthenticated', 'Sign in to change a subscription.', 401, origin);

    const { companyId, planId, interval } = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!isUuid(companyId)) return fail('bad_request', 'A valid companyId is required.', 400, origin);

    const permitted = await requirePermission(caller, companyId, 'billing.manage');
    if (!permitted.ok) return fail('forbidden', permitted.reason, 403, origin);

    const [{ data: plans }, { data: prices }] = await Promise.all([
      caller.client.from('plans').select('id, is_active, is_public'),
      caller.client.from('plan_prices').select('stripe_price_id, plan_id, interval, is_active, unit_amount_cents'),
    ]);

    const resolved = resolveRequestedPrice(planId, interval, plans ?? [], prices ?? []);
    if (!resolved.ok) return fail('invalid_plan', resolved.error, 400, origin);

    const admin = adminClient();
    const { data: sub } = await admin
      .from('subscriptions')
      .select('stripe_subscription_id, plan_id, status')
      .eq('company_id', companyId)
      .in('status', ['trialing', 'active', 'past_due', 'paused'])
      .maybeSingle();

    if (!sub?.stripe_subscription_id) {
      return fail('no_subscription', 'This company has no active subscription to change.', 409, origin);
    }
    if (sub.plan_id === resolved.planId) {
      return fail('no_change', `The company is already on the ${resolved.planId} plan.`, 409, origin);
    }

    const stripe = stripeClient();
    const current = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
    const firstItem = current.items.data[0];
    if (!firstItem) return fail('malformed_subscription', 'The Stripe subscription has no items.', 500, origin);

    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      items: [{ id: firstItem.id, price: resolved.priceId }],
      // Bill the difference now rather than at renewal, so an upgrade takes
      // effect immediately and a downgrade credits the unused time.
      proration_behavior: 'create_prorations',
      metadata: { grounup_company_id: String(companyId), grounup_plan_id: resolved.planId },
    });

    await admin.from('usage_events').insert({
      company_id: companyId,
      user_id: caller.userId,
      metric: 'billing.plan_changed',
      metadata: { from: sub.plan_id, to: resolved.planId },
    });

    return json({
      accepted: true,
      requestedPlanId: resolved.planId,
      note: 'Stripe has accepted the change. Entitlement updates when the verified webhook is processed.',
    }, 202, origin);
  } catch (err) {
    return fail('internal_error', 'The subscription could not be changed.', 500, origin, err);
  }
});
