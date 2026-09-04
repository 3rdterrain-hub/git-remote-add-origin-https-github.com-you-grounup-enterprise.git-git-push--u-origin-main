import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage as renderWithProviders } from '@/test/render';
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
