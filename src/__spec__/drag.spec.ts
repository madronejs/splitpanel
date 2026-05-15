import { describe, expect, it } from 'vitest';
import { dragHandle } from '../drag';
import { asContainerAxis } from '../length';
import type { Container, LengthInput } from '../types';
import { PanelDirection } from '../types';

/**
 * Minimal container builder for drag tests. Each entry is the min for that
 * child (or undefined for no min). We don't need any other field for the
 * drag math.
 */
function container(mins: Array<LengthInput | undefined>, maxes: Array<LengthInput | undefined> = []): Container {
  return {
    id: 'root',
    direction: PanelDirection.Row,
    children: mins.map((min, i) => ({
      id: `c${i}`,
      bounds: {
        ...(min == null ? {} : { min }),
        ...(maxes[i] == null ? {} : { max: maxes[i] }),
      },
    })),
  };
}

describe('dragHandle: single-handle, no cascade', () => {
  it('moves length from the immediate shrink neighbor to the immediate grow neighbor on right drag', () => {
    const c = container([undefined, undefined, undefined]);
    const sizes = [200, 200, 200];
    const initial = [...sizes];
    const applied = dragHandle(c, sizes, initial, 1, 50, asContainerAxis(600));

    expect(applied).toBe(50);
    expect(sizes).toEqual([250, 150, 200]);
  });

  it('mirrors for a left drag', () => {
    const c = container([undefined, undefined, undefined]);
    const sizes = [200, 200, 200];
    const applied = dragHandle(c, sizes, [...sizes], 1, -50, asContainerAxis(600));

    expect(applied).toBe(-50);
    expect(sizes).toEqual([150, 250, 200]);
  });

  it('returns 0 for a zero delta', () => {
    const c = container([undefined, undefined]);
    const sizes = [100, 100];

    expect(dragHandle(c, sizes, [100, 100], 1, 0, asContainerAxis(200))).toBe(0);
    expect(sizes).toEqual([100, 100]);
  });

  it('returns 0 for an out-of-range handle index', () => {
    const c = container([undefined, undefined]);
    const sizes = [100, 100];

    // 2 children → valid handles are 1 only; 0 is below, 2 is above.
    expect(dragHandle(c, sizes, [100, 100], 0, 50, asContainerAxis(200))).toBe(0);
    expect(dragHandle(c, sizes, [100, 100], 2, 50, asContainerAxis(200))).toBe(0);
    expect(sizes).toEqual([100, 100]);
  });
});

describe('dragHandle: cascade through neighbor mins', () => {
  it('takes from the next neighbor when the immediate one hits its min', () => {
    // Right drag: middle (idx 1) is the shrink side. Its min is 100; current 200.
    // Available room = 100. Then cascade into idx 2 (min 50, current 200, room 150).
    const c = container([undefined, '100px', '50px']);
    const sizes = [100, 200, 200];
    const applied = dragHandle(c, sizes, [...sizes], 1, 200, asContainerAxis(500));

    expect(applied).toBe(200);
    // idx 1 gave 100 to hit its min, idx 2 gave 100.
    expect(sizes).toEqual([300, 100, 100]);
  });

  it('caps `applied` when every shrink neighbor bottoms out', () => {
    const c = container([undefined, '100px', '50px']);
    const sizes = [100, 200, 200];
    // Asking for 500 but only 100+150 = 250 are takeable.
    const applied = dragHandle(c, sizes, [...sizes], 1, 500, asContainerAxis(500));

    expect(applied).toBe(250);
    expect(sizes).toEqual([350, 100, 50]);
  });

  it('respects the immediate grow neighbor\'s max', () => {
    const c = container([undefined, undefined, undefined], ['200px']);
    const sizes = [180, 200, 200];
    // Grow side (idx 0) starts at 180 and capped at 200 → only 20 can grow.
    const applied = dragHandle(c, sizes, [...sizes], 1, 100, asContainerAxis(580));

    expect(applied).toBe(20);
    expect(sizes).toEqual([200, 180, 200]);
  });
});

describe('dragHandle: LIFO recovery on reverse', () => {
  it('restores cascaded panels furthest-first when the drag reverses', () => {
    // First, drag right 200px to force a cascade.
    const c = container([undefined, '50px', '50px']);
    const sizes = [100, 200, 150];
    const initial = [...sizes];

    expect(dragHandle(c, sizes, initial, 1, 200, asContainerAxis(450))).toBe(200);
    expect(sizes).toEqual([300, 50, 100]);

    // Now drag left 200 back. Expect c (was 150, now 100) to restore first,
    // then b (was 200, now 50) — so c reaches 150 before b grows past 50.
    const back = dragHandle(c, sizes, initial, 1, -200, asContainerAxis(450));

    expect(back).toBe(-200);
    expect(sizes).toEqual([100, 200, 150]);
  });

  it('overflows extra growth into the immediate grow neighbor after all panels are restored', () => {
    // Same starting cascade — now drag left 400 (more than needed to recover).
    const c = container([undefined, '50px', '50px']);
    const sizes = [100, 200, 150];
    const initial = [...sizes];

    dragHandle(c, sizes, initial, 1, 200, asContainerAxis(450)); // forward cascade
    expect(sizes).toEqual([300, 50, 100]);

    // Asking for -400 — only 300 of A is available (no min on A → A_min=0).
    const back = dragHandle(c, sizes, initial, 1, -400, asContainerAxis(450));

    expect(back).toBe(-300);
    // Take from A: A had 300, gives 300 → A=0.
    // Give: restore C deficit (50, back to initial 150), restore B deficit
    // (150, back to initial 200). 100 left over → B expands past its initial
    // to 300. C lands at 150, not above.
    expect(sizes).toEqual([0, 300, 150]);
  });
});

describe('dragHandle: immediate-neighbor min', () => {
  it('floors the immediate at its min even when a small drag wouldn\'t reach it', () => {
    // Regression: dragHandle read immMax but not immMin. If the caller
    // passed in sizesPx with the immediate below its declared min
    // (because setBounds bumped min between drags via a path that
    // bypassed the wrapper's rebalance, or any other stale-state route),
    // a small drag delta would do a small transfer and leave the
    // immediate still below min. Now dragHandle floors the immediate
    // at its min on apply.
    //
    // Setup: A=50, min:80. B=200. Drag right by a small amount (20px).
    // Pre-fix: idx 1 gives 20 → A=70, B=180. A is below its 80 min.
    // Post-fix: A is floored to 80.
    const c = container(['80px', undefined]);
    const sizes = [50, 200];
    const initial = [...sizes];

    dragHandle(c, sizes, initial, 1, 20, asContainerAxis(300));

    expect(sizes[0]).toBeGreaterThanOrEqual(80);
  });
});

describe('dragHandle: edge cases', () => {
  it('no-ops a drag where the grow side is already capped and nothing can move', () => {
    const c = container([undefined, undefined], ['200px']);
    const sizes = [200, 100]; // grow side at its max
    const applied = dragHandle(c, sizes, [...sizes], 1, 50, asContainerAxis(300));

    expect(applied).toBe(0);
    expect(sizes).toEqual([200, 100]);
  });

  it('handles a two-child container (only handle 1 valid)', () => {
    const c = container([undefined, '40px']);
    const sizes = [100, 100];
    const applied = dragHandle(c, sizes, [...sizes], 1, 80, asContainerAxis(200));

    // Right drag: idx 1 has min 40, room 60.
    expect(applied).toBe(60);
    expect(sizes).toEqual([160, 40]);
  });

  it('treats pct mins relative to availPx', () => {
    // 25% of 400 = 100. So idx 1's min is 100.
    const c = container([undefined, '25%']);
    const sizes = [200, 200];
    const applied = dragHandle(c, sizes, [...sizes], 1, 200, asContainerAxis(400));

    expect(applied).toBe(100);
    expect(sizes).toEqual([300, 100]);
  });
});
