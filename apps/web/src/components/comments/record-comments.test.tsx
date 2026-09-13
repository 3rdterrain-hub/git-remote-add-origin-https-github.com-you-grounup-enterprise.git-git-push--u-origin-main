/**
 * The conversation about one record.
 *
 * Crew and office had no way to say anything to each other: notifications are
 * the system speaking, announcements are a super admin speaking, and neither is
 * a person asking a question. These hold the parts of that which are decisions
 * rather than styling — that a withdrawn comment keeps its place, that an
 * edited one says so, and that only the author is offered the edit.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecordComment } from '@/lib/data/comments';

const hoisted = vi.hoisted(() => ({
  comments: [] as RecordComment[],
  people: [] as Array<{ id: string; name: string }>,
  me: 'u-1' as string | null,
  posted: [] as Array<Record<string, unknown>>,
  edited: [] as Array<{ id: string; body: string }>,
  retracted: [] as Array<{ id: string; reason?: string }>,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return true; },
  get supabase() { return {}; },
}));

vi.mock('@/lib/data/comments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/comments')>('@/lib/data/comments');
  return {
    ...actual,
    loadComments: () => async () => hoisted.comments,
    loadMentionable: async () => hoisted.people,
    loadMyUserId: async () => hoisted.me,
    postComment: async (i: Record<string, unknown>) => { hoisted.posted.push(i); return 'c-new'; },
    editComment: async (id: string, body: string) => { hoisted.edited.push({ id, body }); },
    retractComment: async (id: string, reason?: string) => { hoisted.retracted.push({ id, reason }); },
  };
});

const { RecordComments } = await import('./record-comments');

const comment = (over: Partial<RecordComment> = {}): RecordComment => ({
  id: 'c-1', parentId: null, authorId: 'u-1', authorName: 'Dana Whitfield',
  body: 'Storm crossing is blocked at station 12+00', mentions: [],
  editedAt: null, retractedAt: null, retractReason: null,
  createdAt: new Date(Date.now() - 120_000).toISOString(), ...over,
});

const open = async () => {
  render(<RecordComments subjectKind="project" subjectId="p-1" />);
  await userEvent.click(await screen.findByRole('button', { name: /discussion/i }));
};

describe('the discussion on a record', () => {
  beforeEach(() => {
    hoisted.comments = [comment()];
    hoisted.people = [{ id: 'u-1', name: 'Dana Whitfield' }, { id: 'u-2', name: 'Marcus Ruiz' }];
    hoisted.me = 'u-1';
    hoisted.posted = []; hoisted.edited = []; hoisted.retracted = [];
  });

  it('says how many comments there are without being opened', async () => {
    render(<RecordComments subjectKind="project" subjectId="p-1" />);
    expect(await screen.findByText('1 comment')).toBeInTheDocument();
  });

  it('offers somewhere to say something when nobody has', async () => {
    hoisted.comments = [];
    await open();
    expect(await screen.findByText(/Nothing said yet/)).toBeInTheDocument();
  });

  it('posts against the record it is mounted on', async () => {
    const user = userEvent.setup();
    await open();
    await user.type(await screen.findByLabelText('Write a comment'), 'Who has the survey?');
    await user.click(screen.getByRole('button', { name: /^Post$/ }));
    await waitFor(() => expect(hoisted.posted).toHaveLength(1));
    expect(hoisted.posted[0]).toMatchObject({
      subjectKind: 'project', subjectId: 'p-1', body: 'Who has the survey?',
    });
  });

  it('names the people a comment should reach', async () => {
    const user = userEvent.setup();
    await open();
    await user.type(await screen.findByLabelText('Write a comment'), 'confirm please');
    await user.click(screen.getByRole('button', { name: 'Marcus Ruiz' }));
    await user.click(screen.getByRole('button', { name: /^Post$/ }));
    await waitFor(() => expect(hoisted.posted).toHaveLength(1));
    expect(hoisted.posted[0]!.mentions).toEqual(['u-2']);
  });

  it('offers the edit only to the person who wrote it', async () => {
    hoisted.me = 'u-2';
    await open();
    await waitFor(() =>
      expect(screen.getByText(/Storm crossing/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
  });

  it('says on its face that a comment was changed', async () => {
    hoisted.comments = [comment({ editedAt: new Date().toISOString() })];
    await open();
    expect(await screen.findByText('edited')).toBeInTheDocument();
  });

  it('keeps a withdrawn comment in place, with the reason', async () => {
    /*
     * The decision this component exists to hold. A record somebody is claiming
     * against should not quietly lose a sentence that was once on it.
     */
    hoisted.comments = [comment({
      retractedAt: new Date().toISOString(), retractReason: 'posted on the wrong job',
    })];
    await open();
    expect(await screen.findByText('withdrawn')).toBeInTheDocument();
    expect(screen.getByText(/Storm crossing/)).toBeInTheDocument();
    expect(screen.getByText(/posted on the wrong job/)).toBeInTheDocument();
  });

  it('offers no controls on a comment already withdrawn', async () => {
    hoisted.comments = [comment({ retractedAt: new Date().toISOString() })];
    await open();
    await waitFor(() => expect(screen.getByText('withdrawn')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /reply/i })).not.toBeInTheDocument();
  });

  it('shows a reply under the comment it answers', async () => {
    hoisted.comments = [
      comment(),
      comment({ id: 'c-2', parentId: 'c-1', authorName: 'Marcus Ruiz', body: 'On my way' }),
    ];
    // The summary is what the card shows while shut, so it is read before
    // opening rather than after.
    render(<RecordComments subjectKind="project" subjectId="p-1" />);
    expect(await screen.findByText('2 comments')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /discussion/i }));
    expect(await screen.findByText('On my way')).toBeInTheDocument();
  });
});
