/**
 * What happened on site, and the talk before the shift.
 *
 * Workflow: the two buttons on Safety & Quality, neither of which had a
 * handler. `safety_incidents` and `toolbox_talks` have been governed since 0021
 * and the screen already read both — so a company could look at a safety record
 * it had no way of adding to, and the recordable-incident rate it showed was
 * necessarily zero.
 *
 * One thing this deliberately does not ask: whether the incident is OSHA
 * recordable. That is a determination a person makes against the rule, with the
 * facts in front of them, and a form that inferred it from the incident type
 * would be inventing a regulatory finding. It is set on the record afterwards,
 * by somebody who decided it.
 */
import { useState } from 'react';
import { Loader2, ShieldAlert, Users } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useQuery, messageFor } from '@/lib/data/query';
import { createSafetyIncident, createToolboxTalk } from '@/lib/data/safety';
import { listProjects } from '@/lib/data/projects';

const INCIDENT_TYPE = [
  ['near_miss', 'Near miss — nobody hurt'],
  ['first_aid', 'First aid'],
  ['medical_treatment', 'Medical treatment'],
  ['restricted_duty', 'Restricted duty'],
  ['lost_time', 'Lost time'],
  ['fatality', 'Fatality'],
  ['property_damage', 'Property damage'],
  ['environmental', 'Environmental'],
  ['utility_strike', 'Utility strike'],
] as const;

const SEVERITY = [
  ['low', 'Low'], ['moderate', 'Moderate'], ['high', 'High'], ['critical', 'Critical'],
] as const;

function ProjectField({ id, value, onChange }: {
  id: string; value: string; onChange: (v: string) => void;
}) {
  const projectsQ = useQuery(listProjects, []);
  const projects = projectsQ.status === 'ready' ? projectsQ.data : [];
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Project</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder={projects.length ? 'Which job?' : 'No projects yet'} />
        </SelectTrigger>
        <SelectContent>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>{p.number} — {p.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** A datetime-local value for now, in the reader's own clock. */
function nowLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ReportIncidentDialog({ open, onOpenChange, companyId, onCreated }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string | null;
  onCreated: () => void;
}) {
  const [occurredAt, setOccurredAt] = useState(nowLocal);
  const [incidentType, setIncidentType] = useState('near_miss');
  const [severity, setSeverity] = useState('low');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [projectId, setProjectId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setOccurredAt(nowLocal()); setIncidentType('near_miss'); setSeverity('low');
    setDescription(''); setLocation(''); setProjectId(''); setError(null);
  };

  const submit = async () => {
    if (!companyId) { setError('No company to record it in.'); return; }
    setSaving(true); setError(null);
    try {
      await createSafetyIncident(companyId, {
        occurredAt: new Date(occurredAt).toISOString(),
        incidentType, description, severity,
        projectId: projectId || null,
        location: location || null,
      });
      reset(); onCreated(); onOpenChange(false);
    } catch (err) { setError(messageFor(err)); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="size-4" /> Report an incident
          </DialogTitle>
          <DialogDescription>
            Recorded with its investigation open. Whether it is OSHA recordable is decided
            on the record afterwards, by somebody who has looked at it.
          </DialogDescription>
        </DialogHeader>

        {error ? <Alert tone="danger" title="That did not save">{error}</Alert> : null}

        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="inc-when">When it happened</Label>
              <Input id="inc-when" type="datetime-local" value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inc-type">What kind</Label>
              <Select value={incidentType} onValueChange={setIncidentType}>
                <SelectTrigger id="inc-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INCIDENT_TYPE.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inc-what">What happened</Label>
            <Input id="inc-what" value={description}
              placeholder="Operator struck an unmarked gas service while trenching"
              onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="inc-sev">Severity</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger id="inc-sev"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SEVERITY.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inc-where">Where</Label>
              <Input id="inc-where" value={location} placeholder="Sta. 12+50"
                onChange={(e) => setLocation(e.target.value)} />
            </div>
            <ProjectField id="inc-project" value={projectId} onChange={setProjectId} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!description.trim() || saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <ShieldAlert className="size-4" />}
            Record it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ToolboxTalkDialog({ open, onOpenChange, companyId, onCreated }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string | null;
  onCreated: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [heldOn, setHeldOn] = useState(today);
  const [topic, setTopic] = useState('');
  const [attendeeCount, setAttendeeCount] = useState('');
  const [projectId, setProjectId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setHeldOn(today); setTopic(''); setAttendeeCount(''); setProjectId(''); setError(null);
  };

  const submit = async () => {
    if (!companyId) { setError('No company to record it in.'); return; }
    setSaving(true); setError(null);
    try {
      await createToolboxTalk(companyId, {
        heldOn, topic,
        attendeeCount: attendeeCount === '' ? 0 : Number(attendeeCount),
        projectId: projectId || null,
      });
      reset(); onCreated(); onOpenChange(false);
    } catch (err) { setError(messageFor(err)); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4" /> Record a toolbox talk
          </DialogTitle>
          <DialogDescription>
            Who was there is the point of the record — a talk nobody attended is a
            document rather than a briefing.
          </DialogDescription>
        </DialogHeader>

        {error ? <Alert tone="danger" title="That did not save">{error}</Alert> : null}

        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="talk-topic">Topic</Label>
            <Input id="talk-topic" value={topic} autoFocus
              placeholder="Trench entry and egress"
              onChange={(e) => setTopic(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="talk-when">Held on</Label>
              <Input id="talk-when" type="date" value={heldOn} max={today}
                onChange={(e) => setHeldOn(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="talk-count">Attended</Label>
              <Input id="talk-count" type="number" min="0" value={attendeeCount}
                onChange={(e) => setAttendeeCount(e.target.value)} />
            </div>
            <ProjectField id="talk-project" value={projectId} onChange={setProjectId} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!topic.trim() || saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Users className="size-4" />}
            Record it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
