/**
 * What the field measured, offered back to the library. WORKFLOW.
 *
 * The loop this closes is the one an estimating platform is for: a rate that
 * said 100 CY an hour, three jobs that achieved 65, and a person deciding
 * whether that is the truth or a month of rock.
 *
 * Two things this screen deliberately does not do:
 *
 *   * **It does not change a rate.** Accepting writes a *new* rate marked as
 *     something the field measured, and leaves the old one alone — estimates
 *     have already priced with it and an issued version cannot change.
 *   * **It does not hide the evidence.** The observation count, the hours, the
 *     jobs and the conditions are all on the row, because "the field says 65"
 *     is not a reason to move a number and "three jobs, thirty hours, all in
 *     clay" is.
 */
import { useState } from 'react';
import { Check, Loader2, Sparkles, TrendingDown, TrendingUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { EmptyState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import {
  productionCalibrations, proposeCalibrations, acceptCalibration, declineCalibration,
  type ProductionCalibration,
} from '@/lib/data/calibration';
import { plural } from '@/lib/format';

function Row({ c, canEdit, onChanged }: {
  c: ProductionCalibration; canEdit: boolean; onChanged: () => void;
}) {
  const [declining, setDeclining] = useState(false);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const slower = c.proposedRatePerHour < c.currentRatePerHour;
  const conditions = Object.entries(c.observedConditions)
    .sort((a, b) => b[1] - a[1]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setProblem(null);
    try { await fn(); onChanged(); }
    catch (err) { setProblem(messageFor(err)); }
    finally { setBusy(false); }
  };

  return (
    <li className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-medium text-charcoal-900">
          {c.rateCode ?? 'a rate'}
        </span>
        <Badge variant="outline" className={slower
          ? 'border-warn-200 bg-warn-100 text-warn-800'
          : 'border-ok-200 bg-ok-100 text-ok-800'}>
          {slower
            ? <TrendingDown className="size-3.5" />
            : <TrendingUp className="size-3.5" />}
          {Math.abs(c.variancePercent).toFixed(1)}% {slower ? 'slower' : 'faster'}
        </Badge>
        <span className="text-sm text-charcoal-600 tabular">
          {c.currentRatePerHour.toLocaleString()} → <strong className="text-charcoal-900">
            {c.proposedRatePerHour.toLocaleString()}
          </strong> {c.rateUnit ?? ''}/hr
        </span>
        {c.state !== 'pending' ? (
          <Badge variant="outline">{c.state === 'approved' ? 'Accepted' : 'Declined'}</Badge>
        ) : null}
      </div>

      {c.statisticalNote ? (
        <p className="text-sm text-charcoal-600">{c.statisticalNote}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5 text-xs text-charcoal-500">
        <span>{plural(c.sampleSize, 'observation')}</span>
        {c.sampleProjectIds.length > 0 ? (
          <span>· {plural(c.sampleProjectIds.length, 'job')}</span>
        ) : null}
        {conditions.length > 0 ? (
          <span>
            · {conditions.map(([k, n]) => `${k} ×${n}`).join(', ')}
          </span>
        ) : null}
      </div>

      {c.reviewNote ? (
        <p className="text-sm text-charcoal-600">
          <span className="text-charcoal-500">Noted: </span>{c.reviewNote}
        </p>
      ) : null}

      {c.state === 'pending' && canEdit ? (
        declining ? (
          <div className="flex flex-wrap items-end gap-2">
            <Input value={why} autoFocus className="h-8 min-w-64 flex-1"
              placeholder="Every one of those days was in rock"
              onChange={(e) => setWhy(e.target.value)} />
            <Button size="sm" variant="outline" disabled={busy || why.trim() === ''}
              title={why.trim() === ''
                ? 'Say why, or the same proposal comes back next month and nobody can tell it was looked at'
                : undefined}
              onClick={() => run(async () => {
                await declineCalibration(c.id, why.trim());
                setDeclining(false); setWhy('');
              })}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
              Decline it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDeclining(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy}
              title="Add this as a new rate of your own. The rate it was measured against is left alone."
              onClick={() => run(() => acceptCalibration(c.id))}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Use what the field measured
            </Button>
            <Button size="sm" variant="ghost" disabled={busy}
              title="Say why this does not change the rate"
              onClick={() => setDeclining(true)}>
              Not this one
            </Button>
          </div>
        )
      ) : null}

      {problem ? (
        <p role="alert" className="text-sm font-medium text-danger-700">{problem}</p>
      ) : null}
    </li>
  );
}

export function WhatTheFieldLearned({ companyId, canEdit }: {
  /* Null before a workspace is chosen. The list still reads — it is filtered by
     RLS, not by this — but asking the field for new proposals needs a company. */
  companyId: string | null; canEdit: boolean;
}) {
  const rows = useQuery(productionCalibrations, [companyId]);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const list = rows.status === 'ready' ? rows.data : [];
  const pending = list.filter((c) => c.state === 'pending');
  const decided = list.filter((c) => c.state !== 'pending');

  const look = async () => {
    if (!companyId) return;
    setBusy(true); setProblem(null); setSaid(null);
    try {
      const n = await proposeCalibrations(companyId);
      /*
       * Says nothing rather than showing an empty list. "Nothing new" and "it
       * did not run" look identical otherwise, and a person will click it again.
       */
      setSaid(n === 0
        ? 'Nothing new. Every rate with enough evidence behind it is within 5% of what the field achieved.'
        : `${plural(n, 'rate')} to look at.`);
      rows.refetch();
    } catch (err) { setProblem(messageFor(err)); }
    finally { setBusy(false); }
  };

  return (
    <CollapsibleCard
      id="what-the-field-learned"
      defaultOpen={pending.length > 0}
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="size-4 text-charcoal-500" />
          What the field learned
        </span>
      }
      summary={pending.length > 0 ? `${pending.length} to look at` : undefined}
      description={
        'Your crews record what they installed and the hours it took. Where that disagrees '
        + 'with a library rate by more than 5%, over at least three days, it is offered here. '
        + 'Nothing changes a rate until you say so — and accepting adds a new rate rather than '
        + 'rewriting the one your issued estimates were priced with.'
      }
      actions={canEdit ? (
        <Button size="sm" variant="outline" disabled={busy || !companyId} onClick={look}
          title={companyId
            ? 'Read the production your crews have recorded and see what it suggests'
            : 'Choose a workspace first — this reads one company\u2019s jobs'}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          Look at the field
        </Button>
      ) : undefined}
    >
      <div className="space-y-3">
        {said ? <p className="text-sm text-charcoal-600">{said}</p> : null}
        {problem ? (
          <p role="alert" className="text-sm font-medium text-danger-700">{problem}</p>
        ) : null}

        {pending.length === 0 && decided.length === 0 ? (
          <EmptyState
            title="Nothing from the field yet"
            hint="Once crews have recorded production against a rate for three days or more, what they achieved is compared with what the library said and the difference is offered here."
          />
        ) : null}

        {pending.length > 0 ? (
          <ul className="divide-y divide-charcoal-100 rounded-md border border-charcoal-200 bg-white">
            {pending.map((c) => (
              <Row key={c.id} c={c} canEdit={canEdit} onChanged={rows.refetch} />
            ))}
          </ul>
        ) : null}

        {decided.length > 0 ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-charcoal-500">Already decided</p>
            <ul className="divide-y divide-charcoal-100 rounded-md border border-charcoal-200 bg-charcoal-50/60">
              {decided.slice(0, 10).map((c) => (
                <Row key={c.id} c={c} canEdit={false} onChanged={rows.refetch} />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </CollapsibleCard>
  );
}
