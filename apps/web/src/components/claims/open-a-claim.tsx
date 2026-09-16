/**
 * Opening a claim. WORKFLOW.
 *
 * `claims` has existed since migration 0023, fully governed, with no writer of
 * any kind — so a company could read the claims it was running and could not
 * open one.
 *
 * The deadlines are not on this form and never will be. They are derived from
 * the contract's own notice and claim clauses, which is the entire reason those
 * clauses are stored as numbers of days rather than as quoted prose. A deadline
 * typed by hand stops agreeing with the contract the moment either is
 * corrected, and the one everybody then works to is the wrong one.
 */
import { useState } from 'react';
import { Loader2, Gavel } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { messageFor, useQuery } from '@/lib/data/query';
import { listProjects } from '@/lib/data/projects';
import { createClaim, loadContracts, CLAIM_TYPES } from '@/lib/data/claims';
import { titleCase, plural } from '@/lib/format';

const field = 'h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm';
const today = () => new Date().toISOString().slice(0, 10);

export function OpenAClaim({ canWrite, onOpened }: {
  canWrite: boolean;
  onOpened: () => void;
}) {
  const [open, setOpen] = useState(false);
  const projectsQ = useQuery(listProjects, [open]);
  const contractsQ = useQuery(loadContracts, [open]);
  const projects = projectsQ.status === 'ready' ? projectsQ.data : [];
  const contracts = contractsQ.status === 'ready' ? contractsQ.data : [];

  const [projectId, setProjectId] = useState('');
  const [contractId, setContractId] = useState('');
  const [title, setTitle] = useState('');
  const [claimType, setClaimType] = useState<string>('differing_site_condition');
  const [description, setDescription] = useState('');
  const [eventDate, setEventDate] = useState(today());
  const [cost, setCost] = useState('');
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const project = projectId || projects[0]?.id || '';
  const onThisProject = contracts.filter((c) => c.projectId === project);
  const contract = onThisProject.find((c) => c.id === contractId) ?? null;
  const ready = project !== '' && title.trim() !== '' && description.trim() !== '';

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={!canWrite}
        title={canWrite ? undefined : 'Needs permission to open a claim'}>
        <Gavel className="size-4" /> Open a claim
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3 text-left">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="cl-project">Project</Label>
          <select id="cl-project" className={field} value={project}
            onChange={(e) => { setProjectId(e.target.value); setContractId(''); }}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.number} — {p.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cl-contract">Under which contract</Label>
          <select id="cl-contract" className={field} value={contractId}
            onChange={(e) => setContractId(e.target.value)}>
            <option value="">No contract on file</option>
            {onThisProject.map((c) => (
              <option key={c.id} value={c.id}>{c.number} — {c.title}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="cl-title">What the claim is</Label>
          <Input id="cl-title" value={title} autoFocus placeholder="Rock at subgrade, station 12+00"
            onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cl-type">Type</Label>
          <select id="cl-type" className={field} value={claimType}
            onChange={(e) => setClaimType(e.target.value)}>
            {CLAIM_TYPES.map((t) => (
              <option key={t} value={t}>{titleCase(t)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cl-event">Date of the event</Label>
          <Input id="cl-event" type="date" value={eventDate}
            onChange={(e) => setEventDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cl-cost">Cost claimed</Label>
          <Input id="cl-cost" type="number" value={cost} placeholder="0"
            onChange={(e) => setCost(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cl-days">Days claimed</Label>
          <Input id="cl-days" type="number" value={days} placeholder="0"
            onChange={(e) => setDays(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="cl-desc">What happened</Label>
        <textarea id="cl-desc" rows={3} value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded-md border border-charcoal-200 bg-white p-2 text-sm"
          placeholder="Written now, while anybody still remembers. This is the contemporaneous record." />
      </div>

      {/*
        * What the contract will do to this claim's dates, before it is opened.
        * A contract with no clause on file is not a contract with no clause, and
        * the difference decides whether anybody is ever warned.
        */}
      {contract ? (
        contract.noticeClauseOnFile ? (
          <Alert tone="info" title="The deadlines come from the contract">
            {contract.number} gives {plural(contract.noticeDays ?? 0, 'day')} for notice
            {contract.claimDays ? ` and ${plural(contract.claimDays, 'day')} for the claim` : ''},
            counted from the date of the event. They are dated for you rather than typed, so they
            cannot stop agreeing with the contract.
          </Alert>
        ) : (
          <Alert tone="warn" title="That contract has no notice clause on file">
            No deadline will be computed for this claim. Nothing will be invented in its place —
            but nothing will warn you either. Put the clause on the contract and the dates follow.
          </Alert>
        )
      ) : null}

      {error ? <Alert tone="danger" title="That claim was not opened">{error}</Alert> : null}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" disabled={!ready || busy}
          title={ready ? undefined : 'A project, a title, and what happened'}
          onClick={() => {
            setBusy(true); setError(null);
            createClaim(project, {
              title, claimType, description, eventDate,
              contractId: contractId || null,
              costClaimed: Number(cost || 0),
              timeClaimedDays: Number(days || 0),
            })
              .then(() => {
                setTitle(''); setDescription(''); setCost(''); setDays('');
                setOpen(false); onOpened();
              })
              .catch((e: unknown) => setError(messageFor(e)))
              .finally(() => setBusy(false));
          }}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Open it
        </Button>
      </div>
    </div>
  );
}
