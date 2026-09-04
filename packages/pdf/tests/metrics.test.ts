import { describe, expect, it } from 'vitest';
import { measure, wrap, truncate, sanitize, charWidth, TRANSLITERATIONS } from '../src/metrics.js';

describe('font metrics', () => {
  it('matches the Adobe Core-14 Helvetica widths', () => {
    // Spot-checked against the published AFM: a wrong width here silently
    // misaligns every right-aligned money column in the platform.
    expect(charWidth(' ', 'Helvetica')).toBe(278);
    expect(charWidth('0', 'Helvetica')).toBe(556);
    expect(charWidth('W', 'Helvetica')).toBe(944);
    expect(charWidth('i', 'Helvetica')).toBe(222);
    expect(charWidth('$', 'Helvetica')).toBe(556);
  });

  it('uses the bold widths for the bold face', () => {
    expect(charWidth('l', 'Helvetica-Bold')).toBe(278);
    expect(charWidth('l', 'Helvetica')).toBe(222);
  });

  it('gives every digit the same width, so columns line up', () => {
    const widths = new Set('0123456789'.split('').map((d) => charWidth(d, 'Helvetica')));
    expect(widths.size).toBe(1);
  });

  it('scales linearly with point size', () => {
    expect(measure('Hello', 'Helvetica', 20)).toBeCloseTo(measure('Hello', 'Helvetica', 10) * 2, 10);
  });

  it('measures the empty string as zero', () => {
    expect(measure('', 'Helvetica', 10)).toBe(0);
  });
});

describe('sanitizing', () => {
  it('passes ASCII through untouched', () => {
    const s = 'Excavate 1,240 CY @ $12.50 = $15,500.00';
    expect(sanitize(s).text).toBe(s);
    expect(sanitize(s).dropped).toEqual([]);
  });

  it('transliterates the punctuation the app actually emits', () => {
    // These are the characters that appear in real GrounUp copy; carrying
    // approximate widths for them instead would misalign tables by a hair.
    expect(sanitize('Cut — 4,629 CY').text).toBe('Cut -- 4,629 CY');
    expect(sanitize('32°F').text).toBe('32 degF');
    expect(sanitize("it's — “quoted”").text).toBe('it\'s -- "quoted"');
    expect(sanitize('20′ × 8″').text).toBe("20' x 8\"");
  });

  it('reports a character it could not map instead of hiding it', () => {
    const r = sanitize('unit 平米');
    expect(r.dropped).toEqual(['平', '米']);
    expect(r.text).toBe('unit ??');
  });

  it('has a mapping for every transliteration it claims', () => {
    for (const [from, to] of TRANSLITERATIONS) {
      expect(sanitize(from).text, from).toBe(to);
      expect(sanitize(from).dropped).toEqual([]);
    }
  });
});

describe('wrapping', () => {
  it('breaks on spaces and keeps every line inside the width', () => {
    const text = 'Excavate unsuitable material below design subgrade and replace with approved granular backfill compacted in eight inch lifts.';
    const lines = wrap(text, 'Helvetica', 9, 200);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(measure(l, 'Helvetica', 9)).toBeLessThanOrEqual(200);
    expect(lines.join(' ')).toBe(text);
  });

  it('breaks a word that is wider than the line rather than overrunning', () => {
    const long = 'SPEC-SECTION-31-23-33-TRENCHING-AND-BACKFILLING-SUPPLEMENT';
    const lines = wrap(long, 'Helvetica', 9, 60);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(measure(l, 'Helvetica', 9)).toBeLessThanOrEqual(60);
    expect(lines.join('')).toBe(long);
  });

  it('preserves explicit line breaks', () => {
    expect(wrap('one\ntwo', 'Helvetica', 10, 500)).toEqual(['one', 'two']);
  });

  it('keeps a blank line blank', () => {
    expect(wrap('a\n\nb', 'Helvetica', 10, 500)).toEqual(['a', '', 'b']);
  });

  it('returns the text unchanged when it already fits', () => {
    expect(wrap('short', 'Helvetica', 10, 500)).toEqual(['short']);
  });
});

describe('truncating', () => {
  it('leaves text that fits alone', () => {
    expect(truncate('Grading', 'Helvetica', 9, 200)).toBe('Grading');
  });

  it('ends in an ellipsis and still fits', () => {
    const out = truncate('Storm sewer installation, structures and restoration', 'Helvetica', 9, 80);
    expect(out.endsWith('...')).toBe(true);
    expect(measure(out, 'Helvetica', 9)).toBeLessThanOrEqual(80);
  });

  it('returns nothing when there is no room even for the ellipsis', () => {
    expect(truncate('anything', 'Helvetica', 9, 2)).toBe('');
  });
});
