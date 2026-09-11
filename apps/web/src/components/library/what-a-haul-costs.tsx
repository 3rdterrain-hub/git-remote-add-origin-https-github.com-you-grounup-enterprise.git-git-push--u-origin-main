/**
 * Library — what a quantity costs on each haul rate's own basis.
 *
 * `app.haul_cost` was written in migration 0067 with its reasoning stated
 * plainly: the trip arithmetic is duplicated from the engine rather than
 * shared, because "the engine cannot be called from SQL, and a company
 * comparing quotes on a screen should not need an Edge Function round trip per
 * row". There was no screen. The function had no `public.` wrapper for eighty
 * migrations, so the round trip it existed to avoid was the only way to get the
 * number, and nothing took it.
 *
 * Three bases priced side by side is the whole point: a trip rate pays for the
 * truck that arrives rather than the dirt in it, so a partial load is a whole
 * trip and the effective rate per unit moves with the quantity in a way no
 * headline figure shows. The column that makes that visible is unused capacity
 * — the dirt you paid to move and did not.
 *
 * A cycle-priced haul answers with an em dash rather than a number, and that is
 * the reason for asking the database rather than multiplying here: a cost
 * invented from the hourly rate alone is the shortcut that basis exists to
 * avoid.
 */
import { useState } from 'react';
import { Calculator, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { messageFor } from '@/lib/data/query';
import { haulCost, type HaulPrice, type TruckingRateRow } from '@/lib/data/library';
import { supabase } from '@/lib/supabase';
import { money, qty, unitRate } from '@/lib/format';

export function WhatAHaulCosts({ rates }: { rates: TruckingRateRow[] }) {
  const [quantity, setQuantity] = useState('');
  const [priced, setPriced] = useState<Map<string, HaulPrice | null> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(0);

  async function price() {
    const n = Number(quantity.trim());
    if (!supabase || !Number.isFinite(n) || n <= 0) return;
    setBusy(true); setError(null);
    try {
      const answers = await Promise.all(
        rates.map(async (r) => [r.id, await haulCost(supabase!, r.id, n)] as const));
      setPriced(new Map(answers));
      setAsked(n);
    } catch (err) { setError(messageFor(err)); }
    finally { setBusy(false); }
  }

  if (rates.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="size-4 text-charcoal-500" />
          What a quantity costs on each of these
        </CardTitle>
        <CardDescription>
          The same haul, priced by every rate you hold, on each rate&apos;s own basis. A trip rate
          pays for the truck that arrives rather than the dirt in it, so the effective rate per
          unit moves with the quantity — and the unused capacity column is what you paid to move
          and did not. The arithmetic is the database&apos;s, not this screen&apos;s.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <form className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); void price(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="haul-quantity">Quantity to move</Label>
            <Input id="haul-quantity" type="number" inputMode="decimal" min="0" step="any"
              className="w-40" value={quantity} placeholder="0"
              onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <Button type="submit" disabled={busy || !(Number(quantity) > 0)}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Calculator className="size-4" />}
            Price it
          </Button>
        </form>

        {error ? <Alert tone="danger">{error}</Alert> : null}

        {priced === null ? (
          <p className="text-xs text-charcoal-500">
            Enter a quantity in each rate&apos;s own capacity unit. Rates are not converted between
            units — a tri-axle priced in tons and a scraper priced in bank cubic yards are
            different questions, and converting them here would answer neither.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rate</TableHead>
                <TableHead>Priced by</TableHead>
                <TableHead className="text-right">Trips paid</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Effective</TableHead>
                <TableHead className="text-right">Unused capacity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.map((r) => {
                const p = priced.get(r.id) ?? null;
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <p className="font-medium text-charcoal-900">{r.name}</p>
                      <p className="font-mono text-xs text-charcoal-500">
                        {r.code} · {qty(r.capacity, 1)} {r.capacityUnit}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.pricingBasis === 'cycle' ? 'success'
                        : r.pricingBasis === 'per_trip' ? 'default' : 'warn'}>
                        {r.pricingBasis === 'cycle' ? 'Cycle'
                          : r.pricingBasis === 'per_trip' ? 'Per trip' : 'Per unit'}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">
                      {p?.tripsPaid == null ? '—' : qty(p.tripsPaid, 2)}
                    </TableCell>
                    <TableCell className="tabular text-right font-medium">
                      {p?.cost == null ? '—' : money(p.cost)}
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">
                      {p?.effectiveRatePerUnit == null
                        ? '—'
                        : `${unitRate(p.effectiveRatePerUnit)} / ${r.capacityUnit}`}
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">
                      {p?.unusedCapacity == null
                        ? '—'
                        : `${qty(p.unusedCapacity, 2)} ${r.capacityUnit}`}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {priced !== null ? (
          <p className="text-xs leading-relaxed text-charcoal-500">
            Priced for {qty(asked, 2)} in each rate&apos;s own unit. A cycle-priced haul shows an
            em dash because it has no cost without a cycle analysis — distance, speeds and load
            times — and inventing one from the hourly rate is the shortcut that basis exists to
            avoid. Price it on an estimate line, where the cycle is known.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
