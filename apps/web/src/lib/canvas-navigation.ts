/**
 * Moving around a drawing. ENGINE (of two small sums).
 *
 * Zoom was two buttons stepping 25% at a time, and the sheet scrolled in a
 * plain container. That is workable on a detail and useless on a 24×36 civil
 * sheet: getting from the title block to the north basin at 300% meant dragging
 * a scrollbar, and every zoom step pushed whatever you were looking at off the
 * edge, because the container grows from its top-left corner and the thing
 * under your cursor is nowhere near it.
 *
 * Two sums fix that. `zoomAt` keeps the point under the cursor under the cursor
 * — the behavior every PDF viewer, CAD tool and takeoff product shares, and the
 * one people notice only when it is missing. `fitToWidth` answers "show me the
 * whole sheet", which is where a takeoff starts and what you come back to
 * between measurements.
 *
 * Kept out of the component because it is arithmetic, and arithmetic inside an
 * event handler is arithmetic with no test.
 */

/** How far the zoom can go, and the step a click or a wheel notch takes. */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 8;

/** The unzoomed width the sheet is drawn at. */
export const BASE_WIDTH = 900;

export interface Viewport {
  /** The scrolling container's visible size. */
  clientWidth: number;
  clientHeight: number;
  scrollLeft: number;
  scrollTop: number;
}

export interface ZoomResult {
  zoom: number;
  scrollLeft: number;
  scrollTop: number;
}

const clamp = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * Zoom about a point, so that point does not move.
 *
 * `x` and `y` are where the cursor is inside the container, in pixels from its
 * top-left. The content position under it is `(scroll + cursor) / zoom`; after
 * the zoom changes, the scroll that puts that same content position back under
 * the same cursor is `content * newZoom - cursor`.
 *
 * Negative scroll is clamped to zero: a sheet smaller than its container cannot
 * be scrolled, and asking for it would leave the view stuck one pixel off.
 */
export function zoomAt(
  current: number, factor: number, x: number, y: number, view: Viewport,
): ZoomResult {
  const next = clamp(current * factor);
  if (next === current) {
    return { zoom: current, scrollLeft: view.scrollLeft, scrollTop: view.scrollTop };
  }
  const ratio = next / current;
  return {
    zoom: next,
    scrollLeft: Math.max(0, (view.scrollLeft + x) * ratio - x),
    scrollTop: Math.max(0, (view.scrollTop + y) * ratio - y),
  };
}

/** Zoom a step, about the middle of the view — what the − and + buttons do. */
export function zoomByStep(
  current: number, direction: 1 | -1, view: Viewport,
): ZoomResult {
  return zoomAt(current, direction === 1 ? 1.25 : 1 / 1.25,
    view.clientWidth / 2, view.clientHeight / 2, view);
}

/**
 * The zoom at which the whole sheet is as wide as the view.
 *
 * A margin is taken off so the sheet does not touch the edges, which is where
 * a border gets lost against the container.
 */
export function fitToWidth(clientWidth: number, margin = 32): number {
  if (!(clientWidth > 0)) return 1;
  return clamp((clientWidth - margin) / BASE_WIDTH);
}

/**
 * A wheel notch to a zoom factor.
 *
 * Trackpads report small fractional deltas many times a second and mice report
 * one large one, so the factor is taken from the sign and magnitude together
 * rather than from a fixed step. Capped so a violent flick does not jump from
 * the whole sheet to a rivet.
 */
export function wheelFactor(deltaY: number): number {
  const magnitude = Math.min(Math.abs(deltaY), 50) / 100;
  return deltaY < 0 ? 1 + magnitude : 1 / (1 + magnitude);
}

/** Where a drag of the sheet leaves the scroll position. */
export function panBy(
  view: Viewport, dx: number, dy: number,
): { scrollLeft: number; scrollTop: number } {
  return {
    scrollLeft: Math.max(0, view.scrollLeft - dx),
    scrollTop: Math.max(0, view.scrollTop - dy),
  };
}
