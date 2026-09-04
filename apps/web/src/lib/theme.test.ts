import { describe, expect, it } from 'vitest';
import {
  buildTheme, buildScale, contrastRatio, readableTextOn, hexToRgb, rgbToHex,
  relativeLuminance, isHexColor, themeVariables, applyTheme, clearTheme,
  GROUNUP_BRAND, SCALE_STOPS, AA_NORMAL,
} from './theme';

describe('color conversion', () => {
  it('round-trips a hex color', () => {
    expect(rgbToHex(hexToRgb('#f6c101'))).toBe('#f6c101');
  });

  it('expands shorthand hex', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('rejects anything that is not a hex color', () => {
    for (const bad of ['red', 'rgb(0,0,0)', '#12345', '', '#gggggg']) {
      expect(isHexColor(bad), bad).toBe(false);
    }
    expect(() => hexToRgb('nope')).toThrow();
  });

  it('computes the WCAG reference luminances', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 6);
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 6);
  });

  it('computes the WCAG reference contrast ratio', () => {
    // Black on white is the definition of 21:1.
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#111827', '#f6c101')).toBe(contrastRatio('#f6c101', '#111827'));
  });
});

describe('text color selection', () => {
  it('puts dark text on the brand gold', () => {
    // The single most visible white-label failure is white text on a mid
    // yellow, so this is measured rather than assumed.
    expect(readableTextOn('#f6c101')).toBe('#111827');
  });

  it('puts white text on the brand charcoal', () => {
    expect(readableTextOn('#111827')).toBe('#ffffff');
  });

  it('always picks the higher-contrast option', () => {
    for (const c of ['#ffffff', '#000000', '#7f7f7f', '#2563eb', '#facc15', '#065f46']) {
      const chosen = readableTextOn(c);
      const other = chosen === '#ffffff' ? '#111827' : '#ffffff';
      expect(contrastRatio(c, chosen)).toBeGreaterThanOrEqual(contrastRatio(c, other));
    }
  });
});

describe('scale generation', () => {
  it('produces every stop', () => {
    const scale = buildScale('#f6c101');
    expect(Object.keys(scale).map(Number).sort((a, b) => a - b)).toEqual([...SCALE_STOPS]);
  });

  it('keeps the base color at 500', () => {
    expect(buildScale('#f6c101')[500]).toBe('#f6c101');
  });

  it('runs monotonically from light to dark', () => {
    const scale = buildScale('#2563eb');
    const luminances = SCALE_STOPS.map((s) => relativeLuminance(hexToRgb(scale[s])));
    for (let i = 1; i < luminances.length; i++) {
      expect(luminances[i]!, `stop ${SCALE_STOPS[i]} must be darker than ${SCALE_STOPS[i - 1]}`)
        .toBeLessThan(luminances[i - 1]!);
    }
  });

  it('keeps hue at both ends rather than washing out to gray', () => {
    const scale = buildScale('#2563eb');
    const spread = (hex: string) => {
      const { r, g, b } = hexToRgb(hex);
      return Math.max(r, g, b) - Math.min(r, g, b);
    };
    // Mixing to pure white or pure black is why generated palettes look gray.
    expect(spread(scale[50])).toBeGreaterThan(2);
    expect(spread(scale[950])).toBeGreaterThan(2);
  });

  it('gives a usable light tint and dark shade', () => {
    const scale = buildScale('#111827');
    expect(relativeLuminance(hexToRgb(scale[50]))).toBeGreaterThan(0.8);
    expect(relativeLuminance(hexToRgb(scale[950]))).toBeLessThan(0.05);
  });
});

describe('theme construction', () => {
  it('accepts the GrounUp brand with no complaints', () => {
    const theme = buildTheme(GROUNUP_BRAND);
    expect(theme.issues).toEqual([]);
    expect(theme.onAccent).toBe('#111827');
    expect(theme.onPrimary).toBe('#ffffff');
  });

  it('falls back and says so when a color is invalid', () => {
    const theme = buildTheme({ primary: 'chartreuse', accent: '#f6c101' });
    expect(theme.issues[0]!.severity).toBe('error');
    expect(theme.primary[500]).toBe(GROUNUP_BRAND.primary);
  });

  it('warns when text on the brand color will not meet AA', () => {
    // A mid gray sits in the band where neither white nor near-black text
    // clears 4.5:1 — the only case that genuinely cannot be rescued by
    // choosing the other text color.
    const theme = buildTheme({ primary: '#808080', accent: '#f6c101' });
    const warned = theme.issues.filter((i) => i.severity === 'warning');
    expect(warned.some((w) => w.message.includes(String(AA_NORMAL)))).toBe(true);
    expect(warned.some((w) => w.message.includes('primary'))).toBe(true);
    expect(theme.issues[0]!.severity).toBe('warning');
  });

  it('does not warn when one of the two text colors does clear AA', () => {
    // A pale yellow is unreadable under white text and perfectly readable
    // under dark text; picking the right one is the fix, not a warning.
    const theme = buildTheme({ primary: '#ffe680', accent: '#2563eb' });
    expect(theme.onPrimary).toBe('#111827');
    expect(theme.issues).toEqual([]);
  });

  it('does not silently correct a brand color it disagrees with', () => {
    // Telling the company its buttons will be unreadable is right; darkening
    // their brand behind their back is not.
    const theme = buildTheme({ primary: '#808080', accent: '#f6c101' });
    expect(theme.primary[500]).toBe('#808080');
  });

  it('warns when the two brand colors are nearly identical', () => {
    const theme = buildTheme({ primary: '#111827', accent: '#121926' });
    expect(theme.issues.some((i) => i.message.includes('nearly identical'))).toBe(true);
  });
});

describe('applying a theme', () => {
  it('emits a variable for every stop of both scales', () => {
    const vars = themeVariables(buildTheme(GROUNUP_BRAND));
    expect(Object.keys(vars)).toHaveLength(SCALE_STOPS.length * 2 + 2);
    expect(vars['--brand-accent-500']).toBe('#f6c101');
  });

  it('never emits a semantic color', () => {
    // Overdue is red in every tenant. "Stop" is not a brand decision.
    const names = Object.keys(themeVariables(buildTheme(GROUNUP_BRAND)));
    for (const semantic of ['success', 'warn', 'danger', 'info']) {
      expect(names.some((n) => n.includes(semantic))).toBe(false);
    }
  });

  it('writes and removes the properties on the root element', () => {
    const root = document.createElement('div');
    applyTheme(buildTheme({ primary: '#2563eb', accent: '#f6c101' }), root);
    expect(root.style.getPropertyValue('--brand-primary-500')).toBe('#2563eb');
    clearTheme(root);
    expect(root.style.getPropertyValue('--brand-primary-500')).toBe('');
  });

  it('leaves no property behind when cleared', () => {
    const root = document.createElement('div');
    applyTheme(buildTheme({ primary: '#8b5cf6', accent: '#22d3ee' }), root);
    clearTheme(root);
    expect(root.getAttribute('style')).toBeFalsy();
  });
});
