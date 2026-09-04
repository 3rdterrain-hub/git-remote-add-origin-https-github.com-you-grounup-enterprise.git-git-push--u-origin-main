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
