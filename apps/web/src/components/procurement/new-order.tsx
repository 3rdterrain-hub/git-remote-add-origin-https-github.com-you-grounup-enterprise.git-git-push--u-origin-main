/**
 * Buying something, and asking several vendors what it costs.
 *
 * Workflow: both header buttons on Procurement, neither of which had a handler.
 * With no purchase order raisable, the committed-cost figure that makes an
 * overrun visible *before* the invoice arrives was always zero — the screen
 * reported perfect control over spending nobody could record.
 *
 * Both open in draft. Issuing a purchase order is what commits the company to
 * the money, and issuing an RFQ is what puts its name in front of a vendor;
 * neither should happen because somebody filled in a form.
 */
import { useState } from 'react';
import { Loader2, ShoppingCart, FileQuestion } from 'lucide-react';
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
import { createPurchaseOrder, createRfq } from '@/lib/data/procurement';
import { loadVendors } from '@/lib/data/library';
import { listProjects } from '@/lib/data/projects';

const PO_TYPE = [
  ['material', 'Material'],
  ['subcontract', 'Subcontract'],
  ['rental', 'Rental'],
  ['service', 'Service'],
] as const;

/** The projects a commitment can be charged to. Optional — not all are. */
function ProjectField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const projectsQ = useQuery(listProjects, []);
  const projects = projectsQ.status === 'ready' ? projectsQ.data : [];
  return (
    <div className="space-y-1.5">
      <Label htmlFor="po-project">Project</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="po-project">
          <SelectValue placeholder={projects.length ? 'Charge it to a job (optional)' : 'No projects yet'} />
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

export function NewPurchaseOrderDialog({ open, onOpenChange, companyId, onCreated }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string | null;
  onCreated: () => void;
}) {
  const vendorsQ = useQuery(loadVendors, []);
  const vendors = vendorsQ.status === 'ready' ? vendorsQ.data : [];
  const [vendorId, setVendorId] = useState('');
  const [title, setTitle] = useState('');
  const [poType, setPoType] = useState('material');
  const [projectId, setProjectId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setVendorId(''); setTitle(''); setPoType('material');
    setProjectId(''); setError(null);
  };

  const submit = async () => {
    if (!companyId) { setError('No company to raise it in.'); return; }
    setSaving(true); setError(null);
    try {
      await createPurchaseOrder(companyId, {
        vendorId, title, poType, projectId: projectId || null,
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
            <ShoppingCart className="size-4" /> Raise a purchase order
          </DialogTitle>
          <DialogDescription>
            It opens in draft with nothing committed. Issuing it is what puts the company
            on the hook for the money.
          </DialogDescription>
        </DialogHeader>

        {error ? <Alert tone="danger" title="That did not save">{error}</Alert> : null}

        {vendors.length === 0 ? (
          <Alert tone="warn" title="No vendors yet">
            A purchase order is raised against a vendor. Add one in Master Libraries and
            this will have somebody to buy from.
          </Alert>
        ) : (
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="po-vendor">Vendor</Label>
              <Select value={vendorId} onValueChange={setVendorId}>
                <SelectTrigger id="po-vendor"><SelectValue placeholder="Who are you buying from?" /></SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.code} — {v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="po-title">What it is for</Label>
              <Input id="po-title" value={title} placeholder="Storm structures, Monroe Street"
                onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="po-type">Kind</Label>
                <Select value={poType} onValueChange={setPoType}>
                  <SelectTrigger id="po-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PO_TYPE.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <ProjectField value={projectId} onChange={setProjectId} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!vendorId || !title.trim() || saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <ShoppingCart className="size-4" />}
            Raise it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NewRfqDialog({ open, onOpenChange, companyId, onCreated }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string | null;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [projectId, setProjectId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setTitle(''); setDueAt(''); setProjectId(''); setError(null); };

  const submit = async () => {
    if (!companyId) { setError('No company to start it in.'); return; }
    setSaving(true); setError(null);
    try {
      await createRfq(companyId, {
        title,
        /* A date box gives a local day; the column is a timestamp, so it is
           sent as the end of that day rather than its midnight — a quote due
           "on the 20th" is not due as the 19th turns over. */
        dueAt: dueAt ? new Date(`${dueAt}T23:59:59`).toISOString() : null,
        projectId: projectId || null,
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
            <FileQuestion className="size-4" /> Ask for quotes
          </DialogTitle>
          <DialogDescription>
            It opens in draft. Awarding one later has to name both the vendor and the
            reason it won — which is what makes a comparison you can defend.
          </DialogDescription>
        </DialogHeader>

        {error ? <Alert tone="danger" title="That did not save">{error}</Alert> : null}

        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="rfq-title">What is being quoted</Label>
            <Input id="rfq-title" value={title} autoFocus
              placeholder="Aggregate supply, Phase 1"
              onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rfq-due">Quotes due</Label>
              <Input id="rfq-due" type="date" value={dueAt}
                onChange={(e) => setDueAt(e.target.value)} />
            </div>
            <ProjectField value={projectId} onChange={setProjectId} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!title.trim() || saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <FileQuestion className="size-4" />}
            Start it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
