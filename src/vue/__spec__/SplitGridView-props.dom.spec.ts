// @vitest-environment happy-dom
/**
 * Flat-props contract for <SplitGridView>:
 *   - id is required and one-shot (becomes both registry key + root id).
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
