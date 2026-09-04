import { describe, expect, it } from 'vitest';
import {
  asphaltTons, convertUnit, convertVolume, cubicYardsFromArea, cubicYardsFromLinear,
  DEFAULT_SOIL_FACTORS, fromBank, inchesToFeet, isUnit, toBank, tonsFromVolume,
  UNIT_DIMENSION,
} from '../src/units.js';

describe('unit conversion inside a dimension', () => {
  it('converts area units against known factors', () => {
    expect(convertUnit(1, 'SY', 'SF')).toBe(9);        // 3ft x 3ft
    expect(convertUnit(9, 'SF', 'SY')).toBe(1);
    expect(convertUnit(1, 'ACRE', 'SF')).toBe(43560);
    expect(convertUnit(1, 'ACRE', 'SY')).toBe(4840);   // 43560 / 9
  });

  it('converts mass units', () => {
    expect(convertUnit(1, 'TON', 'LB')).toBe(2000);
    expect(convertUnit(3000, 'LB', 'TON')).toBe(1.5);
  });

  it('is identity for the same unit', () => {
    expect(convertUnit(123.456, 'CY', 'CY')).toBe(123.456);
  });

  it('refuses cross-dimension conversion that needs a physical property', () => {
    // CY -> TON requires density; SF -> CY requires thickness. Silently
    // inventing either is how estimates go wrong.
    expect(() => convertUnit(100, 'CY', 'TON')).toThrow(/Cannot convert CY \(volume\) to TON \(mass\)/);
    expect(() => convertUnit(100, 'SF', 'CY')).toThrow(/without a physical property/);
  });

  it('classifies every unit into a dimension', () => {
    expect(UNIT_DIMENSION.CY).toBe('volume');
    expect(UNIT_DIMENSION.SY).toBe('area');
    expect(UNIT_DIMENSION.LS).toBe('lumpsum');
    expect(isUnit('CY')).toBe(true);
    expect(isUnit('FURLONG')).toBe(false);
  });
});

describe('earthwork volume states', () => {
  const f = { swellPercent: 0.25, shrinkPercent: 0.1 };

  it('expands bank to loose by the swell factor', () => {
    // 1,000 BCY of common earth at 25% swell rides as 1,250 LCY.
    expect(fromBank(1000, 'LCY', f)).toBe(1250);
  });

  it('contracts bank to compacted by the shrink factor', () => {
    // 1,000 BCY compacts to 900 CCY at 10% shrink.
    expect(fromBank(1000, 'CCY', f)).toBe(900);
  });

  it('reverses each conversion exactly', () => {
    expect(toBank(1250, 'LCY', f)).toBe(1000);
    expect(toBank(900, 'CCY', f)).toBe(1000);
    expect(toBank(1000, 'BCY', f)).toBe(1000);
  });

  it('routes loose-to-compacted through bank', () => {
    // 1,250 LCY -> 1,000 BCY -> 900 CCY. Never 1,250 x 0.9 = 1,125.
    const r = convertVolume(1250, 'LCY', 'CCY', f);
    expect(r.bankEquivalent).toBe(1000);
    expect(r.output).toBe(900);
    expect(r.basis).toContain('1250 LCY / (1 + 0.25 swell) = 1000 BCY');
    expect(r.basis).toContain('1000 BCY x (1 - 0.1 shrink) = 900 CCY');
  });

  it('reports a no-op conversion honestly', () => {
    const r = convertVolume(500, 'BCY', 'BCY', f);
    expect(r.output).toBe(500);
    expect(r.basis).toBe('500 BCY (no state change)');
  });

  it('ships a documented default soil factor set', () => {
    expect(DEFAULT_SOIL_FACTORS.swellPercent).toBe(0.25);
    expect(DEFAULT_SOIL_FACTORS.shrinkPercent).toBe(0.1);
    expect(Object.isFrozen(DEFAULT_SOIL_FACTORS)).toBe(true);
  });

  it('rejects a shrink factor that would make soil vanish', () => {
    expect(() => fromBank(100, 'CCY', { swellPercent: 0.2, shrinkPercent: 1 })).toThrow(/shrinkPercent must be < 1/);
    expect(() => toBank(100, 'CCY', { swellPercent: 0.2, shrinkPercent: 1.5 })).toThrow(RangeError);
  });

  it('rejects negative volumes', () => {
    expect(() => toBank(-1, 'BCY', f)).toThrow(RangeError);
  });
});

describe('geometric quantity helpers', () => {
  it('computes trench CY from a linear run', () => {
    // 100 LF x 3 ft wide x 6 ft deep = 1,800 CF / 27 = 66.6667 CY
    expect(cubicYardsFromLinear(100, 3, 6)).toBe(66.6667);
  });

  it('computes CY from an area and thickness', () => {
    // 10,000 SF x 0.5 ft = 5,000 CF / 27 = 185.1852 CY
    expect(cubicYardsFromArea(10000, 0.5)).toBe(185.1852);
  });

  it('converts CY to tons at a stated density', () => {
    // 100 CY of compacted aggregate at 2,700 lb/CY = 135 tons
    expect(tonsFromVolume(100, 2700)).toBe(135);
  });

  it('requires a positive density', () => {
    expect(() => tonsFromVolume(100, 0)).toThrow(/densityLbPerCy must be > 0/);
  });

  it('converts inches to feet', () => {
    expect(inchesToFeet(6)).toBe(0.5);
    expect(inchesToFeet(8)).toBe(0.6667);
  });

  it('computes asphalt tonnage at the standard 110 lb/SY/in', () => {
    // 1,000 SY x 2 in x 110 lb / 2,000 = 110 tons
    expect(asphaltTons(1000, 2)).toBe(110);
    // A non-default mix density is honored.
    expect(asphaltTons(1000, 2, 112)).toBe(112);
  });
});
