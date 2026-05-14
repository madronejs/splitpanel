/**
 * Pointer-event adapter for the pure drag math in `drag.ts`.
 *
 * `dragHandle()` is a pure function — given current px sizes, the drag-start
 * snapshot, and a delta, it mutates the sizes array. Everything ABOVE that
 * (capturing pointer events, snapshotting sizes, computing deltas in px,
 * writing back to `parent.sizes`, cleaning up on every termination path)
 * lived inline in `SplitGrid.attachDrag` as 80 lines of stateful closures.
 *
 * This class owns that adapter logic with three guarantees the closure
 * version didn't make:
 *
 *  1. **Explicit lifecycle.** `idle` ↔ `active`. `end(reason)` is the single
 *     cleanup path; every termination route (pointerup, pointercancel,
 *     window blur, container disposal) funnels through it. The closure
 *     version only handled `pointerup`; pointercancel and blur leaked the
 *     global listeners, and a mid-drag DOM detach left them firing on
 *     orphan state.
 *
 *  2. **Disposal.** `dispose()` removes the `pointerdown` listener and
 *     forces a clean end if a drag is in flight. SplitGrid stores instances
 *     in a WeakMap keyed by resizer element and disposes them in
 *     `detachResizers`.
 *
 *  3. **Testability.** The class doesn't depend on `SplitGrid` directly —
 *     it takes a `DragAdapter` interface for the few callbacks it needs
 *     (resizer-track px math, child-element lookup, post-apply hook,
 *     optional diagnostic log). Tests can supply a stub adapter and
 *     dispatch synthetic PointerEvents without spinning up a real grid.
 */
import type { Container, Length } from './types';
import { PanelDirection } from './types';
import { dragHandle } from './drag';
import {
  asContainerAxis, sizesFromPx, type ContainerAxisPx, type StorageUnit,
} from './length';
import { measureAxis, measureChildrenPx } from './geometry';

/**
 * The shape the drag adapter needs from a container's runtime state.
 * Subset of `ContainerState` from SplitGrid — declared structurally here so
 * this module doesn't import from `SplitGrid.ts`.
 */
export interface DragTarget {
  /** The container node — read for direction and children. */
  readonly node: Container,
  /** The container's DOM element — read for rect and dataset.dragging. */
  readonly el: HTMLElement,
  /** Mutable: drag writes pct lengths here as the cursor moves. */
  sizes: Length[],
  /** Mutable: drag sets this from `containerAxis − resizer tracks`. */
  availPx: number,
}

/**
 * Hooks the drag class calls back into for everything outside the pure
 * pointer-to-px conversion. SplitGrid implements all four; tests can stub.
 */
export interface DragAdapter {
  /** Total px the resizer tracks consume at the given axis size. */
  resizerTracksPx: (target: DragTarget, axisPx: ContainerAxisPx) => number,
  /**
   * Find the i-th content child of `containerEl`, skipping resizer elements.
   * SplitGrid has its own walker for this — passed in so the drag class
   * doesn't need to know how the DOM is structured.
   */
  childElementAt: (containerEl: HTMLElement, index: number) => HTMLElement | undefined,
  /**
   * Called after every per-move apply. The implementer should writeTracks
   * (CSS) + emit any 'drag' event subscribers care about.
   */
  onDragApply: (target: DragTarget) => void,
  /** Optional diagnostic hook; gated on debug by the caller. */
  log?: (label: string, data?: unknown | (() => unknown)) => void,
}

/**
 * Why the drag ended. SplitGrid doesn't currently fan this out as an event,
 * but the reasons are recorded in the diagnostic log so a misbehaving
 * gesture (e.g. unmounted mid-drag) leaves a breadcrumb.
 */
export type DragEndReason = 'up' | 'cancel' | 'blur' | 'unmount';

export class PointerDragState {
  private active = false;
  private pointerId = -1;
  private startCoord = 0;
  private lastApplied = 0;
  private dragSizesPx: number[] = [];
  /**
   * Snapshot at drag start; never mutated. Drives the LIFO recovery in
   * `dragHandle` — panels that were cascade-shrunk grow back to their
   * starting size before the immediate neighbor expands past it.
   */
  private initialDragSizesPx: number[] = [];
  private availPx = 0;
  private containerAxisPx: ContainerAxisPx = asContainerAxis(0);

  // Bound handlers held as fields so add/removeEventListener see the same
  // function reference. Using arrow-prop class fields keeps `this` correct
  // without re-binding per listener.
  private readonly boundDown = (e: PointerEvent) => this.onDown(e);
  private readonly boundMove = (e: PointerEvent) => this.onMove(e);
  private readonly boundUp = () => this.end('up');
  private readonly boundCancel = () => this.end('cancel');
  private readonly boundBlur = () => this.end('blur');

  constructor(
    private readonly el: HTMLElement,
    private readonly target: DragTarget,
    private readonly handleIdx: number,
    private readonly adapter: DragAdapter,
  ) {
    this.el.addEventListener('pointerdown', this.boundDown);
  }

  /**
   * Tear down all listeners. If a drag is in flight, ends it first with
   * reason `'unmount'` so the standard cleanup path runs (dataset.dragging
   * cleared, pointer capture released, global listeners removed).
   */
  dispose(): void {
    if (this.active) this.end('unmount');

    this.el.removeEventListener('pointerdown', this.boundDown);
  }

  private onDown(e: PointerEvent): void {
    // Left button only; ignore reentrant pointerdowns while a drag is in
    // progress (multi-touch, programmatic dispatch).
    if (e.button !== 0) return;

    if (this.active) return;

    // Yield to interactive controls inside the resizer — a consumer's
    // `#resizer` slot may teleport buttons, inputs, etc. into this
    // element, and pointerdowns on those shouldn't start a drag (the
    // `setPointerCapture` + `e.preventDefault()` below would suppress
    // the subsequent click). Non-interactive slot content (a wrapping
    // div, a panel label, decorative chrome) IS a legitimate drag
    // surface — dashboard-style header bars cover the resizer with a
    // <div> and the user expects dragging on the bar to work. Escape
    // hatch: any element marked `[data-no-drag]` is treated as
    // interactive regardless of its tag.
    const target = e.target as Element | null;

    if (target && target !== this.el) {
      const interactive = target.closest(
        'button, input, select, textarea, a, [data-no-drag]',
      );

      if (interactive && this.el.contains(interactive)) return;
    }

    this.pointerId = e.pointerId;

    try {
      this.el.setPointerCapture(this.pointerId);
    } catch {
      // happy-dom and some headless environments throw on setPointerCapture
      // for synthetic events without an active pointer; tolerate that here.
    }

    this.target.el.dataset.dragging = '';
    this.active = true;

    const axis = this.target.node.direction === PanelDirection.Row ? 'x' : 'y';

    this.startCoord = axis === 'x' ? e.clientX : e.clientY;
    this.lastApplied = 0;

    // Snapshot the resolved px sizes of each child so drag math operates on
    // a stable baseline. Subtracting every resizer track (inner + edges)
    // gives the content-space budget the drag math operates against.
    const totalAxisPx = asContainerAxis(measureAxis(this.target.el, this.target.node.direction));
    const resizerTracks = this.adapter.resizerTracksPx(this.target, totalAxisPx);

    this.availPx = Math.max(0, totalAxisPx - resizerTracks);
    this.containerAxisPx = totalAxisPx;
    this.target.availPx = this.availPx;

    this.dragSizesPx = measureChildrenPx(
      this.target.el,
      this.target.node.direction,
      this.target.node.children.length,
      this.adapter.childElementAt,
    );
    this.initialDragSizesPx = [...this.dragSizesPx];

    this.adapter.log?.('drag start', () => ({
      containerId: this.target.node.id,
      handleIdx: this.handleIdx,
      direction: this.target.node.direction,
      totalAxisPx,
      resizerTracks,
      availPx: this.availPx,
      dragSizesPx: this.dragSizesPx.map((n) => Math.round(n * 100) / 100),
      sumPx: Math.round(this.dragSizesPx.reduce((a, b) => a + b, 0) * 100) / 100,
      childIds: this.target.node.children.map((c) => c.id),
    }));

    // Listen on every termination path. `once: true` on pointerup so it
    // self-removes (the cleanup in `end` is redundant but defensive); the
    // rest unregister inside `end`.
    globalThis.addEventListener('pointermove', this.boundMove);
    globalThis.addEventListener('pointerup', this.boundUp, { once: true });
    globalThis.addEventListener('pointercancel', this.boundCancel, { once: true });
    globalThis.addEventListener('blur', this.boundBlur);
    e.preventDefault();
  }

  private onMove(e: PointerEvent): void {
    if (!this.active) return;

    const axis = this.target.node.direction === PanelDirection.Row ? 'x' : 'y';
    const delta = (axis === 'x' ? e.clientX : e.clientY) - this.startCoord;
    const want = delta - this.lastApplied;

    if (want === 0) return;

    // dragHandle resolves min/max percentages — pass containerAxisPx (full
    // container) to match CSS, not availPx (content area).
    const applied = dragHandle(
      this.target.node,
      this.dragSizesPx,
      this.initialDragSizesPx,
      this.handleIdx,
      want,
      this.containerAxisPx,
    );

    if (applied === 0) {
      this.adapter.log?.('drag move: applied=0 (no movement room)', () => ({
        containerId: this.target.node.id,
        handleIdx: this.handleIdx,
        want,
        dragSizesPx: [...this.dragSizesPx],
      }));
      return;
    }

    this.lastApplied += applied;

    // `target.sizes` is in storage form (pct of pctBudgetPx, NOT pct of
    // containerAxisPx). Px siblings keep their unit across the drag;
    // pct/fr entries fold into pct. `sizesFromPx` does the budget math
    // safely — see its docs for the per-frame flash bug it defends
    // against.
    const units: StorageUnit[] = this.target.sizes.map(
      (sz) => (sz.unit === 'px' ? 'px' : 'pct'),
    );

    this.target.sizes = sizesFromPx(this.dragSizesPx, units, this.availPx);

    this.adapter.log?.('drag move', () => ({
      containerId: this.target.node.id,
      handleIdx: this.handleIdx,
      want,
      applied,
      dragSizesPx: this.dragSizesPx.map((n) => Math.round(n * 100) / 100),
      sumPx: Math.round(this.dragSizesPx.reduce((a, b) => a + b, 0) * 100) / 100,
      availPx: this.availPx,
      containerAxisPx: this.containerAxisPx,
    }));

    this.adapter.onDragApply(this.target);
  }

  private end(reason: DragEndReason): void {
    if (!this.active) return;

    this.active = false;

    if (this.pointerId !== -1) {
      try {
        this.el.releasePointerCapture(this.pointerId);
      } catch {
        // Releasing a capture we never had / already released is fine.
      }

      this.pointerId = -1;
    }

    delete this.target.el.dataset.dragging;

    globalThis.removeEventListener('pointermove', this.boundMove);
    globalThis.removeEventListener('pointerup', this.boundUp);
    globalThis.removeEventListener('pointercancel', this.boundCancel);
    globalThis.removeEventListener('blur', this.boundBlur);

    this.adapter.log?.('drag end', { containerId: this.target.node.id, reason });
  }
}
