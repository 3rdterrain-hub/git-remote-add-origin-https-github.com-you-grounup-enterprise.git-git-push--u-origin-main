import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage as renderWithProviders } from '@/test/render';
import { PlansPage } from './plans';
import { AI_FINDINGS } from '@/data/operations';

const renderPage = () => renderWithProviders(<PlansPage />);

describe('AI finding governance in the UI (RULE-008)', () => {
  it('shows every proposed finding with its citations', () => {
    renderPage();
    const proposed = AI_FINDINGS.filter((f) => f.state === 'proposed');
    for (const f of proposed) {
      expect(screen.getByText(f.title)).toBeInTheDocument();
      // A factual claim must show where it came from.
      for (const c of f.citations) expect(screen.getAllByText(c).length).toBeGreaterThan(0);
    }
  });

  it('offers accept and reject only on findings that are still proposed', () => {
    renderPage();
    const proposedCount = AI_FINDINGS.filter((f) => f.state === 'proposed').length;
    expect(screen.getAllByRole('button', { name: /^accept$/i })).toHaveLength(proposedCount);
    expect(screen.getAllByRole('button', { name: /^reject$/i })).toHaveLength(proposedCount);
  });

  it('records the reviewer when a finding is accepted', async () => {
    const user = userEvent.setup();
    renderPage();
    const card = screen.getByTestId('finding-f-2');
    await user.click(within(card).getByRole('button', { name: /^accept$/i }));

    expect(within(card).getAllByText(/accepted/i).length).toBeGreaterThan(0);
    expect(within(card).getByText(/Dana Whitfield/)).toBeInTheDocument();
    // Once decided, the decision controls are gone — a finding is accepted once.
    expect(within(card).queryByRole('button', { name: /^accept$/i })).not.toBeInTheDocument();
  });

  it('explains that agents cannot write to an estimate', () => {
    renderPage();
    expect(screen.getByText(/It cannot compute an authoritative price, and it cannot write to an estimate/i)).toBeInTheDocument();
  });

  it('marks superseded documents and keeps them in the register', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: /document register/i }));
    // Section 3 revision control: superseded documents stay visible for audit.
    expect(screen.getAllByText('Superseded').length).toBeGreaterThan(0);
  });
});

/*
 * The four boxes across the top each counted something one of the three tabs
 * already lists, and none of them went there.
 */
describe('the boxes across the top', () => {
  it('narrows the findings to the ones waiting for a reviewer', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button',
      { name: 'List the findings waiting for a reviewer' }));

    expect(screen.getByText(/Showing the findings waiting for a reviewer/))
      .toBeInTheDocument();
    const accepted = AI_FINDINGS.filter((f) => f.state === 'accepted');
    for (const f of accepted) {
      expect(screen.queryByText(f.title)).not.toBeInTheDocument();
    }
    for (const f of AI_FINDINGS.filter((f) => f.state === 'proposed')) {
      expect(screen.getByText(f.title)).toBeInTheDocument();
    }
  });

  it('puts them all back when the tile is pressed again', async () => {
    const user = userEvent.setup();
    renderPage();
    const tile = () => screen.getByRole('button',
      { name: 'List the findings waiting for a reviewer' });
    await user.click(tile());
    expect(tile()).toHaveAttribute('aria-pressed', 'true');
    await user.click(tile());
    expect(tile()).toHaveAttribute('aria-pressed', 'false');
  });

  it('opens the document register from the tile that counts documents', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Open the document register' }));
    expect(screen.getByRole('tab', { name: /Document register/ }))
      .toHaveAttribute('data-state', 'active');
  });

  it('says what a sheet count is made of, since no tab lists sheets', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'What is behind Sheets indexed' }));
    expect(screen.getByText(/Superseded revisions are not counted/)).toBeInTheDocument();
  });
});
