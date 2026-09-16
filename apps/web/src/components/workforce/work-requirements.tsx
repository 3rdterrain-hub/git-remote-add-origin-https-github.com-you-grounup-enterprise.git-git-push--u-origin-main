/**
 * What a kind of work requires.
 *
 * This is the screen that turns on the platform's only blocking safety control.
 * `app.enforce_assignment_credentials` (0043) refuses to put somebody on
 * declared work when a mandatory ticket is missing, expired, revoked or not yet
 * issued — its own comment calls it "the platform's first blocking safety
 * control" — and it reads `work_credential_requirements`, which had no writer.
 * No company could state a requirement, so the trigger had never once fired.
 *
 * The count of people who hold each one is the point. A company that marks a
 * credential mandatory and then sees that one person holds it has learned
 * something about next week that no individual record tells them.
 */
import { useState } from 'react';
import { ShieldAlert, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/misc';
import { LoadingState, ErrorState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import {
  loadWorkRequirements, setWorkRequirement, removeWorkRequirement, CREDENTIAL_TYPES,
} from '@/lib/data/workforce';
import { plural } from '@/lib/format';

const field = 'h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm';

export function WorkRequirements({ companyId, canWrite }: {
  companyId: string | null;
  canWrite: boolean;
}) {
  const [nonce, setNonce] = useState(0);
  const reqsQ = useQuery(loadWorkRequirements, [nonce]);
  const reqs = reqsQ.status === 'ready' ? reqsQ.data : [];

  const [adding, setAdding] = useState(false);
  const [workType, setWorkType] = useState('');
  const [credential, setCredential] = useState('');
  const [credentialType, setCredentialType] = useState('license');
  const [mandatory, setMandatory] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unstaffable = reqs.filter((r) => r.isMandatory && r.peopleWhoHoldIt === 0);

  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await work(); setNonce((n) => n + 1); }
    catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="size-4" /> What the work requires
        </CardTitle>
        <CardDescription>
          A mandatory ticket stops somebody being assigned to that work until they hold a
          valid one. A recommended ticket is recorded and warned about but does not block,
          because a control that blocks on everything is a control somebody turns off.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {reqsQ.status === 'loading' ? <LoadingState label="Reading the requirements" /> : null}
        {reqsQ.status === 'error'
          ? <ErrorState message={reqsQ.message} onRetry={reqsQ.refetch} /> : null}

        {reqsQ.status === 'ready' && reqs.length === 0 ? (
          <EmptyState title="No work has a credential requirement yet"
            description="Until one is here, nothing stops somebody being put on work they are not ticketed for. Say what a kind of work needs and the platform refuses the assignment." />
        ) : null}

        {unstaffable.length > 0 ? (
          <p className="text-sm text-danger-700">
            {plural(unstaffable.length, 'mandatory requirement')} that nobody currently holds:{' '}
            {unstaffable.map((r) => `${r.credentialName} for ${r.workType}`).join('; ')}.
            Assignments to that work will be refused until somebody is ticketed.
          </p>
        ) : null}

        {reqs.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>The work</TableHead>
                <TableHead>What it requires</TableHead>
                <TableHead>Blocks?</TableHead>
                <TableHead className="text-right">Who holds it</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {reqs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs text-charcoal-600">
                    {r.workType}
                  </TableCell>
                  <TableCell className="font-medium text-charcoal-900">
                    {r.credentialName}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.isMandatory ? 'danger' : 'outline'}>
                      {r.isMandatory ? 'Blocks the assignment' : 'Warns only'}
                    </Badge>
                  </TableCell>
                  <TableCell className={`tabular text-right ${
                    r.isMandatory && r.peopleWhoHoldIt === 0 ? 'font-semibold text-danger-700' : ''
                  }`}>
                    {r.peopleWhoHoldIt}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" className="text-danger-700"
                      aria-label={`Stop requiring ${r.credentialName}`}
                      disabled={!canWrite || busy}
                      onClick={() => run(() => removeWorkRequirement(r.id))}>
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}

        {error ? <p className="text-sm font-medium text-danger-700">{error}</p> : null}

        {canWrite && adding ? (
          <div className="grid gap-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="req-work">The kind of work</Label>
              <Input id="req-work" value={workType} autoFocus placeholder="truck driving"
                onChange={(e) => setWorkType(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="req-cred">What it requires</Label>
              <Input id="req-cred" value={credential} placeholder="CDL Class A"
                onChange={(e) => setCredential(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="req-type">Kind of ticket</Label>
              <select id="req-type" className={field} value={credentialType}
                onChange={(e) => setCredentialType(e.target.value)}>
                {CREDENTIAL_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="req-mand">Does it block?</Label>
              <select id="req-mand" className={field} value={mandatory ? 'yes' : 'no'}
                onChange={(e) => setMandatory(e.target.value === 'yes')}>
                <option value="yes">Yes — refuse the assignment</option>
                <option value="no">No — warn only</option>
              </select>
            </div>
            <div className="flex items-end gap-2 sm:col-span-2">
              <Button size="sm" disabled={busy || !companyId || !workType.trim() || !credential.trim()}
                onClick={() => run(async () => {
                  await setWorkRequirement(companyId!, {
                    workType, credentialName: credential,
                    credentialType, mandatory,
                  });
                  setWorkType(''); setCredential(''); setAdding(false);
                })}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null} Require it
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
            <p className="text-xs text-charcoal-500 sm:col-span-2 lg:col-span-4">
              The kind of work is stored in lower case with underscores, and matched against
              what a credential says it is for — so &ldquo;truck driving&rdquo; becomes
              <code className="mx-1">truck_driving</code>, which is how the control finds it.
            </p>
          </div>
        ) : canWrite ? (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Require a ticket for a kind of work
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
