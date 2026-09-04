/**
 * POST /functions/v1/cancel-subscription
 *
 * Cancels at period end by default, so the customer keeps the access they have
 * already paid for. Immediate cancellation is available but must be asked for
 * explicitly, because it forfeits the remainder of a paid period.
 */
import { getCaller, requirePermission, isUuid, adminClient } from '../_shared/auth.ts';
import { stripeClient } from '../_shared/stripe.ts';
import { fail, json, preflight } from '../_shared/http.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') return fail('method_not_allowed', 'Use POST.', 405, origin);

  try {
    const caller = await getCaller(req);
    if (!caller) return fail('unauthenticated', 'Sign in to cancel a subscription.', 401, origin);

    const { companyId, immediate, reason } = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!isUuid(companyId)) return fail('bad_request', 'A valid companyId is required.', 400, origin);

    const permitted = await requirePermission(caller, companyId, 'billing.manage');
    if (!permitted.ok) return fail('forbidden', permitted.reason, 403, origin);

    const admin = adminClient();
    const { data: sub } = await admin
      .from('subscriptions')
      .select('stripe_subscription_id, current_period_end')
      .eq('company_id', companyId)
      .in('status', ['trialing', 'active', 'past_due', 'paused'])
      .maybeSingle();

    if (!sub?.stripe_subscription_id) {
      return fail('no_subscription', 'This company has no active subscription to cancel.', 409, origin);
    }

    const stripe = stripeClient();
    if (immediate === true) {
      await stripe.subscriptions.cancel(sub.stripe_subscription_id, {
        cancellation_details: { comment: typeof reason === 'string' ? reason.slice(0, 500) : undefined },
      });
    } else {
      await stripe.subscriptions.update(sub.stripe_subscription_id, {
        cancel_at_period_end: true,
        cancellation_details: { comment: typeof reason === 'string' ? reason.slice(0, 500) : undefined },
      });
    }

    await admin.from('usage_events').insert({
      company_id: companyId,
      user_id: caller.userId,
      metric: 'billing.cancellation_requested',
      metadata: { immediate: immediate === true, reason: typeof reason === 'string' ? reason.slice(0, 500) : null },
    });

    return json({
      accepted: true,
      immediate: immediate === true,
      accessUntil: immediate === true ? null : sub.current_period_end,
      note: 'Stripe has accepted the cancellation. Entitlement updates when the verified webhook is processed.',
    }, 202, origin);
  } catch (err) {
    return fail('internal_error', 'The subscription could not be canceled.', 500, origin, err);
  }
});
