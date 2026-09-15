/**
 * A proposal while it is still being written.
 *
 * The draft status has been legal since migration 0006 and the immutability
 * trigger has had a `draft` branch since 0013 — both unreachable, because
 * `issue_proposal` inserts straight at `issued`. There was no moment at which a
 * proposal was editable, which is why `commercial_terms` and `payment_terms`
 * were written by nothing at all.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProposalRow } from '@/lib/data/estimates';
import { ProposalDraftEditor } from './draft-editor';

const hoisted = vi.hoisted(() => ({
  updated: [] as Array<Record<string, unknown>>,
  issued: [] as string[],
  discarded: [] as string[],
  failWith: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return true; },
  get supabase() { return {}; },
}));

vi.mock('@/lib/data/estimates', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/estimates')>(
    '@/lib/data/estimates');
  return {
    ...actual,
    updateProposal: async (_c: unknown, _id: string, edit: Record<string, unknown>) => {
      if (hoisted.failWith) throw new Error(hoisted.failWith);
      hoisted.updated.push(edit);
    },
    issueDraftedProposal: async (_c: unknown, id: string) => {
      if (hoisted.failWith) throw new Error(hoisted.failWith);
      hoisted.issued.push(id);
    },
    discardProposalDraft: async (_c: unknown, id: string) => { hoisted.discarded.push(id); },
  };
});

const draft = (over: Partial<ProposalRow> = {}): ProposalRow => ({
  id: 'p-1', number: 'P-2026-0001', title: 'Site work',
  customerName: 'Kingsway Development', status: 'draft',
  totalPrice: 170200, validityDays: 30,
  coverLetter: 'Thank you for the opportunity.',
  commercialTerms: null, paymentTerms: null,
  showLineDetail: true, showUnitPrices: true,
  issuedAt: null, viewedAt: null, acceptedAt: null, acceptedByName: null, declinedAt: null,
  estimateVersionId: 'ev-1', estimateNumber: 'E-2026-0001', estimateVersion: 1,
  ...over,
});

const onChanged = vi.fn();

beforeEach(() => {
  hoisted.updated = []; hoisted.issued = []; hoisted.discarded = [];
  hoisted.failWith = null;
  onChanged.mockClear();
});

describe('the draft editor', () => {
  it('says nothing at all about a proposal that has been sent', () => {
    const { container } = render(
      <ProposalDraftEditor proposal={draft({ status: 'issued' })} editable
        onChanged={onChanged} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says the proposal has not been sent, and shows its price', () => {
    render(<ProposalDraftEditor proposal={draft()} editable onChanged={onChanged} />);
    expect(screen.getByText('This proposal has not been sent')).toBeInTheDocument();
    expect(screen.getByText('$170,200.00')).toBeInTheDocument();
  });

  it('offers no box to type a price into', () => {
    /*
     * `enforce_proposal_price` derives a draft's total from the estimate's bid
     * price on every write. A box here would be a price somebody typed.
     */
    render(<ProposalDraftEditor proposal={draft()} editable onChanged={onChanged} />);
    const editable = [
      ...screen.queryAllByRole('textbox'),
      ...screen.queryAllByRole('spinbutton'),
    ];
    /* Validity is the only number on the form, and it is a duration. */
    expect(editable.map((e) => e.getAttribute('id')))
      .toEqual(['d-title', 'd-cover', 'd-commercial', 'd-payment', 'd-validity']);
    /* And the total is text, not a field. */
    expect(screen.getByText('$170,200.00').tagName).not.toBe('INPUT');
  });

  it('writes the two columns nothing has ever written', async () => {
    const user = userEvent.setup();
    render(<ProposalDraftEditor proposal={draft()} editable onChanged={onChanged} />);
    await user.type(screen.getByLabelText('Commercial terms'),
      'Price held 30 days. Rock excavation excluded.');
    await user.type(screen.getByLabelText('Payment terms'), 'Net 30');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(hoisted.updated).toHaveLength(1));
    expect(hoisted.updated[0]).toMatchObject({
      commercialTerms: 'Price held 30 days. Rock excavation excluded.',
      paymentTerms: 'Net 30',
    });
    expect(await screen.findByText('Draft saved.')).toBeInTheDocument();
  });

  it('fixes a typo in the cover letter, which used to mean a second proposal', async () => {
    const user = userEvent.setup();
    render(<ProposalDraftEditor proposal={draft()} editable onChanged={onChanged} />);
    const cover = screen.getByLabelText('Cover letter');
    await user.clear(cover);
    await user.type(cover, 'Thank you for the opportunity to quote this work.');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(hoisted.updated).toHaveLength(1));
    expect(hoisted.updated[0]!.coverLetter)
      .toBe('Thank you for the opportunity to quote this work.');
  });

  it('sends it', async () => {
    const user = userEvent.setup();
    render(<ProposalDraftEditor proposal={draft()} editable onChanged={onChanged} />);
    await user.click(screen.getByRole('button', { name: /Send it/ }));
    await waitFor(() => expect(hoisted.issued).toEqual(['p-1']));
    expect(onChanged).toHaveBeenCalled();
  });

  it('throws one away', async () => {
    const user = userEvent.setup();
    render(<ProposalDraftEditor proposal={draft()} editable onChanged={onChanged} />);
    await user.click(screen.getByRole('button', { name: /Discard/ }));
    await waitFor(() => expect(hoisted.discarded).toEqual(['p-1']));
  });

  it('will not send unit prices to somebody not shown the lines', async () => {
    const user = userEvent.setup();
    render(<ProposalDraftEditor proposal={draft()} editable onChanged={onChanged} />);
    await user.click(screen.getByLabelText(/The scope, line by line/));
    expect(screen.getByLabelText(/Unit prices against each line/)).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(hoisted.updated).toHaveLength(1));
    expect(hoisted.updated[0]).toMatchObject({
      showLineDetail: false, showUnitPrices: false,
    });
  });

  it('says what the database refused', async () => {
    hoisted.failWith = 'The pricing engine has not cleared this estimate to be issued';
    const user = userEvent.setup();
    render(<ProposalDraftEditor proposal={draft()} editable onChanged={onChanged} />);
    await user.click(screen.getByRole('button', { name: /Send it/ }));
    expect(await screen.findByText(
      'The pricing engine has not cleared this estimate to be issued')).toBeInTheDocument();
  });

  it('shows a draft to somebody who may not send it, without the controls', () => {
    render(<ProposalDraftEditor proposal={draft()} editable={false} onChanged={onChanged} />);
    expect(screen.getByText('This proposal has not been sent')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Send it/ })).not.toBeInTheDocument();
  });
});
