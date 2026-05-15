<script setup lang="ts" generic="T = unknown">
/**
 * <SplitContainer> — a declarative nested Container in the panel tree.
 *
 * Like `<SplitPanel>`, but represents a Container node (which itself has
 * children). It:
 *
 *   1. Builds its own Container def with an empty children array.
 *   2. Registers that def with the enclosing registry (parent container).
 *   3. Provides its OWN ChildRegistry so descendant `<SplitPanel>` /
 *      `<SplitContainer>` components register with us instead of the parent.
 *      Initial children push into the def's children array (by reference)
 *      before the grid is built. Post-mount additions call grid.addChild.
 *
 * Renders its default slot so descendant components run their setups (where
 * they register). The slot output isn't displayed — SplitGrid creates the
 * actual container element from the registered def. Each child component
 * teleports its content into the right leaf afterwards.
 */
import { provide, watch } from 'vue';
import { childRegistryKey, type ChildRegistry } from './context';
import { useAutoId, useChildRegistry, useSplitGrid } from './composables';
import type {
  Bounds, Container, Node, PanelDirectionInput, ResizerSpec,
} from '../types';

const props = defineProps<{
  /**
   * Optional explicit panel id. When omitted, the component auto-generates
   * a stable id from its Vue instance uid (`sc-<uid>`). Pass an explicit
   * id when you need to reference the container externally
   * (setDirection / equalize / etc.).
   *
   * Named `panelId` rather than `id` to avoid shadowing / fallthrough
   * confusion with the HTML `id` attribute.
   */
  panelId?: string,
  /**
   * Layout axis for this container's children. Accepts either the enum
   * (`PanelDirection.Row`) or the bare string literal (`'row'` / `'column'`)
   * — handy when binding from a template without an enum import.
   */
  direction: PanelDirectionInput,
  /**
   * How this container sits inside its parent (min/max/size for the container
   * itself). Different from the children's bounds. Reactive — swap the prop
   * to a new reference to retrigger the watcher; in-place mutation won't fire.
   */
  bounds?: Bounds,
  /**
   * Resizer spec applied to dividers between this container's children.
   * Mount-time only — runtime changes are not propagated to the live grid
   * (no setResizer in the core). Pass the desired spec at mount.
   */
  resizer?: ResizerSpec,
}>();

const grid = useSplitGrid<T>();
const resolvedId = useAutoId('sc', props.panelId);

// Build my own container def. The `children` array is shared by reference
// with my own registry — descendant setups push into it before the grid
// is built, and the wrapper consumes it during construction.
const myChildren: Array<Node<T>> = [];
const myDef: Container<T> = {
  id: resolvedId,
  direction: props.direction,
  bounds: props.bounds,
  resizer: props.resizer,
  children: myChildren,
};

// Provide my own registry to descendants BEFORE registering myself with
// the parent — so by the time my slot renders and child setups inject,
// they see my registry, not my parent's.
const myRegistry: ChildRegistry<T> = {
  containerId: resolvedId,
  registerChild(node) {
    if (grid.instance) {
      grid.instance.addChild(resolvedId, node);
    } else {
      myChildren.push(node);
    }
  },
  unregisterChild(id) {
    if (grid.instance) grid.instance.removeChild(id);
  },
};

provide(childRegistryKey, myRegistry as ChildRegistry);
useChildRegistry<T>('SplitContainer', resolvedId, myDef);

// Direction-prop reactivity: surface-level (no deep watcher). Swapping the
// prop's value calls setDirection on the live grid.
watch(() => props.direction, (next) => {
  if (grid.instance) grid.setDirection(resolvedId, next);
});

// Bounds reactivity: shallow ref-equality, same convention as
// <SplitGridView>. Swap the prop's value to a new reference (don't
// mutate in place — watch won't fire).
watch(() => props.bounds, (next) => {
  if (grid.instance && next) grid.setBounds(resolvedId, next);
});
</script>

<template>
  <!--
    The slot runs descendant component setups (where they register). The
    slot output is rendered as a Fragment but not displayed visually — the
    leaves and nested containers find their own DOM homes via Teleport.
    No wrapper element, so this component contributes zero extra layout.
  -->
  <slot />
</template>
