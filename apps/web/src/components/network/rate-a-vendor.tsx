/**
 * Rating a subcontractor you held a contract with. WORKFLOW.
 *
 * A rating is a statement of record: once it is left it cannot be edited, and
 * `network_ratings_immutable` is what makes that true rather than this form.
 * Three refusals a person may meet here, all of them from the database and all
 * of them worth reading rather than hiding:
 *
 *   * **One per company per project.** A company that worked with a sub off
 *     contract still gets exactly one say.
 *   * **Not on your own listing.** Posting a listing for a sub and then giving
 *     it five stars is marking your own homework in a directory other
 *     contractors make hiring decisions from.
 *   * **Only on a published listing.** A draft nobody has consented to is not
 *     something to build a public record against.
 */
import { useState } from 'react';
import { Loader2, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { messageFor, useQuery } from '@/lib/data/query';
import { listProjects } from '@/lib/data/projects';
import { rateNetworkVendor, type NetworkVendor } from '@/lib/data/network';
import { cn } from '@/lib/utils';

const SCORES = [1, 2, 3, 4, 5] as const;

/** Five buttons rather than a number box: a rating is a choice, not a figure. */
function Score({ label, value, onChange }: {
  label: string; value: number; onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex gap-1" role="group" aria-label={label}>
        {SCORES.map((n) => (
          <button key={n} type="button" onClick={() => onChange(n)}
            aria-pressed={value === n} aria-label={`${label} ${n} out of 5`}
            className={cn(
              'flex size-8 items-center justify-center rounded-md border text-sm font-semibold',
              value === n
                ? 'border-charcoal-800 bg-charcoal-800 text-white'
                : 'border-charcoal-200 bg-white text-charcoal-600 hover:border-charcoal-400',
            )}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

export function RateAVendor({ vendor, companyId, canWrite, onRated }: {
  vendor: NetworkVendor;
  companyId: string | null;
  canWrite: boolean;
  onRated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const projectsQ = useQuery(listProjects, [open]);
  const projects = projectsQ.status === 'ready' ? projectsQ.data : [];

  const [quality, setQuality] = useState(0);
  const [schedule, setSchedule] = useState(0);
  const [safety, setSafety] = useState(0);
  const [communication, setCommunication] = useState(0);
  const [wouldHireAgain, setWouldHireAgain] = useState(true);
  const [projectId, setProjectId] = useState('');
  const [comment, setComment] = useState('');
  const [contractValue, setContractValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Your own listing is not rateable, and the reason belongs on screen. */
  if (vendor.isMine || !vendor.isPublished) return null;

  const ready = companyId !== null
    && quality > 0 && schedule > 0 && safety > 0 && communication > 0;

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={!canWrite}
        title={canWrite ? undefined : 'Needs permission to write customer records'}>
        <Star className="size-4" /> Rate them
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Score label="Quality" value={quality} onChange={setQuality} />
        <Score label="Schedule" value={schedule} onChange={setSchedule} />
        <Score label="Safety" value={safety} onChange={setSafety} />
        <Score label="Communication" value={communication} onChange={setCommunication} />
        <div className="space-y-1">
          <Label htmlFor={`nr-proj-${vendor.id}`}>On which project</Label>
          <select id={`nr-proj-${vendor.id}`} value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm">
            <option value="">No project — worked with them off contract</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.number} — {p.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`nr-val-${vendor.id}`}>Contract value</Label>
          <Input id={`nr-val-${vendor.id}`} type="number" value={contractValue} placeholder="0"
            onChange={(e) => setContractValue(e.target.value)} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={wouldHireAgain}
          onChange={(e) => setWouldHireAgain(e.target.checked)} />
        I would hire them again
      </label>

      <div className="space-y-1">
        <Label htmlFor={`nr-note-${vendor.id}`}>What another contractor should know</Label>
        <textarea id={`nr-note-${vendor.id}`} rows={2} value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="w-full rounded-md border border-charcoal-200 bg-white p-2 text-sm"
          placeholder="Mobilized inside 48 hours and kept the hole dry through 3 in of rain." />
      </div>

      <Alert tone="warn" title="This cannot be edited afterwards">
        A rating is on the record from the moment it is left. Your company is not named to anybody
        reading it, and you get one rating per project — so it is worth saying the whole thing now.
      </Alert>

      {error ? <Alert tone="danger" title="That rating was not left">{error}</Alert> : null}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" disabled={!ready || busy}
          title={ready ? undefined : 'All four scores'}
          onClick={() => {
            if (!companyId) return;
            setBusy(true); setError(null);
            rateNetworkVendor(vendor.id, companyId, {
              quality, schedule, safety, communication, wouldHireAgain,
              projectId: projectId || null,
              comment: comment.trim() || null,
              contractValue: contractValue ? Number(contractValue) : null,
            })
              .then(() => {
                setQuality(0); setSchedule(0); setSafety(0); setCommunication(0);
                setComment(''); setContractValue(''); setProjectId('');
                setOpen(false); onRated();
              })
              .catch((e: unknown) => setError(messageFor(e)))
              .finally(() => setBusy(false));
          }}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Leave the rating
        </Button>
      </div>
    </div>
  );
}
