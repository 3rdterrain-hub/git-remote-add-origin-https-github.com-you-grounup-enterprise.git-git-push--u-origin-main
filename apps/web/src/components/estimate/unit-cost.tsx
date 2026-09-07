/**
 * A rate you type, and a crew you did not have to assemble.
 *
 * Two ways of pricing a line, on one panel, because they are alternatives and a
 * screen that showed them apart would let somebody do both.
 *
 * **The rate.** Not every line is built up. A subcontract quote, an allowance,
 * a number an estimator simply knows — before this, the only way in was to
 * invent resources until the arithmetic came out right, which is worse than
 * typing the number and saying where it came from. So the basis is a required
 * field rather than a note: "Sub quote, Delaney Bros, 14 Aug" and "roughly what
 * we got last year" are different numbers, and an estimate that cannot tell
 * them apart cannot be reviewed. The line is marked as the allowance it is, so
 * it faces the approval gate it has earned rather than one it has not.
 *
 * **The suggestion.** `assembly_components` has said what each service is made
 * of since migration 0004 and nothing ever read it onto a line. What is shown
 * here is a read — the crew, the machines, the materials, the hauling, each
 * scaled to this line's quantity and priced at the library rate — so an
 * estimator sees exactly what would land before any of it does. Applying is a
 * separate press, and it never overwrites a kind already priced.
 */
import { useState } from 'react';
import { Check, Loader2, Sparkles, Tag, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingState, ErrorState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import {
  loadResourceSuggestions, applyResourceSuggestions,
  setLineUnitCost, clearLineUnitCost, type ResourceSuggestion,
} from '@/lib/data/estimates';
import { money, qty } from '@/lib/format';

const KIND_LABEL: Record<ResourceSuggestion['kind'], string> = {
  labor: 'Crew', equipment: 'Equipment', material: 'Material', trucking: 'Hauling',
};

/** Price the line at a rate rather than from resources. */
export function UnitCostPanel({ lineId, unit, rate, basis, hasResources, editable, onChanged }: {
  lineId: string;
  unit: string;
  rate: number | null;
  basis: string | null;
  hasResources: boolean;
  editable: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftRate, setDraftRate] = useState(rate ? String(rate) : '');
  const [draftBasis, setDraftBasis] = useState(basis ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!supabase) return;
    setBusy(true); setError(null);
    try {
      await setLineUnitCost(supabase, lineId, Number(draftRate), draftBasis);
      setOpen(false);
      onChanged();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!supabase) return;
    setBusy(true); setError(null);
    try {
      await clearLineUnitCost(supabase, lineId);
      setDraftRate(''); setDraftBasis('');
      onChanged();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  if (rate !== null && !open) {
    return (
      <div className="space-y-1 rounded-md border border-info-200 bg-info-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Tag className="size-4 text-info-700" />
          <span className="font-medium text-charcoal-900">
            {money(rate)} per {unit}
          </span>
          <Badge variant="info">priced at a rate</Badge>
          {editable ? (
            <Button variant="ghost" size="sm" className="ml-auto" disabled={busy} onClick={clear}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
              Build it up instead
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-charcoal-600">{basis}</p>
        <p className="text-xs text-charcoal-500">
          This line is not built up from a crew, machines or materials. It is scored as an
          allowance, which is what decides the review it needs before the estimate can issue.
        </p>
        {error ? <p role="alert" className="text-sm text-danger-700">{error}</p> : null}
      </div>
    );
  }

  if (!editable) return null;

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={hasResources}>
          <Tag className="size-4" /> Price at a unit cost
        </Button>
        {hasResources ? (
          <span className="text-xs text-charcoal-500">
            Remove the resources below first — a line carrying both reports a number nobody
            can reproduce from what is on it.
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40 space-y-1">
          <Label htmlFor={`rate-${lineId}`}>Cost per {unit}</Label>
          <Input id={`rate-${lineId}`} inputMode="decimal" value={draftRate}
            placeholder="0.00" disabled={busy}
            onChange={(e) => setDraftRate(e.target.value)} />
        </div>
        <div className="min-w-64 flex-1 space-y-1">
          <Label htmlFor={`basis-${lineId}`}>Where the rate came from</Label>
          <Input id={`basis-${lineId}`} value={draftBasis} disabled={busy}
            placeholder="Sub quote, Delaney Bros, 14 Aug"
            onChange={(e) => setDraftBasis(e.target.value)} />
        </div>
        <Button size="sm" disabled={busy || !draftRate || draftBasis.trim().length < 3}
          onClick={save}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Use this rate
        </Button>
        <Button size="sm" variant="ghost" disabled={busy}
          onClick={() => { setOpen(false); setError(null); }}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-charcoal-500">
        A quote, a past job, an allowance — anything, as long as somebody reviewing this
        estimate can tell a quoted number from a remembered one.
      </p>
      {error ? <p role="alert" className="text-sm font-medium text-danger-700">{error}</p> : null}
    </div>
  );
}

/** What the library says this line is made of, and one press to take it. */
export function ResourceSuggestions({ lineId, editable, onChanged }: {
  lineId: string; editable: boolean; onChanged: () => void;
}) {
  const suggestions = useQuery(loadResourceSuggestions(lineId), [lineId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [took, setTook] = useState<number | null>(null);

  if (suggestions.status === 'loading') return <LoadingState label="Reading the assembly" />;
  if (suggestions.status === 'error') {
    return <ErrorState message={suggestions.message} onRetry={suggestions.refetch} />;
  }
  if (suggestions.status === 'demonstration') return null;

  const rows = suggestions.data;
  const outstanding = rows.filter((r) => !r.alreadyOnLine && !r.isOptional);

  /*
   * Nothing to say when the library has nothing to offer. A panel reading "no
   * suggestions" on every typed line would be noise on the majority of lines
   * in a bid nobody has built a library for yet.
   */
  if (rows.length === 0) return null;

  const take = async (kinds?: string[]) => {
    if (!supabase) return;
    setBusy(kinds?.[0] ?? 'all'); setError(null);
    try {
      const n = await applyResourceSuggestions(supabase, lineId, kinds);
      setTook(n);
      suggestions.refetch();
      onChanged();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(null);
    }
  };

  const total = outstanding.reduce((a, r) => a + r.extendedCost, 0);

  return (
    <div className="space-y-3 rounded-md border border-charcoal-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-charcoal-500" />
        <span className="text-sm font-medium text-charcoal-900">
          What the library says this is made of
        </span>
        {outstanding.length > 0 && editable ? (
          <Button size="sm" variant="outline" className="ml-auto"
            disabled={busy !== null} onClick={() => take()}>
            {busy === 'all' ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Add all {outstanding.length} ({money(total)})
          </Button>
        ) : null}
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>What</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead className="text-right">Per unit</TableHead>
              <TableHead className="text-right">On this line</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.kind}-${r.resourceId}`}
                className={r.alreadyOnLine ? 'opacity-50' : undefined}>
                <TableCell className="font-medium text-charcoal-900">{r.name}</TableCell>
                <TableCell className="text-charcoal-600">{KIND_LABEL[r.kind]}</TableCell>
                <TableCell className="text-right tabular-nums text-charcoal-600">
                  {qty(r.quantityPerUnit, 4)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-charcoal-700">
                  {qty(r.quantity, 2)} {r.unit}
                </TableCell>
                <TableCell className="text-right tabular-nums text-charcoal-700">
                  {money(r.extendedCost)}
                </TableCell>
                <TableCell className="text-right">
                  {r.alreadyOnLine ? (
                    <span className="text-xs text-charcoal-500">already on the line</span>
                  ) : r.isOptional ? (
                    <Badge variant="default">optional</Badge>
                  ) : editable ? (
                    <Button variant="ghost" size="sm" disabled={busy !== null}
                      onClick={() => take([r.kind])}>
                      Add {KIND_LABEL[r.kind].toLowerCase()}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-charcoal-500">
        Quantities are this service&apos;s assembly scaled to the line. Nothing here is on the
        estimate until you add it, and adding never replaces something you have already priced.
      </p>

      {took !== null ? (
        <p className="text-xs text-ok-700">
          {took === 0 ? 'Nothing was added — it was all on the line already.'
            : `Added ${took} to the line.`}
        </p>
      ) : null}
      {error ? <p role="alert" className="text-sm font-medium text-danger-700">{error}</p> : null}
    </div>
  );
}
