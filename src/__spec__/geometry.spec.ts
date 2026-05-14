import { describe, expect, it } from 'vitest';
import { axisExtent, measureAxis, measureChildrenPx } from '../geometry';
import { PanelDirection } from '../types';

const rect = (width: number, height: number): DOMRect => ({
  x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}),
} as DOMRect);

describe('axisExtent', () => {
  it('returns width for row direction', () => {
    expect(axisExtent(rect(800, 400), PanelDirection.Row)).toBe(800);
  });

  it('returns height for column direction', () => {
    expect(axisExtent(rect(800, 400), PanelDirection.Column)).toBe(400);
  });
});

describe('measureAxis', () => {
  // Pure unit test — the element is a tiny stub that returns a fixed
  // rect, so we don't need a real DOM environment.
  it('reads the active axis from getBoundingClientRect', () => {
    const el = { getBoundingClientRect: () => rect(1000, 500) } as HTMLElement;

    expect(measureAxis(el, PanelDirection.Row)).toBe(1000);
    expect(measureAxis(el, PanelDirection.Column)).toBe(500);
  });
});

describe('measureChildrenPx', () => {
  const container = {} as HTMLElement;
  const child = (w: number) => ({ getBoundingClientRect: () => rect(w, 100) } as HTMLElement);

  it('maps the i-th child to its axis size via the resolver', () => {
    const children = [child(100), child(200), child(300)];
    const out = measureChildrenPx(container, PanelDirection.Row, 3, (_, i) => children[i]);

    expect(out).toEqual([100, 200, 300]);
  });

  // The fallback matters: structural mutators detach + re-add resizer
  // DOM, and a measurement that races the mutation should fall through
  // to 0 rather than crash on a missing element.
  it('returns 0 for indices the resolver can\'t find', () => {
    const out = measureChildrenPx(container, PanelDirection.Row, 3, (_, i) => (
      i === 1 ? undefined : child(50)
    ));

    expect(out).toEqual([50, 0, 50]);
  });

  it('returns an empty array when count is 0', () => {
    expect(measureChildrenPx(container, PanelDirection.Row, 0, () => undefined)).toEqual([]);
  });
});
