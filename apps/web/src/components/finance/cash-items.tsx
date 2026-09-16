/**
 * What the cash forecast is made of.
 *
 * `reporting_cash_flow_items` had no reader anywhere, while the cash tab said in
 * its own comment that "bucketing by month is as fine as the view goes; a
 * tighter window would need the item grain". The item grain existed the whole
 * time — every receivable and payable behind the bars, with the reason a payable
 * cannot move carried on the row.
 *
 * That reason is the point. A month bar shows blocked money hatched apart from
 * cash that will actually leave, and somebody looking at it has no way to find
 * out which invoice is blocked or why. This is that list.
 */
import { useState } from 'react';
import { ListFilter } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/misc';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { LoadingState, ErrorState } from '@/components/data-state';
import { useQuery } from '@/lib/data/query';
import { loadCashFlowItems } from '@/lib/data/finance';
import { money, date, titleCase, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

export function CashItems() {
  const q = useQuery(loadCashFlowItems, []);
  const rows = q.status === 'ready' ? q.data : [];
  const blocked = rows.filter((r) => r.blocked);
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const shown = onlyBlocked ? blocked : rows;

  if (q.status === 'demonstration') return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-charcoal-900">
            Every item behind those bars
          </h3>
          <p className="text-xs text-charcoal-500">
            {blocked.length
              ? `${plural(blocked.length, 'payable')} cannot move yet, and the reason is on the row.`
              : 'Nothing is blocked; every amount below is money that will actually move.'}
          </p>
        </div>
        {blocked.length > 0 ? (
          <Button variant="outline" size="sm" onClick={() => setOnlyBlocked((v) => !v)}
            title={onlyBlocked ? 'Show every item' : 'Show only the ones that cannot move'}>
            <ListFilter className="size-4" />
            {onlyBlocked ? `All ${rows.length}` : `Only the ${blocked.length} blocked`}
          </Button>
        ) : null}
      </div>

      {q.status === 'loading' ? <LoadingState label="Reading the items" /> : null}
      {q.status === 'error' ? <ErrorState message={q.message} onRetry={q.refetch} /> : null}

      {q.status === 'ready' && rows.length === 0 ? (
        <EmptyState title="Nothing due either way"
          description="An item appears here once there is a certified pay application or a vendor invoice with a date on it." />
      ) : null}

      {shown.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r) => (
              <TableRow key={`${r.source}-${r.sourceId}`}
                className={r.blocked ? 'bg-danger-50/40' : undefined}>
                <TableCell className="font-mono text-xs text-charcoal-700">
                  {r.reference}
                  {r.blocked && r.blockedReason ? (
                    <span className="mt-0.5 block font-sans text-xs text-danger-700">
                      {r.blockedReason}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-charcoal-700">{r.counterparty ?? '—'}</TableCell>
                <TableCell>
                  <Badge variant="outline">{titleCase(r.source)}</Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-charcoal-600">
                  {r.dueOn ? date(r.dueOn) : (
                    <span className="text-charcoal-400" title="Real money, unknown timing">
                      no date
                    </span>
                  )}
                </TableCell>
                <TableCell className={cn('tabular text-right font-medium',
                  r.direction === 'in' ? 'text-success-700' : 'text-danger-700')}>
                  {r.direction === 'in' ? '+' : '−'}{money(Math.abs(r.amount))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}
