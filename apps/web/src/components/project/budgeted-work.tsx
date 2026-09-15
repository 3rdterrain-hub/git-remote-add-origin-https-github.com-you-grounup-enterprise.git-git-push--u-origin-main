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
import { Badge } from '@/components/ui/badge';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useQuery } from '@/lib/data/query';
import { loadProjectTasks, type TaskProgress } from '@/lib/data/project';
import { money, qty, percent, integer, date } from '@/lib/format';

function Row({ t }: { t: TaskProgress }) {
  /* Ahead if the budget said more hours than it has taken to get this far. */
  const behind = t.hoursIndex !== null && t.hoursIndex < 1;

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
    </li>
  );
}

export function BudgetedWork({ projectId }: { projectId: string }) {
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
            <ul>{reported.map((t) => <Row key={t.id} t={t} />)}</ul>
          </section>
        ) : null}

        {waiting.length > 0 ? (
          <section>
            <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-charcoal-500">
              Nothing reported yet
            </h4>
            <ul>{waiting.map((t) => <Row key={t.id} t={t} />)}</ul>
          </section>
        ) : null}
      </div>
    </CollapsibleCard>
  );
}
