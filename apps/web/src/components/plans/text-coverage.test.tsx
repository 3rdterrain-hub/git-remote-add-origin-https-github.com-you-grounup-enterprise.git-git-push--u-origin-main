/**
 * What can be searched, and what is a picture of a drawing.
 *
 * "Search the drawings" read a column nothing wrote, so it returned nothing for
 * every company and every term for the life of the platform — and a search that
 * finds nothing looks exactly like a job with no silt fence on it. Reading the
 * text at upload fixes it going forward; this is what says which sets are still
 * unread, and reads them.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TextCoverage } from '@/lib/data/plans';
import { TextCoveragePanel } from './text-coverage';

const hoisted = vi.hoisted(() => ({
  coverage: [] as TextCoverage[],
  read: [] as string[],
  outcome: { pages: 14, withText: 14 },
  failWith: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return true; },
  get supabase() { return {}; },
}));

vi.mock('@/lib/data/plans', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/plans')>('@/lib/data/plans');
  return {
    ...actual,
    loadTextCoverage: async () => hoisted.coverage,
    readStoredPlanSet: async (_c: unknown, input: { documentId: string }) => {
      if (hoisted.failWith) throw new Error(hoisted.failWith);
      hoisted.read.push(input.documentId);
      return hoisted.outcome;
    },
  };
});

const set = (over: Partial<TextCoverage> = {}): TextCoverage => ({
  documentVersionId: 'dv-1',
  documentId: 'doc-1',
  documentName: 'Kingsway — civil set',
  sheets: 14,
  sheetsWithText: 14,
  sheetsWithoutText: 0,
  storageBucket: 'project-documents',
  storagePath: 'co-1/kingsway.pdf',
  lastReadAt: '2026-09-13T10:00:00Z',
  lastReadBy: 'pdf_text_layer',
  ...over,
});

const openCard = async (user: ReturnType<typeof userEvent.setup>) => {
  const toggle = screen.queryByRole('button', { expanded: false });
  if (toggle) await user.click(toggle);
};

beforeEach(() => {
  hoisted.coverage = [];
  hoisted.read = [];
  hoisted.outcome = { pages: 14, withText: 14 };
  hoisted.failWith = null;
});

describe('what can be searched', () => {
  it('says every set is searchable without being opened', async () => {
    hoisted.coverage = [set()];
    render(<TextCoveragePanel />);
    expect(await screen.findByText('every set searchable')).toBeInTheDocument();
  });

  it('counts the sets that are not fully readable', async () => {
    hoisted.coverage = [set(), set({
      documentVersionId: 'dv-2', documentId: 'doc-2', documentName: 'OH5436 — asbestos report',
      sheets: 9, sheetsWithText: 0, sheetsWithoutText: 9, lastReadAt: null, lastReadBy: null,
    })];
    render(<TextCoveragePanel />);
    expect(await screen.findByText('1 set not fully readable')).toBeInTheDocument();
  });

  it('says plainly when a set cannot be found by searching at all', async () => {
    hoisted.coverage = [set({
      sheetsWithText: 0, sheetsWithoutText: 14, lastReadAt: null, lastReadBy: null,
    })];
    const user = userEvent.setup();
    render(<TextCoveragePanel />);
    await openCard(user);
    expect(await screen.findByText('unread')).toBeInTheDocument();
    expect(screen.getByText(/Nothing in this set can be found by searching/))
      .toBeInTheDocument();
  });

  it('reads a set already in storage, and says what it got', async () => {
    /*
     * Everything uploaded before the text layer existed is unread, so fixing
     * it going forward is only half the job.
     */
    hoisted.coverage = [set({ sheetsWithText: 0, sheetsWithoutText: 14 })];
    const user = userEvent.setup();
    render(<TextCoveragePanel />);
    await openCard(user);
    await user.click(await screen.findByRole('button', { name: /Read the text/ }));
    await waitFor(() => expect(hoisted.read).toEqual(['doc-1']));
    expect(await screen.findByText(/14 of 14 pages read/)).toBeInTheDocument();
  });

  it('says a set is a scan rather than reporting a success that found nothing', async () => {
    hoisted.coverage = [set({ sheetsWithText: 0, sheetsWithoutText: 14 })];
    hoisted.outcome = { pages: 14, withText: 0 };
    const user = userEvent.setup();
    render(<TextCoveragePanel />);
    await openCard(user);
    await user.click(await screen.findByRole('button', { name: /Read the text/ }));
    expect(await screen.findByText(/it is a scan, and needs OCR/)).toBeInTheDocument();
  });

  it('offers nothing to read on a set that is already fully readable', async () => {
    hoisted.coverage = [set()];
    const user = userEvent.setup();
    render(<TextCoveragePanel />);
    await openCard(user);
    expect(await screen.findByText('searchable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Read the text/ })).not.toBeInTheDocument();
  });

  it('says what went wrong rather than a generic failure', async () => {
    hoisted.coverage = [set({ sheetsWithText: 0, sheetsWithoutText: 14 })];
    hoisted.failWith = 'That plan set has no file behind it.';
    const user = userEvent.setup();
    render(<TextCoveragePanel />);
    await openCard(user);
    await user.click(await screen.findByRole('button', { name: /Read the text/ }));
    expect(await screen.findByText('That plan set has no file behind it.')).toBeInTheDocument();
  });
});
