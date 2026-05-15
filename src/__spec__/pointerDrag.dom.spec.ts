// @vitest-environment happy-dom
/**
 * Tests for the PointerDragState adapter — the pointer-event wrapper
 * around the pure `dragHandle` math in `drag.ts`. These run against a
 * stub adapter, so the class can be exercised without a real SplitGrid
 * tree underneath.
 *
 * What matters here is the lifecycle and the disposal contract — not the
 * exact drag math (covered by `drag.spec.ts`) or pixel-perfect outcomes
 * (happy-dom doesn't run real layout).
 */
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { PointerDragState, type DragAdapter, type DragTarget } from '../pointerDrag';
import type { Container } from '../types';
import { PanelDirection } from '../types';

let host: HTMLElement;
let containerEl: HTMLElement;
let resizerEl: HTMLElement;
let panelA: HTMLElement;
let panelB: HTMLElement;

// happy-dom returns a zero-sized rect by default; make panels and container
// concrete so drag math has real numbers to chew on.
const rectStub = (width: number) => ({
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: width,
  bottom: 100,
  width,
  height: 100,
  toJSON: () => ({}),
} as DOMRect);

beforeEach(() => {
  host = document.createElement('div');
  containerEl = document.createElement('div');
  panelA = document.createElement('div');
  panelB = document.createElement('div');
  resizerEl = document.createElement('div');

  containerEl.append(panelA, resizerEl, panelB);
  host.append(containerEl);
  document.body.append(host);

  // Stub each element's rect with a known width. Container = 1000;
  // each panel = 500; resizer = 0 (the adapter computes resizer px via
  // its own callback, not via the resizer element's rect).
  vi.spyOn(containerEl, 'getBoundingClientRect').mockReturnValue(rectStub(1000));
  vi.spyOn(panelA, 'getBoundingClientRect').mockReturnValue(rectStub(500));
  vi.spyOn(panelB, 'getBoundingClientRect').mockReturnValue(rectStub(500));
});

afterEach(() => {
  host.remove();
  vi.restoreAllMocks();
});

function makeTarget(): DragTarget {
  const node: Container = {
    id: 'root',
    direction: PanelDirection.Row,
    children: [{ id: 'a' }, { id: 'b' }],
  };

  return {
    node, el: containerEl, sizes: [], availPx: 0,
  };
}

function makeAdapter(extra: Partial<DragAdapter> = {}): DragAdapter & {
  applies: DragTarget[],
  logs: Array<{ label: string, data?: unknown }>,
} {
  const applies: DragTarget[] = [];
  const logs: Array<{ label: string, data?: unknown }> = [];

  return {
    resizerTracksPx: () => 0,
    childElementAt: (_el, i) => (i === 0 ? panelA : panelB),
    onDragApply: (t) => { applies.push(t); },
    log: (label, data) => {
      const resolved = typeof data === 'function' ? (data as () => unknown)() : data;

      logs.push({ label, data: resolved });
    },
    ...extra,
    applies,
    logs,
  };
}

function pointerDown(el: HTMLElement, clientX: number, clientY = 50, pointerId = 1) {
  el.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, button: 0, clientX, clientY, pointerId,
  }));
}

function pointerMove(clientX: number, clientY = 50) {
  globalThis.dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true, clientX, clientY,
  }));
}

function pointerUp() {
  globalThis.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
}

describe('PointerDragState — lifecycle', () => {
  it('snapshots child sizes on pointerdown and emits a "drag start" log', () => {
    const target = makeTarget();
    const adapter = makeAdapter();

    new PointerDragState(resizerEl, target, 1, adapter); // eslint-disable-line no-new

    pointerDown(resizerEl, 500);
    expect(adapter.logs.map((l) => l.label)).toContain('drag start');
    expect(target.availPx).toBe(1000); // resizerTracksPx returned 0
    // dataset.dragging set on the container during the active drag.
    expect(containerEl.dataset.dragging !== undefined).toBe(true);
  });

  it('translates pointermove deltas into sibling resizes via the adapter', () => {
    const target = makeTarget();
    const adapter = makeAdapter();

    new PointerDragState(resizerEl, target, 1, adapter); // eslint-disable-line no-new

    pointerDown(resizerEl, 500);
    pointerMove(550); // +50px to the right
    expect(adapter.applies.length).toBeGreaterThan(0);

    // Sizes are written as pct of containerAxisPx (1000). The exact values
    // depend on dragHandle (push-cascade math, tested separately); here we
    // just assert the call happened and the sizes are sensible (sum stays
    // ≈ 100, ignoring resizer tracks which we stubbed to 0).
    const sumPct = target.sizes.reduce(
      (a, s) => a + (s.unit === 'pct' ? s.value : 0),
      0,
    );

    expect(sumPct).toBeCloseTo(100, 0);
  });

  it('clears dataset.dragging on pointerup', () => {
    const target = makeTarget();
    const adapter = makeAdapter();

    new PointerDragState(resizerEl, target, 1, adapter); // eslint-disable-line no-new

    pointerDown(resizerEl, 500);
    pointerUp();
    expect(containerEl.dataset.dragging !== undefined).toBe(false);
    expect(adapter.logs.some((l) => l.label === 'drag end')).toBe(true);
  });

  it('handles pointercancel as a terminal route (mirrors pointerup)', () => {
    const target = makeTarget();
    const adapter = makeAdapter();

    new PointerDragState(resizerEl, target, 1, adapter); // eslint-disable-line no-new

    pointerDown(resizerEl, 500);
    globalThis.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
    expect(containerEl.dataset.dragging !== undefined).toBe(false);

    const endLog = adapter.logs.find((l) => l.label === 'drag end');

    expect((endLog?.data as { reason: string }).reason).toBe('cancel');
  });

  it('handles window blur as a terminal route', () => {
    const target = makeTarget();
    const adapter = makeAdapter();

    new PointerDragState(resizerEl, target, 1, adapter); // eslint-disable-line no-new

    pointerDown(resizerEl, 500);
    globalThis.dispatchEvent(new Event('blur'));
    expect(containerEl.dataset.dragging !== undefined).toBe(false);

    const endLog = adapter.logs.find((l) => l.label === 'drag end');

    expect((endLog?.data as { reason: string }).reason).toBe('blur');
  });

  it('ignores re-entrant pointerdowns while a drag is in flight', () => {
    const target = makeTarget();
    const adapter = makeAdapter();

    new PointerDragState(resizerEl, target, 1, adapter); // eslint-disable-line no-new

    pointerDown(resizerEl, 500, 50, 1);
    pointerDown(resizerEl, 600, 50, 2); // second pointer, ignored

    const startCount = adapter.logs.filter((l) => l.label === 'drag start').length;

    expect(startCount).toBe(1);
  });

  // Regression: a consumer's `#resizer` slot content can include
  // interactive controls (a per-panel maximize button, etc) — pointerdowns
  // on those shouldn't claim the pointer, because the drag handler's
  // `setPointerCapture` + `e.preventDefault()` would suppress the
  // subsequent click on the button. Discriminator: interactive elements
  // (or anything marked with `[data-no-drag]`) win; everything else
  // initiates a drag as normal.
  it('ignores pointerdown originating on an interactive control inside the resizer', () => {
    const target = makeTarget();
    const adapter = makeAdapter();

    new PointerDragState(resizerEl, target, 1, adapter); // eslint-disable-line no-new

    const slotBtn = document.createElement('button');

    resizerEl.append(slotBtn);
    slotBtn.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 500, clientY: 50, pointerId: 1,
    }));

    expect(adapter.logs.filter((l) => l.label === 'drag start')).toHaveLength(0);
    expect(containerEl.dataset.dragging !== undefined).toBe(false);
  });

  // A consumer can opt out for non-`<button>` interactive widgets (custom
  // checkbox, icon, draggable thumbnail, etc.) by adding `data-no-drag`.
  it('ignores pointerdown originating on a [data-no-drag] descendant', () => {
    const target = makeTarget();
    const adapter = makeAdapter();

    new PointerDragState(resizerEl, target, 1, adapter); // eslint-disable-line no-new

    const slotIcon = document.createElement('span');

    slotIcon.dataset.noDrag = '';
    resizerEl.append(slotIcon);
    slotIcon.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 500, clientY: 50, pointerId: 1,
    }));

    expect(adapter.logs.filter((l) => l.label === 'drag start')).toHaveLength(0);
  });

  // The reverse: a non-interactive slot child (a wrapping div, a panel
  // label, decorative chrome) IS a legitimate drag-initiation surface —
  // dashboard-style "header bar" slots cover the whole resizer with a
  // <div> and the user expects dragging anywhere on the bar to work.
  it('initiates a drag when pointerdown originates on a non-interactive slot child', () => {
    const target = makeTarget();
    const adapter = makeAdapter();

    new PointerDragState(resizerEl, target, 1, adapter); // eslint-disable-line no-new

    const slotChrome = document.createElement('div');

    slotChrome.className = 'dashboard-resizer-content';
    resizerEl.append(slotChrome);
    slotChrome.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 500, clientY: 50, pointerId: 1,
    }));

    expect(adapter.logs.filter((l) => l.label === 'drag start')).toHaveLength(1);
    expect(containerEl.dataset.dragging !== undefined).toBe(true);
  });

  // The `.sp-resizer-handle` is splitpanel's own indicator div; clicks on
  // it ARE legitimate drag-initiations (it's the visible affordance).
  it('still initiates a drag when pointerdown originates from the built-in handle indicator', () => {
    const target = makeTarget();
    const adapter = makeAdapter();

    new PointerDragState(resizerEl, target, 1, adapter); // eslint-disable-line no-new

    const handle = document.createElement('div');

    handle.className = 'sp-resizer-handle';
    resizerEl.append(handle);
    handle.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 500, clientY: 50, pointerId: 1,
    }));

    expect(adapter.logs.filter((l) => l.label === 'drag start')).toHaveLength(1);
  });

  it('ignores pointerdown for non-primary buttons', () => {
    const target = makeTarget();
    const adapter = makeAdapter();

    new PointerDragState(resizerEl, target, 1, adapter); // eslint-disable-line no-new

    resizerEl.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 2, clientX: 500, clientY: 50, pointerId: 1,
    }));
    expect(adapter.logs).toHaveLength(0);
    expect(containerEl.dataset.dragging !== undefined).toBe(false);
  });
});

describe('PointerDragState — disposal', () => {
  it('dispose() with no active drag removes the pointerdown listener', () => {
    const target = makeTarget();
    const adapter = makeAdapter();
    const state = new PointerDragState(resizerEl, target, 1, adapter);

    state.dispose();

    pointerDown(resizerEl, 500);
    expect(adapter.logs).toHaveLength(0);
  });

  it('dispose() during an active drag ends with reason "unmount"', () => {
    const target = makeTarget();
    const adapter = makeAdapter();
    const state = new PointerDragState(resizerEl, target, 1, adapter);

    pointerDown(resizerEl, 500);
    expect(containerEl.dataset.dragging !== undefined).toBe(true);

    state.dispose();
    expect(containerEl.dataset.dragging !== undefined).toBe(false);

    const endLog = adapter.logs.find((l) => l.label === 'drag end');

    expect((endLog?.data as { reason: string }).reason).toBe('unmount');
  });

  it('dispose() during a drag stops further pointermove from applying', () => {
    // The leak the old closure version had: a structural mutation removed
    // a resizer mid-drag, but the global pointermove listener stayed
    // attached and kept calling the now-stale handler. Dispose has to
    // remove the global listener so post-disposal moves are no-ops.
    const target = makeTarget();
    const adapter = makeAdapter();
    const state = new PointerDragState(resizerEl, target, 1, adapter);

    pointerDown(resizerEl, 500);
    pointerMove(550);

    const beforeDispose = adapter.applies.length;

    state.dispose();
    pointerMove(600);
    expect(adapter.applies.length).toBe(beforeDispose);
  });
});
