/**
 * Entity — what people said about one record, on that record.
 *
 * Asked for as messaging between crew and office. Built as comments rather than
 * an inbox, because a general inbox becomes a second chat app nobody checks and
 * the conversation ends up detached from the thing it was about — and because a
 * decision taken in a direct message is a decision with no record, which is what
 * claims are lost on.
 *
 * Every write goes through a function rather than the table: `post_comment`
 * checks that the subject exists and belongs to the company, filters mentions
 * down to actual members, and fans out through the notification path that
 * already exists. There is no insert policy on `record_comments` at all, so a
 * browser writing straight to it is refused rather than quietly skipping all
 * three.
 */
import { supabase } from '@/lib/supabase';
import { unwrap, type Query } from './query';

/** The records a conversation can belong to. Widened in the database first. */
export type CommentSubject =
  | 'project' | 'schedule_activity' | 'change_order' | 'rfi'
  | 'daily_report' | 'safety_incident' | 'estimate_version'
  | 'pay_application' | 'purchase_order' | 'claim' | 'inspection'
  | 'submittal' | 'toolbox_talk' | 'deficiency';

export interface RecordComment {
  id: string;
  parentId: string | null;
  authorId: string;
  authorName: string;
  body: string;
  mentions: string[];
  editedAt: string | null;
  retractedAt: string | null;
  retractReason: string | null;
  createdAt: string;
}

export const loadComments = (
  subjectKind: CommentSubject, subjectId: string,
): Query<RecordComment[]> => async (client) => {
  const rows = unwrap(await client
    .from('my_record_comments')
    .select('id, parent_id, author_id, author_name, body, mentions, edited_at, '
      + 'retracted_at, retract_reason, created_at')
    .eq('subject_kind', subjectKind)
    .eq('subject_id', subjectId)
    .order('created_at')) as unknown as Array<Record<string, unknown>>;

  return rows.map((c) => ({
    id: String(c.id),
    parentId: (c.parent_id as string | null) ?? null,
    authorId: String(c.author_id),
    authorName: (c.author_name as string | null) ?? 'Somebody',
    body: String(c.body),
    mentions: ((c.mentions as string[] | null) ?? []),
    editedAt: (c.edited_at as string | null) ?? null,
    retractedAt: (c.retracted_at as string | null) ?? null,
    retractReason: (c.retract_reason as string | null) ?? null,
    createdAt: String(c.created_at),
  }));
};

/**
 * Who I am, for deciding whose comments offer an edit.
 *
 * Asked of the client rather than passed down from a page, so no caller can
 * wire it wrongly and quietly offer everyone the author's controls.
 */
export const loadMyUserId: Query<string | null> = async (client) => {
  const { data } = await client.auth.getUser();
  return data.user?.id ?? null;
};

/** Who can be named in a comment: the people in this company. */
export interface Mentionable { id: string; name: string }

export const loadMentionable: Query<Mentionable[]> = async (client) => {
  /*
   * Read from `user_profiles` rather than embedding it on the membership:
   * `company_memberships.user_id` and `user_profiles.id` both point at
   * `auth.users`, and neither points at the other, so PostgREST has no
   * relationship to embed through. The test that caught this asks the schema
   * the same question the browser would have asked at runtime.
   *
   * Scoping is already done: `user_profiles_select_colleagues` returns the
   * people in companies this person belongs to, and nobody else.
   */
  const rows = unwrap(await client
    .from('user_profiles')
    .select('id, full_name, email')
    .order('full_name')
    .limit(500)) as Array<Record<string, unknown>>;

  return rows.map((p) => ({
    id: String(p.id),
    name: (String(p.full_name ?? '').trim() || String(p.email ?? '') || 'Somebody'),
  }));
};

export async function postComment(input: {
  subjectKind: CommentSubject;
  subjectId: string;
  body: string;
  parentId?: string | null;
  mentions?: string[];
}): Promise<string> {
  if (!supabase) throw new Error('Not connected');
  const { data, error } = await supabase.rpc('post_comment', {
    p_subject_kind: input.subjectKind,
    p_subject_id: input.subjectId,
    p_body: input.body,
    p_parent_id: input.parentId ?? null,
    p_mentions: input.mentions ?? [],
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function editComment(commentId: string, body: string): Promise<void> {
  if (!supabase) throw new Error('Not connected');
  const { error } = await supabase.rpc('edit_comment', {
    p_comment: commentId, p_body: body,
  });
  if (error) throw new Error(error.message);
}

/**
 * Withdrawn, not deleted.
 *
 * The row stays and says it was withdrawn, because a record somebody is
 * claiming against should not quietly lose a sentence that was once on it.
 */
export async function retractComment(commentId: string, reason?: string): Promise<void> {
  if (!supabase) throw new Error('Not connected');
  const { error } = await supabase.rpc('retract_comment', {
    p_comment: commentId, p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
}
