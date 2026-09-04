/**
 * White-label runtime theming.
 *
 * A company sets a primary and an accent color; this derives the full scale
 * the interface needs and writes it to CSS custom properties. Deriving rather
 * than asking for eleven shades matters — nobody picks eleven shades correctly,
 * and a palette assembled by hand is where contrast failures come from.
 *
 * Two rules the derivation must not break:
 *
 *   1. Text must stay legible on every generated surface. Each pairing is
 *      checked against WCAG contrast, and a shade that fails is corrected
 *      rather than shipped.
 *   2. Semantic colors — success, warning, danger — are never re-themed.
 *      A red that means "stop" has to mean "stop" in every tenant, whatever
 *      their brand book says. Overdue and over budget are not brand decisions.
 */

export interface Brand {
  primary: string;
  accent: string;
}

export const GROUNUP_BRAND: Readonly<Brand> = Object.freeze({
  primary: '#111827',
  accent: '#F6C101',
});

export interface Rgb { r: number; g: number; b: number }

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: string): boolean {
  return HEX.test(value.trim());
}

export function hexToRgb(hex: string): Rgb {
  const m = HEX.exec(hex.trim());
  if (!m) throw new RangeError(`Not a hex color: ${hex}`);
  let h = m[1]!;
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const c = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Relative luminance, per WCAG 2.1 §. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.039_28 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colors, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(hexToRgb(a));
  const lb = relativeLuminance(hexToRgb(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(4));
}

/**
 * Whether white or near-black text reads better on this background.
 *
 * A brand accent that is a mid-yellow needs dark text; a deep navy needs white.
 * Getting this wrong is the single most visible white-label failure, so it is
 * measured rather than guessed at.
 */
export function readableTextOn(background: string): '#ffffff' | '#111827' {
  return contrastRatio(background, '#ffffff') >= contrastRatio(background, '#111827')
    ? '#ffffff' : '#111827';
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

export const SCALE_STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type ScaleStop = typeof SCALE_STOPS[number];

/**
 * An 11-stop scale around a base color.
 *
 * The base is placed at 500 and the rest interpolate toward near-white and
 * near-black. Pure white and pure black are avoided as endpoints: mixing to
 * #fff washes the hue out entirely at the light end, and to #000 kills it at
 * the dark end, which is why generated palettes so often look gray.
 */
export function buildScale(base: string): Record<ScaleStop, string> {
  const rgb = hexToRgb(base);
  const light: Rgb = { r: 252, g: 252, b: 253 };
  const dark: Rgb = { r: 10, g: 12, b: 16 };
  const t: Record<ScaleStop, number> = {
    50: -0.95, 100: -0.88, 200: -0.74, 300: -0.55, 400: -0.3,
    500: 0,
    600: 0.18, 700: 0.36, 800: 0.54, 900: 0.7, 950: 0.84,
  };
  const out = {} as Record<ScaleStop, string>;
  for (const stop of SCALE_STOPS) {
    const amount = t[stop];
    out[stop] = rgbToHex(amount < 0 ? mix(rgb, light, -amount) : mix(rgb, dark, amount));
  }
  return out;
}

export interface ThemeIssue {
  severity: 'error' | 'warning';
  message: string;
}

export interface Theme {
  primary: Record<ScaleStop, string>;
  accent: Record<ScaleStop, string>;
  /** Text color to place on a solid primary or accent fill. */
  onPrimary: string;
  onAccent: string;
  issues: ThemeIssue[];
}

/** Minimum contrast for interface text, WCAG AA at normal size. */
export const AA_NORMAL = 4.5;
/** WCAG AA for large text and for non-text interface components. */
export const AA_LARGE = 3;

/**
 * Build a theme and report what is wrong with it.
 *
 * Problems are reported rather than silently corrected. A company that picks a
 * pale yellow as its primary should be told its buttons will be hard to read,
 * not have its brand quietly darkened behind its back.
 */
export function buildTheme(brand: Brand): Theme {
  const issues: ThemeIssue[] = [];

  const safe = (value: string, fallback: string, name: string): string => {
    if (!isHexColor(value)) {
      issues.push({ severity: 'error', message: `${name} is not a valid hex color; falling back to ${fallback}.` });
      return fallback;
    }
    return value.trim().toLowerCase();
  };

  const primary = safe(brand.primary, GROUNUP_BRAND.primary, 'Primary color');
  const accent = safe(brand.accent, GROUNUP_BRAND.accent, 'Accent color');

  const onPrimary = readableTextOn(primary);
  const onAccent = readableTextOn(accent);

  const primaryContrast = contrastRatio(primary, onPrimary);
  const accentContrast = contrastRatio(accent, onAccent);

  if (primaryContrast < AA_NORMAL) {
    issues.push({
      severity: 'warning',
      message: `Text on the primary color reaches ${primaryContrast}:1, below the ${AA_NORMAL}:1 needed for normal text. Buttons and headers using it will be hard to read.`,
    });
  }
  if (accentContrast < AA_NORMAL) {
    issues.push({
      severity: 'warning',
      message: `Text on the accent color reaches ${accentContrast}:1, below the ${AA_NORMAL}:1 needed for normal text.`,
    });
  }

  // Two brand colors that are nearly the same defeat the point of having two.
  if (contrastRatio(primary, accent) < 1.5) {
    issues.push({
      severity: 'warning',
      message: 'The primary and accent colors are nearly identical, so accents will not read as accents.',
    });
  }

  return {
    primary: buildScale(primary),
    accent: buildScale(accent),
    onPrimary, onAccent, issues,
  };
}

/** The CSS custom properties a theme sets. Semantic colors are absent by design. */
export function themeVariables(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {
    '--brand-on-primary': theme.onPrimary,
    '--brand-on-accent': theme.onAccent,
  };
  for (const stop of SCALE_STOPS) {
    vars[`--brand-primary-${stop}`] = theme.primary[stop];
    vars[`--brand-accent-${stop}`] = theme.accent[stop];
  }
  return vars;
}

/**
 * Apply a theme to the document.
 *
 * Writing custom properties on the root element rather than injecting a
 * stylesheet keeps this compatible with the Tailwind build: the utility classes
 * are already generated and simply read whatever the variables currently hold.
 */
export function applyTheme(theme: Theme, root: HTMLElement): void {
  for (const [name, value] of Object.entries(themeVariables(theme))) {
    root.style.setProperty(name, value);
  }
}

/** Remove every property `applyTheme` sets, returning to the default palette. */
export function clearTheme(root: HTMLElement): void {
  for (const name of Object.keys(themeVariables(buildTheme(GROUNUP_BRAND)))) {
    root.style.removeProperty(name);
  }
}
