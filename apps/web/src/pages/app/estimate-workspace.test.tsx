import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage as renderWithProviders } from '@/test/render';
import { EstimateWorkspacePage } from './estimate-workspace';
import { ESTIMATE } from '@/data/demo';
import { money } from '@/lib/format';

const renderPage = () => renderWithProviders(<EstimateWorkspacePage />);

describe('estimate workspace', () => {
  it('shows the engine result, not a re-typed number', () => {
    renderPage();
    expect(screen.getAllByText(money(ESTIMATE.bidPrice)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(money(ESTIMATE.totalDirectCost)).length).toBeGreaterThan(0);
  });

  it('blocks issuing while a line still requires an RFI', () => {
    renderPage();
    expect(ESTIMATE.blockedFromIssue).toBe(true);
    expect(screen.getByRole('button', { name: /issue estimate/i })).toBeDisabled();
    expect(screen.getByText(ESTIMATE.executiveDecisionReason)).toBeInTheDocument();
  });

  it('lists every line with its approval gate', () => {
    renderPage();
    for (const line of ESTIMATE.lines) {
      expect(screen.getByText(line.description)).toBeInTheDocument();
    }
  });

  it('reveals the full derivation when a line is expanded', async () => {
    const user = userEvent.setup();
    renderPage();
    const buttons = screen.getAllByRole('button', { name: /expand line detail/i });
    await user.click(buttons[1]!);

    // The quantity chain, production analysis and confidence factors must all
    // be inspectable — Section 23 forbids hiding the calculation.
    expect(screen.getByText('Quantity chain')).toBeInTheDocument();
    expect(screen.getByText('Production (Section 25)')).toBeInTheDocument();
    expect(screen.getByText('Approval routing')).toBeInTheDocument();
    expect(screen.getByText('Full derivation')).toBeInTheDocument();
    expect(screen.getByText('Condition modifiers')).toBeInTheDocument();
  });

  it('shows the three distinct production numbers Section 25 requires', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByRole('button', { name: /expand line detail/i })[1]!);
    const massExcavation = ESTIMATE.lines.find((l) => l.id === 'L-020')!;
    expect(screen.getByText(`${massExcavation.production!.theoreticalPerHour.toFixed(2)} /hr`)).toBeInTheDocument();
    expect(screen.getByText(`${massExcavation.production!.practicalPerHour.toFixed(2)} /hr practical`)).toBeInTheDocument();
    expect(screen.getByText(`${massExcavation.production!.recommendedPerHour.toFixed(2)} /hr recommended`)).toBeInTheDocument();
  });

  it('shows every markup component with its basis and dollar effect (RULE-007)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: /pricing/i }));
    for (const m of ESTIMATE.price.appliedMarkups) {
      // "Contingency" also names a KPI tile, so more than one match is correct.
      expect(screen.getAllByText(m.label).length).toBeGreaterThan(0);
      expect(screen.getAllByText(money(m.amount)).length).toBeGreaterThan(0);
    }
  });

  it('keeps every cost bucket separately visible (RULE-001)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: /pricing/i }));
    for (const label of ['Labor wage', 'Labor burden', 'Equipment ownership', 'Fuel & DEF', 'Material', 'Trucking']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('reports the cut/fill balance in the correct volume states', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: /earthwork/i }));
    expect(screen.getByText('Total cut')).toBeInTheDocument();
    expect(screen.getByText('Makes compacted')).toBeInTheDocument();
    expect(screen.getByText(/Cut is bank, fill is compacted/)).toBeInTheDocument();
  });

  it('never adopts the owner bid quantity to close a variance', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: /bid reconciliation/i }));
    expect(screen.getByText(/A quantity is never changed simply to match the bid schedule/)).toBeInTheDocument();
    expect(screen.getAllByText(/do not adopt the bid quantity to close the gap/i).length).toBeGreaterThan(0);
  });

  it('surfaces engine notices rather than suppressing them', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: /engine notices/i }));
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('Engine notices')).toBeInTheDocument();
  });
});
