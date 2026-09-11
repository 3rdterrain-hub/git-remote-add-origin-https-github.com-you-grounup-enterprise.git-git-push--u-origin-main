/**
 * Services nobody can price yet.
 *
 * 465 arrived from the product master naming work sequences the task library
 * did not contain. They are worth having — a named, CSI-coded service an
 * estimator can build up by hand beats one that is not there — but the gap
 * belongs on a list rather than in a bid, and `my_services_without_a_breakdown`
 * was written for exactly that and read by nothing.
 *
 * Two decisions about the shape of it:
 *
 *   * **Nothing shows when there is nothing wrong.** A panel reading "0 services
 *     need a breakdown" on every healthy library is a panel people learn to
 *     skip, and then skip on the day an import puts four hundred rows in it.
 *   * **It says which of the two problems each one has.** No sequence at all is
 *     a different fix from a sequence with no steps in it, and telling them
 *     apart is the difference between a list and a task.
 */
import { useState } from 'react';
import { Loader2, Wrench, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import { loadServicesWithoutABreakdown, startABreakdown } from '@/lib/data/assemblies';
import { plural } from '@/lib/format';

export function ServicesWithoutABreakdown({ companyId, canEdit, onStarted }: {
  companyId: string | null;
  canEdit: boolean;
  /** The sequence that now needs filling, so the caller can open it. */
  onStarted?: (assemblyId: string) => void;
}) {
  const gaps = useQuery(loadServicesWithoutABreakdown, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<string[]>([]);

  // Silent on a healthy library, and silent while it is still being read.
  if (gaps.status !== 'ready' && gaps.status !== 'error') return null;
  if (gaps.status === 'error') {
    return <ErrorState message={gaps.message} onRetry={gaps.refetch} />;
  }
  if (gaps.data.length === 0) return null;

  const rows = gaps.data;
  const bare = rows.filter((r) => r.hasNoAssembly).length;

  async function start(serviceId: string) {
    if (!companyId) return;
    setBusy(serviceId); setError(null);
    try {
      const assemblyId = await startABreakdown(serviceId, companyId);
      setStarted((prev) => [...prev, serviceId]);
      onStarted?.(assemblyId);
      gaps.refetch();
    } catch (err) { setError(messageFor(err)); }
    finally { setBusy(null); }
  }

  return (
    <Card className="border-warn-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wrench className="size-4 text-warn-600" />
          {plural(rows.length, 'service')} nobody can price yet
        </CardTitle>
        <CardDescription>
          {bare > 0
            ? `${bare} of these name no work sequence at all; the rest name one with no steps in it. `
            : 'Each of these names a work sequence with no steps in it. '}
          A service with no breakdown can still be bid — type a unit cost on the line and say where
          the rate came from — but nothing in the library will build it up for you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 p-0">
        {error ? <div className="px-6"><Alert tone="danger">{error}</Alert></div> : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Service</TableHead>
              <TableHead>Industry</TableHead>
              <TableHead className="text-right">Unit</TableHead>
              <TableHead>What is missing</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="max-w-80">
                  <p className="truncate font-medium text-charcoal-900">{r.name}</p>
                  <p className="font-mono text-xs text-charcoal-500">{r.code}</p>
                </TableCell>
                <TableCell className="text-charcoal-600">
                  {r.industry ?? <span className="text-charcoal-400">—</span>}
                </TableCell>
                <TableCell className="text-right text-charcoal-600">{r.defaultUnit}</TableCell>
                <TableCell>
                  <Badge variant={r.hasNoAssembly ? 'warn' : 'default'}>
                    {r.hasNoAssembly ? 'No work sequence' : 'Sequence has no steps'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {started.includes(r.id) ? (
                    <span className="text-xs text-success-700">Started — add its steps</span>
                  ) : (
                    <Button variant="outline" size="sm"
                      disabled={!canEdit || !companyId || busy === r.id}
                      onClick={() => void start(r.id)}>
                      {busy === r.id ? <Loader2 className="size-4 animate-spin" /> : null}
                      Build it up <ArrowRight className="size-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!canEdit ? (
          <div className="px-6 pb-4">
            <p className="text-xs text-charcoal-500">
              Building one up needs the <code className="font-mono text-[11px]">libraries.write</code>{' '}
              permission. It takes your company its own copy of the service and gives it an empty
              sequence to fill — the catalog service is left exactly as it is, for everybody else.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
