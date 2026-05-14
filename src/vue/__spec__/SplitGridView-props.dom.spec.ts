// @vitest-environment happy-dom
/**
 * Flat-props contract for <SplitGridView>:
 *   - id is optional; when omitted, an instance-scoped id is auto-generated.
 *   - explicit id is one-shot (becomes both registry key + root id).
 *   - direction is reactive: prop changes trigger setDirection on the grid.
 *   - bounds is reactive: prop changes trigger setBounds(id, ...) on the grid.
 *   - :children and declarative <SplitPanel>/<SplitContainer> slots are
 *     mutually exclusive — providing both is a configuration error.
 *
 * These assertions sit on top of the existing layout suites; they cover the
 * prop-watcher plumbing only.
 */
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, nextTick, ref } from 'vue';
import SplitGridView from '../SplitGridView.vue';
import SplitPanel from '../SplitPanel.vue';
import { useSplitGrid } from '../composables';
import { registry } from '../handle';
import { PanelDirection } from '../../types';

beforeEach(() => {
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 400, width: 800, height: 400, toJSON: () => ({}),
  } as DOMRect));
});

afterEach(() => {
  document.body.innerHTML = '';

  for (const id of registry.keys()) registry.delete(id);
});

describe('flat root props', () => {
  it('id and direction props build the root container', async () => {
    const wrapper = mount(SplitGridView, {
      props: { id: 'r1', direction: PanelDirection.Row, children: [{ id: 'a' }, { id: 'b' }] },
      attachTo: document.body,
    });

    await nextTick();
    await nextTick();

    const root = useSplitGrid('r1').instance?.get('r1');

    expect(root).toBeTruthy();
    expect(root?.node.id).toBe('r1');
    expect((root?.node as { direction?: string }).direction).toBe('row');
    wrapper.unmount();
  });

  it('direction prop is reactive: changes call setDirection on the grid', async () => {
    const direction = ref<'row' | 'column'>('row');
    const Parent = defineComponent({
      components: { SplitGridView, SplitPanel },
      setup: () => ({ direction }),
      template: `
        <SplitGridView id="r2" :direction="direction">
          <SplitPanel panel-id="a" />
          <SplitPanel panel-id="b" />
        </SplitGridView>
      `,
    });

    const wrapper = mount(Parent, { attachTo: document.body });

    await nextTick();
    await nextTick();

    const events: string[] = [];

    useSplitGrid('r2').onChange((e) => events.push(`${e.reason}:${e.containerId}`));

    direction.value = 'column';
    await nextTick();
    expect(events).toContain('set-direction:r2');
    wrapper.unmount();
  });

  it('bounds prop is reactive: changes call setBounds on the grid', async () => {
    // setBounds on the ROOT container is a no-op event-wise (see
    // SplitGrid.ts:834 — no parent to rebalance against), so we assert
    // on the observable side effect: the node's bounds object updates.
    const bounds = ref<{ min?: string }>({ min: '100px' });
    const Parent = defineComponent({
      components: { SplitGridView, SplitPanel },
      setup: () => ({ bounds }),
      template: `
        <SplitGridView id="r3" direction="row" :bounds="bounds">
          <SplitPanel panel-id="a" />
          <SplitPanel panel-id="b" />
        </SplitGridView>
      `,
    });

    const wrapper = mount(Parent, { attachTo: document.body });

    await nextTick();
    await nextTick();

    const grid = useSplitGrid('r3').instance!;
    const before = (grid.get('r3') as { node: { bounds?: { min?: string } } }).node.bounds;

    expect(before?.min).toBe('100px');

    bounds.value = { min: '200px' };
    await nextTick();

    const after = (grid.get('r3') as { node: { bounds?: { min?: string } } }).node.bounds;

    expect(after?.min).toBe('200px');
    wrapper.unmount();
  });
});

describe('optional id (auto-generated)', () => {
  // The common case: a consumer drops <SplitGridView> in the template
  // without caring about cross-tree handle access. The wrapper should
  // mount without an error and produce a usable grid.
  it('mounts without an explicit id', async () => {
    const wrapper = mount(SplitGridView, {
      props: { direction: PanelDirection.Row, children: [{ id: 'a' }, { id: 'b' }] },
      attachTo: document.body,
    });

    await nextTick();
    await nextTick();

    expect(document.body.querySelectorAll('.sp-panel').length).toBe(2);
    wrapper.unmount();
  });

  // Two instances without an explicit id can coexist — the SCB-stacked
  // use case. With a fixed explicit id both wrappers would compete for
  // the same registry slot; auto-id gives each a unique scope.
  it('two instances without explicit ids do not collide', async () => {
    const Parent = defineComponent({
      components: { SplitGridView, SplitPanel },
      template: `
        <div>
          <SplitGridView direction="row">
            <SplitPanel panel-id="a-1" />
            <SplitPanel panel-id="a-2" />
          </SplitGridView>
          <SplitGridView direction="row">
            <SplitPanel panel-id="b-1" />
            <SplitPanel panel-id="b-2" />
          </SplitGridView>
        </div>
      `,
    });
    const wrapper = mount(Parent, { attachTo: document.body });

    await nextTick();
    await nextTick();

    // Both trees built their own panels without one stealing the other's.
    expect(document.body.querySelectorAll('.sp-panel[data-id="a-1"]')).toHaveLength(1);
    expect(document.body.querySelectorAll('.sp-panel[data-id="b-1"]')).toHaveLength(1);
    wrapper.unmount();
  });

  // Auto-id handles have no external consumer that could find them later
  // via `useSplitGrid(id)`. Leaving them in the registry leaks memory
  // across v-if cycles; auto-id unmount must clean up.
  it('auto-id handle is removed from the registry on unmount', async () => {
    const wrapper = mount(SplitGridView, {
      props: { direction: PanelDirection.Row, children: [{ id: 'a' }] },
      attachTo: document.body,
    });

    await nextTick();
    await nextTick();

    const sgvKeys = [...registry.keys()].filter((k) => k.startsWith('sgv-'));

    expect(sgvKeys).toHaveLength(1);

    wrapper.unmount();
    await nextTick();

    const sgvKeysAfter = [...registry.keys()].filter((k) => k.startsWith('sgv-'));

    expect(sgvKeysAfter).toHaveLength(0);
  });

  // Explicit ids stick around through unmount so queued listeners
  // registered via `useSplitGrid(id)` survive a v-if remount under the
  // same id. The contrast with auto-id cleanup above.
  it('explicit-id handle is preserved in the registry on unmount', async () => {
    const wrapper = mount(SplitGridView, {
      props: { id: 'sticky', direction: PanelDirection.Row, children: [{ id: 'a' }] },
      attachTo: document.body,
    });

    await nextTick();
    await nextTick();

    expect(registry.has('sticky')).toBe(true);

    wrapper.unmount();
    await nextTick();

    expect(registry.has('sticky')).toBe(true);
  });
});

describe('mutually-exclusive children sources', () => {
  it('throws when both :children prop and declarative slots are provided', () => {
    const Parent = defineComponent({
      components: { SplitGridView, SplitPanel },
      template: `
        <SplitGridView id="x" direction="row" :children="[{ id: 'fromProp' }]">
          <SplitPanel panel-id="fromSlot" />
        </SplitGridView>
      `,
    });

    expect(() => mount(Parent, { attachTo: document.body })).toThrow(/children/i);
  });

  it('accepts :children alone', async () => {
    const wrapper = mount(SplitGridView, {
      props: { id: 'cp', direction: PanelDirection.Row, children: [{ id: 'a' }, { id: 'b' }] },
      attachTo: document.body,
    });

    await nextTick();
    await nextTick();

    expect(useSplitGrid('cp').instance?.get('a')).toBeTruthy();
    expect(useSplitGrid('cp').instance?.get('b')).toBeTruthy();
    wrapper.unmount();
  });

  it('accepts declarative slots alone', async () => {
    const Parent = defineComponent({
      components: { SplitGridView, SplitPanel },
      template: `
        <SplitGridView id="sd" direction="row">
          <SplitPanel panel-id="a" />
          <SplitPanel panel-id="b" />
        </SplitGridView>
      `,
    });

    const wrapper = mount(Parent, { attachTo: document.body });

    await nextTick();
    await nextTick();

    expect(useSplitGrid('sd').instance?.get('a')).toBeTruthy();
    expect(useSplitGrid('sd').instance?.get('b')).toBeTruthy();
    wrapper.unmount();
  });
});
