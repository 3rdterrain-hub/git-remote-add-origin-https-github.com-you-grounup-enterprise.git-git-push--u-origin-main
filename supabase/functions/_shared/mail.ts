/**
 * Handing a message to a mail provider.
 *
 * Deliberately one small function with one provider behind it. An abstraction
 * over three providers nobody has configured is three untested code paths; when
 * a second one is actually needed, this is the file it goes in.
 *
 * The key lives in a Supabase secret and is read here, server-side, where the
 * browser can never reach it.
 */
export interface Outgoing {
  to: string;
  subject: string;
  body: string;
}

export interface Delivered {
  ok: boolean;
  providerId?: string;
  error?: string;
  /**
   * Whether trying again could work. A missing key or a rejected address will
   * fail identically forever; a rate limit or a network fault will not. The
   * difference decides whether the outbox retries or stops.
   */
  retryable?: boolean;
}

/** Whether mail can be sent at all. Absent means the outbox simply fills up. */
export function mailConfigured(): boolean {
  return Boolean(Deno.env.get('RESEND_API_KEY') && Deno.env.get('MAIL_FROM'));
}

export async function sendMail(message: Outgoing): Promise<Delivered> {
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('MAIL_FROM');
  if (!key || !from) {
    return {
      ok: false,
      retryable: true,
      error: 'No mail provider is configured. Set RESEND_API_KEY and MAIL_FROM '
        + 'as Supabase secrets; the outbox is holding this message until then.',
    };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.body,
      }),
    });

    const payload = await res.json().catch(() => null) as
      { id?: string; message?: string; name?: string } | null;

    if (!res.ok) {
      return {
        ok: false,
        error: payload?.message ?? `The mail provider returned ${res.status}.`,
        /*
         * 4xx is the provider saying no and meaning it — a bad address, an
         * unverified sender, a malformed request. Retrying those forever is how
         * an outbox fills with messages that will never leave. 429 is the
         * exception: it is the provider saying "not now".
         */
        retryable: res.status === 429 || res.status >= 500,
      };
    }
    return { ok: true, providerId: payload?.id };
  } catch (err) {
    // A network fault. Worth another go.
    return { ok: false, error: String(err), retryable: true };
  }
}
