/**
 * Measuring, from the estimator's side.
 *
 * The arithmetic belongs to the engine and is tested there — 38 cases covering
 * scale calibration, pitch, deductions, self-intersection and every refusal.
 * What is tested here is the part that decides whether an estimator ever sees
 * any of it: the surface they click on, and the panel that reports how much the
 * number deserves to be believed.
 *
 * The reporting is the point. A traced roof and a traced roof at an unverified
 * scale produce the same number and are not the same claim, and if the screen
 * does not say so at the moment of tracing, nothing later will.
 */
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MeasurementOverlay, MINIMUM_POINTS, type Tool } from './overlay';
import { MeasurePanel, tryResolveScale } from './measure-panel';
import type { Point } from '@grounup/engine';

/** A 1000 x 600 sheet drawn at 500 screen px: sheet space is twice screen space. */
const SHEET = { width: 1000, height: 600, displayWidth: 500 };

function Harness({ tool, initial = [] }: { tool: Tool; initial?: Point[] }) {
  const [points, setPoints] = useState<Point[]>(initial);
  return (
    <div>
      <MeasurementOverlay
        tool={tool} {...SHEET} points={points} onPointsChange={setPoints} />
      <output data-testid="points">{JSON.stringify(points)}</output>
    </div>
  );
}

/** Click at a screen position within the overlay. */
async function clickAt(el: Element, x: number, y: number) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, right: 500, bottom: 300, width: 500, height: 300, x: 0, y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  await userEvent.pointer({ target: el, coords: { clientX: x, clientY: y }, keys: '[MouseLeft]' });
}

const points = () => JSON.parse(screen.getByTestId('points').textContent!) as Point[];

describe('the measuring surface', () => {
  it('records clicks in sheet space, not screen pixels', async () => {
    /*
     * The difference between the two is zoom, and a measurement that changes
     * when somebody zooms in to click accurately is not a measurement.
     */
    render(<Harness tool="linear" />);
    const svg = screen.getByRole('application');
    await clickAt(svg, 100, 50);
    expect(points()).toEqual([{ x: 200, y: 100 }]);
  });

  it('collects a path as the estimator traces it', async () => {
    render(<Harness tool="linear" />);
    const svg = screen.getByRole('application');
    await clickAt(svg, 0, 0);
    await clickAt(svg, 100, 0);
    await clickAt(svg, 100, 50);
    expect(points()).toHaveLength(3);
  });

  it('keeps a calibration to exactly two points', async () => {
    /*
     * A third point would silently redefine the scale that every measurement
     * already taken on this sheet was taken at. Starting over is the honest
     * behavior.
     */
    render(<Harness tool="calibrate" />);
    const svg = screen.getByRole('application');
    await clickAt(svg, 0, 0);
    await clickAt(svg, 200, 0);
    expect(points()).toHaveLength(2);
    await clickAt(svg, 50, 50);
    expect(points()).toEqual([{ x: 100, y: 100 }]);
  });

  it('takes no clicks when no tool is chosen', async () => {
    render(<Harness tool="none" />);
    expect(screen.queryByRole('application')).not.toBeInTheDocument();
    const svg = screen.getByRole('presentation');
    await clickAt(svg, 100, 100);
    expect(points()).toEqual([]);
  });

  it('draws a vertex for every point placed', async () => {
    render(<Harness tool="area" />);
    const svg = screen.getByRole('application');
    await clickAt(svg, 0, 0);
    await clickAt(svg, 100, 0);
    expect(screen.getByTestId('vertex-0')).toBeInTheDocument();
    expect(screen.getByTestId('vertex-1')).toBeInTheDocument();
  });

  it('knows how many points each shape needs', () => {
    expect(MINIMUM_POINTS.count).toBe(1);
    expect(MINIMUM_POINTS.linear).toBe(2);
    expect(MINIMUM_POINTS.area).toBe(3);
    expect(MINIMUM_POINTS.calibrate).toBe(2);
  });
});

describe('the live quantity', () => {
  const verified = tryResolveScale({
    from: { x: 0, y: 0 }, to: { x: 100, y: 0 },
    knownDistanceFeet: 20, basis: 'known_dimension',
    reference: "Dimension string 20'-0\" on C-301",
  });
  const scale = verified && 'scale' in verified ? verified.scale : null;

  const rectangle: Point[] = [
    { x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 300 }, { x: 0, y: 300 },
  ];

  it('shows the measured quantity as the estimator traces', () => {
    render(<MeasurePanel tool="area" points={rectangle} scale={scale} unit="SF" />);
    expect(screen.getByText('6,000.00')).toBeInTheDocument();
    expect(screen.getByText('SF')).toBeInTheDocument();
  });

  it('says a scale was verified, and against what', () => {
    render(<MeasurePanel tool="area" points={rectangle} scale={scale} unit="SF" />);
    expect(screen.getByText('verified scale')).toBeInTheDocument();
    expect(screen.getByText(/verified against a dimension printed/)).toBeInTheDocument();
  });

  it('warns at the moment of tracing that a scale is unverified', () => {
    /*
     * The whole reason the panel reports the method. An estimator who sees this
     * while tracing fixes the calibration; one who sees it never does not.
     */
    const stated = tryResolveScale({
      from: { x: 0, y: 0 }, to: { x: 100, y: 0 },
      knownDistanceFeet: 20, basis: 'stated_scale', reference: '',
    });
    render(<MeasurePanel tool="area" points={rectangle}
      scale={stated && 'scale' in stated ? stated.scale : null} unit="SF" />);
    expect(screen.getByText('approximate scale')).toBeInTheDocument();
    expect(screen.getByText(/Reissued and reduced prints/)).toBeInTheDocument();
  });

  it('refuses to measure a shape before a scale exists', () => {
    render(<MeasurePanel tool="linear" points={rectangle} scale={null} unit="LF" />);
    expect(screen.getByText('Set the scale first')).toBeInTheDocument();
    expect(screen.getByText(/number of pixels/)).toBeInTheDocument();
  });

  it('counts without a scale, because counting does not use one', () => {
    render(<MeasurePanel tool="count" points={[{ x: 1, y: 1 }, { x: 2, y: 2 }]}
      scale={null} unit="EA" />);
    expect(screen.getByText('2.00')).toBeInTheDocument();
    expect(screen.getByText('derived')).toBeInTheDocument();
  });

  it('says what is still needed rather than showing nothing', () => {
    render(<MeasurePanel tool="area" points={[{ x: 0, y: 0 }, { x: 1, y: 1 }]}
      scale={scale} unit="SF" />);
    expect(screen.getByText('Keep going')).toBeInTheDocument();
    expect(screen.getByText(/at least 3 points/)).toBeInTheDocument();
  });

  it('shows the pitch correction on a roof', () => {
    render(<MeasurePanel tool="area" points={rectangle} scale={scale} unit="SF"
      pitch={{ rise: 6, run: 12 }} />);
    expect(screen.getByText('x 1.11803')).toBeInTheDocument();
    expect(screen.getByText('6,708.20')).toBeInTheDocument();
  });

  it('shows the deduction it applied', () => {
    render(<MeasurePanel tool="area" points={rectangle} scale={scale} unit="SF"
      deductions={[[{ x: 50, y: 50 }, { x: 150, y: 50 }, { x: 150, y: 150 }, { x: 50, y: 150 }]]} />);
    expect(screen.getByText('(400.00 sq ft)')).toBeInTheDocument();
    expect(screen.getByText('5,600.00')).toBeInTheDocument();
  });

  it('exposes the full derivation, because a number nobody can check is one they must trust', () => {
    render(<MeasurePanel tool="area" points={rectangle} scale={scale} unit="SF" />);
    expect(screen.getByText('Full derivation')).toBeInTheDocument();
    expect(screen.getByText(/ft per unit/)).toBeInTheDocument();
  });

  it('reports a calibration that cannot be resolved instead of throwing', () => {
    const bad = tryResolveScale({
      from: { x: 10, y: 10 }, to: { x: 10, y: 10 },
      knownDistanceFeet: 20, basis: 'known_dimension', reference: 'x',
    });
    expect(bad && 'error' in bad ? bad.error : '').toMatch(/same point/);
  });
});
