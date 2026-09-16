/**
 * Moving a claim along. WORKFLOW.
 *
 * Four separate acts, deliberately not one dropdown: noticing, submitting,
 * negotiating and resolving each record something different, and a control that
 * did all four would record none of them.
 *
 * The one that matters is the first. **A late notice is recorded, not refused.**
 * Most construction claims are lost on the notice clause rather than on their
 * merits, so refusing a notice given after the deadline — to keep the record
 * tidy — would hide the most expensive fact a company can know about its own
 * claim. It goes on the record, and the screen says how late it was.
 */
import { useState } from 'react';
import { Loader2, BellRing, Send, Scale, Gavel } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { messageFor } from '@/lib/data/query';
import {
  giveClaimNotice, submitClaim, setClaimStatus, resolveClaim, type ClaimRow,
} from '@/lib/data/claims';
import { date } from '@/lib/format';

const field = 'h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm';
const today = () => new Date().toISOString().slice(0, 10);

export function ClaimActions({ claim, canWrite, onChanged }: {
  claim: ClaimRow;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<'none' | 'notice' | 'submit' | 'resolve'>('none');
  const [givenOn, setGivenOn] = useState(today());
  const [submittedOn, setSubmittedOn] = useState(today());
  const [outcome, setOutcome] = useState<'settled' | 'denied'>('settled');
  const [resolution, setResolution] = useState('');
  const [costAwarded, setCostAwarded] = useState('');
  const [daysAwarded, setDaysAwarded] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(null);
    fn().then(() => { setMode('none'); onChanged(); })
      .catch((e: unknown) => setError(messageFor(e)))
      .finally(() => setBusy(false));
  };

  const closed = ['settled', 'denied', 'withdrawn'].includes(claim.status);
  /* Late before it is given, too — so the screen says it while it still matters. */
  const wouldBeLate = claim.noticeDueOn !== null && givenOn > claim.noticeDueOn;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {claim.noticeGivenOn === null && !closed ? (
          <Button variant="outline" size="sm" disabled={!canWrite}
            onClick={() => setMode(mode === 'notice' ? 'none' : 'notice')}
            title={canWrite ? 'Record the date notice was given'
              : 'Needs permission to change a claim'}>
            <BellRing className="size-3.5" /> Record notice
          </Button>
        ) : null}
        {claim.noticeGivenOn !== null && claim.claimSubmittedOn === null && !closed ? (
          <Button variant="outline" size="sm" disabled={!canWrite}
            onClick={() => setMode(mode === 'submit' ? 'none' : 'submit')}
            title="Submit the claim itself, which is a separate act from noticing it">
            <Send className="size-3.5" /> Submit the claim
          </Button>
        ) : null}
        {claim.noticeGivenOn !== null && !closed && claim.status !== 'negotiating' ? (
          <Button variant="ghost" size="sm" disabled={!canWrite}
            onClick={() => { act(() => setClaimStatus(claim.id, 'negotiating')); }}
            title="Mark it as being negotiated">
            <Scale className="size-3.5" /> Negotiating
          </Button>
        ) : null}
        {claim.noticeGivenOn !== null && !closed ? (
          <Button size="sm" disabled={!canWrite}
            onClick={() => setMode(mode === 'resolve' ? 'none' : 'resolve')}
            title="Settle it or record that it was denied">
            <Gavel className="size-3.5" /> Resolve
          </Button>
        ) : null}
        {claim.noticeGivenOn !== null && !closed ? (
          <Button variant="ghost" size="sm" disabled={!canWrite}
            onClick={() => { act(() => setClaimStatus(claim.id, 'withdrawn')); }}
            title="Withdraw it">
            Withdraw
          </Button>
        ) : null}
      </div>

      {mode === 'notice' ? (
        <div className="space-y-2 rounded-md border border-charcoal-200 bg-white p-3 text-left">
          <div className="space-y-1">
            <Label htmlFor={`nt-${claim.id}`}>Date notice was given</Label>
            <Input id={`nt-${claim.id}`} type="date" value={givenOn} autoFocus
              onChange={(e) => setGivenOn(e.target.value)} />
          </div>
          {claim.noticeDueOn ? (
            <p className="text-xs text-charcoal-500">
              The contract made it due {date(claim.noticeDueOn)}.
            </p>
          ) : (
            <p className="text-xs text-charcoal-500">
              No deadline is on file for this claim, so nothing here can say whether it is late.
            </p>
          )}
          {wouldBeLate ? (
            <Alert tone="warn" title="That is after the deadline">
              It goes on the record anyway. A late notice is a fact worth knowing about your own
              claim — most construction claims are lost on the notice clause rather than on their
              merits, and a record that quietly dropped this would be the worst version of it.
            </Alert>
          ) : null}
          <div className="flex justify-end">
            <Button size="sm" disabled={busy}
              onClick={() => { act(() => giveClaimNotice(claim.id, givenOn)); }}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null} Record it
            </Button>
          </div>
        </div>
      ) : null}

      {mode === 'submit' ? (
        <div className="space-y-2 rounded-md border border-charcoal-200 bg-white p-3 text-left">
          <div className="space-y-1">
            <Label htmlFor={`sb-${claim.id}`}>Date the claim was submitted</Label>
            <Input id={`sb-${claim.id}`} type="date" value={submittedOn} autoFocus
              onChange={(e) => setSubmittedOn(e.target.value)} />
          </div>
          {claim.claimDueOn ? (
            <p className="text-xs text-charcoal-500">
              The contract made it due {date(claim.claimDueOn)}.
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button size="sm" disabled={busy}
              onClick={() => { act(() => submitClaim(claim.id, { submittedOn })); }}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null} Submit it
            </Button>
          </div>
        </div>
      ) : null}

      {mode === 'resolve' ? (
        <div className="space-y-2 rounded-md border border-charcoal-200 bg-white p-3 text-left">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor={`rs-${claim.id}`}>Outcome</Label>
              <select id={`rs-${claim.id}`} className={field} value={outcome}
                onChange={(e) => setOutcome(e.target.value as 'settled' | 'denied')}>
                <option value="settled">Settled</option>
                <option value="denied">Denied</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`rc-${claim.id}`}>Cost awarded</Label>
              <Input id={`rc-${claim.id}`} type="number" value={costAwarded} placeholder="0"
                disabled={outcome === 'denied'}
                onChange={(e) => setCostAwarded(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`rd-${claim.id}`}>Days awarded</Label>
              <Input id={`rd-${claim.id}`} type="number" value={daysAwarded} placeholder="0"
                disabled={outcome === 'denied'}
                onChange={(e) => setDaysAwarded(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`rr-${claim.id}`}>What was decided, and why</Label>
            <textarea id={`rr-${claim.id}`} rows={2} value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              className="w-full rounded-md border border-charcoal-200 bg-white p-2 text-sm"
              placeholder="The next claim of this type is argued by somebody who can only read what is written here." />
          </div>
          <div className="flex justify-end">
            <Button size="sm" disabled={busy || resolution.trim().length < 10}
              title={resolution.trim().length < 10
                ? 'A resolution says what was decided and why' : undefined}
              onClick={() => {
                act(() => resolveClaim(claim.id, {
                  status: outcome,
                  resolution,
                  costAwarded: outcome === 'denied' ? 0 : Number(costAwarded || 0),
                  timeAwardedDays: outcome === 'denied' ? 0 : Number(daysAwarded || 0),
                }));
              }}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null} Record the outcome
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <Alert tone="danger" title="That did not happen">{error}</Alert> : null}
    </div>
  );
}
