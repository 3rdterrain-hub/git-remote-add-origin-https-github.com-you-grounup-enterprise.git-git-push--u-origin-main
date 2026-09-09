/**
 * The ways into the application.
 *
 * Three things were wrong with this page, and two of them were asked for more
 * than once.
 *
 *   * A password field nobody could read. The only feedback on a mistyped
 *     character was a refusal that named none of them.
 *   * One way to sign in. The provider buttons have worked since they were
 *     written, but they appear only when a deployment names its providers in
 *     `VITE_OAUTH_PROVIDERS` — a variable that was documented nowhere, not even
 *     in `.env.example`. So on every deployment that had not guessed it, this
 *     page offered exactly one way in: a password.
 *   * "Explore the demonstration workspace" linked to `/app`, which is behind
 *     the session guard — so a signed-out visitor pressing it was returned to
 *     the page they were already looking at.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage } from '@/test/render';

const hoisted = vi.hoisted(() => ({
  configured: true,
  providers: [] as string[],
  otp: [] as Array<Record<string, unknown>>,
  otpError: null as string | null,
  password: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() {
    return hoisted.configured
      ? {
        auth: {
          signInWithOtp: async (args: Record<string, unknown>) => {
            hoisted.otp.push(args);
            return { error: hoisted.otpError ? new Error(hoisted.otpError) : null };
          },
          signInWithPassword: async (args: Record<string, unknown>) => {
            hoisted.password.push(args);
            return { error: null };
          },
          signUp: async () => ({ error: null }),
          resetPasswordForEmail: async () => ({ error: null }),
        },
      }
      : null;
  },
}));

vi.mock('@/lib/oauth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/oauth')>('@/lib/oauth');
  return { ...actual, enabledProviders: () => hoisted.providers };
});

const { AuthPage } = await import('./auth');

describe('reading the password you typed', () => {
  beforeEach(() => { hoisted.configured = true; hoisted.providers = []; });

  it('hides it to begin with, because somebody may be behind you', () => {
    renderPage(<AuthPage mode="login" />);
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Show password' }))
      .toHaveAttribute('aria-pressed', 'false');
  });

  it('shows it when the eye is pressed, and hides it again', async () => {
    const user = userEvent.setup();
    renderPage(<AuthPage mode="login" />);
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' }))
      .toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('does not submit the form when the eye is pressed', async () => {
    // A button inside a form submits it by default, and revealing a password
    // is not signing in.
    const user = userEvent.setup();
    renderPage(<AuthPage mode="login" />);
    await user.type(screen.getByLabelText('Work email'), 'sam@ridge.test');
    await user.type(screen.getByLabelText('Password'), 'a-real-password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(hoisted.password).toHaveLength(0);
  });

  it('offers the same eye when a password is being created', () => {
    renderPage(<AuthPage mode="signup" />);
    expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument();
  });

  it('asks for no password at all on the reset page', () => {
    renderPage(<AuthPage mode="reset" />);
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show password' })).not.toBeInTheDocument();
  });
});

describe('more than one way to sign in', () => {
  beforeEach(() => {
    hoisted.configured = true; hoisted.providers = [];
    hoisted.otp = []; hoisted.password = []; hoisted.otpError = null;
  });

  it('offers a one-time link even when no provider is configured', () => {
    renderPage(<AuthPage mode="login" />);
    expect(screen.getByRole('button', { name: /Email me a one-time sign-in link/ }))
      .toBeInTheDocument();
  });

  it('swaps the password for an email address, and swaps back', async () => {
    const user = userEvent.setup();
    renderPage(<AuthPage mode="login" />);
    await user.click(screen.getByRole('button', { name: /Email me a one-time sign-in link/ }));

    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send a sign-in link/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Use a password instead' }));
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('sends a link that signs in rather than one that creates an account', async () => {
    const user = userEvent.setup();
    renderPage(<AuthPage mode="login" />);
    await user.click(screen.getByRole('button', { name: /Email me a one-time sign-in link/ }));
    await user.type(screen.getByLabelText('Work email'), 'sam@ridge.test');
    await user.click(screen.getByRole('button', { name: /Send a sign-in link/ }));

    await waitFor(() => expect(hoisted.otp).toHaveLength(1));
    expect(hoisted.otp[0]).toMatchObject({
      email: 'sam@ridge.test',
      options: { shouldCreateUser: false },
    });
    // No password was collected, so none was sent.
    expect(hoisted.password).toHaveLength(0);
  });

  it('says the same thing whether or not the account exists', async () => {
    /*
     * An answer that distinguishes "no such account" from "link sent" tells an
     * attacker which addresses are registered. The reset path already refuses
     * to be that oracle and this one matches it.
     */
    const user = userEvent.setup();
    renderPage(<AuthPage mode="login" />);
    await user.click(screen.getByRole('button', { name: /Email me a one-time sign-in link/ }));
    await user.type(screen.getByLabelText('Work email'), 'nobody@ridge.test');
    await user.click(screen.getByRole('button', { name: /Send a sign-in link/ }));

    await waitFor(() =>
      expect(screen.getByText(/If that email has an account, a sign-in link is on its way/))
        .toBeInTheDocument());
  });

  it('offers the providers a deployment has actually configured', () => {
    hoisted.providers = ['google', 'azure'];
    renderPage(<AuthPage mode="login" />);
    expect(screen.getByRole('button', { name: /Continue with Google/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue with Microsoft/ })).toBeInTheDocument();
    // And never one nobody set up, which would lead to an error page.
    expect(screen.queryByRole('button', { name: /Continue with Apple/ })).not.toBeInTheDocument();
  });

  it('keeps the one-time link off the signup page, which provisions a workspace', () => {
    renderPage(<AuthPage mode="signup" />);
    expect(screen.queryByRole('button', { name: /one-time sign-in link/ }))
      .not.toBeInTheDocument();
  });
});

describe('the door to the demonstration workspace', () => {
  it('is offered where it can actually be reached', () => {
    hoisted.configured = false;
    renderPage(<AuthPage mode="login" />);
    expect(screen.getByRole('link', { name: 'Explore the demonstration workspace' }))
      .toHaveAttribute('href', '/app');
  });

  it('is not offered where pressing it returns you to this page', () => {
    hoisted.configured = true;
    renderPage(<AuthPage mode="login" />);
    expect(screen.queryByRole('link', { name: 'Explore the demonstration workspace' }))
      .not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign in/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create an account' })).toBeInTheDocument();
  });
});
