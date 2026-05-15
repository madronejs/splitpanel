/**
 * SplitGrid — vanilla-DOM runtime for a CSS Grid-based split panel.
 *
 * Construction walks the node tree and builds a DOM mirror: each container is
 * a `<div class="sp-container">` with `display: grid`, each leaf is a
 * `<div class="sp-panel">`, and dividers are `<div class="sp-resizer">`
 * elements interleaved between children. All sizing is driven by a single
 * inline `--sp-tracks` per container; the browser does the layout math and
 * the bounds-clamping via `clamp()` in the track string.
 *
 * Drag math lives in ./drag.ts, track-string generation in ./track.ts. This
 * file is wiring: event handlers, snapshot management, and DOM construction.
 */

import type {
  Bounds,
  Container,
  Leaf,
  Length,
  LengthInput,
  Node,
  PanelDirectionInput,
  ResizerSpec,
} from './types';
import { isContainer, PanelDirection } from './types';
import {
  asContainerAxis, asPctBudget, parseLength, pxToPct, sizesFromPx, toPx,
  type ContainerAxisPx, type PctBudgetPx, type StorageUnit,
} from './length';
import { measureAxis, measureChildrenPx } from './geometry';
import { distributeProportional } from './distribute';
import { trackString } from './track';
import { PointerDragState } from './pointerDrag';

export interface SplitGridConfig<T = unknown> {
  /** Root container definition. */
  root: Container<T>,
  /** Render hook called once per leaf when its element is created. */
  renderLeaf?: (ctx: LeafCtx<T>) => void,
  /** Default resizer spec, applied to any container that doesn't override. */
  resizer?: ResizerSpec,
  /** Animation duration in ms for programmatic size changes. Defaults to 750. */
  animationMs?: number,
  /**
   * Fires after every successful layout mutation. Use it to persist state
   * (localStorage, URL, etc.) or sync to external systems. Drag fires this
   * once per accepted mousemove (typically 60–120 Hz); debounce on the
   * consumer side if your handler is expensive.
   */
  onChange?: (event: LayoutChangeEvent) => void,
  /**
   * Emit console diagnostics: each writeTracks (container id, tracks, rect),
   * each drag start/move (sizes, availPx, totalAxisPx), and dblclick targets.
   * Off by default; turn on while iterating on layout edge cases.
   */
  debug?: boolean,
}

/**
 * Reason codes accompanying every `onChange` event.
 *
 * `maximize` / `minimize` are distinct from `set-size` so consumers
 * persisting layout state can tell "user dragged to 100%" (set-size)
 * from "user clicked the maximize affordance" (maximize). Both paths
 * write the same physical px through `applySize`; only the reason
 * differs.
 */
export type LayoutChangeReason = | 'drag'
  | 'set-size'
  | 'maximize'
  | 'minimize'
  | 'toggle-expand'
  | 'equalize'
  | 'reset'
  | 'add-child'
  | 'remove-child'
  | 'swap'
  | 'swap-data'
  | 'move-data'
  | 'set-data'
  | 'set-direction'
  | 'set-bounds';

export interface LayoutChangeEvent {
  /**
   * The container(s) whose layout changed.
   *
   * - String: the normal single-container case (every reason except
   *   cross-parent swap).
   * - `[string, string]` tuple: cross-parent swap, where BOTH
   *   containers' children moved. Discriminate with `Array.isArray`.
   *
   * Same-parent swap stays a string — both nodes share a container.
   */
  containerId: string | [string, string],
  /** What kind of mutation produced the event. */
  reason: LayoutChangeReason,
  /**
   * Snapshot of the affected container's child sizes after the change.
   * Cloned, so consumers can hold the reference safely.
   *
   * For multi-container events (cross-parent swap), this is a tuple
   * whose entries correspond positionally to `containerId`:
   * `sizes[0]` is `containerId[0]`'s children's sizes; `sizes[1]` is
   * `containerId[1]`'s.
   */
  sizes: Length[] | [Length[], Length[]],
  /**
   * Ids of nodes directly affected by this mutation. Used by subscribers
   * for per-panel filtering. Empty when the change affects every child
   * of `containerId` (drag, equalize, reset, set-direction) — consumers
   * treating empty-array as "all children" handle both shapes uniformly.
   */
  nodeIds: string[],
}

/**
 * Listener registered via `grid.subscribe(cb)`. Same shape as the
 * `cfg.onChange` callback; both fire on every layout mutation.
 */
export type LayoutListener = (event: LayoutChangeEvent) => void;

export interface LeafCtx<T = unknown> {
  id: string,
  data: T | undefined,
  el: HTMLElement,
  leaf: Leaf<T>,
}

/**
 * What `getSize` returns for a node. `px` is the rendered axis length
 * (width for row containers, height for column); `pct` is the same value
 * expressed as a fraction of the parent container's axis — useful for
 * persisting layout as a percentage independent of viewport size.
 */
export interface PanelSizeReport {
  px: number,
  pct: number,
}

/**
 * Shared options for every method that mutates layout state (`setSize`,
 * `toggleExpand`, `expandNext`/`Prev`, `equalize`, `reset`). The default is
 * to animate via the standard transition; pass `animate: false` to apply
 * the change instantly (same path drag uses).
 */
export interface LayoutOptions {
  animate?: boolean,
}

/**
 * Maximize state for a container. The two fields a maximize tracks —
 * which child is maxed, and what to restore to — are united so they can't
 * disagree. `null` means no maximize is in effect.
 */
type Maximize = null | { id: string, restore: Length[] };

interface ContainerState {
  node: Container,
  el: HTMLElement,
  /** Current size per child. Same length as node.children. */
  sizes: Length[],
  /**
   * Maximize state. `null` when no child is maximized; otherwise carries
   * the maximized id AND the sizes snapshot captured BEFORE the maximize
   * (the layout `toggleExpand` reverts to). One field instead of a paired
   * `maxId` / `restore` fields — the "they always move together" invariant is
   * now structural; you can't have one without the other.
   */
  max: Maximize,
  /** Cached available content space (parent track minus resizer tracks). */
  availPx: number,
  /** Parent container; `undefined` only for the root. Mirrors LeafState. */
  parent: ContainerState | undefined,
  /** Index in `parent.node.children`; `0` for the root. */
  indexInParent: number,
}

interface LeafState {
  node: Leaf,
  el: HTMLElement,
  parent: ContainerState,
  indexInParent: number,
}

type NodeState = ContainerState | LeafState;
type LogPayload = Record<string, unknown>;

const isContainerState = (s: NodeState): s is ContainerState => 'sizes' in s;

const ANIM_VAR = '--sp-anim-ms';

function childElementAt(containerEl: HTMLElement, idx: number): HTMLElement | undefined {
  // Content children are .sp-panel or .sp-container elements; resizers are
  // .sp-resizer. We can't rely on a fixed stride because leading/trailing
  // resizers (the legacy `showFirstResizeEl` analog) shift positions. Walk
  // children and pick the idx-th non-resizer.
  let seen = 0;

  for (const child of containerEl.children) {
    if (!(child as HTMLElement).classList.contains('sp-resizer')) {
      if (seen === idx) return child as HTMLElement;

      seen += 1;
    }
  }
  return undefined;
}

function parseLengthToPxAxis(input: LengthInput, axisPx: ContainerAxisPx): number {
  const l = parseLength(input);

  if (l.unit === 'px') return l.value;

  if (l.unit === 'pct') return (l.value / 100) * axisPx;
  return 0;
}

/**
 * Resolve `bounds.min`/`.max` to pixels against `containerAxisPx` — the
 * FULL grid container axis, NOT `availPx` (content area).
 *
 * Why containerAxisPx: CSS resolves `<pct>` track values against the grid
 * container, including resizer tracks. If JS clamps a panel using `availPx`
 * but CSS displays the track using `containerAxisPx`, the two disagree by
 * `pct * resizerTracksPx`, and the grid overflows by that much — for
 * `min: 25%` over 5×20px resizers in a 1176px container, ~25px of overflow.
 */
function clampToBounds(
  px: number,
  bounds: { min?: LengthInput, max?: LengthInput } | undefined,
  containerAxisPx: ContainerAxisPx,
): number {
  const min = toPx(parseLength(bounds?.min, { unit: 'px', value: 0 }), containerAxisPx);
  const max = bounds?.max == null
    ? Number.POSITIVE_INFINITY
    : toPx(parseLength(bounds.max), containerAxisPx);

  return Math.max(min, Math.min(max, px));
}

/** Same denominator rule as clampToBounds: bounds.min/max resolve against containerAxisPx. */
function boundsMinPx(bounds: { min?: LengthInput } | undefined, containerAxisPx: ContainerAxisPx): number {
  return toPx(parseLength(bounds?.min, { unit: 'px', value: 0 }), containerAxisPx);
}

/**
 * Sum every entry of `arr` except the one at `exceptIdx`. The "sum the
 * siblings of `target`" pattern appears in every rebalance helper — at
 * the layout level: target gets one size, siblings absorb the rest, so
 * we always want `Σ arr − arr[target]` for some array of per-child px
 * floors / ceilings / current sizes. Inline `for` loop on a number array
 * (no allocation, no callback).
 */
function sumExceptAt(arr: readonly number[], exceptIdx: number): number {
  let sum = 0;

  for (const [i, v] of arr.entries()) {
    if (i !== exceptIdx) sum += v;
  }
  return sum;
}

/** Mirror of `boundsMinPx` for the upper bound — `undefined` reads as +Infinity. */
function boundsMaxPx(bounds: { max?: LengthInput } | undefined, containerAxisPx: ContainerAxisPx): number {
  return bounds?.max == null
    ? Number.POSITIVE_INFINITY
    : toPx(parseLength(bounds.max), containerAxisPx);
}

function formatLengthForLog(l: Length): string {
  if (l.unit === 'px') return `${Math.round(l.value * 100) / 100}px`;

  if (l.unit === 'pct') return `${Math.round(l.value * 1000) / 1000}%`;
  return `${l.value}fr`;
}

/**
 * Resolve when `el` finishes transitioning its `grid-template-columns` or
 * `grid-template-rows`. The browser fires `transitionend` per-property, so
 * the listener also filters on `propertyName` — unrelated property
 * transitions (the demo's hover effects, for instance) shouldn't unblock.
 *
 * The fallback timeout is mandatory: `transitionend` is not guaranteed to
 * fire when the value didn't actually change, when `animate: false`
 * suppressed the transition, or in any browser that pauses transitions on
 * detached subtrees. Without it, `settle()` could hang forever on a no-op
 * mutation.
 */
function waitForContainerTransition(el: HTMLElement, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout>;

    function finish(): void {
      if (done) return;

      done = true;
      el.removeEventListener('transitionend', onEnd);
      clearTimeout(timer);
      resolve();
    }

    function onEnd(e: TransitionEvent): void {
      if (e.target !== el) return;

      if (e.propertyName !== 'grid-template-columns' && e.propertyName !== 'grid-template-rows') return;

      finish();
    }

    timer = setTimeout(finish, timeoutMs);
    el.addEventListener('transitionend', onEnd);
  });
}

export class SplitGrid<T = unknown> {
  private readonly cfg: SplitGridConfig<T>;
  private readonly byId = new Map<string, NodeState>();
  private readonly subscribers = new Set<LayoutListener>();
  private rootEl: ContainerState | null = null;
  private host: HTMLElement | null = null;
  private rootObserver: ResizeObserver | null = null;
  private rafScheduled = false;
  /**
   * Handle for the pending `scheduleMeasure` rAF, so `unmount` can cancel
   * it. Without this, a rAF in flight when the host is torn down lives on
   * past unmount, and the next remount under the same host (same instance
   * reused) starts with `rafScheduled = true` — quietly swallowing the
   * first legitimate `scheduleMeasure` request.
   */
  private rafHandle: number | null = null;
  /**
   * Per-resizer pointer-drag state machines, keyed by resizer element.
   * Created in `attachDrag` and disposed in `detachResizers` so a structural
   * mutation that drops a resizer element also tears down its event
   * listeners — preventing the mid-drag-unmount listener leak the closure
   * version had.
   */
  private readonly dragStates = new WeakMap<HTMLElement, PointerDragState>();

  constructor(cfg: SplitGridConfig<T>) {
    this.cfg = cfg;
  }

  /** Mount the tree into `host`. Existing children of `host` are not touched. */
  mount(host: HTMLElement): void {
    if (this.host) throw new Error('SplitGrid: already mounted');

    this.host = host;
    host.style.setProperty(ANIM_VAR, `${this.cfg.animationMs ?? 750}ms`);
    this.rootEl = this.buildContainer(this.cfg.root);
    host.append(this.rootEl.el);

    // Initial measure happens synchronously now that the element is in the
    // DOM. We then fold user-input pct values (left in `c.sizes` by
    // `buildContainer` before any geometry was available) into storage
    // form, and re-emit tracks so what CSS sees matches the storage frame.
    // Without the synchronous pass, the first paint and the post-measure
    // re-render would be visibly different.
    this.measureAll(this.rootEl);
    this.normalizeInitialSizes(this.rootEl);
    this.writeAllTracks(this.rootEl);

    this.rootObserver = new ResizeObserver(() => this.scheduleMeasure());
    this.rootObserver.observe(this.rootEl.el);
  }

  /**
   * Recursively writeTracks every container in the subtree. Used by
   * `mount` after the initial normalize pass; nothing else should need it
   * — runtime mutators already write their own container.
   */
  private writeAllTracks(c: ContainerState): void {
    this.writeTracks(c, { animate: false });

    for (const child of c.node.children) {
      const s = this.byId.get(child.id);

      if (s && isContainerState(s)) this.writeAllTracks(s);
    }
  }

  unmount(): void {
    this.rootObserver?.disconnect();

    // Cancel any rAF the ResizeObserver enqueued before we got here. We
    // also reset `rafScheduled` so a future `scheduleMeasure` (during a
    // remount on the same instance) isn't silently swallowed by the
    // dedup guard.
    if (this.rafHandle != null) cancelAnimationFrame(this.rafHandle);

    this.rafHandle = null;
    this.rafScheduled = false;

    // Walk every container in the tree and dispose each container's
    // direct-child resizers via the same `detachResizers` helper used
    // for per-container churn. We have to do it BEFORE the
    // host.removeChild — once the elements are detached, the WeakMap
    // entries are still reachable from `this.dragStates` (via the keyed
    // HTMLElement references that GC hasn't collected yet), so we'd
    // leak their global listeners until the next GC pass.
    //
    // Going through detachResizers (instead of a host-wide
    // querySelectorAll) keeps the resizer-disposal selector consistent
    // (`:scope > .sp-resizer` everywhere) so a future reader doesn't
    // wonder why teardown and churn use different scopes.
    for (const s of this.byId.values()) {
      if (isContainerState(s)) this.detachResizers(s);
    }

    if (this.rootEl && this.host?.contains(this.rootEl.el)) {
      this.host.removeChild(this.rootEl.el);
    }

    this.rootEl = null;
    this.host = null;
    this.byId.clear();
  }

  /** Find a node's runtime state by id. */
  get(id: string): NodeState | undefined { return this.byId.get(id); }

  /** Element the grid was mounted into. Null before mount and after unmount. */
  get hostElement(): HTMLElement | null { return this.host; }

  /**
   * Set a panel to `size` and rebalance siblings so the container stays full.
   * Works for both leaves and nested containers. The request is clamped to
   * the target's own min/max, then the remaining space is distributed across
   * the siblings (proportional to their current sizes, above their mins).
   *
   * Animates because writeTracks fires under the standard transition.
   */
  setSize(id: string, size: LengthInput, opts?: LayoutOptions): void {
    this.applySize(id, size, 'set-size', opts);
  }

  /**
   * Shared body of `setSize`, `maximize`, and `minimize`. Splitting these
   * along the emit reason — instead of routing maximize/minimize through
   * the public `setSize` — keeps the `LayoutChangeReason` faithful to the
   * user intent that triggered the mutation. Mechanically the three are
   * identical: clamp the request against `bounds`, run `applyTargetSize`,
   * emit with the caller's reason.
   */
  private applySize(id: string, size: LengthInput, reason: LayoutChangeReason, opts?: LayoutOptions): void {
    const s = this.byId.get(id);

    if (!s) return;

    const { parent } = s;

    if (!parent) return;

    if (!this.prepareForLayoutOp(parent)) return;

    const avail = parent.availPx;
    const totalAxisPx = this.containerAxisPx(parent);
    const targetIdx = s.indexInParent;
    const { bounds } = parent.node.children[targetIdx];
    // ALL pct resolutions go through containerAxisPx — match CSS's own
    // resolution of percentage tracks (which is against the full grid
    // container, including resizer tracks). `setSize('100%')` resolves to
    // containerAxisPx; applyTargetSize then clamps to avail so the panel
    // can't exceed the content-area budget. Mixing denominators here is
    // what produced the cumulative drift in the dashboard logs (sizes
    // shifted by ±12.5% between adjacent writeTracks calls).
    const requestedPx = toPx(parseLength(size), totalAxisPx);
    const clampedPx = clampToBounds(requestedPx, bounds, totalAxisPx);

    this.applyTargetSize(parent, targetIdx, clampedPx);
    this.writeTracks(parent, opts);
    this.emit(reason, parent, [id]);
    this.log('applySize', () => ({
      id,
      reason,
      requested: size,
      containerId: parent.node.id,
      containerAxisPx: totalAxisPx,
      resizerTracksPx: this.resizerTracksPx(parent, totalAxisPx),
      availPx: avail,
      requestedPx,
      clampedPx,
      sizes: parent.sizes.map((l) => formatLengthForLog(l)),
    }));
  }

  /**
   * Insert a node into `parentId`'s children at `index` (default: append).
   * The new node uses its own `bounds.size` as its initial size; siblings
   * keep theirs. CSS Grid will overflow if the new total exceeds 100% — call
   * `setSize` on neighbors if you want to rebalance.
   *
   * Container nodes can themselves contain children; the whole subtree is
   * built recursively. Duplicate ids are rejected.
   */
  addChild(parentId: string, def: Node<T>, index?: number): void {
    const parent = this.byId.get(parentId);

    if (!parent || !isContainerState(parent)) {
      this.log('addChild: parent not found or not a container', { parentId });
      return;
    }

    if (this.byId.has(def.id)) {
      this.log('addChild: duplicate id', { id: def.id });
      return;
    }

    const at = Math.max(0, Math.min(index ?? parent.node.children.length, parent.node.children.length));

    this.mutateStructure(parent, () => {
      parent.node.children.splice(at, 0, def);
      // Splice as user-input form first (parseLength yields container-pct
      // for pct inputs); we don't know `parent`'s budget until the new
      // child is in `c.sizes`, since pctBudgetPx subtracts px tracks
      // including the new one. Convert immediately after.
      parent.sizes.splice(at, 0, parseLength(def.bounds?.size));
      parent.sizes[at] = this.toStorageForm(parent.sizes[at], parent);
      // Make room: existing pct siblings may already saturate the
      // container (post-equalize / post-maximize), in which case the
      // new panel would render at 0 width. See `makeRoom` for the math.
      this.makeRoom(parent, at);

      const newState = isContainer(def)
        ? this.buildContainer(def, parent, at)
        : this.buildLeaf(def, parent, at);
      const domChildren = [...parent.el.children] as HTMLElement[];

      if (at >= domChildren.length) parent.el.append(newState.el);
      else parent.el.insertBefore(newState.el, domChildren[at]);
    });
    this.log('addChild', { parentId, id: def.id, at });
    this.emit('add-child', parent, [def.id]);
  }

  /**
   * Remove the node with `id` (and its whole subtree). The freed pct is
   * absorbed proportionally by remaining pct-sized siblings so the layout
   * still fills the container; px-sized siblings stay put.
   *
   * No-op for the root or unknown ids.
   */
  removeChild(id: string): void {
    const s = this.byId.get(id);

    if (!s) {
      this.log('removeChild: not found', { id });
      return;
    }

    const { parent } = s;

    if (!parent) {
      this.log('removeChild: cannot remove root', { id });
      return;
    }

    const at = s.indexInParent;

    this.mutateStructure(parent, () => {
      s.el.remove();
      parent.node.children.splice(at, 1);

      const [removedSize] = parent.sizes.splice(at, 1);

      this.removeSubtreeFromMap(s);

      if (removedSize.unit === 'pct') this.absorbVacancy(parent.sizes, removedSize.value);
    });
    this.log('removeChild', { id, parentId: parent.node.id, at });
    this.emit('remove-child', parent, [id]);
  }

  /**
   * Reconcile `containerId`'s children to match `defs` (matched by id):
   * removes anything not in the list, inserts new entries at their index,
   * and reorders existing entries via selection-sort-style swaps. Sizes of
   * surviving panels are preserved; new panels get their `bounds.size`.
   *
   * For "I have an upstream list of items and want the panel list to mirror
   * it" use-cases. Each underlying mutation still fires its own onChange
   * (add-child / remove-child / swap), so subscribers see the granular ops.
   *
   * No-op for unknown ids or leaves.
   */
  syncChildren(containerId: string, defs: Array<Node<T>>): void {
    const c = this.byId.get(containerId);

    if (!c || !isContainerState(c)) {
      this.log('syncChildren: not a container', { containerId });
      return;
    }

    const newIds = new Set(defs.map((d) => d.id));

    // 1. Remove children that aren't in the new list. Walk back-to-front so
    //    removeChild's in-place splice only shifts indices we've already
    //    visited.
    for (let i = c.node.children.length - 1; i >= 0; i -= 1) {
      const existing = c.node.children[i];

      if (!newIds.has(existing.id)) this.removeChild(existing.id);
    }

    // 2. Walk the desired order. For each position:
    //    - missing in container         → addChild at index i
    //    - present at the wrong index   → swap with the panel currently at i
    //    - already at index i           → leave alone
    //
    //    This is selection sort by id: after iteration i, position i is
    //    correct, and positions 0..i-1 stay correct (the panel formerly at i
    //    moved out to wherever the swapped-in panel came from, which is
    //    somewhere we haven't visited yet).
    for (const [i, def] of defs.entries()) {
      const currentIdx = c.node.children.findIndex((x) => x.id === def.id);

      if (currentIdx === -1) {
        this.addChild(containerId, def, i);
      } else if (currentIdx !== i) {
        this.swap(def.id, c.node.children[i].id);
      }
    }

    this.log('syncChildren', { containerId, count: defs.length });
  }

  /**
   * Bulk wrapper for `setData`: applies `data` to each `{ id }` in `items`,
   * skipping unknown ids. Fires one set-data event per affected leaf —
   * consumers that need a single coalesced event can batch with their own
   * subscriber-side debounce.
   */
  setDataArray(items: Array<{ id: string, data: T | undefined }>): void {
    for (const { id, data } of items) {
      this.setData(id, data);
    }
  }

  /**
   * Swap two nodes' positions in the tree. Works within a container and
   * across containers. Rejects (no-op + log) when one node is an ancestor
   * of the other — that would create a cycle. Sizes follow the panel, not
   * the slot, so each swapped panel keeps the space it had before.
   *
   * Resizer event handlers close over their container's state (not specific
   * children), so the resizers in both affected containers are rebuilt to
   * pick up the new children array.
   */
  swap(idA: string, idB: string): void {
    const a = this.byId.get(idA);
    const b = this.byId.get(idB);

    if (!a || !b || a === b) return;

    if (!a.parent || !b.parent) {
      this.log('swap: cannot swap root', { idA, idB });
      return;
    }

    if (this.isAncestor(a, b) || this.isAncestor(b, a)) {
      this.log('swap: ancestor/descendant conflict', { idA, idB });
      return;
    }

    const pA = a.parent;
    const pB = b.parent;
    const iA = a.indexInParent;
    const iB = b.indexInParent;

    if (pA === pB) {
      // Same parent: swap the two slots in children, sizes, and DOM.
      this.mutateStructure(pA, () => {
        [pA.node.children[iA], pA.node.children[iB]] = [pA.node.children[iB], pA.node.children[iA]];
        [pA.sizes[iA], pA.sizes[iB]] = [pA.sizes[iB], pA.sizes[iA]];

        const els = [...pA.el.children] as HTMLElement[];

        [els[iA], els[iB]] = [els[iB], els[iA]];
        pA.el.replaceChildren(...els);
      });
      this.emit('swap', pA, [idA, idB]);
    } else {
      // Cross-parent: each parent gets the other's node in the same slot.
      // Size swaps too, so each panel keeps its own width when moving.
      // We need to mutate both containers; `mutateStructure` runs the
      // surrounding boilerplate per-container, so call it twice with
      // mutators scoped to each side. The model edits happen in one go
      // (inside the first mutator) because they reference both states;
      // the second call only runs the per-container bookkeeping.
      this.mutateStructure(pA, () => {
        pA.node.children[iA] = b.node as Node<T>;
        pB.node.children[iB] = a.node as Node<T>;
        [pA.sizes[iA], pB.sizes[iB]] = [pB.sizes[iB], pA.sizes[iA]];

        const aSlots = [...pA.el.children] as HTMLElement[];
        const bSlots = [...pB.el.children] as HTMLElement[];

        aSlots[iA] = b.el;
        bSlots[iB] = a.el;
        pA.el.replaceChildren(...aSlots);
        pB.el.replaceChildren(...bSlots);

        a.parent = pB;
        a.indexInParent = iB;
        b.parent = pA;
        b.indexInParent = iA;
      });
      // Second container's bookkeeping: detach + rebuild resizers,
      // clear max, reindex. No new mutation work — the model edits
      // above already touched both sides.
      this.mutateStructure(pB);
      // Single composed event covering both containers — the tuple
      // shape on LayoutChangeEvent.containerId / sizes preserves the
      // "one mutation, one event" contract that every other reason
      // already follows.
      this.emit('swap', [pA, pB], [idA, idB]);
    }

    this.log('swap', { idA, idB });
  }

  /**
   * Replace a leaf's `data` field. The slot and its size stay in place; only
   * the bound data changes. No-op for containers (data is leaf-only) or
   * unknown ids.
   */
  setData(id: string, data: T | undefined): void {
    const s = this.byId.get(id);

    if (!s || isContainerState(s)) {
      this.log('setData: not a leaf', { id });
      return;
    }

    const leaf = s.node as Leaf<T>;

    // Reference-equal: no-op. Guards against Vue's shallow watcher firing
    // on a `:data` prop re-bound to the same value (or to inline literals
    // that recreate the object every render — that path is also defended
    // by the `<SplitPanel>` watcher comparing oldData !== newData, but a
    // second layer here keeps the core API safe regardless of caller).
    if (Object.is(leaf.data, data)) return;

    leaf.data = data;

    if (s.parent) this.emit('set-data', s.parent, [id]);

    this.log('setData', { id });
  }

  /**
   * Swap the `data` fields of two leaves while keeping every panel in place
   * (slot positions, sizes, parents — all unchanged). Useful for drag-drop
   * reorder UX where the user is moving content, not the container itself.
   * No-op when either id refers to a container or is unknown.
   */
  swapData(idA: string, idB: string): void {
    const a = this.byId.get(idA);
    const b = this.byId.get(idB);

    if (!a || !b || a === b) return;

    if (isContainerState(a) || isContainerState(b)) {
      this.log('swapData: only leaves carry data', { idA, idB });
      return;
    }

    const la = a.node as Leaf<T>;
    const lb = b.node as Leaf<T>;
    const tmp = la.data;

    la.data = lb.data;
    lb.data = tmp;

    if (a.parent) this.emit('swap-data', a.parent, [idA, idB]);

    if (b.parent && b.parent !== a.parent) this.emit('swap-data', b.parent, [idA, idB]);

    this.log('swapData', { idA, idB });
  }

  /**
   * Move source's data into target's slot, shifting any data values between
   * them. Same-container only — cross-parent moves are undefined (use
   * `swap` or `swapData` for that). The IDs (and therefore slot positions)
   * don't change; only the data flows through them.
   *
   * Example: `[A, B, C, D]` calling `moveData('a', 'c')` →
   *   - source index 0 (A), target index 2 (C)
   *   - splice A out of the list: `[B, C, D]`
   *   - insert at target's index (2): `[B, C, A, D]`
   *   - reassign by slot order: `a → B, b → C, c → A, d → D`
   *
   * Mirrors the legacy `SplitPanel.moveData` semantic used by swarm's
   * drag-drop reorder.
   */
  moveData(sourceId: string, targetId: string): void {
    if (sourceId === targetId) return;

    const source = this.byId.get(sourceId);
    const target = this.byId.get(targetId);

    if (!source || !target) return;

    if (isContainerState(source) || isContainerState(target)) {
      this.log('moveData: only leaves carry data', { sourceId, targetId });
      return;
    }

    // Same-parent only. Cross-parent shift would have to decide which slot
    // the source frees up across containers; leave that to the consumer.
    if (source.parent !== target.parent || !source.parent) {
      this.log('moveData: cross-parent ignored — use swap/swapData', { sourceId, targetId });
      return;
    }

    const { parent } = source;
    const ordered = parent.node.children;
    const srcIdx = source.indexInParent;
    const tgtIdx = target.indexInParent;
    // Pull current data values in slot order, splice source out, insert
    // at target's index. Then reassign to the (unchanged) slot ids in order.
    const data = ordered.map((c) => (c as Leaf<T>).data);
    const [moved] = data.splice(srcIdx, 1);

    data.splice(tgtIdx, 0, moved);

    for (const [i, child] of ordered.entries()) (child as Leaf<T>).data = data[i];

    this.emit('move-data', parent, [sourceId, targetId]);
    this.log('moveData', { sourceId, targetId });
  }

  /**
   * Flip a container's direction at runtime. Sizes (percentages) stay numerically
   * the same; they now resolve against the new axis. If you care about preserving
   * visual proportions, call `equalize` after to redistribute.
   */
  setDirection(containerId: string, direction: PanelDirectionInput, opts?: LayoutOptions): void {
    const c = this.byId.get(containerId);

    if (!c || !isContainerState(c)) return;

    if (c.node.direction === direction) return;

    c.node.direction = direction;
    c.el.dataset.direction = direction;
    // availPx is axis-dependent — remeasure for the next drag/maximize.
    this.scheduleMeasure();
    this.writeTracks(c, opts);
    this.emit('set-direction', c);
    this.log('setDirection', { containerId, direction });
  }

  /**
   * Mutate a node's `bounds` (min/max/size) and re-fit the panel into the
   * new constraints. Re-clamping the current intended size and then running
   * the standard proportional rebalance is the key step: a new `min` that
   * lies above the current size, or a new `max` below it, would otherwise
   * let CSS's `clamp()` push the rendered track size past what siblings
   * know about, overflowing the container.
   */
  setBounds(id: string, bounds: Partial<Bounds>, opts?: LayoutOptions): void {
    const s = this.byId.get(id);

    if (!s) return;

    const current: Bounds = s.node.bounds ?? {};
    const merged: Bounds = { ...current, ...bounds };

    // Reference-stable no-op: every field of `merged` matches `current`.
    // Vue's shallow watcher on `<SplitPanel>` props fires on each render
    // when the consumer writes `:size="someComputed"`, `:min="..."`, etc.,
    // even when nothing changed. Without this guard, every render would
    // re-trigger applyTargetSize + a writeTracks event — surfacing as
    // "panel sizes drift on every Vue update" in the wild. Keep the
    // comparison simple: same value via Object.is on each field.
    if (
      Object.is(current.size, merged.size)
      && Object.is(current.min, merged.min)
      && Object.is(current.max, merged.max)
    ) {
      return;
    }

    s.node.bounds = merged;

    const { parent } = s;

    if (!parent) {
      // Root has no parent container to rebalance against — no sibling
      // sizes change — but the bounds patch is still persisted on the
      // node, and subscribers persisting bounds via onChange need to
      // see the event. Skip the rebalance, fire the emit.
      if (isContainerState(s)) this.emit('set-bounds', s, [id]);

      this.log('setBounds: root', { id, bounds });
      return;
    }

    if (!this.prepareForLayoutOp(parent)) {
      // Pre-measure / detached host: bounds patch is persisted on the
      // node, but the rebalance/emit path runs against zero geometry and
      // would store all-zero sizes. Skip silently; a later live op will
      // pick up the fresh bounds.
      this.log('setBounds: zero avail, deferred rebalance', { id, bounds });
      return;
    }

    const totalAxisPx = this.containerAxisPx(parent);
    const budget = this.pctBudgetPx(parent);
    const targetIdx = s.indexInParent;

    // Two denominators, two roles:
    //  - User-supplied `merged.size` (pct, if given) is a CSS-native value —
    //    "50% of the container" — so it resolves against containerAxisPx.
    //  - The "keep current size" path reads `parent.sizes[targetIdx]`, which
    //    is in storage form (% of pctBudgetPx) — so it resolves against
    //    `budget`. Mixing them here was the drift source pre-refactor.
    const rawTarget = bounds.size === undefined
      ? toPx(parent.sizes[targetIdx], budget)
      : toPx(parseLength(merged.size), totalAxisPx);
    const targetPx = clampToBounds(rawTarget, merged, totalAxisPx);

    this.applyTargetSize(parent, targetIdx, targetPx);
    this.writeTracks(parent, opts);
    this.emit('set-bounds', parent, [id]);
    this.log('setBounds', { id, bounds });
  }

  /**
   * Make `id` as large as its bounds and parent allow.
   *
   * Records `parent.max = { id, restore }` (the pre-maximize snapshot) so
   * `isMaximized(id)` reflects the state and a later `toggleExpand` can
   * revert. If another sibling is already maxed, its snapshot is
   * restored first so ours captures the natural layout, not a stacked
   * one — invariant: at most one maximized child per container.
   * `minimize` instead clears the state and drops the panel to 0%.
   */
  maximize(id: string, opts?: LayoutOptions): void {
    const s = this.byId.get(id);
    const parent = s?.parent;

    if (parent) {
      if (parent.max?.id === id) {
        this.applySize(id, '100%', 'maximize', opts);
        return;
      }

      // Someone else is maximized — restore them first so our snapshot
      // captures the natural state, not a stacked one.
      if (parent.max) parent.sizes = [...parent.max.restore];

      parent.max = { id, restore: [...parent.sizes] };
    }

    this.log('maximize', { id, containerId: parent?.node.id });
    this.applySize(id, '100%', 'maximize', opts);
  }

  /**
   * Shrink `id` to its min (or 0 if no min). Siblings absorb the freed space.
   *
   * If `id` was the currently-maximized child, clear `parent.max` so
   * `isMaximized(id)` reads `false` afterwards. Pair `maximize` ↔
   * `minimize` for a clean "expand / collapse to zero" toggle, distinct
   * from `toggleExpand` (which collapses to the prior layout via the
   * snapshot).
   */
  minimize(id: string, opts?: LayoutOptions): void {
    const s = this.byId.get(id);
    const parent = s?.parent;

    if (parent?.max?.id === id) {
      parent.max = null;
    }

    this.log('minimize', { id, containerId: parent?.node.id });
    this.applySize(id, '0%', 'minimize', opts);
  }

  /**
   * Toggle between `maximize` and `minimize` on the same panel. Different
   * from `toggleExpand` — that one restores to the snapshotted prior layout
   * when called on an already-maximized panel, which can read as "everything
   * equalized" if the snapshot was the initial state. This one explicitly
   * collapses to 0% on the second invocation, matching dblclick-on-divider
   * affordances where users expect "expand / collapse" to be symmetric.
   */
  toggleMaximize(id: string, opts?: LayoutOptions): void {
    if (this.isMaximized(id)) this.minimize(id, opts);
    else this.maximize(id, opts);
  }

  /** True if `maybeAncestor` is on the parent chain of `node` (or equal). */
  private isAncestor(maybeAncestor: NodeState, node: NodeState): boolean {
    let cur: ContainerState | undefined = node.parent;

    while (cur) {
      if (cur === maybeAncestor) return true;

      cur = cur.parent;
    }
    return false;
  }

  /** Remove every `.sp-resizer` child from a container's element. */
  private detachResizers(c: ContainerState): void {
    // querySelectorAll returns a static NodeList; safe to mutate during iteration.
    const resizers = c.el.querySelectorAll<HTMLElement>(':scope > .sp-resizer');

    for (const r of resizers) {
      // Dispose the drag state machine BEFORE removing the element. If a
      // drag is in flight, `dispose` ends it with reason 'unmount' so the
      // global pointer listeners are removed and dataset.dragging cleared
      // — the closure-based version leaked these when a structural
      // mutation dropped a resizer mid-drag.
      this.dragStates.get(r)?.dispose();
      this.dragStates.delete(r);
      r.remove();
    }
  }

  /**
   * Resolve the effective resizer spec for `c`: the node's own `resizer`
   * overrides; otherwise inherit `cfg.resizer`. Every internal site that
   * reads resizer config goes through this — `trackString`, the pixel
   * accounting in `resizerTracksPx`, and the runtime DOM build in
   * `rebuildResizers` / `buildContainer` must agree, or the inline tracks
   * disagree with JS's idea of how much space they consume.
   */
  private getResizerSpec(c: { node: { resizer?: ResizerSpec } } | { resizer?: ResizerSpec }): ResizerSpec | undefined {
    const node = 'node' in c ? c.node : c;

    return node.resizer ?? this.cfg.resizer;
  }

  /** Re-insert resizers between the (currently resizer-free) child elements. */
  private rebuildResizers(c: ContainerState): void {
    const resizerSpec = this.getResizerSpec(c);
    const children = [...c.el.children] as HTMLElement[];

    // Inner dividers — one before each non-first child.
    for (let i = 1; i < children.length; i += 1) {
      c.el.insertBefore(this.buildResizer(c, i, resizerSpec), children[i]);
    }

    // Optional decorative leading / trailing tracks, matching buildContainer.
    if (resizerSpec?.first && children.length > 0) {
      c.el.insertBefore(this.buildResizer(c, -1, resizerSpec), c.el.firstChild);
    }

    if (resizerSpec?.last && children.length > 0) {
      c.el.append(this.buildResizer(c, c.node.children.length, resizerSpec));
    }
  }

  /** Refresh `indexInParent` for every sibling at or after `from`. */
  private reindexFrom(parent: ContainerState, from: number): void {
    for (let i = from; i < parent.node.children.length; i += 1) {
      const sibling = this.byId.get(parent.node.children[i].id);

      if (sibling) sibling.indexInParent = i;
    }
  }

  /**
   * Wrap a structural mutation (addChild / removeChild / swap) in the
   * boilerplate every such mutation needs:
   *
   *   1. detach resizers (handleIdx closures would otherwise go stale)
   *   2. refresh `availPx` — resizer track count is about to change, so
   *      the budget the mutator uses must reflect the post-mutation state
   *   3. run the caller's mutation — splice children/sizes, move DOM
   *   4. clear `c.max` — its `restore` array's indices no longer match
   *   5. reindex `indexInParent` for every child
   *   6. rebuild resizers fresh against the new children
   *   7. writeTracks with `animate: false` — track count can't animate
   *
   * Cross-parent mutations (`swap` between containers) call this once
   * per affected container; the helper is per-container by design.
   *
   * The renormalize step that used to live here (item 3 pre-refactor) is
   * gone: `c.sizes` is now stored in pct-of-pctBudget form, and the
   * "saturated layout sums to 100" invariant is maintained directly by
   * each mutator (`makeRoom` shrinks existing pct on insert,
   * `absorbVacancy` scales survivors back up to 100 on remove).
   */
  private mutateStructure(c: ContainerState, mutate?: () => void): void {
    this.detachResizers(c);
    mutate?.();
    c.max = null;
    this.reindexFrom(c, 0);
    this.rebuildResizers(c);
    this.writeTracks(c, { animate: false });
  }

  /** Recursively drop the byId entries for a removed subtree. */
  private removeSubtreeFromMap(s: NodeState): void {
    this.byId.delete(s.node.id);

    if (isContainerState(s)) {
      for (const child of s.node.children) {
        const childState = this.byId.get(child.id);

        if (childState) this.removeSubtreeFromMap(childState);
      }
    }
  }

  /**
   * After a panel is removed, scale remaining pct-sized siblings so they
   * cover the saturation target (sum-to-100 of pctBudgetPx). Px-sized
   * siblings stay anchored — only pct sizes rebalance.
   *
   * In the new storage frame the math is simpler than the old "% of
   * container" version: survivors get scaled by `100 / pctSurvivorSum`
   * regardless of what the removed panel's pct value was. The
   * `removedPct` parameter is kept on the signature so the call sites
   * still document the freed budget, but isn't used in the math itself.
   *
   * Edge case: when the removed panel was maximized, the surviving pct
   * siblings are all at 0%. Proportional scaling can't grow zeros, so we
   * fall back to "split 100 equally" — every surviving pct sibling gets
   * `100 / count`. The property test caught the fall-through path
   * leaving 988px of dead space on the old container-pct model.
   */
  private absorbVacancy(sizes: Length[], removedPct: number): void {
    if (removedPct <= 0) return;

    let pctSum = 0;
    let pctCount = 0;

    for (const sz of sizes) {
      if (sz.unit === 'pct') {
        pctSum += sz.value;
        pctCount += 1;
      }
    }

    if (pctCount === 0) return;

    if (pctSum <= 0) {
      const share = 100 / pctCount;

      for (let i = 0; i < sizes.length; i += 1) {
        if (sizes[i].unit === 'pct') sizes[i] = { unit: 'pct', value: share };
      }
      return;
    }

    const factor = 100 / pctSum;

    for (let i = 0; i < sizes.length; i += 1) {
      const sz = sizes[i];

      if (sz.unit === 'pct') sizes[i] = { unit: 'pct', value: sz.value * factor };
    }
  }

  /**
   * After a panel is inserted, shrink existing pct-sized siblings so the
   * new panel has room. Inverse of `absorbVacancy`.
   *
   * Why this is needed: once any layout op runs (`equalize`, `setSize`,
   * `maximize`), fr sizes get frozen into pct via `freezeFrTracks`. From
   * then on, the pct values sum to ~100% — leaving zero space for any
   * fresh `1fr` track the runtime is about to splice in. The new panel
   * would render at 0 (or negative) width, pushed outside the viewport.
   *
   * Resolution depends on the new panel's unit:
   *   - `px`: anchored size; existing pct siblings make room naturally
   *     via CSS (px subtracts from the avail before pct/fr expand).
   *     No JS rebalance needed.
   *   - `fr` (the `bounds.size === undefined` / `'auto'` case): convert
   *     the new track to pct, give it an equal share of the existing
   *     pct budget, and scale existing pct siblings down by `N/(N+1)`.
   *     Preserves the total pct sum so px/other-fr siblings see the
   *     same containerAxisPx allocation they had before.
   *   - `pct`: scale existing pct siblings so they + new fit ≤ 100%.
   */
  private makeRoom(c: ContainerState, newIdx: number): void {
    const { sizes } = c;
    const newSize = sizes[newIdx];

    if (newSize.unit === 'px') return;

    const pctIdxs: number[] = [];
    let pctSum = 0;

    for (const [i, size] of sizes.entries()) {
      if (i !== newIdx && size.unit === 'pct') {
        pctIdxs.push(i);
        pctSum += size.value;
      }
    }

    // No pct siblings — fr/pct new panel will be the only flex/pct track,
    // CSS resolves the rest naturally.
    if (pctIdxs.length === 0) return;

    // Each existing pct sibling has a min pct. The min is expressed
    // against containerAxisPx (matching CSS — what `bounds.min: '20%'`
    // means to the user), but `c.sizes` stores pct against pctBudgetPx
    // (the storage frame). Convert via budget so comparisons against
    // sibling pct values land in the same unit. Without this, scaling
    // would let CSS clamp the rendered track up to the min while the
    // stored pct stays below — rendered overflow by Σ (min - stored)
    // per violating sibling. Iterative pin-and-reshare (same shape as
    // `equalize`) keeps stored sizes at or above each min and absorbs
    // the shortage into the new panel's share.
    const totalAxisPx = this.containerAxisPx(c);
    const budgetPx = this.pctBudgetPx(c);
    const minPctByIdx = new Map<number, number>();

    for (const i of pctIdxs) {
      const minPx = boundsMinPx(c.node.children[i].bounds, totalAxisPx);

      minPctByIdx.set(i, budgetPx > 0 ? (minPx / budgetPx) * 100 : 0);
    }

    if (newSize.unit === 'fr') {
      // Target: each panel (existing + new) gets an even share of
      // `pctSum / (N+1)`. Walk and pin any sibling whose min exceeds
      // its share; re-share over the rest. Repeat until stable.
      const free = new Set<number>([...pctIdxs, newIdx]);
      const pinned = new Map<number, number>();
      let pool = pctSum;

      for (;;) {
        const share = free.size > 0 ? pool / free.size : 0;
        const toPin: number[] = [];

        for (const i of free) {
          // new panel has no min
          if (i !== newIdx) {
            const minPct = minPctByIdx.get(i) ?? 0;

            if (minPct > share) toPin.push(i);
          }
        }

        if (toPin.length === 0) {
          for (const i of free) pinned.set(i, share);
          break;
        }

        for (const i of toPin) {
          const minPct = minPctByIdx.get(i) ?? 0;

          pinned.set(i, minPct);
          pool -= minPct;
          free.delete(i);
        }
      }

      for (const i of pctIdxs) {
        sizes[i] = { unit: 'pct', value: pinned.get(i) ?? 0 };
      }

      sizes[newIdx] = { unit: 'pct', value: pinned.get(newIdx) ?? 0 };
      return;
    }

    // newSize.unit === 'pct'. If existing pct + new would exceed 100%,
    // scale existing down to make room.
    if (pctSum + newSize.value <= 100) return;

    const targetSum = Math.max(0, 100 - newSize.value);
    const factor = targetSum / pctSum;

    for (const i of pctIdxs) {
      sizes[i] = { unit: 'pct', value: sizes[i].value * factor };
    }
  }

  /**
   * Replace any `fr` sizes with their currently-resolved px-as-pct values,
   * without firing the transition. Run this before any programmatic write
   * that should animate: CSS Grid can't smoothly interpolate between an
   * `fr`-based track (e.g. `minmax(0, 1fr)`) and a `length-percentage`
   * track (e.g. `max(0px, 0%)`) — the function shapes are different and
   * the browser falls back to a discrete jump, which shows as a flash of
   * container background through the (briefly) mis-sized track.
   *
   * Drag doesn't need this — it sets [data-dragging], which suppresses the
   * transition entirely.
   */
  private freezeFrTracks(c: ContainerState): void {
    if (!c.sizes.some((sz) => sz.unit === 'fr')) return;

    // Freeze converts every track (fr AND pct — both can drift relative
    // to one another between writes) to its currently-resolved pct value
    // in storage form (% of pctBudgetPx). Mixing today's stored pcts
    // with newly-frozen pcts would mean two values with different
    // denominators in the same array, so we rewrite all of them.
    const budget = this.pctBudgetPx(c);
    const frozen: Length[] = c.node.children.map((_, i) => {
      const childEl = childElementAt(c.el, i);

      if (!childEl) return c.sizes[i];

      // px-sized tracks stay px-sized — only the flex (fr) and pct
      // tracks need to be normalized into the new storage frame.
      if (c.sizes[i].unit === 'px') return c.sizes[i];

      const px = measureAxis(childEl, c.node.direction);

      return { unit: 'pct' as const, value: pxToPct(px, budget) };
    });

    // `writeTracks({ animate: false })` owns the noAnimate dance (set
    // dataset, set --sp-tracks, force layout flush via offsetWidth, clear
    // dataset). Going through it here keeps the freeze write off the
    // transition without duplicating that dance — and keeps any future
    // tweak to the suppression mechanism (e.g. a different attribute) in
    // one place.
    c.sizes = frozen;
    this.writeTracks(c, { animate: false });
    this.log('freezeFrTracks', () => ({ containerId: c.node.id, frozen: frozen.map((l) => formatLengthForLog(l)) }));
  }

  /**
   * Maximize the panel `id` (leaf or container) in its parent. If the same id
   * is already maximized, restore. If a *different* sibling is currently
   * maximized, restore that one first so only one is ever maximized at a
   * time — which lets expandNext/expandPrev "move" the maximize state
   * cleanly through the container.
   *
   * Maximize size = `min(bounds.max, avail − Σ sibling mins)`; spare space
   * (when the target hits its own max) spreads across siblings.
   */
  toggleExpand(id: string, opts?: LayoutOptions): void {
    const s = this.byId.get(id);

    if (!s) {
      this.log('toggleExpand: not found', { id });
      return;
    }

    const p = s.parent;

    if (!p) {
      this.log('toggleExpand: target is the root', { id });
      return;
    }

    // Freeze fr → pct first; otherwise the eventual restore would animate
    // between mismatched track shapes and flash the container background.
    if (!this.prepareForLayoutOp(p)) return;

    // Restoring our own snapshot is just a regular swap-and-write.
    if (p.max?.id === id) {
      const restored = p.max.restore;

      this.log('toggleExpand: restoring snapshot', () => ({ id, restored: restored.map((l) => formatLengthForLog(l)) }));
      p.sizes = [...restored];
      p.max = null;
      this.writeTracks(p, opts);
      this.emit('toggle-expand', p, [id]);
      return;
    }

    // Someone else is maximized — restore them first so the new snapshot
    // we're about to take captures the natural state, not a stacked one.
    if (p.max) p.sizes = [...p.max.restore];

    p.max = { id, restore: [...p.sizes] };

    // Maximize: cap by max-allowed, distribute the rest across siblings.
    // bounds.max resolves against the FULL container (matching CSS); the
    // sibling-min sum likewise comes from container-resolved mins. The
    // remaining budget is content space (avail).
    const avail = p.availPx;
    const totalAxisPx = this.containerAxisPx(p);
    const targetIdx = s.indexInParent;
    const target = p.node.children[targetIdx];
    const targetMaxLen = target.bounds?.max;
    const targetMax = targetMaxLen == null
      ? Number.POSITIVE_INFINITY
      : toPx(parseLength(targetMaxLen), totalAxisPx);
    const siblingMinSum = this.sumSiblingMins(p, targetIdx);
    const targetSize = Math.min(targetMax, Math.max(0, avail - siblingMinSum));

    this.applyTargetSize(p, targetIdx, targetSize);
    this.writeTracks(p, opts);
    this.emit('toggle-expand', p, [id]);
    this.log('toggleExpand: maximized', () => ({
      id,
      containerId: p.node.id,
      targetMax: Number.isFinite(targetMax) ? targetMax : 'inf',
      targetSize,
      sizes: p.sizes.map((l) => formatLengthForLog(l)),
    }));
  }

  /**
   * Walk the maximize state forward through `containerId`'s children. If a
   * child is currently maximized, restore it and maximize its next sibling.
   * If nothing is maximized, maximize the first child. Returns the id that
   * ended up maximized, or `undefined` when there's nowhere to go (already
   * at the last child, or the target isn't a multi-child container).
   *
   * The caller doesn't have to track which panel is "selected" — the state
   * lives in the container's snapshot map and is read fresh on each call.
   */
  expandNext(containerId: string, opts?: LayoutOptions): string | undefined {
    return this.expandRelative(containerId, 1, opts);
  }

  /** Mirror of `expandNext`. Maximizes the last child when nothing is set. */
  expandPrev(containerId: string, opts?: LayoutOptions): string | undefined {
    return this.expandRelative(containerId, -1, opts);
  }

  private expandRelative(containerId: string, dir: 1 | -1, opts?: LayoutOptions): string | undefined {
    const c = this.byId.get(containerId);

    if (!c || !isContainerState(c) || c.node.children.length === 0) return undefined;

    const currentIdx = this.findMaximizedIndex(c);
    const fromIdx = currentIdx == null
      ? (dir > 0 ? 0 : c.node.children.length - 1)
      : currentIdx + dir;

    if (fromIdx < 0 || fromIdx >= c.node.children.length) return undefined;

    const target = c.node.children[fromIdx];

    this.toggleExpand(target.id, opts);
    return target.id;
  }

  /**
   * Index of the currently-maximized child in `c`, or `undefined` if none.
   * `c.max` encodes "who is maxed" as a single field; at most one
   * maximized child per container is therefore a structural invariant.
   */
  private findMaximizedIndex(c: ContainerState): number | undefined {
    if (!c.max) return undefined;

    const maxState = this.byId.get(c.max.id);

    return maxState?.indexInParent;
  }

  /** True iff `id` is the panel currently maximized inside its parent. */
  isMaximized(id: string): boolean {
    const s = this.byId.get(id);

    return s?.parent?.max?.id === id;
  }

  /**
   * Index of the currently-maximized child within `containerId`'s
   * children array, or `-1` when no child is maximized (or when
   * `containerId` isn't a container). Companion to `isMaximized` for
   * consumers building "expand prev / expand next" UI affordances —
   * they typically want the index, not the id.
   */
  getMaximizedIndex(containerId: string): number {
    const c = this.byId.get(containerId);

    if (!c || !isContainerState(c)) return -1;

    // Use the private O(1) helper — the maximized node's state already
    // carries indexInParent, no need to scan children.
    return this.findMaximizedIndex(c) ?? -1;
  }

  /**
   * True when `containerId`'s children currently share the same stored
   * `Length` (same unit AND value), OR when the container has fewer
   * than two children (no inequality is possible). Useful for "is
   * equalize a no-op?" UI affordances. Returns `false` for leaves or
   * unknown ids.
   */
  areChildrenEqual(containerId: string): boolean {
    const c = this.byId.get(containerId);

    if (!c || !isContainerState(c)) return false;

    if (c.sizes.length < 2) return true;

    const first = c.sizes[0];

    return c.sizes.every((sz) => sz?.value === first?.value && sz?.unit === first?.unit);
  }

  /**
   * True iff the panel's currently rendered size matches what it was
   * defined with at mount time. Compares physical pixels (defined-size
   * resolved against containerAxisPx vs. measured rect), so the check
   * is unit-agnostic — `bounds.size: '25%'` versus a stored `25%` of
   * pctBudgetPx still answers "yes" once both round-trip to the same
   * rendered px. Useful for "has the user touched this?" UX
   * questions; pairs naturally with `reset()` for undo affordances.
   */
  isAtDefault(id: string): boolean {
    const s = this.byId.get(id);

    if (!s || !s.parent) return false;

    const definedRaw = s.node.bounds?.size;
    const current = s.parent.sizes[s.indexInParent];

    // No defined size — treat as "at default" only when the stored
    // size is still fr (matches what reset would assign). Avoids
    // spurious "touched" reports on fr panels.
    if (definedRaw == null) return current.unit === 'fr';

    // Compare physical px (not pct values directly) — the defined
    // size is user-input form (pct meaning "% of container") while
    // the stored size is storage form (pct meaning "% of
    // pctBudgetPx"). Resolving both to px lets the units cancel and
    // a `bounds.size: '25%'` matches a stored 25.30% value when
    // both round-trip to the same rendered px.
    const totalAxisPx = this.containerAxisPx(s.parent);
    const budget = this.pctBudgetPx(s.parent);
    const definedPx = toPx(parseLength(definedRaw), totalAxisPx);
    let currentPx: number;

    if (current.unit === 'px') currentPx = current.value;
    else if (current.unit === 'pct') currentPx = (current.value / 100) * budget;
    // fr stored against a concrete defined size means the panel is on
    // its 1fr fallback rather than the user's intent — not at default.
    else return false;

    return Math.abs(definedPx - currentPx) < 0.5;
  }

  /**
   * Make every child of `containerId` an equal share of the available space,
   * respecting per-child mins. Animates. No-op for non-containers or
   * containers with fewer than 2 children.
   *
   * Algorithm: aim for `avail / N` per panel. If a panel's min exceeds
   * that share, pin it at the min and recompute the share over the
   * remaining panels with reduced avail. Repeat until the share covers
   * every still-free panel's min — then split the remainder equally.
   *
   * In the common case (no panel has a min larger than its even share),
   * every panel ends up at exactly `avail / N`. That's the property
   * users mean when they say "equalize": same size, full stop.
   *
   * The previous implementation did `min + (avail − Σmin) / N`, which
   * gave panels with bigger mins bigger TOTALS — visibly unequal when
   * only some panels had mins.
   */
  equalize(containerId: string, opts?: LayoutOptions): void {
    const c = this.byId.get(containerId);

    if (!c || !isContainerState(c) || c.node.children.length < 2) return;

    if (!this.prepareForLayoutOp(c)) return;

    const avail = c.availPx;
    const containerAxisPx = this.containerAxisPx(c);
    const mins = c.node.children.map((child) => boundsMinPx(child.bounds, containerAxisPx));
    // Equal share across all children; pin mins, ignore maxes (current
    // behavior — see distribute.spec.ts for the helper's contract).
    // Equal weights → degenerates to `availLeft / free.size` per pass.
    const weights = c.node.children.map(() => 1);
    const maxes = c.node.children.map(() => Number.POSITIVE_INFINITY);
    const sizesPx = distributeProportional(avail, weights, mins, maxes);

    // Storage convention: pct of pctBudgetPx (not container).
    //
    //  - All-pct: each child stores exactly `100/N` pct — sum to 100.
    //    Matches what users mean by "equalize" when they inspect c.sizes.
    //  - Mixed: pct entries get `(100 - px share) / pctCount` each; the
    //    pct portion still sums to (100 - sum-of-px-pct-equivalent).
    //  - All-px: every entry stores `avail/N` px. The sum-to-100 pct
    //    invariant is vacuous here (no pct entries to enforce); the
    //    CSS-rendered widths are still equal at `availPx/N`.
    //
    // Px siblings keep their unit (see `sizesFromPx` docs for the bug
    // class this defends against). The CSS pct emitted at writeTracks
    // scales pct entries back down by budget/container so the rendered
    // width is still `availPx/N` per panel regardless of mix.
    const units: StorageUnit[] = c.sizes.map(
      (sz) => (sz.unit === 'px' ? 'px' : 'pct'),
    );

    c.sizes = sizesFromPx(sizesPx, units, avail);
    c.max = null;
    this.writeTracks(c, opts);
    this.emit('equalize', c);
    this.log('equalize', () => ({ containerId, sizes: c.sizes.map((l) => formatLengthForLog(l)) }));
  }

  /**
   * Restore every child of `containerId` to the `bounds.size` it was defined
   * with. Children with no defined size fall back to `auto` (1fr). Animates.
   */
  reset(containerId: string, opts?: LayoutOptions): void {
    const c = this.byId.get(containerId);

    if (!c || !isContainerState(c)) return;

    this.freezeFrTracks(c);
    // `bounds.size` is user-input form (pct = "% of container"); fold each
    // into storage form (pct = "% of pctBudgetPx") so c.sizes stays in
    // the storage frame the rest of the runtime expects.
    c.sizes = c.node.children.map(
      (child) => this.toStorageForm(parseLength(child.bounds?.size), c),
    );
    c.max = null;
    this.writeTracks(c, opts);
    this.emit('reset', c);
    this.log('reset', () => ({ containerId, sizes: c.sizes.map((l) => formatLengthForLog(l)) }));
  }

  /**
   * Read the current resolved size for `id` (or `undefined` if not found).
   * `px` is the rendered width/height; `pct` is the same value as a fraction
   * of the parent container's axis. Useful for state persistence.
   */
  getSize(id: string): PanelSizeReport | undefined {
    const s = this.byId.get(id);

    if (!s || !s.parent) return undefined;

    const px = measureAxis(s.el, s.parent.node.direction);
    const parentAxis = this.containerAxisPx(s.parent);

    return { px, pct: parentAxis > 0 ? (px / parentAxis) * 100 : 0 };
  }

  /**
   * Serialize the live tree back to a plain `Container<T>` — useful for
   * persisting user-customized layouts. Returns a deep clone, so mutating
   * the result is safe.
   *
   * Options:
   *  - `withCurrentSizes` (default `true`) bakes the on-screen pixel size
   *    of each child into `bounds.size`, so reconstructing from the result
   *    reproduces what the user is currently looking at. Pass `false` to
   *    keep the original definition's `size` (useful when persisting
   *    structure-only and resizing at runtime from elsewhere).
   *  - `includeData` (default `true`) carries each leaf's `data` payload
   *    through. Pass `false` to drop it — handy when `data` is large or
   *    not serializable.
   *
   * Returns `undefined` before mount (no measurable sizes yet).
   */
  getRawDefinition(
    opts: { withCurrentSizes?: boolean, includeData?: boolean } = {},
  ): Container<T> | undefined {
    if (!this.rootEl) return undefined;

    const withCurrentSizes = opts.withCurrentSizes !== false;
    const includeData = opts.includeData !== false;

    const cloneBounds = (b: Bounds | undefined): Bounds | undefined => (b ? { ...b } : undefined);

    // Current size in px for the child at `indexInParent` of `parent`.
    // We measure off the DOM so we capture what the user actually sees,
    // including the result of CSS clamp/minmax resolving min/max bounds.
    const measuredSize = (parent: ContainerState, indexInParent: number): LengthInput | undefined => {
      const childEl = childElementAt(parent.el, indexInParent);

      if (!childEl) return undefined;

      // Round to integer px — sub-pixel jitter from getBoundingClientRect
      // would otherwise show up as `199.99999996px` in the serialized form.
      return `${Math.round(measureAxis(childEl, parent.node.direction))}px` as LengthInput;
    };

    const walk = (id: string): Node<T> => {
      const state = this.byId.get(id);

      if (!state) throw new Error(`getRawDefinition: node ${id} not found`);

      if (isContainerState(state)) {
        const node = state.node as Container<T>;
        const out: Container<T> = {
          id: node.id,
          direction: node.direction,
          children: node.children.map((c) => walk(c.id)),
          bounds: cloneBounds(node.bounds),
          resizer: node.resizer ? { ...node.resizer } : undefined,
        };

        if (withCurrentSizes && state.parent) {
          const size = measuredSize(state.parent, state.indexInParent);

          if (size !== undefined) out.bounds = out.bounds ? { ...out.bounds, size } : { size };
        }
        return out;
      }

      const leaf = state.node as Leaf<T>;
      const out: Leaf<T> = {
        id: leaf.id,
        bounds: cloneBounds(leaf.bounds),
      };

      if (includeData && leaf.data !== undefined) out.data = leaf.data;

      if (withCurrentSizes) {
        const size = measuredSize(state.parent, state.indexInParent);

        if (size !== undefined) out.bounds = out.bounds ? { ...out.bounds, size } : { size };
      }
      return out;
    };

    return walk(this.rootEl.node.id) as Container<T>;
  }

  // ---- shared rebalance ------------------------------------------------

  /**
   * Set the child at `targetIdx` to `targetPx` and proportionally rescale
   * siblings into `avail − targetPx`, with each sibling clamped to its own
   * `[min, max]`. The target itself gets clamped on BOTH ends by what its
   * siblings can structurally absorb:
   *
   *   - upper: `avail − Σ siblingMin`. Can't grow so much that siblings
   *     would dip below their mins.
   *   - lower: `avail − Σ siblingMax`. Can't shrink so much that siblings
   *     would have to grow past their maxes — the target absorbs the
   *     spillover so the layout still fills the container. This is what
   *     keeps a `setSize(target, '0%')` from inflating a max-capped
   *     sibling past its max.
   *
   * If both clamps point opposite ways (e.g. impossible bounds), the
   * upper bound wins — siblings shrinking to their mins is the safer
   * direction than violating their maxes.
   *
   * Shared body of setSize and toggleExpand.
   */
  private applyTargetSize(parent: ContainerState, targetIdx: number, targetPx: number): void {
    const avail = parent.availPx;

    // Pre-measure paths (detached host, display:none, called before the
    // first rAF) leave availPx = 0. Without this guard, every weight is
    // zero, distributeProportional returns zeros, sizesFromPx stores
    // [0%, 0%, …] and writeTracks paints a collapsed grid. The op
    // can't produce a meaningful result before geometry exists — bail
    // and leave c.sizes intact for the next live measurement.
    if (avail <= 0) return;

    const containerAxisPx = this.containerAxisPx(parent);
    const currentPx = measureChildrenPx(parent.el, parent.node.direction, parent.node.children.length, childElementAt,);
    // Mins/maxes resolve against containerAxisPx (matching CSS), NOT
    // availPx — otherwise the JS-computed floor/ceiling disagrees with
    // what CSS displays and siblings absorb the difference into overflow.
    const minPx = parent.node.children.map((child) => boundsMinPx(child.bounds, containerAxisPx));
    const maxPx = parent.node.children.map((child) => boundsMaxPx(child.bounds, containerAxisPx));
    const targetUpper = Math.max(0, avail - sumExceptAt(minPx, targetIdx));
    const targetLower = Math.max(0, avail - sumExceptAt(maxPx, targetIdx));
    const cappedTarget = Math.max(targetLower, Math.min(targetPx, targetUpper));

    // Pin the target to `cappedTarget` via tight bounds + zero weight;
    // `distributeProportional` snaps it on the first pass and water-fills
    // the remaining `avail − cappedTarget` across the siblings against
    // their own min/max bounds. Sibling weights come from current rendered
    // sizes so dragging the divider preserves their relative ratios.
    const weights = currentPx.map((w, i) => (i === targetIdx ? 0 : w));
    const pinnedMins = minPx.map((m, i) => (i === targetIdx ? cappedTarget : m));
    const pinnedMaxs = maxPx.map((m, i) => (i === targetIdx ? cappedTarget : m));
    const newSizesPx = distributeProportional(avail, weights, pinnedMins, pinnedMaxs);

    // Storage convention: c.sizes pct values are "% of pctBudgetPx", not
    // "% of containerAxisPx" — so a saturated layout sums to exactly 100.
    // The conversion to CSS-native % happens at writeTracks time.
    //
    // Siblings preserve their unit (px stays px, even when it has to
    // shrink to make room for the target); the target itself always
    // becomes pct so the saturation invariant holds. `sizesFromPx`
    // computes the pct budget AFTER the unit decision — see its docs
    // for the bug class this defends against.
    const units: StorageUnit[] = parent.node.children.map((_, i) => {
      if (i === targetIdx) return 'pct';
      return parent.sizes[i].unit === 'px' ? 'px' : 'pct';
    });

    parent.sizes = sizesFromPx(newSizesPx, units, avail);
  }

  private sumSiblingMins(parent: ContainerState, exceptIdx: number): number {
    const axis = this.containerAxisPx(parent);
    const mins = parent.node.children.map((c) => boundsMinPx(c.bounds, axis));

    return sumExceptAt(mins, exceptIdx);
  }

  /**
   * Reads the container's full axis size (width for row, height for
   * column). Branded as `ContainerAxisPx` so it can be passed to `toPx`
   * / `pxToPct` / `clampToBounds` — the brand catches a careless caller
   * who'd otherwise hand in `availPx` (which is the content-area
   * budget, not the CSS-resolution denominator).
   */
  private containerAxisPx(c: ContainerState): ContainerAxisPx {
    return asContainerAxis(measureAxis(c.el, c.node.direction));
  }

  /**
   * The pixel budget that backs `c.sizes` pct values.
   *
   * `c.sizes[i].value` of unit `pct` means "% of `pctBudgetPx(c)`" — NOT
   * "% of the container axis." That's the storage convention every
   * write path uses (`applyTargetSize`, `equalize`, `freezeFrTracks`,
   * `pointerDrag.onMove`), and what `writeTracks` scales out of when
   * it emits the CSS pct value.
   *
   * Budget = `availPx − Σpx_tracks(c.sizes)`. The "minus px tracks" part
   * is the bit that distinguishes this from raw `availPx`: a pct sibling
   * mixed with a px sibling should share the *remaining* content space,
   * not the whole content space. Subtracting fixed px sizes here keeps
   * the saturation invariant ("pct sizes sum to 100") well-defined
   * regardless of mixed units.
   *
   * `fr` is special-cased to fill the remainder via CSS — it doesn't get
   * subtracted from the budget. In practice, every internal write path
   * runs `freezeFrTracks` first, so by the time storage math runs, fr
   * has been folded into pct.
   */
  private pctBudgetPx(c: ContainerState): PctBudgetPx {
    // Recompute avail inline rather than reading the c.availPx cache.
    // Structural mutators detach + re-add resizer DOM around c.sizes
    // changes, and we want the budget that matches the post-mutation
    // sizes — even if the ResizeObserver hasn't fired since.
    // `resizerTracksPx` reads c.node.children.length, so it's already
    // self-consistent with whatever the caller's mutation produced.
    const total = this.containerAxisPx(c);
    const avail = Math.max(0, total - this.resizerTracksPx(c, total));
    let pxSum = 0;

    for (const sz of c.sizes) {
      if (sz.unit === 'px') pxSum += sz.value;
    }

    return asPctBudget(Math.max(0, avail - pxSum));
  }

  /**
   * Convert `c.sizes` from storage form (avail-pct of `pctBudgetPx`) to CSS
   * form (container-pct of `containerAxisPx`) so the value handed to CSS
   * resolves back to the same physical px. The conversion factor is
   * `budget / container`; px and fr lengths pass through unchanged.
   *
   * This is the single boundary where stored values pivot to CSS-native
   * semantics — every other site reads/writes pct in storage form.
   *
   * Pre-measure (container <= 0): pass through verbatim. At construction
   * time `c.sizes` is still the user's original pct values (container-pct
   * semantics, since they came from `parseLength`); those resolve correctly
   * against CSS as-is. `normalizeInitialSizes` runs after first measure
   * to fold them into storage form, after which the factor applies.
   */
  private sizesForCss(c: ContainerState): Length[] {
    const container = this.containerAxisPx(c);
    const budget = this.pctBudgetPx(c);

    if (container <= 0 || budget <= 0) return c.sizes;

    const factor = budget / container;

    return c.sizes.map((sz) => (sz.unit === 'pct'
      ? { unit: 'pct' as const, value: sz.value * factor }
      : sz));
  }

  /**
   * Convert a parsed `Length` from user-input form (pct meaning "% of
   * container") to storage form (pct meaning "% of pctBudgetPx"). Px and
   * fr pass through; pct gets the `container / budget` scale.
   *
   * Returns the input verbatim when geometry isn't available yet — that
   * case only matters at initial mount, and `normalizeInitialSizes`
   * sweeps everything to storage form once the first measure has run.
   */
  private toStorageForm(l: Length, c: ContainerState): Length {
    if (l.unit !== 'pct') return l;

    const container = this.containerAxisPx(c);
    const budget = this.pctBudgetPx(c);

    if (container <= 0 || budget <= 0) return l;

    return { unit: 'pct', value: l.value * (container / budget) };
  }

  /**
   * One-time fold of user-input pct values (left in `c.sizes` by
   * `buildContainer` before geometry was available) into storage form.
   * Recurses into nested containers. Called from `mount` after the
   * synchronous initial `measureAll` — by then every container has a
   * non-zero `availPx` and the factor is well-defined.
   *
   * After this pass, `c.sizes` everywhere is in storage form and the
   * "stored pct sums to 100 when saturated" invariant holds. Subsequent
   * mutators (`setSize`, `equalize`, `addChild`, …) maintain it.
   */
  private normalizeInitialSizes(c: ContainerState): void {
    const container = this.containerAxisPx(c);
    const budget = this.pctBudgetPx(c);

    if (container > 0 && budget > 0) {
      const factor = container / budget;

      c.sizes = c.sizes.map((sz) => (sz.unit === 'pct'
        ? { unit: 'pct' as const, value: sz.value * factor }
        : sz));
    }

    for (const child of c.node.children) {
      const s = this.byId.get(child.id);

      if (s && isContainerState(s)) this.normalizeInitialSizes(s);
    }
  }

  /**
   * Total px consumed by every resizer track in `c` at the given axis size.
   * Match what `trackString` actually emits, or downstream pixel math drifts:
   *   - (children.length - 1) inner dividers between siblings
   *   - +1 for an optional leading decorative track (`resizer.first`)
   *   - +1 for an optional trailing decorative track (`resizer.last`)
   * Honors the same fallback chain as `rebuildResizers`/`buildContainer`:
   * the node's own `resizer` overrides; otherwise inherit `cfg.resizer`.
   */
  private resizerTracksPx(c: ContainerState, axisPx: ContainerAxisPx): number {
    const spec = this.getResizerSpec(c);
    const resizerPx = parseLengthToPxAxis(spec?.size ?? 6, axisPx);
    const numChildren = c.node.children.length;
    const innerCount = Math.max(0, numChildren - 1);
    const edgeCount = (spec?.first && numChildren > 0 ? 1 : 0)
      + (spec?.last && numChildren > 0 ? 1 : 0);

    return resizerPx * (innerCount + edgeCount);
  }

  /**
   * Synchronously refresh `c.availPx` from a live measurement. The ResizeObserver
   * keeps it up to date asynchronously via `scheduleMeasure`, but any layout
   * method called before the first rAF fires (tests, or right after mount)
   * would otherwise see `availPx === 0` and produce degenerate math. This is
   * the lazy fallback: O(1) reads, cheap enough to run on every public call.
   */
  private refreshAvail(c: ContainerState): void {
    const total = this.containerAxisPx(c);

    c.availPx = Math.max(0, total - this.resizerTracksPx(c, total));
  }

  /**
   * Entry barrier for every container-mutating layout op (setSize,
   * toggleExpand, equalize). Two cheap stabilization steps:
   *
   *  1. `refreshAvail` — pull a fresh `availPx` measurement so the math
   *     uses the current rect, not a possibly-stale ResizeObserver value.
   *  2. `freezeFrTracks` — concretize any fr tracks into stored pct so
   *     mutations work in a stable storage frame.
   *
   * Always run together, always at the top of the op. Pulling this out
   * keeps the layout methods focused on their distinct logic and prevents
   * "forgot to call freezeFrTracks first" regressions.
   *
   * Returns `false` when geometry isn't usable (detached host, pre-measure,
   * display:none parent — anything that lands `availPx` at 0). Callers
   * should bail without mutating; running the layout math on a zero
   * budget stores [0%, 0%, …] and paints a collapsed grid. The freeze
   * step also needs a non-zero budget — `pxToPct(px, 0)` returns
   * garbage — so we short-circuit before either side runs.
   */
  private prepareForLayoutOp(c: ContainerState): boolean {
    this.refreshAvail(c);

    if (c.availPx <= 0) return false;

    this.freezeFrTracks(c);
    return true;
  }

  /**
   * `data` may be a thunk to defer expensive payload construction (Array.map,
   * getBoundingClientRect, etc.) until we know we're actually going to log.
   * When debug is off — the common case in production — the thunk is never
   * called and callers pay only the function-allocation cost.
   */
  private log(label: string, data?: LogPayload | (() => LogPayload)): void {
    if (!this.cfg.debug) return;

    const resolved = typeof data === 'function' ? data() : data;

    // eslint-disable-next-line no-console
    console.log(`[SplitGrid] ${label}`, resolved ?? '');
  }

  /**
   * Register a listener for layout-change events. Returns an unsubscribe
   * function. Multiple subscribers are supported; they fire alongside
   * `cfg.onChange` (which is a single-callback shortcut for the same
   * delivery path). A throwing subscriber doesn't block the rest.
   */
  subscribe(listener: LayoutListener): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  /**
   * Returns a Promise that resolves when the relevant container's layout
   * transition finishes (or immediately if there is nothing to wait for).
   *
   *  - No `containerId`: wait for every container in the tree to settle.
   *  - A leaf id, an unknown id, or a call before mount: resolves
   *    immediately. Leaves don't have their own transition; they're tracks
   *    inside a parent container.
   *
   * Backed by the standard `transitionend` event on the container element
   * (`grid-template-columns` / `grid-template-rows`). Because `transitionend`
   * is not guaranteed to fire (e.g. when `animate: false` was used or the
   * value didn't actually change), every wait is also guarded by a timeout
   * — `opts.timeout` (default: `animationMs + 100`).
   */
  async settle(
    containerId?: string,
    opts: { timeout?: number } = {},
  ): Promise<void> {
    if (!this.rootEl) return;

    const containers: ContainerState[] = [];

    if (containerId === undefined) {
      const walk = (c: ContainerState) => {
        containers.push(c);

        for (const child of c.node.children) {
          const childState = this.byId.get(child.id);

          if (childState && isContainerState(childState)) walk(childState);
        }
      };

      walk(this.rootEl);
    } else {
      const s = this.byId.get(containerId);

      // Unknown id or leaf — nothing to settle.
      if (!s || !isContainerState(s)) return;

      containers.push(s);
    }

    const timeout = opts.timeout ?? (this.cfg.animationMs ?? 750) + 100;

    await Promise.all(containers.map((c) => waitForContainerTransition(c.el, timeout)));
  }

  /**
   * Notify the consumer that `container`'s layout changed. The sizes array
   * is cloned so callers can hold on to it without seeing later mutations.
   * `nodeIds` lists the nodes directly affected by this change — empty
   * means "every child of `containerId` was touched" (drag, equalize,
   * reset, set-direction).
   *
   * Pass a two-element tuple of containers (cross-parent swap) to fire a
   * single composed event covering both containers; `containerId` and
   * `sizes` on the event become tuples in the same positional order.
   */
  private emit(
    reason: LayoutChangeReason,
    container: ContainerState | readonly [ContainerState, ContainerState],
    nodeIds: string[] = [],
  ): void {
    const event: LayoutChangeEvent = Array.isArray(container)
      ? {
          containerId: [container[0].node.id, container[1].node.id],
          reason,
          sizes: [[...container[0].sizes], [...container[1].sizes]],
          nodeIds,
        }
      : {
          containerId: (container as ContainerState).node.id,
          reason,
          sizes: [...(container as ContainerState).sizes],
          nodeIds,
        };

    // Both delivery paths get the same try/catch: a misbehaving
    // consumer on one path shouldn't break the other (or block
    // subsequent subscribers in the loop below). The cfg.onChange
    // path used to run unwrapped, so a thrown error there aborted
    // the rest of the emit before subscribers ran.
    if (this.cfg.onChange) {
      try {
        this.cfg.onChange(event);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[SplitGrid] cfg.onChange threw:', error);
      }
    }

    for (const sub of this.subscribers) {
      try {
        sub(event);
      } catch (error) {
        // Surface the error without aborting subsequent subscribers — one
        // misbehaving consumer shouldn't break the rest of the chain.
        // eslint-disable-next-line no-console
        console.error('[SplitGrid] subscriber threw:', error);
      }
    }
  }

  // ---------------------------------------------------------------- construction

  private buildContainer(node: Container, parent: ContainerState | undefined = undefined, indexInParent = 0): ContainerState {
    const el = document.createElement('div');

    el.className = 'sp-container';
    el.dataset.direction = node.direction;
    el.dataset.id = node.id;

    const state: ContainerState = {
      node,
      el,
      sizes: node.children.map((c) => parseLength(c.bounds?.size)),
      max: null,
      availPx: 0,
      parent,
      indexInParent,
    };

    this.byId.set(node.id, state);

    const resizerSpec = this.getResizerSpec(state);

    if (resizerSpec?.first && node.children.length > 0) {
      el.append(this.buildResizer(state, -1, resizerSpec));
    }

    for (const [i, child] of node.children.entries()) {
      if (i > 0) el.append(this.buildResizer(state, i, resizerSpec));

      const childEl = isContainer(child)
        ? this.buildContainer(child, state, i).el
        : this.buildLeaf(child, state, i).el;

      el.append(childEl);
    }

    if (resizerSpec?.last && node.children.length > 0) {
      el.append(this.buildResizer(state, node.children.length, resizerSpec));
    }

    this.writeTracks(state);
    return state;
  }

  private buildLeaf(node: Leaf, parent: ContainerState, indexInParent: number): LeafState {
    const el = document.createElement('div');

    el.className = 'sp-panel';
    el.dataset.id = node.id;

    const state: LeafState = {
      node, el, parent, indexInParent,
    };

    this.byId.set(node.id, state);

    this.cfg.renderLeaf?.({
      id: node.id, data: node.data as T | undefined, el, leaf: node as Leaf<T>,
    });
    return state;
  }

  private buildResizer(parent: ContainerState, handleIdx: number, spec: ResizerSpec | undefined): HTMLElement {
    // Browsers don't fire a `tripleclick` event, but `MouseEvent.detail`
    // counts successive clicks within the platform's repeat window. We
    // gate the toggle-maximize action behind a short timer so a follow-up
    // third click can promote the gesture to equalize before the maximize
    // fires. Tax: every plain dblclick feels ~250ms slower than instant.
    const TRIPLE_CLICK_GRACE_MS = 250;
    const el = document.createElement('div');
    const numChildren = parent.node.children.length;
    // -1 = leading decorative track (before first child).
    // numChildren = trailing decorative track (after last child).
    // 1..(numChildren-1) = inner draggable divider.
    const isLeading = handleIdx === -1;
    const isTrailing = handleIdx === numChildren;
    const isDecorative = isLeading || isTrailing;

    el.className = isDecorative ? 'sp-resizer sp-resizer--edge' : 'sp-resizer';
    el.dataset.handle = String(handleIdx);

    if (isLeading) el.dataset.edge = 'leading';

    if (isTrailing) el.dataset.edge = 'trailing';

    el.setAttribute('role', 'separator');
    el.setAttribute('aria-orientation', parent.node.direction === PanelDirection.Row ? 'vertical' : 'horizontal');

    // For an inner divider at handleIdx i: before=children[i-1], after=children[i].
    // For the leading edge (handleIdx -1): no panel before; the panel
    // immediately AFTER it is children[0] — consumers reading
    // `resizer.after` to label the first panel rely on this. For the
    // trailing edge (handleIdx numChildren): the last panel is BEFORE it,
    // nothing after. The naive `children[handleIdx]` lookup fails the
    // leading case because `children[-1] === undefined`.
    const before = isLeading ? undefined : parent.node.children[handleIdx - 1];
    const after = isLeading
      ? parent.node.children[0]
      : (isTrailing ? undefined : parent.node.children[handleIdx]);

    spec?.render?.(el, { index: handleIdx, before, after });

    // Decorative tracks (leading / trailing): no drag — there's no panel on
    // the "outside" to push around — but they DO accept the same dblclick
    // / triple-click gestures as inner dividers, targeting the adjacent
    // panel. Leading edge targets children[0]; trailing edge targets the
    // last child.
    //   dblclick       → toggleMaximize on adjacent
    //   triple-click   → equalize parent
    if (isDecorative) {
      const targetIdx = isLeading ? 0 : numChildren - 1;
      const targetId = parent.node.children[targetIdx]?.id;

      if (targetId) {
        let pendingToggle: ReturnType<typeof setTimeout> | null = null;

        el.addEventListener('click', (e) => {
          if (e.detail === 2) {
            if (pendingToggle) clearTimeout(pendingToggle);

            pendingToggle = setTimeout(() => {
              pendingToggle = null;
              this.toggleMaximize(targetId);
            }, TRIPLE_CLICK_GRACE_MS);
          } else if (e.detail >= 3) {
            if (pendingToggle) {
              clearTimeout(pendingToggle);
              pendingToggle = null;
            }

            this.equalize(parent.node.id);
          }
        });
      }
      return el;
    }

    // Purely a visual affordance — the handle is positioned absolutely in
    // the center of the resizer track, grows on hover, and styles via
    // `--sp-indicator-*` CSS variables. The click listeners live on the
    // parent resizer (NOT on the handle) so they fire regardless of
    // whether the cursor was on the visible bar or the surrounding pixels.
    // Consumer-customized resizers (with teleported slot content) hide
    // this handle via CSS.
    const handle = document.createElement('div');

    handle.className = 'sp-resizer-handle';
    el.append(handle);

    // Click-count gestures: dblclick toggles maximize on the panel closer
    // to the layout edge; triple-click escalates to equalize the whole
    // container. The triple-click path cancels the pending dblclick so
    // only one action fires per gesture.
    let pendingToggle: ReturnType<typeof setTimeout> | null = null;

    el.addEventListener('click', (e) => {
      if (e.detail === 2) {
        if (pendingToggle) clearTimeout(pendingToggle);

        pendingToggle = setTimeout(() => {
          pendingToggle = null;

          const beforeIdx = handleIdx - 1;
          const afterIdx = handleIdx;
          const beforeDist = Math.min(beforeIdx, numChildren - 1 - beforeIdx);
          const afterDist = Math.min(afterIdx, numChildren - 1 - afterIdx);
          const targetIdx = afterDist < beforeDist ? afterIdx : beforeIdx;
          const targetId = parent.node.children[targetIdx].id;

          this.toggleMaximize(targetId);
        }, TRIPLE_CLICK_GRACE_MS);
      } else if (e.detail >= 3) {
        if (pendingToggle) {
          clearTimeout(pendingToggle);
          pendingToggle = null;
        }

        this.equalize(parent.node.id);
      }
    });

    this.attachDrag(el, parent, handleIdx);
    return el;
  }

  // ---------------------------------------------------------------- drag

  /**
   * Wire `el` up to drag-resize its container via `PointerDragState`. The
   * state machine owns the pointer-event lifecycle (down → move → end);
   * the adapter callbacks below glue it back to the grid's writeTracks,
   * emit, and diagnostic-log paths. The instance is stored in
   * `dragStates` so `detachResizers` can dispose it — without that, a
   * structural mutation mid-drag would orphan the global pointermove
   * listener.
   */
  private attachDrag(el: HTMLElement, parent: ContainerState, handleIdx: number): void {
    const state = new PointerDragState(el, parent, handleIdx, {
      resizerTracksPx: (target, axisPx) => this.resizerTracksPx(target as ContainerState, axisPx),
      childElementAt: (containerEl, index) => childElementAt(containerEl, index),
      onDragApply: (target) => {
        const c = target as ContainerState;

        this.writeTracks(c);
        this.emit('drag', c);
      },
      log: (label, data) => this.log(label, data as Parameters<SplitGrid['log']>[1]),
    });

    this.dragStates.set(el, state);
  }

  // ---------------------------------------------------------------- measure / write

  private scheduleMeasure(): void {
    if (this.rafScheduled) return;

    this.rafScheduled = true;
    this.rafHandle = requestAnimationFrame(() => {
      this.rafScheduled = false;
      this.rafHandle = null;

      if (!this.rootEl) return;

      this.measureAll(this.rootEl);
      // Stored pct values are "% of pctBudgetPx" — `sizesForCss` scales
      // them to "% of containerAxisPx" at write time. That scale factor
      // depends on the current container size, so a container resize
      // invalidates whatever pct string was last written. Re-emit
      // tracks (animate: false — the user IS the input, we just keep
      // CSS in lockstep) so panels with px-sized siblings or resizer
      // tracks still fit the new bounds.
      this.writeAllTracks(this.rootEl);
    });
  }

  private measureAll(c: ContainerState): void {
    const totalAxisPx = asContainerAxis(measureAxis(c.el, c.node.direction));

    c.availPx = Math.max(0, totalAxisPx - this.resizerTracksPx(c, totalAxisPx));

    // Concretize any fr sizes so nested containers can also drag correctly.
    // (Only the first measure does meaningful work; subsequent rect changes
    // just update availPx for the next drag start.)
    for (const child of c.node.children) {
      const s = this.byId.get(child.id);

      if (s && isContainerState(s)) this.measureAll(s);
    }
  }

  private writeTracks(c: ContainerState, opts?: LayoutOptions): void {
    // Stored sizes are in "% of pctBudgetPx" form; CSS wants "% of
    // containerAxisPx". `sizesForCss` does the one-way conversion at
    // this single emit boundary — keep that asymmetry here and don't
    // leak it back into storage by writing the scaled values to c.sizes.
    const tracks = trackString(c.node, this.sizesForCss(c), this.getResizerSpec(c));
    const skip = opts?.animate === false;

    // Suppress the transition for this single write by setting the same
    // attribute freezeFrTracks uses — the CSS rule short-circuits the
    // transition. Forcing a layout flush before removing the attribute
    // commits the new tracks in the no-animate state.
    if (skip) c.el.dataset.noAnimate = '';

    c.el.style.setProperty('--sp-tracks', tracks);

    if (skip) {
      // Reading offsetWidth forces a synchronous layout flush: the browser
      // has to compute styles *now* to return the value. That commits the
      // track write with data-no-animate still set, so the transition is
      // suppressed. Without this, all three mutations (set attr, write
      // tracks, remove attr) batch into a single recalc with the attribute
      // gone — and the transition runs anyway. The void-expression form
      // looks like dead code to lint, hence the disable.
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      c.el.offsetWidth;
      delete c.el.dataset.noAnimate;
    }

    if (this.cfg.debug) {
      // Schedule one rAF so the browser has applied the new tracks before we
      // read back the resolved widths — that's the value that matters for
      // diagnosing "panel ended up at the wrong size".
      requestAnimationFrame(() => {
        const childRects = c.node.children.map((child, i) => {
          const childEl = childElementAt(c.el, i);

          return { id: child.id, px: childEl ? measureAxis(childEl, c.node.direction) : -1 };
        });

        this.log('writeTracks', () => ({
          containerId: c.node.id,
          direction: c.node.direction,
          containerAxisPx: measureAxis(c.el, c.node.direction),
          tracks,
          sizes: c.sizes.map((l) => formatLengthForLog(l)),
          resolved: childRects,
        }));
      });
    }
  }
}
