import { supabase } from '@/lib/supabase';

/**
 * Signing in with somebody else's account.
 *
 * Which providers appear is read from a build-time variable rather than
 * guessed, because there is no way to ask Supabase which ones are configured
 * and a button for a provider nobody set up produces an error page instead of
 * a sign-in. Showing none is the honest default: this platform ships with
 * email, and a provider appears when whoever deployed it says it is ready.
 *
 *   VITE_OAUTH_PROVIDERS="google,apple"
 */
export type OAuthProvider = 'google' | 'apple' | 'azure' | 'github';

const LABEL: Record<OAuthProvider, string> = {
  google: 'Google',
  apple: 'Apple',
  azure: 'Microsoft',
  github: 'GitHub',
};

const KNOWN = Object.keys(LABEL) as OAuthProvider[];

/** The providers this deployment says are configured. */
export function enabledProviders(): OAuthProvider[] {
  const raw = import.meta.env.VITE_OAUTH_PROVIDERS as string | undefined;
  if (!raw) return [];
  return raw.split(',')
    .map((p) => p.trim().toLowerCase())
    .filter((p): p is OAuthProvider => (KNOWN as string[]).includes(p));
}

export function providerLabel(provider: OAuthProvider): string {
  return LABEL[provider];
}

/**
 * Hand off to the provider.
 *
 * The redirect comes back to `/auth/callback`, which exists so the shell can
 * wait for the session rather than a protected page deciding nobody is signed
 * in during the instant before the token is exchanged.
 */
export async function signInWith(provider: OAuthProvider): Promise<void> {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured, so there is no auth service to hand off to.');
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      /*
       * Ask Google for a refresh token and re-prompt for consent, so somebody
       * who revoked access can grant it again rather than being bounced
       * silently. Ignored by providers that do not use these.
       */
      queryParams: provider === 'google'
        ? { access_type: 'offline', prompt: 'consent' }
        : undefined,
    },
  });
  if (error) throw new Error(error.message);
}
