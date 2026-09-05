import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { useQuery } from '@/lib/data/query';
import { loadCancellationReasons } from '@/lib/data/session';
import { callFunction } from '@/lib/supabase';

/**
 * Asking why, at the only moment anybody will answer.
 *
 * Somebody who cancels in March will not answer this in June, which is what
 * makes it worth interrupting a cancellation for — once. The question is one
 * click, the detail box is optional except where the answer is meaningless
 * without it, and **nothing here can prevent the cancellation**. A form that
 * blocked somebody from leaving would be the kind of dark pattern this
 * platform exists not to be, and they would leave anyway, angrier.
 */
export function CancelDialog({ companyId, onClose, onDone }: {
  companyId: string;
  onClose: () => void;
  onDone: (accessUntil: string | null) => void;
}) {
  const reasonsQ = useQuery(loadCancellationReasons, []);
  const reasons = reasonsQ.status === 'ready' ? reasonsQ.data : [];

  const [reasonKey, setReasonKey] = useState('');
  const [detail, setDetail] = useState('');
  const [competitor, setCompetitor] = useState('');
  const [wouldReturn, setWouldReturn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = reasons.find((r) => r.key === reasonKey);
  const needsDetail = chosen?.needsDetail ?? false;

  async function cancel() {
    setBusy(true); setError(null);
    try {
      const res = await callFunction<{ accessUntil: string | null }>('cancel-subscription', {
        companyId,
        immediate: false,
        reasonKey: reasonKey || null,
        detail: detail.trim() || null,
        competitor: competitor.trim() || null,
        wouldReturn,
      });
      onDone(res.accessUntil);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The cancellation could not be sent.');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal-900/40 p-4"
      role="dialog" aria-modal="true" aria-label="Cancel your subscription">
      <div className="max-h-full w-full max-w-lg overflow-auto rounded-[--radius-card]
                      border border-charcoal-200 bg-white p-6 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-charcoal-900">Cancel your subscription</h2>
            <p className="mt-1 text-sm text-charcoal-500">
              Your access runs to the end of the period you have already paid for. Nothing
              you have made is deleted — estimates, projects and documents all stay, and you
              can read and export them afterwards.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>

        {error ? <Alert tone="danger" className="mt-4">{error}</Alert> : null}

        <div className="mt-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">
              Would you tell us why? It genuinely changes what gets built.
            </Label>
            <select id="cancel-reason" value={reasonKey}
              className="h-9 w-full rounded border border-charcoal-300 bg-white px-2 text-sm"
              onChange={(e) => setReasonKey(e.target.value)}>
              <option value="">Rather not say</option>
              {reasons.map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </select>
          </div>

          {reasonKey ? (
            <div className="space-y-1.5">
              <Label htmlFor="cancel-detail">
                {needsDetail ? 'What was it?' : 'Anything else? (optional)'}
              </Label>
              <Input id="cancel-detail" value={detail}
                placeholder={reasonKey === 'missing_feature'
                  ? 'What it could not do' : 'In your own words'}
                onChange={(e) => setDetail(e.target.value)} />
            </div>
          ) : null}

          {reasonKey === 'switched' ? (
            <div className="space-y-1.5">
              <Label htmlFor="cancel-competitor">What did you move to?</Label>
              <Input id="cancel-competitor" value={competitor}
                onChange={(e) => setCompetitor(e.target.value)} />
            </div>
          ) : null}

          {reasonKey ? (
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium text-charcoal-700">
                Would you consider coming back?
              </legend>
              <div className="flex gap-2">
                <Button type="button" size="sm"
                  variant={wouldReturn === true ? 'default' : 'outline'}
                  onClick={() => setWouldReturn(true)}>Yes</Button>
                <Button type="button" size="sm"
                  variant={wouldReturn === false ? 'default' : 'outline'}
                  onClick={() => setWouldReturn(false)}>No</Button>
              </div>
            </fieldset>
          ) : null}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          {/*
            * Canceling is never blocked on answering. Somebody who does not
            * want to say why still gets to leave, on the first click, and the
            * answer is filed as "nobody was asked" rather than as a guess.
            */}
          <Button variant="ghost" onClick={onClose}>Keep my subscription</Button>
          <Button variant="outline" disabled={busy || (needsDetail && detail.trim().length < 3)}
            onClick={cancel}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Cancel at the end of the period
          </Button>
        </div>
      </div>
    </div>
  );
}
