/**
 * Library — materials that are priced at nothing, ordered by what that costs.
 *
 * Migration 0121 drew the line this card stands on: a material nobody has
 * costed reads `not_costed`, never `$0.00`, because a price of nothing looks
 * like a price and prices a bid at nothing. Migration 0133 built
 * `my_uncosted_materials` to gather them, counted how many lines and how many
 * estimates each one was already sitting on — and nothing read the view. The
 * count that says *this one is on four live estimates* existed and was never
 * shown to anybody who could act on it.
 *
 * Three decisions about the shape:
 *
 *   * **Nothing shows when nothing is wrong.** A card reading "0 materials need
 *     a price" on a healthy library is a card people learn to skip.
 *   * **Ordered by damage, not alphabetically.** A material on nine estimates
 *     is a different problem from one nobody has used, and the view already
 *     counts both, so the list leads with the one costing money today.
 *   * **Priced here, not somewhere else.** The same `CostCell` the materials
 *     table uses, writing through the same `set_material_cost` — which refuses
 *     a price that does not say where it came from. A card that could only
 *     point at the problem would be one more list to go and act on elsewhere.
 */
import { useState } from 'react';
import { CircleDollarSign } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorState } from '@/components/data-state';
import { CostCell } from '@/components/library/cost-cell';
import { useQuery, messageFor } from '@/lib/data/query';
import { loadUncostedMaterials, setMaterialCost } from '@/lib/data/library';
import { supabase } from '@/lib/supabase';
import { plural } from '@/lib/format';

export function MaterialsWithNoPrice({ companyId, canEdit, onPriced }: {
  companyId: string | null;
  canEdit: boolean;
  /** So the materials table beside this card refreshes with it. */
  onPriced?: () => void;
}) {
  const gaps = useQuery(loadUncostedMaterials, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (gaps.status === 'error') {
    return <ErrorState message={gaps.message} onRetry={gaps.refetch} />;
  }
  if (gaps.status !== 'ready' || gaps.data.length === 0) return null;

  const rows = gaps.data;
  const onEstimates = rows.filter((r) => r.usedOnEstimates > 0);

  async function price(materialId: string, cost: number, source: string) {
    if (!supabase || !companyId) return;
    setBusy(materialId); setError(null);
    try {
      await setMaterialCost(supabase, { materialId, companyId, cost, source });
      gaps.refetch();
      onPriced?.();
    } catch (err) { setError(messageFor(err)); }
    finally { setBusy(null); }
  }

  return (
    <Card className="border-warn-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CircleDollarSign className="size-4 text-warn-600" />
          {plural(rows.length, 'material')} with no price
        </CardTitle>
        <CardDescription>
          {onEstimates.length > 0
            ? `${onEstimates.length} of these are already on an estimate, so those lines are pricing the material at nothing. `
            : 'None of these is on an estimate yet, so nothing is mispriced today. '}
          A material nobody has costed is held at &ldquo;not costed&rdquo; rather than $0.00 —
          a price of nothing looks like a price. Set one here and it takes effect on every future
          estimate; issued work keeps the rates it was issued at.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 p-0">
        {error ? <div className="px-6"><Alert tone="danger">{error}</Alert></div> : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Material</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">On estimates</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <div className="font-medium text-charcoal-900">{m.name}</div>
                  <div className="text-xs text-charcoal-500">
                    {m.code}
                    {m.isOwn ? null : <span className="ml-2">catalog row</span>}
                  </div>
                </TableCell>
                <TableCell className="text-charcoal-600">{m.category ?? '—'}</TableCell>
                <TableCell className="text-charcoal-600">{m.unit}</TableCell>
                <TableCell className="text-right">
                  {m.usedOnEstimates > 0
                    ? (
                      <Badge variant="warn">
                        {m.usedOnEstimates} {m.usedOnEstimates === 1 ? 'estimate' : 'estimates'}
                      </Badge>
                    )
                    : <span className="text-charcoal-400">not used yet</span>}
                </TableCell>
                <TableCell className="text-right">
                  <CostCell
                    value={0}
                    unset
                    editable={canEdit && Boolean(companyId)}
                    label={`unit cost for ${m.name}`}
                    suffix={`/${m.unit}`}
                    busy={busy === m.id}
                    sourcePrompt="Where did this price come from? A supplier, a quote number, or how you worked it out."
                    note={m.isOwn
                      ? undefined
                      : 'This is a catalog row. Saving makes your company’s own copy at this price and prices future estimates from it.'}
                    onSave={(next, source) => price(m.id, next, source)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
