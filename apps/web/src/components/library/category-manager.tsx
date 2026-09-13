/**
 * Library — the category lists, and the four things you can do to one.
 *
 * Migration 0113 made categories records and gave a person one verb: add. You
 * could put a name on a list and then you were finished with it — no rename, no
 * removal, and no way to see what was filed underneath. The catalog this build
 * shipped with is what that costs: `COMPACTION` beside `Compactors`, `Misc`
 * beside `Other`, forty-two material categories where the source file had
 * twenty-five. Tidying it took a migration, which means it took an engineer.
 *
 * Four decisions about the shape, each one a thing the user has said:
 *
 *   * **The count opens.** "Compaction (5)" is a question, so it is a button.
 *     A figure you cannot open sends somebody hunting through the library for
 *     the five rows it is talking about.
 *   * **A name is edited where it is shown.** Click it and type. Nothing here
 *     is read-only, because nothing here has a reason to be.
 *   * **Removing one asks where its items go**, and will not proceed without an
 *     answer. That is the database's rule, not this screen's — but the screen
 *     has to ask the question rather than discover the refusal.
 *   * **The lists come from the database.** A tenth categorized column appears
 *     as a tab here on the day it is added, because `app.categorized_columns()`
 *     is the one list and this reads it rather than repeating it.
 *
 * A category the platform ships is shown and cannot be changed: it is the
 * shared vocabulary every company reads, and one tenant renaming a word in it
 * would rename it for all of them. Add your own instead — they sit alongside.
 */
import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/misc';
import { ErrorState, LoadingState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import { plural } from '@/lib/format';
import {
  loadCategoryKinds, loadCategories, loadCategoryUsage, loadCategoryMembers,
  addCategory, renameCategory, deleteCategory,
  type CategoryKind, type CategoryOption,
} from '@/lib/data/categories';
import { cn } from '@/lib/utils';

/** A category on the list, with what is filed under it. */
interface Row extends CategoryOption { inUse: number; mine: number }

export function CategoryManager({ companyId, canEdit, only }: {
  companyId: string | null;
  /** `libraries.write`. Without it the lists are readable and nothing else. */
  canEdit: boolean;
  /**
   * Show one list rather than all of them.
   *
   * This began as its own tab, which put "Categories" in a row that otherwise
   * names things a company buys and hires — and made somebody wanting to tidy
   * the material categories leave the materials to do it. Pinned to a kind, the
   * same control sits under the library it governs, which is where the question
   * is asked.
   */
  only?: CategoryKind;
}) {
  const kinds = useQuery(loadCategoryKinds, []);
  const [kind, setKind] = useState<CategoryKind | null>(null);

  if (kinds.status === 'error') return <ErrorState message={kinds.message} onRetry={kinds.refetch} />;
  if (kinds.status === 'loading') return <LoadingState label="Loading the category lists" />;
  if (kinds.status === 'demonstration') {
    return (
      <Alert tone="info" title="Categories are live data">
        Connect a workspace to manage the lists your libraries group by.
      </Alert>
    );
  }

  /* One tab per list. `lead_source` governs two tables and is one list, so the
     tabs are the distinct kinds rather than the rows. */
  const tabs = kinds.data.filter(
    (k, i, all) => all.findIndex((o) => o.kind === k.kind) === i)
    .filter((k) => !only || k.kind === only);
  const active = only ?? kind ?? tabs[0]?.kind ?? null;
  /* Pinned to a kind this schema does not have: say nothing rather than draw an
     empty card, because the tab around it is about something else. */
  if (!active || (only && tabs.length === 0)) return null;
  const label = tabs.find((t) => t.kind === active)?.label ?? 'Categories';

  return (
    <Card>
      <CardHeader>
        <CardTitle>{only ? label : 'Categories'}</CardTitle>
        <CardDescription>
          {only
            ? 'How this library is grouped. Rename one and everything filed under it moves with the name; remove one and you say where its items go.'
            : 'The lists your libraries group by. Rename one and everything filed under it moves with the name; remove one and you say where its items go.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className={cn('flex flex-wrap gap-1.5', only && 'hidden')}
          role="tablist" aria-label="Category lists">
          {tabs.map((t) => (
            <button
              key={t.kind}
              type="button"
              role="tab"
              aria-selected={t.kind === active}
              onClick={() => setKind(t.kind)}
              className={cn(
                'rounded-md border px-2.5 py-1 text-sm',
                t.kind === active
                  ? 'border-charcoal-900 bg-charcoal-900 text-white'
                  : 'border-charcoal-200 text-charcoal-700 hover:border-charcoal-400')}
            >
              {t.label}
            </button>
          ))}
        </div>

        <CategoryList key={active} kind={active} companyId={companyId} canEdit={canEdit} />
      </CardContent>
    </Card>
  );
}

function CategoryList({ kind, companyId, canEdit }: {
  kind: CategoryKind; companyId: string | null; canEdit: boolean;
}) {
  const [nonce, setNonce] = useState(0);
  const list = useQuery(loadCategories(kind), [kind, nonce]);
  const usage = useQuery(loadCategoryUsage(kind, companyId), [kind, companyId, nonce]);

  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = () => setNonce((n) => n + 1);

  const rows: Row[] = useMemo(() => {
    if (list.status !== 'ready') return [];
    const counts = usage.status === 'ready' ? usage.data : [];
    const found = (name: string) =>
      counts.find((c) => c.name.toLowerCase() === name.toLowerCase());
    return list.data.map((c) => ({
      ...c,
      inUse: found(c.name)?.inUse ?? 0,
      mine: found(c.name)?.mine ?? 0,
    }));
  }, [list, usage]);

  /*
   * A category carrying rows that is not on the list — somebody's data from
   * before 0113, or a name retired while rows still pointed at it. Shown rather
   * than hidden: it is the only place a person would ever find out.
   */
  const orphans = useMemo(() => {
    if (usage.status !== 'ready' || list.status !== 'ready') return [];
    const known = new Set(list.data.map((c) => c.name.toLowerCase()));
    return usage.data.filter((u) => !known.has(u.name.toLowerCase()));
  }, [usage, list]);

  if (list.status === 'error') return <ErrorState message={list.message} onRetry={list.refetch} />;
  if (list.status !== 'ready') return <LoadingState label="Loading the list" />;

  async function run(what: () => Promise<string | null>) {
    setBusy(true); setError(null); setNote(null);
    try {
      const said = await what();
      if (said) setNote(said);
      refresh();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  const add = () => run(async () => {
    if (!supabase) return null;
    const name = draft.trim();
    if (!name) return null;
    await addCategory(supabase, { kind, name, companyId });
    setDraft(''); setAdding(false);
    return `Added ${name}.`;
  });

  const rename = (from: string, to: string) => run(async () => {
    if (!supabase || !to.trim() || to.trim() === from) { setEditing(null); return null; }
    const moved = await renameCategory(supabase, { kind, from, to, companyId });
    setEditing(null);
    return `${from} is now ${to.trim()}${moved > 0 ? `, and ${plural(moved, 'item')} moved with it` : ''}.`;
  });

  const remove = (name: string, moveTo: string) => run(async () => {
    if (!supabase || !moveTo) return null;
    const moved = await deleteCategory(supabase, { kind, name, moveTo, companyId });
    setRemoving(null);
    return moved > 0
      ? `Removed ${name}; ${plural(moved, 'item')} moved to ${moveTo}.`
      : `Removed ${name}. It had nothing in it.`;
  });

  return (
    <div className="space-y-2">
      {error ? <Alert tone="danger" title="That did not go through">{error}</Alert> : null}
      {note ? <Alert tone="success" title="Done">{note}</Alert> : null}
      {usage.status === 'error' ? (
        <Alert tone="warn" title="Counts are unavailable">
          The list is correct; what is filed under each could not be counted. {usage.message}
        </Alert>
      ) : null}

      <ul className="divide-y divide-charcoal-100 rounded-md border border-charcoal-200">
        {rows.map((row) => (
          <li key={row.id} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOpen(open === row.name ? null : row.name)}
                aria-expanded={open === row.name}
                aria-label={`What is filed under ${row.name}`}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                {open === row.name
                  ? <ChevronDown className="size-4 shrink-0 text-charcoal-400" />
                  : <ChevronRight className="size-4 shrink-0 text-charcoal-400" />}
                {editing === row.name ? null : (
                  <span className="truncate text-sm text-charcoal-900">{row.name}</span>
                )}
                {editing === row.name ? null : (
                  <Badge variant={row.inUse > 0 ? 'default' : 'outline'}>
                    {row.inUse}
                  </Badge>
                )}
                {!row.isOwn && editing !== row.name ? (
                  <Badge variant="outline" className="text-charcoal-500">Shipped</Badge>
                ) : null}
              </button>

              {editing === row.name ? (
                <RenameBox
                  initial={row.name}
                  busy={busy}
                  onCancel={() => setEditing(null)}
                  onSave={(to) => void rename(row.name, to)}
                />
              ) : (
                <div className="flex shrink-0 items-center gap-1">
                  {canEdit && row.isOwn ? (
                    <>
                      <button type="button" aria-label={`Rename ${row.name}`}
                        onClick={() => setEditing(row.name)}
                        className="rounded-md border border-charcoal-200 p-1.5 text-charcoal-600 hover:border-charcoal-400">
                        <Pencil className="size-3.5" />
                      </button>
                      <button type="button" aria-label={`Remove ${row.name}`}
                        onClick={() => { setRemoving(row.name); setOpen(row.name); }}
                        className="rounded-md border border-charcoal-200 p-1.5 text-charcoal-600 hover:border-danger-400 hover:text-danger-700">
                        <Trash2 className="size-3.5" />
                      </button>
                    </>
                  ) : null}
                </div>
              )}
            </div>

            {removing === row.name ? (
              <RemoveBox
                name={row.name}
                mine={row.mine}
                choices={rows.filter((r) => r.name !== row.name)}
                busy={busy}
                onCancel={() => setRemoving(null)}
                onConfirm={(moveTo) => void remove(row.name, moveTo)}
              />
            ) : null}

            {open === row.name ? (
              <Members kind={kind} name={row.name} companyId={companyId} />
            ) : null}
          </li>
        ))}

        {orphans.map((o) => (
          <li key={`orphan-${o.name}`} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="flex-1 truncate text-sm text-charcoal-900">{o.name}</span>
              <Badge variant="default">{o.inUse}</Badge>
              <Badge variant="warn">
                Not on the list
              </Badge>
            </div>
            <p className="mt-1 text-xs text-charcoal-500">
              Rows carry this name but nothing offers it. Add it to the list to keep it,
              or change those rows to a category that is offered.
            </p>
          </li>
        ))}
      </ul>

      {rows.length === 0 && orphans.length === 0 ? (
        <p className="text-sm text-charcoal-500">This list is empty.</p>
      ) : null}

      {canEdit ? (
        adding ? (
          <div className="flex items-center gap-1.5">
            <Input
              value={draft}
              autoFocus
              disabled={busy}
              aria-label="New category name"
              placeholder="New category name"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void add(); }
                if (e.key === 'Escape') { setAdding(false); setDraft(''); }
              }}
              className="h-8 max-w-xs"
            />
            <Button size="sm" onClick={() => void add()} disabled={busy || !draft.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setDraft(''); }}>
              <X className="size-4" />
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="mr-1.5 size-4" /> Add a category
          </Button>
        )
      ) : null}
    </div>
  );
}

function RenameBox({ initial, busy, onSave, onCancel }: {
  initial: string; busy: boolean; onSave: (to: string) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="flex flex-1 items-center gap-1.5">
      <Input
        value={value}
        autoFocus
        disabled={busy}
        aria-label={`New name for ${initial}`}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onSave(value); }
          if (e.key === 'Escape') onCancel();
        }}
        className="h-8"
      />
      <Button size="sm" onClick={() => onSave(value)} disabled={busy || !value.trim()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel} aria-label="Cancel the rename">
        <X className="size-4" />
      </Button>
    </div>
  );
}

/**
 * Removing one, which is the same screen as merging two.
 *
 * The destination is a required choice and there is no way to press the button
 * without making it. The database refuses a removal with nowhere to put the
 * items; this asks the question rather than letting somebody find that out.
 */
function RemoveBox({ name, mine, choices, busy, onConfirm, onCancel }: {
  name: string; mine: number; choices: Array<{ name: string }>;
  busy: boolean; onConfirm: (moveTo: string) => void; onCancel: () => void;
}) {
  const [moveTo, setMoveTo] = useState('');
  return (
    <div className="mt-2 rounded-md border border-charcoal-200 bg-charcoal-50 p-3">
      <p className="text-sm text-charcoal-800">
        {mine > 0
          ? <>Move the {plural(mine, 'item')} in <strong>{name}</strong> to:</>
          : <><strong>{name}</strong> has nothing of yours in it. File anything that arrives under:</>}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <select
          value={moveTo}
          aria-label={`Where the items in ${name} go`}
          onChange={(e) => setMoveTo(e.target.value)}
          className="h-8 rounded-md border border-charcoal-200 bg-white px-2 text-sm focus:border-yellow-500 focus:outline-none"
        >
          <option value="">Choose a category…</option>
          {choices.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        <Button size="sm" variant="destructive" disabled={busy || !moveTo}
          onClick={() => onConfirm(moveTo)}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          Remove and move
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

/** What is filed under one category, across every table its kind governs. */
function Members({ kind, name, companyId }: {
  kind: CategoryKind; name: string; companyId: string | null;
}) {
  const members = useQuery(loadCategoryMembers(kind, name, companyId), [kind, name, companyId]);

  if (members.status === 'error') {
    return <p className="mt-2 pl-6 text-xs text-danger-700">{members.message}</p>;
  }
  if (members.status !== 'ready') {
    return <p className="mt-2 pl-6 text-xs text-charcoal-500">Loading…</p>;
  }
  if (members.data.length === 0) {
    return <p className="mt-2 pl-6 text-xs text-charcoal-500">Nothing is filed under this.</p>;
  }

  return (
    <ul className="mt-2 space-y-0.5 pl-6">
      {members.data.map((m) => (
        <li key={`${m.sourceTable}-${m.id}`} className="flex items-center gap-2 text-xs">
          <span className="truncate text-charcoal-700">{m.label}</span>
          {!m.isMine ? <span className="text-charcoal-400">shipped</span> : null}
        </li>
      ))}
    </ul>
  );
}
