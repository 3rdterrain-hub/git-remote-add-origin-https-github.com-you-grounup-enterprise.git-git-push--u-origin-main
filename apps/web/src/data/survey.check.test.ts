import { describe, expect, it } from 'vitest';
import { SURFACE_COMPARISON, SURFACE_PROGRESS, ROAD_AEA, ROAD_PRISMOIDAL } from './survey';

describe('survey demo volumes are computed by the engine', () => {
  it('prints what the surfaces produce', () => {
    const c = SURFACE_COMPARISON;
    console.log(`
  cut          ${c.cutBcy.toLocaleString()} BCY over ${c.cutAreaSf.toLocaleString()} SF
  fill         ${c.fillCcy.toLocaleString()} CCY over ${c.fillAreaSf.toLocaleString()} SF
  net          ${c.netBcy.toLocaleString()}
  coverage     ${(c.coverage * 100).toFixed(1)}%  (${c.cellsCompared} compared, ${c.cellsSkipped} skipped)
  max cut      ${c.maxCutDepth} ft   avg ${c.averageCutDepth} ft
  max fill     ${c.maxFillDepth} ft   avg ${c.averageFillDepth} ft
  progress     ${(SURFACE_PROGRESS.percentComplete * 100).toFixed(1)}% · ${SURFACE_PROGRESS.cellsOverExcavated} cells over-dug (${SURFACE_PROGRESS.overExcavationBcy} BCY rework)
  road AEA     cut ${ROAD_AEA.cutBcy} / fill ${ROAD_AEA.fillCcy}
  road prism   cut ${ROAD_PRISMOIDAL.cutBcy} / fill ${ROAD_PRISMOIDAL.fillCcy} (${ROAD_PRISMOIDAL.segmentsWithoutMidSection} segments without a surveyed mid)`);
    expect(c.cutBcy).toBeGreaterThan(0);
  });

  it('has a sensible coverage after the boundary clip', () => {
    expect(SURFACE_COMPARISON.coverage).toBeGreaterThan(0.97);
    expect(SURFACE_COMPARISON.cellsSkipped).toBe(16);
  });

  it('produces both cut and fill, as a real site does', () => {
    expect(SURFACE_COMPARISON.cutBcy).toBeGreaterThan(0);
    expect(SURFACE_COMPARISON.fillCcy).toBeGreaterThan(0);
  });

  it('reports progress between 0 and 1 with over-excavation excluded', () => {
    expect(SURFACE_PROGRESS.percentComplete).toBeGreaterThan(0.6);
    expect(SURFACE_PROGRESS.percentComplete).toBeLessThanOrEqual(1);
    expect(SURFACE_PROGRESS.cellsOverExcavated).toBeGreaterThan(0);
  });

  it('shows the prismoidal correction on the one surveyed mid-section', () => {
    expect(ROAD_PRISMOIDAL.segmentsWithoutMidSection).toBe(4);
    expect(ROAD_PRISMOIDAL.fillCcy).not.toBe(ROAD_AEA.fillCcy);
  });
});
