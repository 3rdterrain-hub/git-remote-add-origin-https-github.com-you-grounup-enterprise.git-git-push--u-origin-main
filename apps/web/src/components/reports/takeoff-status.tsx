/**
 * Every measurement, and whether the line it was applied to still matches it.
 *
 * `reporting_takeoff_status` had no reader anywhere, and it carries the one
 * column nothing else on any screen computes: `stale_on_line`. A trace that has
 * been edited since it was carried onto an estimate line leaves that line priced
 * on a quantity that is no longer on the drawing — and the line looks perfectly
 * normal, because a quantity is a number and every number looks fine.
 *
 * So the report opens on the stale ones. A list of everything, sorted by date,
 * would bury the six rows that are the reason to look.
 */
import { useState } from 'react';
import { Ruler, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, EmptyState } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { LoadingState, ErrorState } from '@/components/data-state';
import { useQuery } from '@/lib/data/query';
import { loadTakeoffStatus } from '@/lib/data/reports';
import { qty, date, titleCase, plural } from '@/lib/format';

export function TakeoffStatus() {
  const q = useQuery(loadTakeoffStatus, []);
  const rows = q.status === 'ready' ? q.data : [];
  const stale = rows.filter((r) => r.staleOnLine);
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? rows : stale;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Ruler className="size-4" /> Takeoff against the lines it priced
          </CardTitle>
          <CardDescription>
            A measurement that has been edited since it was carried onto a line leaves that line
            priced on a quantity no longer on the drawing. Nothing else says so, because a quantity
            is a number and every number looks fine.
          </CardDescription>
        </div>
        {rows.length > 0 ? (
          <Button variant="outline" size="sm" onClick={() => setShowAll((v) => !v)}
            title={showAll ? 'Show only the ones that have moved'
              : 'Show every measurement that has been applied'}>
            {showAll ? `Only the ${stale.length} that moved` : `All ${rows.length}`}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3 p-0">
        {q.status === 'loading' ? <LoadingState label="Reading the takeoff" /> : null}
        {q.status === 'error' ? <ErrorState message={q.message} onRetry={q.refetch} /> : null}

        {q.status === 'ready' && rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No measurement has been applied to a line yet"
              description="Trace a condition on a sheet and carry it onto an estimate line, and this report starts watching whether the two still agree." />
          </div>
        ) : null}

        {rows.length > 0 && stale.length === 0 && !showAll ? (
          <div className="px-6 pb-6">
            <Alert tone="success" title="Every applied measurement still matches its line">
              {plural(rows.length, 'measurement')} carried onto a line, and none has been edited
              since.
            </Alert>
          </div>
        ) : null}

        {stale.length > 0 && !showAll ? (
          <div className="px-6">
            <Alert tone="danger" icon={<AlertTriangle className="size-4" />}
              title={`${plural(stale.length, 'line')} priced on a quantity that has moved`}>
              The trace changed after it was applied. Re-apply it, or change the line, before the
              estimate goes out.
            </Alert>
          </div>
        ) : null}

        {shown.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Measurement</TableHead>
                <TableHead>Sheet</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Applied</TableHead>
                <TableHead>When</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => (
                <TableRow key={r.measurementId} className={r.staleOnLine ? 'bg-danger-50/40' : undefined}>
                  <TableCell>
                    <span className="font-medium text-charcoal-900">{r.name}</span>
                    <span className="mt-0.5 block text-xs text-charcoal-500">
                      {titleCase(r.kind)}{r.trade ? ` · ${r.trade}` : ''}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-charcoal-600">
                    {r.sheetNumber ?? '—'}
                    {r.sheetTitle ? (
                      <span className="block text-charcoal-400">{r.sheetTitle}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs text-charcoal-600">
                    {r.measurementMethod ? titleCase(r.measurementMethod) : '—'}
                    {r.statedScale ? (
                      <span className="block text-charcoal-400">{r.statedScale}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {r.appliedQuantity === null ? '—' : `${qty(r.appliedQuantity, 2)} ${r.unit}`}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-charcoal-600">
                    {r.appliedAt ? date(r.appliedAt) : '—'}
                  </TableCell>
                  <TableCell>
                    {r.staleOnLine ? (
                      <Badge variant="danger">Moved since</Badge>
                    ) : (
                      <Badge variant="success">Matches</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}
