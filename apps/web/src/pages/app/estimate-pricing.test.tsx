/**
 * Pricing, from the button.
 *
 * The browser prices nothing. Since migration 0058 the engine's output columns
 * refuse a hand-written value and the one function permitted to write them is
 * granted to `service_role` alone, which no browser session holds. So what is
 * tested here is the asking and — mostly — the reporting.
 *
 * The reporting matters more than it looks. A pricing run has four outcomes and
 * three of them are not errors. An estimate that will not price because a
 * machine has no rate in force is telling the estimator something specific and
 * fixable; showing them "pricing failed" instead would leave them guessing at a
 * bid they are about to send.
 *
 * With a workspace configured the route renders the live version screen, so
 * that is what these drive — the screen a paying estimator actually presses the
 * button on. The version it reads is stubbed; the outcome reporting is not.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage } from '@/test/render';

const hoisted = vi.hoisted(() => ({
  configured: true,
  canWrite: true,
  calls: [] as unknown[],
  outcome: null as unknown,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
  callFunction: async () => ({}),
}));
vi.mock('@/lib/data/session', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/session')>('@/lib/data/session');
  return { ...actual, usePermissions: () => ({ can: () => hoisted.canWrite, loading: false }) };
});
vi.mock('@/lib/data/pricing', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/pricing')>('@/lib/data/pricing');
  return {
    ...actual,
    priceEstimateVersion: async (id: string) => {
      hoisted.calls.push(id);
      return hoisted.outcome;
    },
  };
});
vi.mock('@/lib/data/estimates', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/estimates')>(
    '@/lib/data/estimates');
  return {
    ...actual,
    loadVersion: () => async () => ({
      id: 'ver-1', estimateId: 'e-1', estimateNumber: 'E-2026-0001',
      estimateName: 'Maumee Commerce Park', customerName: 'Maumee Development',
      versionNumber: 1, status: 'draft',
      directCost: 1_704_746.74, indirectCost: 96_000, totalMarkup: 665_665,
      totalPrice: 2_466_412.11, bidPrice: 2_466_500,
      totalLaborHours: 3_420, totalEquipmentHours: 2_800,
      blockedFromIssue: false, confidence: 88.5, engineVersion: '1.0.0',
      calculatedAt: '2026-09-01T09:00:00Z', librarySnapshotId: null,
      approvedAt: null, issuedAt: null,
      costs: { labor: 900_000, burden: 270_000, equipment: 534_746.74 },
      lines: [{
        id: 'l-1', sortOrder: 10, lineNumber: null, description: 'Mass excavation',
        serviceId: 's-1', serviceName: 'Mass excavation', costCode: 'CC-0006',
        unit: 'CY', measuredQuantity: 120_000, adjustedQuantity: 120_000,
        unitCost: 14.2, totalDirectCost: 1_704_746.74, laborHours: 3_420,
        equipmentHours: 2_800, confidenceBand: 'high', blocksIssue: false,
        hasProductionRate: true, clientVisible: true, markupOverride: null,
        wastePercent: 0, productionModifier: 1,
      }],
      show: { labor: false, equipment: false, materials: true, hauling: true,
              subcontract: true },
      assumptions: {
        shiftHours: 10, calendarEfficiency: 0.85, fuelPricePerGallon: 4.1,
        defPricePerGallon: 12.5, swellPercent: 0.25, shrinkPercent: 0.1,
        bidRoundingIncrement: 0,
      },
    }),
    loadDrift: () => async () => [],
    searchServices: () => async () => [],
  };
});
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ estimateId: 'ver-1' }) };
});

const { EstimateWorkspacePage } = await import('./estimate-workspace');

const priced = {
  status: 'priced' as const,
  result: {
    engineVersion: '1.0.0', directCost: 1_704_746.74, indirectCost: 96_000,
    totalPrice: 2_466_412.11, bidPrice: 2_466_500, grossMarginPercent: 0.213,
    weightedConfidence: 88.5, confidenceBand: 'reliable',
    recommendedContingency: 0.08, appliedContingency: 0.08,
    executiveDecision: 'ready_for_estimating', executiveDecisionReason: '',
    blockedFromIssue: false, totalLaborHours: 3_420, totalDurationDays: 62,
    warnings: [], lineCount: 10,
  },
};

const press = async () => {
  const button = await screen.findByRole('button', { name: /Price with engine/ });
  await userEvent.click(button);
};

describe('pricing an estimate from the workspace', () => {
  beforeEach(() => {
    hoisted.configured = true;
    hoisted.canWrite = true;
    hoisted.calls = [];
    hoisted.outcome = priced;
  });

  it('asks the engine to price the version in the address bar', async () => {
    renderPage(<EstimateWorkspacePage />);
    await press();
    await waitFor(() => expect(hoisted.calls).toEqual(['ver-1']));
  });

  it('reports the price with the engine that produced it', async () => {
    /*
     * The engine version is not decoration. A price with no provenance is the
     * defect migration 0058 exists to prevent, and it should be visible at the
     * moment the number appears.
     */
    renderPage(<EstimateWorkspacePage />);
    await press();
    await waitFor(() =>
      expect(screen.getByText(/Priced at \$2,466,500\.00 by engine 1\.0\.0/)).toBeInTheDocument());
    expect(screen.getByText(/Ready to issue/)).toBeInTheDocument();
  });

  it('says an estimate is still blocked even when it prices', async () => {
    // Pricing successfully and being fit to send are different questions.
    hoisted.outcome = {
      ...priced,
      result: {
        ...priced.result, blockedFromIssue: true,
        executiveDecision: 'rfi_resolution_required',
        executiveDecisionReason: 'One line depends on information the documents cannot resolve.',
      },
    };
    renderPage(<EstimateWorkspacePage />);
    await press();
    await waitFor(() =>
      expect(screen.getByText(/Still blocked from issue/)).toBeInTheDocument());
  });

  it('lists the holes rather than saying pricing failed', async () => {
    hoisted.outcome = {
      status: 'incomplete',
      message: 'This estimate is missing information the engine needs (2).',
      problems: [
        { lineId: 'l-1', field: 'equipment_rate',
          detail: 'Excavator 20-25 ton carries no rate in force.' },
        { lineId: null, field: 'pricing_profile',
          detail: 'This estimate version names no pricing profile.' },
      ],
    };
    renderPage(<EstimateWorkspacePage />);
    await press();
    await waitFor(() =>
      expect(screen.getByText(/Excavator 20-25 ton carries no rate in force/)).toBeInTheDocument());
    expect(screen.getByText(/names no pricing profile/)).toBeInTheDocument();
    expect(screen.getByText('equipment_rate')).toBeInTheDocument();
  });

  it('says plainly that nothing was written when it could not price', async () => {
    /*
     * The estimator has to know the estimate is unchanged. A half-priced
     * version is worse than an unpriced one, because it looks finished.
     */
    hoisted.outcome = { status: 'incomplete', message: 'missing', problems: [] };
    renderPage(<EstimateWorkspacePage />);
    await press();
    await waitFor(() => expect(screen.getByText(/Nothing was written/)).toBeInTheDocument());
  });

  it('explains a frozen version instead of showing a database exception', async () => {
    hoisted.outcome = {
      status: 'frozen',
      message: 'This version is issued and its price is frozen. Revise it to price again.',
    };
    renderPage(<EstimateWorkspacePage />);
    await press();
    await waitFor(() =>
      expect(screen.getByText(/Revise it to price again/)).toBeInTheDocument());
  });

  it('shows an outright failure as one', async () => {
    hoisted.outcome = { status: 'failed', message: 'Missing permission "estimates.write".' };
    renderPage(<EstimateWorkspacePage />);
    await press();
    await waitFor(() => expect(screen.getByText('Pricing did not run')).toBeInTheDocument());
  });

  it('disables the button for somebody whose role does not permit pricing', async () => {
    hoisted.canWrite = false;
    renderPage(<EstimateWorkspacePage />);
    expect(await screen.findByRole('button', { name: /Price with engine/ })).toBeDisabled();
  });

  it('offers no pricing button with no workspace behind it', async () => {
    // There is no engine to ask. A button that cannot work should not be there.
    hoisted.configured = false;
    renderPage(<EstimateWorkspacePage />);
    expect(screen.queryByRole('button', { name: /Price with engine/ })).not.toBeInTheDocument();
  });
});
