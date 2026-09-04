/**
 * The step between signing up and using the platform.
 *
 * It did not exist. `app.provision_company()` had been complete and granted to
 * `authenticated` since migration 0011, and nothing outside the test suite had
 * ever called it — so a real sign-up produced an auth user and a profile and
 * stopped there. The sign-up form collected a company name into
 * `raw_user_meta_data`, where nothing read it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage } from '@/test/render';

const hoisted = vi.hoisted(() => ({
  configured: true,
  memberships: [] as unknown[],
  membershipError: null as string | null,
  created: [] as string[],
  createError: null as string | null,
  metadata: {} as Record<string, unknown>,
  navigated: [] as string[],
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() {
    return hoisted.configured
      ? { auth: { getUser: async () => ({ data: { user: { user_metadata: hoisted.metadata } } }) } }
      : null;
  },
}));
vi.mock('@/lib/data/session', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/session')>('@/lib/data/session');
  return {
    ...actual,
    loadMemberships: async () => {
      if (hoisted.membershipError) throw new Error(hoisted.membershipError);
      return hoisted.memberships;
    },
    createCompany: async (_client: unknown, name: string) => {
      if (hoisted.createError) throw new Error(hoisted.createError);
      hoisted.created.push(name);
      return 'company-1';
    },
  };
});
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => (to: string) => { hoisted.navigated.push(to); },
    Navigate: ({ to }: { to: string }) => {
      hoisted.navigated.push(to);
      return <div data-testid="redirect">{to}</div>;
    },
  };
});

const { OnboardingPage } = await import('./onboarding');

describe('creating a workspace', () => {
  beforeEach(() => {
    hoisted.configured = true;
    hoisted.memberships = [];
    hoisted.membershipError = null;
    hoisted.created = [];
    hoisted.createError = null;
    hoisted.metadata = {};
    hoisted.navigated = [];
  });

  it('creates the company and goes to the application', async () => {
    renderPage(<OnboardingPage />);
    await waitFor(() => expect(screen.getByLabelText('Company name')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('Company name'), 'Ridgeline Construction');
    await userEvent.click(screen.getByRole('button', { name: /Create workspace/ }));
    await waitFor(() => expect(hoisted.created).toEqual(['Ridgeline Construction']));
    expect(hoisted.navigated).toContain('/app');
  });

  it('uses the company name the sign-up form collected', async () => {
    /*
     * The form has always put it in `raw_user_meta_data` and nothing has ever
     * read it. Asking somebody to type their company name a second time,
     * minutes after they typed it the first time, is the tell that the two
     * halves were never joined.
     */
    hoisted.metadata = { company_name: 'Northshore Excavating' };
    renderPage(<OnboardingPage />);
    await waitFor(() =>
      expect(screen.getByLabelText('Company name')).toHaveValue('Northshore Excavating'));
  });

  it('will not submit a name that is not one', async () => {
    renderPage(<OnboardingPage />);
    await waitFor(() => expect(screen.getByLabelText('Company name')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Create workspace/ })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Company name'), 'A');
    expect(screen.getByRole('button', { name: /Create workspace/ })).toBeDisabled();
  });

  it('shows a refusal rather than pretending the workspace exists', async () => {
    /*
     * Navigating to an application with no tenant behind it would show every
     * screen empty and give no clue why. Worse than the error.
     */
    hoisted.createError = 'Could not find an available address for "Ridgeline"';
    renderPage(<OnboardingPage />);
    await waitFor(() => expect(screen.getByLabelText('Company name')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('Company name'), 'Ridgeline');
    await userEvent.click(screen.getByRole('button', { name: /Create workspace/ }));
    await waitFor(() =>
      expect(screen.getByText(/Could not find an available address/)).toBeInTheDocument());
    expect(hoisted.navigated).not.toContain('/app');
  });

  it('sends somebody who already has a workspace straight past it', async () => {
    hoisted.memberships = [{
      companyId: 'c-1', name: 'Ridgeline', slug: 'ridgeline', isOwner: true,
      roleKey: 'owner', roleName: 'Owner', planId: 'starter',
      entitlementActive: true, entitlementValidUntil: null, entitlementSource: 'trial',
    }];
    renderPage(<OnboardingPage />);
    await waitFor(() => expect(hoisted.navigated).toContain('/app'));
    expect(screen.queryByLabelText('Company name')).not.toBeInTheDocument();
  });

  it('shows a failed membership read rather than an empty form', async () => {
    // An empty membership list and a broken query look identical here and mean
    // opposite things: one needs a company created, the other needs fixing.
    hoisted.membershipError = 'JWT expired';
    renderPage(<OnboardingPage />);
    await waitFor(() => expect(screen.getByText('JWT expired')).toBeInTheDocument());
    expect(screen.queryByLabelText('Company name')).not.toBeInTheDocument();
  });

  it('has nothing to do in a build with no workspace behind it', async () => {
    hoisted.configured = false;
    renderPage(<OnboardingPage />);
    await waitFor(() => expect(hoisted.navigated).toContain('/app'));
  });
});
