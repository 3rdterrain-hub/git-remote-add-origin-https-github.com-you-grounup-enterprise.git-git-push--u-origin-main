/**
 * Moving around a drawing.
 *
 * The property that matters is the one people only notice when it is missing:
 * the point under the cursor does not move when you zoom. Without it, every
 * step pushes what you were looking at toward the edge, and on a 24×36 civil
 * sheet at 300% you lose your place on every notch.
 */
import { describe, expect, it } from 'vitest';
import {
  zoomAt, zoomByStep, fitToWidth, wheelFactor, panBy,
  MIN_ZOOM, MAX_ZOOM, BASE_WIDTH,
} from './canvas-navigation';

const view = (over: Partial<Parameters<typeof zoomAt>[4]> = {}) => ({
  clientWidth: 1000, clientHeight: 800, scrollLeft: 0, scrollTop: 0, ...over,
});

describe('zooming about a point', () => {
  it('leaves the point under the cursor where it was', () => {
    /*
     * The content position under the cursor is (scroll + cursor) / zoom. If it
     * is the same before and after, the drawing did not slide.
     */
    const before = view({ scrollLeft: 400, scrollTop: 300 });
    const cursor = { x: 250, y: 150 };
    const contentBefore = {
      x: (before.scrollLeft + cursor.x) / 1,
      y: (before.scrollTop + cursor.y) / 1,
    };

    const after = zoomAt(1, 2, cursor.x, cursor.y, before);
    const contentAfter = {
      x: (after.scrollLeft + cursor.x) / after.zoom,
      y: (after.scrollTop + cursor.y) / after.zoom,
    };

    expect(after.zoom).toBe(2);
    expect(contentAfter.x).toBeCloseTo(contentBefore.x, 6);
    expect(contentAfter.y).toBeCloseTo(contentBefore.y, 6);
  });

  it('holds the point steady zooming out as well as in', () => {
    const before = view({ scrollLeft: 900, scrollTop: 700 });
    const cursor = { x: 120, y: 640 };
    const contentBefore = {
      x: (before.scrollLeft + cursor.x) / 3,
      y: (before.scrollTop + cursor.y) / 3,
    };
    const after = zoomAt(3, 1 / 1.5, cursor.x, cursor.y, before);
    expect(after.zoom).toBeCloseTo(2, 6);
    expect((after.scrollLeft + cursor.x) / after.zoom).toBeCloseTo(contentBefore.x, 6);
    expect((after.scrollTop + cursor.y) / after.zoom).toBeCloseTo(contentBefore.y, 6);
  });

  it('never scrolls to a negative position', () => {
    // A sheet smaller than its container cannot be scrolled; asking would
    // leave the view stuck a pixel off its own corner.
    const after = zoomAt(1, 1 / 4, 10, 10, view());
    expect(after.scrollLeft).toBe(0);
    expect(after.scrollTop).toBe(0);
  });

  it('stops at the ends rather than going on forever', () => {
    expect(zoomAt(MAX_ZOOM, 2, 0, 0, view()).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(MIN_ZOOM, 0.5, 0, 0, view()).zoom).toBe(MIN_ZOOM);
  });

  it('leaves the scroll alone when the zoom cannot change', () => {
    const before = view({ scrollLeft: 123, scrollTop: 45 });
    const after = zoomAt(MAX_ZOOM, 2, 50, 50, before);
    expect(after.scrollLeft).toBe(123);
    expect(after.scrollTop).toBe(45);
  });
});

describe('the buttons', () => {
  it('zooms about the middle of the view, not the corner', () => {
    const before = view({ scrollLeft: 0, scrollTop: 0 });
    const after = zoomByStep(1, 1, before);
    expect(after.zoom).toBeCloseTo(1.25, 6);
    /* The middle stayed the middle: scroll grew by a quarter of half the view. */
    expect(after.scrollLeft).toBeCloseTo(500 * 0.25, 6);
    expect(after.scrollTop).toBeCloseTo(400 * 0.25, 6);
  });

  it('goes back to where it started after in and out', () => {
    const start = view({ scrollLeft: 200, scrollTop: 100 });
    const inOnce = zoomByStep(1, 1, start);
    const out = zoomByStep(inOnce.zoom, -1, { ...start, ...inOnce });
    expect(out.zoom).toBeCloseTo(1, 6);
    expect(out.scrollLeft).toBeCloseTo(200, 6);
    expect(out.scrollTop).toBeCloseTo(100, 6);
  });
});

describe('fitting the sheet to the view', () => {
  it('makes the sheet as wide as the view, less a margin', () => {
    expect(fitToWidth(BASE_WIDTH + 32)).toBeCloseTo(1, 6);
    expect(fitToWidth(1832)).toBeCloseTo(2, 6);
  });

  it('answers sensibly before the container has been measured', () => {
    expect(fitToWidth(0)).toBe(1);
  });

  it('will not fit beyond the ends', () => {
    expect(fitToWidth(100000)).toBe(MAX_ZOOM);
    expect(fitToWidth(40)).toBe(MIN_ZOOM);
  });
});

describe('the wheel', () => {
  it('zooms in on a push away and out on a pull back', () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
  });

  it('is symmetric, so a notch each way returns to the same zoom', () => {
    expect(wheelFactor(-40) * wheelFactor(40)).toBeCloseTo(1, 12);
  });

  it('takes a trackpad\'s small deltas gently and a flick firmly', () => {
    /* Many small events a second must not add up to a leap. */
    expect(wheelFactor(-4)).toBeLessThan(wheelFactor(-40));
    expect(wheelFactor(-4)).toBeGreaterThan(1);
  });

  it('caps a violent flick, so the sheet does not vanish', () => {
    expect(wheelFactor(-4000)).toBe(wheelFactor(-50));
    expect(wheelFactor(-4000)).toBeLessThanOrEqual(1.5);
  });
});

describe('panning', () => {
  it('moves the sheet with the hand, not against it', () => {
    // Dragging right moves the paper right, which means scrolling left.
    const after = panBy(view({ scrollLeft: 300, scrollTop: 200 }), 50, 25);
    expect(after.scrollLeft).toBe(250);
    expect(after.scrollTop).toBe(175);
  });

  it('stops at the edge of the sheet', () => {
    const after = panBy(view({ scrollLeft: 10, scrollTop: 10 }), 500, 500);
    expect(after.scrollLeft).toBe(0);
    expect(after.scrollTop).toBe(0);
  });
});
