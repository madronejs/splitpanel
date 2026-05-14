// @vitest-environment happy-dom
/**
 * Tests for the reactive layer that bridges SplitGrid's onChange/subscribe
 * pipe to Vue's reactivity. Covers:
 *
 *  - `useSplitGrid()`     — inject the running SplitGrid instance.
 *  - `usePanelState(id)`  — reactive per-panel state, refreshed on every
 *                           event that touches the panel.
 *  - `#leaf` and `#resizer` slot scopes — reactive `panel` / `resizer`
 *                           objects, which is the everyday path.
 *  - Boundary cases       — calling composables outside a `<SplitGridView>`
 *                           must throw a useful error rather than silently
 *                           returning undefined.
 */
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { mount } from '@vue/test-utils';
import {
  defineComponent, h, nextTick, ref,
} from 'vue';
import SplitGridView from '../SplitGridView.vue';
import { usePanelState, useSplitGrid } from '../composables';
import { registry } from '../handle';
import type { Node } from '../../types';
import { PanelDirection } from '../../types';

beforeEach(() => {
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 400, width: 800, height: 400, toJSON: () => ({}),
  } as DOMRect));
});

afterEach(() => {
  document.body.innerHTML = '';

  // Handles are durable in the registry; clear between tests so duplicate
  // ids don't clash and queued listeners from one test don't bleed into
  // the next.
  for (const id of registry.keys()) registry.delete(id);
});

// Factory not a const — grid.setData / swapData mutate `node.data` in place,
// and a shared children array would leak state between tests.
function makeChildren(): Array<Node<{ label: string }>> {
  return [
    { id: 'a', data: { label: 'A' } },
    { id: 'b', data: { label: 'B' } },
  ];
}

function mountView(slot: string) {
  return mount(SplitGridView, {
    props: { id: 'root', direction: PanelDirection.Row, children: makeChildren() },
    attachTo: document.body,
    slots: { leaf: slot },
  });
}

describe('reactive #leaf slot scope', () => {
  it('exposes id, data, isMaximized, isAtDefault on the slot prop', async () => {
    // `data-test` rather than `data-id` because SplitGrid puts `data-id` on
    // the .sp-panel wrapper too — `querySelector('[data-test="a"]')` would
    // match the wrapper, not the slot's inner div.
    // Vue 3 strips data-* attributes for boolean false, so stringify.
    mountView(
      '<div :data-test="panel.id" :data-max="String(panel.isMaximized)" :data-default="String(panel.isAtDefault)">{{ panel.data?.label }}</div>',
    );

    // Slot data lives in maps populated in onMounted; flush before reading.
    await nextTick();
    await nextTick();

    const a = document.querySelector('[data-test="a"]') as HTMLElement;

    expect(a).toBeTruthy();
    expect(a.textContent).toBe('A');
    // happy-dom's `dataset` reflection is fragile; reading the attribute
    // directly is reliable in both happy-dom and the browser.
    expect(a.dataset.max).toBe('false');
    expect(a.dataset.default).toBe('true');
  });

  it('re-renders the slot when the panel\'s data changes', async () => {
    mountView('<div :data-test="panel.id">{{ panel.data?.label }}</div>');

    await nextTick();
    await nextTick();

    useSplitGrid<{ label: string }>('root').setData('a', { label: 'AfterEdit' });
    await nextTick();

    const a = document.querySelector('[data-test="a"]') as HTMLElement;

    expect(a.textContent).toBe('AfterEdit');
  });

  it('re-renders the slot when isMaximized flips', async () => {
    mountView('<div :data-test="panel.id" :data-max="String(panel.isMaximized)">x</div>');

    await nextTick();
    await nextTick();

    const grid = useSplitGrid('root');

    grid.toggleExpand('a');
    await nextTick();
    expect((document.querySelector('[data-test="a"]') as HTMLElement).dataset.max).toBe('true');

    grid.toggleExpand('a');
    await nextTick();
    expect((document.querySelector('[data-test="a"]') as HTMLElement).dataset.max).toBe('false');
  });
});

describe('usePanelState', () => {
  it('returns a reactive ref that updates on relevant events', async () => {
    // Capture the composable's computed ref directly on a parent-owned slot,
    // bypassing the Teleport-into-leaf timing complications we'd otherwise
    // hit when fishing for DOM. Inner exposes `state` as a `data` field via
    // a render-time hook so the test can read it as a normal Vue ref.
    const captured: { state: ReturnType<typeof usePanelState<{ label: string }>> | null } = {
      state: null,
    };
    const Inner = defineComponent({
      setup() {
        captured.state = usePanelState<{ label: string }>('a');
        // eslint-disable-next-line unicorn/consistent-function-scoping
        return () => h('div');
      },
    });

    const Parent = defineComponent({
      components: { SplitGridView, Inner },
      template: `<SplitGridView id="root" direction="row" :children="children">
        <template #leaf><Inner /></template>
      </SplitGridView>`,
      data: () => ({ children: makeChildren() }),
    });

    mount(Parent, { attachTo: document.body });

    await nextTick();
    await nextTick();

    expect(captured.state).toBeTruthy();
    expect(captured.state!.value?.data?.label).toBe('A');

    useSplitGrid<{ label: string }>('root').setData('a', { label: 'AfterEdit' });
    await nextTick();
    expect(captured.state!.value!.data?.label).toBe('AfterEdit');
  });

  it('reacts to id changes when called with a Ref<string>', async () => {
    const Inner = defineComponent({
      props: { id: { type: String, required: true } },
      setup(props) {
        // Pass the prop getter directly — composable should re-resolve when it changes.
        const state = usePanelState<{ label: string }>(() => props.id);

        return () => h('div', { 'data-test': state.value?.id, 'data-label': state.value?.data?.label });
      },
    });

    const targetId = ref('a');
    const Parent = defineComponent({
      components: { SplitGridView, Inner },
      template: `
        <SplitGridView id="root" direction="row" :children="children">
          <template #leaf>
            <Inner :id="targetId" />
          </template>
        </SplitGridView>
      `,
      setup: () => ({ children: makeChildren(), targetId }),
    });

    mount(Parent, { attachTo: document.body });

    await nextTick();
    await nextTick();

    // Each <Inner> ends up rendered once per leaf via the slot, but both share
    // the same `targetId` — so each leaf's Inner queries panel `a`.
    expect(document.querySelectorAll('[data-test="a"]').length).toBeGreaterThan(0);

    targetId.value = 'b';
    await nextTick();
    expect(document.querySelectorAll('[data-test="b"]').length).toBeGreaterThan(0);
  });

  it('throws when called outside a <SplitGridView>', () => {
    const Bad = defineComponent({
      setup() {
        usePanelState('whatever');
        // eslint-disable-next-line unicorn/consistent-function-scoping
        return () => null;
      },
    });

    expect(() => mount(Bad)).toThrow(/SplitGridView/);
  });
});

// Helpers hoisted out — eslint complains about function-scoping inside describe.
function simulateDragSequence(source: HTMLElement, target: HTMLElement): void {
  source.dispatchEvent(new PointerEvent('pointerdown', {
    clientX: 100, clientY: 100, bubbles: true, button: 0,
  }));
  document.dispatchEvent(new PointerEvent('pointermove', {
    clientX: 120, clientY: 100, bubbles: true,
  }));
  target.dispatchEvent(new PointerEvent('pointermove', {
    clientX: 400, clientY: 100, bubbles: true,
  }));
  target.dispatchEvent(new PointerEvent('pointerup', {
    clientX: 400, clientY: 100, bubbles: true,
  }));
}

function twoPanelRoot(extra: Record<string, unknown>) {
  return {
    components: { SplitGridView },
    setup: () => ({
      children: [{ id: 'a' }, { id: 'b' }],
      ...extra,
    }),
  };
}

describe('draggable prop + reactive drag state', () => {
  it('the draggable prop wires up configureDraggable on mount', async () => {
    const dragConfig = { onDrop: vi.fn() };
    const Parent = defineComponent({
      ...twoPanelRoot({ dragConfig }),
      template: `<SplitGridView id="r" direction="row" :children="children" :draggable="dragConfig">
        <template #leaf="{ panel }"><div>{{ panel.id }}</div></template>
      </SplitGridView>`,
    });

    mount(Parent, { attachTo: document.body });
    await nextTick();
    await nextTick();

    simulateDragSequence(
      document.querySelector('.sp-panel[data-id="a"]') as HTMLElement,
      document.querySelector('.sp-panel[data-id="b"]') as HTMLElement,
    );
    expect(dragConfig.onDrop).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'a', targetId: 'b' }));
  });

  it('isDragging / isDropTarget are cleared after a completed drag', async () => {
    // Drag flips the flags during the gesture and clears them on release.
    // We can't reliably observe MID-drag in this synthetic-event setup
    // (Vue won't flush between dispatchEvent calls), so this asserts the
    // end-state: after pointerup, the wrapper has cleared its dragState.
    const Inner = defineComponent({
      props: { id: { type: String, required: true } },
      setup(props) {
        const s = usePanelState(() => props.id);

        return () => h('div', {
          'data-test': props.id,
          'data-dragging': String(s.value?.isDragging ?? false),
          'data-droptarget': String(s.value?.isDropTarget ?? false),
        });
      },
    });
    const Parent = defineComponent({
      ...twoPanelRoot({ draggable: { onDrop: () => {} } }),
      components: { SplitGridView, Inner },
      template: `<SplitGridView id="r" direction="row" :children="children" :draggable="draggable">
        <template #leaf="{ panel }"><Inner :id="panel.id" /></template>
      </SplitGridView>`,
    });

    mount(Parent, { attachTo: document.body });
    await nextTick();
    await nextTick();

    simulateDragSequence(
      document.querySelector('.sp-panel[data-id="a"]') as HTMLElement,
      document.querySelector('.sp-panel[data-id="b"]') as HTMLElement,
    );
    await nextTick();

    for (const id of ['a', 'b']) {
      const el = document.querySelector(`[data-test="${id}"]`) as HTMLElement;

      expect(el.dataset.dragging).toBe('false');
      expect(el.dataset.droptarget).toBe('false');
    }
  });

  it('cleans up the draggable plugin on unmount', async () => {
    const onDrop = vi.fn();
    const Parent = defineComponent({
      ...twoPanelRoot({ draggable: { onDrop } }),
      template: `<SplitGridView id="r" direction="row" :children="children" :draggable="draggable">
        <template #leaf="{ panel }"><div>{{ panel.id }}</div></template>
      </SplitGridView>`,
    });

    const wrapper = mount(Parent, { attachTo: document.body });

    await nextTick();
    await nextTick();
    wrapper.unmount();

    // No active document since the wrapper was torn down — but ensure the
    // pointerdown listener was removed by simulating a drag on a fresh
    // panel-shaped element. Should produce no calls.
    const orphan = document.createElement('div');

    orphan.className = 'sp-panel';
    orphan.dataset.id = 'orphan';
    document.body.append(orphan);
    orphan.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: 0, clientY: 0, bubbles: true, button: 0,
    }));
    expect(onDrop).not.toHaveBeenCalled();
    orphan.remove();
  });
});

describe('useSplitGrid', () => {
  it('returns the running handle via inject', async () => {
    let captured: ReturnType<typeof useSplitGrid> | null = null;
    const Inner = defineComponent({
      setup() {
        captured = useSplitGrid();
        // eslint-disable-next-line unicorn/consistent-function-scoping
        return () => null;
      },
    });
    const Parent = defineComponent({
      components: { SplitGridView, Inner },
      template: `<SplitGridView id="root" direction="row" :children="children">
        <template #leaf><Inner /></template>
      </SplitGridView>`,
      data: () => ({ children: makeChildren() }),
    });

    mount(Parent, { attachTo: document.body });

    await nextTick();
    await nextTick();
    expect(captured).toBeTruthy();
    expect(typeof captured!.setSize).toBe('function');
    expect(captured!.isReady.value).toBe(true);
  });

  it('throws when called outside a <SplitGridView> with no id', () => {
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

describe('PanelState slot-scope methods', () => {
  it('panel.setSize / .toggleExpand / .maximize / .minimize / .equalize / .reset are bound functions', async () => {
    const captured: { state: ReturnType<typeof usePanelState> | null } = { state: null };
    const Inner = defineComponent({
      setup() {
        captured.state = usePanelState('a');
        // eslint-disable-next-line unicorn/consistent-function-scoping
        return () => h('div');
      },
    });
    const Parent = defineComponent({
      components: { SplitGridView, Inner },
      template: `<SplitGridView id="root" direction="row" :children="children">
        <template #leaf><Inner /></template>
      </SplitGridView>`,
      data: () => ({ children: makeChildren() }),
    });

    mount(Parent, { attachTo: document.body });
    await nextTick();
    await nextTick();

    const p = captured.state!.value!;

    expect(typeof p.setSize).toBe('function');
    expect(typeof p.toggleExpand).toBe('function');
    expect(typeof p.maximize).toBe('function');
    expect(typeof p.minimize).toBe('function');
    expect(typeof p.equalize).toBe('function');
    expect(typeof p.reset).toBe('function');
  });

  it('panel.toggleExpand toggles maximization without needing the id', async () => {
    mountView(
      '<button :data-test="panel.id" :data-max="String(panel.isMaximized)" @click="panel.toggleExpand()">x</button>',
    );

    await nextTick();
    await nextTick();

    const a = document.querySelector('[data-test="a"]') as HTMLElement;

    expect(a.dataset.max).toBe('false');
    a.click();
    await nextTick();
    expect(a.dataset.max).toBe('true');

    // Underlying grid was actually toggled — verify via the handle too.
    expect(useSplitGrid('root').isMaximized('a')).toBe(true);
  });

  it('panel.equalize operates on the parent container (no-op on root)', async () => {
    let captured: ReturnType<typeof usePanelState> | null = null;
    const Inner = defineComponent({
      setup() {
        captured = usePanelState('a');
        // eslint-disable-next-line unicorn/consistent-function-scoping
        return () => h('div');
      },
    });
    const Parent = defineComponent({
      components: { SplitGridView, Inner },
      template: `<SplitGridView id="root" direction="row" :children="children">
        <template #leaf><Inner /></template>
      </SplitGridView>`,
      data: () => ({ children: makeChildren() }),
    });

    mount(Parent, { attachTo: document.body });

    await nextTick();
    await nextTick();

    const grid = useSplitGrid('root');

    grid.setSize('a', '500px');
    await nextTick();

    // panel.equalize should fire equalize on the parent ('root') — listen
    // via the handle for the 'change' event with reason 'equalize'.
    const events: Array<{ reason: string }> = [];

    grid.onChange((e) => events.push({ reason: e.reason }));
    captured!.value!.equalize();
    expect(events.some((e) => e.reason === 'equalize')).toBe(true);
  });
});

describe('PanelState isDropZone', () => {
  it('is false when no drag is active', async () => {
    mountView(
      '<div :data-test="panel.id" :data-zone="String(panel.isDropZone)">x</div>',
    );

    await nextTick();
    await nextTick();

    for (const id of ['a', 'b']) {
      const el = document.querySelector(`[data-test="${id}"]`) as HTMLElement;

      expect(el.dataset.zone).toBe('false');
    }
  });

  it('flips to true on non-source panels while a drag is in progress', async () => {
    const Inner = defineComponent({
      props: { id: { type: String, required: true } },
      setup(props) {
        const s = usePanelState(() => props.id);

        return () => h('div', {
          'data-test': props.id,
          'data-zone': String(s.value?.isDropZone ?? false),
          'data-dragging': String(s.value?.isDragging ?? false),
        });
      },
    });
    const Parent = defineComponent({
      ...twoPanelRoot({ draggable: { onDrop: () => {} } }),
      components: { SplitGridView, Inner },
      template: `<SplitGridView id="r" direction="row" :children="children" :draggable="draggable">
        <template #leaf="{ panel }"><Inner :id="panel.id" /></template>
      </SplitGridView>`,
    });

    mount(Parent, { attachTo: document.body });
    await nextTick();
    await nextTick();

    // Commit a drag from 'a' — pointerdown + a move past threshold. No
    // pointerup yet, so the state stays "drag-in-progress".
    const aEl = document.querySelector('.sp-panel[data-id="a"]') as HTMLElement;

    aEl.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: 100, clientY: 100, bubbles: true, button: 0,
    }));
    document.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 130, clientY: 100, bubbles: true,
    }));
    await nextTick();

    const a = document.querySelector('[data-test="a"]') as HTMLElement;
    const b = document.querySelector('[data-test="b"]') as HTMLElement;

    expect(a.dataset.dragging).toBe('true');
    // The source is not its own dropzone; every non-source panel is.
    expect(a.dataset.zone).toBe('false');
    expect(b.dataset.zone).toBe('true');

    // Clean up — pointerup so the global pointermove listener detaches.
    document.dispatchEvent(new PointerEvent('pointerup', {
      clientX: 130, clientY: 100, bubbles: true,
    }));
    await nextTick();
    expect((document.querySelector('[data-test="a"]') as HTMLElement).dataset.zone).toBe('false');
    expect((document.querySelector('[data-test="b"]') as HTMLElement).dataset.zone).toBe('false');
  });
});
