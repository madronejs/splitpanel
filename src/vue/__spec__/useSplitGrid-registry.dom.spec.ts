// @vitest-environment happy-dom
/**
 * Tier-2 registry behavior: useSplitGrid('id') called BEFORE the wrapper
 * exists must return a handle, queue any listeners registered against it,
 * and replay them once the wrapper mounts under the same id.
 *
 * Mirrors the vue-flow pattern where a parent's setup wires up `onChange`
 * before the child renderer mounts.
 */
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
import SplitGridView from '../SplitGridView.vue';
import SplitPanel from '../SplitPanel.vue';
import { useSplitGrid } from '../composables';
import { registry } from '../handle';

beforeEach(() => {
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 400, width: 800, height: 400, toJSON: () => ({}),
  } as DOMRect));
});

afterEach(() => {
  document.body.innerHTML = '';

  for (const id of registry.keys()) registry.delete(id);
});

describe('useSplitGrid(id) — pre-mount lookup', () => {
  it('returns a handle even when no wrapper has claimed the id yet', () => {
    let captured: ReturnType<typeof useSplitGrid> | null = null;
    const Outer = defineComponent({
      setup() {
        captured = useSplitGrid('main');
        // eslint-disable-next-line unicorn/consistent-function-scoping
        return () => null;
      },
    });

    mount(Outer);
    expect(captured).toBeTruthy();
    expect(captured!.id).toBe('main');
    expect(captured!.isReady.value).toBe(false);
  });

  it('queued onChange fires when the wrapper mounts under the same id', async () => {
    const onChange = vi.fn();
    const Parent = defineComponent({
      components: { SplitGridView, SplitPanel },
      setup() {
        const grid = useSplitGrid('main');

        grid.onChange(onChange);
        return {};
      },
      template: `
        <SplitGridView id="main" direction="row">
          <SplitPanel panel-id="a" />
          <SplitPanel panel-id="b" />
        </SplitGridView>
      `,
    });

    const wrapper = mount(Parent, { attachTo: document.body });

    await nextTick();
    await nextTick();

    // No size has been mutated yet — onChange has fired 0 times for sure.
    onChange.mockClear();

    // Now mutate the layout via the same handle.
    const handle = useSplitGrid('main');

    handle.setSize('a', '60%');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ reason: 'set-size' }));

    wrapper.unmount();
  });

  it('onReady fires once the wrapper mounts', async () => {
    // `mount()` runs the full mount cycle synchronously — including the
    // wrapper's onMounted which attaches the handle and drains queued
    // onReady callbacks. So by the time mount() returns, ready has
    // already fired exactly once.
    const ready = vi.fn();
    const Parent = defineComponent({
      components: { SplitGridView, SplitPanel },
      setup() {
        useSplitGrid('rdy').onReady(ready);
        return {};
      },
      template: `
        <SplitGridView id="rdy" direction="row">
          <SplitPanel panel-id="a" />
        </SplitGridView>
      `,
    });

    mount(Parent, { attachTo: document.body });
    expect(ready).toHaveBeenCalledTimes(1);
    expect(ready.mock.calls[0][0]).toBeTruthy(); // the SplitGrid instance
  });

  it('same id returns the same handle object across calls', () => {
    const Outer = defineComponent({
      setup() {
        const a = useSplitGrid('shared');
        const b = useSplitGrid('shared');

        expect(a).toBe(b);
        // eslint-disable-next-line unicorn/consistent-function-scoping
        return () => null;
      },
    });

    mount(Outer);
  });

  it('detach (wrapper unmount) does not drop queued listeners — re-mount re-attaches', async () => {
    const onChange = vi.fn();
    const Parent = defineComponent({
      components: { SplitGridView, SplitPanel },
      props: { mounted: Boolean },
      setup() {
        const grid = useSplitGrid('toggled');

        grid.onChange(onChange);
        return {};
      },
      template: `
        <div>
          <SplitGridView v-if="mounted" id="toggled" direction="row">
            <SplitPanel panel-id="a" />
            <SplitPanel panel-id="b" />
          </SplitGridView>
        </div>
      `,
    });

    const wrapper = mount(Parent, {
      props: { mounted: true },
      attachTo: document.body,
    });

    await nextTick();
    await nextTick();
    onChange.mockClear();

    useSplitGrid('toggled').setSize('a', '40%');
    expect(onChange).toHaveBeenCalledTimes(1);

    // Unmount the child — handle survives in the registry, listener stays.
    await wrapper.setProps({ mounted: false });
    expect(useSplitGrid('toggled').isReady.value).toBe(false);

    // Remount — same id, same handle picks up.
    await wrapper.setProps({ mounted: true });
    await nextTick();
    await nextTick();
    expect(useSplitGrid('toggled').isReady.value).toBe(true);

    useSplitGrid('toggled').setSize('a', '70%');
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe('useSplitGrid(): no id, no wrapper in scope', () => {
  it('throws if called outside a wrapper and without an id', () => {
    const Bad = defineComponent({
      setup() {
        useSplitGrid();
        // eslint-disable-next-line unicorn/consistent-function-scoping
        return () => null;
      },
    });

    expect(() => mount(Bad)).toThrow(/SplitGridView/);
  });
});

describe('Duplicate <SplitGridView id="x"> mounts throw', () => {
  it('mounting two wrappers with the same id throws on the second mount', async () => {
    const Parent = defineComponent({
      components: { SplitGridView, SplitPanel },
      template: `
        <div>
          <SplitGridView id="dup" direction="row">
            <SplitPanel panel-id="a" />
          </SplitGridView>
          <SplitGridView id="dup" direction="row">
            <SplitPanel panel-id="b" />
          </SplitGridView>
        </div>
      `,
    });

    expect(() => mount(Parent, { attachTo: document.body })).toThrow(/already/i);
  });
});
