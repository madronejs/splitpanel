// @vitest-environment happy-dom
/**
 * Tests for the declarative <SplitPanel> / <SplitContainer> components.
 * They register with their enclosing container's child-registry via inject:
 * during initial setup they push into a pendingChildren array (consumed when
 * the grid is built in onMounted); after mount they call addChild directly.
 * Unmount calls removeChild.
 *
 * Slot content from <SplitPanel>'s default slot is teleported into the leaf
 * element the SplitGrid runtime creates, so v-for can move panel content
 * dynamically and the layout follows.
 */
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { mount } from '@vue/test-utils';
import {
  defineComponent, nextTick, onBeforeUnmount, ref,
} from 'vue';
import SplitGridView from '../SplitGridView.vue';
import SplitPanel from '../SplitPanel.vue';
import SplitContainer from '../SplitContainer.vue';
import { registry } from '../handle';
import { PanelDirection } from '../../types';

beforeEach(() => {
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 400, width: 800, height: 400, toJSON: () => ({}),
  } as DOMRect));
});

afterEach(() => {
  document.body.innerHTML = '';

  // Tests share id="root" — drop the registry handle so the next test
  // starts clean (no carry-over queued listeners or stale handles).
  for (const id of registry.keys()) registry.delete(id);
});

function ids(): string[] {
  return [...document.body.querySelectorAll('.sp-panel')]
    .map((el) => (el as HTMLElement).dataset.id ?? '');
}

describe('<SplitPanel>: declarative initial mount', () => {
  it('builds the tree from declarative children in template order', async () => {
    const Parent = defineComponent({
      components: { SplitGridView, SplitPanel },
      data: () => ({}),
      template: `
        <SplitGridView id="root" direction="row">
          <SplitPanel panel-id="a" />
          <SplitPanel panel-id="b" />
          <SplitPanel panel-id="c" />
        </SplitGridView>
      `,
    });

    mount(Parent, { attachTo: document.body });
    await nextTick();
    await nextTick();

    expect(ids()).toEqual(['a', 'b', 'c']);
  });

  it('threads bounds props (size/min/max) through to the leaf', async () => {
    let captured: { id: string, bounds: { size: string, min: string, max: string } } | null = null;
    const Parent = defineComponent({
      components: { SplitGridView, SplitPanel },
      data: () => ({}),
      methods: {
        capture(grid: { get: (id: string) => unknown }) {
          const a = grid.get('a') as { node: { id: string, bounds: { size: string, min: string, max: string } } };

          captured = { id: a.node.id, bounds: a.node.bounds };
        },
      },
      template: `
        <SplitGridView id="root" direction="row" @ready="capture">
          <SplitPanel panel-id="a" size="240px" min="160px" max="400px" />
          <SplitPanel panel-id="b" />
        </SplitGridView>
      `,
    });

    mount(Parent, { attachTo: document.body });
    await nextTick();
    await nextTick();

    expect(captured).toMatchObject({
      id: 'a',
      bounds: { size: '240px', min: '160px', max: '400px' },
    });
  });
});

describe('<SplitContainer>: nested declarative tree', () => {
  it('declares a nested container with its own children', async () => {
    let captured: { id: string, direction: string, childIds: string[] } | null = null;
    const Parent = defineComponent({
      components: { SplitGridView, SplitPanel, SplitContainer },
      data: () => ({}),
      methods: {
        capture(grid: { get: (id: string) => unknown }) {
          const m = grid.get('middle') as { node: { id: string, direction: string, children: Array<{ id: string }> } };

          captured = {
            id: m.node.id,
            direction: m.node.direction,
            childIds: m.node.children.map((c) => c.id),
          };
        },
      },
      template: `
        <SplitGridView id="root" direction="row" @ready="capture">
          <SplitPanel panel-id="sidebar" />
          <SplitContainer panel-id="middle" direction="column">
            <SplitPanel panel-id="editor" />
            <SplitPanel panel-id="console" />
          </SplitContainer>
          <SplitPanel panel-id="inspector" />
        </SplitGridView>
      `,
    });

    mount(Parent, { attachTo: document.body });

    await nextTick();
    await nextTick();

    // 4 leaves total. Root container has 3 children: sidebar, middle, inspector.
    expect(ids()).toEqual(['sidebar', 'editor', 'console', 'inspector']);
    expect(captured).toMatchObject({
      id: 'middle',
      direction: PanelDirection.Column,
      childIds: ['editor', 'console'],
    });
  });
});

describe('<SplitPanel>: dynamic v-for', () => {
  it('adds panels when the v-for source grows', async () => {
    const items = ref([{ id: 'a' }, { id: 'b' }]);
    const Parent = defineComponent({
      components: { SplitGridView, SplitPanel },
      setup: () => ({ items }),
      template: `
        <SplitGridView id="root" direction="row">
          <SplitPanel v-for="it in items" :key="it.id" :panel-id="it.id" />
        </SplitGridView>
      `,
    });

    mount(Parent, { attachTo: document.body });
    await nextTick();
    await nextTick();
    expect(ids()).toEqual(['a', 'b']);

    items.value.push({ id: 'c' });
    await nextTick();
    await nextTick();
    expect(ids()).toEqual(['a', 'b', 'c']);
  });

  it('removes panels when the v-for source shrinks', async () => {
    const items = ref([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const Parent = defineComponent({
      components: { SplitGridView, SplitPanel },
      setup: () => ({ items }),
      template: `
        <SplitGridView id="root" direction="row">
          <SplitPanel v-for="it in items" :key="it.id" :panel-id="it.id" />
        </SplitGridView>
      `,
    });

    mount(Parent, { attachTo: document.body });
    await nextTick();
    await nextTick();
    expect(ids()).toEqual(['a', 'b', 'c']);

    items.value = items.value.filter((entry) => entry.id !== 'b');
    await nextTick();
    await nextTick();
    expect(ids()).toEqual(['a', 'c']);
  });
});

describe('<SplitPanel>: slot content teleports into the leaf', () => {
  it('renders the default slot inside the panel element', async () => {
    const Parent = defineComponent({
      components: { SplitGridView, SplitPanel },
      data: () => ({}),
      template: `
        <SplitGridView id="root" direction="row">
          <SplitPanel panel-id="a">
            <span data-test="a-content">hello A</span>
          </SplitPanel>
          <SplitPanel panel-id="b">
            <span data-test="b-content">hello B</span>
          </SplitPanel>
        </SplitGridView>
      `,
    });

    mount(Parent, { attachTo: document.body });
    await nextTick();
    await nextTick();

    const aPanel = document.querySelector('.sp-panel[data-id="a"]') as HTMLElement;
    const bPanel = document.querySelector('.sp-panel[data-id="b"]') as HTMLElement;

    expect(aPanel.querySelector('[data-test="a-content"]')?.textContent).toBe('hello A');
    expect(bPanel.querySelector('[data-test="b-content"]')?.textContent).toBe('hello B');
  });
});

describe('auto-generated ids', () => {
  it('<SplitPanel> without an `id` prop gets a stable per-instance id', async () => {
    const Parent = defineComponent({
      components: { SplitGridView, SplitPanel },
      data: () => ({}),
      template: `
        <SplitGridView id="root" direction="row">
          <SplitPanel />
          <SplitPanel />
          <SplitPanel />
        </SplitGridView>
      `,
    });

    mount(Parent, { attachTo: document.body });
    await nextTick();
    await nextTick();

    const panelIds = ids();

    expect(panelIds).toHaveLength(3);
    // All ids should be defined, non-empty, and unique.
    expect(panelIds.every((id) => id && id.length > 0)).toBe(true);
    expect(new Set(panelIds).size).toBe(3);
  });

  it('<SplitContainer> without an `id` prop also auto-generates', async () => {
    let containerIds: string[] = [];
    const Parent = defineComponent({
      components: { SplitGridView, SplitPanel, SplitContainer },
      data: () => ({}),
      methods: {
        capture(grid: { get: (id: string) => unknown }) {
          // Walk the root, collect direct-child container ids.
          const root = grid.get('root') as { node: { children: Array<{ id: string, children?: unknown }> } };

          containerIds = root.node.children
            .filter((c) => 'children' in c)
            .map((c) => c.id);
        },
      },
      template: `
        <SplitGridView id="root" direction="row" @ready="capture">
          <SplitContainer direction="column">
            <SplitPanel />
            <SplitPanel />
          </SplitContainer>
        </SplitGridView>
      `,
    });

    mount(Parent, { attachTo: document.body });
    await nextTick();
    await nextTick();

    expect(containerIds).toHaveLength(1);
    expect(containerIds[0].length).toBeGreaterThan(0);
  });

  it('explicit `id` prop takes precedence over the auto value', async () => {
    const Parent = defineComponent({
      components: { SplitGridView, SplitPanel },
      data: () => ({}),
      template: `
        <SplitGridView id="root" direction="row">
          <SplitPanel panel-id="explicit-a" />
          <SplitPanel />
        </SplitGridView>
      `,
    });

    mount(Parent, { attachTo: document.body });
    await nextTick();
    await nextTick();

    const panelIds = ids();

    expect(panelIds).toContain('explicit-a');
    expect(panelIds).toHaveLength(2);
  });
});

describe('reactive props', () => {
  // Shared parent factory: captures the grid instance from @ready so tests
  // can read node state without dancing through `findComponent(...).vm`,
  // which doesn't auto-unwrap defineExpose refs the same way.
  type GridLike = { get: (id: string) => { node: Record<string, unknown> } | undefined };

  function makeParent(template: string, extras: Record<string, unknown>) {
    const captured: { grid: GridLike | null } = { grid: null };
    const Parent = defineComponent({
      components: { SplitGridView, SplitPanel, SplitContainer },
      setup: () => ({ ...extras }),
      methods: {
        onReady(grid: GridLike) {
          captured.grid = grid;
        },
      },
      template: `<SplitGridView id="root" direction="row" @ready="onReady">${template}</SplitGridView>`,
    });

    return { Parent, captured };
  }

  it('<SplitPanel> :data updates propagate to setData when the ref is swapped', async () => {
    // Use a stable ref for the whole data object — the watcher is shallow,
    // so the consumer must swap references rather than mutating in place
    // (and definitely never `:data="{ inline: literal }"`, which creates a
    // fresh object every render and infinite-loops).
    const tabData = ref({ label: 'initial' });
    const { Parent, captured } = makeParent(
      '<SplitPanel panel-id="a" :data="tabData" /><SplitPanel panel-id="b" />',
      { tabData },
    );

    mount(Parent, { attachTo: document.body });
    await nextTick();
    await nextTick();

    expect((captured.grid!.get('a')!.node as { data: { label: string } }).data.label).toBe('initial');

    tabData.value = { label: 'changed' };
    await nextTick();
    expect((captured.grid!.get('a')!.node as { data: { label: string } }).data.label).toBe('changed');
  });

  it('<SplitPanel> :size update propagates to setBounds', async () => {
    const size = ref('20%');
    const { Parent, captured } = makeParent(
      '<SplitPanel panel-id="a" :size="size" /><SplitPanel panel-id="b" />',
      { size },
    );

    mount(Parent, { attachTo: document.body });
    await nextTick();
    await nextTick();

    const aBounds = (captured.grid!.get('a')!.node as { bounds?: { size?: string } }).bounds;

    expect(aBounds?.size).toBe('20%');

    size.value = '40%';
    await nextTick();

    const aAfter = (captured.grid!.get('a')!.node as { bounds?: { size?: string } }).bounds;

    expect(aAfter?.size).toBe('40%');
  });

  it('<SplitPanel> :min and :max update propagate as bound changes', async () => {
    const min = ref('40px');
    const max = ref<string | undefined>(undefined);
    const { Parent, captured } = makeParent(
      '<SplitPanel panel-id="a" :min="min" :max="max" /><SplitPanel panel-id="b" />',
      { min, max },
    );

    mount(Parent, { attachTo: document.body });
    await nextTick();
    await nextTick();

    const before = (captured.grid!.get('a')!.node as { bounds?: { min?: string, max?: string } }).bounds;

    expect(before?.min).toBe('40px');
    expect(before?.max).toBeUndefined();

    min.value = '120px';
    max.value = '300px';
    await nextTick();

    const after = (captured.grid!.get('a')!.node as { bounds?: { min?: string, max?: string } }).bounds;

    expect(after?.min).toBe('120px');
    expect(after?.max).toBe('300px');
  });

  it('<SplitContainer> :direction update propagates to setDirection', async () => {
    const direction = ref<PanelDirection>(PanelDirection.Column);
    const { Parent, captured } = makeParent(
      `<SplitContainer panel-id="c" :direction="direction">
        <SplitPanel panel-id="x" />
        <SplitPanel panel-id="y" />
      </SplitContainer>`,
      { direction },
    );

    mount(Parent, { attachTo: document.body });
    await nextTick();
    await nextTick();

    expect((captured.grid!.get('c')!.node as { direction: string }).direction).toBe('column');

    direction.value = PanelDirection.Row;
    await nextTick();
    expect((captured.grid!.get('c')!.node as { direction: string }).direction).toBe('row');
  });
});

describe('boundary errors', () => {
  it('<SplitPanel> outside a <SplitGridView> throws a useful error', () => {
    const Bad = defineComponent({
      components: { SplitPanel },
      template: '<SplitPanel panel-id="x" />',
    });

    expect(() => mount(Bad)).toThrow(/SplitGridView/);
  });
});

describe('<SplitPanel> per-panel #resizer slot', () => {
  it('teleports per-panel #resizer slot into the leading divider', async () => {
    const Parent = defineComponent({
      components: { SplitGridView, SplitPanel },
      setup: () => ({}),
      template: `
        <SplitGridView id="root" direction="row">
          <SplitPanel panel-id="a">A</SplitPanel>
          <SplitPanel panel-id="b">
            B
            <template #resizer>
              <span class="my-divider-before-b">handle</span>
            </template>
          </SplitPanel>
        </SplitGridView>
      `,
    });

    mount(Parent, { attachTo: document.body });
    await nextTick();
    await nextTick();

    // The slot mounted into the resizer between A and B — i.e., B's leading.
    const divider = document.querySelector('.sp-container > .sp-resizer') as HTMLElement;

    expect(divider).toBeTruthy();
    expect(divider.querySelector('.my-divider-before-b')).toBeTruthy();
  });

  it('only renders for panels that actually have a leading divider (not the first child)', async () => {
    const Parent = defineComponent({
      components: { SplitGridView, SplitPanel },
      template: `
        <SplitGridView id="root" direction="row">
          <SplitPanel panel-id="a">A<template #resizer><span class="r-a">a-r</span></template></SplitPanel>
          <SplitPanel panel-id="b">B<template #resizer><span class="r-b">b-r</span></template></SplitPanel>
        </SplitGridView>
      `,
    });

    mount(Parent, { attachTo: document.body });
    await nextTick();
    await nextTick();

    // A is the first child so its #resizer slot has no leading target
    // (resizer.first not enabled). B has a leading divider (the A|B inner).
    expect(document.querySelector('.r-a')).toBeNull();
    expect(document.querySelector('.r-b')).toBeTruthy();
  });

  it('first child claims the resizer.first edge as its leading divider', async () => {
    const Parent = defineComponent({
      components: { SplitGridView, SplitPanel },
      template: `
        <SplitGridView id="root" direction="row" :resizer="{ first: true }">
          <SplitPanel panel-id="a">A<template #resizer><span class="r-a">a-r</span></template></SplitPanel>
          <SplitPanel panel-id="b">B</SplitPanel>
        </SplitGridView>
      `,
    });

    mount(Parent, { attachTo: document.body });
    await nextTick();
    await nextTick();

    // A's leading is the decorative leading edge (handleIdx -1) introduced
    // by resizer.first. Slot teleports into it.
    const edge = document.querySelector('.sp-resizer[data-edge="leading"]') as HTMLElement;

    expect(edge).toBeTruthy();
    expect(edge.querySelector('.r-a')).toBeTruthy();
  });

  it('wrapper-level #resizer falls back when the panel has no #resizer slot', async () => {
    const Parent = defineComponent({
      components: { SplitGridView, SplitPanel },
      template: `
        <SplitGridView id="root" direction="row">
          <template #resizer>
            <span class="wrapper-divider">wrapper</span>
          </template>
          <SplitPanel panel-id="a">A</SplitPanel>
          <SplitPanel panel-id="b">B</SplitPanel>
        </SplitGridView>
      `,
    });

    mount(Parent, { attachTo: document.body });
    await nextTick();
    await nextTick();

    // Neither panel claimed the divider — wrapper-level slot won.
    expect(document.querySelectorAll('.wrapper-divider')).toHaveLength(1);
  });

  it('per-panel slot takes precedence over the wrapper-level slot for the same divider', async () => {
    const Parent = defineComponent({
      components: { SplitGridView, SplitPanel },
      template: `
        <SplitGridView id="root" direction="row">
          <template #resizer><span class="wrapper-r">wrapper</span></template>
          <SplitPanel panel-id="a">A</SplitPanel>
          <SplitPanel panel-id="b">B<template #resizer><span class="panel-r">panel</span></template></SplitPanel>
        </SplitGridView>
      `,
    });

    mount(Parent, { attachTo: document.body });
    await nextTick();
    await nextTick();

    // B's leading divider (the A|B inner) is owned by B — only the panel
    // slot renders. The wrapper has no other divider to render into.
    expect(document.querySelector('.panel-r')).toBeTruthy();
    expect(document.querySelector('.wrapper-r')).toBeNull();
  });

  it('releases ownership on unmount so the wrapper slot can reclaim it', async () => {
    const showB = ref(true);
    const Parent = defineComponent({
      components: { SplitGridView, SplitPanel },
      setup: () => ({ showB }),
      template: `
        <SplitGridView id="root" direction="row">
          <template #resizer><span class="wrapper-r">wrapper</span></template>
          <SplitPanel panel-id="a">A</SplitPanel>
          <SplitPanel v-if="showB" panel-id="b">B<template #resizer><span class="panel-r">panel</span></template></SplitPanel>
          <SplitPanel panel-id="c">C</SplitPanel>
        </SplitGridView>
      `,
    });

    mount(Parent, { attachTo: document.body });
    await nextTick();
    await nextTick();

    // Initially three children: dividers A|B and B|C. B owns its leading
    // (A|B); C's leading (B|C) falls back to the wrapper.
    expect(document.querySelectorAll('.panel-r')).toHaveLength(1);
    expect(document.querySelectorAll('.wrapper-r')).toHaveLength(1);

    // Remove B — its owned divider goes with it; the remaining A|C
    // divider now has the wrapper slot mounted.
    showB.value = false;
    await nextTick();
    await nextTick();
    expect(document.querySelectorAll('.panel-r')).toHaveLength(0);
    expect(document.querySelectorAll('.wrapper-r')).toHaveLength(1);
  });
});

describe('SplitGridView unmount lifecycle', () => {
  // Regression: third-party leaf children (e.g. video players) frequently
  // touch the document inside their own beforeUnmount hook — to look up the
  // host element by id, or to read parentNode for teardown. If the wrapper
  // detaches its DOM before the child's hook runs, those lookups fail with
  // errors like "Cannot find element with id …" or null.parentNode.
  // The contract: teleported leaf content stays attached to the document
  // until after its beforeUnmount runs.
  it('teleported leaf content stays in the document during its beforeUnmount', async () => {
    const captured = { inDoc: false, parentNode: null as ParentNode | null };
    const Child = defineComponent({
      template: '<div class="leaf-child" data-test="leaf-child" />',
      setup() {
        onBeforeUnmount(() => {
          const el = document.querySelector('.leaf-child') as HTMLElement | null;

          captured.inDoc = !!el && document.body.contains(el);
          captured.parentNode = el?.parentNode ?? null;
        });
      },
    });
    const show = ref(true);
    const Parent = defineComponent({
      components: { SplitGridView, SplitPanel, Child },
      setup: () => ({ show }),
      template: `
        <SplitGridView v-if="show" id="root" direction="row">
          <SplitPanel panel-id="p"><Child /></SplitPanel>
        </SplitGridView>
      `,
    });

    mount(Parent, { attachTo: document.body });
    await nextTick();
    await nextTick();

    show.value = false;
    await nextTick();
    await nextTick();

    expect(captured.inDoc).toBe(true);
    expect(captured.parentNode).not.toBeNull();
  });
});
