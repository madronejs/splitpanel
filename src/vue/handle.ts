/**
 * `SplitGridHandle` — the vue-flow-style facade returned by `useSplitGrid`.
 *
 * Modeled on `useVueFlow`'s composable: methods and event hooks live on a
 * stable object you can grab from anywhere, with two-tier resolution —
 * provide/inject for the in-tree case, a module-level registry keyed by id
 * for out-of-tree or pre-mount lookups. There is no third "create on first
 * use" tier; `<SplitGridView>` remains the only place a `SplitGrid` is
 * actually constructed. Handles are durable facades that the wrapper
 * attaches to (and detaches from) over their lifetime.
 *
 * Lifecycle:
 *  - `createHandle(id)` makes a fresh, unattached handle.
 *  - `attachHandle(handle, grid, shared)` wires queued hooks onto
 *    `grid.subscribe`, exposes the shared state for reactive reads, and
 *    flips `isReady` to true. Called by the wrapper on mount.
 *  - `detachHandle(handle)` cancels live subscriptions and clears the
 *    instance, but KEEPS queued listeners. Called on unmount; a remount
 *    under the same id replays the queue against the new grid.
 *
 * Two kinds of registrations:
 *  - Pre-attach: the handle has no live grid yet. The record is queued;
 *    on attach, it's subscribed; on detach, the live subscription is
 *    cancelled but the queue stays. Survives v-if / HMR cycles.
 *  - Post-attach: subscribed directly via `grid.subscribe`. On detach,
 *    the subscription is cancelled and forgotten — NOT replayed on the
 *    next attach. This mirrors what "I just want to listen while the
 *    grid is alive" would naturally do.
 */
import {
  inject, shallowRef, type ShallowRef,
} from 'vue';
import type {
  LayoutChangeEvent, LayoutOptions, PanelSizeReport, SplitGrid,
} from '../SplitGrid';
import type { DragChangeEvent } from '../draggable';
import type {
  Bounds, LengthInput, Node, PanelDirectionInput,
} from '../types';
import { splitGridKey } from './context';
import type { PanelState, SplitGridContext } from './context';

/** Reasons that count as a "resize" for `onResize`. */
const RESIZE_REASONS = new Set<LayoutChangeEvent['reason']>([
  'set-size', 'drag', 'equalize', 'reset', 'toggle-expand', 'maximize', 'minimize',
]);

/** Reasons that count as a "structural" change for `onStructural`. */
const STRUCTURAL_REASONS = new Set<LayoutChangeEvent['reason']>([
  'add-child', 'remove-child', 'swap',
]);

/**
 * One hook registration record. Tracks the user's callback and, if the
 * handle is attached, the live `grid.subscribe` unsubscribe. The record
 * itself is the identity used for `off()` — so a queued record that gets
 * subscribed on attach can still be removed by its original `off()`.
 */
interface HookRecord<E> {
  cb: (event: E) => void,
  /** Live subscription off(). Null pre-attach or post-detach. */
  liveOff: (() => void) | null,
}

/**
 * Shape of the cross-wrapper state the handle needs to reach into for
 * reactive reads (`getPanelState`, etc.). The wrapper hands this in at
 * attach time; nothing else creates one.
 */
export type HandleShared<T = unknown> = Omit<SplitGridContext<T>, 'handle'>;

/**
 * Public handle interface. Mirrors `SplitGrid`'s method surface plus
 * lifecycle-aware event hooks. Methods that mutate layout throw if called
 * before `isReady.value` becomes true; reactive reads return undefined
 * pre-attach (never throw — templates render on first paint before mount).
 */
export interface SplitGridHandle<T = unknown> {
  readonly id: string,
  readonly isReady: Readonly<ShallowRef<boolean>>,
  readonly instance: SplitGrid<T> | null,

  // Event hooks — all return an off() that works in any attach state.
  onReady: (cb: (grid: SplitGrid<T>) => void) => () => void,
  onChange: (cb: (event: LayoutChangeEvent) => void) => () => void,
  onResize: (cb: (event: LayoutChangeEvent) => void) => () => void,
  onStructural: (cb: (event: LayoutChangeEvent) => void) => () => void,
  onDragChange: (cb: (event: DragChangeEvent) => void) => () => void,

  // Reactive reads — undefined / falsy pre-attach.
  getPanelState: (id: string) => PanelState<T> | undefined,
  getSize: (id: string) => PanelSizeReport | undefined,
  isMaximized: (id: string) => boolean,
  isAtDefault: (id: string) => boolean,
  /** -1 if no child is maximized (or `containerId` isn't a container). */
  getMaximizedIndex: (containerId: string) => number,
  /** True for leaves treated as "trivially equal"; false for unknown ids. */
  areChildrenEqual: (containerId: string) => boolean,

  // Mutating methods — throw pre-attach. Same shape as the previous
  // `SplitGridViewApi`; consumers just drop the template ref.
  setSize: (id: string, size: LengthInput, opts?: LayoutOptions) => void,
  maximize: (id: string, opts?: LayoutOptions) => void,
  minimize: (id: string, opts?: LayoutOptions) => void,
  toggleExpand: (id: string, opts?: LayoutOptions) => void,
  toggleMaximize: (id: string, opts?: LayoutOptions) => void,
  expandNext: (containerId: string, opts?: LayoutOptions) => string | undefined,
  expandPrev: (containerId: string, opts?: LayoutOptions) => string | undefined,
  equalize: (containerId: string, opts?: LayoutOptions) => void,
  reset: (containerId: string, opts?: LayoutOptions) => void,
  addChild: (parentId: string, node: Node<T>, index?: number) => void,
  removeChild: (id: string) => void,
  swap: (idA: string, idB: string) => void,
  syncChildren: (containerId: string, defs: Array<Node<T>>) => void,
  setData: (id: string, data: T | undefined) => void,
  setDataArray: (items: Array<{ id: string, data: T | undefined }>) => void,
  swapData: (idA: string, idB: string) => void,
  moveData: (sourceId: string, targetId: string) => void,
  setDirection: (containerId: string, direction: PanelDirectionInput, opts?: LayoutOptions) => void,
  setBounds: (id: string, bounds: Partial<Bounds>, opts?: LayoutOptions) => void,
  settle: (containerId?: string, opts?: { timeout?: number }) => Promise<void>,
}

/**
 * Module-level registry. Keyed by id; populated by `useSplitGrid(id)`
 * (when no inject is available) and by the wrapper on mount. Persists for
 * the lifetime of the module — handles are durable so v-if / HMR cycles
 * preserve queued listeners. Exported for tests to clear between specs.
 *
 * Typed as `SplitGridHandle<unknown>` rather than `any` so the registry
 * itself doesn't silently widen the data type — each `useSplitGrid<T>(id)`
 * lookup site narrows via a single cast (see below). With `<any>` here, a
 * caller could ask for `useSplitGrid<X>('id')` against a handle that was
 * created for a different `T` and pick up the wrong type with no compiler
 * complaint anywhere.
 */
export const registry = new Map<string, SplitGridHandle<unknown>>();

/** Brand symbol for wrapper-private operations on a handle. Not exported
 *  from the package index. */
const INTERNAL = Symbol('SplitGridHandle.internal');

interface InternalOps<T> {
  attach: (grid: SplitGrid<T>, shared: HandleShared<T>) => void,
  detach: () => void,
  dispatchDragChange: (event: DragChangeEvent) => void,
}

function internalOps<T>(handle: SplitGridHandle<T>): InternalOps<T> {
  return (handle as unknown as Record<symbol, InternalOps<T>>)[INTERNAL];
}

/**
 * Build a fresh, unattached handle. Pure factory — no DOM, no Vue.
 * Exported so the wrapper and tests can drive it directly; consumers
 * normally reach handles through `useSplitGrid`.
 */
export function createHandle<T = unknown>(id: string): SplitGridHandle<T> {
  let grid: SplitGrid<T> | null = null;
  let shared: HandleShared<T> | null = null;
  const isReady = shallowRef(false);

  // Queued (pre-attach) hooks. Drained on attach; persist across detach
  // cycles so a re-mount under the same id re-fires.
  const queuedChange = new Set<HookRecord<LayoutChangeEvent>>();
  // Live (post-attach) hooks. Cleared on detach; NOT replayed.
  const liveChange = new Set<HookRecord<LayoutChangeEvent>>();
  // Ready callbacks: one-shot, never replayed.
  const queuedReady = new Set<(grid: SplitGrid<T>) => void>();
  // DragChange has no underlying subscribe pipe — the wrapper dispatches
  // by calling `dispatchDragChange` on the handle. One set; no queue/live
  // distinction needed.
  const dragSubs = new Set<(event: DragChangeEvent) => void>();

  function notMountedError(): Error {
    return new Error(
      `useSplitGrid('${id}'): grid not yet mounted — register inside onReady `
      + 'or after isReady.value flips true.',
    );
  }

  /**
   * Register a layout-change callback. Pre-attach goes to `queuedChange`
   * (drained on attach, survives detach); post-attach goes to
   * `liveChange` (subscribed immediately, cancelled on detach). Returns
   * an `off()` that handles both states.
   */
  function registerChange(
    cb: (event: LayoutChangeEvent) => void,
  ): () => void {
    const rec: HookRecord<LayoutChangeEvent> = { cb, liveOff: null };

    if (grid) {
      // Post-attach: live only. Will be cancelled on detach.
      rec.liveOff = grid.subscribe(cb);
      liveChange.add(rec);
      return () => {
        rec.liveOff?.();
        rec.liveOff = null;
        liveChange.delete(rec);
      };
    }

    // Pre-attach: queue. The drain step in `attachHandle` fills in liveOff.
    queuedChange.add(rec);
    return () => {
      rec.liveOff?.();
      rec.liveOff = null;
      queuedChange.delete(rec);
    };
  }

  function onChange(cb: (event: LayoutChangeEvent) => void): () => void {
    return registerChange(cb);
  }

  function onResize(cb: (event: LayoutChangeEvent) => void): () => void {
    return registerChange((event) => {
      if (RESIZE_REASONS.has(event.reason)) cb(event);
    });
  }

  function onStructural(cb: (event: LayoutChangeEvent) => void): () => void {
    return registerChange((event) => {
      if (STRUCTURAL_REASONS.has(event.reason)) cb(event);
    });
  }

  function onReady(cb: (grid: SplitGrid<T>) => void): () => void {
    if (grid) {
      // Already ready — fire synchronously, then hand back a no-op off.
      // One-shot: the registration is consumed.
      cb(grid);
      return () => {};
    }

    queuedReady.add(cb);
    return () => queuedReady.delete(cb);
  }

  function onDragChange(cb: (event: DragChangeEvent) => void): () => void {
    dragSubs.add(cb);
    return () => dragSubs.delete(cb);
  }

  function requireGrid(): SplitGrid<T> {
    if (!grid) throw notMountedError();
    return grid;
  }

  // --- mutating methods (throw pre-attach) ----------------------------

  const handle: SplitGridHandle<T> = {
    id,
    isReady,
    get instance() { return grid; },

    onReady,
    onChange,
    onResize,
    onStructural,
    onDragChange,

    // Reactive reads. Gating on `isReady.value` does double duty: (1) the
    // ternary acts as the "is attached" check (`grid` / `shared` are
    // non-null exactly when `isReady.value` is true, kept in lockstep
    // by attach/detach below), and (2) reading `isReady.value` registers
    // the reactive dep so a `computed(() => handle.getX(...))` created
    // pre-attach re-evaluates when the wrapper attaches.
    getPanelState: (panelId) => (isReady.value ? shared!.panelStates.get(panelId) : undefined),
    getSize: (panelId) => (isReady.value ? grid!.getSize(panelId) : undefined),
    isMaximized: (panelId) => (isReady.value ? grid!.isMaximized(panelId) : false),
    isAtDefault: (panelId) => (isReady.value ? grid!.isAtDefault(panelId) : false),
    getMaximizedIndex: (containerId) => (isReady.value ? grid!.getMaximizedIndex(containerId) : -1),
    areChildrenEqual: (containerId) => (isReady.value ? grid!.areChildrenEqual(containerId) : false),

    setSize: (panelId, size, opts) => requireGrid().setSize(panelId, size, opts),
    maximize: (panelId, opts) => requireGrid().maximize(panelId, opts),
    minimize: (panelId, opts) => requireGrid().minimize(panelId, opts),
    toggleExpand: (panelId, opts) => requireGrid().toggleExpand(panelId, opts),
    toggleMaximize: (panelId, opts) => requireGrid().toggleMaximize(panelId, opts),
    expandNext: (containerId, opts) => requireGrid().expandNext(containerId, opts),
    expandPrev: (containerId, opts) => requireGrid().expandPrev(containerId, opts),
    equalize: (containerId, opts) => requireGrid().equalize(containerId, opts),
    reset: (containerId, opts) => requireGrid().reset(containerId, opts),
    addChild: (parentId, node, index) => requireGrid().addChild(parentId, node, index),
    removeChild: (panelId) => requireGrid().removeChild(panelId),
    swap: (a, b) => requireGrid().swap(a, b),
    syncChildren: (containerId, defs) => requireGrid().syncChildren(containerId, defs),
    setData: (panelId, data) => requireGrid().setData(panelId, data),
    setDataArray: (items) => requireGrid().setDataArray(items),
    swapData: (a, b) => requireGrid().swapData(a, b),
    moveData: (s, t) => requireGrid().moveData(s, t),
    setDirection: (containerId, direction, opts) => requireGrid().setDirection(containerId, direction, opts),
    setBounds: (panelId, bounds, opts) => requireGrid().setBounds(panelId, bounds, opts),
    // settle is special: pre-attach we resolve immediately (the same way
    // the core does for unknown ids / pre-mount calls).
    settle: (containerId, opts) => (grid ? grid.settle(containerId, opts) : Promise.resolve()),
  };

  // Internal hooks for the wrapper. Stored on a brand symbol so the
  // public interface stays clean and consumers can't call them.
  Object.defineProperty(handle, INTERNAL, {
    value: {
      attach(g: SplitGrid<T>, sharedState: HandleShared<T>): void {
        if (grid) {
          throw new Error(
            `<SplitGridView id="${id}">: a SplitGrid is already attached `
            + 'to this id. Duplicate mount?',
          );
        }

        grid = g;
        shared = sharedState;

        // Drain queued change subscribers — they survive detach cycles,
        // so we wire each record's liveOff onto the new grid.
        for (const rec of queuedChange) {
          rec.liveOff = g.subscribe(rec.cb);
        }

        // Flip ready BEFORE firing onReady, so callbacks observing
        // `isReady.value` see the new state.
        isReady.value = true;

        // One-shot ready callbacks: consume and call.
        const readyCbs = [...queuedReady];

        queuedReady.clear();

        for (const cb of readyCbs) cb(g);
      },
      detach(): void {
        // Cancel all live subscriptions for queued (durable) records,
        // but leave the records themselves in `queuedChange` so a
        // re-attach can re-subscribe them.
        for (const rec of queuedChange) {
          rec.liveOff?.();
          rec.liveOff = null;
        }

        // Live (post-attach) records are NOT durable; cancel and clear.
        for (const rec of liveChange) rec.liveOff?.();

        liveChange.clear();
        grid = null;
        shared = null;
        isReady.value = false;
      },
      dispatchDragChange(event: DragChangeEvent): void {
        for (const cb of dragSubs) cb(event);
      },
    },
    enumerable: false,
    writable: false,
  });

  return handle;
}

/**
 * Wrapper-side attach. Throws if the handle is already attached to a grid
 * (i.e. a duplicate `<SplitGridView id="...">` mount).
 */
export function attachHandle<T>(
  handle: SplitGridHandle<T>,
  grid: SplitGrid<T>,
  shared: HandleShared<T>,
): void {
  internalOps(handle).attach(grid, shared);
}

/** Wrapper-side detach. Idempotent if the handle isn't attached. */
export function detachHandle<T>(handle: SplitGridHandle<T>): void {
  internalOps(handle).detach();
}

/**
 * Wrapper-side bridge from the draggable plugin's `onDragChange` config
 * field to handle subscribers. The wrapper still owns the drag state
 * machinery (it needs the events to refresh PanelStates), and just
 * dispatches the same event into the handle as it goes.
 */
export function dispatchDragChange<T>(
  handle: SplitGridHandle<T>,
  event: DragChangeEvent,
): void {
  internalOps(handle).dispatchDragChange(event);
}

/**
 * Public composable. Three resolution modes:
 *  1. Injected context (in-tree) — return its handle if it matches the
 *     requested id, or any id wasn't requested.
 *  2. Registry lookup by id — get-or-create. Enables pre-mount setup
 *     wiring and cross-tree access by name.
 *  3. Neither — throw with a useful message.
 */
export function useSplitGrid<T = unknown>(id?: string): SplitGridHandle<T> {
  const injected = inject(splitGridKey, null) as SplitGridContext<T> | null;

  if (injected && (!id || injected.handle.id === id)) {
    return injected.handle;
  }

  if (id) {
    // The registry stores `SplitGridHandle<unknown>` so it can hold
    // handles for many T at once. The cast here is the single narrowing
    // boundary — callers asking for a specific `T` get back that
    // narrowed view; if the handle was created for a different T, the
    // mismatch isn't caught at compile time (the registry has no
    // per-id T to remember), but it's also not silently widened
    // throughout downstream code as it was under `<any>`.
    let h = registry.get(id) as SplitGridHandle<T> | undefined;

    if (!h) {
      h = createHandle<T>(id);
      registry.set(id, h as SplitGridHandle<unknown>);
    }
    return h;
  }

  throw new Error(
    'useSplitGrid: must be called inside a <SplitGridView> component tree, '
    + 'or with an explicit id matching a mounted <SplitGridView>.',
  );
}
