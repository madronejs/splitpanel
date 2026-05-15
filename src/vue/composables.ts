/**
 * Vue composables backed by the `<SplitGridView>` provide/inject context.
 *
 * `useSplitGrid` is re-exported from `./handle`; it returns the vue-flow-style
 * `SplitGridHandle` (methods, event hooks, reactive reads) and supports an
 * optional `id` argument for cross-tree / pre-mount lookups via the module
 * registry. `usePanelState` keeps its own composable layer: it folds a
 * ref/getter id source into a `ComputedRef<PanelState | undefined>` that
 * reads through `handle.getPanelState`.
 */
import {
  computed, getCurrentInstance, inject, onBeforeUnmount, toValue,
  type ComputedRef,
} from 'vue';
import type { Node } from '../types';
import {
  childRegistryKey,
  type ChildRegistry, type MaybeRefOrGetter, type PanelState,
} from './context';
import { useSplitGrid } from './handle';

/**
 * Returns a reactive computed of the panel's state. Accepts a string, a
 * Vue ref, or a getter — anything `toValue` understands. Re-resolves when
 * either the id source changes or the underlying state map changes, which
 * happens once per relevant `grid.subscribe` event.
 *
 * Use this from a component sitting inside a `<SplitGridView>` slot, or any
 * descendant that needs per-panel reactivity without threading slot props
 * down by hand.
 */
export function usePanelState<T = unknown>(
  id: MaybeRefOrGetter<string>,
): ComputedRef<PanelState<T> | undefined> {
  // Resolve via `useSplitGrid()` (no id): throws if outside a SplitGridView
  // subtree. Same boundary the previous implementation had.
  const grid = useSplitGrid<T>();

  // The computed() establishes a dependency on toValue(id) AND on the
  // handle's `getPanelState` read — which under the hood reads from the
  // wrapper's shallowReactive panelStates Map. Mutating the map triggers
  // re-eval here.
  return computed(() => grid.getPanelState(toValue(id)));
}

/**
 * Auto-generate a stable id from the component's instance uid, with an
 * optional explicit override. `<SplitPanel>` / `<SplitContainer>` both
 * follow this pattern — the prefix distinguishes the kind so logs / DOM
 * `data-id` are self-describing.
 *
 * The uid is stable for the component's lifetime; `v-for :key` swaps
 * recreate the instance and the uid changes with it (which is the right
 * behavior — a new instance is a new panel/container).
 */
export function useAutoId(prefix: string, explicit?: string): string {
  if (explicit) return explicit;

  const instance = getCurrentInstance();

  return `${prefix}-${instance?.uid ?? Math.random().toString(36).slice(2)}`;
}

/**
 * Inject the enclosing `ChildRegistry` (provided by `<SplitGridView>` or a
 * nested `<SplitContainer>`), register `def` immediately, and unregister
 * on `beforeUnmount`. Throws if invoked outside a SplitGridView tree.
 *
 * `componentName` shapes the error message so users see "<SplitPanel>
 * must be used inside…" instead of a generic "context missing."
 *
 * Returns the registry so callers can keep a reference (e.g. for
 * `<SplitContainer>` which provides its own registry to descendants but
 * still needs to call back into the parent's).
 */
export function useChildRegistry<T = unknown>(
  componentName: string,
  resolvedId: string,
  def: Node<T>,
): ChildRegistry<T> {
  const registry = inject(childRegistryKey) as ChildRegistry<T> | undefined;

  if (!registry) {
    throw new Error(`<${componentName}> must be used inside a <SplitGridView>.`);
  }

  registry.registerChild(def);

  onBeforeUnmount(() => {
    registry.unregisterChild(resolvedId);
  });

  return registry;
}

export { useSplitGrid } from './handle';
