/**
 * The page a customer signs on.
 *
 * Outside `/app` and outside the shell entirely: whoever opens this is not a
 * member of anything, holds no permission, and should never see a navigation
 * bar for a platform they do not use. The token in the address is their whole
 * credential, and it is enough — it names one proposal, lasts a stated number
 * of days, and is spent the moment they answer.
 *
 * It is deliberately plain. Somebody reaches this from an email on a phone,
 * possibly in a truck, to make a decision worth tens of thousands of pounds.
 * The things that matter are the number, what it covers, and two buttons.
 *
 * The document is hashed as it was rendered and the hash goes with the
 * signature, so "they accepted" keeps meaning something: a proposal edited
 * afterwards cannot claim a signature for a version nobody saw.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Download, XCircle, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  openProposalByToken, respondToProposal, hashDocument,
  type SignableProposal,
} from '@/lib/data/proposal-links';
import { money, qty, date } from '@/lib/format';
import { logoUrl } from '@/lib/data/company';
import { downloadProposalPdf } from '@/lib/data/proposal-pdf';
import { readableOn } from '@/components/settings/branding';

type Stage =
  | { at: 'loading' }
  | { at: 'error'; message: string }
  | { at: 'reading'; doc: SignableProposal }
  | { at: 'done'; outcome: string; number: string; signedBy: string };

export function SignProposalPage() {
  const { token } = useParams();
  const [stage, setStage] = useState<Stage>({ at: 'loading' });
  const [answering, setAnswering] = useState<'accepted' | 'declined' | null>(null);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!token) { setStage({ at: 'error', message: 'This link is not complete.' }); return; }
    openProposalByToken(token)
      .then((doc) => {
        if (!alive) return;
        setStage({ at: 'reading', doc });
        setName(doc.recipientName);
      })
      .catch((err: Error) => { if (alive) setStage({ at: 'error', message: err.message }); });
    return () => { alive = false; };
  }, [token]);

  const doc = stage.at === 'reading' ? stage.doc : null;

  const total = useMemo(() => (doc ? money(doc.totalPrice) : ''), [doc]);

  const answer = async (outcome: 'accepted' | 'declined') => {
    if (!doc || !token) return;
    setBusy(true); setError(null);
    try {
      const documentHash = await hashDocument(doc);
      const result = await respondToProposal({
        token, outcome,
        signedName: name,
        signedTitle: title || null,
        signedEmail: email || null,
        signatureText: name,
        declineReason: outcome === 'declined' ? reason : null,
        documentHash,
      });
      setStage({
        at: 'done', outcome: result.outcome, number: result.number, signedBy: result.signedBy,
      });
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  if (stage.at === 'loading') {
    return (
      <Shell>
        <p className="flex items-center gap-2 text-sm text-charcoal-600">
          <Loader2 className="size-4 animate-spin" /> Opening the proposal…
        </p>
      </Shell>
    );
  }

  if (stage.at === 'error') {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-charcoal-900">This link cannot be opened</h1>
        <p className="mt-2 text-sm text-charcoal-600">{stage.message}</p>
        <p className="mt-4 text-sm text-charcoal-500">
          Ask whoever sent it for a new one — a link is issued to one person, lasts a set
          number of days, and is spent once it has been answered.
        </p>
      </Shell>
    );
  }

  if (stage.at === 'done') {
    const accepted = stage.outcome === 'accepted';
    return (
      <Shell>
        <div className="flex items-start gap-3">
          {accepted
            ? <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-success-600" />
            : <XCircle className="mt-0.5 size-6 shrink-0 text-charcoal-500" />}
          <div>
            <h1 className="text-lg font-semibold text-charcoal-900">
              {accepted ? 'Accepted' : 'Declined'} — thank you
            </h1>
            <p className="mt-1 text-sm text-charcoal-600">
              {stage.number} was {stage.outcome} by {stage.signedBy}. A record of this has gone
              to the contractor, and you can close this page.
            </p>
          </div>
        </div>
      </Shell>
    );
  }

  const d = stage.doc;
  const brandLogo = logoUrl(d.company.logoPath);
  return (
    <Shell>
      {/*
        * The sender's own mark and colors, not the platform's. This page is
        * the one a customer actually receives — it is opened from an emailed
        * link with no account and no session — and it carried no branding at
        * all, because the three columns behind it had been on `companies`
        * since migration 0002 and were read by nothing.
        *
        * The logo is a public object for exactly this reason: a signed URL
        * that expires is a letterhead that disappears from a document the
        * customer keeps.
        */}
      <header className="overflow-hidden rounded-lg border border-charcoal-200">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5"
          style={{
            backgroundColor: d.company.primaryColor,
            color: readableOn(d.company.primaryColor),
          }}>
          <div className="flex min-w-0 items-center gap-3">
            {brandLogo ? (
              <img src={brandLogo} alt={d.company.name}
                className="max-h-12 max-w-48 object-contain" />
            ) : (
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold">{d.company.name}</p>
                {d.company.city ? (
                  <p className="text-xs opacity-80">
                    {d.company.city}{d.company.state ? `, ${d.company.state}` : ''}
                  </p>
                ) : null}
              </div>
            )}
          </div>
          <div className="text-right text-xs">
            <p className="font-medium tracking-wide">PROPOSAL</p>
            <p className="opacity-80">{d.number}</p>
          </div>
        </div>
        <div className="h-1.5" style={{ backgroundColor: d.company.accentColor }} />
        <div className="p-5">
          {brandLogo ? (
            <p className="text-sm font-medium text-charcoal-700">
              {d.company.name}
              {d.company.city
                ? ` · ${d.company.city}${d.company.state ? `, ${d.company.state}` : ''}`
                : ''}
            </p>
          ) : null}
          <h1 className="mt-1 text-xl font-semibold text-charcoal-900">{d.title}</h1>
          <p className="mt-0.5 text-sm text-charcoal-500">
            {d.issuedAt ? `Issued ${date(d.issuedAt)} · ` : ''}
            {`this link expires ${date(d.expiresAt)}`}
          </p>
          {/*
            * A copy to keep. The link expires and the page behind it stops
            * answering; a proposal somebody accepted and can no longer read is
            * not a record of anything.
            */}
          <Button variant="outline" size="sm" className="mt-3"
            onClick={() => downloadProposalPdf({
              number: d.number,
              title: d.title,
              customerName: d.recipientName,
              issuedAt: d.issuedAt,
              validityDays: d.validityDays,
              totalPrice: d.totalPrice,
              coverLetter: d.coverLetter,
              commercialTerms: d.commercialTerms,
              paymentTerms: d.paymentTerms,
              showLineDetail: d.showLineDetail,
              showUnitPrices: d.showUnitPrices,
              lines: d.lines,
            }, {
              name: d.company.name,
              primaryColor: d.company.primaryColor,
              accentColor: d.company.accentColor,
              city: d.company.city,
              stateProvince: d.company.state,
            })}>
            <Download className="mr-1.5 size-3.5" aria-hidden /> Download a copy
          </Button>
        </div>
      </header>

      {d.coverLetter ? (
        <p className="whitespace-pre-wrap text-sm text-charcoal-700">{d.coverLetter}</p>
      ) : null}

      {d.showLineDetail && d.lines.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-charcoal-200 text-left text-xs uppercase tracking-wide text-charcoal-500">
                <th className="py-2">Scope</th>
                <th className="py-2 text-right">Quantity</th>
                {d.showUnitPrices ? <th className="py-2 text-right">Unit price</th> : null}
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l, i) => (
                <tr key={i} className="border-b border-charcoal-100 last:border-0">
                  <td className="py-2 pr-3 text-charcoal-800">{l.description}</td>
                  <td className="tabular py-2 text-right text-charcoal-600">
                    {l.quantity === null ? '—' : `${qty(l.quantity)}${l.unit ? ` ${l.unit}` : ''}`}
                  </td>
                  {d.showUnitPrices ? (
                    <td className="tabular py-2 text-right text-charcoal-600">
                      {l.unitPrice === null ? '—' : money(l.unitPrice)}
                    </td>
                  ) : null}
                  <td className="tabular py-2 text-right text-charcoal-900">
                    {l.total === null ? '—' : money(l.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="flex items-baseline justify-between border-y border-charcoal-300 py-3">
        <span className="text-sm font-medium text-charcoal-700">Total</span>
        <span className="tabular text-2xl font-semibold text-charcoal-900">{total}</span>
      </div>

      {d.commercialTerms ? (
        <section>
          <h2 className="text-sm font-medium text-charcoal-800">Terms</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm text-charcoal-600">{d.commercialTerms}</p>
        </section>
      ) : null}
      {d.paymentTerms ? (
        <section>
          <h2 className="text-sm font-medium text-charcoal-800">Payment</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm text-charcoal-600">{d.paymentTerms}</p>
        </section>
      ) : null}

      <section className="rounded-[--radius-card] border border-charcoal-200 bg-charcoal-50/60 p-4">
        <h2 className="text-sm font-medium text-charcoal-900">Your answer</h2>
        <p className="mt-1 text-xs text-charcoal-500">
          Typing your name below is your signature. It is recorded against this proposal exactly
          as it stands now, with the date and time.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="sign-name">Your name</Label>
            <Input id="sign-name" value={name} onChange={(e) => setName(e.target.value)}
              autoComplete="name" />
          </div>
          <div>
            <Label htmlFor="sign-title">Your title</Label>
            <Input id="sign-title" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Owner's representative" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="sign-email">Your email</Label>
            <Input id="sign-email" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
        </div>

        {answering === 'declined' ? (
          <div className="mt-3">
            <Label htmlFor="sign-reason">Why are you declining?</Label>
            <Textarea id="sign-reason" rows={3} value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="So the contractor knows what to change" />
          </div>
        ) : null}

        {error ? <p className="mt-3 text-sm text-danger-700">{error}</p> : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={busy || !name.trim()} onClick={() => { void answer('accepted'); }}>
            {busy && answering !== 'declined' ? <Loader2 className="size-4 animate-spin" /> : null}
            Accept this proposal
          </Button>
          {answering === 'declined' ? (
            <Button variant="outline" disabled={busy || !name.trim() || !reason.trim()}
              onClick={() => { void answer('declined'); }}>
              Send the decline
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setAnswering('declined')}>Decline</Button>
          )}
        </div>
      </section>

      <p className="flex items-start gap-2 text-xs text-charcoal-500">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        This link was issued to {d.recipientName} and can be answered once. Your answer is
        recorded against the proposal exactly as shown above.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-charcoal-50 px-4 py-10">
      <div className="mx-auto w-full max-w-3xl space-y-5 rounded-[--radius-card] border
                      border-charcoal-200 bg-white p-6 shadow-sm">
        {children}
      </div>
    </main>
  );
}
