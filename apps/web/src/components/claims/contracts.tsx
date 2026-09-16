/**
 * The contracts the claims are argued under. WORKFLOW.
 *
 * `contracts` has existed since migration 0023 with no writer, and it is not a
 * filing cabinet: `notice_days` and `claim_days` are stored as numbers of days
 * precisely so a deadline can be computed, and `app.derive_claim_deadlines`
 * dates every claim's notice and claim deadlines off them.
 *
 * So the column that matters most on this list is the one that says whether the
 * clause is on file at all. A contract with no notice period recorded is not a
 * contract with no notice period — it is one where nothing will ever warn
 * anybody, and the claim is lost quietly.
 */
import { useState } from 'react';
import { Loader2, FileSignature, Plus, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, EmptyState } from '@/components/ui/misc';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { LoadingState, ErrorState } from '@/components/data-state';
import { messageFor, useQuery } from '@/lib/data/query';
import { listProjects } from '@/lib/data/projects';
import {
  loadContracts, createContract, updateContract, CONTRACT_TYPES,
} from '@/lib/data/claims';
import { money, date, titleCase, plural } from '@/lib/format';

const field = 'h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm';

export function Contracts({ canWrite, onChanged }: {
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [shown, setShown] = useState(false);
  const [nonce, setNonce] = useState(0);
  const contractsQ = useQuery(loadContracts, [nonce, shown]);
  const projectsQ = useQuery(listProjects, [shown]);
  const contracts = contractsQ.status === 'ready' ? contractsQ.data : [];
  const projects = projectsQ.status === 'ready' ? projectsQ.data : [];

  const [adding, setAdding] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [contractType, setContractType] = useState<string>('lump_sum');
  const [value, setValue] = useState('');
  const [executedOn, setExecutedOn] = useState('');
  const [noticeDays, setNoticeDays] = useState('');
  const [claimDays, setClaimDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editNotice, setEditNotice] = useState('');

  const again = () => { setNonce((n) => n + 1); onChanged(); };
  const project = projectId || projects[0]?.id || '';

  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await fn(); again(); }
    catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <button type="button" className="flex items-center gap-2"
              onClick={() => setShown((v) => !v)}
              title={shown ? 'Collapse the contracts' : 'Show the contracts'}>
              {shown ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              <FileSignature className="size-4" /> Contracts
              {contracts.length ? (
                <span className="text-sm font-normal text-charcoal-500">
                  ({contracts.length})
                </span>
              ) : null}
            </button>
          </CardTitle>
          <CardDescription>
            The clauses a claim is argued under, held as days rather than as prose so a deadline
            can actually be computed.
          </CardDescription>
        </div>
        {shown ? (
          <Button variant="outline" size="sm" disabled={!canWrite}
            onClick={() => setAdding((v) => !v)}
            title={canWrite ? undefined : 'Needs permission to record a contract'}>
            <Plus className="size-4" /> Record a contract
          </Button>
        ) : null}
      </CardHeader>

      {shown ? (
        <CardContent className="space-y-3 p-0">
          {adding ? (
            <div className="mx-6 grid gap-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3 sm:grid-cols-3 lg:grid-cols-4">
              <div className="space-y-1">
                <Label htmlFor="ct-project">Project</Label>
                <select id="ct-project" className={field} value={project}
                  onChange={(e) => setProjectId(e.target.value)}>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.number} — {p.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="ct-title">Title</Label>
                <Input id="ct-title" value={title} autoFocus placeholder="Airport apron, phase 2"
                  onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ct-type">Type</Label>
                <select id="ct-type" className={field} value={contractType}
                  onChange={(e) => setContractType(e.target.value)}>
                  {CONTRACT_TYPES.map((t) => (
                    <option key={t} value={t}>{titleCase(t)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ct-value">Original value</Label>
                <Input id="ct-value" type="number" value={value} placeholder="0"
                  onChange={(e) => setValue(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ct-exec">Executed</Label>
                <Input id="ct-exec" type="date" value={executedOn}
                  onChange={(e) => setExecutedOn(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ct-notice">Notice, in days</Label>
                <Input id="ct-notice" type="number" value={noticeDays} placeholder="7"
                  onChange={(e) => setNoticeDays(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ct-claim">Full claim, in days</Label>
                <Input id="ct-claim" type="number" value={claimDays} placeholder="21"
                  onChange={(e) => setClaimDays(e.target.value)} />
              </div>
              <div className="sm:col-span-3 lg:col-span-4">
                <Alert tone="info" title="Why the clauses are asked for as numbers">
                  A deadline that cannot be computed is a deadline nobody is warned about. Put the
                  notice period here and every claim under this contract gets its date without
                  anybody typing one.
                </Alert>
              </div>
              <div className="flex justify-end gap-2 sm:col-span-3 lg:col-span-4">
                <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
                <Button size="sm" disabled={busy || !project || !title.trim()}
                  onClick={() => {
                    void run(async () => {
                      await createContract(project, {
                        title,
                        contractType,
                        originalValue: Number(value || 0),
                        executedOn: executedOn || null,
                        noticeDays: noticeDays === '' ? null : Number(noticeDays),
                        claimDays: claimDays === '' ? null : Number(claimDays),
                      });
                      setTitle(''); setValue(''); setNoticeDays(''); setClaimDays('');
                      setAdding(false);
                    });
                  }}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null} Record it
                </Button>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="px-6"><Alert tone="danger" title="That did not happen">{error}</Alert></div>
          ) : null}

          {contractsQ.status === 'loading' ? <LoadingState label="Reading the contracts" /> : null}
          {contractsQ.status === 'error'
            ? <ErrorState message={contractsQ.message} onRetry={contractsQ.refetch} /> : null}
          {contractsQ.status === 'ready' && contracts.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No contracts recorded"
                description="A claim can be opened without one — it simply gets no computed deadline. Record the contract and its notice clause, and every claim under it is dated for you." />
            </div>
          ) : null}

          {contracts.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contract</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Executed</TableHead>
                  <TableHead>Notice clause</TableHead>
                  <TableHead className="text-right">Claims</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <span className="font-mono text-xs text-charcoal-500">{c.number}</span>
                      <span className="block font-medium text-charcoal-900">{c.title}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-charcoal-600">
                      {c.projectNumber}
                    </TableCell>
                    <TableCell className="text-charcoal-600">{titleCase(c.contractType)}</TableCell>
                    <TableCell className="tabular text-right">{money(c.originalValue)}</TableCell>
                    <TableCell className="whitespace-nowrap text-charcoal-600">
                      {c.executedOn ? date(c.executedOn) : <Badge variant="outline">Draft</Badge>}
                    </TableCell>
                    <TableCell>
                      {/*
                        * Editable where it is shown. Somebody reads the notice
                        * provision a week after signing, and the deadline for
                        * every claim under it follows from this one number.
                        */}
                      {editing === c.id ? (
                        <Input type="number" value={editNotice} autoFocus className="h-8 w-20"
                          onChange={(e) => setEditNotice(e.target.value)}
                          onBlur={() => {
                            const next = Number(editNotice);
                            setEditing(null);
                            if (Number.isFinite(next) && next >= 0 && next !== c.noticeDays) {
                              void run(() => updateContract(c.id, { noticeDays: next }));
                            }
                          }} />
                      ) : (
                        <button type="button" disabled={!canWrite}
                          className="text-left hover:underline disabled:no-underline"
                          title={canWrite ? 'Set the notice period from the contract' : undefined}
                          onClick={() => {
                            setEditing(c.id);
                            setEditNotice(c.noticeDays === null ? '' : String(c.noticeDays));
                          }}>
                          {c.noticeClauseOnFile ? (
                            <span className="text-charcoal-800">
                              {plural(c.noticeDays ?? 0, 'day')}
                              {c.claimDays ? (
                                <span className="text-charcoal-400">
                                  {' '}· {plural(c.claimDays, 'day')} to claim
                                </span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="text-warn-700">
                              Not on file — nothing will warn you
                            </span>
                          )}
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">
                      {c.claimCount}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}
