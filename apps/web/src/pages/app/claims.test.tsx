/**
 * Claims and entitlement, live.
 *
 * The page read a fixture while the `claims` table sat governed and unread
 * since migration 0023.
 *
 * Almost all of these are about one number — notice at risk — because a claim
 * whose contractual notice period lapses is usually worth nothing however good
 * the argument, and the fixture's version of that number was wrong in two ways:
 * it counted settled claims, and it could not say that a date had already
 * passed.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ClaimRow } from '@/lib/data/claims';

const hoisted = vi.hoisted(() => ({ configured: true, claims: [] as ClaimRow[] }));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));

vi.mock('@/lib/data/claims', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/claims')>('@/lib/data/claims');
  return { ...actual, loadClaims: async () => hoisted.claims };
});

const { ClaimsPage } = await import('./claims');

const claim = (over: Partial<ClaimRow> = {}): ClaimRow => ({
  id: 'c-1', number: 'CLM-0001', title: 'Rock at the east trench',
  claimType: 'differing_site_condition',
  description: 'Limestone ledge at 9 ft, not shown on the borings.',
  status: 'notice_given',
  eventDate: '2026-04-20', noticeGivenOn: '2026-04-22', noticeDueOn: '2026-04-27',
  claimSubmittedOn: null, claimDueOn: '2026-05-20',
  costClaimed: 84_000, timeClaimedDays: 9,
  costAwarded: null, timeAwardedDays: null,
  resolution: null, resolvedOn: null,
  projectId: 'p-1', projectNumber: 'PRJ-2026-0011', projectName: 'Maumee Commerce Park',
  contractNumber: 'C-2026-004',
  supportingReports: 4, supportingRfis: 1, supportingDocuments: 2,
  noticeAtRisk: false, daysToNotice: null, ...over,
});

const show = () => render(<MemoryRouter><ClaimsPage /></MemoryRouter>);

beforeEach(() => {
  hoisted.configured = true;
  hoisted.claims = [claim()];
});

describe('notice, which is what preserves a claim', () => {
  it('says entitlement is preserved once notice has been served', async () => {
    show();
    await waitFor(() => expect(screen.getByText(/Served /)).toBeTruthy());
    expect(screen.getByText(/Entitlement preserved/)).toBeTruthy();
  });

  it('counts down while the period is open', async () => {
    hoisted.claims = [claim({
      status: 'potential', noticeGivenOn: null, noticeDueOn: '2026-12-01',
      noticeAtRisk: true, daysToNotice: 9,
    })];
    show();
    await waitFor(() => expect(screen.getByText('Due in 9 days')).toBeTruthy());
    expect(screen.getByText(/the entitlement is gone regardless of the merits/i)).toBeTruthy();
  });

  it('says a lapsed period has closed rather than counting backwards', async () => {
    /*
     * The fixture only counted forward. "Lapsed 4 days ago" is a different
     * conversation from "due in 2 days" and has to read as one.
     */
    hoisted.claims = [claim({
      status: 'potential', noticeGivenOn: null, noticeDueOn: '2026-04-27',
      noticeAtRisk: true, daysToNotice: -4,
    })];
    show();
    await waitFor(() => expect(screen.getByText('Lapsed 4 days ago')).toBeTruthy());
    expect(screen.getByText('The contractual period has closed.')).toBeTruthy();
  });

  it('raises the banner only inside three days', async () => {
    hoisted.claims = [claim({
      status: 'potential', noticeGivenOn: null, noticeDueOn: '2026-12-01',
      noticeAtRisk: true, daysToNotice: 2,
    })];
    show();
    expect(await screen.findByText(/within the notice window/i)).toBeTruthy();
  });

  it('does not raise it for a claim that is still weeks out', async () => {
    hoisted.claims = [claim({
      status: 'potential', noticeGivenOn: null, noticeDueOn: '2026-12-01',
      noticeAtRisk: true, daysToNotice: 30,
    })];
    show();
    await waitFor(() => expect(screen.getByText('Notice at risk')).toBeTruthy());
    expect(screen.queryByText(/within the notice window/i)).toBeNull();
  });

  it('does not call a settled claim at risk', async () => {
    /*
     * The fixture flagged any unserved notice inside three days, settled ones
     * included. A settled claim is not at risk of anything, and flagging it
     * buries the ones that are.
     */
    hoisted.claims = [claim({
      status: 'settled', noticeGivenOn: null, noticeDueOn: '2026-04-27',
      noticeAtRisk: false, costAwarded: 60_000, resolvedOn: '2026-06-01',
      resolution: 'Settled at the mediation.',
    })];
    show();
    await waitFor(() => expect(screen.getByText('Notice at risk')).toBeTruthy());
    /* The whole tile, not the wrapper holding its label — the number is a
       sibling of that wrapper, which is what `data-stat-tile` is for. */
    const tile = screen.getByText('Notice at risk').closest('[data-stat-tile]')!;
    expect(within(tile as HTMLElement).getByText('0')).toBeTruthy();
  });
});

describe('how much margin a notice had', () => {
  it('says the days between the event and the notice served', async () => {
    /*
     * Carried over from the file this replaces. Notice served on the last
     * possible day and notice served the next morning are the same "served" on
     * a badge and very different facts in a dispute.
     */
    show();
    await waitFor(() => expect(screen.getByText(/Served /)).toBeTruthy());
    expect(screen.getByText(/2 days after the event/)).toBeTruthy();
  });
});

describe('what a claim is argued from', () => {
  it('counts the contemporaneous record behind it', async () => {
    show();
    await waitFor(() => expect(screen.getByText(/4 daily/)).toBeTruthy());
    expect(screen.getByText(/1 RFI/)).toBeTruthy();
    expect(screen.getByText(/2 doc/)).toBeTruthy();
  });

  it('says plainly when a claim has nothing attached', async () => {
    /*
     * The claim most likely to fail. Until migration 0157 a company could not
     * create a daily report at all, so a claim had nothing it *could* point at.
     */
    hoisted.claims = [claim({
      supportingReports: 0, supportingRfis: 0, supportingDocuments: 0,
    })];
    show();
    await waitFor(() =>
      expect(screen.getByText(/Nothing contemporaneous is attached/i)).toBeTruthy());
  });
});

describe('a claim that has been resolved', () => {
  it('shows the award and what was asked for, because the gap is the negotiation', async () => {
    hoisted.claims = [claim({
      status: 'settled', costAwarded: 60_000, timeAwardedDays: 5,
      resolvedOn: '2026-06-01', resolution: 'Settled at the mediation.',
    })];
    show();
    /* The award shows twice — once in the box across the top that totals what
       has been awarded, and once on the claim itself. Both are correct, so the
       assertion is on the one attached to the sentence that explains the gap. */
    await waitFor(() => expect(screen.getAllByText('$60,000.00').length).toBeGreaterThan(0));
    expect(screen.getByText(/of \$84,000\.00 claimed/)).toBeTruthy();
  });

  it('shows the resolution, which the schema requires it to carry', async () => {
    hoisted.claims = [claim({
      status: 'denied', costAwarded: 0, resolvedOn: '2026-06-01',
      resolution: 'Denied: notice served outside the contractual period.',
    })];
    show();
    expect(await screen.findByText(/notice served outside the contractual period/)).toBeTruthy();
  });
});

describe('filtering', () => {
  it('narrows to the claims whose notice is unserved', async () => {
    const user = userEvent.setup();
    hoisted.claims = [
      claim(),
      claim({ id: 'c-2', number: 'CLM-0002', title: 'Suspension of work',
        status: 'potential', noticeGivenOn: null, noticeDueOn: '2026-12-01',
        noticeAtRisk: true, daysToNotice: 10 }),
    ];
    show();
    await waitFor(() => expect(screen.getByText('Rock at the east trench')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /notice has not been served/i }));
    await waitFor(() => expect(screen.queryByText('Rock at the east trench')).toBeNull());
    expect(screen.getByText('Suspension of work')).toBeTruthy();
  });

  it('puts them all back', async () => {
    const user = userEvent.setup();
    show();
    await waitFor(() => expect(screen.getByText('Rock at the east trench')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /still open/i }));
    await user.click(await screen.findByRole('button', { name: /Show all 1/ }));
    expect(screen.getByText('Rock at the east trench')).toBeTruthy();
  });
});

describe('the boxes across the top', () => {
  it('says what time awarded means, since no list on the page shows days', async () => {
    /*
     * Carried over from the file this replaces. Days awarded is not days
     * claimed, and the gap between them is what the negotiation cost — which
     * no list on this page shows.
     */
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /What is behind Time awarded/i }));
    expect(await screen.findByText(/days awarded, not days claimed/i)).toBeTruthy();
  });

  it('lists every claim by default', async () => {
    hoisted.claims = [claim(), claim({ id: 'c-2', number: 'CLM-0002', title: 'Suspension' })];
    show();
    await waitFor(() => expect(screen.getByText('Rock at the east trench')).toBeTruthy());
    expect(screen.getByText('Suspension')).toBeTruthy();
  });
});

describe('when there are none', () => {
  it('says what a claim is rather than showing an empty page', async () => {
    hoisted.claims = [];
    show();
    expect(await screen.findByText('No claims on any project')).toBeTruthy();
  });
});

describe('without a workspace', () => {
  it('says it is a demonstration rather than showing invented claims', async () => {
    hoisted.configured = false;
    show();
    await waitFor(() => expect(screen.queryByText('Rock at the east trench')).toBeNull());
  });
});
