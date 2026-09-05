import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * What a service is measured in.
 *
 * Every seeded service used to say lump sum — all 188 of them, including
 * common excavation, manhole installation and asphalt surface course. Nothing
 * failed and nothing was slow; an estimator who traced 1,400 cubic yards and
 * added the service to their bid simply had nowhere to put the 1,400.
 *
 * These tests hold the correction in place, and they name individual services
 * rather than checking a rule, because the rule is "the unit the trade actually
 * bids in" and no expression captures that.
 */
describe('what a service is measured in', () => {
  let h: Harness;

  beforeAll(async () => { h = await createHarness({ seed: true }); }, 180_000);
  afterAll(async () => { await h?.db.close(); });

  const unitOf = async (code: string) => {
    const [r] = await h.sql<{ unit: string }>(
      `select default_unit as unit from services where code = $1 and company_id is null`,
      [code]);
    return r?.unit;
  };

  it('measures anything moved by volume', async () => {
    for (const code of ['SVC-0005', 'SVC-0006', 'SVC-0007', 'SVC-0012', 'SVC-0125']) {
      expect(await unitOf(code), code).toBe('CY');
    }
  });

  it('measures anything laid by length', async () => {
    // Pipe, conduit and trench are bid by the foot in every price book there is.
    for (const code of ['SVC-0050', 'SVC-0051', 'SVC-0052', 'SVC-0056', 'SVC-0074']) {
      expect(await unitOf(code), code).toBe('LF');
    }
  });

  it('measures anything counted by the each', async () => {
    for (const code of ['SVC-0057', 'SVC-0058', 'SVC-0059', 'SVC-0102']) {
      expect(await unitOf(code), code).toBe('EA');
    }
  });

  it('measures asphalt mix by the ton and surface work by the square yard', async () => {
    for (const code of ['SVC-0086', 'SVC-0087', 'SVC-0088']) {
      expect(await unitOf(code), code).toBe('TON');
    }
    for (const code of ['SVC-0082', 'SVC-0090', 'SVC-0091']) {
      expect(await unitOf(code), code).toBe('SY');
    }
  });

  it('measures clearing by the acre, as the trade does', async () => {
    expect(await unitOf('SVC-0003')).toBe('ACRE');
    expect(await unitOf('SVC-0173')).toBe('ACRE');
  });

  it('measures tack coat by the gallon, because that is how it is bought', async () => {
    expect(await unitOf('SVC-0085')).toBe('GAL');
  });

  it('measures by the day the things that cost by the day', async () => {
    // Dewatering and traffic control cost what they cost whether or not
    // anything else got done.
    for (const code of ['SVC-0022', 'SVC-0048', 'SVC-0145', 'SVC-0170']) {
      expect(await unitOf(code), code).toBe('DAY');
    }
  });

  it('keeps lump sum for the services that genuinely have no measure', async () => {
    // A review, a coordination, a documentation package. Not an excavation.
    for (const code of ['SVC-0001', 'SVC-0064', 'SVC-0160', 'SVC-0188']) {
      expect(await unitOf(code), code).toBe('LS');
    }
  });

  it('leaves lump sum on only a small minority of the library', async () => {
    /*
     * The guard against the whole thing quietly reverting. Before this it was
     * 188 of 188; if it ever climbs back past a third, something has regressed
     * or somebody has added a trade without thinking about units.
     */
    const [r] = await h.sql<{ ls: string; total: string }>(
      `select count(*) filter (where default_unit = 'LS')::text as ls,
              count(*)::text as total
         from services where company_id is null and enterprise_group_id is null`);
    expect(Number(r!.total)).toBeGreaterThan(150);
    expect(Number(r!.ls) / Number(r!.total)).toBeLessThan(0.2);
  });

  it('never offers a unit the service cannot actually be bid in', async () => {
    // The old list gave every service the same nine units — tons on a survey,
    // hours on a manhole.
    const [r] = await h.sql<{ n: string }>(
      `select count(*)::text as n from services
        where company_id is null and array_length(supported_units, 1) > 4`);
    expect(Number(r!.n)).toBe(0);
  });

  it('always offers the unit it defaults to', async () => {
    // The check constraint says so; this proves the data satisfies it rather
    // than trusting that it was never violated.
    const [r] = await h.sql<{ n: string }>(
      `select count(*)::text as n from services
        where not (default_unit = any (supported_units))`);
    expect(Number(r!.n)).toBe(0);
  });

  it('lets a takeoff quantity land on the line it was measured for', async () => {
    /*
     * The thing this was all for. A cubic-yard measurement applied to a service
     * that says lump sum is a number with nowhere to go.
     */
    const [r] = await h.sql<{ unit: string; supported: string[] }>(
      `select default_unit as unit, supported_units as supported
         from services where code = 'SVC-0005'`);
    expect(r!.unit).toBe('CY');
    expect(r!.supported).toContain('CY');
  });
});
