/**
 * An incident investigation, and closing it.
 *
 * `create_safety_incident` (0162) was the whole write side: `investigation_state`
 * started at `open` and nothing anywhere could move it, so every incident this
 * platform recorded stayed open forever — including every recordable
 * `notify_recordable_incident` (0035) told the company about. The OSHA 300 log
 * is built from these rows.
 *
 * Closing is a separate action from editing, on screen as in the database,
 * because it requires a root cause and a corrective action. An incident closed
 * without them is one filed rather than fixed, and the next one has the same
 * cause — which is the whole argument for investigating at all.
 */
import { useState } from 'react';
import { Loader2, ShieldCheck, ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { messageFor } from '@/lib/data/query';
import { updateSafetyIncident, closeSafetyIncident } from '@/lib/data/safety';

const field = 'h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm';

const STATES = [
  { value: 'open', label: 'Open' },
  { value: 'investigating', label: 'Investigating' },
  { value: 'corrective_action', label: 'Corrective action' },
];

export function IncidentInvestigation({
  incidentId, investigationState, isOshaRecordable, oshaCaseNumber,
  daysOpen, canWrite, onChanged,
}: {
  incidentId: string;
  investigationState: string;
  isOshaRecordable: boolean;
  oshaCaseNumber: string | null;
  daysOpen: number | null;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const closed = investigationState === 'closed';
  const [rootCause, setRootCause] = useState('');
  const [correctiveAction, setCorrectiveAction] = useState('');
  const [caseNumber, setCaseNumber] = useState(oshaCaseNumber ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await work(); onChanged(); }
    catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  };

  if (closed) {
    return (
      <p className="text-xs text-charcoal-500">
        <ShieldCheck className="mr-1 inline size-3.5 text-success-700" />
        Closed. A closed investigation is the record of what was decided — if something has
        changed, raise a new one rather than editing this.
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={daysOpen !== null && daysOpen > 30 ? 'danger' : 'warn'}>
          {daysOpen === null ? 'Open' : `Open ${daysOpen} days`}
        </Badge>
        {isOshaRecordable ? <Badge variant="danger">OSHA recordable</Badge> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={`is-${incidentId}`}>Where it stands</Label>
          <select id={`is-${incidentId}`} className={field} value={investigationState}
            disabled={!canWrite || busy}
            onChange={(e) => run(() => updateSafetyIncident({
              incidentId, investigationState: e.target.value,
            }))}>
            {STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        {isOshaRecordable ? (
          <div className="space-y-1">
            <Label htmlFor={`ic-${incidentId}`}>OSHA case number</Label>
            <Input id={`ic-${incidentId}`} value={caseNumber} disabled={!canWrite}
              placeholder="Required before it can close"
              onChange={(e) => setCaseNumber(e.target.value)}
              onBlur={() => {
                if (caseNumber.trim() && caseNumber !== (oshaCaseNumber ?? '')) {
                  void run(() => updateSafetyIncident({
                    incidentId, oshaCaseNumber: caseNumber,
                  }));
                }
              }} />
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`ir-${incidentId}`}>What actually caused it</Label>
          <Input id={`ir-${incidentId}`} value={rootCause} disabled={!canWrite}
            placeholder="Not &quot;operator error&quot; — what about the work let it happen"
            onChange={(e) => setRootCause(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`ia-${incidentId}`}>What was changed so it does not happen again</Label>
          <Input id={`ia-${incidentId}`} value={correctiveAction} disabled={!canWrite}
            onChange={(e) => setCorrectiveAction(e.target.value)} />
        </div>
      </div>

      {error ? <p className="text-sm font-medium text-danger-700">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!canWrite || busy
          || rootCause.trim().length < 10 || correctiveAction.trim().length < 10}
          onClick={() => run(async () => {
            await closeSafetyIncident(incidentId, rootCause, correctiveAction);
            setRootCause(''); setCorrectiveAction('');
          })}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ClipboardCheck className="size-4" />}
          Close the investigation
        </Button>
        <span className="text-xs text-charcoal-500">
          Both are required. An incident closed without them is one filed rather than fixed.
        </span>
      </div>
    </div>
  );
}
