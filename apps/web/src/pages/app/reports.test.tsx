/**
 * The reporting page, and the button that did nothing.
 *
 * P29 judged this page and found it computing from fixtures while eleven
 * governed reporting views went unread, with an Export button carrying no
 * handler at all. Its verdict said that making the button emit the fixtures it
 * displayed would be worse than leaving it inert, because a working control
 * over demonstration data reads as a finished feature.
 *
 * So it works when the data is real and stays disabled, with the reason on it,
 * when it is not.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage } from '@/test/render';
import { metricsToCsv, formatMetric, metricTone, type MetricValue } from '@/lib/data/reports';

const hoisted = vi.hoisted(() => ({ configured: true, metrics: [] as unknown[] }));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));
vi.mock('@/lib/data/reports', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/reports')>('@/lib/data/reports');
  return { ...actual, loadMetrics: async () => hoisted.metrics };
});
vi.mock('@/lib/data/project-view', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/project-view')>(
    '@/lib/data/project-view');
  return { ...actual, loadProjects: async () => [] };
});

const { ReportsPage } = await import('./reports');

const metric = (over: Partial<MetricValue> = {}): MetricValue => ({
  key: 'gross_margin_percent', name: 'Gross margin', description: 'Margin against revised contract.',
  domain: 'financial', unit: 'percent', value: 0.184, targetValue: 0.15, higherIsBetter: true,
  ...over,
});

describe('the reports page', () => {
  beforeEach(() => { hoisted.configured = true; hoisted.metrics = [metric()]; });

  it('renders a governed metric with its key and its definition', async () => {
    renderPage(<ReportsPage />);
    // Twice on purpose: once as a headline tile, once in its domain table.
    await waitFor(() => expect(screen.getAllByText('Gross margin')).toHaveLength(2));
    expect(screen.getByText('gross_margin_percent')).toBeInTheDocument();
    expect(screen.getByText('Margin against revised contract.')).toBeInTheDocument();
  });

  it('says when a metric is off its target', async () => {
    hoisted.metrics = [metric({ value: 0.04 })];
    renderPage(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('Off target')).toBeInTheDocument());
  });

  it('exports what is on screen', async () => {
    /*
     * The button P29 found carrying no handler. It builds the file from the
     * rows the page rendered rather than from a second query, so an export
     * cannot disagree with the figures somebody was looking at.
     */
    const clicks: string[] = [];
    const createUrl = vi.fn(() => 'blob:test');
    // jsdom implements neither, and a download is the whole point of the button.
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    });

    renderPage(<ReportsPage />);
    await waitFor(() => expect(screen.getAllByText('Gross margin').length).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole('button', { name: /export/i }));

    expect(createUrl).toHaveBeenCalledOnce();
    expect(clicks[0]).toMatch(/^grounup-metrics-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('refuses to export when there is nothing real to export', async () => {
    hoisted.configured = false;
    renderPage(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('Demonstration data')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled();
  });

  it('explains why there are no metrics without a workspace', async () => {
    // Rather than inventing values, which is what the semantic layer exists to
    // stop happening.
    hoisted.configured = false;
    renderPage(<ReportsPage />);
    await waitFor(() =>
      expect(screen.getByText('Governed metrics need a workspace')).toBeInTheDocument());
  });
});

describe('metric presentation', () => {
  it('formats each metric in the unit its own definition declares', () => {
    expect(formatMetric(metric({ unit: 'percent', value: 0.184 }))).toBe('18.4%');
    expect(formatMetric(metric({ unit: 'currency', value: 1_482_000 }))).toBe('$1,482,000');
    expect(formatMetric(metric({ unit: 'ratio', value: 3.14159 }))).toBe('3.14');
    expect(formatMetric(metric({ unit: 'hours', value: 1234.6 }))).toBe('1,235 hr');
    expect(formatMetric(metric({ unit: 'count', value: 7 }))).toBe('7');
  });

  it('shows a metric with no value as absent rather than as zero', () => {
    // A rate with no hours behind it is unanswerable, not zero — the
    // distinction migration 0041 was built around.
    expect(formatMetric(metric({ value: null }))).toBe('—');
  });

  it('judges a target by the direction the metric declares', () => {
    expect(metricTone(metric({ value: 0.2, targetValue: 0.15, higherIsBetter: true }))).toBe('success');
    expect(metricTone(metric({ value: 0.2, targetValue: 0.15, higherIsBetter: false }))).toBe('warn');
    expect(metricTone(metric({ targetValue: null }))).toBe('neutral');
  });

  it('escapes a description that would otherwise break the file', () => {
    const csv = metricsToCsv([metric({ description: 'Margin, "as bid", per line' })]);
    expect(csv).toContain('"Margin, ""as bid"", per line"');
    expect(csv.split('\n')[0]).toBe('key,name,domain,unit,value,target,higher_is_better,description');
  });
});
