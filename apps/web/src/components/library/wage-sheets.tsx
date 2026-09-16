/**
 * The wage sheets a bid is priced from. LIBRARY.
 *
 * One dated sheet per document a person actually holds: a union agreement zone,
 * a prevailing wage determination, a company scale. Each carries its own list of
 * classes, and an estimate points at one.
 *
 * Three things this screen is careful to say rather than imply:
 *
 *   * **Open shop is the default and needs none of this.** Most contractors
 *     never open the tab, and their bids are priced by the rates their crews
 *     already name.
 *   * **Approved is not the same as in force.** A sheet dated for next May is
 *     approved today and prices nothing until May, and the badge says which.
 *   * **A wage is yours to correct.** The shipped seed is an open-shop baseline,
 *     not your scale. Every figure on a sheet is editable where it is shown.
 */
import { useState } from 'react';
import {
  Loader2, Plus, CalendarPlus, Check, Scale, TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, EmptyState } from '@/components/ui/misc';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { LoadingState, ErrorState } from '@/components/data-state';
import { messageFor, useQuery } from '@/lib/data/query';
import {
  loadWageSheets, loadWageRates, createWageSheet, approveWageSheet, addWageRate,
  setWageRate, scheduleWageIncrease, WAGE_BASES, CONSTRUCTION_TYPES,
  type WageSheet,
} from '@/lib/data/wages';
import { money, percent, date, titleCase, plural } from '@/lib/format';

const field = 'h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm';
const today = () => new Date().toISOString().slice(0, 10);

export function WageSheets({ companyId, canWrite }: {
  companyId: string | null;
  canWrite: boolean;
}) {
  const [nonce, setNonce] = useState(0);
  const sheetsQ = useQuery(loadWageSheets, [nonce]);
  const sheets = sheetsQ.status === 'ready' ? sheetsQ.data : [];
  const [chosen, setChosen] = useState<string | null>(null);
  const sheet = sheets.find((s) => s.id === chosen) ?? sheets[0] ?? null;
  const ratesQ = useQuery(loadWageRates(sheet?.id ?? ''), [sheet?.id, nonce]);
  const rates = ratesQ.status === 'ready' ? ratesQ.data : [];

  const [adding, setAdding] = useState(false);
  const [stepping, setStepping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const again = () => setNonce((n) => n + 1);
  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await fn(); again(); }
    catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Alert tone="info" icon={<Scale className="size-4" />} title="Open shop needs none of this">
        A sheet is for work priced off somebody else&rsquo;s scale &mdash; a union agreement or a
        prevailing wage determination. If you pay your own rates, change them on the Labor tab and
        leave this empty; estimates that name no sheet are priced by the rates their crews already
        carry.
      </Alert>

      {error ? <Alert tone="danger" title="That did not happen">{error}</Alert> : null}

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Sheets</CardTitle>
              <CardDescription>One per document you hold.</CardDescription>
            </div>
            <NewSheet companyId={companyId} canWrite={canWrite}
              onCreated={(id) => { setChosen(id); again(); }} />
          </CardHeader>
          <CardContent className="p-0">
            {sheetsQ.status === 'loading' ? <LoadingState label="Reading the sheets" /> : null}
            {sheetsQ.status === 'error'
              ? <ErrorState message={sheetsQ.message} onRetry={sheetsQ.refetch} /> : null}
            {sheetsQ.status === 'ready' && sheets.length === 0 ? (
              <div className="p-6">
                <EmptyState title="No wage sheets"
                  description="Record the agreement or determination you are bidding under, then put its classes on it." />
              </div>
            ) : null}
            <ul className="divide-y divide-charcoal-100">
              {sheets.map((s) => (
                <li key={s.id}>
                  <button type="button"
                    className={`w-full px-4 py-3 text-left hover:bg-charcoal-50 ${
                      sheet?.id === s.id ? 'bg-yellow-50' : ''}`}
                    onClick={() => setChosen(s.id)}>
                    <span className="flex items-center gap-2">
                      <span className="font-medium text-charcoal-900">{s.name}</span>
                      <SheetState sheet={s} />
                    </span>
                    <span className="mt-0.5 block text-xs text-charcoal-500">{s.scopeSays}</span>
                    <span className="mt-0.5 block text-xs text-charcoal-400">
                      from {date(s.effectiveDate)} · {plural(s.rateCount, 'class')}
                      {s.estimatesUsing ? ` · ${plural(s.estimatesUsing, 'estimate')}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="text-base">
                {sheet ? sheet.name : 'No sheet selected'}
              </CardTitle>
              <CardDescription>
                {sheet
                  ? 'Base, fringe and burden held apart, because a determination is argued line by line.'
                  : 'Choose a sheet to see the classes on it.'}
              </CardDescription>
            </div>
            {sheet ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={!canWrite}
                  onClick={() => setAdding((v) => !v)}>
                  <Plus className="size-4" /> Add a class
                </Button>
                {sheet.rateCount > 0 ? (
                  <Button variant="outline" size="sm" disabled={!canWrite}
                    title="Copy this sheet forward with its scheduled increase applied"
                    onClick={() => setStepping((v) => !v)}>
                    <CalendarPlus className="size-4" /> Schedule a raise
                  </Button>
                ) : null}
                {sheet.status === 'draft' ? (
                  <Button size="sm" disabled={!canWrite || busy}
                    title="Approve it so an estimate can price from it"
                    onClick={() => { void run(() => approveWageSheet(sheet.id)); }}>
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                    Approve
                  </Button>
                ) : null}
              </div>
            ) : null}
          </CardHeader>

          <CardContent className="space-y-3 p-0">
            {adding && sheet ? (
              <AddClass sheetId={sheet.id} busy={busy}
                onAdd={(r) => run(() => addWageRate(sheet.id, r)).then(() => setAdding(false))} />
            ) : null}

            {stepping && sheet ? (
              <ScheduleRaise sheet={sheet} busy={busy}
                onSchedule={(step) => run(() => scheduleWageIncrease(sheet.id, step))
                  .then(() => setStepping(false))} />
            ) : null}

            {ratesQ.status === 'loading' ? <LoadingState label="Reading the classes" /> : null}
            {sheet && ratesQ.status === 'ready' && rates.length === 0 ? (
              <div className="p-6">
                <EmptyState title="No classes on this sheet"
                  description="Add the classes you actually use. A sheet with nothing on it refuses every crew that points at it, which is why it cannot be approved empty." />
              </div>
            ) : null}

            {rates.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Trade</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead className="text-right">Base</TableHead>
                    <TableHead className="text-right">Fringe</TableHead>
                    <TableHead className="text-right">Burden</TableHead>
                    <TableHead className="text-right">Loaded</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rates.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium text-charcoal-900">{r.trade}</TableCell>
                      <TableCell className="text-charcoal-700">
                        {r.classLabel}
                        {r.followsAJourneyman ? (
                          <Badge variant="info" className="ml-1.5 text-[10px]"
                            title={`${percent(r.percentOfJourneyman ?? 0, 0)} of ${r.journeymanClassification ?? 'journeyman'} — it moves when journeyman moves`}>
                            {percent(r.percentOfJourneyman ?? 0, 0)} of journeyman
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        <EditableMoney value={r.baseWagePerHour} canWrite={canWrite && !r.followsAJourneyman}
                          title={r.followsAJourneyman
                            ? 'Follows its journeyman — change that one instead'
                            : 'The wage you actually get paid'}
                          onSave={(v) => run(() => setWageRate(r.id, { baseWage: v }))} />
                      </TableCell>
                      <TableCell className="tabular text-right">
                        <EditableMoney value={r.fringePerHour} canWrite={canWrite}
                          title="Fringe in dollars an hour, paid on hours worked"
                          onSave={(v) => run(() => setWageRate(r.id, { fringePerHour: v }))} />
                        {r.fringeIsTaxable ? (
                          <span className="block text-[10px] text-charcoal-400">cash in lieu</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="tabular text-right text-charcoal-600">
                        {percent(r.burdenPercent, 1)}
                      </TableCell>
                      <TableCell className="tabular text-right font-medium text-charcoal-900">
                        {money(r.loadedPerHour)}
                        <span className="text-charcoal-400"> / hr</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Approved, in force, or dated ahead — three different things. */
function SheetState({ sheet }: { sheet: WageSheet }) {
  if (sheet.status === 'draft') return <Badge variant="outline">Draft</Badge>;
  if (sheet.startsLater) {
    return (
      <Badge variant="info" title={`Approved, and prices nothing until ${date(sheet.effectiveDate)}`}>
        <TrendingUp className="size-3" /> from {date(sheet.effectiveDate)}
      </Badge>
    );
  }
  if (sheet.inForceToday) return <Badge variant="success">In force</Badge>;
  return <Badge variant="outline">Expired</Badge>;
}

function EditableMoney({ value, canWrite, title, onSave }: {
  value: number; canWrite: boolean; title: string;
  onSave: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  if (!canWrite) return <span title={title}>{money(value)}</span>;
  return editing ? (
    <Input type="number" value={text} autoFocus className="h-8 text-right"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const next = Number(text);
        if (Number.isFinite(next) && next !== value) onSave(next);
      }} />
  ) : (
    <button type="button" className="hover:underline" title={title}
      onClick={() => { setEditing(true); setText(String(value)); }}>
      {money(value)}
    </button>
  );
}

function NewSheet({ companyId, canWrite, onCreated }: {
  companyId: string | null; canWrite: boolean; onCreated: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [basis, setBasis] = useState<string>('union');
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [unionName, setUnionName] = useState('');
  const [localNumber, setLocalNumber] = useState('');
  const [district, setDistrict] = useState('');
  const [determination, setDetermination] = useState('');
  const [county, setCounty] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [constructionType, setConstructionType] = useState<string>('heavy');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={!canWrite}>
        <Plus className="size-4" /> New sheet
      </Button>
    );
  }

  return (
    <div className="w-full space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3">
      <div className="space-y-1">
        <Label htmlFor="ws-basis">What kind</Label>
        <select id="ws-basis" className={field} value={basis}
          onChange={(e) => setBasis(e.target.value)}>
          {WAGE_BASES.map((b) => (
            <option key={b.value} value={b.value}>{b.label} — {b.says}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="ws-name">Name it</Label>
        <Input id="ws-name" value={name} autoFocus
          placeholder={basis === 'union' ? 'IUOE Local 18 — Toledo' : 'Lucas County heavy'}
          onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="ws-eff">In force from</Label>
        <Input id="ws-eff" type="date" value={effectiveDate}
          onChange={(e) => setEffectiveDate(e.target.value)} />
      </div>

      {basis === 'union' ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="ws-union">Union</Label>
            <Input id="ws-union" value={unionName} placeholder="Operating Engineers"
              onChange={(e) => setUnionName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ws-local">Local</Label>
            <Input id="ws-local" value={localNumber} placeholder="18"
              onChange={(e) => setLocalNumber(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ws-district">District</Label>
            <Input id="ws-district" value={district} placeholder="Toledo"
              onChange={(e) => setDistrict(e.target.value)} />
          </div>
        </div>
      ) : null}

      {basis === 'prevailing_wage' ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ws-det">Determination</Label>
              <Input id="ws-det" value={determination} placeholder="OH20260012"
                onChange={(e) => setDetermination(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ws-type">Construction type</Label>
              <select id="ws-type" className={field} value={constructionType}
                onChange={(e) => setConstructionType(e.target.value)}>
                {CONSTRUCTION_TYPES.map((t) => (
                  <option key={t} value={t}>{titleCase(t)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ws-county">County</Label>
              <Input id="ws-county" value={county} placeholder="Lucas"
                onChange={(e) => setCounty(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ws-state">State</Label>
              <Input id="ws-state" value={stateCode} placeholder="OH"
                onChange={(e) => setStateCode(e.target.value)} />
            </div>
          </div>
          <Alert tone="info" title="Construction type is not a formality">
            Heavy, highway, building and residential pay differently for the same trade in the same
            county. Bidding site work off the building decision is the mistake this asks to prevent.
          </Alert>
        </>
      ) : null}

      {error ? <Alert tone="danger" title="That sheet was not created">{error}</Alert> : null}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" disabled={busy || !companyId || name.trim() === ''}
          onClick={() => {
            if (!companyId) return;
            setBusy(true); setError(null);
            createWageSheet(companyId, {
              name, basis, effectiveDate,
              unionName, localNumber, district,
              determinationNumber: determination, county, stateCode,
              constructionType: basis === 'prevailing_wage' ? constructionType : null,
            })
              .then((id) => { setName(''); setOpen(false); onCreated(id); })
              .catch((e: unknown) => setError(messageFor(e)))
              .finally(() => setBusy(false));
          }}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Create it
        </Button>
      </div>
    </div>
  );
}

function AddClass({ sheetId, busy, onAdd }: {
  sheetId: string; busy: boolean;
  onAdd: (r: { trade: string; classLabel: string; baseWage: number;
    fringePerHour: number; burdenPercent: number; fringeIsTaxable: boolean }) => void;
}) {
  const [trade, setTrade] = useState('');
  const [classLabel, setClassLabel] = useState('');
  const [base, setBase] = useState('');
  const [fringe, setFringe] = useState('');
  const [burden, setBurden] = useState('');
  const [cash, setCash] = useState(false);

  return (
    <div className="mx-6 grid gap-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3 sm:grid-cols-6">
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`wr-trade-${sheetId}`}>Trade</Label>
        <Input id={`wr-trade-${sheetId}`} value={trade} autoFocus placeholder="Operating Engineer"
          onChange={(e) => setTrade(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`wr-class-${sheetId}`}>Class</Label>
        <Input id={`wr-class-${sheetId}`} value={classLabel} placeholder="Class 2"
          onChange={(e) => setClassLabel(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`wr-base-${sheetId}`}>Base / hr</Label>
        <Input id={`wr-base-${sheetId}`} type="number" value={base} placeholder="0"
          onChange={(e) => setBase(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`wr-fringe-${sheetId}`}>Fringe / hr</Label>
        <Input id={`wr-fringe-${sheetId}`} type="number" value={fringe} placeholder="0"
          onChange={(e) => setFringe(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`wr-burden-${sheetId}`}>Burden</Label>
        <Input id={`wr-burden-${sheetId}`} type="number" value={burden} placeholder="0.22"
          onChange={(e) => setBurden(e.target.value)} />
      </div>
      <label className="flex items-center gap-2 text-sm text-charcoal-700 sm:col-span-3">
        <input type="checkbox" checked={cash} onChange={(e) => setCash(e.target.checked)} />
        Fringe paid as cash in lieu — it becomes wages and carries burden
      </label>
      <div className="flex justify-end sm:col-span-3">
        <Button size="sm" disabled={busy || !trade.trim() || !classLabel.trim()}
          onClick={() => onAdd({
            trade, classLabel, baseWage: Number(base || 0),
            fringePerHour: Number(fringe || 0), burdenPercent: Number(burden || 0),
            fringeIsTaxable: cash,
          })}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Add it
        </Button>
      </div>
    </div>
  );
}

/**
 * The raise you enter once.
 *
 * An agreement carries its steps years ahead, and everybody bids at today's rate
 * anyway because remembering three Mays from now is nobody's job.
 */
function ScheduleRaise({ sheet, busy, onSchedule }: {
  sheet: WageSheet; busy: boolean;
  onSchedule: (s: { effectiveDate: string; wageIncrease: number;
    fringeIncrease: number; wagePercent: number }) => void;
}) {
  const [effectiveDate, setEffectiveDate] = useState('');
  const [wage, setWage] = useState('');
  const [fringe, setFringe] = useState('');
  const [pct, setPct] = useState('');

  return (
    <div className="mx-6 space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="ws-step-date">Takes effect</Label>
          <Input id="ws-step-date" type="date" value={effectiveDate} autoFocus
            onChange={(e) => setEffectiveDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ws-step-wage">On the wage</Label>
          <Input id="ws-step-wage" type="number" value={wage} placeholder="1.25"
            onChange={(e) => setWage(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ws-step-fringe">On the fringe</Label>
          <Input id="ws-step-fringe" type="number" value={fringe} placeholder="0.45"
            onChange={(e) => setFringe(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ws-step-pct">Or a percentage</Label>
          <Input id="ws-step-pct" type="number" value={pct} placeholder="0.03"
            onChange={(e) => setPct(e.target.value)} />
        </div>
      </div>
      <Alert tone="info" title="Every class comes forward">
        A copy of <strong>{sheet.name}</strong> with the increase applied to all
        {' '}{plural(sheet.rateCount, 'class')}, dated. Apprentices are recomputed from the new
        journeyman rather than raised twice, and this sheet stops the day the new one starts.
        Bids for work after that date price at the stepped rate on their own.
      </Alert>
      <div className="flex justify-end">
        <Button size="sm" disabled={busy || effectiveDate === ''}
          onClick={() => onSchedule({
            effectiveDate,
            wageIncrease: Number(wage || 0),
            fringeIncrease: Number(fringe || 0),
            wagePercent: Number(pct || 0),
          })}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <CalendarPlus className="size-4" />}
          Book the raise
        </Button>
      </div>
    </div>
  );
}
