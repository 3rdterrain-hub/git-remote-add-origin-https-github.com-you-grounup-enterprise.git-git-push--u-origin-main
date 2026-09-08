/**
 * The measuring overlay, as a digitizer rather than a click target.
 *
 * The core was right from the start: coordinates live in sheet space, so a
 * measurement taken at 400% reads identically at 100%. What it lacked was
 * everything that makes a takeoff tool usable for a whole afternoon — keys,
 * squared-up lines, corners that meet, and a number while you draw rather than
 * after you stop.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { Point } from '@grounup/engine';
import { MeasurementOverlay } from './overlay';

const onPointsChange = vi.fn();
const onFinish = vi.fn();
const onUndo = vi.fn();
const onCancel = vi.fn();

beforeEach(() => {
  onPointsChange.mockClear(); onFinish.mockClear();
  onUndo.mockClear(); onCancel.mockClear();
});

const draw = (over: Partial<React.ComponentProps<typeof MeasurementOverlay>> = {}) =>
  render(
    <MeasurementOverlay
      tool="linear" width={1000} height={800} displayWidth={1000}
      points={[]} onPointsChange={onPointsChange}
      onFinish={onFinish} onUndo={onUndo} onCancel={onCancel}
      {...over} />);

describe('the keys a digitizer expects', () => {
  it('keeps the shape on Enter', () => {
    draw({ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('drops the last point on Backspace', () => {
    draw({ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] });
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('abandons the shape on Escape', () => {
    draw({ points: [{ x: 0, y: 0 }] });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('leaves the keys alone while somebody is typing a name', () => {
    // The name field sits beside the canvas. Backspace there deletes a letter.
    draw({ points: [{ x: 0, y: 0 }] });
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onUndo).not.toHaveBeenCalled();
    input.remove();
  });

  it('listens for nothing at all when no tool is active', () => {
    draw({ tool: 'none', points: [] });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onFinish).not.toHaveBeenCalled();
  });
});

/*
 * jsdom has no `PointerEvent`, so testing-library's `fireEvent.pointerDown`
 * builds a plain Event and drops clientX/clientY — every point would arrive as
 * NaN and every assertion below would be about nothing. A MouseEvent carries
 * the coordinates and React dispatches it to `onPointerDown` all the same.
 */
const pointer = (type: 'pointerdown' | 'pointermove', el: Element, x: number, y: number) =>
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
  });

describe('holding shift squares the line up', () => {
  const svg = () => screen.getByRole('application');
  const clickAt = (x: number, y: number, shift = false) => {
    if (shift) fireEvent.keyDown(window, { key: 'Shift' });
    pointer('pointerdown', svg(), x, y);
  };

  it('takes the raw point when shift is not held', () => {
    draw({ points: [{ x: 0, y: 0 }] });
    clickAt(100, 8);
    expect(onPointsChange).toHaveBeenCalledWith([{ x: 0, y: 0 }, { x: 100, y: 8 }]);
  });

  it('flattens a nearly-horizontal line onto the horizontal', () => {
    draw({ points: [{ x: 0, y: 0 }] });
    clickAt(100, 8, true);
    // The run beats the rise, so y comes from the point it started at.
    expect(onPointsChange).toHaveBeenCalledWith([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  });

  it('flattens a nearly-vertical line onto the vertical', () => {
    draw({ points: [{ x: 0, y: 0 }] });
    clickAt(6, 90, true);
    expect(onPointsChange).toHaveBeenCalledWith([{ x: 0, y: 0 }, { x: 0, y: 90 }]);
  });

  it('keeps a deliberate 45 rather than forcing it flat', () => {
    draw({ points: [{ x: 0, y: 0 }] });
    clickAt(100, 96, true);
    const [pts] = onPointsChange.mock.calls[0] as [Point[]];
    expect(pts[1]!.x).toBe(pts[1]!.y);
  });

  it('never constrains a count, which has no previous point to square to', () => {
    draw({ tool: 'count', points: [{ x: 0, y: 0 }] });
    clickAt(100, 8, true);
    expect(onPointsChange).toHaveBeenCalledWith([{ x: 0, y: 0 }, { x: 100, y: 8 }]);
  });
});

describe('corners meet', () => {
  const existing = [{ id: 'a', points: [{ x: 300, y: 300 }], kind: 'area' as const }];

  it('takes the vertex already on the sheet when the click lands near it', () => {
    // Two areas sharing a wall have to share its coordinates, or the quantity
    // carries a sliver nobody can see at 100% zoom.
    draw({ points: [{ x: 0, y: 0 }], existing });
    pointer('pointerdown', screen.getByRole('application'), 305, 303);
    expect(onPointsChange).toHaveBeenCalledWith([{ x: 0, y: 0 }, { x: 300, y: 300 }]);
  });

  it('leaves a click that is nowhere near it alone', () => {
    draw({ points: [{ x: 0, y: 0 }], existing });
    pointer('pointerdown', screen.getByRole('application'), 400, 400);
    expect(onPointsChange).toHaveBeenCalledWith([{ x: 0, y: 0 }, { x: 400, y: 400 }]);
  });

  it('can be turned off', () => {
    draw({ points: [{ x: 0, y: 0 }], existing, snap: false });
    pointer('pointerdown', screen.getByRole('application'), 305, 303);
    expect(onPointsChange).toHaveBeenCalledWith([{ x: 0, y: 0 }, { x: 305, y: 303 }]);
  });

  it('beats the shift constraint, because a named corner is more certain than a right angle', () => {
    draw({ points: [{ x: 0, y: 0 }], existing });
    fireEvent.keyDown(window, { key: 'Shift' });
    pointer('pointerdown', screen.getByRole('application'), 302, 301);
    expect(onPointsChange).toHaveBeenCalledWith([{ x: 0, y: 0 }, { x: 300, y: 300 }]);
  });
});

describe('the number while you draw', () => {
  it('says the segment length once the sheet has a scale', () => {
    // Whole feet at ten and above, a decimal below it: 9.4' is a dimension
    // somebody cares about and 128.3' is noise on a wall.
    draw({ points: [{ x: 0, y: 0 }], feetPerUnit: 0.1 });
    pointer('pointermove', screen.getByRole('application'), 100, 0);
    expect(screen.getByText("10'")).toBeInTheDocument();
  });

  it('keeps a decimal on a short run, where it matters', () => {
    draw({ points: [{ x: 0, y: 0 }], feetPerUnit: 0.1 });
    pointer('pointermove', screen.getByRole('application'), 94, 0);
    expect(screen.getByText("9.4'")).toBeInTheDocument();
  });

  it('adds the run so far once there is more than one segment', () => {
    draw({ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], feetPerUnit: 0.1 });
    pointer('pointermove', screen.getByRole('application'), 100, 100);
    expect(screen.getByText(/total/)).toBeInTheDocument();
  });

  it('says nothing before the sheet is calibrated', () => {
    // Sheet units look like feet and are not.
    draw({ points: [{ x: 0, y: 0 }], feetPerUnit: null });
    pointer('pointermove', screen.getByRole('application'), 100, 0);
    expect(screen.queryByText(/'/)).not.toBeInTheDocument();
  });
});
