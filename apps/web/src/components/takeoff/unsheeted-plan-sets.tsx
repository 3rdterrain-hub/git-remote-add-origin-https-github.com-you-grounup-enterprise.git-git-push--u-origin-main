/**
 * The plan sets you cannot take off yet.
 *
 * A takeoff is taken on a *sheet* — one page of a plan set — and until
 * migration 0135 nothing in the platform ever created one. Uploading a drawing
 * filed the document and its version and stopped there, so the takeoff screen
 * showed "No sheets uploaded yet" to somebody who had just uploaded a plan set.
 *
 * Everything uploaded from now on gets its sheets as it is registered. This is
 * for everything uploaded before that, which would otherwise sit in storage,
 * cost money, and never appear anywhere — the hardest kind of missing to
 * notice, because nothing is broken and nothing is listed.
 *
 * The page count is all that is needed and the person has the drawing open, so
 * it is asked for rather than guessed. A wrong count is recoverable: raising it
 * adds the pages that are missing and leaves every calibration and measurement
 * already taken exactly where it was.
 */
import { useState } from 'react';
import { FileWarning, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { setDocumentPageCount, type UnsheetedPlanSet } from '@/lib/data/takeoff';
import { supabase } from '@/lib/supabase';
import { messageFor } from '@/lib/data/query';

export function UnsheetedPlanSets({ plans, onSheeted }: {
  plans: readonly UnsheetedPlanSet[];
  onSheeted: () => void;
}) {
  const [pages, setPages] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ name: string; sheets: number } | null>(null);

  if (plans.length === 0) return null;

  async function give(plan: UnsheetedPlanSet) {
    if (!supabase) return;
    const n = Number(pages[plan.documentVersionId] ?? '');
    if (!Number.isInteger(n) || n < 1) {
      setError('How many pages does it have? A whole number, one or more.');
      return;
    }
    setBusy(plan.documentVersionId); setError(null); setMade(null);
    try {
      const sheets = await setDocumentPageCount(supabase, plan.documentVersionId, n);
      setMade({ name: plan.documentName, sheets });
      onSheeted();
    } catch (err) {
      setError(messageFor(err));
    } finally { setBusy(null); }
  }

  return (
    <div className="space-y-3 rounded-[--radius-card] border border-warn-300 bg-warn-50 p-4">
      <h3 className="flex items-center gap-2 text-sm font-medium text-charcoal-900">
        <FileWarning className="size-4 text-warn-700" />
        {plans.length === 1
          ? 'One uploaded plan set has no sheets yet'
          : `${plans.length} uploaded plan sets have no sheets yet`}
      </h3>
      <p className="text-xs text-charcoal-600">
        A takeoff is taken on a page. Say how many pages each one has and its sheets are
        made — the drawing is already in storage, so nothing needs uploading again. Anything
        uploaded from now on does this by itself.
      </p>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {made ? (
        <Alert tone="success">
          {made.sheets > 0
            ? `${made.sheets} sheet${made.sheets === 1 ? '' : 's'} made for ${made.name}. Pick one above.`
            : `${made.name} already had its sheets.`}
        </Alert>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Plan set</TableHead>
            <TableHead className="w-40">Pages</TableHead>
            <TableHead className="w-32" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {plans.map((p) => (
            <TableRow key={p.documentVersionId}>
              <TableCell>
                <p className="font-medium text-charcoal-900">{p.documentName}</p>
                <p className="font-mono text-xs text-charcoal-500">{p.fileName}</p>
              </TableCell>
              <TableCell>
                <Input
                  value={pages[p.documentVersionId] ?? (p.pageCount ? String(p.pageCount) : '')}
                  inputMode="numeric"
                  className="h-8 w-24"
                  placeholder="e.g. 24"
                  aria-label={`Pages in ${p.documentName}`}
                  onChange={(e) =>
                    setPages((s) => ({ ...s, [p.documentVersionId]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') void give(p); }} />
              </TableCell>
              <TableCell>
                <Button size="sm" variant="outline"
                  disabled={busy === p.documentVersionId}
                  onClick={() => void give(p)}>
                  {busy === p.documentVersionId
                    ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                  Make sheets
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
