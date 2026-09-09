/**
 * A door that goes somewhere, or no door.
 *
 * "Explore the demonstration workspace" linked to `/app`, which is behind the
 * session guard. With a Supabase project configured — which is every real
 * deployment — a signed-out visitor pressing it was redirected straight back to
 * the login page they were already looking at. It was tested by opening the app
 * and pressing it.
 *
 * The demonstration workspace is what a build with no project behind it shows,
 * and that is the only build where the button is a door.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderPage } from '@/test/render';

const hoisted = vi.hoisted(() => ({ configured: true }));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));

const { AuthPage } = await import('./auth');

describe('the sign-in page', () => {
  it('offers the demonstration workspace where it can actually be reached', () => {
    hoisted.configured = false;
    renderPage(<AuthPage mode="login" />);
    expect(screen.getByRole('link', { name: 'Explore the demonstration workspace' }))
      .toHaveAttribute('href', '/app');
  });

  it('does not offer it where pressing it returns you to this page', () => {
    hoisted.configured = true;
    renderPage(<AuthPage mode="login" />);
    expect(screen.queryByRole('link', { name: 'Explore the demonstration workspace' }))
      .not.toBeInTheDocument();
    // The two doors that do work are still here.
    expect(screen.getByRole('button', { name: /Sign in/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create an account' })).toBeInTheDocument();
  });
});
