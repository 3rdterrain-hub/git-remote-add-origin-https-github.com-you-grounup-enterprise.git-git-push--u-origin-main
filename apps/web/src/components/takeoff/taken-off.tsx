/**
 * What has been taken off this sheet.
 *
 * Finishing a shape keeps it — `applied_line_item_id` is nullable and a takeoff
 * is done in the order the drawing reads rather than the order the estimate is
 * in. But a shape that can only be kept is a shape saved into a drawer: until
 * this list existed a measurement could be drawn back on the sheet and never
 * used, never renamed, never removed. That is a working feature with no door,
 * and it was a new one rather than an inherited one.
 *
 * So each measurement says what it measured, whether it has been put on a line,
 * and offers the two things left to do with it: put it on one, or take it off
 * the sheet.
 */
import { useState } from 'react';
import { Check, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  applySavedMeasurement, deleteMeasurement, unapplyTakeoff,
  type CalibrationRow, type MeasurementRow,
} from '@/lib/data/takeoff';
import { quantityOf } from '@/lib/takeoff-quantity';
import { supabase } from '@/lib/supabase';
import { messageFor } from '@/lib/data/query';
import { qty } from '@/lib/format';
import { ENGINE_VERSION } from '@grounup/engine';

export interface OpenLine { id: string; description: string; unit: string }

export function TakenOff({ measurements, calibrations, lines, editable, onChanged }: {
  measurements: readonly MeasurementRow[];
  /**
   * The calibrations these were traced against. Without them a kept shape is
   * a number of pixels, so the quantity column says so rather than guessing.
   */
  calibrations: readonly CalibrationRow[];
  /** Estimate lines still open enough to receive a quantity. */
  lines: readonly OpenLine[];
  editable: boolean;
  onChanged: () => void;
}) {
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (measurements.length === 0) return null;

  /**
   * What each kept shape measures, through the same engine call that drew it.
   *
   * This used to read `m.appliedQuantity ?? m.multiplier * m.countPer`, and
   * nothing writes `applied_quantity` until a measurement is applied — so every
   * apply from this panel sent `1`. A traced four thousand square foot pad
   * landed on the estimate as one square foot, and the estimate said so
   * without complaint.
   */
  const resolvedFor = (m: MeasurementRow) =>
    quantityOf(m, calibrations.find((c) => c.id === m.calibrationId) ?? null);

  async function apply(m: MeasurementRow) {
    const lineItemId = pick[m.id];
    if (!supabase || !lineItemId) {
      setError('Choose the line this belongs on first.');
      return;
    }
    const resolved = resolvedFor(m);
    if ('error' in resolved) {
      setError(`${m.name} cannot be put on a line: ${resolved.error}`);
      return;
    }
    setBusy(m.id); setError(null); setDone(null);
    try {
      const quantity = resolved.quantity;
      await applySavedMeasurement(supabase, {
        measurementId: m.id, lineItemId, quantity, engineVersion: ENGINE_VERSION,
      });
      setDone(m.name);
      onChanged();
    } catch (err) {
      setError(messageFor(err));
    } finally { setBusy(null); }
  }

  /**
   * Take it back off the line, keeping the tracing.
   *
   * The line is the sum of what was applied to it (migration 0177), so this
   * drops the line by exactly this measurement and leaves the shape drawn.
   */
  async function unapply(m: MeasurementRow) {
    if (!supabase) return;
    setBusy(m.id); setError(null); setDone(null);
    try {
      await unapplyTakeoff(supabase, m.id);
      onChanged();
    } catch (err) {
      setError(messageFor(err));
    } finally { setBusy(null); }
  }

  async function remove(m: MeasurementRow) {
    if (!supabase) return;
    setBusy(m.id); setError(null); setDone(null);
    try {
      await deleteMeasurement(supabase, m.id);
      onChanged();
    } catch (err) {
      setError(messageFor(err));
    } finally { setBusy(null); }
  }

  return (
    <div className="space-y-3 rounded-[--radius-card] border border-charcoal-200 p-4">
      <div>
        <h3 className="text-sm font-medium text-charcoal-900">
          Taken off this sheet
        </h3>
        <p className="text-xs text-charcoal-500">
          Measured and kept. Put one on a line when you get to it — that is a separate
          decision from measuring it, and it is made in a different order.
        </p>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {done ? <Alert tone="success">{done} is on the estimate.</Alert> : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Measurement</TableHead>
            <TableHead className="text-right">Quantity</TableHead>
            <TableHead>On a line</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {measurements.map((m) => (
            <TableRow key={m.id}>
              <TableCell>
                <p className="font-medium text-charcoal-900">{m.name}</p>
                <p className="text-xs text-charcoal-500">{m.kind}</p>
              </TableCell>
              <TableCell className="tabular text-right text-charcoal-700">
                {/*
                  * What it measures, whether or not it has been applied. This
                  * column read "not applied" on every kept shape, which is the
                  * one thing a takeoff list must never say about a measurement
                  * somebody has already traced.
                  */}
                {(() => {
                  const r = resolvedFor(m);
                  if ('error' in r) {
                    return <span className="text-xs text-danger-700" title={r.error}>
                      no scale
                    </span>;
                  }
                  return (
                    <span>
                      {`${qty(r.quantity)} ${r.unit}`}
                      {m.appliedQuantity != null
                        && Math.abs(m.appliedQuantity - r.quantity) > 0.005 ? (
                        <span className="block text-xs text-warn-700">
                          {`line has ${qty(m.appliedQuantity)}`}
                        </span>
                      ) : null}
                    </span>
                  );
                })()}
              </TableCell>
              <TableCell>
                {m.appliedLineItemId ? (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="success">
                      <Check className="mr-1 size-3" />on the estimate
                    </Badge>
                    {editable ? (
                      <Button size="sm" variant="ghost" disabled={busy === m.id}
                        title="Take it off the line — the tracing stays"
                        onClick={() => void unapply(m)}>
                        Take off
                      </Button>
                    ) : null}
                  </span>
                ) : editable ? (
                  /*
                    * A native select, like the unit picker and the cost code
                    * picker. Nothing here needs a custom menu, and the plain
                    * control is the one that works with a keyboard, on a phone,
                    * and in a test without ceremony.
                    */
                  <select
                    aria-label={`Line for ${m.name}`}
                    value={pick[m.id] ?? ''}
                    onChange={(e) => setPick((st) => ({ ...st, [m.id]: e.target.value }))}
                    className="h-8 w-56 rounded-md border border-charcoal-200 bg-white px-2 text-sm
                               focus:border-yellow-500 focus:outline-none">
                    <option value="">{lines.length ? 'Choose a line' : 'No open lines'}</option>
                    {lines.map((l) => (
                      <option key={l.id} value={l.id}>{l.description} ({l.unit})</option>
                    ))}
                  </select>
                ) : <span className="text-xs text-charcoal-400">not applied</span>}
              </TableCell>
              <TableCell>
                {editable ? (
                  <div className="flex items-center justify-end gap-1">
                    {m.appliedLineItemId ? null : (
                      <Button size="sm" variant="outline" disabled={busy === m.id}
                        onClick={() => void apply(m)}>
                        {busy === m.id ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
                        Apply
                      </Button>
                    )}
                    <button onClick={() => void remove(m)} disabled={busy === m.id}
                      aria-label={`Remove ${m.name} from this sheet`}
                      title="Take this measurement off the sheet"
                      className="rounded p-1 text-charcoal-400 hover:bg-danger-50 hover:text-danger-700">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
