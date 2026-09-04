import { useState } from 'react';
import { CheckCircle2, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { qty } from '@/lib/format';
import type { LineOption } from '@/lib/data/takeoff';

/**
 * Putting a measurement on a line.
 *
 * The step that makes measuring worth anything, and the one with the most ways
 * to be quietly wrong — so the panel states what will happen before it happens:
 * which line, what quantity, in what unit, and how the platform will describe
 * the way it was measured. That last one is not the estimator's to choose; it
 * comes from the calibration, and saying so here is how they learn that
 * recalibrating properly is worth the two minutes.
 */
export interface ApplyPanelProps {
  quantity: number | null;
  unit: string;
  /** From the calibration, never chosen here. */
  measurementMethod: string;
  lines: LineOption[];
  linesLoading: boolean;
  busy: boolean;
  onApply: (input: { name: string; trade: string; lineItemId: string }) => void;
  applied: { name: string; quantity: number; unit: string } | null;
  error: string | null;
  /**
   * Preselect a line. Set when the estimator arrives from an estimate line
   * wanting to measure that specific scope, which is the common case — the
   * alternative is finding the line again in a list of every draft line the
   * company has.
   */
  defaultLineItemId?: string;
}

export function ApplyPanel({
  quantity, unit, measurementMethod, lines, linesLoading, busy, onApply, applied, error,
  defaultLineItemId,
}: ApplyPanelProps) {
  const [name, setName] = useState('');
  const [trade, setTrade] = useState('');
  const [lineItemId, setLineItemId] = useState(defaultLineItemId ?? '');

  if (applied) {
    return (
      <Alert tone="success" icon={<CheckCircle2 className="size-4" />}
        title={`${applied.name} applied`}>
        {qty(applied.quantity, 2)} {applied.unit} is on the estimate line, with the sheet it was
        measured on recorded against it. Retrace it later and the platform will say the line no
        longer matches the drawing.
      </Alert>
    );
  }

  const ready = quantity != null && name.trim().length > 0 && lineItemId !== '';

  return (
    <div className="space-y-3 rounded-[--radius-card] border border-charcoal-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-500">
        Apply to an estimate
      </p>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="space-y-1.5">
        <Label htmlFor="m-name">Name this measurement</Label>
        <Input id="m-name" value={name} placeholder="Storm main — C-301"
          onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="m-trade">Trade (optional)</Label>
        <Input id="m-trade" value={trade} placeholder="Utilities"
          onChange={(e) => setTrade(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="m-line">Estimate line</Label>
        <Select value={lineItemId} onValueChange={setLineItemId} disabled={linesLoading}>
          <SelectTrigger id="m-line">
            <SelectValue placeholder={linesLoading ? 'Loading lines' : 'Choose a line'} />
          </SelectTrigger>
          <SelectContent>
            {lines.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.estimateNumber} v{l.versionNumber} · {l.description} ({l.unit})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!linesLoading && lines.length === 0 ? (
          <p className="text-xs text-charcoal-500">
            No draft estimate lines. An issued version is frozen, so it cannot take a quantity.
          </p>
        ) : null}
      </div>

      {quantity != null ? (
        <div className="rounded border border-charcoal-200 bg-charcoal-50/70 p-3 text-xs">
          <p className="text-charcoal-700">
            Will write <span className="tabular font-semibold">{qty(quantity, 2)} {unit}</span>{' '}
            and record it as{' '}
            <span className="font-semibold">{measurementMethod.replace(/_/g, ' ')}</span>.
          </p>
          <p className="mt-1 text-charcoal-500">
            How it was measured comes from the scale, not from this form — it decides the line's
            confidence and whether the estimate can be issued.
          </p>
        </div>
      ) : null}

      <Button className="w-full" disabled={!ready || busy}
        onClick={() => onApply({ name: name.trim(), trade: trade.trim(), lineItemId })}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
        {busy ? 'Applying' : 'Save and apply'}
      </Button>
    </div>
  );
}
