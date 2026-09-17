/**
 * What would move this bid. WORKFLOW in front of an ENGINE.
 *
 * `priceScenarios` and `analyzeSensitivity` have been in the engine, written and
 * tested, with nothing in the application calling them. This is their door.
 *
 * Two questions, and they are not the same one:
 *
 *   * **Sensitivity** invents nothing. Each driver is moved on its own by one
 *     stated factor and the result is ranked. It answers the question an
 *     estimator actually has — not "what could go wrong" but *"which of these is
 *     worth my attention"* — and the answer is often not the one they expected.
 *
 *   * **Scenarios** are assumptions, and they are the estimator's. The platform
 *     does not supply a "high case", because an assumption nobody chose is an
 *     assumption nobody can defend to an owner. Every adjustment carries a
 *     reason, and the engine refuses one that does not.
 *
 * Nothing here writes. A scenario is a question about a price, not a price, so
 * it can be asked as often as it is useful and the bid does not move.
 */
import { useState } from 'react';
import { Loader2, Scale, TrendingUp, Trash2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, EmptyState } from '@/components/ui/misc';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { messageFor } from '@/lib/data/query';
import {
  compareScenarios, SCENARIO_DRIVERS,
  type WhatIfReport, type ScenarioInput, type ScenarioDriver,
} from '@/lib/data/estimates';
import { money, percent, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';

const field = 'h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm';

/** A row the estimator is drafting, before it becomes a scenario. */
interface DraftAdjustment {
  driver: ScenarioDriver;
  percent: string;
  rationale: string;
}

export function WhatIf({ versionId, canRun }: { versionId: string; canRun: boolean }) {
  const [report, setReport] = useState<WhatIfReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [factorPercent, setFactorPercent] = useState('10');
  const [drafts, setDrafts] = useState<DraftAdjustment[]>([]);

  const run = (withScenarios: boolean) => {
    if (busy) return;
    setBusy(true); setError(null);
    const pct = Number(factorPercent);
    const factor = Number.isFinite(pct) && pct !== 0 ? 1 + pct / 100 : 1.1;

    /*
     * A scenario set needs exactly one base, and the base is the estimate as it
     * stands — no adjustments. Sent explicitly rather than assumed, because the
     * engine asserts that pricing it reproduces the unadjusted bid to the cent.
     */
    const scenarios: ScenarioInput[] | undefined = withScenarios && drafts.length
      ? [
        { id: 'BASE', name: 'As estimated', kind: 'base', adjustments: [] },
        {
          id: 'WHATIF',
          name: 'What if',
          kind: 'custom',
          adjustments: drafts
            .filter((d) => d.rationale.trim().length >= 3 && Number(d.percent) !== 0)
            .map((d) => ({
              driver: d.driver,
              factor: 1 + Number(d.percent) / 100,
              rationale: d.rationale.trim(),
            })),
        },
      ]
      : undefined;

    compareScenarios(versionId, { sensitivityFactor: factor, scenarios })
      .then(setReport)
      .catch((e: unknown) => setError(messageFor(e)))
      .finally(() => setBusy(false));
  };

  const s = report?.sensitivity ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="whatif-factor">Move each driver by</Label>
          <div className="flex items-center gap-1.5">
            <Input id="whatif-factor" type="number" value={factorPercent}
              className="h-9 w-20 text-right"
              onChange={(e) => setFactorPercent(e.target.value)} />
            <span className="text-sm text-charcoal-600">%</span>
          </div>
        </div>
        <Button size="sm" disabled={!canRun || busy} onClick={() => run(drafts.length > 0)}
          title={canRun ? 'Price it under each assumption. Nothing is saved.'
            : 'Needs permission to read this estimate'}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Scale className="size-4" />}
          {report ? 'Run it again' : 'See what moves it'}
        </Button>
        <p className="text-xs text-charcoal-500">
          Nothing here is saved. The bid does not move.
        </p>
      </div>

      {error ? <Alert tone="danger" title="That could not be compared">{error}</Alert> : null}

      {!report && !busy ? (
        <EmptyState title="Nothing asked yet"
          description="Each driver is moved on its own and the result ranked, so you can see which one is actually worth managing. It usually is not the one people expect." />
      ) : null}

      {s ? (
        <>
          {s.mostSensitive ? (
            <Alert tone="info" icon={<TrendingUp className="size-4" />}
              title={`${titleCase(s.mostSensitive.label)} moves this bid most`}>
              A {factorPercent}% move in {s.mostSensitive.label} changes the bid by{' '}
              <strong>{money(Math.abs(s.mostSensitive.delta))}</strong>
              {' '}({percent(Math.abs(s.mostSensitive.deltaPercent), 1)}) — about{' '}
              {money(Math.abs(s.mostSensitive.elasticity))} for every one percent. That is the
              number worth managing on this job.
            </Alert>
          ) : (
            <Alert tone="neutral" title="Nothing moved">
              No driver changed the bid, which usually means the estimate has no cost on it yet.
            </Alert>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Driver</TableHead>
                <TableHead className="text-right">Bid at {factorPercent}%</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead className="text-right">Per 1%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {s.entries.map((e) => (
                <TableRow key={e.driver}>
                  <TableCell className="font-medium text-charcoal-900">
                    {titleCase(e.label)}
                  </TableCell>
                  <TableCell className="tabular text-right">{money(e.bidPrice)}</TableCell>
                  <TableCell className={cn('tabular text-right',
                    e.delta > 0 ? 'text-danger-700' : e.delta < 0 ? 'text-success-700' : 'text-charcoal-400')}>
                    {e.delta === 0 ? '—' : `${e.delta > 0 ? '+' : '−'}${money(Math.abs(e.delta))}`}
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-600">
                    {e.elasticity === 0 ? '—' : money(Math.abs(e.elasticity))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-charcoal-500">
            Base {money(s.basePrice)}. Each driver moved on its own, everything else held — which
            is what makes the ranking comparable.
          </p>
        </>
      ) : null}

      {/* ------------------------------------------------- the estimator's own */}
      <div className="space-y-2 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-charcoal-900">Your own assumptions</p>
            <p className="text-xs text-charcoal-500">
              The platform does not supply a &ldquo;high case&rdquo;. An assumption nobody chose is
              one nobody can defend to an owner, so every line here says why.
            </p>
          </div>
          <Button variant="outline" size="sm"
            onClick={() => setDrafts((d) => [...d,
              { driver: 'production', percent: '-15', rationale: '' }])}>
            <Plus className="size-4" /> Add an assumption
          </Button>
        </div>

        {drafts.map((d, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_6rem_2fr_auto]">
            <select className={field} value={d.driver} aria-label="Driver"
              onChange={(e) => setDrafts((all) => all.map((x, j) =>
                (j === i ? { ...x, driver: e.target.value as ScenarioDriver } : x)))}>
              {SCENARIO_DRIVERS.map((dr) => (
                <option key={dr} value={dr}>{titleCase(dr.replace(/_/g, ' '))}</option>
              ))}
            </select>
            <div className="flex items-center gap-1">
              <Input type="number" value={d.percent} className="h-9 text-right" aria-label="Percent"
                onChange={(e) => setDrafts((all) => all.map((x, j) =>
                  (j === i ? { ...x, percent: e.target.value } : x)))} />
              <span className="text-sm text-charcoal-500">%</span>
            </div>
            <Input value={d.rationale} placeholder="Why — wet ground, a quote that expires, a haul nobody has driven"
              aria-label="Why"
              onChange={(e) => setDrafts((all) => all.map((x, j) =>
                (j === i ? { ...x, rationale: e.target.value } : x)))} />
            <button type="button" className="text-charcoal-400 hover:text-danger-700"
              title="Remove this assumption"
              onClick={() => setDrafts((all) => all.filter((_, j) => j !== i))}>
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}

        {drafts.length > 0 ? (
          <div className="flex items-center justify-between">
            <p className="text-xs text-charcoal-500">
              An assumption with no reason is left out — the engine refuses it, and so does this.
            </p>
            <Button size="sm" disabled={!canRun || busy} onClick={() => run(true)}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Price it both ways
            </Button>
          </div>
        ) : null}
      </div>

      {report?.comparison ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-sm font-medium text-charcoal-900">
              {money(report.comparison.base.bidPrice)} as estimated
            </span>
            <Badge variant={report.comparison.spread === 0 ? 'outline' : 'warn'}>
              {money(Math.abs(report.comparison.spread))} spread
              {' '}({percent(Math.abs(report.comparison.spreadPercentOfBase), 1)})
            </Badge>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Scenario</TableHead>
                <TableHead>What it assumes</TableHead>
                <TableHead className="text-right">Bid</TableHead>
                <TableHead className="text-right">Against the estimate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.comparison.scenarios.map((sc) => (
                <TableRow key={sc.id}>
                  <TableCell className="font-medium text-charcoal-900">{sc.name}</TableCell>
                  <TableCell className="text-xs text-charcoal-600">
                    {sc.adjustments.length === 0 ? 'Nothing — the estimate as it stands' : (
                      <ul className="space-y-0.5">
                        {sc.adjustments.map((a, k) => (
                          <li key={k}>
                            {titleCase(a.driver.replace(/_/g, ' '))}{' '}
                            {a.factor >= 1 ? '+' : '−'}
                            {percent(Math.abs(a.factor - 1), 0)} — {a.rationale}
                          </li>
                        ))}
                      </ul>
                    )}
                  </TableCell>
                  <TableCell className="tabular text-right font-medium">
                    {money(sc.bidPrice)}
                  </TableCell>
                  <TableCell className={cn('tabular text-right',
                    sc.deltaFromBase > 0 ? 'text-danger-700'
                      : sc.deltaFromBase < 0 ? 'text-success-700' : 'text-charcoal-400')}>
                    {sc.deltaFromBase === 0 ? '—'
                      : `${sc.deltaFromBase > 0 ? '+' : '−'}${money(Math.abs(sc.deltaFromBase))}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {report.comparison.warnings.length > 0 ? (
            <Alert tone="warn" title="Worth knowing">
              <ul className="list-disc pl-4">
                {report.comparison.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </Alert>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
