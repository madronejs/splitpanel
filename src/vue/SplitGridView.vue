<script setup lang="ts" generic="T = unknown">
/**
 * SplitGridView — Vue 3 wrapper around SplitGrid.
 *
 * Flat-props API: the root container's `id` / `direction` / `bounds` are
 * top-level props on the component itself, instead of a nested `:root`
 * object. The component is intentionally NOT reactive on the prop's full
 * shape: only `direction` and `bounds` are watched (mirroring how
 * `<SplitContainer>` watches its `direction`). Dynamic add/remove goes
 * through the imperative methods exposed via the SplitGridHandle.
 *
 * The wrapper publishes a `SplitGridHandle` via provide/inject and the
 * module-level registry in `handle.ts`. Descendants — and any component
 * that called `useSplitGrid('id')` BEFORE the wrapper mounted — share
 * the same handle object; queued event hooks fire on mount, mutating
 * methods throw before mount with a useful message.
 *
 * The `#leaf` slot scope is `{ panel: PanelState }`; `#resizer` is
 * `{ resizer: ResizerState }`. Both refresh on every relevant event.
 */
import {
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  provide,
  shallowReactive,
  useTemplateRef,
  watch,
} from 'vue';
import { SplitGrid } from '../SplitGrid';
import type { LayoutChangeEvent } from '../SplitGrid';
import { configureDraggable, type DraggableConfig } from '../draggable';
import type {
  Bounds, Container, Leaf, Length, LengthInput, Node, PanelDirectionInput,
  ResizerSpec,
} from '../types';
import {
  childRegistryKey, splitGridKey, type ChildRegistry, type PanelState, type ResizerState, type SplitGridContext,
} from './context';
import {
  attachHandle, createHandle, detachHandle, dispatchDragChange, registry,
  type SplitGridHandle,
} from './handle';
import { useAutoId } from './composables';

type LeafEntry = { el: HTMLElement, leaf: Leaf<T> };
type ResizerEntry = { el: HTMLElement, state: ResizerState<T> };

const props = withDefaults(
  defineProps<{
    /**
     * Root container id. Doubles as the registry key for `useSplitGrid(id)`,
     * so call sites in setup() that ran BEFORE this wrapper mounted resolve
     * to the same handle. When omitted, an instance-scoped id is generated
     * from the component's Vue uid — unique per instance, no cross-tree
     * lookup possible. Provide an explicit id ONLY when you need cross-tree
     * lookup or stable identification across v-if cycles; the cost is that
     * two wrappers can't share the same explicit id (the second mount
     * throws on attach). For "I have two stacked panels of the same shape"
     * use cases, leave the prop unset, or generate per-instance ids via
     * `useAutoId('my-prefix')`.
     *
     * One-shot — not reactive (renaming the root is intentionally not a
     * supported operation).
     */
    id?: string;
    /**
     * Layout axis. Watched: changing the prop calls `setDirection` on the
     * live grid.
     */
    direction: PanelDirectionInput;
    /**
     * Bounds applied to the root container itself (min/max/size as the
     * root sits inside the host element). Watched: changing the prop
     * calls `setBounds`.
     */
    bounds?: Bounds;
    /**
     * Data-driven children. Mutually exclusive with declarative
     * `<SplitPanel>` / `<SplitContainer>` slot children — providing both
     * is a configuration error and throws on mount.
     */
    children?: Array<Node<T>>;
    /** Default resizer spec applied to containers that don't override. */
    resizer?: ResizerSpec;
    /** Animation duration in ms for programmatic size changes. */
    animationMs?: number;
    /** Enable console diagnostics. */
    debug?: boolean;
    /**
     * Opt-in drag-drop reorder config. When set, configureDraggable is
     * called on mount and disposed on unmount. PanelState.isDragging /
     * isDropTarget reflect the live drag state via onDragChange.
     */
    draggable?: DraggableConfig<T>;
    /**
     * Canonical id sequence. When a declarative `<SplitPanel>` registers
     * after the wrapper has mounted (the v-if-toggle / `<KeepAlive>`
     * pattern), the wrapper looks up the new id's position in `order`
     * and inserts the panel before the first existing child whose order
     * index is greater. Without this, `addChild` appends — so a panel
     * that started in slot position 2 ends up at the end of the tree
     * after a hide/show cycle.
     *
     * Insertion-only: the prop is consulted at register time. Changes to
     * the array after mount don't re-shuffle existing children — call
     * `grid.syncChildren(...)` for that.
     *
     * IDs in the tree that aren't in `order` keep their relative
     * position; IDs in `order` that aren't in the tree are ignored.
     */
    order?: string[];
  }>(),
  {
    id: undefined,
    bounds: undefined,
    children: undefined,
    resizer: undefined,
    animationMs: undefined,
    debug: false,
    draggable: undefined,
    order: undefined,
  },
);

// Auto-id when the consumer didn't pass one. `useAutoId` stamps a stable
// id from the component's Vue uid — different per instance, same for the
// instance's lifetime. We hold onto `isAutoId` so unmount can drop the
// registry entry (auto-ids have no external consumer; leaving them in
// the registry would leak memory across v-if cycles).
const resolvedId = useAutoId('sgv', props.id);
const isAutoId = !props.id;

// `@change` / `@ready` stay as wrapper-level emits for parents who prefer
// the template-binding ergonomics. The new path (`handle.onChange` /
// `handle.onReady`) covers the same events and works outside the parent.
const emit = defineEmits<{
  (e: 'ready', grid: SplitGrid<T>): void;
  (e: 'change', event: LayoutChangeEvent): void;
}>();

const hostRef = useTemplateRef<HTMLDivElement>('hostRef');

// Claim-or-create the handle keyed by `resolvedId`. A parent that called
// `useSplitGrid(props.id)` in setup already populated the registry; we
// share that same handle so queued listeners drain onto our grid on attach.
// Otherwise create + register a fresh handle ourselves.
const handle: SplitGridHandle<T> = (() => {
  const existing = registry.get(resolvedId) as SplitGridHandle<T> | undefined;

  if (existing) return existing;

  const fresh = createHandle<T>(resolvedId);

  registry.set(resolvedId, fresh);
  return fresh;
})();

// shallowReactive so Map mutations trigger re-render but the values stay
// raw (no per-field reactivity overhead — values are reassigned wholesale).
const leafEntries = shallowReactive(new Map<string, LeafEntry>());
const resizerEntries = shallowReactive(new Map<string, ResizerEntry>());
const panelStates = shallowReactive(new Map<string, PanelState<T>>());
// Keys (`${containerId}#${handleIdx}`) of resizers whose contents are
// teleported in by a child `<SplitPanel>`'s `#resizer` slot. The wrapper
// skips these so we don't double-teleport. Reactive so wrapper re-renders
// when a panel takes/releases ownership.
const ownedResizers = shallowReactive(new Set<string>());

// Provided to descendants for `useSplitGrid()` / `usePanelState(id)`.
const context: SplitGridContext<T> = {
  handle, panelStates, resizerEntries, ownedResizers,
};

provide(splitGridKey, context as SplitGridContext);

// Buffer for declarative children registered before the grid is built.
// Declarative <SplitPanel>/<SplitContainer> children push on top during
// their setup (which runs before onMounted). After mount the registry
// dispatches to `grid.addChild` directly.
const pendingChildren: Array<Node<T>> = [];

/**
 * Where in the parent's children array to insert a newly-registered
 * panel. When `:order` is set, the new id's position in `order`
 * determines the slot: insert before the first existing child whose
 * order index is greater. IDs absent from `order` (or `order` itself
 * unset) fall through to `undefined` → `grid.addChild`'s default
 * append.
 */
function insertionIndexFor(newId: string): number | undefined {
  const order = props.order;

  if (!order) return undefined;
  const newOrderIdx = order.indexOf(newId);

  if (newOrderIdx < 0) return undefined;
  const current = handle.instance?.get(resolvedId);

  if (!current || !('sizes' in current)) return undefined;
  const children = current.node.children;

  for (let i = 0; i < children.length; i += 1) {
    const idx = order.indexOf(children[i].id);

    if (idx > newOrderIdx) return i;
  }
  return undefined;
}

const rootRegistry: ChildRegistry<T> = {
  containerId: resolvedId,
  registerChild(node) {
    if (handle.instance) {
      handle.instance.addChild(resolvedId, node, insertionIndexFor(node.id));
    } else {
      pendingChildren.push(node);
    }
  },
  unregisterChild(panelId) {
    if (!handle.instance || isUnmounting) return;
    handle.instance.removeChild(panelId);
  },
};

provide(childRegistryKey, rootRegistry as ChildRegistry);

// Drag state, mirrored from the draggable plugin's onDragChange. Plain
// object — the reactivity on PanelState is what consumers observe; we
// refresh source/target entries when this changes.
const dragState = { sourceId: null as string | null, targetId: null as string | null };
let disposeDraggable: (() => void) | null = null;
// Set in `onBeforeUnmount` so child <SplitPanel>s — whose own beforeUnmount
// hooks run AFTER ours during a wholesale wrapper unmount — skip the
// per-child `grid.removeChild`. Tearing down individual leaves during a
// full teardown would detach each leaf's DOM (and any teleported third-
// party content inside it) from the document BEFORE that content's own
// beforeUnmount runs, breaking things like `document.getElementById` in
// video-player teardown. The full teardown happens in `onUnmounted` below,
// by which point all children — declarative and teleported — are done.
let isUnmounting = false;

// ---------- helpers ----------

function buildPanelState(g: SplitGrid<T>, id: string): PanelState<T> | undefined {
  const s = g.get(id);

  if (!s) return undefined;
  const parent = s.parent;
  const isLeaf = !('sizes' in s);
  const size: Length = parent ? parent.sizes[s.indexInParent] : { unit: 'fr', value: 1 };
  const isMax = g.isMaximized(id);
  const parentDirection = parent?.node.direction;

  const setSize = (sz: LengthInput, opts?: { animate?: boolean }) => g.setSize(id, sz, opts);
  const toggleExpand = (opts?: { animate?: boolean }) => g.toggleExpand(id, opts);
  const maximize = (opts?: { animate?: boolean }) => g.maximize(id, opts);
  const minimize = (opts?: { animate?: boolean }) => g.minimize(id, opts);
  const equalize = (opts?: { animate?: boolean }) => {
    if (parent) g.equalize(parent.node.id, opts);
  };
  const reset = (opts?: { animate?: boolean }) => {
    if (parent) g.reset(parent.node.id, opts);
  };

  const containerLike = !isLeaf
    ? (() => {
      const cs = s as { sizes: Length[], max: { id: string } | null };
      const maxIdx = g.getMaximizedIndex(id);

      return {
        childSizes: [...cs.sizes],
        maximizedChildId: cs.max?.id ?? null,
        // Method returns -1 when no child is maximized; normalize to
        // `null` to match the existing `maximizedChildId` shape.
        maximizedChildIndex: maxIdx < 0 ? null : maxIdx,
        childrenEqual: g.areChildrenEqual(id),
      };
    })()
    : {
      childSizes: undefined,
      maximizedChildId: undefined,
      maximizedChildIndex: undefined,
      childrenEqual: undefined,
    };

  return {
    id,
    el: s.el,
    data: isLeaf ? (s.node as Leaf<T>).data : undefined,
    size,
    isMaximized: isMax,
    isAtDefault: g.isAtDefault(id),
    isDragging: dragState.sourceId === id,
    isDropTarget: dragState.targetId === id,
    isDropZone: dragState.sourceId !== null && dragState.sourceId !== id,
    indexInParent: s.indexInParent,
    parentDirection,
    node: s.node as Leaf<T> | Container<T>,
    ...containerLike,

    setSize,
    toggleExpand,
    maximize,
    minimize,
    equalize,
    reset,
  };
}

/** Rebuild the panelStates entry for `id`, or delete if the node is gone. */
function refreshPanelState(g: SplitGrid<T>, id: string): void {
  const next = buildPanelState(g, id);

  if (next) panelStates.set(id, next);
  else panelStates.delete(id);
}

/** Rebuild state for every node in the tree (used on mount). */
function rebuildAllPanelStates(g: SplitGrid<T>): void {
  panelStates.clear();
  const walk = (id: string) => {
    refreshPanelState(g, id);
    const s = g.get(id);

    if (s && 'sizes' in s) {
      for (const child of s.node.children) walk(child.id);
    }
  };

  walk(resolvedId);
}

/**
 * After a structural mutation, walk every `.sp-resizer` and refresh the
 * resizerEntries map. Resizer handlers in the core close over their parent
 * container, but each resizer's adjacent siblings change as children come
 * and go — so we re-derive the slot data fresh each time.
 */
function captureResizers(g: SplitGrid<T>): void {
  if (!hostRef.value) return;

  const next = new Map<string, ResizerEntry>();
  const all = hostRef.value.querySelectorAll<HTMLElement>('.sp-resizer');

  for (const el of all) {
    const containerEl = el.parentElement;
    const containerId = containerEl?.dataset.id;
    const handleIdx = Number(el.dataset.handle);

    if (!containerId || !Number.isFinite(handleIdx)) continue;

    const parent = g.get(containerId);

    if (!parent || !('sizes' in parent)) continue;

    const numChildren = parent.node.children.length;
    const isLeading = handleIdx === -1;
    const isTrailing = handleIdx === numChildren;
    const before = isLeading
      ? undefined
      : (parent.node.children[handleIdx - 1] as Node<T> | undefined);
    const after = isLeading
      ? (parent.node.children[0] as Node<T> | undefined)
      : isTrailing
        ? undefined
        : (parent.node.children[handleIdx] as Node<T> | undefined);

    const isEdge = isLeading || isTrailing;

    if (!isEdge && (!before || !after)) continue;

    const key = `${containerId}#${handleIdx}`;

    // `data` lives only on Leaf<T> — containers don't carry it. The
    // typed `*Data` fields below give consumers a clean read without
    // narrowing `Node<T>` from a union.
    const beforeData = before && !('children' in before) ? (before as Leaf<T>).data : undefined;
    const afterData = after && !('children' in after) ? (after as Leaf<T>).data : undefined;

    next.set(key, {
      el,
      state: {
        index: handleIdx,
        containerId,
        direction: parent.node.direction,
        before,
        after,
        beforeData,
        afterData,
      },
    });
  }

  for (const key of resizerEntries.keys()) {
    if (!next.has(key)) resizerEntries.delete(key);
  }
  for (const [key, entry] of next) resizerEntries.set(key, entry);
}

/**
 * Translate a single `onChange` event into Vue-reactive map updates. Events
 * with explicit `nodeIds` refresh just those entries; events with empty
 * nodeIds (drag / equalize / reset / set-direction) refresh every child of
 * `containerId` plus the container itself. `add-child` / `remove-child`
 * also ripple to siblings whose indexInParent shifted, so we walk the
 * container's full children list there too.
 */
function onLayoutChange(g: SplitGrid<T>, event: LayoutChangeEvent): void {
  const ids = new Set<string>();

  ids.add(event.containerId);

  for (const id of event.nodeIds) ids.add(id);

  const containerState = g.get(event.containerId);
  const isStructural = event.reason === 'add-child' || event.reason === 'remove-child'
    || event.reason === 'swap';

  if (event.nodeIds.length === 0 || isStructural) {
    if (containerState && 'sizes' in containerState) {
      for (const child of containerState.node.children) ids.add(child.id);
    }
  }

  for (const id of ids) refreshPanelState(g, id);

  if (isStructural) {
    // Removed leaves: drop their Teleport target reference so Vue can
    // unmount the slot content (its element is gone from the DOM either
    // way; pruning the map is what triggers re-render).
    if (event.reason === 'remove-child') {
      for (const id of event.nodeIds) leafEntries.delete(id);
    }
    captureResizers(g);
  }
}

// ---------- lifecycle ----------

onMounted(() => {
  if (!hostRef.value) return;

  // Mutual-exclusion check: the `:children` prop and declarative
  // <SplitPanel>/<SplitContainer> slot children both populate the root.
  // Allowing both would be ambiguous (merge order? duplicate ids?) — so
  // it's a hard error.
  const propChildren = props.children ?? [];
  const slotChildren = pendingChildren;

  if (propChildren.length > 0 && slotChildren.length > 0) {
    throw new Error(
      `<SplitGridView id="${resolvedId}">: pass children via either the :children `
      + 'prop OR declarative <SplitPanel> / <SplitContainer> slots, not both.',
    );
  }

  const initialChildren = propChildren.length > 0 ? propChildren : slotChildren;

  const rootDef: Container<T> = {
    id: resolvedId,
    direction: props.direction,
    bounds: props.bounds,
    resizer: props.resizer,
    children: initialChildren,
  };

  const g = new SplitGrid<T>({
    root: rootDef,
    resizer: props.resizer,
    animationMs: props.animationMs,
    debug: props.debug,
    renderLeaf: (ctx) => {
      leafEntries.set(ctx.id, { el: ctx.el, leaf: ctx.leaf });
    },
    onChange: (event) => emit('change', event),
  });

  g.mount(hostRef.value);
  g.subscribe((event) => onLayoutChange(g, event));

  // Attach the handle: drains queued onChange/onReady listeners, exposes
  // panelStates for `handle.getPanelState`, flips `isReady` to true.
  // Throws if another `<SplitGridView>` already mounted under this id.
  attachHandle(handle, g, { panelStates, resizerEntries, ownedResizers });

  rebuildAllPanelStates(g);
  captureResizers(g);

  if (props.draggable) {
    const userOnDragChange = props.draggable.onDragChange;

    disposeDraggable = configureDraggable<T>(g, {
      ...props.draggable,
      onDragChange(event) {
        const oldSource = dragState.sourceId;
        const oldTarget = dragState.targetId;

        dragState.sourceId = event.sourceId;
        dragState.targetId = event.targetId;

        if (oldSource === null !== (event.sourceId === null)) {
          rebuildAllPanelStates(g);
        } else {
          const affected = new Set<string>();

          for (const id of [oldSource, oldTarget, event.sourceId, event.targetId]) {
            if (id) affected.add(id);
          }
          for (const id of affected) refreshPanelState(g, id);
        }
        // Fan out to handle.onDragChange subscribers BEFORE the
        // user's per-component config callback, so the latter can rely
        // on `handle.onDragChange` listeners having seen the event too.
        dispatchDragChange(handle, event);
        userOnDragChange?.(event);
      },
    });
  }

  emit('ready', g);
});

// Direction is reactive: changing the prop calls setDirection on the live
// grid. No `immediate` — the initial value is baked into the rootDef.
watch(() => props.direction, (next) => {
  if (handle.instance) handle.instance.setDirection(resolvedId, next);
});

// Bounds is reactive: changing the prop calls setBounds on the live grid.
// Shallow reference equality only — to update from outside, swap to a
// new object (`bounds = { ...bounds, min: '200px' }`).
watch(() => props.bounds, (next) => {
  if (handle.instance && next) handle.instance.setBounds(resolvedId, next);
});

onBeforeUnmount(() => {
  isUnmounting = true;
});

onUnmounted(() => {
  disposeDraggable?.();
  disposeDraggable = null;
  handle.instance?.unmount();
  detachHandle(handle);
  // Auto-id handles have no external consumer that could find them via
  // `useSplitGrid(id)` later — drop them from the registry to avoid
  // leaking across v-if cycles. Explicit ids stick around so queued
  // listeners survive a remount under the same id (documented feature).
  if (isAutoId) registry.delete(resolvedId);
  leafEntries.clear();
  resizerEntries.clear();
  panelStates.clear();
});

// Surface the handle on a template ref for parents that prefer that
// pattern over `useSplitGrid(props.id)`. The handle is the entire public
// API; nothing else needs to be exposed.
defineExpose({ handle });
</script>

<template>
  <div ref="hostRef" class="sp-vue-host">
    <!--
      Default slot is the declarative tree (<SplitPanel> / <SplitContainer>).
      Rendered into a display:none div so the components get instantiated
      (running their setups, where they register via inject) without
      contributing visible layout. The actual panel content gets teleported
      out of here into the leaf elements SplitGrid creates.
    -->
    <div class="sp-vue-declarative">
      <slot />
    </div>

    <template v-for="[id, _entry] in leafEntries" :key="id">
      <Teleport
        v-if="panelStates.get(id)"
        :to="_entry.el"
      >
        <slot name="leaf" :panel="panelStates.get(id)!" />
      </Teleport>
    </template>
    <template v-for="[key, entry] in resizerEntries" :key="key">
      <!--
        Skip resizers a child <SplitPanel> has claimed via its own
        `#resizer` slot. Without this filter, both teleports would mount
        into the same divider element.
      -->
      <Teleport
        v-if="!ownedResizers.has(key)"
        :to="entry.el"
      >
        <slot name="resizer" :resizer="entry.state" />
      </Teleport>
    </template>
  </div>
</template>

<style>
/*
 * Real block element (not `display: contents`) so:
 *   - Consumer-applied classes (e.g. `w-100 h-100`, flex utilities) attach
 *     to an actual box and take effect.
 *   - The element is highlightable in devtools.
 *   - The grid container it hosts has a defined parent to size against.
 * Defaults to filling its parent (`width: 100%; height: 100%`). In a flex
 * parent, prefer `flex: 1` or similar via class — the `min-*: 0` lets the
 * host shrink instead of forcing overflow.
 */
.sp-vue-host {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}
.sp-vue-declarative {
  display: none;
}
</style>
