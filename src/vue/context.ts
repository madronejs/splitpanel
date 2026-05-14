/**
 * The provide/inject contract a `<SplitGridView>` sets up for its descendants.
 *
 * The wrapper publishes a context object containing:
 *  - `handle`       — the `SplitGridHandle` facade (lifecycle, events, methods).
 *  - `panelStates`  — a reactive Map keyed by node id, holding per-panel state
 *                     that updates on every relevant event from `grid.subscribe`.
 *
 * Composables (`useSplitGrid`, `usePanelState`) read from this context rather
 * than reaching into the wrapper directly, so they work inside any descendant
 * component — including ones rendered via the `#leaf` slot.
 */
import type { InjectionKey, Ref } from 'vue';
import type { LayoutOptions } from '../SplitGrid';
import type {
  Container, Leaf, Length, LengthInput, Node, PanelDirectionInput,
} from '../types';
import type { SplitGridHandle } from './handle';

export interface PanelState<T = unknown> {
  /** Node id, matching what's in the tree definition. */
  id: string,
  /** A leaf's `data` payload; `undefined` for container nodes. */
  data: T | undefined,
  /**
   * The DOM element SplitGrid created for this panel. Stable for the
   * panel's lifetime — `<SplitPanel>`'s slot teleports into this element.
   */
  el: HTMLElement,
  /** The Length the runtime is currently using for this node's slot. */
  size: Length,
  /** True iff this is the maximized panel within its parent. */
  isMaximized: boolean,
  /** True iff the current size matches the definition's `bounds.size`. */
  isAtDefault: boolean,
  /**
   * True iff this panel is currently being dragged (only ever true when
   * the `<SplitGridView :draggable>` plugin is wired up). The flag mirrors
   * `draggable.onDragChange.sourceId === this.id`.
   */
  isDragging: boolean,
  /**
   * True iff this panel is the current drop target during an active drag
   * (i.e. it's about to receive an onDrop if the user releases here).
   * Mirrors `draggable.onDragChange.targetId === this.id`.
   */
  isDropTarget: boolean,
  /**
   * True iff a drag is in progress AND this panel is not the source — i.e.
   * this panel is a candidate drop target. Useful for "highlight everywhere
   * the user could drop right now" UI; `isDropTarget` is the more specific
   * "cursor is on me right now". Both can be true at the same time on the
   * cursor-target panel.
   */
  isDropZone: boolean,
  /** Index in `parent.node.children`; 0 for the root. */
  indexInParent: number,
  /** Parent container's direction (`undefined` for the root). */
  parentDirection: PanelDirectionInput | undefined,
  /** Raw node — handy when slot templates want bounds/data/etc. directly. */
  node: Leaf<T> | Container<T>,
  /**
   * Container-only: current sizes of this container's children, kept in
   * lockstep with the runtime via the reactive map. Lets consumers
   * watch container-level state (sizes, equality, maximized child)
   * without subscribing manually to `onChange` or maintaining a version
   * counter. `undefined` for leaf nodes.
   */
  childSizes: Length[] | undefined,
  /**
   * Container-only: id of the currently-maximized child within this
   * container, or `null` if none. Matches the runtime's `parent.max?.id`.
   * `undefined` for leaf nodes.
   */
  maximizedChildId: string | null | undefined,

  /**
   * Set this panel's size on its parent's axis. Sugar for
   * `grid.setSize(panel.id, size, opts)` — no need to plumb the id around.
   */
  setSize: (size: LengthInput, opts?: LayoutOptions) => void,
  /**
   * Toggle whether this panel is maximized within its parent.
   */
  toggleExpand: (opts?: LayoutOptions) => void,
  /** Maximize this panel within its parent. */
  maximize: (opts?: LayoutOptions) => void,
  /** Minimize this panel (restore its parent's default sizing). */
  minimize: (opts?: LayoutOptions) => void,
  /** Equalize sizing of the parent container's children. No-op on root. */
  equalize: (opts?: LayoutOptions) => void,
  /** Reset the parent container to its definition's sizes. No-op on root. */
  reset: (opts?: LayoutOptions) => void,
}

export interface ResizerState<T = unknown> {
  /**
   * Handle index within the container. `1..(N-1)` for normal dividers,
   * `-1` for the optional leading edge, `N` for the trailing edge.
   */
  index: number,
  /** Container id (for setSize / toggleExpand from inside the slot). */
  containerId: string,
  /** Container's direction. */
  direction: PanelDirectionInput,
  /**
   * Node defs on either side of this divider. `before` is undefined for
   * the leading decorative resizer; `after` is undefined for the trailing.
   */
  before: Node<T> | undefined,
  after: Node<T> | undefined,
}

/**
 * One entry in the wrapper's resizer registry. Exposed via the context so
 * a `<SplitPanel>` declaring its own `#resizer` slot can look up the
 * trailing divider element it should teleport into.
 */
export interface ResizerEntry<T = unknown> {
  el: HTMLElement,
  state: ResizerState<T>,
}

/**
 * Context published by `<SplitGridView>` via `provide`. Keep this minimal —
 * everything reactive composables need is here; nothing else should be added
 * without a real consumer.
 *
 * `resizerEntries` is keyed by `${containerId}#${handleIdx}`.
 *
 * `ownedResizers` is a registry of keys whose `<Teleport>` is being
 * provided by a child `<SplitPanel>`'s `#resizer` slot rather than the
 * top-level wrapper's slot. Used to avoid double-teleports into the same
 * element. Mutating it (add on mount, delete on unmount) must trigger
 * re-render of the wrapper's resizer loop, so it's a reactive Set.
 */
export interface SplitGridContext<T = unknown> {
  /** The vue-flow-style facade. Resolves the SplitGrid + lifetime + events. */
  handle: SplitGridHandle<T>,
  panelStates: Map<string, PanelState<T>>,
  resizerEntries: Map<string, ResizerEntry<T>>,
  ownedResizers: Set<string>,
}

/**
 * Inject key shared by the wrapper and its composables. Typed loosely
 * (`unknown` data) — the composables narrow with a type parameter at the
 * call site, which is the conventional Vue pattern.
 */
export const splitGridKey: InjectionKey<SplitGridContext> = Symbol('SplitGridContext');

/**
 * Hierarchical registry published by each container component (the wrapper
 * for the root, `<SplitContainer>` for nested ones). Declarative children
 * call `registerChild` on the closest enclosing registry during their setup.
 *
 * Before the SplitGrid is built (initial mount), `registerChild` pushes into
 * a pending-children buffer that the wrapper consumes in `onMounted` to
 * construct the root tree. After mount, it dispatches to `grid.addChild`
 * directly so v-for additions land on the live tree.
 *
 * `unregisterChild` only matters post-mount; before mount, the component
 * never finished registering in a way that needs cleanup.
 */
export interface ChildRegistry<T = unknown> {
  containerId: string,
  registerChild: (node: Node<T>) => void,
  unregisterChild: (id: string) => void,
}

export const childRegistryKey: InjectionKey<ChildRegistry> = Symbol('SplitGridChildRegistry');

/** Lazy ref-or-getter wrapper used by `usePanelState`. */
export type MaybeRefOrGetter<T> = T | Ref<T> | (() => T);
