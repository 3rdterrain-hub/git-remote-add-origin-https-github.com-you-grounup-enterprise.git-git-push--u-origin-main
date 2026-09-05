/**
 * POST /functions/v1/send-email
 *
 * Drains the outbox.
 *
 * Nothing on this platform sends mail inline. A webhook that blocks on an HTTP
 * call to a mail provider is a webhook that times out, and a timed-out Stripe
 * webhook is retried — so the customer is charged once and emailed twice. Mail
 * is written to `email_messages` in the same transaction as the thing that
 * caused it, and this empties the queue afterwards.
 *
 * Meant to be called on a schedule. It is also safe to call by hand from the
 * console when somebody wants a message to go now, because a message is claimed
 * before it is sent and two concurrent runs cannot claim the same one.
 *
 * Deploy with JWT verification off if a scheduler calls it without a session:
 *   supabase functions deploy send-email --no-verify-jwt --import-map supabase/functions/deno.json
 * It authenticates on the service-role key instead, which a scheduler has and
 * the internet does not.
 */
import { adminClient } from '../_shared/auth.ts';
import { fail, json, preflight } from '../_shared/http.ts';
import { sendMail, mailConfigured } from '../_shared/mail.ts';

/** How many to take in one run. Small enough to finish inside a function's life. */
const BATCH = 25;

/**
 * How many times a message is tried before it is left alone.
 *
 * Five, and only for failures worth retrying. A message that has failed five
 * times for a reason that could resolve is a message where something is wrong
 * that another attempt will not fix, and the outbox screen is where it should
 * be noticed rather than in a loop nobody is watching.
 */
const GIVE_UP_AFTER = 5;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') return fail('method_not_allowed', 'Use POST.', 405, origin);

  const admin = adminClient();

  if (!mailConfigured()) {
    /*
     * Said plainly rather than returning a cheerful zero. An outbox that is
     * filling up because nobody set a key looks exactly like an outbox with
     * nothing to send.
     */
    const { count } = await admin
      .from('email_messages')
      .select('id', { count: 'exact', head: true })
      .eq('state', 'queued');
    return json({
      sent: 0,
      waiting: count ?? 0,
      configured: false,
      note: 'No mail provider is configured. Set RESEND_API_KEY and MAIL_FROM as '
        + 'Supabase secrets. Nothing has been lost — the outbox is holding it.',
    }, 200, origin);
  }

  const { data: batch, error } = await admin
    .from('email_messages')
    .select('id, to_email, subject, body, attempts')
    .eq('state', 'queued')
    .lt('attempts', GIVE_UP_AFTER)
    .order('queued_at', { ascending: true })
    .limit(BATCH);

  if (error) return fail('outbox_unreadable', 'The outbox could not be read.', 500, origin, error);
  if (!batch?.length) return json({ sent: 0, waiting: 0, configured: true }, 200, origin);

  let sent = 0;
  let failed = 0;

  for (const message of batch) {
    /*
     * Claimed before it is sent, by moving it out of `queued`. Two concurrent
     * runs cannot both claim the same row, so a scheduler firing while somebody
     * presses Send in the console does not send anything twice.
     */
    const { data: claimed } = await admin
      .from('email_messages')
      .update({ state: 'failed', attempts: message.attempts + 1, updated_at: new Date().toISOString() })
      .eq('id', message.id)
      .eq('state', 'queued')
      .select('id');
    if (!claimed?.length) continue;

    const result = await sendMail({
      to: message.to_email, subject: message.subject, body: message.body,
    });

    if (result.ok) {
      await admin.from('email_messages').update({
        state: 'sent', provider_id: result.providerId ?? null, error: null,
        sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', message.id);
      sent += 1;
    } else {
      /*
       * Back to the queue only if another attempt could work. A rejected
       * address will be rejected identically forever, and a queue full of
       * those is a queue nobody can read.
       */
      await admin.from('email_messages').update({
        state: result.retryable && message.attempts + 1 < GIVE_UP_AFTER ? 'queued' : 'failed',
        error: result.error ?? 'Unknown', updated_at: new Date().toISOString(),
      }).eq('id', message.id);
      failed += 1;
    }
  }

  const { count: waiting } = await admin
    .from('email_messages')
    .select('id', { count: 'exact', head: true })
    .eq('state', 'queued');

  return json({ sent, failed, waiting: waiting ?? 0, configured: true }, 200, origin);
});
