/**
 * Recording a machine, and raising a work order against one.
 *
 * Workflow: both of the buttons the Fleet screen shipped with, neither of which
 * had a handler. With no assets the whole screen read zero — fleet size, hours
 * run, fuel, owned value — and every tab under it was empty, which looked like
 * a platform with nothing in it rather than a company that had not added its
 * machines yet.
 *
 * A name is the only thing required. Make, model, serial and acquisition cost
 * are what somebody copies off the machine later with the paperwork in front of
 * them; demanding them at the moment a truck arrives on site is how the machine
 * never gets recorded at all.
 */
import { useState } from 'react';
import { Loader2, Plus, Wrench } from 'lucide-react';
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
import { messageFor } from '@/lib/data/query';
import { createAsset, createWorkOrder } from '@/lib/data/fleet';

const OWNERSHIP = [
  ['owned', 'Owned'], ['leased', 'Leased'], ['rented', 'Rented'],
  ['subcontracted', 'Subcontracted'],
] as const;

const METER = [
  ['hours', 'Hours'], ['miles', 'Miles'], ['both', 'Hours and miles'], ['none', 'No meter'],
] as const;

const FUEL = [
  ['diesel', 'Diesel'], ['gasoline', 'Gasoline'], ['electric', 'Electric'],
  ['propane', 'Propane'], ['hybrid', 'Hybrid'], ['none', 'None'],
] as const;

export function AddAssetDialog({ open, onOpenChange, companyId, onAdded }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string | null;
  onAdded: () => void;
}) {
  const [name, setName] = useState('');
  const [assetClass, setAssetClass] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [modelYear, setModelYear] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [ownership, setOwnership] = useState('owned');
  const [meterType, setMeterType] = useState('hours');
  const [fuelType, setFuelType] = useState('diesel');
  const [acquisitionCost, setAcquisitionCost] = useState('');
  const [acquiredOn, setAcquiredOn] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName(''); setAssetClass(''); setMake(''); setModel(''); setModelYear('');
    setSerialNumber(''); setOwnership('owned'); setMeterType('hours');
    setFuelType('diesel'); setAcquisitionCost(''); setAcquiredOn(''); setError(null);
  };

  const submit = async () => {
    if (!companyId) { setError('No company to add it to.'); return; }
    setSaving(true); setError(null);
    try {
      await createAsset(companyId, {
        name,
        assetClass: assetClass || null,
        make: make || null,
        model: model || null,
        modelYear: modelYear === '' ? null : Number(modelYear),
        serialNumber: serialNumber || null,
        ownership, meterType,
        fuelType: fuelType || null,
        acquisitionCost: acquisitionCost === '' ? null : Number(acquisitionCost),
        acquiredOn: acquiredOn || null,
      });
      reset(); onAdded(); onOpenChange(false);
    } catch (err) { setError(messageFor(err)); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Plus className="size-4" /> Add a machine</DialogTitle>
          <DialogDescription>
            A name is enough. The rest can be copied off the machine when the paperwork
            is in front of you — it starts available and unassigned either way.
          </DialogDescription>
        </DialogHeader>

        {error ? <Alert tone="danger" title="That did not save">{error}</Alert> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="asset-name">Name</Label>
            <Input id="asset-name" value={name} autoFocus
              placeholder="EX-4412, Dozer 3, the yellow 320…"
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asset-class">Class</Label>
            <Input id="asset-class" value={assetClass} placeholder="Excavator, dozer, haul truck…"
              onChange={(e) => setAssetClass(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asset-make">Make</Label>
            <Input id="asset-make" value={make} onChange={(e) => setMake(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asset-model">Model</Label>
            <Input id="asset-model" value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asset-year">Year</Label>
            <Input id="asset-year" type="number" min="1950" max="2100" value={modelYear}
              onChange={(e) => setModelYear(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asset-serial">Serial number</Label>
            <Input id="asset-serial" value={serialNumber}
              onChange={(e) => setSerialNumber(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asset-own">Ownership</Label>
            <Select value={ownership} onValueChange={setOwnership}>
              <SelectTrigger id="asset-own"><SelectValue /></SelectTrigger>
              <SelectContent>
                {OWNERSHIP.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asset-meter">Meter</Label>
            <Select value={meterType} onValueChange={setMeterType}>
              <SelectTrigger id="asset-meter"><SelectValue /></SelectTrigger>
              <SelectContent>
                {METER.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asset-fuel">Fuel</Label>
            <Select value={fuelType} onValueChange={setFuelType}>
              <SelectTrigger id="asset-fuel"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FUEL.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asset-cost">Acquisition cost</Label>
            <Input id="asset-cost" type="number" step="0.01" min="0" value={acquisitionCost}
              onChange={(e) => setAcquisitionCost(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asset-acquired">Acquired</Label>
            <Input id="asset-acquired" type="date" value={acquiredOn}
              onChange={(e) => setAcquiredOn(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!name.trim() || saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add the machine
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const WO_TYPE = [
  ['corrective', 'Corrective — something is wrong'],
  ['preventive', 'Preventive — scheduled service'],
  ['inspection', 'Inspection'],
  ['safety', 'Safety'],
  ['warranty', 'Warranty'],
] as const;

const WO_PRIORITY = [
  ['low', 'Low'], ['normal', 'Normal'], ['high', 'High'], ['critical', 'Critical'],
] as const;

/**
 * Raise a work order.
 *
 * It takes the machine first because the company is read off it, and because a
 * work order with no machine is a note. With no assets recorded yet the dialog
 * says so rather than offering an empty select.
 */
export function AddWorkOrderDialog({ open, onOpenChange, assets, onAdded }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  assets: ReadonlyArray<{ id: string; assetNumber: string; name: string }>;
  onAdded: () => void;
}) {
  const [assetId, setAssetId] = useState('');
  const [title, setTitle] = useState('');
  const [workOrderType, setWorkOrderType] = useState('corrective');
  const [priority, setPriority] = useState('normal');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setAssetId(''); setTitle(''); setWorkOrderType('corrective');
    setPriority('normal'); setDescription(''); setError(null);
  };

  const submit = async () => {
    setSaving(true); setError(null);
    try {
      await createWorkOrder({ assetId, title, workOrderType, priority, description: description || null });
      reset(); onAdded(); onOpenChange(false);
    } catch (err) { setError(messageFor(err)); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wrench className="size-4" /> Raise a work order</DialogTitle>
          <DialogDescription>
            It opens with no costs on it. Labor, parts and outside cost are what the work
            turns out to have taken.
          </DialogDescription>
        </DialogHeader>

        {error ? <Alert tone="danger" title="That did not save">{error}</Alert> : null}

        {assets.length === 0 ? (
          <Alert tone="warn" title="No machines yet">
            A work order is raised against a machine. Add one first and this will have
            something to point at.
          </Alert>
        ) : (
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="wo-asset">Machine</Label>
              <Select value={assetId} onValueChange={setAssetId}>
                <SelectTrigger id="wo-asset"><SelectValue placeholder="Which machine?" /></SelectTrigger>
                <SelectContent>
                  {assets.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.assetNumber} — {a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wo-title">What is wrong</Label>
              <Input id="wo-title" value={title} placeholder="Hydraulic leak, left final drive"
                onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="wo-type">Kind</Label>
                <Select value={workOrderType} onValueChange={setWorkOrderType}>
                  <SelectTrigger id="wo-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WO_TYPE.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wo-priority">Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger id="wo-priority"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WO_PRIORITY.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wo-desc">Detail</Label>
              <Input id="wo-desc" value={description}
                onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!assetId || !title.trim() || saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />}
            Raise it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
