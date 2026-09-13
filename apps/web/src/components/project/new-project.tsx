/**
 * Opening a job that never had an estimate.
 *
 * Workflow: the other way a project begins. Awarding an estimate is the
 * ordinary path and carries every priced line across as a budgeted activity;
 * this is for work that arrives without a bid — time and materials, a call-out,
 * an emergency repair.
 *
 * The dialog says so plainly rather than hiding it, because somebody who has an
 * estimate for this job should award that instead and get a budget with it.
 */
import { useState } from 'react';
import { HardHat, Loader2, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
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
import { createProject } from '@/lib/data/projects';
import { loadCustomers } from '@/lib/data/estimates';

export function NewProjectDialog({ open, onOpenChange, companyId, onCreated }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string | null;
  onCreated: (projectId: string) => void;
}) {
  const customersQ = useQuery(loadCustomers, []);
  const customers = customersQ.status === 'ready' ? customersQ.data : [];
  const [name, setName] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [siteCity, setSiteCity] = useState('');
  const [siteState, setSiteState] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName(''); setCustomerId(''); setSiteAddress('');
    setSiteCity(''); setSiteState(''); setError(null);
  };

  const submit = async () => {
    if (!companyId) { setError('No company to open it in.'); return; }
    setSaving(true); setError(null);
    try {
      const id = await createProject(companyId, {
        name,
        customerId: customerId || null,
        siteAddress: siteAddress || null,
        siteCity: siteCity || null,
        siteState: siteState || null,
      });
      reset(); onCreated(id); onOpenChange(false);
    } catch (err) { setError(messageFor(err)); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardHat className="size-4" /> Open a project
          </DialogTitle>
          <DialogDescription>
            For work that arrived without a bid. It opens with no budget, because nothing
            has priced it.
          </DialogDescription>
        </DialogHeader>

        {error ? <Alert tone="danger" title="That did not save">{error}</Alert> : null}

        {/*
          * Said before they fill the form in, not after. Somebody who has an
          * estimate for this job wants the other path, and the other path gives
          * them a budget and every line as a budgeted activity.
          */}
        <Alert tone="info" title="Is there an estimate for this job?">
          <span className="block">
            Award it instead and the project arrives with its budget and every priced line
            already on it. This path leaves the budget at zero.
          </span>
          <Link to="/app/estimates"
            className="mt-1 inline-flex items-center gap-1 text-sm font-medium underline">
            Go to the estimates <ArrowRight className="size-3.5" />
          </Link>
        </Alert>

        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="proj-name">Project name</Label>
            <Input id="proj-name" value={name} autoFocus
              placeholder="Monroe Street storm repair"
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proj-customer">Customer</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger id="proj-customer">
                <SelectValue placeholder={customers.length ? 'Who is it for?' : 'No customers yet'} />
              </SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proj-address">Site address</Label>
            <Input id="proj-address" value={siteAddress}
              onChange={(e) => setSiteAddress(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="proj-city">Site city</Label>
              <Input id="proj-city" value={siteCity}
                onChange={(e) => setSiteCity(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proj-state">Site state</Label>
              <Input id="proj-state" value={siteState}
                onChange={(e) => setSiteState(e.target.value)} />
            </div>
          </div>
          {/*
            * The city earns its place: the forecast is fetched for the site
            * rather than the yard once a project has one, which is what makes a
            * weather day on the schedule the site's own weather.
            */}
          <p className="text-xs text-charcoal-500">
            With a site city the forecast is fetched for the job rather than for your yard.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!name.trim() || saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <HardHat className="size-4" />}
            Open it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
