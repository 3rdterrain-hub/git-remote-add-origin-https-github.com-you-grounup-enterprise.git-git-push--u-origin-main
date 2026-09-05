import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The suite must not read the developer's own workspace.
 *
 * This was found the hard way. Vite loads `.env.local` for tests as readily as
 * for a dev server, so the moment a real Supabase project was connected, two
 * unrelated tests began failing: `isSupabaseConfigured` flipped to true, and a
 * screen that falls back to the sample user for permissions stopped falling
 * back. Those tests had been passing because of an absent file.
 *
 * A test whose result depends on whether the person running it has connected a
 * database is not a test. This holds the fix in place.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('the test environment', () => {
  it('sees an unconfigured build regardless of what is in .env.local', () => {
    expect(import.meta.env.VITE_SUPABASE_URL).toBeFalsy();
    expect(import.meta.env.VITE_SUPABASE_ANON_KEY).toBeFalsy();
  });

  it('reports the workspace as unconfigured, which is what the screens branch on', async () => {
    const { isSupabaseConfigured, supabase } = await import('@/lib/supabase');
    expect(isSupabaseConfigured).toBe(false);
    expect(supabase).toBeNull();
  });

  it('pins the override in the config rather than relying on a missing file', () => {
    /*
     * The property is worth asserting directly: somebody removing this line
     * would not see a failure until they happened to have a workspace
     * connected, which is exactly how this was missed the first time.
     */
    const config = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
    expect(config).toMatch(/env:\s*\{\s*VITE_SUPABASE_URL:\s*''/);
  });
});
