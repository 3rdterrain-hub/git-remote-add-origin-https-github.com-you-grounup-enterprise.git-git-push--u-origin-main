/**
 * The order the work happens in, and making it yours.
 *
 * Fifty-four sequences ship with the platform — concrete, roofing, irrigation,
 * a bathroom rough-in, four kinds of drone mission. Until now none of them had
 * a screen: `customize_assembly`, `add_assembly_step`, `remove_assembly_step`
 * and `my_assembly_steps` all existed, were all tested, and nothing called
 * them. A working feature with no door.
 *
 * What the screen has to make obvious is whose sequence you are looking at,
 * because that decides whether you may change it. A platform sequence is the
 * same one every company reads; pressing **Make it ours** copies it, steps and
 * all, and the copy is what you edit. Nothing here writes to a platform row —
 * the database refuses that, and the screen says so before the refusal rather
 * than after.
 *
 * Reordering is arrows rather than drag. A sequence is ten steps read top to
 * bottom, and on a phone in a truck an arrow is a target and a drag is a
 * gamble. The database renumbers after every change, so a sequence never runs
 * 1, 2, 3, 5.
 */
import { useState } from 'react';
import {
  ArrowDown, ArrowUp, Check, ChevronRight, Copy, Loader2, Plus, Search, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import {
  loadAssemblyTemplates, loadAssemblySteps, searchTasks,
  customizeAssembly, addAssemblyStep, removeAssemblyStep, moveAssemblyStep,
  type AssemblyTemplate,
} from '@/lib/data/assemblies';
import { qty } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The steps of one sequence, and every control that changes them. */
function Steps({ assembly, editable, onChanged }: {
  assembly: AssemblyTemplate; editable: boolean; onChanged: () => void;
}) {
  const steps = useQuery(loadAssemblySteps(assembly.id), [assembly.id]);
  const [adding, setAdding] = useState(false);
  const [term, setTerm] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const matches = useQuery(searchTasks(adding ? term : ''), [adding, term]);
  const found = matches.status === 'ready' ? matches.data : [];

  if (steps.status === 'loading') return <LoadingState label="Reading the sequence" />;
  if (steps.status === 'error') {
    return <ErrorState message={steps.message} onRetry={steps.refetch} />;
  }
  if (steps.status === 'demonstration') return null;

  const rows = steps.data;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError(null);
    try { await fn(); steps.refetch(); onChanged(); }
    catch (err) { setError(messageFor(err)); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>The step</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              {editable ? <TableHead className="w-28" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s, i) => (
              <TableRow key={s.stepId}>
                <TableCell className="tabular text-charcoal-400">{s.step}</TableCell>
                <TableCell className="font-medium text-charcoal-900">
                  {s.taskName ?? 'Untitled step'}
                  {s.isOptional ? (
                    <Badge variant="default" className="ml-2">optional</Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-charcoal-600">{s.taskCategory ?? '—'}</TableCell>
                <TableCell className="tabular text-right text-charcoal-600">
                  {/*
                    * Most steps have no rate, and that is honest — nobody has
                    * measured "flashing and details". A dash is the truth; a
                    * zero would read as instantaneous.
                    */}
                  {s.ratePerHour
                    ? `${qty(s.ratePerHour, 2)} ${s.taskUnit ?? ''}/hr`
                    : <span className="text-charcoal-400">—</span>}
                </TableCell>
                {editable ? (
                  <TableCell className="text-right">
                    <span className="flex justify-end gap-0.5">
                      <button
                        onClick={() => void run(s.stepId, () => moveAssemblyStep(s.stepId, s.step - 1))}
                        disabled={i === 0 || busy !== null}
                        aria-label={`Move ${s.taskName} up`}
                        className="rounded p-1 text-charcoal-400 hover:bg-charcoal-100
                                   hover:text-charcoal-900 disabled:opacity-40">
                        <ArrowUp className="size-3.5" />
                      </button>
                      <button
                        onClick={() => void run(s.stepId, () => moveAssemblyStep(s.stepId, s.step + 1))}
                        disabled={i === rows.length - 1 || busy !== null}
                        aria-label={`Move ${s.taskName} down`}
                        className="rounded p-1 text-charcoal-400 hover:bg-charcoal-100
                                   hover:text-charcoal-900 disabled:opacity-40">
                        <ArrowDown className="size-3.5" />
                      </button>
                      <button
                        onClick={() => void run(s.stepId, () => removeAssemblyStep(s.stepId))}
                        disabled={busy !== null}
                        aria-label={`Remove ${s.taskName}`}
                        className="rounded p-1 text-charcoal-400 hover:bg-danger-50
                                   hover:text-danger-700">
                        {busy === s.stepId
                          ? <Loader2 className="size-3.5 animate-spin" />
                          : <Trash2 className="size-3.5" />}
                      </button>
                    </span>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-charcoal-500">
          No steps yet. Add the first one and the rest follow it.
        </p>
      ) : null}

      {editable ? (
        adding ? (
          <div className="relative">
            <Input
              autoFocus
              value={term}
              placeholder="Type a step — layout, place concrete, pressure test"
              aria-label="Find a step to add"
              className="h-8"
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setAdding(false); setTerm(''); } }} />
            {found.length > 0 ? (
              <div role="listbox" aria-label="Matching steps"
                className="absolute left-0 right-0 top-9 z-30 max-h-52 overflow-y-auto rounded-md
                           border border-charcoal-200 bg-white shadow-lg">
                {found.map((t) => (
                  <button key={t.id} type="button" role="option" aria-selected={false}
                    onClick={() => {
                      void run('add', async () => {
                        await addAssemblyStep(assembly.id, t.id);
                        setAdding(false); setTerm('');
                      });
                    }}
                    className="flex w-full items-center justify-between gap-3 border-b
                               border-charcoal-100 px-3 py-1.5 text-left last:border-0
                               hover:bg-charcoal-50">
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-charcoal-900">{t.name}</span>
                      <span className="block text-xs text-charcoal-500">
                        {t.code}{t.category ? ` · ${t.category}` : ''}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            <p className="mt-1 text-xs text-charcoal-500">
              It lands at the end; move it with the arrows. Escape closes this.
            </p>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add a step
          </Button>
        )
      ) : null}

      {error ? <p role="alert" className="text-sm font-medium text-danger-700">{error}</p> : null}
    </div>
  );
}

export function AssemblyLibrary({ companyId, canEdit }: {
  companyId: string | null; canEdit: boolean;
}) {
  const templates = useQuery(loadAssemblyTemplates, [companyId]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [term, setTerm] = useState('');

  if (templates.status === 'loading') return <LoadingState label="Reading the sequences" />;
  if (templates.status === 'error') {
    return <ErrorState message={templates.message} onRetry={templates.refetch} />;
  }
  if (templates.status === 'demonstration') {
    return <EmptyState title="Connect a workspace to see your work sequences" />;
  }

  const needle = term.trim().toLowerCase();
  const shown = needle
    ? templates.data.filter((t) =>
      t.name.toLowerCase().includes(needle) || (t.trade ?? '').toLowerCase().includes(needle))
    : templates.data;

  const mine = async (t: AssemblyTemplate) => {
    if (!companyId) return;
    setBusy(t.id); setError(null);
    try {
      const copy = await customizeAssembly(t.id, companyId);
      templates.refetch();
      setOpen(copy);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card collapseKey="assembly-library-intro">
        <CardHeader>
          <CardTitle>The order the work happens in</CardTitle>
          <CardDescription>
            Fifty-four sequences ship with the platform — what a concrete pour is made of, what
            a roof tear-off is made of, what an irrigation run is made of. They are the same for
            every company, so nobody can change one. Press <strong>Make it ours</strong> and you
            get your own copy, steps and all, and that one is yours to add to, remove from and
            reorder.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Search className="size-4 text-charcoal-400" />
            <Input
              value={term}
              placeholder="Find a sequence — concrete, roofing, irrigation"
              aria-label="Find a work sequence"
              className="h-8 max-w-sm"
              onChange={(e) => setTerm(e.target.value)} />
            <span className="text-sm text-charcoal-500">
              {shown.length} of {templates.data.length}
            </span>
          </div>
        </CardContent>
      </Card>

      {error ? <ErrorState message={error} /> : null}

      {shown.length === 0 ? (
        <EmptyState title="No sequence matches that" hint="Try the trade rather than the name." />
      ) : null}

      {shown.map((t) => {
        const expanded = open === t.id;
        const editable = canEdit && !t.isPlatform;
        return (
          <Card key={t.id} collapsible={false}>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : t.id)}
                aria-expanded={expanded}
                className="flex min-w-0 flex-1 items-start gap-2 text-left">
                <ChevronRight className={cn('mt-0.5 size-4 shrink-0 text-charcoal-400 transition-transform',
                  expanded && 'rotate-90')} />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-charcoal-900">{t.name}</span>
                    {t.isPlatform
                      ? <Badge variant="default">ships with GrounUp</Badge>
                      : <Badge variant="info">yours</Badge>}
                    {t.customizedAs
                      ? <Badge variant="success">you have a copy</Badge> : null}
                  </span>
                  <span className="block text-sm text-charcoal-500">
                    {t.trade ?? 'General'} · {t.steps} step{t.steps === 1 ? '' : 's'}
                  </span>
                </span>
              </button>

              {canEdit && t.isPlatform && !t.customizedAs ? (
                <Button variant="outline" size="sm" disabled={busy !== null}
                  onClick={() => void mine(t)}>
                  {busy === t.id ? <Loader2 className="size-4 animate-spin" />
                                 : <Copy className="size-4" />}
                  Make it ours
                </Button>
              ) : null}
              {t.customizedAs ? (
                <Button variant="ghost" size="sm" onClick={() => setOpen(t.customizedAs)}>
                  <Check className="size-4" /> Open your copy
                </Button>
              ) : null}
            </CardHeader>

            {expanded ? (
              <CardContent>
                {t.isPlatform ? (
                  <p className="mb-3 text-xs text-charcoal-500">
                    This is the sequence GrounUp ships and every company reads. Make your own copy
                    to change it — yours will not affect anybody else, and this one will keep
                    working exactly as it does now.
                  </p>
                ) : null}
                <Steps assembly={t} editable={editable} onChanged={templates.refetch} />
              </CardContent>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
