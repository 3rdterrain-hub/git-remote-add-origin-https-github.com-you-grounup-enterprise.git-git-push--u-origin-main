/**
 * A proposal while it is still being written.
 *
 * `proposals.status` has allowed `'draft'` since migration 0006, and the
 * immutability trigger has opened with `if old.status = 'draft' then return
 * new` since 0013. Neither had ever happened: `issue_proposal` inserts straight
 * at `'issued'`, so there was no moment at which a proposal was editable.
 *
 * That is why `commercial_terms` and `payment_terms` were written by nothing.
 * They are not missing columns and this is not a missing form — they were two
 * fields with nowhere in the lifecycle to be filled in. A cover letter with a
 * typo in it meant issuing a second proposal.
 *
 * The price is deliberately not here. `app.enforce_proposal_price` derives a
 * draft's total from the estimate's bid price on every write, so a draft that
 * sits while the estimate is re-priced follows it, and there is no box in which
 * to type a number of your own.
 */
import { useEffect, useState } from 'react';
import { FileEdit, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import {
  updateProposal, issueDraftedProposal, discardProposalDraft, type ProposalRow,
} from '@/lib/data/estimates';
import { money } from '@/lib/format';

export function ProposalDraftEditor({ proposal, editable, onChanged }: {
  proposal: ProposalRow;
  editable: boolean;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(proposal.title);
  const [cover, setCover] = useState(proposal.coverLetter ?? '');
  const [commercial, setCommercial] = useState(proposal.commercialTerms ?? '');
  const [payment, setPayment] = useState(proposal.paymentTerms ?? '');
  const [validity, setValidity] = useState(String(proposal.validityDays));
  const [showLines, setShowLines] = useState(proposal.showLineDetail);
  const [showUnitPrices, setShowUnitPrices] = useState(proposal.showUnitPrices);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setTitle(proposal.title);
    setCover(proposal.coverLetter ?? '');
    setCommercial(proposal.commercialTerms ?? '');
    setPayment(proposal.paymentTerms ?? '');
    setValidity(String(proposal.validityDays));
    setShowLines(proposal.showLineDetail);
    setShowUnitPrices(proposal.showUnitPrices);
    setSaved(false);
  }, [proposal]);

  if (proposal.status !== 'draft') return null;

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    if (!supabase || busy) return;
    setBusy(true); setError(null); setSaved(false);
    try { await fn(); after?.(); onChanged(); }
    catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  };

  const save = () => run(() => updateProposal(supabase!, proposal.id, {
    title,
    coverLetter: cover.trim() || null,
    commercialTerms: commercial.trim() || null,
    paymentTerms: payment.trim() || null,
    validityDays: Number(validity) || proposal.validityDays,
    showLineDetail: showLines,
    showUnitPrices: showLines && showUnitPrices,
  }), () => setSaved(true));

  return (
    <section className="space-y-4 rounded-[--radius-card] border border-yellow-300
                        bg-yellow-50/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium text-charcoal-900">
            <FileEdit className="size-4 text-charcoal-500" aria-hidden />
            This proposal has not been sent
          </h3>
          <p className="mt-0.5 text-xs text-charcoal-600">
            Everything here can be changed until you send it. Afterwards none of it can —
            what the customer was sent is what the customer was sent.
          </p>
        </div>
        <span className="tabular text-sm font-medium text-charcoal-900">
          {money(proposal.totalPrice)}
        </span>
      </div>

      {editable ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="d-title">Title</Label>
              <Input id="d-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="d-cover">Cover letter</Label>
              <Textarea id="d-cover" rows={3} value={cover}
                onChange={(e) => setCover(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-commercial">Commercial terms</Label>
              <Textarea id="d-commercial" rows={3} value={commercial}
                placeholder="Price held 30 days. Rock excavation excluded."
                onChange={(e) => setCommercial(e.target.value)} />
              <p className="text-xs text-charcoal-500">
                Qualifications and exclusions — what the price does and does not cover.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-payment">Payment terms</Label>
              <Textarea id="d-payment" rows={3} value={payment}
                placeholder="Net 30. Monthly progress billing."
                onChange={(e) => setPayment(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-validity">Valid for (days)</Label>
              <Input id="d-validity" type="number" min={1} value={validity}
                onChange={(e) => setValidity(e.target.value)} />
            </div>
          </div>

          <fieldset className="space-y-2 rounded-md border border-charcoal-200 bg-white p-3">
            <legend className="px-1 text-sm font-medium text-charcoal-900">
              What the customer sees
            </legend>
            <label className="flex items-start gap-2 text-sm text-charcoal-700">
              <input type="checkbox" className="mt-0.5" checked={showLines}
                onChange={(e) => setShowLines(e.target.checked)} />
              <span>The scope, line by line
                <span className="block text-xs text-charcoal-500">
                  Only lines marked visible to the client.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-charcoal-700">
              <input type="checkbox" className="mt-0.5" checked={showUnitPrices}
                disabled={!showLines}
                onChange={(e) => setShowUnitPrices(e.target.checked)} />
              <span>Unit prices against each line</span>
            </label>
          </fieldset>

          {error ? <Alert tone="danger" title="That could not be saved">{error}</Alert> : null}
          {saved ? <Alert tone="success">Draft saved.</Alert> : null}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={busy}
              onClick={() => void save()}>
              {busy ? 'Saving' : 'Save draft'}
            </Button>
            <Button type="button" disabled={busy}
              onClick={() => void run(() => issueDraftedProposal(supabase!, proposal.id))}>
              <Send className="mr-1.5 size-3.5" aria-hidden /> Send it
            </Button>
            <Button type="button" variant="ghost" disabled={busy}
              onClick={() => void run(() => discardProposalDraft(supabase!, proposal.id))}>
              <Trash2 className="mr-1.5 size-3.5" aria-hidden /> Discard
            </Button>
          </div>
          <p className="text-xs text-charcoal-500">
            Sending re-checks the estimate, because a draft can sit while the estimate
            behind it moves.
          </p>
        </>
      ) : null}
    </section>
  );
}
