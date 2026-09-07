import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  /*
   * A fresh browser for every test.
   *
   * Cards remember whether they were left open, per person, per screen — so
   * without this a test that opens a section leaves the next one starting from
   * a state it never asked for, and a click meant to open a card shuts it
   * instead. Four suites failed exactly that way the first time cards became
   * collapsible everywhere, and each looked like a bug in the component.
   */
  try { window.localStorage.clear(); } catch { /* a browser that blocks storage */ }
});

// jsdom does not implement these, and Radix primitives call them on mount.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  } as unknown as typeof ResizeObserver;
}
