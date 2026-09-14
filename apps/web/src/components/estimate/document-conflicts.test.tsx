/**
 * Where the documents disagree, with a door.
 *
 * The confidence engine has taken twenty-two points off a line for every
 * unresolved conflict on it since migration 0033, and nothing in the platform
 * could record one. Every bid priced here was priced as though the plans, the
 * specifications, the geotechnical report and the addenda all agreed.
 *
 * These hold the parts that are decisions rather than styling: that a conflict
 * cannot be recorded from one side, that settling it needs an answer, and that
 * the RFI carries both sides across without anyone retyping them.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DocumentConflict, NewConflict } from '@/lib/data/conflicts';
import { DocumentConflicts } from './document-conflicts';

const hoisted = vi.hoisted(() => ({
  conflicts: [] as DocumentConflict[],
  raised: [] as NewConflict[],
  resolved: [] as Array<{ id: string; resolution: string }>,
  asked: [] as Array<{ id: string; question: string | null | undefined }>,
  failWith: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return true; },
  get supabase() { return {}; },
}));

vi.mock('@/lib/data/conflicts', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/conflicts')>('@/lib/data/conflicts');
  return {
    ...actual,
    loadDocumentConflicts: async () => hoisted.conflicts,
    raiseConflict: async (_c: unknown, input: NewConflict) => {
      if (hoisted.failWith) throw new Error(hoisted.failWith);
      hoisted.raised.push(input);
      return 'cf-new';
    },
    resolveConflict: async (_c: unknown, id: string, resolution: string) => {
      hoisted.resolved.push({ id, resolution });
    },
    askAboutConflict: async (_c: unknown, id: string, question?: string | null) => {
      hoisted.asked.push({ id, question });
      return 'rfi-1';
    },
  };
});

const conflict = (over: Partial<DocumentConflict> = {}): DocumentConflict => ({
  id: 'cf-1',
  estimateVersionId: 'ev-1',
  lineItemId: 'li-1',
  title: 'Storm line size at the north basin',
  description: '',
  sourceA: 'C4.0 Storm Plan, rev 2',
  sourceASays: '18 inch RCP',
  sourceB: 'Specification 33 41 00',
  sourceBSays: '24 inch RCP minimum',
  discipline: 'Civil',
  severity: 'high',
  quantityImpact: true,
  costImpact: true,
  scheduleImpact: false,
  resolution: null,
  resolvedAt: null,
  detectedBy: 'human',
  createdAt: '2026-09-10T10:00:00Z',
  lineDescription: 'Storm drainage, 18" RCP',
  estimateNumber: 'EST-2026-011',
  rfiCount: 0,
  ...over,
});

const lines = [{ id: 'li-1', description: 'Storm drainage, 18" RCP' }];

const panel = (editable = true) =>
  render(<DocumentConflicts versionId="ev-1" lines={lines} editable={editable} />);

/*
 * The card opens itself only when something is unresolved — a card that opens
 * to say "none" is a card everybody shuts. Everything else starts a click away.
 */
const openCard = async (user: ReturnType<typeof userEvent.setup>) => {
  const toggle = screen.queryByRole('button', { expanded: false });
  if (toggle) await user.click(toggle);
};

beforeEach(() => {
  hoisted.conflicts = [];
  hoisted.raised = [];
  hoisted.resolved = [];
  hoisted.asked = [];
  hoisted.failWith = null;
});

describe('the conflicts panel', () => {
  it('stays shut, and says so, when nothing is in conflict', async () => {
    const user = userEvent.setup();
    panel();
    expect(await screen.findByText('none raised')).toBeInTheDocument();
    await openCard(user);
    expect(await screen.findByText('Nothing on this estimate is in conflict')).toBeInTheDocument();
  });

  it('opens itself when something is unresolved, after the query answers', async () => {
    /*
     * `defaultOpen` is read once at mount, and at mount the query has not
     * answered — so a card told to open on conflicts would mount shut and stay
     * shut on the one estimate that needed it open.
     */
    hoisted.conflicts = [conflict()];
    panel();
    expect(await screen.findByText('Storm line size at the north basin')).toBeInTheDocument();
  });

  it('shows both sides in the words each document used', async () => {
    hoisted.conflicts = [conflict()];
    panel();
    expect(await screen.findByText('Storm line size at the north basin')).toBeInTheDocument();
    expect(screen.getByText('C4.0 Storm Plan, rev 2')).toBeInTheDocument();
    expect(screen.getByText('18 inch RCP')).toBeInTheDocument();
    expect(screen.getByText('Specification 33 41 00')).toBeInTheDocument();
    expect(screen.getByText('24 inch RCP minimum')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
  });

  it('leaves a conflict on another version alone', async () => {
    hoisted.conflicts = [conflict({ estimateVersionId: 'ev-other' })];
    const user = userEvent.setup();
    panel();
    expect(await screen.findByText('none raised')).toBeInTheDocument();
    await openCard(user);
    expect(await screen.findByText('Nothing on this estimate is in conflict')).toBeInTheDocument();
  });

  it('will not record one stated from a single side', async () => {
    const user = userEvent.setup();
    panel();
    await openCard(user);
    await user.click(await screen.findByRole('button', { name: 'Record a conflict' }));
    await user.type(screen.getByLabelText('What is in conflict'), 'Storm line size');
    await user.type(screen.getByLabelText('First document'), 'C4.0 Storm Plan');
    await user.type(screen.getByLabelText('What the first document says'), '18 inch RCP');

    expect(screen.getByRole('button', { name: 'Record it' })).toBeDisabled();

    await user.type(screen.getByLabelText('Second document'), 'Specification 33 41 00');
    await user.type(screen.getByLabelText('What the second document says'), '24 inch minimum');
    expect(screen.getByRole('button', { name: 'Record it' })).toBeEnabled();
  });

  it('sends both sides, and the line it lands on', async () => {
    const user = userEvent.setup();
    panel();
    await openCard(user);
    await user.click(await screen.findByRole('button', { name: 'Record a conflict' }));
    await user.type(screen.getByLabelText('What is in conflict'), 'Storm line size');
    await user.type(screen.getByLabelText('First document'), 'C4.0 Storm Plan');
    await user.type(screen.getByLabelText('What the first document says'), '18 inch RCP');
    await user.type(screen.getByLabelText('Second document'), 'Specification 33 41 00');
    await user.type(screen.getByLabelText('What the second document says'), '24 inch minimum');
    await user.click(screen.getByRole('button', { name: 'Record it' }));

    await waitFor(() => expect(hoisted.raised).toHaveLength(1));
    expect(hoisted.raised[0]).toMatchObject({
      title: 'Storm line size',
      sourceA: 'C4.0 Storm Plan',
      sourceASays: '18 inch RCP',
      sourceB: 'Specification 33 41 00',
      sourceBSays: '24 inch minimum',
      estimateVersionId: 'ev-1',
      severity: 'moderate',
      quantityImpact: true,
    });
  });

  it('says settling it needs an answer, and will not send an empty one', async () => {
    hoisted.conflicts = [conflict()];
    const user = userEvent.setup();
    panel();
    const settle = await screen.findByRole('button', { name: 'Settle it' });
    expect(settle).toBeDisabled();

    await user.type(screen.getByLabelText('How it was settled'),
      'Addendum 2 governs; 24 inch RCP');
    expect(settle).toBeEnabled();
    await user.click(settle);
    await waitFor(() => expect(hoisted.resolved).toEqual(
      [{ id: 'cf-1', resolution: 'Addendum 2 governs; 24 inch RCP' }]));
  });

  it('offers the question the conflict already implies', async () => {
    hoisted.conflicts = [conflict()];
    const user = userEvent.setup();
    panel();
    await user.click(await screen.findByRole('button', { name: /Ask the owner/ }));
    const box = screen.getByLabelText('The question');
    expect(box).toHaveAttribute(
      'placeholder', 'Which governs: C4.0 Storm Plan, rev 2 or Specification 33 41 00?');

    await user.click(screen.getByRole('button', { name: 'Raise an RFI' }));
    await waitFor(() => expect(hoisted.asked).toHaveLength(1));
    expect(hoisted.asked[0]!.id).toBe('cf-1');
    /* Left blank, the database writes the question rather than the browser. */
    expect(hoisted.asked[0]!.question).toBe('');
  });

  it('shows a settled one with how it was settled, and no way to settle it again', async () => {
    hoisted.conflicts = [conflict({
      resolution: 'Addendum 2 governs; 24 inch RCP',
      resolvedAt: '2026-09-12T09:00:00Z',
    })];
    const user = userEvent.setup();
    panel();
    expect(await screen.findByText('1 settled')).toBeInTheDocument();
    await openCard(user);
    expect(await screen.findByText(/Addendum 2 governs; 24 inch RCP/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settle it' })).not.toBeInTheDocument();
  });

  it('shows an issued estimate its conflicts without offering to change them', async () => {
    hoisted.conflicts = [conflict()];
    panel(false);
    expect(await screen.findByText('Storm line size at the north basin')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record a conflict' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settle it' })).not.toBeInTheDocument();
  });

  it('says why naming the line matters', async () => {
    const user = userEvent.setup();
    panel();
    await openCard(user);
    await user.click(await screen.findByRole('button', { name: 'Record a conflict' }));
    expect(screen.getByText(/only one on a line moves that line's confidence/))
      .toBeInTheDocument();
  });

  it('keeps the form up and says why when it is refused', async () => {
    hoisted.failWith = 'Say what each document is, and what each one says';
    const user = userEvent.setup();
    panel();
    await openCard(user);
    await user.click(await screen.findByRole('button', { name: 'Record a conflict' }));
    await user.type(screen.getByLabelText('What is in conflict'), 'Storm line size');
    await user.type(screen.getByLabelText('First document'), 'C4.0');
    await user.type(screen.getByLabelText('What the first document says'), '18 inch');
    await user.type(screen.getByLabelText('Second document'), 'Spec');
    await user.type(screen.getByLabelText('What the second document says'), '24 inch');
    await user.click(screen.getByRole('button', { name: 'Record it' }));

    expect(await screen.findByText('Say what each document is, and what each one says'))
      .toBeInTheDocument();
    expect(screen.getByLabelText('What is in conflict')).toBeInTheDocument();
  });
});
