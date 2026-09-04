/**
 * POST /functions/v1/create-billing-portal-session
 *
 * Opens the Stripe-hosted customer portal, where the customer updates payment
 * methods, downloads invoices and manages their subscription. GrounUp never
 * renders a card form of its own.
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
    if (!caller) return fail('unauthenticated', 'Sign in to manage billing.', 401, origin);

    const body = await req.json().catch(() => ({}));
    const { companyId, returnPath } = body as Record<string, unknown>;
    if (!isUuid(companyId)) return fail('bad_request', 'A valid companyId is required.', 400, origin);

    const permitted = await requirePermission(caller, companyId, 'billing.manage');
    if (!permitted.ok) return fail('forbidden', permitted.reason, 403, origin);

    const admin = adminClient();
    const { data: sub } = await admin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!sub?.stripe_customer_id) {
      return fail('no_customer', 'This company has no billing account yet. Choose a plan first.', 409, origin);
    }

    const appUrl = Deno.env.get('APP_URL') ?? '';
    const safePath =
      typeof returnPath === 'string' && returnPath.startsWith('/') && !returnPath.startsWith('//')
        ? returnPath
        : '/app/settings/billing';

    const session = await stripeClient().billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${appUrl}${safePath}`,
    });

    return json({ url: session.url }, 200, origin);
  } catch (err) {
    return fail('internal_error', 'The billing portal session could not be created.', 500, origin, err);
  }
});
