/**
 * The pipeline, as something you work rather than something you read.
 *
 * `opportunities` has had eight stages in a check constraint since migration
 * 0005 — identified, qualifying, estimating, proposed, negotiating, won, lost,
 * abandoned — with a probability, a bid due date, an owner, a loss reason and a
 * winning competitor. Its only writer was `convert_lead`, which inserts at
 * `identified`. So every opportunity ever created sat in the stage it was born
 * in, for the life of the platform.
 *
 * Two consequences that looked like ordinary empty states: the win-rate tile
 * could only ever read zero, and the loss-reason line under it could never
 * render for anybody.
 *
 * Days in stage is on every row because it is what a pipeline review actually
 * looks for. Six weeks in "proposed" is the thing worth a phone call, and it
 * does not announce itself in a list sorted by value.
 */
import { useState } from 'react';
import { CalendarClock, CircleDot, Trophy, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import {
  loadPipeline, moveStage, OPEN_STAGES, STAGES,
  type PipelineRow, type Stage,
} from '@/lib/data/crm-pipeline';
import { money, date, integer, titleCase } from '@/lib/format';

const label = (s: string) => titleCase(s.replace(/_/g, ' '));

function Row({ o, editable, onChanged }: {
  o: PipelineRow; editable: boolean; onChanged: () => void;
}) {
  const [closing, setClosing] = useState<'lost' | null>(null);
  const [reason, setReason] = useState('');
  const [competitor, setCompetitor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const move = async (stage: Stage) => {
    if (!supabase || busy) return;
    /* Lost needs an answer, so it opens the form rather than sending nothing. */
    if (stage === 'lost' && !reason.trim()) { setClosing('lost'); return; }
    setBusy(true); setError(null);
    try {
      await moveStage(supabase, o.id, stage, reason, competitor);
      setClosing(null); setReason(''); setCompetitor('');
      onChanged();
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  return (
    <li className="rounded-lg border border-charcoal-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-charcoal-900">
            {o.name}
            <span className="ml-2 font-normal text-charcoal-500">{o.number}</span>
          </p>
          <p className="mt-0.5 text-xs text-charcoal-600">
            {o.customerName}
            {o.siteCity ? ` · ${o.siteCity}${o.siteState ? `, ${o.siteState}` : ''}` : ''}
            {o.bidDueAt ? ` · bid due ${date(o.bidDueAt)}` : ''}
          </p>
          {o.lossReason ? (
            <p className="mt-1 text-xs text-charcoal-600">
              Lost: {o.lossReason}
              {o.winningCompetitor ? ` — to ${o.winningCompetitor}` : ''}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="tabular text-sm font-medium text-charcoal-900">
            {o.estimatedValue == null ? '—' : money(o.estimatedValue)}
          </span>
          {o.probability != null && o.weightedValue != null && !o.isClosed ? (
            <span className="tabular text-xs text-charcoal-500">
              {`${Math.round(o.probability * 100)}% · ${money(o.weightedValue)} weighted`}
            </span>
          ) : null}
          <div className="flex items-center gap-1.5">
            <Badge variant={o.stage === 'won' ? 'success'
              : o.stage === 'lost' || o.stage === 'abandoned' ? 'danger' : 'default'}>
              {label(o.stage)}
            </Badge>
            {!o.isClosed ? (
              <span className="text-xs text-charcoal-500">
                {integer(o.daysInStage)}d in stage
              </span>
            ) : null}
          </div>
          {o.openActivities > 0 ? (
            <span className="flex items-center gap-1 text-xs text-charcoal-600">
              <CalendarClock className="size-3" aria-hidden />
              {integer(o.openActivities)} open
              {o.nextDueAt ? ` · next ${date(o.nextDueAt)}` : ''}
            </span>
          ) : null}
        </div>
      </div>

      {editable && !o.isClosed ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Label htmlFor={`stage-${o.id}`} className="text-xs text-charcoal-600">
            Stage
          </Label>
          <Select value={o.stage} onValueChange={(v) => void move(v as Stage)}>
            <SelectTrigger id={`stage-${o.id}`} className="h-8 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STAGES.map((s) => <SelectItem key={s} value={s}>{label(s)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" variant="outline" disabled={busy}
            onClick={() => void move('won')}>
            <Trophy className="mr-1.5 size-3.5" aria-hidden /> Won
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy}
            onClick={() => setClosing('lost')}>
            <XCircle className="mr-1.5 size-3.5" aria-hidden /> Lost
          </Button>
        </div>
      ) : null}

      {closing === 'lost' ? (
        <div className="mt-2 space-y-2 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3">
          <div className="space-y-1.5">
            <Label htmlFor={`reason-${o.id}`}>Why it was lost</Label>
            <Input id={`reason-${o.id}`} value={reason}
              placeholder="Price. We were 8% over."
              onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`comp-${o.id}`}>Who got it (optional)</Label>
            <Input id={`comp-${o.id}`} value={competitor}
              onChange={(e) => setCompetitor(e.target.value)} />
          </div>
          <p className="text-xs text-charcoal-500">
            Required, because it is the only field that ever answers whether the number
            was wrong or the relationship was.
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy || !reason.trim()}
              onClick={() => void move('lost')}>Record the loss</Button>
            <Button type="button" size="sm" variant="ghost"
              onClick={() => setClosing(null)}>Cancel</Button>
          </div>
        </div>
      ) : null}

      {error ? <Alert tone="danger" title="That could not be saved">{error}</Alert> : null}
    </li>
  );
}

export function PipelineBoard({ editable }: { editable: boolean }) {
  const pipelineQ = useQuery(loadPipeline, []);
  const all = pipelineQ.status === 'ready' ? pipelineQ.data : [];
  const open = all.filter((o) => !o.isClosed);
  const closed = all.filter((o) => o.isClosed);
  const won = closed.filter((o) => o.stage === 'won');
  const decided = closed.filter((o) => o.stage === 'won' || o.stage === 'lost');

  const weighted = open.reduce((a, o) => a + (o.weightedValue ?? 0), 0);

  return (
    <CollapsibleCard
      id="pipeline-board"
      title={<span className="flex items-center gap-2">
        <CircleDot className="size-4 text-charcoal-500" aria-hidden /> Working the pipeline
      </span>}
      description="Every stage but the first was unreachable until now: the only writer of an opportunity was lead conversion, so each one stayed where it was created."
      summary={`${integer(open.length)} open · ${money(weighted)} weighted`}
      defaultOpen
    >
      <div className="space-y-4">
        {pipelineQ.status === 'loading' ? <LoadingState label="Reading the pipeline" /> : null}
        {pipelineQ.status === 'error'
          ? <ErrorState message={pipelineQ.message} onRetry={pipelineQ.refetch} /> : null}

        {pipelineQ.status === 'ready' && all.length === 0 ? (
          <EmptyState title="Nothing in the pipeline yet"
            hint="An opportunity arrives when a qualified lead is converted." />
        ) : null}

        {decided.length > 0 ? (
          <p className="text-sm text-charcoal-600">
            {`${integer(won.length)} of ${integer(decided.length)} decided bids won`}
            {` · ${Math.round((won.length / decided.length) * 100)}%`}
          </p>
        ) : null}

        {open.length > 0 ? (
          <ul className="space-y-2">
            {OPEN_STAGES.flatMap((stage) => open.filter((o) => o.stage === stage))
              .map((o) => (
                <Row key={o.id} o={o} editable={editable} onChanged={pipelineQ.refetch} />
              ))}
          </ul>
        ) : null}

        {closed.length > 0 ? (
          <section>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-charcoal-500">
              Decided
            </h4>
            <ul className="space-y-2">
              {closed.map((o) => (
                <Row key={o.id} o={o} editable={false} onChanged={pipelineQ.refetch} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </CollapsibleCard>
  );
}
