/**
 * Adding somebody who works here.
 *
 * Workflow: the first thing a company does after signing up, and until now the
 * one thing it could not do — the button existed and did nothing.
 *
 * Two fields are required and the rest are not, deliberately. A foreman being
 * added at seven in the morning so they can punch in needs a name; their hourly
 * rate, classification and hire date are payroll's problem and can be filled in
 * on the record afterwards. A form that demanded all of it would be a form
 * nobody completes at seven in the morning.
 *
 * "This is me" is the reason the dialog exists at all for an owner. The clock
 * matches a punch to a login through `employees.user_id`, so the person who
 * created the company cannot record a minute of their own time until a row
 * exists that points at them.
 */
import { useState } from 'react';
import { Loader2, UserPlus } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, Switch } from '@/components/ui/misc';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { messageFor } from '@/lib/data/query';
import { createEmployee } from '@/lib/data/workforce';

const EMPLOYMENT_TYPES = [
  ['full_time', 'Full time'],
  ['part_time', 'Part time'],
  ['seasonal', 'Seasonal'],
  ['temporary', 'Temporary'],
  ['subcontract', 'Subcontract'],
] as const;

export function AddEmployeeDialog({ open, onOpenChange, companyId, onAdded }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string | null;
  onAdded: () => void;
}) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [employmentType, setEmploymentType] = useState('full_time');
  const [classification, setClassification] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [hireDate, setHireDate] = useState('');
  const [linkMe, setLinkMe] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFirstName(''); setLastName(''); setEmail(''); setPhone('');
    setEmploymentType('full_time'); setClassification(''); setHourlyRate('');
    setHireDate(''); setLinkMe(false); setError(null);
  };

  const submit = async () => {
    if (!companyId) { setError('No company to add them to.'); return; }
    setSaving(true); setError(null);
    try {
      await createEmployee(companyId, {
        firstName, lastName,
        email: email || null,
        phone: phone || null,
        employmentType,
        classification: classification || null,
        hourlyRate: hourlyRate === '' ? null : Number(hourlyRate),
        hireDate: hireDate || null,
        linkMe,
      });
      reset();
      onAdded();
      onOpenChange(false);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setSaving(false);
    }
  };

  const ready = firstName.trim().length > 0 && lastName.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="size-4" /> Add someone to the crew
          </DialogTitle>
          <DialogDescription>
            A name is enough to start. Everything else can be filled in on their record.
          </DialogDescription>
        </DialogHeader>

        {error ? <Alert tone="danger" title="That did not save">{error}</Alert> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="emp-first">First name</Label>
            <Input id="emp-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emp-last">Last name</Label>
            <Input id="emp-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emp-email">Email</Label>
            <Input id="emp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emp-phone">Phone</Label>
            <Input id="emp-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emp-type">Employment</Label>
            <Select value={employmentType} onValueChange={setEmploymentType}>
              <SelectTrigger id="emp-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {EMPLOYMENT_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emp-class">Classification</Label>
            <Input id="emp-class" value={classification} placeholder="Operator, laborer, foreman…"
              onChange={(e) => setClassification(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emp-rate">Hourly rate</Label>
            <Input id="emp-rate" type="number" step="0.01" min="0" value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emp-hired">Hire date</Label>
            <Input id="emp-hired" type="date" value={hireDate}
              onChange={(e) => setHireDate(e.target.value)} />
          </div>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border border-charcoal-200 p-3">
          <div className="min-w-0">
            <Label htmlFor="emp-me" className="text-sm font-medium">This is me</Label>
            <p className="text-xs text-charcoal-500">
              Links this record to your login so you can clock in. Time is recorded against an
              employee, so without it your own hours have nowhere to go.
            </p>
          </div>
          <Switch id="emp-me" checked={linkMe} onCheckedChange={setLinkMe} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!ready || saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            Add them
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
