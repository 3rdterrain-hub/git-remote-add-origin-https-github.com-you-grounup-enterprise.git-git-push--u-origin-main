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
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, Send, CheckCircle2, HardHat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  submitLead, loadPublicQuestions, type LeadFormQuestion,
} from '@/lib/data/lead-forms';
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

  /*
   * The company's own questions.
   *
   * Read through the one definer function `anon` may call, which is addressed
   * by the form key and says nothing about who owns it — an unknown key returns
   * no questions, exactly as a switched-off form does, so this page still gives
   * a stranger nothing to probe with.
   */
  const [questions, setQuestions] = useState<LeadFormQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});

  useEffect(() => {
    let live = true;
    loadPublicQuestions(key)
      .then((qs) => { if (live) setQuestions(qs); })
      .catch(() => { if (live) setQuestions([]); });
    return () => { live = false; };
  }, [key]);

  const answered = (q: LeadFormQuestion): boolean => {
    const v = answers[q.id];
    return Array.isArray(v) ? v.length > 0 : (v ?? '').trim() !== '';
  };
  const unanswered = useMemo(
    () => questions.filter((q) => q.isRequired && !answered(q)).map((q) => q.label),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [questions, answers],
  );

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
  const ready = named && reachable && unanswered.length === 0;

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

          {/*
            * The company's own questions, in the order they set.
            *
            * A choice renders as a select rather than a box, which is the
            * standing rule everywhere else in this platform: an answer typed
            * freely becomes a fourth spelling of the same thing, and the
            * database refuses one that is not on the list anyway.
            */}
          {questions.map((q) => {
            const id = `lf-q-${q.id}`;
            const value = answers[q.id];
            const set = (v: string | string[]) =>
              setAnswers((a) => ({ ...a, [q.id]: v }));

            return (
              <div key={q.id} className="space-y-1">
                <Label htmlFor={id}>{q.label}{q.isRequired ? ' *' : ''}</Label>
                {q.kind === 'select' ? (
                  <select id={id} value={typeof value === 'string' ? value : ''}
                    onChange={(e) => set(e.target.value)}
                    className="h-9 w-full rounded-md border border-charcoal-200 bg-white px-3 text-sm">
                    <option value="" />
                    {q.choices.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : q.kind === 'multi_select' ? (
                  <div className="flex flex-wrap gap-2">
                    {q.choices.map((c) => {
                      const picked = Array.isArray(value) && value.includes(c);
                      return (
                        <button key={c} type="button" aria-pressed={picked}
                          onClick={() => {
                            const now = Array.isArray(value) ? value : [];
                            set(picked ? now.filter((x) => x !== c) : [...now, c]);
                          }}
                          className={picked
                            ? 'rounded-full border border-brand-500 bg-brand-50 px-3 py-1 text-sm text-brand-800'
                            : 'rounded-full border border-charcoal-200 bg-white px-3 py-1 text-sm text-charcoal-700 hover:bg-charcoal-50'}>
                          {c}
                        </button>
                      );
                    })}
                  </div>
                ) : q.kind === 'long_text' ? (
                  <textarea id={id} rows={3}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => set(e.target.value)}
                    className="w-full rounded-md border border-charcoal-200 bg-white p-2 text-sm" />
                ) : (
                  <Input id={id}
                    type={q.kind === 'email' ? 'email'
                      : q.kind === 'phone' ? 'tel'
                      : q.kind === 'number' ? 'number'
                      : q.kind === 'date' ? 'date' : 'text'}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => set(e.target.value)} />
                )}
                {q.helpText ? (
                  <p className="text-xs text-charcoal-500">{q.helpText}</p>
                ) : null}
              </div>
            );
          })}

          {/* Hidden from people, filled in by robots. Left exactly as it is. */}
          <div aria-hidden="true" className="absolute -left-[5000px]">
            <input type="text" name="trap" tabIndex={-1} autoComplete="off"
              value={trap} onChange={(e) => setTrap(e.target.value)} />
          </div>

          {error ? <Alert tone="danger" title="That did not send">{error}</Alert> : null}

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-charcoal-500">
              {!reachable
                ? 'Leave an email address or a phone number so somebody can reply.'
                : unanswered.length > 0
                  ? `Still to answer: ${unanswered.join(', ')}.`
                  : ' '}
            </p>
            <Button disabled={!ready || busy}
              title={ready ? undefined
                : unanswered.length > 0
                  ? `Answer ${unanswered.join(', ')}`
                  : 'A name, and a way to reach you'}
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
                  answers,
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
