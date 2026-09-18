/**
 * Build a crew.
 *
 * Not one function in this repository touched `crews` or `crew_members` before
 * migration 0187. The catalog ships forty-two crews and a company could neither
 * make its own nor change one — while a crew is what the estimator prices labor
 * with, what `schedule_activities.crew_id` points at, and what gets booked onto
 * an activity for the field app to read.
 *
 * A crew is a priced *shape*: two operators, a foreman, three laborers. Which
 * particular people fill it on a given Tuesday is a resource assignment, a
 * different question with a different answer every week — conflating the two is
 * how a library row starts changing whenever somebody takes a day off.
 */
import { Fragment, useState } from 'react';
import { Loader2, Plus, Trash2, Users2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ArchiveAction } from '@/components/library/archive-action';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/misc';
import { LoadingState, ErrorState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import {
  loadCrewLibrary, loadCrewMembers, createCrew, updateCrew, setCrewMember,
  removeCrewMember, loadLaborRates, type CrewRow,
} from '@/lib/data/library';
import { money, qty } from '@/lib/format';

const field = 'h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm';

function CrewMembers({ crew, canWrite, onChanged }: {
  crew: CrewRow; canWrite: boolean; onChanged: () => void;
}) {
  const [nonce, setNonce] = useState(0);
  const membersQ = useQuery(loadCrewMembers(crew.id), [crew.id, nonce]);
  const ratesQ = useQuery(loadLaborRates, []);
  const members = membersQ.status === 'ready' ? membersQ.data : [];
  const rates = ratesQ.status === 'ready' ? ratesQ.data : [];

  const [rateId, setRateId] = useState('');
  const [headcount, setHeadcount] = useState('1');
  const [crewName, setCrewName] = useState(crew.name);
  const [crewShift, setCrewShift] = useState(String(crew.shiftHours));
  const [crewDiscipline, setCrewDiscipline] = useState(crew.discipline ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await work(); setNonce((n) => n + 1); onChanged(); }
    catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  };

  const editable = canWrite && crew.isOwn;

  return (
    <div className="space-y-3 border-t border-charcoal-200 bg-charcoal-50/70 p-4">
      {!crew.isOwn ? (
        <p className="text-sm text-charcoal-600">
          This is one of the crews GrounUp ships, and it is the same one every company reads.
          Build your own to change it — the shipped ones are a starting point, not yours.
        </p>
      ) : null}

      {membersQ.status === 'loading' ? <LoadingState label="Reading the crew" /> : null}
      {membersQ.status === 'error'
        ? <ErrorState message={membersQ.message} onRetry={membersQ.refetch} /> : null}

      {members.length === 0 ? (
        <p className="text-sm text-charcoal-500">
          Nobody on it yet, so it prices at nothing. A crew with no classifications is a name.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-charcoal-900">
                {m.headcount} × {m.classification}
              </span>
              <span className="text-charcoal-600">
                {money(m.burdenedCostPerHour)}/hr burdened
              </span>
              <Badge variant="outline">{m.rateScope}</Badge>
              <span className="tabular text-charcoal-700">{money(m.costPerHour)}/hr</span>
              {editable ? (
                <Button variant="ghost" size="sm" className="text-danger-700"
                  aria-label={`Take ${m.classification} off`} disabled={busy}
                  onClick={() => run(() => removeCrewMember(m.id))}>
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {error ? <p className="text-sm font-medium text-danger-700">{error}</p> : null}

      {editable ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor={`cm-${crew.id}`}>Classification</Label>
            <select id={`cm-${crew.id}`} className={`${field} w-64`} value={rateId}
              onChange={(e) => setRateId(e.target.value)}>
              <option value="">Choose a labor rate…</option>
              {rates.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.classification} — {money(r.burdenedCostPerHour)}/hr
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`ch-${crew.id}`}>How many</Label>
            <Input id={`ch-${crew.id}`} type="number" min={1} className="w-24"
              value={headcount} onChange={(e) => setHeadcount(e.target.value)} />
          </div>
          <Button size="sm" variant="outline" disabled={busy || !rateId}
            onClick={() => run(async () => {
              await setCrewMember({
                crewId: crew.id, laborRateId: rateId,
                headcount: Number(headcount) || 1,
              });
              setRateId(''); setHeadcount('1');
            })}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Put them on
          </Button>
        </div>
      ) : null}

      {editable ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-charcoal-200 pt-3">
          <div className="space-y-1">
            <Label htmlFor={`cn-${crew.id}`}>What it is called</Label>
            <Input id={`cn-${crew.id}`} className="w-64" value={crewName}
              onChange={(e) => setCrewName(e.target.value)} />
          </div>
          <div className="space-y-1">
            {/* Set once at creation and never editable after — the owner's
                "what is crew discipline doing? It needs to be doing
                something." `update_crew` has taken it since 0187. */}
            <Label htmlFor={`cd-${crew.id}`}>Discipline</Label>
            <Input id={`cd-${crew.id}`} className="w-40" value={crewDiscipline}
              placeholder="Earthwork"
              onChange={(e) => setCrewDiscipline(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`cs-${crew.id}`}>Hours in a shift</Label>
            <Input id={`cs-${crew.id}`} type="number" min={1} max={24} className="w-28"
              value={crewShift} onChange={(e) => setCrewShift(e.target.value)} />
          </div>
          <Button size="sm" variant="outline" disabled={busy
            || (crewName === crew.name && Number(crewShift) === crew.shiftHours
              && crewDiscipline === (crew.discipline ?? ''))}
            onClick={() => run(() => updateCrew({
              crewId: crew.id, name: crewName, shiftHours: Number(crewShift) || null,
              discipline: crewDiscipline.trim() || null,
            }))}>
            Save the crew
          </Button>
        </div>
      ) : null}

      <p className="text-xs text-charcoal-500">
        Adding a classification already on the crew changes its headcount rather than
        putting it on twice. The rate shown is the rate that prices — RULE-003 — and where
        it came from is on the badge.
      </p>
    </div>
  );
}

export function CrewBuilder({ companyId, canWrite, showArchived = false }: {
  companyId: string | null; canWrite: boolean; showArchived?: boolean;
}) {
  const [nonce, setNonce] = useState(0);
  const crewsQ = useQuery(loadCrewLibrary(showArchived), [nonce, showArchived]);
  const crews = crewsQ.status === 'ready' ? crewsQ.data : [];

  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [shift, setShift] = useState('8');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => setNonce((n) => n + 1);

  const add = async () => {
    if (!companyId || busy) return;
    setBusy(true); setError(null);
    try {
      await createCrew(companyId, {
        name, discipline, shiftHours: Number(shift) || 8,
      });
      setName(''); setDiscipline(''); setShift('8'); setAdding(false);
      refresh();
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {crewsQ.status === 'loading' ? <LoadingState label="Reading the crews" /> : null}
      {crewsQ.status === 'error'
        ? <ErrorState message={crewsQ.message} onRetry={crewsQ.refetch} /> : null}

      {error ? <p className="text-sm font-medium text-danger-700">{error}</p> : null}

      {canWrite && adding ? (
        <div className="grid gap-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3 sm:grid-cols-4">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="crew-name">What the crew is called</Label>
            <Input id="crew-name" value={name} autoFocus placeholder="Haul crew"
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="crew-disc">Discipline</Label>
            <Input id="crew-disc" value={discipline} placeholder="earthwork"
              onChange={(e) => setDiscipline(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="crew-shift">Hours in a shift</Label>
            <Input id="crew-shift" type="number" min={1} max={24} value={shift}
              onChange={(e) => setShift(e.target.value)} />
          </div>
          <div className="flex items-end gap-2 sm:col-span-2">
            <Button size="sm" onClick={() => void add()} disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Build it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      ) : canWrite ? (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Users2 className="size-4" /> Build a crew
        </Button>
      ) : null}

      {crewsQ.status === 'ready' && crews.length === 0 ? (
        <EmptyState title="No crews"
          description="A crew is what an estimate prices labor with and what a schedule books onto an activity." />
      ) : null}

      {crews.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Crew</TableHead>
              <TableHead>Discipline</TableHead>
              <TableHead className="text-right">On it</TableHead>
              <TableHead className="text-right">Shift</TableHead>
              <TableHead className="text-right">Cost an hour</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {crews.map((c) => (
              <Fragment key={c.id}>
                <TableRow className={open === c.id ? 'bg-charcoal-50' : undefined}>
                  <TableCell>
                    <button type="button" aria-expanded={open === c.id}
                      onClick={() => setOpen(open === c.id ? null : c.id)}
                      className="text-left font-medium text-charcoal-900 hover:underline">
                      {c.name}
                    </button>
                    <p className="font-mono text-xs text-charcoal-400">
                      {c.code}{c.isOwn ? '' : ' · shipped'}
                    </p>
                  </TableCell>
                  <TableCell className="text-charcoal-600">{c.discipline ?? '—'}</TableCell>
                  <TableCell className="tabular text-right">{c.headcount}</TableCell>
                  <TableCell className="tabular text-right text-charcoal-600">
                    {qty(c.shiftHours, 0)} h
                  </TableCell>
                  <TableCell className="tabular text-right font-medium">
                    {/* Null, not zero: a crew nobody has built does not work for nothing. */}
                    {c.costPerHour === null
                      ? <span className="text-xs font-normal text-charcoal-400">not built up</span>
                      : money(c.costPerHour)}
                  </TableCell>
                  <TableCell className="text-right">
                    <ArchiveAction kind="crew" id={c.id} name={c.name}
                      status={c.status} editable={c.isOwn} canWrite={canWrite}
                      onChanged={refresh} />
                  </TableCell>
                </TableRow>
                {open === c.id ? (
                  <TableRow>
                    <TableCell colSpan={6} className="p-0">
                      <CrewMembers crew={c} canWrite={canWrite} onChanged={refresh} />
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}
