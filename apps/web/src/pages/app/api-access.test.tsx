/**
 * API access, on real keys.
 *
 * The three tests that read a key's prefix, its scopes and its revocation used
 * to read them out of `src/data` — five invented keys on a live route, while
 * `api_keys` had no writer at all. Migration 0190 gave the table one, and the
 * page now lists what the company actually issued. So the keys these tests read
 * are supplied to the reader the page really calls, and a key that stops being
 * rendered fails here rather than being noticed by the owner.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage as renderWithProviders } from '@/test/render';
import type { ApiKeyRow } from '@/lib/data/api-keys';

const hoisted = vi.hoisted(() => ({ keys: [] as unknown[] }));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {},
}));

vi.mock('@/lib/data/session', () => ({
  usePermissions: () => ({ can: () => true, loading: false }),
  useCompanyId: () => ({ companyId: 'company-1', loading: false }),
}));

vi.mock('@/lib/data/api-keys', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/api-keys')>('@/lib/data/api-keys');
  return { ...actual, loadApiKeys: async () => hoisted.keys };
});

// eslint-disable-next-line import/first -- the mocks above must be declared first
import { ApiAccessPage } from './api-access';

/** A key as `loadApiKeys` returns one, with only the fields a test cares about set. */
const key = (over: Partial<ApiKeyRow> = {}): ApiKeyRow => ({
  id: 'key-1',
  name: 'Accounting export',
  keyPrefix: 'gu_live_4f2a',
  scopes: ['projects:read', 'estimates:write'],
  rateLimitPerMinute: 120,
  expiresAt: null,
  lastUsedAt: null,
  requestCount: 0,
  revokedAt: null,
  revokeReason: null,
  createdAt: '2026-08-01T12:00:00Z',
  createdBy: null,
  isRevoked: false,
  isExpired: false,
  requests30Days: 0,
  errors30Days: 0,
  ...over,
});

const renderPage = () => renderWithProviders(<ApiAccessPage />);

beforeEach(() => {
  hoisted.keys = [
    key(),
    key({
      id: 'key-2',
      name: 'Estimating spreadsheet (legacy)',
      keyPrefix: 'gu_live_91cd',
      scopes: ['estimates:read'],
      isRevoked: true,
      revokedAt: '2026-09-01T12:00:00Z',
      revokeReason: 'laptop lost',
    }),
  ];
});

describe('API key handling', () => {
  it('states that a key cannot be re-displayed', () => {
    renderPage();
    expect(screen.getByText(/only a hash of the key is stored/i)).toBeInTheDocument();
  });

  it('never renders a full key, only its prefix', async () => {
    renderPage();
    // Every prefix is followed by an ellipsis; a complete secret would not be.
    await waitFor(() => expect(screen.getAllByTitle(/copy the prefix/i)).toHaveLength(2));
    for (const el of screen.getAllByTitle(/copy the prefix/i)) {
      expect(el.textContent).toMatch(/^gu_live_[0-9a-f]+…$/);
    }
  });

  it('distinguishes write scopes from read scopes', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('estimates:write')).toBeInTheDocument());
    expect(screen.getByText('projects:read')).toBeInTheDocument();
  });

  it('keeps a revoked key in the list instead of removing it', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('Estimating spreadsheet (legacy)')).toBeInTheDocument());
    expect(screen.getByText(/^Revoked .+ — laptop lost$/)).toBeInTheDocument();
  });

  it('says so, rather than showing nothing, when no key has been issued', async () => {
    hoisted.keys = [];
    renderPage();
    await waitFor(() => expect(screen.getByText('No keys yet')).toBeInTheDocument());
  });

  it('shows every published endpoint with the scope it requires', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: /endpoints/i }));
    expect(screen.getByText('/v1/projects')).toBeInTheDocument();
    expect(screen.getByText(/the scope decides what kind of record/i)).toBeInTheDocument();
  });
});

describe('the endpoint list cannot drift from the gateway', () => {
  it('lists exactly the operations in the generated OpenAPI spec', async () => {
    const spec = (await import('@/data/openapi.json')).default as {
      paths: Record<string, Record<string, unknown>>;
    };
    const operations = Object.values(spec.paths).reduce((a, m) => a + Object.keys(m).length, 0);
    renderPage();
    // The spec is generated from the gateway's route table, so a route added
    // to the gateway appears here without anyone remembering to add it.
    // The label sits in a header row beside its icon; the value is the next
    // sibling of that row.
    expect(screen.getByText('Endpoints published').parentElement?.nextElementSibling?.textContent)
      .toBe(String(operations));
  });

  it('shows both methods where a path serves a read and a write', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: /endpoints/i }));
    expect(screen.getAllByText('/v1/equipment/{equipmentId}/hours')).toHaveLength(2);
  });
});

describe('the boxes across the top', () => {
  it('opens the endpoint list from the tile that counts endpoints', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'List the published endpoints' }));
    expect(screen.getByRole('tab', { name: 'Endpoints' })).toHaveAttribute('data-state', 'active');
  });

  it('says what counts as a failed request, which no list on the page shows', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'What is behind Error rate' }));
    expect(screen.getByText(/A refusal counts as a failure here/)).toBeInTheDocument();
  });
});
