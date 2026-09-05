/**
 * POST /functions/v1/cancel-subscription
 *
 * Cancels at period end by default, so the customer keeps the access they have
 * already paid for. Immediate cancellation is available but must be asked for
 * explicitly, because it forfeits the remainder of a paid period.
 *
 * Why they are leaving is recorded *before* Stripe is told, and that ordering
 * is the point: once the subscription ends its items are gone, and what the
 * customer was worth cannot be recovered afterwards. Recording it first means
 * a cancellation that then fails at Stripe leaves a reason on file for a
 * subscription that is still live, which is a harmless surplus; the other
 * order loses the figure permanently.
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

    const {
      companyId, immediate, reason, reasonKey, detail, competitor, wouldReturn,
    } = (await req.json().catch(() => ({}))) as Record<string, unknown>;
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

    // Before Stripe, while the seats and the monthly value are still readable.
    const { error: recordError } = await admin.rpc('record_cancellation', {
      p_company: companyId,
      p_reason: typeof reasonKey === 'string' ? reasonKey : null,
      p_detail: typeof detail === 'string' ? detail.slice(0, 2000)
                : typeof reason === 'string' ? reason.slice(0, 2000) : null,
      p_competitor: typeof competitor === 'string' ? competitor.slice(0, 200) : null,
      p_would_return: typeof wouldReturn === 'boolean' ? wouldReturn : null,
      p_immediate: immediate === true,
      p_source: 'customer',
    });
    if (recordError) {
      // A reason that cannot be filed is not a reason to refuse a cancellation
      // — the customer asked to leave, and holding them because a survey row
      // failed would be absurd. It is logged so the gap is visible.
      console.error('[cancel] could not record why', recordError);
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
      metadata: {
        immediate: immediate === true,
        reason: typeof reason === 'string' ? reason.slice(0, 500) : null,
        reason_key: typeof reasonKey === 'string' ? reasonKey : null,
      },
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
