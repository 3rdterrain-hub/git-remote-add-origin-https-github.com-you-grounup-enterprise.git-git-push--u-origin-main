/**
 * Where a quantity came from.
 *
 * Before migration 0177 a line held whichever measurement was applied to it
 * last, so a sidewalk traced in twelve runs priced as one run and there was
 * nothing to break down. Now the line is the sum, and this is the list that
 * makes the sum arguable — which is the only thing that makes a number worth
 * trusting.
 *
 * It is also how you find the mistake: two identical rows on the same sheet is
 * a run traced twice, and no total on its own would ever tell you.
 */
import { AlertTriangle, Ruler } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { LoadingState, ErrorState } from '@/components/data-state';
import { useQuery } from '@/lib/data/query';
import { loadLineMeasurements } from '@/lib/data/takeoff';
import { qty } from '@/lib/format';

export function QuantityBreakdown({ lineItemId, unit }: {
  lineItemId: string;
  unit: string;
}) {
  const measurementsQ = useQuery(loadLineMeasurements(lineItemId), [lineItemId]);
  const rows = measurementsQ.status === 'ready' ? measurementsQ.data : [];
  const total = rows.reduce((a, r) => a + r.appliedQuantity, 0);
  const stale = rows.filter((r) => r.retracedSinceApplied);

  if (measurementsQ.status === 'ready' && rows.length === 0) return null;

  return (
    <section className="space-y-2 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3">
      <h4 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide
                     text-charcoal-600">
        <Ruler className="size-3.5" aria-hidden />
        What this quantity is made of
      </h4>

      {measurementsQ.status === 'loading'
        ? <LoadingState label="Reading the measurements" /> : null}
      {measurementsQ.status === 'error'
        ? <ErrorState message={measurementsQ.message} onRetry={measurementsQ.refetch} /> : null}

      {rows.length > 0 ? (
        <>
          <ul className="space-y-1">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2
                                        text-xs">
                <span className="min-w-0 text-charcoal-700">
                  {r.name}
                  <span className="ml-2 text-charcoal-500">{r.sheetLabel}</span>
                  {r.retracedSinceApplied ? (
                    <Badge variant="warn" className="ml-2">retraced since</Badge>
                  ) : null}
                </span>
                <span className="tabular shrink-0 text-charcoal-900">
                  {qty(r.appliedQuantity)} {r.unit}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between gap-2 border-t
                          border-charcoal-200 pt-1.5 text-xs font-medium">
            <span className="text-charcoal-600">
              {rows.length === 1 ? 'One measurement' : `${rows.length} measurements`}
            </span>
            <span className="tabular text-charcoal-900">{qty(total)} {unit}</span>
          </div>
          {stale.length > 0 ? (
            <p className="flex items-start gap-1.5 text-xs text-warn-700">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {stale.length === 1
                ? 'One of these was retraced after it was applied, so the line may be behind the drawing.'
                : `${stale.length} of these were retraced after they were applied, so the line may be behind the drawing.`}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
