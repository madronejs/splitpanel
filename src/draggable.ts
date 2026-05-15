/**
 * Pointer-event-driven drag-drop reorder plugin. Opt-in; the consumer wires
 * it up explicitly so the core stays free of drag concerns and bundlers can
 * tree-shake it out of non-draggable consumers.
 *
 * Lifecycle: pointerdown on a draggable element marks a candidate source;
 * the first pointermove past `threshold` px commits the drag and fires
 * `onDragChange` with the source set. Subsequent moves resolve the target
 * (via `elementFromPoint`, falling back to the move event's target — useful
 * for happy-dom-based tests that can't run layout). pointerup fires
 * `onDrop` if both source and target are valid, then clears state and
 * fires `onDragChange` once more with everything null.
 *
 * Default behavior swaps DATA (not panel positions) between source and
 * target — matches the old SplitPanel.swapData semantics that swarm's
 * drag-drop relies on. Override `onDrop` for any other behavior (e.g.,
 * structural swap, move-into-container, custom external state mutation).
 */
import type { SplitGrid } from './SplitGrid';

export interface BoxCoord {
  x: number,
  y: number,
}

export interface GhostContext<T = unknown> {
  sourceId: string,
  sourceEl: HTMLElement,
  grid: SplitGrid<T>,
}

export interface DraggableConfig<T = unknown> {
  /**
   * CSS selector for the drag-initiating element WITHIN a panel. If the
   * pointerdown target doesn't match (or isn't inside something matching),
   * no drag starts. Defaults to `.sp-panel` — the whole panel is draggable.
   */
  dragSelector?: string,
  /**
   * Predicate gating whether a panel can be the drag source. Return false
   * to silently reject the pointerdown.
   */
  canDrag?: (sourceId: string, grid: SplitGrid<T>) => boolean,
  /**
   * Predicate gating whether a panel can be the drop target for the
   * current source. Return false to skip this target — the drag continues
   * looking for the next valid one.
   */
  canDrop?: (sourceId: string, targetId: string, grid: SplitGrid<T>) => boolean,
  /**
   * Called when the user drops a panel onto a valid target. Default:
   * `grid.swapData(sourceId, targetId)`. Pass a custom callback to override
   * — common alternatives are `grid.swap` (structural reorder) or a
   * consumer-managed mutation of upstream state.
   */
  onDrop?: (event: DropEvent<T>) => void,
  /**
   * Fires every time the drag state changes: source set/cleared, target
   * updated, drag-end. Vue consumers wire this to reactive flags exposed
   * via PanelState (isDragging / isDropTarget).
   */
  onDragChange?: (event: DragChangeEvent) => void,
  /**
   * Pointer travel in px before drag actually commits. Below this distance
   * the pointerdown is just a candidate. Defaults to 4.
   */
  threshold?: number,
  /**
   * Whether to render a ghost element that follows the cursor while
   * dragging. Defaults to true. Pass `false` to disable entirely — e.g.,
   * when the consumer already provides its own drag-feedback affordance.
   */
  ghost?: boolean,
  /**
   * Custom factory for the ghost element. Receives `{ sourceId, sourceEl,
   * grid }` and returns the element to mount as the ghost. The plugin
   * positions/sizes it and adds the `sp-drag-ghost` marker class on top.
   * Default: deep-clones the source panel element.
   */
  ghostRender?: (ctx: GhostContext<T>) => HTMLElement,
  /**
   * Anchor offset for the ghost relative to its own bounding box, expressed
   * as fractions in [0, 1]: `{x:0, y:0}` pins the top-left of the ghost to
   * the cursor; `{x:0.5, y:0.5}` centers it; `{x:0.5, y:1}` (the default)
   * pins the bottom-center, matching the original SplitPanel plugin so
   * existing consumers feel the same.
   */
  ghostAnchor?: (ctx: GhostContext<T>) => BoxCoord,
  /**
   * Upper caps for the ghost's pinned dimensions (in px). Either dimension
   * can be omitted. Useful for dashboard-style layouts where the source
   * panel is tall — a full-height ghost obscures the drop zone. The cap
   * only applies to the default size-from-source pinning; a custom
   * `ghostRender` that sets `style.width`/`style.height` overrides both
   * the source rect and this cap.
   */
  ghostMaxSize?: { width?: number, height?: number },
  /**
   * Lower floors for the ghost's pinned dimensions (in px). Symmetric to
   * `ghostMaxSize`; protects against zero-size sources rendering an
   * invisible drag affordance.
   */
  ghostMinSize?: { width?: number, height?: number },
}

export interface DropEvent<T = unknown> {
  sourceId: string,
  targetId: string,
  grid: SplitGrid<T>,
}

export interface DragChangeEvent {
  sourceId: string | null,
  targetId: string | null,
}

const DEFAULT_THRESHOLD = 4;
const DEFAULT_ANCHOR: BoxCoord = { x: 0.5, y: 1 };

function defaultGhostRender<T>(ctx: GhostContext<T>): HTMLElement {
  return ctx.sourceEl.cloneNode(true) as HTMLElement;
}

function clampDim(value: number, min?: number, max?: number): number {
  return Math.max(min ?? 0, Math.min(max ?? Number.POSITIVE_INFINITY, value));
}

function panelIdAt(event: PointerEvent | { target: EventTarget | null }): string | null {
  // Prefer the element under the cursor when we have real coordinates.
  // Fall back to e.target — happy-dom's elementFromPoint returns null,
  // and during a real drag we still want pointerdown-on-handle to work.
  const pointer = event as PointerEvent;
  const fromPoint = typeof pointer.clientX === 'number'
    ? document.elementFromPoint(pointer.clientX, pointer.clientY)
    : null;
  const el = (fromPoint ?? (event.target instanceof Element ? event.target : null));
  const panel = el?.closest('.sp-panel') as HTMLElement | null;

  return panel?.dataset.id ?? null;
}

export function configureDraggable<T = unknown>(
  grid: SplitGrid<T>,
  config: DraggableConfig<T> = {},
): () => void {
  const host = grid.hostElement;

  if (!host) {
    throw new Error('configureDraggable: grid must be mounted before configuring draggable.');
  }

  const dragSelector = config.dragSelector ?? '.sp-panel';
  const threshold = config.threshold ?? DEFAULT_THRESHOLD;
  const canDrag = config.canDrag ?? (() => true);
  const canDrop = config.canDrop ?? (() => true);
  const onDrop = config.onDrop ?? (({ sourceId: src, targetId: tgt, grid: g }: DropEvent<T>) => {
    g.swapData(src, tgt);
  });
  const ghostEnabled = config.ghost !== false;
  const ghostRender = config.ghostRender ?? defaultGhostRender;
  const ghostAnchor = config.ghostAnchor ?? (() => DEFAULT_ANCHOR);
  const ghostMaxSize = config.ghostMaxSize ?? {};
  const ghostMinSize = config.ghostMinSize ?? {};

  let candidateId: string | null = null;
  let sourceId: string | null = null;
  let targetId: string | null = null;
  let startX = 0;
  let startY = 0;

  // Ghost state — created when the drag commits past threshold, torn down
  // on pointerup or dispose. Anchor is captured once per drag (the source
  // can't change mid-gesture, so neither can the anchor offset).
  let ghostEl: HTMLElement | null = null;
  let ghostAnchorX = 0;
  let ghostAnchorY = 0;

  function positionGhost(clientX: number, clientY: number): void {
    if (!ghostEl) return;

    ghostEl.style.left = `${clientX - ghostAnchorX}px`;
    ghostEl.style.top = `${clientY - ghostAnchorY}px`;
  }

  function mountGhost(id: string, e: PointerEvent): void {
    if (!ghostEnabled) return;

    const sourceEl = grid.get(id)?.el as HTMLElement | undefined;

    if (!sourceEl) return;

    // Snapshot the source's rendered dimensions BEFORE the clone is
    // detached and reparented to body. Children that adapt to their
    // container (virtualized lists sized by visible area, `flex: 1`
    // columns, etc) otherwise grow to fill body once the clone loses
    // its sized parent. Pinning width/height to the source rect keeps
    // the floating ghost the size of what the user actually grabbed.
    const sourceRect = sourceEl.getBoundingClientRect();
    const ctx: GhostContext<T> = { sourceId: id, sourceEl, grid };
    const el = ghostRender(ctx);

    el.classList.add('sp-drag-ghost');
    el.style.position = 'fixed';
    el.style.pointerEvents = 'none';

    // Respect an explicit size from a custom `ghostRender` (e.g. a small
    // drag-icon factory). Default cloneNode produces an element with no
    // inline width/height — fall through and pin to the source rect,
    // clamped by `ghostMinSize` / `ghostMaxSize` if the consumer set them.
    const ghostW = clampDim(sourceRect.width, ghostMinSize.width, ghostMaxSize.width);
    const ghostH = clampDim(sourceRect.height, ghostMinSize.height, ghostMaxSize.height);

    if (!el.style.width) el.style.width = `${ghostW}px`;

    if (!el.style.height) el.style.height = `${ghostH}px`;

    // Park above any other UI; consumers can override via the .sp-drag-ghost
    // class if they need a different stacking choice.
    if (!el.style.zIndex) el.style.zIndex = '9999';

    document.body.append(el);
    ghostEl = el;

    const anchor = ghostAnchor(ctx);

    ghostAnchorX = ghostW * anchor.x;
    ghostAnchorY = ghostH * anchor.y;
    positionGhost(e.clientX, e.clientY);
  }

  function removeGhost(): void {
    ghostEl?.remove();
    ghostEl = null;
  }

  function emit(): void {
    config.onDragChange?.({ sourceId, targetId });
  }

  function reset(): void {
    const wasActive = sourceId !== null || targetId !== null;

    candidateId = null;
    sourceId = null;
    targetId = null;
    removeGhost();

    if (wasActive) emit();
  }

  function onPointerMove(e: PointerEvent): void {
    // Phase 1: candidate set but drag not yet committed — wait for threshold.
    if (candidateId && !sourceId) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (Math.hypot(dx, dy) < threshold) return;

      sourceId = candidateId;
      candidateId = null;
      mountGhost(sourceId, e);
      emit();
    }

    if (!sourceId) return;

    positionGhost(e.clientX, e.clientY);

    const overId = panelIdAt(e);
    const isValid = overId !== null && overId !== sourceId && canDrop(sourceId, overId, grid);
    const next = isValid ? overId : null;

    if (next !== targetId) {
      targetId = next;
      emit();
    }
  }

  function onPointerUp(): void {
    document.removeEventListener('pointermove', onPointerMove);

    if (sourceId && targetId) {
      onDrop({ sourceId, targetId, grid });
    }

    reset();
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;

    if (!(e.target instanceof Element)) return;

    const handle = e.target.closest(dragSelector);

    if (!handle) return;

    const panel = handle.closest('.sp-panel') as HTMLElement | null;
    const id = panel?.dataset.id;

    if (!id) return;

    if (!canDrag(id, grid)) return;

    candidateId = id;
    startX = e.clientX;
    startY = e.clientY;

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp, { once: true });
  }

  host.addEventListener('pointerdown', onPointerDown);

  return function dispose(): void {
    host.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('pointermove', onPointerMove);
    reset();
  };
}
