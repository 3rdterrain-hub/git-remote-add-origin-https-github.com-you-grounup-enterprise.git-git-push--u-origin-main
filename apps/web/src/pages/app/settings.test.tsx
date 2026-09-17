import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CONFIDENCE_THRESHOLDS } from '@grounup/engine';
import { renderPage as renderWithProviders } from '@/test/render';
import { percent } from '@/lib/format';
import { SettingsPage } from './settings';

const renderPage = () => renderWithProviders(<SettingsPage />);
const openSecurity = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: /security/i }));
};

/**
 * The security panel used to render four switches — multi-factor
 * authentication, single sign-on, session timeout, export restriction — and no
 * code read any of them. A switch an administrator can turn on, that nothing
 * implements, is a false assurance rather than a missing feature.
 *
 * These tests exist so it cannot come back.
 */
describe('the security panel claims nothing the platform does not do', () => {
  it('offers no switch for a control that is not implemented', async () => {
    renderPage();
    await openSecurity();
    const panel = screen.getByRole('tabpanel');
    // Not "no MFA switch" but "no switch at all here": the next unbacked
    // toggle would otherwise pass a narrower test.
    expect(within(panel).queryAllByRole('switch')).toEqual([]);
  });

  it('names multi-factor authentication as unavailable rather than as a setting', async () => {
    renderPage();
    await openSecurity();
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('Not yet available')).toBeInTheDocument();
    expect(within(panel).getByText('Multi-factor authentication')).toBeInTheDocument();
    expect(within(panel).getByText(/There is no second factor to require/)).toBeInTheDocument();
  });

  it('names every control it cannot enforce', async () => {
    renderPage();
    await openSecurity();
    const panel = screen.getByRole('tabpanel');
    for (const control of ['Multi-factor authentication', 'Single sign-on', 'Session policy',
                           'Export restriction', 'Retention and deletion']) {
      expect(within(panel).getByText(control), control).toBeInTheDocument();
    }
  });

  it('states the mechanism behind every control it does claim', async () => {
    renderPage();
    await openSecurity();
    const panel = screen.getByRole('tabpanel');
    // A claim with no named mechanism cannot be checked, which is how the
    // switches got there in the first place.
    for (const mechanism of ['PostgreSQL RLS', 'app.forbid_mutation()', 'SHA-256 key_hash',
                             'redaction', 'library_snapshots']) {
      expect(within(panel).getByText(new RegExp(mechanism.replace(/[.()]/g, '\\$&'))), mechanism)
        .toBeInTheDocument();
    }
  });

  it('does not present audit retention as a policy it enforces', async () => {
    renderPage();
    await openSecurity();
    const panel = screen.getByRole('tabpanel');
    // It used to read "Indefinite", which sounds like a decision somebody made.
    expect(within(panel).getByText('No policy set')).toBeInTheDocument();
    expect(within(panel).queryByText('Indefinite')).not.toBeInTheDocument();
  });

  it('still shows the audit properties that are genuinely enforced', async () => {
    renderPage();
    await openSecurity();
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('Trigger-enforced')).toBeInTheDocument();
    // Stated twice on purpose: once as an enforced control with its mechanism,
    // once on the ledger card itself.
    expect(within(panel).getAllByText(/cannot be edited or deleted/i).length).toBeGreaterThan(0);
  });
});

/*
 * Four counts over a table of connectors, each of which the reader had to match
 * against a column of status badges by eye.
 */
describe('the connector boxes', () => {
  it('narrows the connector table to the failed ones', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: /Integrations/ }));
    await user.click(screen.getByRole('button', { name: 'List the connectors that have failed' }));

    expect(screen.getByText('Showing the Failed connectors.')).toBeInTheDocument();
  });

  it('puts them all back', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: /Integrations/ }));
    const tile = () => screen.getByRole('button',
      { name: 'List the connectors whose last run did not fully succeed' });
    await user.click(tile());
    expect(tile()).toHaveAttribute('aria-pressed', 'true');
    await user.click(tile());
    expect(tile()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText(/Showing the Degraded connectors/)).not.toBeInTheDocument();
  });
});

/**
 * The three defects this screen carried, each pinned so it cannot return.
 *
 * All three were the same shape: a number or a list typed into the JSX, on the
 * screen whose subject is what the platform actually enforces. The audit card
 * claimed 18,442 events; the roles table listed eleven roles with invented user
 * counts; the approval thresholds were four string literals beside a caption
 * calling them governed values.
 */
describe('nothing on this screen is a number somebody typed', () => {
  it('reads the approval thresholds from the engine that routes on them', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: /estimating defaults/i }));
    const panel = screen.getByRole('tabpanel');

    /*
     * Asserted against the engine's own constants rather than against 95 / 80 /
     * 69 / 10%. Hard-coding the expected values here would recreate the defect
     * one layer further out: change a band in the engine and this test would
     * fail while the screen was still right, or pass while it was wrong.
     */
    expect(within(panel).getByText(String(CONFIDENCE_THRESHOLDS.autoAcceptFloor)))
      .toBeInTheDocument();
    expect(within(panel).getByText(String(CONFIDENCE_THRESHOLDS.seniorReviewFloor)))
      .toBeInTheDocument();
    expect(within(panel).getByText(percent(CONFIDENCE_THRESHOLDS.majorCostImpactShare)))
      .toBeInTheDocument();
  });

  it('shows no audit event count until one has been counted', async () => {
    renderPage();
    await openSecurity();
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('Events recorded')).toBeInTheDocument();
    /* The figure that used to read 18,442 on every company's screen. */
    expect(within(panel).queryByText('18,442')).not.toBeInTheDocument();
    expect(within(panel).getByText('—')).toBeInTheDocument();
  });

  it('keeps Billing and API Access as sections of this screen', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByRole('tab', { name: /^billing$/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /api access/i })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /api access/i }));
    /* Embedded, so the section does not stack a second page heading on the
       one Company Settings already has. */
    expect(screen.getAllByRole('heading', { name: /company settings/i }).length)
      .toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: /^API Access$/ })).not.toBeInTheDocument();
  });
});
