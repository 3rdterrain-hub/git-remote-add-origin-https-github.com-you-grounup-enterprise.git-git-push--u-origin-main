/**
 * A person, opened.
 *
 * `create_employee` (0161) was the whole write side. Somebody could be hired and
 * never corrected, never put on leave, and never ended — and `employees` refuses
 * a terminated record without a date, which nothing could supply. Migration 0187
 * added the rest, along with the first writer of `credentials` anywhere.
 *
 * The credentials half is the part that matters most. `enforce_assignment_
 * credentials` (0043) refuses to put somebody on declared work without a
 * mandatory ticket — the platform's only blocking safety control — and it had
 * never once fired, because nothing could record that a person holds anything.
 */
import { useState } from 'react';
import { Loader2, ShieldCheck, Trash2, Plus, UserMinus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { LoadingState, ErrorState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import {
  updateEmployee, endEmployment, recordCredential, revokeCredential,
  loadEmployeeCredentials, EMPLOYMENT_TYPES, EMPLOYEE_STATUSES, CREDENTIAL_TYPES,
  type EmployeeRow,
} from '@/lib/data/workforce';
import { date, plural } from '@/lib/format';

const field = 'h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm';

const STANDING_TONE: Record<string, 'success' | 'warn' | 'danger' | 'outline'> = {
  valid: 'success', expiring: 'warn', expired: 'danger', revoked: 'danger', pending: 'outline',
};

export function EmployeeDetail({ employee, canWrite, onChanged, onClose }: {
  employee: EmployeeRow;
  canWrite: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [nonce, setNonce] = useState(0);
  const credsQ = useQuery(loadEmployeeCredentials(employee.id), [employee.id, nonce]);
  const creds = credsQ.status === 'ready' ? credsQ.data : [];

  const [classification, setClassification] = useState(employee.classification ?? '');
  const [rate, setRate] = useState(String(employee.hourlyRate ?? ''));
  const [employmentType, setEmploymentType] = useState(employee.employmentType);

  const [adding, setAdding] = useState(false);
  const [credName, setCredName] = useState('');
  const [credType, setCredType] = useState('certification');
  const [issuedOn, setIssuedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [requiredFor, setRequiredFor] = useState('');

  const [ending, setEnding] = useState(false);
  const [endOn, setEndOn] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await work(); setNonce((n) => n + 1); onChanged(); }
    catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  };

  const lapsed = creds.filter((c) => c.status === 'expired' || c.status === 'revoked');

  return (
    <div className="space-y-5 border-t border-charcoal-200 bg-charcoal-50/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-xs font-medium uppercase tracking-wide text-charcoal-600">
          {employee.employeeNumber} · {employee.name}
        </h4>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>

      {error ? <p className="text-sm font-medium text-danger-700">{error}</p> : null}

      {/* Tickets */}
      <div className="space-y-2">
        <h5 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-charcoal-600">
          <ShieldCheck className="size-3.5" /> What they hold
        </h5>
        {credsQ.status === 'loading' ? <LoadingState label="Reading the tickets" /> : null}
        {credsQ.status === 'error'
          ? <ErrorState message={credsQ.message} onRetry={credsQ.refetch} /> : null}

        {creds.length === 0 ? (
          <p className="text-sm text-charcoal-500">
            Nothing recorded. A kind of work that requires a ticket will refuse to take them
            until one is here — which is the control working, not a fault.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {creds.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-charcoal-900">{c.name}</span>
                <Badge variant={STANDING_TONE[c.status] ?? 'outline'}>{c.status}</Badge>
                {c.expiresOn ? (
                  <span className="text-xs text-charcoal-500">
                    {c.daysRemaining !== null && c.daysRemaining < 0
                      ? `lapsed ${Math.abs(c.daysRemaining)} days ago`
                      : `expires ${date(c.expiresOn)}`}
                  </span>
                ) : <span className="text-xs text-charcoal-500">does not expire</span>}
                {c.requiredFor.length > 0 ? (
                  <span className="text-xs text-charcoal-500">
                    for {c.requiredFor.join(', ')}
                  </span>
                ) : null}
                {c.status !== 'revoked' ? (
                  <Button variant="ghost" size="sm" className="text-danger-700"
                    aria-label={`Revoke ${c.name}`} disabled={!canWrite || busy}
                    onClick={() => {
                      const why = window.prompt(`Why is ${c.name} being revoked?`);
                      if (why && why.trim().length >= 3) {
                        void run(() => revokeCredential(c.id, why));
                      }
                    }}>
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {lapsed.length > 0 ? (
          <p className="text-xs text-danger-700">
            {plural(lapsed.length, 'ticket')} lapsed or revoked. Standing is worked out from
            the date every time it is asked, so this is right now — not what it was when
            somebody last typed it in.
          </p>
        ) : null}

        {canWrite && adding ? (
          <div className="grid gap-3 rounded-md border border-charcoal-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1 lg:col-span-2">
              <Label htmlFor={`cn-${employee.id}`}>What the certificate says</Label>
              <Input id={`cn-${employee.id}`} value={credName} autoFocus
                placeholder="CDL Class A" onChange={(e) => setCredName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`ct-${employee.id}`}>Kind</Label>
              <select id={`ct-${employee.id}`} className={field} value={credType}
                onChange={(e) => setCredType(e.target.value)}>
                {CREDENTIAL_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`ci-${employee.id}`}>Issued</Label>
              <Input id={`ci-${employee.id}`} type="date" value={issuedOn}
                onChange={(e) => setIssuedOn(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`ce-${employee.id}`}>Expires</Label>
              <Input id={`ce-${employee.id}`} type="date" value={expiresOn}
                onChange={(e) => setExpiresOn(e.target.value)} />
            </div>
            <div className="space-y-1 lg:col-span-3">
              <Label htmlFor={`cr-${employee.id}`}>Work it is required for</Label>
              <Input id={`cr-${employee.id}`} value={requiredFor}
                placeholder="truck_driving, crane_operation"
                onChange={(e) => setRequiredFor(e.target.value)} />
            </div>
            <div className="flex items-end gap-2 lg:col-span-2">
              <Button size="sm" disabled={busy || !credName.trim()}
                onClick={() => run(async () => {
                  await recordCredential({
                    employeeId: employee.id,
                    name: credName,
                    type: credType,
                    issuedOn: issuedOn || null,
                    expiresOn: expiresOn || null,
                    requiredFor: requiredFor
                      .split(',').map((s) => s.trim()).filter(Boolean),
                  });
                  setCredName(''); setIssuedOn(''); setExpiresOn('');
                  setRequiredFor(''); setAdding(false);
                })}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null} Record it
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </div>
        ) : canWrite ? (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Record a ticket
          </Button>
        ) : null}
      </div>

      {/* The person */}
      <div className="space-y-2">
        <h5 className="text-xs font-medium uppercase tracking-wide text-charcoal-600">
          The record
        </h5>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor={`ec-${employee.id}`}>Classification</Label>
            <Input id={`ec-${employee.id}`} value={classification} disabled={!canWrite}
              onChange={(e) => setClassification(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`er-${employee.id}`}>Base rate</Label>
            <Input id={`er-${employee.id}`} type="number" value={rate} disabled={!canWrite}
              onChange={(e) => setRate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`et-${employee.id}`}>Employment</Label>
            <select id={`et-${employee.id}`} className={field} value={employmentType}
              disabled={!canWrite} onChange={(e) => setEmploymentType(e.target.value)}>
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`es-${employee.id}`}>Where they stand</Label>
            <select id={`es-${employee.id}`} className={field} value={employee.status}
              disabled={!canWrite || busy || employee.status === 'terminated'}
              onChange={(e) => run(() => updateEmployee({
                employeeId: employee.id, status: e.target.value,
              }))}>
              {EMPLOYEE_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
              {employee.status === 'terminated'
                ? <option value="terminated">No longer here</option> : null}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!canWrite || busy}
            onClick={() => run(() => updateEmployee({
              employeeId: employee.id,
              classification,
              hourlyRate: rate ? Number(rate) : null,
              employmentType,
            }))}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null} Save the record
          </Button>
          {employee.status !== 'terminated' && !ending ? (
            <Button size="sm" variant="ghost" className="text-danger-700"
              disabled={!canWrite} onClick={() => setEnding(true)}>
              <UserMinus className="size-4" /> End their employment
            </Button>
          ) : null}
        </div>

        {ending ? (
          <div className="space-y-2 rounded-md border border-danger-200 bg-danger-50/40 p-3">
            <p className="text-sm text-charcoal-700">
              The date is required — payroll and an access review cannot tell an active
              worker from a stale record without one. Assignments running past it end too,
              so nobody staffs a crew from somebody who has left.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor={`ed-${employee.id}`}>Last day</Label>
                <Input id={`ed-${employee.id}`} type="date" value={endOn}
                  onChange={(e) => setEndOn(e.target.value)} />
              </div>
              <Button size="sm" variant="ghost" className="text-danger-700"
                disabled={busy || !endOn}
                onClick={() => run(async () => {
                  await endEmployment(employee.id, endOn);
                  setEnding(false); onClose();
                })}>
                End it
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEnding(false)}>Cancel</Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
