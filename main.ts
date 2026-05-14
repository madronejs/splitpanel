import { createApp } from 'vue';
import { SplitGrid, type SplitGridConfig } from './src';
import DeclarativeExample from './demo/DeclarativeExample.vue';
import DraggableExample from './demo/DraggableExample.vue';
import DynamicExample from './demo/DynamicExample.vue';
import VueResizerExample from './demo/VueResizerExample.vue';
import './src/styles.css';

type Demo = { label: string };
type DemoConfig = SplitGridConfig<Demo>;

/** Mount a SplitGrid into the element matched by `selector`. */
function mountExample(selector: string, config: DemoConfig): SplitGrid<Demo> {
  const host = document.querySelector<HTMLElement>(selector);

  if (!host) throw new Error(`No element matches ${selector}`);

  const grid = new SplitGrid<Demo>(config);

  grid.mount(host);
  return grid;
}

/** Shared leaf renderer — writes the panel's label into the cell. */
const renderLeaf: DemoConfig['renderLeaf'] = ({ data, el, id }) => {
  el.textContent = data?.label ?? id;
  el.title = 'Double-click an adjacent divider to maximize this side';
};

/** Sugar for declaring a leaf with a human-readable label. */
const leaf = (id: string, opts: { size?: string; min?: string; max?: string; note?: string } = {}) => {
  const parts = [opts.size && `size ${opts.size}`, opts.min && `min ${opts.min}`, opts.max && `max ${opts.max}`]
    .filter(Boolean)
    .join(', ');
  const label = opts.note ?? `${id}${parts ? ` (${parts})` : ''}`;
  const bounds = opts.size || opts.min || opts.max
    ? { size: opts.size as any, min: opts.min as any, max: opts.max as any }
    : undefined;

  return { id, data: { label }, bounds };
};

// 1. IDE-style layout — the canonical example, debug on.
const ide = mountExample('#example-ide', {
  debug: true,
  renderLeaf,
  root: {
    id: 'ide-root',
    direction: 'row',
    resizer: { size: 8 },
    children: [
      leaf('sidebar', { size: '240px', min: '160px', max: '400px' }),
      {
        id: 'middle',
        direction: 'column',
        resizer: { size: 8 },
        children: [
          leaf('editor', { size: 'auto', min: '120px' }),
          leaf('console', { size: '30%', min: '80px' }),
        ],
      },
      leaf('inspector', { size: '20%', min: '120px' }),
    ],
  },
});

// 2. Four auto-fill panels with no constraints.
mountExample('#example-fourfr', {
  renderLeaf,
  root: {
    id: 'four-root',
    direction: 'row',
    children: [leaf('A'), leaf('B'), leaf('C'), leaf('D')],
  },
});

// 3. Vertical layout — header / main / footer.
mountExample('#example-vertical', {
  renderLeaf,
  root: {
    id: 'vert-root',
    direction: 'column',
    children: [
      leaf('toolbar', { size: '56px', min: '40px', max: '120px' }),
      leaf('main'),
      leaf('status', { size: '32px', min: '24px', max: '64px' }),
    ],
  },
});

// 4. Deep nesting — row > column > row.
mountExample('#example-nested', {
  renderLeaf,
  root: {
    id: 'nested-root',
    direction: 'row',
    children: [
      {
        id: 'left-column',
        direction: 'column',
        bounds: { size: '280px', min: '180px' },
        children: [
          leaf('files', { min: '80px' }),
          {
            id: 'left-bottom-row',
            direction: 'row',
            bounds: { size: '40%', min: '120px' },
            children: [leaf('outline', { min: '60px' }), leaf('git', { min: '60px' })],
          },
        ],
      },
      leaf('canvas', { note: 'canvas (1fr)' }),
    ],
  },
});

// 5. Custom resizer rendering.
mountExample('#example-custom-resizer', {
  renderLeaf,
  resizer: {
    size: 16,
    render: (el) => {
      el.style.background = '#2d3748';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      el.style.color = '#fff';
      el.style.fontSize = '14px';
      // Replace the default `::before` grip dots — a real glyph reads better.
      el.textContent = '⋮';
    },
  },
  root: {
    id: 'custom-root',
    direction: 'row',
    children: [leaf('left'), leaf('right')],
  },
});

// 6. Mixed units in a single row.
mountExample('#example-mixed', {
  renderLeaf,
  root: {
    id: 'mixed-root',
    direction: 'row',
    children: [
      leaf('fixed', { size: '200px', min: '120px' }),
      leaf('flex-1', { note: 'auto (1fr)' }),
      leaf('quarter', { size: '25%', min: '120px' }),
      leaf('flex-2', { note: 'auto (1fr)' }),
    ],
  },
});

// Surface the IDE grid for devtools poking.
(globalThis as unknown as { ide: SplitGrid<Demo> }).ide = ide;

// 7. Dynamic add/remove — uses the Vue wrapper to mount its own subtree.
const dynamicMount = document.querySelector<HTMLElement>('#example-dynamic');

if (dynamicMount) createApp(DynamicExample).mount(dynamicMount);

// 8. Custom resizer via the Vue wrapper's `#resizer` scoped slot.
const resizerMount = document.querySelector<HTMLElement>('#example-vue-resizer');

if (resizerMount) createApp(VueResizerExample).mount(resizerMount);

// 9. Declarative tree — <SplitPanel> / <SplitContainer> with v-if / v-for.
const declarativeMount = document.querySelector<HTMLElement>('#example-declarative');

if (declarativeMount) createApp(DeclarativeExample).mount(declarativeMount);

// 10. Drag-drop reorder — configureDraggable, swapData on drop.
const draggableMount = document.querySelector<HTMLElement>('#example-draggable');

if (draggableMount) createApp(DraggableExample).mount(draggableMount);
