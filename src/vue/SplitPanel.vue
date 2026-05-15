<script setup lang="ts" generic="T = unknown">
/**
 * <SplitPanel> — a declarative Leaf in the panel tree.
 *
 * On setup the component injects the enclosing `ChildRegistry` (provided by
 * `<SplitGridView>` for top-level panels or by `<SplitContainer>` for nested
 * ones) and calls `registerChild` with its bounds + data. During initial
 * mount this pushes into a pending buffer the wrapper consumes when it
 * builds the SplitGrid; for v-for additions made after mount, it dispatches
 * to `grid.addChild` directly. `onBeforeUnmount` calls `unregisterChild` so
 * v-for removals propagate.
 *
 * The default slot is teleported into the leaf element the SplitGrid runtime
 * creates. Until that element exists (i.e. before onMounted on the wrapper
 * fires), the component renders nothing.
 */
import {
  computed, inject, onBeforeUnmount, useSlots, watch,
} from 'vue';
import { splitGridKey, type SplitGridContext } from './context';
import {
  useAutoId, useChildRegistry, usePanelState, useSplitGrid,
} from './composables';
import type { Bounds, LengthInput, Leaf } from '../types';

const props = defineProps<{
  /**
   * Optional explicit panel id. When omitted, the component auto-generates
   * a stable id from its Vue instance uid (`sp-<uid>`). The auto-id stays
   * the same for the component's lifetime, so SplitGrid's id-based
   * tracking is uninterrupted. Pass an explicit id when you need to
   * reference the panel from outside (setSize/toggleExpand/etc.).
   *
   * Named `panelId` rather than `id` to avoid shadowing / fallthrough
   * confusion with the HTML `id` attribute.
   */
  panelId?: string,
  /** Default size — px number, `<n>px`, `<n>%`, or `auto`. */
  size?: LengthInput,
  /** Minimum size, enforced by CSS clamp. */
  min?: LengthInput,
  /** Maximum size, enforced by CSS clamp. */
  max?: LengthInput,
  /**
   * Application-defined payload exposed via slot scope / panelState. The
   * watcher is shallow — to update from outside, swap the prop's value
   * to a new reference (`tab.data = { ...tab.data, label: 'new' }`) rather
   * than mutating in place.
   *
   * NEVER bind an inline object literal (`:data="{ ... }"`). Vue's shallow
   * watcher fires on every parent render (each render produces a fresh
   * reference), and each fire calls `grid.setData`, which emits a
   * `set-data` event. The core's `Object.is` guard catches the same-ref
   * no-op case, but inline literals never hit that path — they thrash
   * subscribers, can trigger recursive-update warnings, and waste work.
   * Bind a `ref` or `computed` instead so the reference is stable when
   * nothing has actually changed.
   */
  data?: T,
}>();

const resolvedId = useAutoId('sp', props.panelId);
const leaf: Leaf<T> = {
  id: resolvedId,
  bounds: {
    ...(props.size !== undefined && { size: props.size }),
    ...(props.min !== undefined && { min: props.min }),
    ...(props.max !== undefined && { max: props.max }),
  },
  data: props.data,
};

useChildRegistry<T>('SplitPanel', resolvedId, leaf);

// Reactive prop propagation. All watchers are shallow (Vue's default) — to
// update `data` from outside, swap to a new object (`tab.data = { ... }`)
// rather than mutating in place. Same convention as Vue's `<KeepAlive>` /
// transition props: surface-level reactivity, no deep traversal cost.
const grid = useSplitGrid<T>();

// Size / min / max move together as a `bounds` patch so a simultaneous
// change of all three produces a single setBounds (and one writeTracks).
// `handle.instance` gates the call: pre-mount watchers fire during the
// initial setup pass, before the grid exists, and there's nothing to do
// then — the initial bounds were already baked into the registered leaf.
watch(
  [() => props.size, () => props.min, () => props.max],
  ([newSize, newMin, newMax], [oldSize, oldMin, oldMax]) => {
    if (!grid.instance) return;
    const patch: Partial<Bounds> = {};

    if (newSize !== oldSize) patch.size = newSize;
    if (newMin !== oldMin) patch.min = newMin;
    if (newMax !== oldMax) patch.max = newMax;
    grid.setBounds(resolvedId, patch);
  },
);

// `data` is its own watch — different API path (setData) and the user is
// expected to swap references rather than mutate, so reference equality
// is the right trigger.
watch(() => props.data, (next) => {
  if (grid.instance) grid.setData(resolvedId, next);
});

const state = usePanelState<T>(() => resolvedId);
const teleportTarget = computed(() => state.value?.el ?? null);

// Per-panel `#resizer` slot — the DX-friendly counterpart to the
// container-level slot on <SplitGridView>. When a consumer provides one,
// the slot content teleports into the LEADING divider element for THIS
// panel (the divider between me and my previous sibling). For the first
// child this resolves to the `resizer.first` decorative edge if enabled,
// or nothing otherwise — same shape as the legacy `showFirstResizeEl`
// pattern where every panel gets a "header bar" to its left/top.
//
// Ownership is published via the shared context so the wrapper knows to
// skip rendering its own slot into the same divider — avoids double
// teleports clobbering each other.
const slots = useSlots();
const hasResizerSlot = computed(() => !!slots.resizer);
const context = inject(splitGridKey) as SplitGridContext<T> | undefined;

const leadingResizerKey = computed(() => {
  const id = state.value?.id;

  if (!id || !grid.instance || !context) return null;

  const node = grid.instance.get(id);

  if (!node || !node.parent) return null;

  // The leading divider for the panel at indexInParent === i sits at
  // handleIdx === i (inner divider between children[i-1] and children[i]).
  // For the first child this overshoots backwards; fall back to the
  // `-1` decorative leading edge when `resizer.first` is on, otherwise
  // there's no leading slot to teleport into.
  const { id: parentId } = node.parent.node;
  const innerKey = `${parentId}#${node.indexInParent}`;

  if (context.resizerEntries.has(innerKey)) return innerKey;

  const edgeKey = `${parentId}#-1`;

  return node.indexInParent === 0 && context.resizerEntries.has(edgeKey)
    ? edgeKey
    : null;
});

const leadingResizerEntry = computed(() => {
  const key = leadingResizerKey.value;

  return key ? context!.resizerEntries.get(key) ?? null : null;
});

// Track the currently-owned key so we can release ownership when the panel
// moves (swap) or unmounts. The watcher fires on initial mount once the
// wrapper has populated resizerEntries.
let ownedKey: string | null = null;

watch([hasResizerSlot, leadingResizerKey], ([has, key]) => {
  if (!context) return;

  if (ownedKey && ownedKey !== key) {
    context.ownedResizers.delete(ownedKey);
    ownedKey = null;
  }

  if (has && key && key !== ownedKey) {
    context.ownedResizers.add(key);
    ownedKey = key;
  }
}, { immediate: true });

onBeforeUnmount(() => {
  if (ownedKey && context) {
    context.ownedResizers.delete(ownedKey);
    ownedKey = null;
  }
});

defineExpose({
  /** Reactive PanelState for this panel (useful for parent components reaching down). */
  state,
});
</script>

<template>
  <!--
    Until the SplitGrid creates the leaf's DOM element (during the wrapper's
    onMounted), `state.el` is undefined and we render nothing. Once the
    target exists, the slot is teleported into it. The teleport is local
    enough that Vue still owns the slot vnodes and unmounts them properly
    when this component unmounts.
  -->
  <Teleport v-if="teleportTarget" :to="teleportTarget">
    <slot :panel="state" />
  </Teleport>
  <!--
    Optional per-panel resizer slot. Renders only if (a) the consumer
    declared `#resizer` on this <SplitPanel>, and (b) a leading divider
    element exists for this panel (i.e. we're not the first child, or
    `resizer.first` is enabled on the parent).
  -->
  <Teleport
    v-if="hasResizerSlot && leadingResizerEntry"
    :to="leadingResizerEntry.el"
  >
    <slot name="resizer" :resizer="leadingResizerEntry.state" />
  </Teleport>
</template>
