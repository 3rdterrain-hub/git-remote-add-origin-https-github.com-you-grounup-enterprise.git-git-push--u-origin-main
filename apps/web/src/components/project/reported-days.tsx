/**
 * What the field reported, day by day.
 *
 * `production_actuals` has had a place for this since migration 0007 and
 * nothing ever wrote one, so a project's progress could not move off zero and
 * the cost performance index cried wolf on every job. Migration 0180 gave it a
 * writer; this is where the days it wrote can be read back and corrected.
 *
 * The rate achieved sits beside the rate budgeted, because that comparison is
 * the whole of production reporting: not "are we done" but "are we going at the
 * speed the price assumed". It is also the number the next estimate should
 * learn from, which is why the hours are not optional when a day is reported.
 */
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import {
  loadProductionReports, withdrawProductionReport, type ProductionReport,
} from '@/lib/data/project';
import { qty, date, integer } from '@/lib/format';

function Day({ r, editable, onChanged }: {
  r: ProductionReport; editable: boolean; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Slower than the price assumed, which is the thing worth seeing early. */
  const behind = r.actualPerHour !== null && r.budgetedPerHour !== null
    && r.actualPerHour < r.budgetedPerHour;

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b
                   border-charcoal-200 py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-sm text-charcoal-900">
          {r.taskName}
          <span className="ml-2 text-charcoal-500">{date(r.workDate)}</span>
        </p>
        <p className="mt-0.5 text-xs text-charcoal-600">
          {qty(r.quantityInstalled)} {r.unit} in {integer(r.crewHours)} crew hours
          {r.crewSize ? ` · ${integer(r.crewSize)} on the crew` : ''}
          {r.equipmentHours > 0 ? ` · ${integer(r.equipmentHours)} equipment hours` : ''}
        </p>
        {r.notes ? <p className="mt-0.5 text-xs text-charcoal-500">{r.notes}</p> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {r.actualPerHour !== null ? (
          <span className="tabular text-xs text-charcoal-700">
            {qty(r.actualPerHour)} {r.unit}/hr
            {r.budgetedPerHour !== null ? (
              <span className="text-charcoal-400"> of {qty(r.budgetedPerHour)}</span>
            ) : null}
          </span>
        ) : null}
        {behind ? <Badge variant="warn">below the estimate</Badge> : null}
        {editable ? (
          <button type="button" disabled={busy}
            aria-label={`Withdraw ${r.taskName} on ${date(r.workDate)}`}
            title="Take this day back"
            onClick={async () => {
              if (!supabase) return;
              setBusy(true); setError(null);
              try { await withdrawProductionReport(supabase, r.id); onChanged(); }
              catch (e) { setError(messageFor(e)); }
              finally { setBusy(false); }
            }}
            className="rounded p-1 text-charcoal-400 hover:bg-danger-50 hover:text-danger-700">
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function ReportedDays({ projectId, editable }: {
  projectId: string; editable: boolean;
}) {
  const reportsQ = useQuery(loadProductionReports(projectId), [projectId]);
  const rows = reportsQ.status === 'ready' ? reportsQ.data : [];

  return (
    <section className="space-y-3 rounded-[--radius-card] border border-charcoal-200
                        bg-white p-4">
      <div>
        <h3 className="text-sm font-medium text-charcoal-900">What the field reported</h3>
        <p className="text-xs text-charcoal-500">
          The rate achieved against the rate the price assumed. Not "are we done" but
          "are we going at the speed we bid".
        </p>
      </div>

      {reportsQ.status === 'loading' ? <LoadingState label="Reading the days" /> : null}
      {reportsQ.status === 'error'
        ? <ErrorState message={reportsQ.message} onRetry={reportsQ.refetch} /> : null}

      {reportsQ.status === 'ready' && rows.length === 0 ? (
        <EmptyState title="Nothing reported on this job yet"
          hint="Report a day against a budgeted task, on the Budgeted work tab. Until somebody does, earned value and cost performance stay blank rather than reading zero." />
      ) : null}

      {rows.length > 0 ? (
        <ul>
          {rows.map((r) => (
            <Day key={r.id} r={r} editable={editable} onChanged={reportsQ.refetch} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
