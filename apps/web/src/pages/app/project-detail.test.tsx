/**
 * The project screen, on the project's own data.
 *
 * This page read `PROJECTS` from `@/data/operations` and showed invented daily
 * reports, invented change orders and invented RFIs under a real project
 * number — reached by clicking a real row on a live projects list. A daily
 * report is the contemporaneous record of a day on site, so an invented one
 * filed under a real job is not merely wrong.
 *
 * Two things are tested here that the fixture version could not be. The
 * change-order boxes still have to filter the list beneath them, which is what
 * the original tests were for and they are kept. And the cost performance index
 * has to be a measurement: the formula this page used to carry, fed the live
 * cost-to-cost percent complete, reduces to actual cost over actual cost and
 * prints 1.00 forever. The figure now comes from earned value, and a project
 * with no task budgets says so in words instead of showing a number.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage } from '@/test/render';

const hoisted = vi.hoisted(() => ({
  project: null as unknown,
  money: null as unknown,
  progress: null as unknown,
  reports: [] as unknown[],
  changes: [] as unknown[],
  rfis: [] as unknown[],
  submittals: [] as unknown[],
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return true; },
  get supabase() { return {}; },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ projectId: 'p-1' }) };
});

vi.mock('@/lib/data/project', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/project')>('@/lib/data/project');
  return {
    ...actual,
    loadProject: () => async () => hoisted.project,
    loadProjectMoney: () => async () => hoisted.money,
    loadProjectProgress: () => async () => hoisted.progress,
    loadDailyReports: () => async () => hoisted.reports,
    loadChangeOrders: () => async () => hoisted.changes,
    loadProjectRfis: () => async () => hoisted.rfis,
    loadProjectSubmittals: () => async () => hoisted.submittals,
  };
});

const { ProjectDetailPage } = await import('./project-detail');

const project = (over: Record<string, unknown> = {}) => ({
  id: 'p-1', number: 'PRJ-2601', name: 'Sandusky transfer station', description: null,
  status: 'active', contractType: 'unit_price', contractValue: 1250000,
  originalBudget: 980000, approvedBudget: 980000,
  siteAddress: '1400 Venice Rd', siteCity: 'Sandusky', siteState: 'OH',
  latitude: 41.4489, longitude: -82.7079,
  plannedStart: '2026-06-01', plannedFinish: '2026-12-15',
  actualStart: null, actualFinish: null, retainagePercent: 0.05,
  customerName: 'Wood County Engineering',
  projectManager: 'Dale Whitcomb', superintendent: 'Marcy Kowalski',
  sourceEstimateNumber: null, sourceVersionNumber: null, ...over,
});

const finances = (over: Record<string, unknown> = {}) => ({
  contractValue: 1250000, approvedChangeOrders: 46000, revisedContractValue: 1296000,
  approvedBudget: 980000, actualCost: 210000, committedCost: 64000,
  laborCost: 96000, equipmentCost: 52000, materialCost: 40000, subcontractCost: 22000,
  billedToDate: 180000, retainageHeld: 9000, grossProfitToDate: 1086000, ...over,
});

const progress = (over: Record<string, unknown> = {}) => ({
  tasks: 2, tasksComplete: 1, budgetedCost: 400000, budgetedHours: 3200, actualHours: 1600,
  earnedValue: 175000, percentComplete: 0.4375,
  costPerformanceIndex: 0.8333, hoursPerformanceIndex: 0.875, ...over,
});

const change = (over: Record<string, unknown> = {}) => ({
  id: 'co-1', number: 'CO-001', title: 'Rock excavation at MH-5',
  reason: 'Differing site condition: limestone ledge at 9 ft, not shown on the borings.',
  origin: 'differing_site_condition', status: 'executed',
  costImpact: 38000, priceImpact: 46000, scheduleImpactDays: 4,
  submittedAt: '2026-08-20T00:00:00Z', decidedAt: '2026-08-27T00:00:00Z',
  executedAt: '2026-08-28T00:00:00Z',
  items: [{
    description: 'Rock excavation, machine', quantity: 180, unit: 'CY',
    unitPrice: 255.55, costAmount: 38000, priceAmount: 46000,
  }],
  ...over,
});

const pending = () => change({
  id: 'co-2', number: 'CO-002', title: 'Additional undercut at the scale pad',
  status: 'submitted', costImpact: 21000, priceImpact: 25000, scheduleImpactDays: 2,
  decidedAt: null, executedAt: null, items: [],
});

describe('the project screen', () => {
  beforeEach(() => {
    hoisted.project = project();
    hoisted.money = finances();
    hoisted.progress = progress();
    hoisted.reports = [];
    hoisted.changes = [change(), pending()];
    hoisted.rfis = [];
    hoisted.submittals = [];
  });

  it('names the real project, its customer and the two people responsible', async () => {
    renderPage(<ProjectDetailPage />);
    expect(await screen.findByText('Sandusky transfer station')).toBeInTheDocument();
    expect(screen.getByText(/PRJ-2601 · Wood County Engineering/)).toBeInTheDocument();
    expect(screen.getByText(/1400 Venice Rd, Sandusky, OH/)).toBeInTheDocument();
  });

  it('says a project is not there rather than showing somebody else’s', async () => {
    hoisted.project = null;
    renderPage(<ProjectDetailPage />);
    expect(await screen.findByText('No project with that address')).toBeInTheDocument();
  });

  // ------------------------------------------------- the figure that was fake
  describe('cost performance', () => {
    it('is earned value over actual cost, not a ratio that is one by construction', async () => {
      /*
       * $175,000 of budgeted work finished against $210,000 spent is 0.83. The
       * old formula — (budget x percent complete) / actual cost — fed the live
       * cost-to-cost percent complete would have printed 1.00 on every project
       * in the platform while looking like a measurement.
       */
      renderPage(<ProjectDetailPage />);
      expect(await screen.findByText(/Cost performance index 0\.83/)).toBeInTheDocument();
      expect(screen.getByText(/margin fade/)).toBeInTheDocument();
    });

    it('refuses to state a percent complete for a project nobody has broken down', async () => {
      hoisted.progress = null;
      const user = userEvent.setup();
      renderPage(<ProjectDetailPage />);
      await user.click(await screen.findByRole('tab', { name: 'Overview' }));
      expect(await screen.findByText('No task budgets to earn against')).toBeInTheDocument();
      // And no CPI alert claiming the job is underperforming on no evidence.
      expect(screen.queryByText(/Cost performance index/)).not.toBeInTheDocument();
    });

    it('weights progress by money, and shows the earned figure beside the spend', async () => {
      const user = userEvent.setup();
      renderPage(<ProjectDetailPage />);
      await user.click(await screen.findByRole('tab', { name: 'Overview' }));
      /*
       * Twice on purpose: the tile across the top and the bar under Overview
       * are the same figure, and a screen showing two different percentages
       * for one project is the defect this page was rebuilt to end.
       */
      expect(await screen.findAllByText('44%')).toHaveLength(2);
      expect(screen.getByText('$175,000.00')).toBeInTheDocument();
    });
  });

  // ------------------------------------------------ the boxes that had to work
  describe('the change order boxes', () => {
    it('narrows the list to the changes still awaiting a decision', async () => {
      const user = userEvent.setup();
      renderPage(<ProjectDetailPage />);
      await user.click(await screen.findByRole('tab', { name: /Change orders/ }));
      await user.click(screen.getByRole('button',
        { name: 'List the change orders awaiting a decision' }));

      expect(screen.getByText(/Showing the pending change orders/)).toBeInTheDocument();
      expect(screen.getByText(/CO-002/)).toBeInTheDocument();
      expect(screen.queryByText(/CO-001 — /)).not.toBeInTheDocument();
    });

    it('reaches the approved ones straight from the contract value', async () => {
      const user = userEvent.setup();
      renderPage(<ProjectDetailPage />);
      await user.click(await screen.findByRole('button',
        { name: 'Show the approved changes that moved the contract value' }));

      expect(screen.getByRole('tab', { name: /Change orders/ }))
        .toHaveAttribute('data-state', 'active');
      expect(screen.getByText(/Showing the approved and executed change orders/))
        .toBeInTheDocument();
    });

    it('puts them all back', async () => {
      const user = userEvent.setup();
      renderPage(<ProjectDetailPage />);
      await user.click(await screen.findByRole('tab', { name: /Change orders/ }));
      await user.click(screen.getByRole('button',
        { name: 'List the approved and executed change orders' }));
      await user.click(screen.getByRole('button', { name: 'Show all 2' }));

      expect(screen.queryByText(/Showing the approved and executed/)).not.toBeInTheDocument();
      expect(screen.getByText(/CO-002/)).toBeInTheDocument();
    });

    it('says what actual cost leaves out, which is what makes it misleading alone', async () => {
      const user = userEvent.setup();
      renderPage(<ProjectDetailPage />);
      await user.click(await screen.findByRole('button', { name: 'What is behind Actual cost' }));
      expect(screen.getByText(/spend, not commitment/)).toBeInTheDocument();
    });

    it('prices a change order with no line detail without pretending it has any', async () => {
      hoisted.changes = [pending()];
      const user = userEvent.setup();
      renderPage(<ProjectDetailPage />);
      await user.click(await screen.findByRole('tab', { name: /Change orders/ }));
      expect(await screen.findByText(/Priced in total, with no line detail recorded/))
        .toBeInTheDocument();
    });
  });

  // ----------------------------------------------------------- the field record
  describe('the field record', () => {
    it('shows a day on site with its labor, equipment and installed quantity', async () => {
      hoisted.reports = [{
        id: 'dr-1', reportDate: '2026-09-09', weatherSummary: 'Overcast',
        temperatureF: 54, precipitationIn: 0, workPerformed: 'Set 240 LF of 12 in. RCP storm.',
        delays: null, delayHours: 0, visitors: null, safetyNotes: null, crewCount: 7,
        submittedAt: '2026-09-09T22:00:00Z',
        labor: [{ classification: 'Operator', headcount: 2, straightHours: 8, overtimeHours: 1 }],
        equipment: [{
          description: 'CAT 336 excavator', units: 1, operatingHours: 7.5,
          idleHours: 0.5, downHours: 0, fuelGallons: 42,
        }],
        production: [{
          id: 'pa-1', workDate: '2026-09-09', quantity: 240, unit: 'LF', crewHours: 48,
          crewSize: 6, actualPerHour: 5, notes: null,
          estimatedPerHour: 4, estimatedRateCode: 'PR-UTL-STORM',
          estimatedMethod: 'Open cut', task: '12 in. RCP storm',
        }],
      }];
      renderPage(<ProjectDetailPage />);
      expect(await screen.findByText(/Set 240 LF of 12 in\. RCP storm\./)).toBeInTheDocument();
      expect(screen.getByText('2 × Operator')).toBeInTheDocument();
      expect(screen.getByText('1 × CAT 336 excavator')).toBeInTheDocument();
      expect(screen.getByText('7 on site')).toBeInTheDocument();
      // 5 LF/hr achieved against a 4 LF/hr catalog rate is 25% ahead.
      expect(screen.getByText(/\+25\.0%/)).toBeInTheDocument();
    });

    it('shows an em dash rather than a variance against a rate nobody recorded', async () => {
      hoisted.reports = [{
        id: 'dr-2', reportDate: '2026-09-08', weatherSummary: null, temperatureF: null,
        precipitationIn: null, workPerformed: 'Stripped topsoil.', delays: null, delayHours: 0,
        visitors: null, safetyNotes: null, crewCount: 4, submittedAt: null,
        labor: [], equipment: [],
        production: [{
          id: 'pa-2', workDate: '2026-09-08', quantity: 900, unit: 'CY', crewHours: 40,
          crewSize: 4, actualPerHour: 22.5, notes: null,
          estimatedPerHour: null, estimatedRateCode: null, estimatedMethod: null, task: null,
        }],
      }];
      const user = userEvent.setup();
      renderPage(<ProjectDetailPage />);
      await user.click(await screen.findByRole('tab', { name: 'Production' }));
      const cells = await screen.findAllByText('—');
      expect(cells.length).toBeGreaterThan(0);
      expect(screen.getByText('22.50 CY/hr')).toBeInTheDocument();
    });

    it('says nothing has been reported rather than showing an invented day', async () => {
      renderPage(<ProjectDetailPage />);
      expect(await screen.findByText('No daily reports yet')).toBeInTheDocument();
    });
  });

  it('counts open items from the real RFIs and submittals', async () => {
    hoisted.rfis = [{
      id: 'r-1', number: 'RFI-001', title: 'Invert elevation at MH-6 conflicts with profile',
      discipline: 'Civil', priority: 'high', status: 'open',
      dueAt: '2026-09-13T00:00:00Z', costImpact: 'Up to 60 LF of storm regrade.',
      question: 'Which governs?', answer: null,
    }];
    hoisted.submittals = [{
      id: 's-1', number: 'SUB-001', title: 'Precast structures', specSection: '33 44 00',
      vendorName: 'Norwalk Concrete', ballInCourt: 'architect', status: 'under_review',
      revision: 0, requiredOnSite: '2026-10-01', leadTimeDays: 30, reviewerComment: null,
    }];
    const user = userEvent.setup();
    renderPage(<ProjectDetailPage />);
    // One RFI, one submittal, one pending change.
    await user.click(await screen.findByRole('button',
      { name: 'List the open RFIs and submittals' }));
    expect(await screen.findByText('RFI-001')).toBeInTheDocument();
    expect(screen.getByText('Norwalk Concrete')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/1 RFI · 1 submittal · 1 change/))
      .toBeInTheDocument());
  });
});
