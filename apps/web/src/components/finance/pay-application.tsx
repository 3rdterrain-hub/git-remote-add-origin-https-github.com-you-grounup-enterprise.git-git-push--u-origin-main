/**
 * Opening the next application for payment.
 *
 * Workflow: the header button on Finance, which had no handler — so a company
 * could read a schedule of values that traces back to the estimate it was
 * priced from, and could not ask to be paid against it.
 *
 * It takes a project and a period, and nothing else. The contract sum and the
 * retainage are read off the project in the database rather than typed here:
 * that figure is what the whole application is measured against, and a browser
 * that could name it could bill against a contract that does not exist.
 */
import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
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
import { createPayApplication } from '@/lib/data/finance';
import { listProjects } from '@/lib/data/projects';

/** The first and last day of the month just gone — the usual billing period. */
function lastMonth(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  const iso = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  return { start: iso(start), end: iso(end) };
}

export function NewPayApplicationDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const projectsQ = useQuery(listProjects, []);
  const projects = projectsQ.status === 'ready' ? projectsQ.data : [];
  const period = lastMonth();
  const [projectId, setProjectId] = useState('');
  const [periodStart, setPeriodStart] = useState(period.start);
  const [periodEnd, setPeriodEnd] = useState(period.end);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setProjectId(''); setPeriodStart(period.start); setPeriodEnd(period.end); setError(null);
  };

  const submit = async () => {
    setSaving(true); setError(null);
    try {
      await createPayApplication(projectId, periodStart, periodEnd);
      reset(); onCreated(); onOpenChange(false);
    } catch (err) { setError(messageFor(err)); }
    finally { setSaving(false); }
  };

  const backwards = Boolean(periodStart && periodEnd && periodEnd < periodStart);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="size-4" /> Open a pay application
          </DialogTitle>
          <DialogDescription>
            It opens as a draft, numbered after the last one on this project. The contract
            sum and retainage come off the project.
          </DialogDescription>
        </DialogHeader>

        {error ? <Alert tone="danger" title="That did not open">{error}</Alert> : null}

        {projects.length === 0 ? (
          <Alert tone="warn" title="No projects yet">
            A pay application bills against a contract, so it needs a project. Award an
            estimate or open one on the Projects screen.
          </Alert>
        ) : (
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="pa-project">Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id="pa-project"><SelectValue placeholder="Which job?" /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.number} — {p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pa-from">Period from</Label>
                <Input id="pa-from" type="date" value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pa-to">Period to</Label>
                <Input id="pa-to" type="date" value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)} />
              </div>
            </div>
            {backwards ? (
              <Alert tone="warn" title="A period cannot end before it starts">
                Check the two dates.
              </Alert>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!projectId || backwards || saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Open it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
