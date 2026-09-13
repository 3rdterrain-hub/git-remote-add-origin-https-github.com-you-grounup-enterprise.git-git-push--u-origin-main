/**
 * Adding a material, and adding a vendor.
 *
 * Library: the two rows a company most often needs that were not addable. The
 * data layer has carried `createMaterial` since the price-list import was
 * built, stamping `source = 'Added in the library screen'` — for a screen that
 * was never built — and `createVendor` beside it with no caller at all.
 *
 * Neither dialog asks for a code. Materials and vendors are unique on
 * (company_id, code), so two people adding at the same moment would collide on
 * the index; the database generates it, the same way every other numbered
 * record in this schema does.
 */
import { useState } from 'react';
import { Loader2, Package, Store } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { UnitSelect } from '@/components/ui/unit-select';
import { CategorySelect } from '@/components/ui/category-select';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { messageFor } from '@/lib/data/query';
import { createMaterialRow, createVendorRow } from '@/lib/data/library';

export function AddMaterialDialog({ open, onOpenChange, companyId, onAdded }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string | null;
  onAdded: () => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState('EA');
  const [unitCost, setUnitCost] = useState('');
  const [waste, setWaste] = useState('');
  const [wasteBasis, setWasteBasis] = useState('');
  const [specification, setSpecification] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName(''); setCategory(''); setUnit('EA'); setUnitCost('');
    setWaste(''); setWasteBasis(''); setSpecification(''); setError(null);
  };

  const wastePercent = waste === '' ? 0 : Number(waste);

  const submit = async () => {
    if (!companyId) { setError('No company to add it to.'); return; }
    setSaving(true); setError(null);
    try {
      await createMaterialRow(companyId, {
        name, unit,
        unitCost: unitCost === '' ? 0 : Number(unitCost),
        category: category || null,
        /* The database holds waste as a fraction; the box asks for a percent,
           because a percent is what a supplier's allowance is quoted in. */
        defaultWastePercent: wastePercent / 100,
        wasteBasis: wasteBasis || null,
        specification: specification || null,
      });
      reset(); onAdded(); onOpenChange(false);
    } catch (err) { setError(messageFor(err)); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="size-4" /> Add a material
          </DialogTitle>
          <DialogDescription>
            It goes into your company's own library, beside the shipped catalog. The code
            is generated so two people adding at once cannot collide.
          </DialogDescription>
        </DialogHeader>

        {error ? <Alert tone="danger" title="That did not save">{error}</Alert> : null}

        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="mat-name">Name</Label>
            <Input id="mat-name" value={name} autoFocus
              placeholder='6" PVC SDR-35'
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="mat-category">Category</Label>
              <CategorySelect kind="material_category" value={category}
                onChange={setCategory} id="mat-category" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mat-unit">Unit</Label>
              <UnitSelect value={unit} onChange={setUnit} id="mat-unit" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mat-cost">Unit cost</Label>
              <Input id="mat-cost" type="number" step="0.0001" min="0" value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="mat-waste">Waste %</Label>
              <Input id="mat-waste" type="number" step="0.1" min="0" max="100" value={waste}
                onChange={(e) => setWaste(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mat-basis">What the waste is based on</Label>
              <Input id="mat-basis" value={wasteBasis}
                placeholder="Company standard allowance"
                onChange={(e) => setWasteBasis(e.target.value)} />
            </div>
          </div>
          {/*
            * Said before the refusal arrives. The database will not take a waste
            * factor with no basis, because an allowance nobody can check is a
            * number nobody can defend.
            */}
          {wastePercent > 0 && !wasteBasis.trim() ? (
            <Alert tone="warn" title="A waste factor has to say what it is based on">
              Where does the allowance come from? A supplier's quote, a company standard,
              a spec. Without it this cannot be saved.
            </Alert>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="mat-spec">Specification</Label>
            <Input id="mat-spec" value={specification}
              placeholder="ASTM D3034"
              onChange={(e) => setSpecification(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit}
            disabled={!name.trim() || saving || (wastePercent > 0 && !wasteBasis.trim())}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Package className="size-4" />}
            Add it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const VENDOR_TYPE = [
  ['supplier', 'Supplier'],
  ['subcontractor', 'Subcontractor'],
  ['rental', 'Rental'],
  ['hauler', 'Hauler'],
  ['disposal', 'Disposal'],
  ['service', 'Service'],
] as const;

export function AddVendorDialog({ open, onOpenChange, companyId, onAdded }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string | null;
  onAdded: () => void;
}) {
  const [name, setName] = useState('');
  const [vendorType, setVendorType] = useState('supplier');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [stateProvince, setStateProvince] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName(''); setVendorType('supplier'); setContactName(''); setEmail('');
    setPhone(''); setCity(''); setStateProvince(''); setError(null);
  };

  const submit = async () => {
    if (!companyId) { setError('No company to add them to.'); return; }
    setSaving(true); setError(null);
    try {
      await createVendorRow(companyId, {
        name, vendorType,
        contactName: contactName || null,
        email: email || null,
        phone: phone || null,
        city: city || null,
        stateProvince: stateProvince || null,
      });
      reset(); onAdded(); onOpenChange(false);
    } catch (err) { setError(messageFor(err)); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Store className="size-4" /> Add a vendor
          </DialogTitle>
          <DialogDescription>
            They start unqualified. Whether a vendor is qualified is a decision about
            insurance, safety record and performance — not something a form asserts.
          </DialogDescription>
        </DialogHeader>

        {error ? <Alert tone="danger" title="That did not save">{error}</Alert> : null}

        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ven-name">Name</Label>
              <Input id="ven-name" value={name} autoFocus
                onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ven-type">Kind</Label>
              <Select value={vendorType} onValueChange={setVendorType}>
                <SelectTrigger id="ven-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VENDOR_TYPE.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="ven-contact">Contact</Label>
              <Input id="ven-contact" value={contactName}
                onChange={(e) => setContactName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ven-email">Email</Label>
              <Input id="ven-email" type="email" value={email}
                onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ven-phone">Phone</Label>
              <Input id="ven-phone" type="tel" value={phone}
                onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ven-city">City</Label>
              <Input id="ven-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ven-state">State</Label>
              <Input id="ven-state" value={stateProvince}
                onChange={(e) => setStateProvince(e.target.value)} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!name.trim() || saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Store className="size-4" />}
            Add them
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
