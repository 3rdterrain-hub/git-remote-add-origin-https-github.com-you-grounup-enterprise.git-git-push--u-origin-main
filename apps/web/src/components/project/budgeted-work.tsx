/**
 * The work this job was won on.
 *
 * `award_estimate_version` has copied every priced line onto the project as a
 * budgeted task since migration 0007 — quantity, hours, cost, cost code and
 * crew. **Nothing has ever listed them.** The estimate's whole content crossed
 * over to the project and became invisible at the moment it arrived, which is
 * the defect this build produces most, applied to the handoff the platform is
 * built around.
 *
 * Reported and unreported are kept apart because they are different questions.
 * A task nobody has reported on is not a task at nought percent — it is a task
 * nobody has said anything about, and telling those apart is the difference
 * between a plan and an alarm.
 */
import { useState } from 'react';
import { HardHat } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { supabase } from '@/lib/supabase';
import { messageFor } from '@/lib/data/query';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useQuery } from '@/lib/data/query';
import {
  loadProjectTasks, reportProduction, type TaskProgress,
} from '@/lib/data/project';
import { money, qty, percent, integer, date } from '@/lib/format';

function Row({ t, editable, onReported }: {
  t: TaskProgress; editable: boolean; onReported: () => void;
}) {
  /* Ahead if the budget said more hours than it has taken to get this far. */
  const behind = t.hoursIndex !== null && t.hoursIndex < 1;

  const [reporting, setReporting] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [hours, setHours] = useState('');
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!supabase || busy) return;
    setBusy(true); setError(null);
    try {
      await reportProduction(supabase, {
        taskId: t.id,
        quantity: Number(quantity),
        crewHours: Number(hours),
        workDate: day,
      });
      setReporting(false); setQuantity(''); setHours('');
      onReported();
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  return (
    <li className="border-b border-charcoal-200 py-2.5 last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-charcoal-900">
            {t.name}
            {t.costCode ? (
              <span className="ml-2 font-normal text-charcoal-500">{t.costCode}</span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-charcoal-600">
            {t.reported
              ? `${qty(t.installedQuantity)} of ${qty(t.budgetedQuantity)} ${t.unit}`
              : `${qty(t.budgetedQuantity)} ${t.unit} budgeted`}
            {t.budgetedHours > 0 ? ` · ${integer(t.budgetedHours)} hr budgeted` : ''}
            {t.reported && t.actualHours > 0 ? `, ${integer(t.actualHours)} used` : ''}
            {t.lastReportedOn ? ` · last reported ${date(t.lastReportedOn)}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {t.reported ? (
            <span className="tabular text-xs text-charcoal-700">
              {percent(t.percentComplete)}
            </span>
          ) : (
            <span className="text-xs text-charcoal-400">not reported</span>
          )}
          {behind ? <Badge variant="warn">behind on hours</Badge> : null}
          <span className="tabular text-sm text-charcoal-900">{money(t.budgetedCost)}</span>
        </div>
      </div>
      {t.reported ? (
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-charcoal-200">
          <div className="h-full rounded-full bg-yellow-500"
            style={{ width: `${Math.min(100, t.percentComplete * 100)}%` }} />
        </div>
      ) : null}

      {/*
        * Reporting a day, which is what makes any of the rest of this real.
        * Nothing wrote `production_actuals` before migration 0180, so every
        * project stayed unreported and earned value stayed blank forever.
        */}
      {editable && !reporting ? (
        <Button type="button" size="sm" variant="ghost" className="mt-1"
          onClick={() => setReporting(true)}>
          <HardHat className="mr-1.5 size-3.5" aria-hidden /> Report a day
        </Button>
      ) : null}

      {editable && reporting ? (
        <div className="mt-2 space-y-2 rounded-md border border-charcoal-200
                        bg-white p-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor={`q-${t.id}`}>Installed ({t.unit})</Label>
              <Input id={`q-${t.id}`} type="number" step="0.01" value={quantity}
                onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`h-${t.id}`}>Crew hours</Label>
              <Input id={`h-${t.id}`} type="number" step="0.25" value={hours}
                onChange={(e) => setHours(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`d-${t.id}`}>Day</Label>
              <Input id={`d-${t.id}`} type="date" value={day}
                onChange={(e) => setDay(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-charcoal-500">
            The hours are not optional: a quantity with no hours against it cannot
            become a production rate, and the rate is what the next estimate learns
            from. One report to a day — a second amends it.
          </p>
          {error ? <Alert tone="danger" title="That could not be reported">{error}</Alert> : null}
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy || !quantity.trim() || !hours.trim()}
              onClick={() => void send()}>Report it</Button>
            <Button type="button" size="sm" variant="ghost"
              onClick={() => setReporting(false)}>Cancel</Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function BudgetedWork({ projectId, editable }: {
  projectId: string; editable: boolean;
}) {
  const tasksQ = useQuery(loadProjectTasks(projectId), [projectId]);
  const rows = tasksQ.status === 'ready' ? tasksQ.data : [];
  const reported = rows.filter((t) => t.reported);
  const waiting = rows.filter((t) => !t.reported);
  const budgeted = rows.reduce((a, t) => a + t.budgetedCost, 0);

  return (
    <CollapsibleCard
      id="budgeted-work"
      title="The work this job was won on"
      description="Every priced line from the winning estimate, carried across as a budgeted task. It has been written at award since migration 0007 and listed by nothing until now."
      summary={rows.length === 0 ? 'nothing budgeted'
        : `${integer(rows.length)} tasks · ${money(budgeted)}`}
      defaultOpen
    >
      <div className="space-y-4">
        {tasksQ.status === 'loading' ? <LoadingState label="Reading the budgeted work" /> : null}
        {tasksQ.status === 'error'
          ? <ErrorState message={tasksQ.message} onRetry={tasksQ.refetch} /> : null}

        {tasksQ.status === 'ready' && rows.length === 0 ? (
          <EmptyState title="No budgeted work on this project"
            hint="Work arrives here when an estimate is awarded — every priced line becomes a task carrying its quantity, hours and cost." />
        ) : null}

        {reported.length > 0 ? (
          <section>
            <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-charcoal-500">
              Reported on
            </h4>
            <ul>{reported.map((t) => (
              <Row key={t.id} t={t} editable={editable} onReported={tasksQ.refetch} />
            ))}</ul>
          </section>
        ) : null}

        {waiting.length > 0 ? (
          <section>
            <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-charcoal-500">
              Nothing reported yet
            </h4>
            <ul>{waiting.map((t) => (
              <Row key={t.id} t={t} editable={editable} onReported={tasksQ.refetch} />
            ))}</ul>
          </section>
        ) : null}
      </div>
    </CollapsibleCard>
  );
}
