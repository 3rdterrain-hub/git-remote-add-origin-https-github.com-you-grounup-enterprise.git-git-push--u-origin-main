/**
 * The hosted lead form. WORKFLOW.
 *
 * Migration 0065 built everything a stranger needs to reach a contractor's
 * pipeline — an opaque form key, a honeypot, rate limits per form and per
 * address, and identical answers for a key that never existed and one that was
 * switched off. `lib/data/lead-forms.ts` then built the snippet a contractor
 * pastes into their own website.
 *
 * That leaves out the contractor who has no website to paste into, or a page
 * they cannot edit, or who simply wants something they can text to somebody
 * standing in a driveway. This page is that: one address, `/lead/<key>`, that
 * can be sent, printed on a card, or put on a truck door as a QR code.
 *
 * **It cannot tell you whose form it is, and that is on purpose.** `anon` may
 * call one function and select from no table, so this page cannot read the
 * company's name, the form's title, or whether the key is even real. Every
 * heading here is therefore generic, and the first and only thing that
 * distinguishes a live form from a dead one is what happens on submit. A page
 * that greeted a visitor with "Request a quote from Ridgeline Excavating"
 * would be an oracle: paste in keys until one answers, and you have a directory
 * of every company on the platform.
 */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, Send, CheckCircle2, HardHat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { submitLead } from '@/lib/data/lead-forms';
import { messageFor } from '@/lib/data/query';

export function LeadFormPage() {
  const { key = '' } = useParams<{ key: string }>();

  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [description, setDescription] = useState('');
  /* Hidden from people, filled in by robots. Never shown, never validated. */
  const [trap, setTrap] = useState('');

  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * What the database will insist on, said before the send rather than after.
   * The rule itself lives in `app.submit_lead` — a name, and something to reply
   * to — because a check in the browser is a suggestion.
   */
  const named = companyName.trim().length >= 2;
  const reachable = email.trim() !== '' || phone.trim() !== '';
  const ready = named && reachable;

  if (sent) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg items-center px-4 py-10">
        <Card className="w-full">
          <CardContent className="space-y-3 p-8 text-center">
            <CheckCircle2 className="mx-auto size-10 text-success-600" />
            <h1 className="text-lg font-semibold text-charcoal-900">Thank you — that came through.</h1>
            <p className="text-sm text-charcoal-600">
              Somebody will be in touch using the details you left. Nothing else is needed from you.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardHat className="size-5" /> Request a quote
          </CardTitle>
          <CardDescription>
            Tell us what you need and how to reach you. Everything except the first two is optional —
            leave what you know and somebody will come back to you.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="lf-company">Your name, or your company *</Label>
            <Input id="lf-company" value={companyName} autoFocus
              placeholder="Maumee Development Partners"
              onChange={(e) => setCompanyName(e.target.value)} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="lf-contact">Who to ask for</Label>
              <Input id="lf-contact" value={contactName} placeholder="Dana Whitfield"
                onChange={(e) => setContactName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lf-email">Email</Label>
              <Input id="lf-email" type="email" value={email} placeholder="you@example.com"
                onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lf-phone">Phone</Label>
              <Input id="lf-phone" type="tel" value={phone} placeholder="(419) 555-0134"
                onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lf-city">City</Label>
              <Input id="lf-city" value={city} placeholder="Toledo"
                onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lf-state">State</Label>
              <Input id="lf-state" value={state} placeholder="OH"
                onChange={(e) => setState(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="lf-what">What do you need?</Label>
            <textarea id="lf-what" rows={4} value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border border-charcoal-200 bg-white p-2 text-sm"
              placeholder="Roughly 3 acres to strip and grade, storm to the back of the lot, work starting in the spring." />
          </div>

          {/* Hidden from people, filled in by robots. Left exactly as it is. */}
          <div aria-hidden="true" className="absolute -left-[5000px]">
            <input type="text" name="trap" tabIndex={-1} autoComplete="off"
              value={trap} onChange={(e) => setTrap(e.target.value)} />
          </div>

          {error ? <Alert tone="danger" title="That did not send">{error}</Alert> : null}

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-charcoal-500">
              {reachable ? ' ' : 'Leave an email address or a phone number so somebody can reply.'}
            </p>
            <Button disabled={!ready || busy}
              title={ready ? undefined : 'A name, and a way to reach you'}
              onClick={() => {
                setBusy(true); setError(null);
                submitLead(key, {
                  companyName: companyName.trim(),
                  contactName: contactName.trim() || null,
                  email: email.trim() || null,
                  phone: phone.trim() || null,
                  city: city.trim() || null,
                  state: state.trim() || null,
                  description: description.trim() || null,
                  trap: trap || null,
                })
                  .then(() => setSent(true))
                  .catch((e: unknown) => setError(messageFor(e)))
                  .finally(() => setBusy(false));
              }}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Send it
            </Button>
          </div>
        </CardContent>
      </Card>

      <p className="mt-4 text-center text-xs text-charcoal-400">
        Sent straight to the contractor. Nothing here is shared with anybody else.
      </p>
    </main>
  );
}
