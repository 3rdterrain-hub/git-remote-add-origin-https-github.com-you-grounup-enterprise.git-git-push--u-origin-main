/**
 * Reports, read from the semantic layer.
 *
 * P29 judged this page and found two things: it computed from fixtures while
 * eleven governed reporting views went unread, and its Export button carried no
 * handler at all. Both are closed here.
 *
 * The metrics on this page are the platform's own definitions — key, unit,
 * grain, target and the SQL expression each one means — evaluated through
 * `app.evaluate_metric`. The same call answers the public API, so a figure here
 * and a figure a customer's integration reads are the same number computed
 * once. What used to be here — a cost breakdown of one demonstration estimate —
 * belongs to an estimate rather than to a company, and lives on the estimate
 * workspace.
 */
import { useMemo } from 'react';
import { BarChart3, Download, Gauge } from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingState, ErrorState, EmptyState, DemonstrationNotice } from '@/components/data-state';
import { useQuery } from '@/lib/data/query';
import { loadMetrics, formatMetric, metricTone, metricsToCsv, type MetricValue } from '@/lib/data/reports';
import { loadProjects, type ProjectView } from '@/lib/data/project-view';
import { money, percent, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';

export function ReportsPage() {
  const metrics = useQuery(loadMetrics, []);
  const projects = useQuery(loadProjects, []);

  const rows = metrics.status === 'ready' ? metrics.data : [];
  const byDomain = useMemo(() => {
    const groups = new Map<string, MetricValue[]>();
    for (const m of rows) {
      if (!groups.has(m.domain)) groups.set(m.domain, []);
      groups.get(m.domain)!.push(m);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  const demo = metrics.status === 'demonstration';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports & Analytics"
        description="Every figure comes from the governed semantic layer — the same definitions the public API evaluates, computed once so a report and an integration cannot disagree."
        actions={<ExportButton rows={rows} disabled={rows.length === 0} demo={demo} />}
      />

      {demo ? <DemonstrationNotice what="this page" /> : null}
      {metrics.status === 'loading' ? <LoadingState label="Loading metrics" /> : null}
      {metrics.status === 'error'
        ? <ErrorState message={metrics.message} onRetry={metrics.refetch} /> : null}

      {demo ? (
        <EmptyState
          title="Governed metrics need a workspace"
          hint="A metric is a definition executed against a reporting view. Without a Supabase project there is nothing to execute it against, and inventing values here would be the confident fiction this layer exists to prevent."
        />
      ) : null}

      {rows.length > 0 ? <Headline rows={rows} /> : null}

      {byDomain.map(([domain, group]) => (
        <Card key={domain}>
          <CardHeader>
            <CardTitle className="capitalize">{titleCase(domain)}</CardTitle>
            <CardDescription>
              {group.length} governed {group.length === 1 ? 'metric' : 'metrics'}, each evaluated
              from the definition the platform publishes.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Target</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.map((m) => {
                  const tone = metricTone(m);
                  return (
                    <TableRow key={m.key}>
                      <TableCell className="max-w-96">
                        <p className="font-medium text-charcoal-900">{m.name}</p>
                        <p className="font-mono text-xs text-charcoal-400">{m.key}</p>
                        <p className="mt-0.5 text-xs text-charcoal-500">{m.description}</p>
                      </TableCell>
                      <TableCell className="tabular text-right font-medium">{formatMetric(m)}</TableCell>
                      <TableCell className="tabular text-right text-charcoal-500">
                        {m.targetValue == null
                          ? '—'
                          : formatMetric({ ...m, value: m.targetValue })}
                      </TableCell>
                      <TableCell className="text-right">
                        {tone === 'neutral' ? null : (
                          <Badge variant={tone}>{tone === 'success' ? 'On target' : 'Off target'}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      <ProjectPerformance state={projects} />
    </div>
  );
}

/**
 * Export what is on screen.
 *
 * P29 recorded this button as carrying no handler and said that making it emit
 * the fixtures it displayed would be worse than leaving it inert, because a
 * working control over demonstration data reads as a finished feature. It works
 * now because the data is real — and it stays disabled, with the reason on it,
 * when it is not.
 */
function ExportButton({ rows, disabled, demo }: {
  rows: MetricValue[]; disabled: boolean; demo: boolean;
}) {
  const download = () => {
    const blob = new Blob([metricsToCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `grounup-metrics-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  return (
    <Button
      variant="outline"
      onClick={download}
      disabled={disabled}
      title={demo ? 'Connect a workspace to export real figures' : undefined}
    >
      <Download className="size-4" /> Export
    </Button>
  );
}

function Headline({ rows }: { rows: MetricValue[] }) {
  const pick = (key: string) => rows.find((m) => m.key === key);
  const margin = pick('gross_margin_percent');
  const backlog = pick('backlog_value');
  const ctc = pick('cost_to_complete');
  const trir = pick('trir');
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[margin, backlog, ctc, trir].filter(Boolean).map((m) => (
        <StatTile
          key={m!.key}
          label={m!.name}
          value={formatMetric(m!)}
          tone={metricTone(m!) === 'warn' ? 'danger' : metricTone(m!) === 'success' ? 'success' : undefined}
          icon={<BarChart3 className="size-4" />}
          hint={m!.targetValue == null ? m!.unit : `target ${formatMetric({ ...m!, value: m!.targetValue })}`}
        />
      ))}
    </div>
  );
}

/**
 * Cost performance without an invented completion percentage.
 *
 * This card used to compute a cost performance index from `budget × percent
 * complete`, and nothing in the platform measures percent complete. What is
 * measurable is what has been spent and what is already committed against the
 * budget, which is the number that tells a project manager whether there is
 * room left.
 */
function ProjectPerformance({ state }: { state: ReturnType<typeof useQuery<ProjectView[]>> }) {
  const rows = state.status === 'ready' ? state.data.filter((p) => p.budget > 0) : [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Gauge className="size-4" /> Project cost performance</CardTitle>
        <CardDescription>
          Spend and open commitment against approved budget. A commitment is money the company can
          no longer choose not to spend, so a project can be under budget on spend alone and still
          have no room left.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {state.status === 'loading' ? <div className="p-6"><LoadingState label="Loading projects" /></div> : null}
        {state.status === 'error'
          ? <div className="p-6"><ErrorState message={state.message} onRetry={state.refetch} /></div> : null}
        {state.status === 'ready' && rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No project carries an approved budget yet" />
          </div>
        ) : null}
        {rows.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead className="min-w-40">Budget used</TableHead>
                <TableHead className="text-right">Budget</TableHead>
                <TableHead className="text-right">Spent</TableHead>
                <TableHead className="text-right">Committed</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const used = (p.actualCost + p.committedCost) / p.budget;
                const over = p.costToComplete < 0;
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <p className="font-medium text-charcoal-900">{p.number}</p>
                      <p className="max-w-64 truncate text-xs text-charcoal-500">{p.name}</p>
                    </TableCell>
                    <TableCell>
                      <Progress value={Math.min(used * 100, 100)}
                        indicatorClassName={over ? 'bg-danger-500' : 'bg-success-600'} />
                      <p className="tabular mt-1 text-xs text-charcoal-500">{percent(used, 0)}</p>
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">{money(p.budget)}</TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">{money(p.actualCost)}</TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">{money(p.committedCost)}</TableCell>
                    <TableCell className={cn('tabular text-right font-medium',
                      over ? 'text-danger-700' : 'text-success-700')}>
                      {over ? '−' : ''}{money(Math.abs(p.costToComplete))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}
