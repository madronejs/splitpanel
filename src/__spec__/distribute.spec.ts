import { describe, expect, it } from 'vitest';
import { distributeProportional } from '../distribute';

const INF = Number.POSITIVE_INFINITY;

const sum = (arr: readonly number[]): number => arr.reduce((a, b) => a + b, 0);

describe('distributeProportional', () => {
  // Common case: no bounds bite, allocation is exactly proportional to weights.
  it('splits total proportional to weights when nothing clamps', () => {
    const out = distributeProportional(900, [1, 2, 3], [0, 0, 0], [INF, INF, INF]);

    // 900 split 1:2:3 → 150 : 300 : 450
    expect(out[0]).toBeCloseTo(150, 5);
    expect(out[1]).toBeCloseTo(300, 5);
    expect(out[2]).toBeCloseTo(450, 5);
    expect(sum(out)).toBeCloseTo(900, 5);
  });

  // Equal-share case (equalize semantics): all weights identical.
  it('falls back to equal shares when weights are all equal', () => {
    const out = distributeProportional(1000, [1, 1, 1, 1], [0, 0, 0, 0], [INF, INF, INF, INF]);

    expect(out).toEqual([250, 250, 250, 250]);
  });

  // Min snap: one entry's proportional share is below its min, so it
  // gets pinned at min and the others absorb the rest.
  it('snaps an entry to its min and redistributes', () => {
    const out = distributeProportional(1000, [1, 1, 1], [400, 0, 0], [INF, INF, INF]);

    // entry 0 would naively get 333; clamped up to 400. Remaining 600
    // split between entries 1 and 2 → 300 each.
    expect(out[0]).toBeCloseTo(400, 5);
    expect(out[1]).toBeCloseTo(300, 5);
    expect(out[2]).toBeCloseTo(300, 5);
    expect(sum(out)).toBeCloseTo(1000, 5);
  });

  // Max snap: the bug class the helper exists to defend against — the
  // marker-panel-balloons-past-max case generalized. Entry 1 hits its
  // 600 max; the spillover goes back to entries with room.
  it('snaps an entry to its max and redistributes', () => {
    const out = distributeProportional(1000, [1, 1], [0, 0], [INF, 600]);

    // entry 1 naively gets 500 — under its 600 max — no snap.
    // But pump up the total so entry 1 would overshoot:
    const out2 = distributeProportional(1400, [1, 1], [0, 0], [INF, 600]);

    expect(out2[1]).toBeCloseTo(600, 5);
    expect(out2[0]).toBeCloseTo(800, 5);
    expect(sum(out2)).toBeCloseTo(1400, 5);
    // smoke-test the under-max case
    expect(sum(out)).toBeCloseTo(1000, 5);
  });

  // Cascade: one snap creates a new infeasibility, triggering a second
  // pass. Worst case is O(N) passes — confirm convergence.
  it('cascades multiple snaps to convergence', () => {
    // total=1000, weights uniform → pass 1 share = 333.
    //   entry 0 min=400 → snap up (remaining 600, free=[1,2])
    //   entry 1 max=200 → was 333 in pass 1 — snap down? Pass 1 only
    //                     snaps one round; pass 2 re-evaluates with
    //                     remaining=600 split between 1 and 2 → 300
    //                     each. Entry 1 max=200 < 300 → snap. Pass 3:
    //                     remaining=400 for entry 2.
    const out = distributeProportional(1000, [1, 1, 1], [400, 0, 0], [INF, 200, INF]);

    expect(out[0]).toBeCloseTo(400, 5);
    expect(out[1]).toBeCloseTo(200, 5);
    expect(out[2]).toBeCloseTo(400, 5);
    expect(sum(out)).toBeCloseTo(1000, 5);
  });

  // Length-0 input: vacuously empty result, no infinite loop.
  it('returns empty array for empty input', () => {
    expect(distributeProportional(100, [], [], [])).toEqual([]);
  });

  // All weights zero → equal share fallback.
  it('falls back to equal share when all weights are zero', () => {
    const out = distributeProportional(900, [0, 0, 0], [0, 0, 0], [INF, INF, INF]);

    expect(out).toEqual([300, 300, 300]);
  });

  // Infeasible (Σmin > total): every entry pinned at its min, sum
  // exceeds total. Caller's problem to detect — helper just stays
  // non-NaN and terminates.
  it('terminates when Σmin > total (every entry pinned at min)', () => {
    const out = distributeProportional(100, [1, 1], [200, 200], [INF, INF]);

    expect(out).toEqual([200, 200]);
  });
});
