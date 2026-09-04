import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage as renderWithProviders } from '@/test/render';
import { ApiAccessPage } from './api-access';

const renderPage = () => renderWithProviders(<ApiAccessPage />);

describe('API key handling', () => {
  it('states that a key cannot be re-displayed', () => {
    renderPage();
    expect(screen.getByText(/only a hash of the key is stored/i)).toBeInTheDocument();
  });

  it('never renders a full key, only its prefix', () => {
    renderPage();
    // Every prefix is followed by an ellipsis; a complete secret would not be.
    for (const el of screen.getAllByText(/^gu_live_/)) {
      expect(el.textContent).toMatch(/…$/);
    }
  });

  it('distinguishes write scopes from read scopes', () => {
    renderPage();
    const write = screen.getAllByText(/:write$/);
    expect(write.length).toBeGreaterThan(0);
  });

  it('keeps a revoked key in the list instead of removing it', () => {
    renderPage();
    expect(screen.getByText('Estimating spreadsheet (legacy)')).toBeInTheDocument();
    expect(screen.getByText('Revoked')).toBeInTheDocument();
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
