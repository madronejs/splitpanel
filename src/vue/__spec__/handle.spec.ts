/**
 * Pure semantics of the SplitGridHandle: queue/drain of hooks, throw boundary
 * on mutating methods, attach/detach lifecycle, registry sharing by id, and
 * onReady's "fire immediately if already ready" rule.
 *
 * No real SplitGrid here — we pass a hand-rolled fake with `subscribe` /
 * mutating methods stubbed. The handle is a thin facade; what matters is the
 * lifecycle around it.
 *
 * Node env (no DOM, no Vue setup) — these tests cover the parts of handle.ts
 * that don't depend on inject/provide.
 */
import {
  afterEach, describe, expect, it, vi,
} from 'vitest';
import {
  attachHandle, createHandle, detachHandle, registry,
} from '../handle';
import type { LayoutChangeEvent } from '../../SplitGrid';

interface FakeGrid {
  subscribe: ReturnType<typeof vi.fn>,
  setSize: ReturnType<typeof vi.fn>,
  maximize: ReturnType<typeof vi.fn>,
  setDirection: ReturnType<typeof vi.fn>,
  setBounds: ReturnType<typeof vi.fn>,
  emit: (event: LayoutChangeEvent) => void,
}

function makeFakeGrid(): FakeGrid {
  const subs = new Set<(event: LayoutChangeEvent) => void>();

  return {
    subscribe: vi.fn((cb: (e: LayoutChangeEvent) => void) => {
      subs.add(cb);
      return () => subs.delete(cb);
    }),
    setSize: vi.fn(),
    maximize: vi.fn(),
    setDirection: vi.fn(),
    setBounds: vi.fn(),
    emit(event: LayoutChangeEvent) {
      for (const cb of subs) cb(event);
    },
  };
}

// Minimal shared-state stub: just the panelStates map the handle reads from.
function makeFakeShared() {
  return {
    panelStates: new Map(),
    resizerEntries: new Map(),
    ownedResizers: new Set<string>(),
  };
}

const baseEvent = (overrides: Partial<LayoutChangeEvent> = {}): LayoutChangeEvent => ({
  containerId: 'root', reason: 'set-size', sizes: [], nodeIds: ['a'], ...overrides,
});

afterEach(() => {
  // Each test creates its own ids; tests that mutate the module registry
  // should clean up after themselves. As a safety net, wipe anything left.
  for (const id of registry.keys()) registry.delete(id);
});

describe('createHandle: identity and pre-attach state', () => {
  it('exposes the id back', () => {
    const h = createHandle('grid-a');

    expect(h.id).toBe('grid-a');
  });

  it('isReady is false pre-attach; instance is null', () => {
    const h = createHandle('g');

    expect(h.isReady.value).toBe(false);
    expect(h.instance).toBeNull();
  });

  it('reactive reads return undefined / falsy pre-attach', () => {
    const h = createHandle<{ label: string }>('g');

    expect(h.getPanelState('a')).toBeUndefined();
    expect(h.getSize('a')).toBeUndefined();
    expect(h.isMaximized('a')).toBe(false);
    expect(h.isAtDefault('a')).toBe(false);
  });
});

describe('mutating methods throw pre-attach', () => {
  it('setSize throws with a message naming the id', () => {
    const h = createHandle('main');

    expect(() => h.setSize('a', '50%')).toThrow(/main/);
    expect(() => h.setSize('a', '50%')).toThrow(/not yet mounted/i);
  });

  it('every mutating method throws pre-attach', () => {
    const h = createHandle('g');

    expect(() => h.maximize('a')).toThrow();
    expect(() => h.minimize('a')).toThrow();
    expect(() => h.toggleExpand('a')).toThrow();
    expect(() => h.toggleMaximize('a')).toThrow();
    expect(() => h.expandNext('c')).toThrow();
    expect(() => h.expandPrev('c')).toThrow();
    expect(() => h.equalize('c')).toThrow();
    expect(() => h.reset('c')).toThrow();
    expect(() => h.addChild('p', { id: 'x' })).toThrow();
    expect(() => h.removeChild('x')).toThrow();
    expect(() => h.swap('a', 'b')).toThrow();
    expect(() => h.syncChildren('c', [])).toThrow();
    expect(() => h.setData('a', undefined)).toThrow();
    expect(() => h.setDataArray([])).toThrow();
    expect(() => h.swapData('a', 'b')).toThrow();
    expect(() => h.moveData('a', 'b')).toThrow();
    expect(() => h.setDirection('c', 'row')).toThrow();
    expect(() => h.setBounds('a', {})).toThrow();
  });

  it('settle pre-attach resolves immediately', async () => {
    const h = createHandle('g');

    await expect(h.settle()).resolves.toBeUndefined();
  });
});

describe('hook queue & drain', () => {
  it('onChange registered pre-attach fires after attach', () => {
    const h = createHandle('g');
    const cb = vi.fn();

    h.onChange(cb);
    expect(cb).not.toHaveBeenCalled();

    const grid = makeFakeGrid();

    attachHandle(h, grid as never, makeFakeShared());
    expect(grid.subscribe).toHaveBeenCalledTimes(1);

    grid.emit(baseEvent({ reason: 'set-size' }));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ reason: 'set-size' }));
  });

  it('onChange registered post-attach subscribes directly', () => {
    const h = createHandle('g');
    const grid = makeFakeGrid();

    attachHandle(h, grid as never, makeFakeShared());

    const cb = vi.fn();

    h.onChange(cb);
    grid.emit(baseEvent({ reason: 'equalize' }));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('onResize fires only for size-changing reasons', () => {
    const h = createHandle('g');
    const cb = vi.fn();

    h.onResize(cb);

    const grid = makeFakeGrid();

    attachHandle(h, grid as never, makeFakeShared());

    grid.emit(baseEvent({ reason: 'set-size' }));
    grid.emit(baseEvent({ reason: 'drag' }));
    grid.emit(baseEvent({ reason: 'equalize' }));
    grid.emit(baseEvent({ reason: 'reset' }));
    grid.emit(baseEvent({ reason: 'toggle-expand' }));
    // maximize / minimize were extracted from 'set-size' but are still
    // size changes — onResize listeners should see them.
    grid.emit(baseEvent({ reason: 'maximize' }));
    grid.emit(baseEvent({ reason: 'minimize' }));
    grid.emit(baseEvent({ reason: 'add-child' })); // structural — should NOT fire onResize
    grid.emit(baseEvent({ reason: 'set-data' })); // not a size change either

    expect(cb).toHaveBeenCalledTimes(7);
  });

  it('onStructural fires only for add/remove/swap', () => {
    const h = createHandle('g');
    const cb = vi.fn();

    h.onStructural(cb);

    const grid = makeFakeGrid();

    attachHandle(h, grid as never, makeFakeShared());

    grid.emit(baseEvent({ reason: 'add-child' }));
    grid.emit(baseEvent({ reason: 'remove-child' }));
    grid.emit(baseEvent({ reason: 'swap' }));
    grid.emit(baseEvent({ reason: 'set-size' }));
    grid.emit(baseEvent({ reason: 'set-data' }));

    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('off() returned pre-attach removes from queue (never fires)', () => {
    const h = createHandle('g');
    const cb = vi.fn();
    const off = h.onChange(cb);

    off();

    const grid = makeFakeGrid();

    attachHandle(h, grid as never, makeFakeShared());
    grid.emit(baseEvent());

    expect(cb).not.toHaveBeenCalled();
  });

  it('off() returned post-attach unsubscribes from the grid', () => {
    const h = createHandle('g');
    const grid = makeFakeGrid();

    attachHandle(h, grid as never, makeFakeShared());

    const cb = vi.fn();
    const off = h.onChange(cb);

    grid.emit(baseEvent());
    expect(cb).toHaveBeenCalledTimes(1);

    off();
    grid.emit(baseEvent());
    expect(cb).toHaveBeenCalledTimes(1); // unchanged
  });
});

describe('detach lifecycle', () => {
  it('detach flips isReady false and clears instance', () => {
    const h = createHandle('g');
    const grid = makeFakeGrid();

    attachHandle(h, grid as never, makeFakeShared());
    expect(h.isReady.value).toBe(true);
    expect(h.instance).toBe(grid);

    detachHandle(h);
    expect(h.isReady.value).toBe(false);
    expect(h.instance).toBeNull();
  });

  it('mutating methods throw again after detach', () => {
    const h = createHandle('g');
    const grid = makeFakeGrid();

    attachHandle(h, grid as never, makeFakeShared());
    detachHandle(h);

    expect(() => h.setSize('a', '50%')).toThrow(/not yet mounted/i);
  });

  it('queued listeners survive detach and re-fire on re-attach', () => {
    const h = createHandle('g');
    const cb = vi.fn();

    h.onChange(cb);

    const g1 = makeFakeGrid();

    attachHandle(h, g1 as never, makeFakeShared());
    g1.emit(baseEvent());
    expect(cb).toHaveBeenCalledTimes(1);

    detachHandle(h);

    const g2 = makeFakeGrid();

    attachHandle(h, g2 as never, makeFakeShared());
    g2.emit(baseEvent());
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('detach cancels live subscriptions on the previous grid', () => {
    const h = createHandle('g');
    const grid = makeFakeGrid();

    attachHandle(h, grid as never, makeFakeShared());

    const cb = vi.fn();

    // Registered POST-attach — goes through grid.subscribe directly.
    h.onChange(cb);
    grid.emit(baseEvent());
    expect(cb).toHaveBeenCalledTimes(1);

    detachHandle(h);

    // Emitting through the detached grid should not call the listener
    // anymore (its unsubscribe ran).
    grid.emit(baseEvent());
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('onReady', () => {
  it('fires on attach when registered pre-attach', () => {
    const h = createHandle('g');
    const cb = vi.fn();

    h.onReady(cb);
    expect(cb).not.toHaveBeenCalled();

    const grid = makeFakeGrid();

    attachHandle(h, grid as never, makeFakeShared());
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(grid);
  });

  it('fires immediately if registered post-attach (handle already ready)', () => {
    const h = createHandle('g');
    const grid = makeFakeGrid();

    attachHandle(h, grid as never, makeFakeShared());

    const cb = vi.fn();

    h.onReady(cb);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(grid);
  });

  it('does not double-fire on subsequent attach cycles', () => {
    const h = createHandle('g');
    const cb = vi.fn();

    h.onReady(cb);

    const g1 = makeFakeGrid();

    attachHandle(h, g1 as never, makeFakeShared());
    expect(cb).toHaveBeenCalledTimes(1);

    detachHandle(h);

    const g2 = makeFakeGrid();

    attachHandle(h, g2 as never, makeFakeShared());
    // onReady is one-shot per registration; a re-attach is not a fresh ready.
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('duplicate attach', () => {
  it('attaching twice without detach throws', () => {
    const h = createHandle('g');

    attachHandle(h, makeFakeGrid() as never, makeFakeShared());
    expect(() => attachHandle(h, makeFakeGrid() as never, makeFakeShared())).toThrow(/already/i);
  });
});

describe('getPanelState delegates to shared map', () => {
  it('reads from the panelStates map provided at attach time', () => {
    const h = createHandle<{ label: string }>('g');
    const shared = makeFakeShared();

    shared.panelStates.set('a', { id: 'a' } as never);
    attachHandle(h, makeFakeGrid() as never, shared);

    expect(h.getPanelState('a')).toEqual({ id: 'a' });
  });
});
