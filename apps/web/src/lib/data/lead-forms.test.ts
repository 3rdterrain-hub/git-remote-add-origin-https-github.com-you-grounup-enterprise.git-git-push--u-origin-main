/**
 * The snippet a contractor pastes into their own website.
 *
 * Migration 0065 built a working public intake with no way to reach it. This is
 * the artifact that closes that gap, and it is the one thing this platform
 * produces that is *designed* to be published on the open internet by somebody
 * who is not a developer.
 *
 * So the first block is the security property, checked rather than described.
 * Two keys go into the page and both are public by design: the form key, which
 * addresses one form and can be switched off, and the anon key, which may call
 * exactly one function in the schema and select from nothing. Nothing else may
 * ever appear — no service key, no company id, no session, no second endpoint.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {},
  supabaseUrl: 'https://project.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon-payload.signature',
}));

const { embedSnippet, intakeUrl } = await import('./lead-forms');

const form = { publicKey: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' };
const snippet = embedSnippet(form);

// ---------------------------------------------------------------------------
describe('what the snippet is allowed to contain', () => {
  it('carries the form key, which is what addresses the form', () => {
    expect(snippet).toContain(form.publicKey);
  });

  it('carries the anon key, which is public by design', () => {
    /*
     * It is in the application bundle already, and `check-bundle.mjs`
     * deliberately does not treat it as a leak. What matters is that it is the
     * *anon* key: migration 0065 grants it execute on one function and select
     * on nothing.
     */
    expect(snippet).toContain('apikey');
  });

  it('carries no service role key and never names one', () => {
    expect(snippet.toLowerCase()).not.toContain('service_role');
    expect(snippet.toLowerCase()).not.toContain('secret');
    expect(snippet).not.toMatch(/sk_(live|test)_/);
  });

  it('carries no company id', () => {
    /*
     * The reason the form has its own key at all. A company id in a public page
     * would make the tenant identifier permanent and public, with no way to
     * retire it once the page was scraped.
     */
    expect(snippet).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it('sends no session and asks for no credentials', () => {
    expect(snippet).not.toContain('credentials');
    expect(snippet).not.toContain('Authorization');
    expect(snippet).not.toContain('access_token');
  });

  it('posts to the one function a stranger may call, and nowhere else', () => {
    const urls = snippet.match(/https?:\/\/[^"'\s]+/g) ?? [];
    expect(urls).toEqual(['https://project.supabase.co/rest/v1/rpc/submit_lead']);
  });

  it('reads nothing back', () => {
    // A form that confirms what it stored can be used to read what others stored.
    expect(snippet).not.toContain('GET');
    expect(snippet).not.toMatch(/\.select\(/);
  });
});

// ---------------------------------------------------------------------------
describe('whether a contractor can actually paste it', () => {
  it('needs no build step and no library', () => {
    expect(snippet).not.toContain('import ');
    expect(snippet).not.toContain('require(');
    expect(snippet).not.toMatch(/<script src=/);
  });

  it('asks for the one field the intake requires', () => {
    // `app.submit_lead` refuses a company_name under two characters.
    const line = snippet.split('\n').find((l) => l.includes('name="company_name"'))!;
    expect(line).toContain('required');
    expect(line).toContain('minlength="2"');
  });

  it('asks for both ways of replying, since the intake needs one of them', () => {
    expect(snippet).toContain('name="email"');
    expect(snippet).toContain('name="phone"');
  });

  it('names the fields the way the function reads them', () => {
    for (const p of ['p_key', 'p_company_name', 'p_contact_name', 'p_email',
      'p_phone', 'p_description', 'p_city', 'p_trap']) {
      expect(snippet, p).toContain(p);
    }
  });
});

// ---------------------------------------------------------------------------
describe('the honeypot', () => {
  it('carries the trap field the database reads', () => {
    expect(snippet).toContain('name="trap"');
  });

  it('hides it from people and from screen readers', () => {
    expect(snippet).toContain('aria-hidden="true"');
    expect(snippet).toContain('left:-5000px');
    expect(snippet).toContain('tabindex="-1"');
  });

  it('never labels it as a honeypot, which would tell a robot to skip it', () => {
    expect(snippet.toLowerCase()).not.toContain('honeypot');
  });
});

// ---------------------------------------------------------------------------
describe('the endpoint', () => {
  it('is the rpc the migration exposed', () => {
    expect(intakeUrl()).toBe('https://project.supabase.co/rest/v1/rpc/submit_lead');
  });

  it('is empty rather than malformed when nothing is configured', async () => {
    vi.resetModules();
    vi.doMock('@/lib/supabase', () => ({
      isSupabaseConfigured: false, supabase: null,
      supabaseUrl: null, supabaseAnonKey: null,
    }));
    const fresh = await import('./lead-forms');
    expect(fresh.intakeUrl()).toBe('');
    vi.doUnmock('@/lib/supabase');
  });
});
