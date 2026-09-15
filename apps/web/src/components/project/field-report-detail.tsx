/**
 * Filling a day in, and handing it in.
 *
 * `create_daily_report` made the header and said why it left it open:
 * "submitting is what freezes it, and a report created already frozen could
 * never be filled in." Nothing was ever built on that. There was no writer for
 * the crews, none for the machines, and nothing that could set `submitted_at` —
 * so a superintendent could create a day and then do nothing else with it.
 *
 * It cost more than the missing form. `reporting_labor_reconciliation` compares
 * reported hours against approved timecards and is read by the Workforce
 * screen; with no writer on the report side it could only ever answer "no daily
 * report", for every project and every day, presented as a finding.
 */
import { useState } from 'react';
import { HardHat, Send, Truck, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import {
  addReportLabor, addReportEquipment, removeReportLine, submitDailyReport,
  type DailyReportRow,
} from '@/lib/data/project';
import { qty, integer } from '@/lib/format';

export function FieldReportDetail({ report, editable, onChanged }: {
  report: DailyReportRow;
  editable: boolean;
  onChanged: () => void;
}) {
  const submitted = report.submittedAt !== null;
  const open = editable && !submitted;

  const [adding, setAdding] = useState<'labor' | 'equipment' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Labor */
  const [classification, setClassification] = useState('');
  const [headcount, setHeadcount] = useState('');
  const [straight, setStraight] = useState('');
  const [overtime, setOvertime] = useState('');

  /* Equipment */
  const [machine, setMachine] = useState('');
  const [operating, setOperating] = useState('');
  const [idle, setIdle] = useState('');
  const [fuel, setFuel] = useState('');

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    if (!supabase || busy) return;
    setBusy(true); setError(null);
    try { await fn(); after?.(); onChanged(); }
    catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  };

  const crewHours = report.labor.reduce(
    (a, l) => a + l.headcount * (l.straightHours + l.overtimeHours), 0);

  return (
    <div className="space-y-3">
      {error ? <Alert tone="danger" title="That could not be saved">{error}</Alert> : null}

      {submitted ? (
        <p className="text-xs text-charcoal-500">
          Handed in. What was reported does not change — a correction goes on today's
          report, not on a day that has been signed off.
        </p>
      ) : null}

      {open ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy}
            onClick={() => setAdding(adding === 'labor' ? null : 'labor')}>
            <HardHat className="mr-1.5 size-3.5" aria-hidden /> Add a crew
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy}
            onClick={() => setAdding(adding === 'equipment' ? null : 'equipment')}>
            <Truck className="mr-1.5 size-3.5" aria-hidden /> Add a machine
          </Button>
          <Button type="button" size="sm" disabled={busy}
            onClick={() => void run(() => submitDailyReport(supabase!, report.id))}>
            <Send className="mr-1.5 size-3.5" aria-hidden /> Hand it in
          </Button>
          {crewHours > 0 ? (
            <span className="self-center text-xs text-charcoal-500">
              {integer(crewHours)} crew hours on this day
            </span>
          ) : null}
        </div>
      ) : null}

      {open && adding === 'labor' ? (
        <div className="grid gap-2 rounded-md border border-charcoal-200 bg-white p-3
                        sm:grid-cols-4">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`cls-${report.id}`}>Trade or classification</Label>
            <Input id={`cls-${report.id}`} value={classification} placeholder="Operator"
              onChange={(e) => setClassification(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`hc-${report.id}`}>How many</Label>
            <Input id={`hc-${report.id}`} type="number" min={1} value={headcount}
              onChange={(e) => setHeadcount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`st-${report.id}`}>Straight hours</Label>
            <Input id={`st-${report.id}`} type="number" step="0.25" value={straight}
              onChange={(e) => setStraight(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`ot-${report.id}`}>Overtime hours</Label>
            <Input id={`ot-${report.id}`} type="number" step="0.25" value={overtime}
              onChange={(e) => setOvertime(e.target.value)} />
          </div>
          <div className="flex items-end gap-2 sm:col-span-4">
            <Button type="button" size="sm"
              disabled={busy || !classification.trim() || !headcount.trim() || !straight.trim()}
              onClick={() => void run(() => addReportLabor(supabase!, {
                reportId: report.id,
                classification,
                headcount: Number(headcount),
                straightHours: Number(straight),
                overtimeHours: overtime.trim() ? Number(overtime) : 0,
              }), () => {
                setAdding(null); setClassification(''); setHeadcount('');
                setStraight(''); setOvertime('');
              })}>Add the crew</Button>
            <Button type="button" size="sm" variant="ghost"
              onClick={() => setAdding(null)}>Cancel</Button>
          </div>
        </div>
      ) : null}

      {open && adding === 'equipment' ? (
        <div className="grid gap-2 rounded-md border border-charcoal-200 bg-white p-3
                        sm:grid-cols-4">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`mc-${report.id}`}>What machine</Label>
            <Input id={`mc-${report.id}`} value={machine}
              placeholder="Excavator, 30 tonne"
              onChange={(e) => setMachine(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`op-${report.id}`}>Operating hours</Label>
            <Input id={`op-${report.id}`} type="number" step="0.25" value={operating}
              onChange={(e) => setOperating(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`id-${report.id}`}>Idle hours</Label>
            <Input id={`id-${report.id}`} type="number" step="0.25" value={idle}
              onChange={(e) => setIdle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`fu-${report.id}`}>Fuel (gal)</Label>
            <Input id={`fu-${report.id}`} type="number" step="0.1" value={fuel}
              onChange={(e) => setFuel(e.target.value)} />
          </div>
          <p className="text-xs text-charcoal-500 sm:col-span-3">
            Idle is kept apart from operating because only one of them is productive.
            A machine that sat idle for six hours cost money and moved nothing.
          </p>
          <div className="flex items-end gap-2 sm:col-span-4">
            <Button type="button" size="sm"
              disabled={busy || !machine.trim() || !operating.trim()}
              onClick={() => void run(() => addReportEquipment(supabase!, {
                reportId: report.id,
                description: machine,
                operatingHours: Number(operating),
                idleHours: idle.trim() ? Number(idle) : 0,
                fuelGallons: fuel.trim() ? Number(fuel) : 0,
              }), () => {
                setAdding(null); setMachine(''); setOperating('');
                setIdle(''); setFuel('');
              })}>Add the machine</Button>
            <Button type="button" size="sm" variant="ghost"
              onClick={() => setAdding(null)}>Cancel</Button>
          </div>
        </div>
      ) : null}

      {open && (report.labor.length > 0 || report.equipment.length > 0) ? (
        <div className="flex flex-wrap gap-1.5">
          {report.labor.map((l) => (
            <Badge key={l.id} variant="default" className="gap-1.5">
              {l.classification} ×{l.headcount} · {qty(l.straightHours + l.overtimeHours, 1)} hr
              <button type="button" disabled={busy}
                aria-label={`Remove ${l.classification}`}
                onClick={() => void run(() => removeReportLine(supabase!, l.id, 'labor'))}
                className="rounded text-charcoal-400 hover:text-danger-700">
                <Trash2 className="size-3" aria-hidden />
              </button>
            </Badge>
          ))}
          {report.equipment.map((e) => (
            <Badge key={e.id} variant="default" className="gap-1.5">
              {e.description} · {qty(e.operatingHours, 1)} hr
              <button type="button" disabled={busy}
                aria-label={`Remove ${e.description}`}
                onClick={() => void run(() => removeReportLine(supabase!, e.id, 'equipment'))}
                className="rounded text-charcoal-400 hover:text-danger-700">
                <Trash2 className="size-3" aria-hidden />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
