/**
 * Recording a capture. WORKFLOW.
 *
 * `surveys` had no writer anywhere, so this screen listed captures that nobody
 * could ever add one to — an empty list that looks exactly like a broken one.
 *
 * The datum fields are not decoration and they are not optional. A rover shot on
 * NAVD88 compared against a design model on NGVD29 differs by about three and a
 * half feet in Ohio, and nothing about either file says so. The database refuses
 * that comparison; this form is where the fact it refuses on gets recorded.
 */
import { useState } from 'react';
import { Loader2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { messageFor, useQuery } from '@/lib/data/query';
import { listProjects } from '@/lib/data/projects';
import { recordSurvey, CAPTURE_METHODS, SURVEY_UNITS } from '@/lib/data/survey';
import { titleCase } from '@/lib/format';

const field = 'h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm';

const today = () => new Date().toISOString().slice(0, 10);

export function RecordSurvey({ canWrite, onRecorded }: {
  canWrite: boolean;
  onRecorded: (surveyId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const projectsQ = useQuery(listProjects, [open]);
  const projects = projectsQ.status === 'ready' ? projectsQ.data : [];

  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [method, setMethod] = useState<string>('gps_rover');
  const [capturedOn, setCapturedOn] = useState(today());
  const [capturedBy, setCapturedBy] = useState('');
  const [horizontal, setHorizontal] = useState('NAD83');
  const [vertical, setVertical] = useState('NAVD88');
  const [crs, setCrs] = useState('');
  const [units, setUnits] = useState<string>('us_survey_feet');
  const [points, setPoints] = useState('');
  const [areaSf, setAreaSf] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const project = projectId || projects[0]?.id || '';
  const ready = project !== '' && name.trim() !== '';

  const save = async () => {
    if (!ready || busy) return;
    setBusy(true); setError(null);
    try {
      const id = await recordSurvey({
        projectId: project,
        name,
        captureMethod: method,
        capturedOn,
        capturedBy,
        horizontalDatum: horizontal,
        verticalDatum: vertical,
        coordinateSystem: crs,
        units,
        pointCount: points.trim() === '' ? null : Number(points),
        areaSf: areaSf.trim() === '' ? null : Number(areaSf),
        notes,
      });
      setName(''); setCapturedBy(''); setPoints(''); setAreaSf(''); setNotes('');
      setOpen(false);
      onRecorded(id);
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={!canWrite}
        title={canWrite ? undefined : 'Needs permission to record a survey'}>
        <MapPin className="size-4" /> Record a capture
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3 text-left">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="sv-project">Project</Label>
          <select id="sv-project" className={field} value={project}
            onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.number} — {p.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="sv-name">What was shot</Label>
          <Input id="sv-name" value={name} autoFocus
            placeholder="Rover shot, north half"
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sv-method">Method</Label>
          <select id="sv-method" className={field} value={method}
            onChange={(e) => setMethod(e.target.value)}>
            {CAPTURE_METHODS.map((m) => (
              <option key={m} value={m}>{titleCase(m)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sv-date">Captured</Label>
          <Input id="sv-date" type="date" value={capturedOn}
            onChange={(e) => setCapturedOn(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sv-by">By</Label>
          <Input id="sv-by" value={capturedBy} placeholder="Who ran the instrument"
            onChange={(e) => setCapturedBy(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sv-points">Points</Label>
          <Input id="sv-points" type="number" value={points} placeholder="0"
            onChange={(e) => setPoints(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sv-area">Area (SF)</Label>
          <Input id="sv-area" type="number" value={areaSf} placeholder="0"
            onChange={(e) => setAreaSf(e.target.value)} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="sv-hd">Horizontal datum</Label>
          <Input id="sv-hd" value={horizontal} onChange={(e) => setHorizontal(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sv-vd">Vertical datum</Label>
          <Input id="sv-vd" value={vertical} onChange={(e) => setVertical(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sv-crs">Coordinate system</Label>
          <Input id="sv-crs" value={crs} placeholder="OH North 3401"
            onChange={(e) => setCrs(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sv-units">Units</Label>
          <select id="sv-units" className={field} value={units}
            onChange={(e) => setUnits(e.target.value)}>
            {SURVEY_UNITS.map((u) => (
              <option key={u} value={u}>{titleCase(u)}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="sv-notes">Notes</Label>
        <Input id="sv-notes" value={notes} placeholder="Wet in the southwest corner; no shots below the pond"
          onChange={(e) => setNotes(e.target.value)} />
      </div>

      <Alert tone="info" title="Why the datum is asked for twice">
        A volume computed between two surfaces on different vertical datums is wrong by exactly the
        offset between them, and it looks entirely reasonable. The comparison refuses rather than
        reporting that number, and this is the fact it refuses on.
      </Alert>

      {error ? <Alert tone="danger" title="That capture was not recorded">{error}</Alert> : null}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" onClick={() => { void save(); }} disabled={!ready || busy}
          title={ready ? undefined : 'A capture needs a project and a name'}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Record the capture
        </Button>
      </div>
    </div>
  );
}
