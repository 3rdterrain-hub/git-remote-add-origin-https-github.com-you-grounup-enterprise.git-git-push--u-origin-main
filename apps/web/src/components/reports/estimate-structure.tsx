/**
 * What a line costs on its own, with its children taken out of it.
 *
 * `reporting_estimate_structure` had no reader anywhere, and it answers the one
 * question a nested estimate cannot answer on its face: a parent line's total
 * includes everything beneath it, so reading down the tree adds the same money
 * several times. `immediate_cost` is the parent's own share — total, less what
 * its children already account for — and it is the column that makes a
 * hierarchy addable.
 *
 * It also carries `parametric_basis` and `per_parent_unit`: the lines whose
 * quantity is derived from their parent rather than measured. Those are the
 * ones that move when the parent moves, and an estimator checking a number
 * wants to know which of the two they are looking at.
 */
import { useState } from 'react';
import { Layers } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/misc';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { LoadingState, ErrorState } from '@/components/data-state';
import { useQuery } from '@/lib/data/query';
import { loadEstimateStructure } from '@/lib/data/reports';
import { loadEstimates } from '@/lib/data/estimates';
import { money, qty } from '@/lib/format';

const field = 'h-9 rounded-md border border-charcoal-200 bg-white px-2 text-sm';

export function EstimateStructure() {
  const estimatesQ = useQuery(loadEstimates, []);
  const estimates = (estimatesQ.status === 'ready' ? estimatesQ.data : [])
    .filter((e) => e.currentVersionId !== null);
  const [chosen, setChosen] = useState<string | null>(null);
  const estimate = estimates.find((e) => e.id === chosen) ?? estimates[0] ?? null;
  const versionId = estimate?.currentVersionId ?? '';
  const q = useQuery(loadEstimateStructure(versionId), [versionId]);
  const rows = q.status === 'ready' ? q.data : [];

  /*
   * Adding the immediate costs gives the estimate's direct cost exactly once.
   * Adding the totals would count every parent's children again, which is the
   * mistake this column exists to make impossible.
   */
  const total = rows.reduce((a, r) => a + r.immediateCost, 0);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Layers className="size-4" /> How an estimate is built up
          </CardTitle>
          <CardDescription>
            A parent line&rsquo;s total includes everything beneath it, so reading down the tree adds
            the same money twice. The own-cost column is the parent&rsquo;s own share, and it is what
            makes a hierarchy addable.
          </CardDescription>
        </div>
        {estimates.length > 0 ? (
          <select className={field} aria-label="Which estimate"
            value={estimate?.id ?? ''} onChange={(e) => setChosen(e.target.value)}>
            {estimates.map((e) => (
              <option key={e.id} value={e.id}>{e.number} — {e.name}</option>
            ))}
          </select>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {estimatesQ.status === 'loading' || q.status === 'loading'
          ? <LoadingState label="Reading the estimate" /> : null}
        {q.status === 'error' ? <ErrorState message={q.message} onRetry={q.refetch} /> : null}

        {estimatesQ.status === 'ready' && estimates.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No priced estimate yet"
              description="An estimate appears here once it has a version the engine has priced." />
          </div>
        ) : null}

        {estimates.length > 0 && q.status === 'ready' && rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title="That estimate has no lines"
              description="Add lines on the estimate workspace and the build-up appears here." />
          </div>
        ) : null}

        {rows.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Line</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Total with children</TableHead>
                <TableHead className="text-right">Its own cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <span style={{ paddingLeft: `${r.depth * 16}px` }}
                      className="inline-block font-medium text-charcoal-900">
                      {r.description}
                    </span>
                    <span className="ml-2 inline-flex gap-1">
                      {r.isRollup ? (
                        <Badge variant="outline" className="text-[10px]"
                          title="Its cost is the sum of what is beneath it">rollup</Badge>
                      ) : null}
                      {r.parametricBasis ? (
                        <Badge variant="info" className="text-[10px]"
                          title={`Quantity derived from its parent: ${r.perParentUnit ?? '—'} per ${r.parametricBasis}`}>
                          derived
                        </Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-600">
                    {r.measuredQuantity === null ? '—'
                      : `${qty(r.measuredQuantity, 2)}${r.unit ? ` ${r.unit}` : ''}`}
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-600">
                    {money(r.totalDirectCost)}
                  </TableCell>
                  <TableCell className="tabular text-right font-medium">
                    {money(r.immediateCost)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow className="hover:bg-charcoal-50">
                <TableCell colSpan={3}>
                  Direct cost, counted once
                </TableCell>
                <TableCell className="tabular text-right">{money(total)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}
