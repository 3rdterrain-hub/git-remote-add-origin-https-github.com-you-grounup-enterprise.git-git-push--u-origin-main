import { describe, expect, it } from 'vitest';
import { money, moneyCompact, qty, percent, integer, unitRate, relativeDays, titleCase, plural, date } from './format';

describe('money formatting', () => {
  it('formats to cents with grouping', () => {
    expect(money(1_597_963.11)).toBe('$1,597,963.11');
    expect(money(0)).toBe('$0.00');
    expect(money(-250.5)).toBe('-$250.50');
  });
  it('renders a missing value as an em dash rather than $0', () => {
    // A blank is honest; $0.00 would claim the cost is known to be nothing.
    expect(money(null)).toBe('—');
    expect(money(undefined)).toBe('—');
  });
  it('compacts large figures for KPI tiles', () => {
    expect(moneyCompact(2_330_000)).toBe('$2.3M');
    expect(moneyCompact(12_400_000)).toBe('$12M');
    expect(moneyCompact(690_000)).toBe('$690K');
    expect(moneyCompact(1_200)).toBe('$1.2K');
    expect(moneyCompact(940)).toBe('$940');
  });
  it('keeps four decimals on unit rates, where cents matter per unit', () => {
    expect(unitRate(9.6237)).toBe('$9.6237');
    expect(unitRate(112.5)).toBe('$112.50');
  });
});

describe('quantity and percent', () => {
  it('formats quantities at the requested precision', () => {
    expect(qty(43_054)).toBe('43,054.00');
    expect(qty(43_054, 0)).toBe('43,054');
    expect(qty(130.5234, 1)).toBe('130.5');
  });
  it('converts a fraction to a percent', () => {
    expect(percent(0.213)).toBe('21.3%');
    expect(percent(0.05, 0)).toBe('5%');
    expect(percent(null)).toBe('—');
  });
  it('rounds integers', () => {
    expect(integer(7182.24)).toBe('7,182');
    expect(integer(null)).toBe('—');
  });
});

describe('titleCase preserves construction acronyms', () => {
  it('does not turn RFI into Rfi', () => {
    expect(titleCase('rfi_required')).toBe('RFI Required');
    expect(titleCase('rfi_resolution_required')).toBe('RFI Resolution Required');
  });
  it('handles unit acronyms', () => {
    expect(titleCase('bcy')).toBe('BCY');
    expect(titleCase('export_required')).toBe('Export Required');
  });
  it('title-cases ordinary words', () => {
    expect(titleCase('senior_review')).toBe('Senior Review');
    expect(titleCase('company_actual')).toBe('Company Actual');
  });
});

describe('plural', () => {
  it('does not write "1 estimates"', () => {
    expect(plural(1, 'estimate')).toBe('1 estimate');
    expect(plural(0, 'estimate')).toBe('0 estimates');
    expect(plural(3, 'estimate')).toBe('3 estimates');
  });
  it('accepts an irregular plural', () => {
    expect(plural(1, 'opportunity', 'opportunities')).toBe('1 opportunity');
    expect(plural(4, 'opportunity', 'opportunities')).toBe('4 opportunities');
  });
});

describe('dates', () => {
  const now = new Date('2026-09-01T12:00:00Z');
  it('describes bid deadlines in days', () => {
    expect(relativeDays('2026-09-01T12:00:00Z', now)).toBe('today');
    expect(relativeDays('2026-09-02T12:00:00Z', now)).toBe('tomorrow');
    expect(relativeDays('2026-09-11T12:00:00Z', now)).toBe('in 10 days');
    expect(relativeDays('2026-08-25T12:00:00Z', now)).toBe('7 days ago');
  });
  it('does not shift a calendar date backwards by a day', () => {
    // A bare YYYY-MM-DD parses as UTC midnight, which renders as the previous
    // day anywhere west of Greenwich. A daily report dated the 31st must not
    // display as the 30th.
    expect(date('2026-08-31')).toBe('Aug 31, 2026');
    expect(date('2026-01-01')).toBe('Jan 1, 2026');
    expect(date('2026-12-31')).toBe('Dec 31, 2026');
  });

  it('still respects the time zone for a full timestamp', () => {
    // An instant genuinely has a zone; only bare dates are treated as local.
    expect(date('2026-08-31T23:59:00Z')).toMatch(/Aug 31, 2026|Sep 1, 2026/);
  });

  it('handles missing and invalid dates', () => {
    expect(relativeDays(null, now)).toBe('—');
    expect(date('not a date')).toBe('—');
    expect(date(null)).toBe('—');
  });
});
