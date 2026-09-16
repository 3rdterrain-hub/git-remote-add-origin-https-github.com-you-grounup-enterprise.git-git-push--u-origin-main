/**
 * A test, and what it measured.
 *
 * `inspections` had no writer: compaction, concrete breaks, pipe tests, proof
 * rolls — none could be recorded, while the table carried `retest_of_id` under
 * the comment "a failed test without a retest reference leaves the work
 * unaccepted" and a rule that a failed test must say why.
 *
 * The measured values are asked for as a value and a unit rather than free
 * text, because a pass with no numbers behind it is a word, and the numbers are
 * what an owner's engineer asks for when the work is questioned.
 */
import { useState } from 'react';
import { Loader2, FlaskConical, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { messageFor, useQuery } from '@/lib/data/query';
import { recordInspection, INSPECTION_TYPES } from '@/lib/data/safety';
import { loadScheduleProjects } from '@/lib/data/schedule';

const field = 'h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm';

export function RecordInspection({ canWrite, onRecorded, retestOf }: {
  canWrite: boolean;
  onRecorded: () => void;
  /** Set when this test replaces one that failed, so the failure is answered. */
  retestOf?: { id: string; title: string } | null;
}) {
  const projectsQ = useQuery(loadScheduleProjects, []);
  const projects = projectsQ.status === 'ready' ? projectsQ.data : [];

  const [open, setOpen] = useState(Boolean(retestOf));
  const [projectId, setProjectId] = useState('');
  const [inspectionType, setInspectionType] = useState('compaction');
  const [title, setTitle] = useState(retestOf ? `${retestOf.title} — retest` : '');
  const [station, setStation] = useState('');
  const [spec, setSpec] = useState('');
  const [agency, setAgency] = useState('');
  const [result, setResult] = useState('pending');
  const [measureName, setMeasureName] = useState('percent_compaction');
  const [measureValue, setMeasureValue] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const record = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await recordInspection({
        projectId,
        inspectionType,
        title,
        result,
        resultValues: measureValue
          ? { [measureName]: Number(measureValue) } : {},
        specReference: spec,
        station,
        inspectingAgency: agency,
        notes,
        retestOf: retestOf?.id ?? null,
      });
      setTitle(''); setStation(''); setSpec(''); setMeasureValue(''); setNotes('');
      setResult('pending');
      setOpen(false);
      onRecorded();
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={!canWrite}
        title={canWrite ? undefined : 'Needs permission to record tests'}>
        <FlaskConical className="size-4" /> Record a test
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3">
      {retestOf ? (
        <p className="text-sm text-charcoal-600">
          A retest of <span className="font-medium">{retestOf.title}</span>. Naming the test it
          replaces is what takes the earlier failure off the outstanding list — otherwise the
          work stays unaccepted.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="in-project">Which job</Label>
          <select id="in-project" className={field} value={projectId}
            onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Choose a project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.number} — {p.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="in-type">What kind</Label>
          <select id="in-type" className={field} value={inspectionType}
            onChange={(e) => setInspectionType(e.target.value)}>
            {INSPECTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="in-title">What was tested</Label>
          <Input id="in-title" value={title} placeholder="Subgrade density, station 12+50"
            onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="in-station">Station</Label>
          <Input id="in-station" value={station} placeholder="12+50"
            onChange={(e) => setStation(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="in-spec">Spec reference</Label>
          <Input id="in-spec" value={spec} placeholder="Section 203.06"
            onChange={(e) => setSpec(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="in-agency">Who tested it</Label>
          <Input id="in-agency" value={agency} placeholder="Testing lab"
            onChange={(e) => setAgency(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="in-result">Result</Label>
          <select id="in-result" className={field} value={result}
            onChange={(e) => setResult(e.target.value)}>
            <option value="pending">Pending</option>
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
            <option value="conditional">Conditional</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="in-mname">What was measured</Label>
          <Input id="in-mname" value={measureName}
            onChange={(e) => setMeasureName(e.target.value.replace(/\s+/g, '_'))} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="in-mvalue">The figure</Label>
          <Input id="in-mvalue" type="number" step="0.01" value={measureValue}
            onChange={(e) => setMeasureValue(e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="in-notes">
            {result === 'fail' ? 'Why it failed (required)' : 'Notes'}
          </Label>
          <Input id="in-notes" value={notes}
            placeholder={result === 'fail'
              ? 'Ninety-one percent against a ninety-five percent spec' : ''}
            onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      <p className="text-xs text-charcoal-500">
        A pass with no numbers behind it is a word. The figure is what an owner&rsquo;s
        engineer asks for when the work is questioned.
      </p>

      {error ? <p className="text-sm font-medium text-danger-700">{error}</p> : null}

      <div className="flex gap-2">
        <Button size="sm" onClick={() => void record()}
          disabled={busy || !projectId || !title.trim()
            || (result === 'fail' && !notes.trim())}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Record the test
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}
