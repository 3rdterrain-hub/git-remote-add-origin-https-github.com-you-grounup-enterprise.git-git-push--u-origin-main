/**
 * Stripe client and webhook signature verification.
 *
 * The secret key is read from the function's environment and never leaves the
 * server. Signature verification uses the async WebCrypto path because the
 * synchronous variant is not available in the Deno runtime.
 */
import Stripe from 'npm:stripe@17';

let cached: Stripe | null = null;

export function stripeClient(): Stripe {
  if (cached) return cached;
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  if (key.startsWith('pk_')) {
    throw new Error('STRIPE_SECRET_KEY holds a publishable key; a secret key is required');
  }
  cached = new Stripe(key, {
    apiVersion: '2025-09-30.clover',
    httpClient: Stripe.createFetchHttpClient(),
  });
  return cached;
}

/**
 * Verify a webhook signature and return the parsed event.
 *
 * An unverified payload is never parsed as an event: anyone can POST JSON to a
 * public URL, and the signature is the only thing that distinguishes Stripe
 * from an attacker granting themselves an enterprise subscription.
 */
export async function verifyWebhook(req: Request, rawBody: string): Promise<Stripe.Event> {
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  const signature = req.headers.get('stripe-signature');
  if (!signature) throw new Error('Request carries no stripe-signature header');

  return await stripeClient().webhooks.constructEventAsync(
    rawBody,
    signature,
    secret,
    undefined,
    Stripe.createSubtleCryptoProvider(),
  );
}
