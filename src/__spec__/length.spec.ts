import { describe, expect, it } from 'vitest';
import {
  asContainerAxis, formatLength, parseLength, pxToPct, sizesFromPx, toPx,
} from '../length';

describe('parseLength', () => {
  it('parses bare numbers as px', () => {
    expect(parseLength(200)).toEqual({ unit: 'px', value: 200 });
  });

  it('parses px strings', () => {
    expect(parseLength('150px')).toEqual({ unit: 'px', value: 150 });
    expect(parseLength('-10px')).toEqual({ unit: 'px', value: -10 });
  });

  it('parses pct strings', () => {
    expect(parseLength('33.5%')).toEqual({ unit: 'pct', value: 33.5 });
  });

  it('parses `auto` as a single fr share', () => {
    expect(parseLength('auto')).toEqual({ unit: 'fr', value: 1 });
  });

  it('falls back to the provided default for undefined input', () => {
    const fallback = { unit: 'pct' as const, value: 25 };

    expect(parseLength(undefined, fallback)).toEqual(fallback);
  });

  it('falls back when the input is unparseable', () => {
    // 'nope' isn't a number, pct, px, or 'auto'. Default fallback is fr=1.
    expect(parseLength('nope' as unknown as undefined)).toEqual({ unit: 'fr', value: 1 });
  });
});

describe('formatLength', () => {
  it('round-trips px / pct', () => {
    expect(formatLength({ unit: 'px', value: 240 })).toBe('240px');
    expect(formatLength({ unit: 'pct', value: 33 })).toBe('33%');
  });

  it('renders fr as `<n>fr`', () => {
    expect(formatLength({ unit: 'fr', value: 1 })).toBe('1fr');
    expect(formatLength({ unit: 'fr', value: 2 })).toBe('2fr');
  });
});

describe('toPx', () => {
  it('is identity for px', () => {
    expect(toPx({ unit: 'px', value: 120 }, asContainerAxis(1000))).toBe(120);
  });

  it('resolves pct against containerAxisPx', () => {
    expect(toPx({ unit: 'pct', value: 25 }, asContainerAxis(800))).toBe(200);
  });

  it('returns NaN for fr — callers must branch on unit before calling', () => {
    // Previously toPx returned the denom as a "best-effort sentinel" for
    // fr, which silently concealed unit-mix bugs. NaN surfaces the
    // misuse at the first downstream comparison instead.
    expect(toPx({ unit: 'fr', value: 1 }, asContainerAxis(800))).toBeNaN();
  });
});

describe('pxToPct', () => {
  it('computes the share of containerAxisPx', () => {
    expect(pxToPct(200, asContainerAxis(800))).toBe(25);
  });

  it('returns 0 when containerAxisPx is non-positive (avoids /0)', () => {
    expect(pxToPct(100, asContainerAxis(0))).toBe(0);
    expect(pxToPct(100, asContainerAxis(-10))).toBe(0);
  });
});

describe('sizesFromPx', () => {
  // The core property: a saturated all-pct layout sums to exactly 100.
  // Without this invariant, sizesForCss scales pct entries by
  // `budget/container` and overflows when the storage sum exceeds 100.
  it('all-pct: storage sums to 100 when entries fill avail', () => {
    const out = sizesFromPx([300, 695], ['pct', 'pct'], 995);
    const sum = out.reduce((a, s) => a + (s.unit === 'pct' ? s.value : 0), 0);

    expect(out.every((s) => s.unit === 'pct')).toBe(true);
    expect(sum).toBeCloseTo(100, 5);
  });

  // Sibling stored as px stays px with its new pixel value; the pct
  // budget for the OTHER entries divides by `avail − newPxSum`, not
  // by the caller's pre-mutation total. This is the bug the helper
  // exists to prevent — three runtime sites had it independently.
  it('mixed px/pct: pct entry divides by avail − new pxSum, not the old sum', () => {
    // avail=995, markers stored as px=600, player as pct.
    // Budget for player's pct = avail − 600 = 395, so 395px → 100%.
    const out = sizesFromPx([395, 600], ['pct', 'px'], 995);

    expect(out[1]).toEqual({ unit: 'px', value: 600 });
    expect(out[0].unit).toBe('pct');
    expect((out[0] as { unit: 'pct', value: number }).value).toBeCloseTo(100, 5);
  });

  it('all-px: every entry passes through verbatim, no pct math', () => {
    const out = sizesFromPx([200, 300, 500], ['px', 'px', 'px'], 1000);

    expect(out).toEqual([
      { unit: 'px', value: 200 },
      { unit: 'px', value: 300 },
      { unit: 'px', value: 500 },
    ]);
  });

  // pxSum > avail can only happen with caller-side bugs (mins overflowing
  // the container); the helper clamps the budget at 0 rather than going
  // negative, and pxToPct returns 0 for a non-positive denominator. Pct
  // entries collapse to 0% — wrong, but not an exception, and CSS just
  // shrinks them to 0 instead of NaN-ing the whole layout.
  it('avail under-budgeted: pct entries collapse to 0% (non-negative budget)', () => {
    const out = sizesFromPx([100, 900], ['pct', 'px'], 500);

    expect(out[1]).toEqual({ unit: 'px', value: 900 });
    expect((out[0] as { unit: 'pct', value: number }).value).toBe(0);
  });

  it('returns a fresh array — callers can assign the result without aliasing', () => {
    const newPxs = [100, 200];
    const out = sizesFromPx(newPxs, ['pct', 'pct'], 300);

    expect(out).not.toBe(newPxs as unknown as typeof out);
  });
});
