/**
 * The conversation about one record, on that record.
 *
 * Crew and office needed a way to say something to each other, and this is it —
 * comments rather than an inbox, mounted on the thing being discussed. A
 * general inbox becomes a second chat app nobody checks, and the conversation
 * ends up detached from the job it was about.
 *
 * Three things it is careful about.
 *
 * **Withdrawn is not gone.** A retracted comment keeps its place and says it was
 * withdrawn, with the reason. A record somebody is claiming against should not
 * quietly lose a sentence that was once on it.
 *
 * **Editing shows.** A comment changed after somebody relied on it says so on
 * its face, because the alternative is a record that silently disagrees with
 * what a person remembers reading.
 *
 * **A mention is a person, not a string.** Naming somebody picks them from the
 * company and sends them a notification down the path notifications already
 * take — there is no second delivery system beside it.
 */
import { useMemo, useState } from 'react';
import { MessageSquare, Loader2, Pencil, Undo2, AtSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import {
  loadComments, loadMentionable, loadMyUserId, postComment, editComment, retractComment,
  type CommentSubject, type RecordComment,
} from '@/lib/data/comments';
import { cn } from '@/lib/utils';

/** "3 minutes ago" reads better than a timestamp on a conversation. */
function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

export function RecordComments({ subjectKind, subjectId, canWrite = true }: {
  subjectKind: CommentSubject;
  subjectId: string;
  canWrite?: boolean;
}) {
  const comments = useQuery(loadComments(subjectKind, subjectId), [subjectKind, subjectId]);
  const people = useQuery(loadMentionable, []);
  const me = useQuery(loadMyUserId, []);
  const meId = me.status === 'ready' ? me.data : null;
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const all = comments.status === 'ready' ? comments.data : [];
  const roster = people.status === 'ready' ? people.data : [];

  /* One level deep, so a thread stays readable on the phone it is read on. */
  const threads = useMemo(() => {
    const roots = all.filter((c) => !c.parentId);
    const replies = new Map<string, RecordComment[]>();
    for (const c of all) {
      if (!c.parentId) continue;
      const list = replies.get(c.parentId);
      if (list) list.push(c); else replies.set(c.parentId, [c]);
    }
    return roots.map((r) => ({ root: r, replies: replies.get(r.id) ?? [] }));
  }, [all]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); comments.refetch(); }
    catch (err) { setError(messageFor(err)); }
    finally { setBusy(false); }
  };

  const send = () => {
    if (!body.trim()) return;
    void run(async () => {
      await postComment({
        subjectKind, subjectId, body,
        parentId: replyTo, mentions,
      });
      setBody(''); setReplyTo(null); setMentions([]);
    });
  };

  const nameOf = (id: string) => roster.find((p) => p.id === id)?.name ?? 'Somebody';

  const One = ({ c, isReply }: { c: RecordComment; isReply?: boolean }) => (
    <div className={cn('flex gap-3', isReply && 'ml-9 mt-2')}>
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full
                      bg-charcoal-200 text-[11px] font-semibold text-charcoal-700">
        {initials(c.authorName)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-medium text-charcoal-900">{c.authorName}</span>
          <span className="text-xs text-charcoal-500">{ago(c.createdAt)}</span>
          {c.editedAt ? <span className="text-xs text-charcoal-400">edited</span> : null}
          {c.retractedAt ? <Badge variant="warn">withdrawn</Badge> : null}
        </p>

        {editing === c.id ? (
          <div className="mt-1 space-y-2">
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3}
              aria-label="Edit your comment" />
            <div className="flex gap-2">
              <Button size="sm" disabled={busy}
                onClick={() => { void run(async () => { await editComment(c.id, draft); setEditing(null); }); }}>
                Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <p className={cn('mt-0.5 whitespace-pre-wrap text-sm',
            c.retractedAt ? 'text-charcoal-400 line-through' : 'text-charcoal-700')}>
            {c.body}
          </p>
        )}

        {c.retractedAt && c.retractReason ? (
          <p className="mt-0.5 text-xs text-charcoal-500">Withdrawn: {c.retractReason}</p>
        ) : null}

        {c.mentions.length > 0 && !c.retractedAt ? (
          <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-charcoal-500">
            <AtSign className="size-3" />
            {c.mentions.map((m) => nameOf(m)).join(', ')}
          </p>
        ) : null}

        {canWrite && !c.retractedAt && editing !== c.id ? (
          <div className="mt-1 flex flex-wrap gap-3 text-xs">
            {!isReply ? (
              <button type="button" className="text-charcoal-500 hover:text-charcoal-900"
                onClick={() => { setReplyTo(replyTo === c.id ? null : c.id); }}>
                {replyTo === c.id ? 'Cancel reply' : 'Reply'}
              </button>
            ) : null}
            {meId && c.authorId === meId ? (
              <button type="button" className="flex items-center gap-1 text-charcoal-500 hover:text-charcoal-900"
                onClick={() => { setEditing(c.id); setDraft(c.body); }}>
                <Pencil className="size-3" /> Edit
              </button>
            ) : null}
            <button type="button" className="flex items-center gap-1 text-charcoal-500 hover:text-warn-700"
              onClick={() => {
                const why = window.prompt('Why is this being withdrawn?') ?? undefined;
                void run(() => retractComment(c.id, why));
              }}>
              <Undo2 className="size-3" /> Withdraw
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <CollapsibleCard
      title={<span className="flex items-center gap-2">
        <MessageSquare className="size-4 text-charcoal-500" /> Discussion
      </span>}
      description="Said here, against this record, so the conversation stays with the thing it is about."
      summary={all.length === 0 ? 'nothing yet'
        : `${all.length} comment${all.length === 1 ? '' : 's'}`}
      defaultOpen={false}
    >
      <div className="space-y-4">
        {comments.status === 'loading' ? <LoadingState label="Reading the discussion" /> : null}
        {comments.status === 'error'
          ? <ErrorState message={comments.message} onRetry={comments.refetch} /> : null}
        {error ? <ErrorState message={error} /> : null}

        {comments.status === 'ready' && threads.length === 0 ? (
          <EmptyState title="Nothing said yet"
            hint="Ask a question here and it stays with the record rather than in somebody's phone." />
        ) : null}

        {threads.map(({ root, replies }) => (
          <div key={root.id} className="border-b border-charcoal-200 pb-3 last:border-0 last:pb-0">
            <One c={root} />
            {replies.map((r) => <One key={r.id} c={r} isReply />)}
            {replyTo === root.id && canWrite ? (
              <div className="ml-9 mt-2 space-y-2">
                <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2}
                  placeholder="Reply…" aria-label="Write a reply" />
                <Button size="sm" disabled={busy || !body.trim()} onClick={send}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null} Reply
                </Button>
              </div>
            ) : null}
          </div>
        ))}

        {canWrite && replyTo === null ? (
          <div className="space-y-2">
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3}
              placeholder="Say something about this record…"
              aria-label="Write a comment" />
            {roster.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-charcoal-500">Notify</span>
                {roster.slice(0, 12).map((p) => {
                  const on = mentions.includes(p.id);
                  return (
                    <button key={p.id} type="button"
                      aria-pressed={on}
                      className={cn('rounded-full border px-2 py-0.5 text-xs',
                        on ? 'border-charcoal-700 bg-charcoal-800 text-white'
                           : 'border-charcoal-300 text-charcoal-600 hover:border-charcoal-500')}
                      onClick={() => setMentions((m) =>
                        on ? m.filter((x) => x !== p.id) : [...m, p.id])}>
                      {p.name}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <Button size="sm" disabled={busy || !body.trim()} onClick={send}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Post
            </Button>
          </div>
        ) : null}
      </div>
    </CollapsibleCard>
  );
}
