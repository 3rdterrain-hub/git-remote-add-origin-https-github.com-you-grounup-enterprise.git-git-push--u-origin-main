/**
 * Projects, read from the governed schema.
 *
 * The first screen in this application to read a record. Every figure below
 * comes from `reporting_project_financials` and the tables behind it, which is
 * the same view the public API serves and the same one the governed metrics are
 * defined over — so what a project manager sees here and what a report says
 * cannot disagree.
 *
 * Percent complete is gone, and its absence is the point. The sample dataset
 * carried one; nothing in the platform computes it, because there is no
 * progress measurement and no earned-value curve to derive it from. What
 * replaces it is what the platform can stand behind: how much has been billed,
 * how much has been spent, and how much budget is left after what is already
 * promised to a vendor.
 */
import { useMemo, useState } from 'react';
import { HardHat, TrendingDown, TrendingUp, FileWarning, Plus, CircleDollarSign } from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingState, ErrorState, EmptyState, DemonstrationNotice } from '@/components/data-state';
import { useQuery } from '@/lib/data/query';
import {
  loadProjects, loadRateVariance, demonstrationProjects, demonstrationRateVariance,
  type ProjectView, type RateVarianceView,
} from '@/lib/data/project-view';
import { money, moneyCompact, percent, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS_TONE: Record<string, 'default' | 'success' | 'warn' | 'info'> = {
  preconstruction: 'default', active: 'info', on_hold: 'warn',
  substantially_complete: 'success', closed: 'success', canceled: 'default',
};

/**
 * What each tile above the table is counting.
 *
 * Every one of the four summed a column of the table and then left the reader
 * to find which rows made the number. Each is now the filter for its own
 * figure: the tile says four are overcommitted, and clicking it leaves the four
 * on screen.
 */
type Focus = 'all' | 'active' | 'unbilled' | 'overcommitted' | 'open';

const FOCUS_MATCH: Record<Focus, (p: ProjectView) => boolean> = {
  all: () => true,
  active: (p) => p.status === 'active',
  unbilled: (p) => p.revisedContractValue - p.billedToDate > 0.005,
  overcommitted: (p) => p.costToComplete < 0,
  open: (p) => p.openChangeOrders + p.openRfis > 0,
};

const FOCUS_TITLE: Record<Focus, string> = {
  all: 'Projects',
  active: 'Active projects',
  unbilled: 'Projects with contract value left to bill',
  overcommitted: 'Projects committed past their budget',
  open: 'Projects with an open change order or RFI',
};

const FOCUS_EMPTY: Record<Focus, string> = {
  all: 'No projects yet',
  active: 'No project is active',
  unbilled: 'Every project is billed to its full contract value',
  overcommitted: 'No project is committed past its budget',
  open: 'Nothing is open on any project',
};

export function ProjectsPage() {
  const projects = useQuery(loadProjects, []);
  const rates = useQuery(loadRateVariance, []);
  const [focus, setFocus] = useState<Focus>('all');

  const demo = projects.status === 'demonstration';
  const rows: ProjectView[] | null =
    projects.status === 'ready' ? projects.data : demo ? demonstrationProjects() : null;
  const rateRows: RateVarianceView[] =
    rates.status === 'ready' ? rates.data : rates.status === 'demonstration' ? demonstrationRateVariance() : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects & Operations"
        description="Awarded estimates become projects without re-entry. Cost, commitment and billing are read from the same governed view the public API serves, so the number on this page is the number in the report."
        actions={<Button><Plus className="size-4" /> Create project</Button>}
      />

      {demo ? <DemonstrationNotice what="this page" /> : null}
      {projects.status === 'error'
        ? <ErrorState message={projects.message} onRetry={projects.refetch} />
        : null}
      {projects.status === 'loading' ? <LoadingState label="Loading projects" /> : null}

      {rows ? (
        <ProjectSummary rows={rows} focus={focus}
          onFocus={(next) => setFocus((current) => (current === next ? 'all' : next))} />
      ) : null}

      {rows && rows.length === 0 ? (
        <EmptyState
          title="No projects yet"
          hint="A project appears here when an estimate is awarded, or when somebody creates one."
        />
      ) : null}

      {rows && rows.length > 0
        ? <ProjectTable rows={rows} focus={focus} onClearFocus={() => setFocus('all')} />
        : null}

      <Card>
        <CardHeader>
          <CardTitle>The learning loop</CardTitle>
          <CardDescription>
            Field production measured against the rate the work was estimated at, weighted by hours
            rather than averaged across days. It reports and does not propose: a library rate is an
            approved record and changes through the approval workflow, never by a silent edit
            (RULE-008).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rates.status === 'loading' ? <div className="p-6"><LoadingState label="Loading production variance" /></div> : null}
          {rates.status === 'error' ? <div className="p-6"><ErrorState message={rates.message} onRetry={rates.refetch} /></div> : null}
          {rates.status !== 'loading' && rates.status !== 'error' && rateRows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No production recorded against a library rate yet"
                hint="Daily production entered against an estimated rate appears here once there is something to compare."
              />
            </div>
          ) : null}
          {rateRows.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Production rate</TableHead>
                  <TableHead className="text-right">Library</TableHead>
                  <TableHead className="text-right">Achieved</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right">Evidence</TableHead>
                  <TableHead>Finding</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rateRows.map((r) => (
                  <TableRow key={r.rateCode}>
                    <TableCell className="max-w-64">
                      <p className="font-mono text-xs text-charcoal-500">{r.rateCode}</p>
                      <p className="truncate text-xs text-charcoal-400">{r.unit}</p>
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">{r.libraryRate}</TableCell>
                    <TableCell className="tabular text-right font-medium">{r.achievedRate}</TableCell>
                    <TableCell className={cn('tabular text-right font-medium',
                      r.variancePercent < 0 ? 'text-danger-700' : 'text-success-700')}>
                      {percent(r.variancePercent / 100, 1)}
                    </TableCell>
                    <TableCell className="tabular text-right text-xs text-charcoal-600">
                      {r.observations} {r.observations === 1 ? 'entry' : 'entries'}
                      {r.hoursObserved > 0 ? ` · ${Math.round(r.hoursObserved)} hr` : ''}
                    </TableCell>
                    <TableCell className="text-xs text-charcoal-600">{r.finding}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function ProjectSummary({ rows, focus, onFocus }: {
  rows: ProjectView[]; focus: Focus; onFocus: (next: Focus) => void;
}) {
  const contract = rows.reduce((a, p) => a + p.revisedContractValue, 0);
  const billed = rows.reduce((a, p) => a + p.billedToDate, 0);
  const toComplete = rows.reduce((a, p) => a + p.costToComplete, 0);
  const active = rows.filter((p) => p.status === 'active');
  const changeOrders = rows.reduce((a, p) => a + p.openChangeOrders, 0);
  const rfis = rows.reduce((a, p) => a + p.openRfis, 0);
  const overcommitted = rows.filter(FOCUS_MATCH.overcommitted);

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile label="Contract value" value={moneyCompact(contract)} icon={<HardHat className="size-4" />}
        hint={`${rows.length} ${rows.length === 1 ? 'project' : 'projects'}, ${active.length} active`}
        onClick={() => onFocus('active')} active={focus === 'active'}
        actionLabel="List the active projects" />
      <StatTile label="Billed to date" value={moneyCompact(billed)} icon={<CircleDollarSign className="size-4" />}
        hint={contract > 0 ? `${percent(billed / contract, 0)} of contract value` : 'no contract value recorded'}
        onClick={() => onFocus('unbilled')} active={focus === 'unbilled'}
        actionLabel="List the projects with contract value left to bill" />
      <StatTile label="Budget remaining" value={moneyCompact(Math.abs(toComplete))}
        tone={toComplete >= 0 ? 'success' : 'danger'}
        icon={toComplete >= 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
        hint={toComplete >= 0
          ? (overcommitted.length
            ? `after spend and open commitments · ${overcommitted.length} over`
            : 'after spend and open commitments')
          : 'overcommitted against budget'}
        onClick={() => onFocus('overcommitted')} active={focus === 'overcommitted'}
        actionLabel="List the projects committed past their budget" />
      <StatTile label="Open change orders" value={changeOrders}
        tone={changeOrders > 0 ? 'warn' : 'neutral'} icon={<FileWarning className="size-4" />}
        hint={`${rfis} open ${rfis === 1 ? 'RFI' : 'RFIs'}`}
        onClick={() => onFocus('open')} active={focus === 'open'}
        actionLabel="List the projects with an open change order or RFI" />
    </div>
  );
}

function ProjectTable({ rows, focus, onClearFocus }: {
  rows: ProjectView[]; focus: Focus; onClearFocus: () => void;
}) {
  const shown = useMemo(() => rows.filter(FOCUS_MATCH[focus]), [rows, focus]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>{FOCUS_TITLE[focus]}</CardTitle>
            <CardDescription>
              Spend and commitment against budget is the earliest reliable signal of margin fade — a
              commitment is money the company can no longer choose not to spend.
            </CardDescription>
          </div>
          {focus !== 'all' ? (
            <Button variant="outline" size="sm" onClick={onClearFocus}>
              Show all {rows.length}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {shown.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title={FOCUS_EMPTY[focus]}
              hint={`None of the ${rows.length} ${rows.length === 1 ? 'project' : 'projects'} on this page match.`} />
          </div>
        ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="min-w-44">Budget used</TableHead>
              <TableHead className="text-right">Contract</TableHead>
              <TableHead className="text-right">Billed</TableHead>
              <TableHead className="text-right">Spent</TableHead>
              <TableHead className="text-right">Committed</TableHead>
              <TableHead className="text-right">Remaining</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((p) => {
              const used = p.budget > 0 ? (p.actualCost + p.committedCost) / p.budget : 0;
              const over = p.costToComplete < 0;
              return (
                <TableRow key={p.id}>
                  <TableCell className="max-w-72">
                    <p className="font-medium text-charcoal-900">{p.number}</p>
                    <p className="truncate text-xs text-charcoal-500">{p.name}</p>
                    {p.customer ? <p className="text-xs text-charcoal-400">{p.customer}</p> : null}
                  </TableCell>
                  <TableCell><Badge variant={STATUS_TONE[p.status] ?? 'default'}>{titleCase(p.status)}</Badge></TableCell>
                  <TableCell>
                    <Progress value={Math.min(used * 100, 100)}
                      indicatorClassName={over ? 'bg-danger-500' : 'bg-success-600'} />
                    <p className="tabular mt-1 text-xs text-charcoal-500">
                      {p.budget > 0 ? `${percent(used, 0)} of budget spent or committed` : 'no budget recorded'}
                    </p>
                  </TableCell>
                  <TableCell className="tabular text-right">{money(p.revisedContractValue)}</TableCell>
                  <TableCell className="tabular text-right text-charcoal-600">{money(p.billedToDate)}</TableCell>
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
        )}
      </CardContent>
    </Card>
  );
}
