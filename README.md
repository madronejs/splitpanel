# @madronejs/splitpanel

A CSS-Grid-driven split-panel runtime. Framework-free core, optional Vue 3
wrapper. No reactivity dependency, no lodash, no animation library — plain
CSS transitions do the work.

```bash
pnpm add @madronejs/splitpanel
```

Two entry points:

```ts
import { SplitGrid }       from '@madronejs/splitpanel';        // framework-free core
import { SplitGridView }   from '@madronejs/splitpanel/vue';    // Vue 3 wrapper
import                       '@madronejs/splitpanel/style';     // CSS (required)
```

The CSS import is mandatory — it ships the `.sp-container { display: grid }`
rules, the track-template wiring, drag/animation states, and the default
resize indicator. Without it you'll see flat, un-gridded panels.

---

## Quick start (Vue)

```vue
<script setup lang="ts">
import { SplitGridView, SplitPanel, SplitContainer } from '@madronejs/splitpanel/vue';
import { PanelDirection } from '@madronejs/splitpanel';
import '@madronejs/splitpanel/style';
</script>

<template>
  <SplitGridView :root="{ id: 'app', direction: PanelDirection.Row }">
    <SplitPanel panel-id="sidebar" size="220px" min="160px" max="320px">
      Sidebar content
    </SplitPanel>

    <SplitContainer direction="column">
      <SplitPanel min="120px">Editor</SplitPanel>
      <SplitPanel size="30%" min="80px">Console</SplitPanel>
    </SplitContainer>
  </SplitGridView>
</template>
```

That's the whole API for the common case. `v-for` over `<SplitPanel>` to drive
the tree off your data; toggle individual panels with `v-if`; the runtime
reacts.

---

## Sizes — `size`, `min`, `max`

Each panel accepts a `LengthInput`:

| Form        | Meaning                            |
|-------------|------------------------------------|
| `120`       | pixels (numeric shorthand)         |
| `'120px'`   | pixels                             |
| `'33%'`     | percent of the container's axis    |
| `'auto'`    | flex-fill (one `1fr` share)        |

Omit `size` and the panel flex-fills (`'auto'`). `min` and `max` clamp at the
CSS level via `clamp()`/`max()` in the track template — so a percentage min
means "min N% of the full grid container, including resizer tracks", matching
how CSS resolves the same percentage natively.

Percentages and px can be mixed freely; the runtime stores sizes internally
as the appropriate unit and CSS does the resolution.

### Direction

```ts
import { PanelDirection } from '@madronejs/splitpanel';

const root = { id: 'app', direction: PanelDirection.Row };
```

`PanelDirection` is a string enum (`Row = 'row'`, `Column = 'column'`).
TypeScript callers must use the enum members — a bare `'row'` literal is
a type error at API boundaries. At runtime the values are the same plain
strings CSS Grid expects, so Vue template-string objects that can't
import the enum (`<SplitGridView :root="{ direction: 'row', ... }">`)
still work — the template compiles its expression, the runtime sees
`'row'`, CSS sees `'row'`. The enum is for TS-checked call sites; the
strings are for template scope.

Nest by putting a `<SplitContainer :direction="…">` inside a
`<SplitPanel>` slot, or — using the framework-free API — building a tree
with nested `Container` nodes.

### Declarative root: `children` is optional

The `<SplitGridView>` `root` prop is typed `ContainerInput<T>`, a permissive
variant of `Container<T>` where `children` is optional:

```vue
<SplitGridView :root="{ id: 'app', direction: PanelDirection.Row }">
  <SplitPanel panel-id="a">…</SplitPanel>
  <SplitPanel panel-id="b">…</SplitPanel>
</SplitGridView>
```

Slot children register themselves with the wrapper during setup, so you
don't need to spell out `children: []`. When using `new SplitGrid({ root })`
directly (framework-free), the stricter `Container<T>` is what the
constructor sees — `children` is required there.

---

## Gestures

| Gesture                        | Action                                            |
|--------------------------------|---------------------------------------------------|
| Drag a divider                 | Resize neighbors with push-cascade + LIFO recovery |
| Double-click a divider         | Toggle maximize/minimize on the closer-edge panel  |
| Triple-click a divider         | Equalize the parent container                      |
| Double-click `resizer.first/last` chrome | Toggle the adjacent panel                |
| Triple-click edge chrome       | Equalize                                           |

Double-click is delayed by ~250ms (`TRIPLE_CLICK_GRACE_MS` in
`SplitGrid.ts`) in case a follow-up third click is coming. The third
click cancels the pending toggle and runs equalize instead — so each
gesture produces exactly one effect.

---

## Resizer chrome (`resizer.first` / `resizer.last`)

Decorative tracks before the first child or after the last — non-draggable
"header bars" you customize via the `#resizer` slot:

```vue
<script setup lang="ts">
import { PanelDirection } from '@madronejs/splitpanel';
import { SplitGridView, SplitPanel } from '@madronejs/splitpanel/vue';

const root = {
  id: 'root',
  direction: PanelDirection.Row,
  resizer: { size: 20, first: true }, // 20px bar at the leading edge
};
</script>

<template>
  <SplitGridView :root="root">
    <template #resizer="{ resizer }">
      <div v-if="resizer.after" class="panel-header">
        {{ resizer.after.data?.title }}
      </div>
    </template>

    <SplitPanel v-for="w in widgets" :key="w.id" :panel-id="w.id" :data="w">
      …
    </SplitPanel>
  </SplitGridView>
</template>
```

`resizer.after` is the panel immediately to the right (or below) the bar;
`resizer.before` the panel to the left/above. Both are `Node` defs, so
`.data` carries whatever payload you put on the `SplitPanel`. The slot
template renders into every divider — guard with `v-if="resizer.after"` if
you only want to label one side.

### Per-panel `#resizer` slot

Alternatively, declare a `#resizer` slot on an individual `<SplitPanel>` to
teleport content into the divider on **its leading side**:

```vue
<SplitPanel panel-id="b">
  B's content
  <template #resizer>
    <span>This renders in the divider between A and B</span>
  </template>
</SplitPanel>
```

Useful when each panel "owns" the divider before it. The wrapper-level
`#resizer` slot fills any divider a panel hasn't claimed.

---

## Drag-drop reorder

Pass a `:draggable` config to enable pointer-driven reordering:

```vue
<script setup lang="ts">
import type { DraggableConfig } from '@madronejs/splitpanel';

const draggable: DraggableConfig<Tile> = {
  dragSelector: '.drag-handle',                  // only this child starts a drag
  ghostAnchor: () => ({ x: 0.5, y: 0.5 }),       // cursor at ghost center
  onDrop: ({ sourceId, targetId, grid }) => {
    grid.swapData(sourceId, targetId);           // default; you can swap, move, anything
  },
};
</script>

<SplitGridView :root="root" :draggable="draggable">
  <template #leaf="{ panel }">
    <div :class="{ dragging: panel.isDragging, target: panel.isDropTarget }">
      <span class="drag-handle">⠿</span>
      {{ panel.data?.label }}
    </div>
  </template>
</SplitGridView>
```

Three mutation primitives are available inside `onDrop`:

- `grid.swap(a, b)` — structural reorder (panel IDs move with their positions).
- `grid.swapData(a, b)` — slots stay; data flows between them.
- `grid.moveData(a, b)` — splice from source, insert at target; data shifts.

The slot-scope flags `isDragging`, `isDropTarget`, `isDropZone` let you style
both the held panel and candidate targets in real time.

---

## Programmatic API

Expose-ref into the wrapper:

```vue
<script setup lang="ts">
import { ref } from 'vue';
import type { SplitGridViewApi } from '@madronejs/splitpanel/vue';

const gridRef = ref<SplitGridViewApi<MyData> | null>(null);

function maximizeFirst() {
  gridRef.value?.maximize('first-panel-id');
}
</script>

<SplitGridView ref="gridRef" :root="…" />
```

| Method                         | Purpose                                            |
|--------------------------------|----------------------------------------------------|
| `setSize(id, size, opts?)`     | Resize one panel; siblings rebalance               |
| `setBounds(id, bounds, opts?)` | Update size/min/max + reflow                       |
| `maximize(id, opts?)`          | 100% of available space; snapshot prior layout     |
| `minimize(id, opts?)`          | 0%; clear snapshot                                 |
| `toggleMaximize(id, opts?)`    | Flip between the two                               |
| `toggleExpand(id, opts?)`      | Maximize ↔ **restore** prior layout (snapshot path) |
| `expandNext(containerId)`      | Walk the maximize state forward through children    |
| `expandPrev(containerId)`      | Walk backward                                      |
| `equalize(containerId, opts?)` | Even shares; respects mins; clears snapshots       |
| `reset(containerId, opts?)`    | Restore to the definition's `bounds.size` values   |
| `addChild`/`removeChild`/`swap`| Structural mutations                                |
| `setData`/`setDataArray`/`swapData`/`moveData` | Data-only mutations (panels stay put) |
| `setDirection(containerId)`    | Flip row ↔ column at runtime                       |
| `getSize(id)`                  | Returns `{ px, pct }` for the current track size   |
| `isMaximized(id)`              | True iff the panel is currently the snapshotted max |
| `isAtDefault(id)`              | True iff size matches `bounds.size` at definition   |
| `settle(containerId?)`         | `Promise<void>` resolving on `transitionend`        |
| `getPanelState(id)`            | Reactive `PanelState` view for parent components (see below) |
| `instance`                     | Underlying `SplitGrid` for anything not on this surface |

`LayoutOptions { animate?: boolean }` opts out of the CSS transition when
`animate: false`.

### Reading layout state from a parent component

Components that *own* a `<SplitGridView>` via a template ref can subscribe
to layout state by calling `getPanelState(id)` inside a `computed`:

```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import type { SplitGridViewApi } from '@madronejs/splitpanel/vue';

const gridRef = ref<SplitGridViewApi<MyData> | null>(null);

// Reactive view of the root container. The library updates this on every
// layout event, so the computed below re-evaluates automatically.
const rootPanel = computed(() => gridRef.value?.getPanelState('root'));

const allEqual = computed(() => {
  const sizes = rootPanel.value?.childSizes ?? [];
  if (sizes.length < 2) return true;
  const [first, ...rest] = sizes;
  return rest.every((s) => s.unit === first.unit && s.value === first.value);
});

const maxedChildId = computed(() => rootPanel.value?.maximizedChildId ?? null);
</script>
```

Inside the component tree (a child of `<SplitGridView>` or one of its
slots), use `usePanelState(id)` instead — it's the same reactive value,
plumbed via inject. `getPanelState` is the imperative-ref counterpart for
parents who can't inject.

`PanelState`'s container-only fields:

| Field                 | Type                          | Meaning                                          |
|-----------------------|-------------------------------|--------------------------------------------------|
| `childSizes`          | `Length[] \| undefined`       | Live sizes of this container's children          |
| `maximizedChildId`    | `string \| null \| undefined` | Which child (if any) is currently maximized      |

Leaf panels see `undefined` for both. The non-container fields
(`isMaximized`, `isDragging`, `data`, `size`, etc.) work the same on
leaves and containers.

---

## Layout-change events

Subscribe to every state change:

```vue
<SplitGridView :root="…" @change="onLayoutChange" />
```

```ts
function onLayoutChange(e: LayoutChangeEvent) {
  // e.containerId, e.nodeIds, e.reason ('drag' | 'set-size' | 'add-child' | …)
}
```

The same signal is available via `grid.subscribe(listener)` on the framework-free
API.

---

## Theming

Every dimension and color of the default resize indicator is exposed as a CSS
variable. Override on `.sp-container`, `.sp-resizer`, or any ancestor:

```css
.my-grid {
  /* idle indicator */
  --sp-indicator-color: rebeccapurple;
  --sp-indicator-opacity: 0.2;
  --sp-indicator-thickness: 3px;
  --sp-indicator-length: 32px;
  --sp-indicator-radius: 2px;

  /* hover / active-drag indicator */
  --sp-indicator-hover-opacity: 0.6;
  --sp-indicator-hover-thickness: 5px;
  --sp-indicator-hover-length: 56px;
  --sp-indicator-hover-radius: 3px;

  /* programmatic animation duration */
  --sp-anim-ms: 400ms;
}
```

Opt out of the indicator entirely:

```css
.my-grid .sp-resizer-handle { display: none; }
```

If you teleport content into a `#resizer` slot, the default handle hides
automatically — no opt-out needed.

---

## Framework-free use

```ts
import { SplitGrid, PanelDirection } from '@madronejs/splitpanel';
import '@madronejs/splitpanel/style';

const grid = new SplitGrid({
  root: {
    id: 'root',
    direction: PanelDirection.Row,
    resizer: { size: 6 },
    children: [
      { id: 'a', bounds: { min: '160px' } },
      { id: 'b' },
    ],
  },
  renderLeaf: ({ id, el, leaf }) => {
    el.textContent = id;                  // paint your content into the leaf
  },
  onChange: (e) => console.log(e),
});

grid.mount(document.getElementById('host')!);

grid.setSize('a', '40%');                  // animated
grid.maximize('b', { animate: false });    // instant
```

`renderLeaf` runs once per leaf at mount. You own the contents of `ctx.el`;
the runtime owns the element's size, drag, and dblclick behavior.

---

## What's NOT included

By design:

- **No reactivity dependency** in the core. The framework-free API exposes a
  plain `subscribe(listener)`; the Vue wrapper builds reactivity on top.
- **No animation library.** Plain `transition: grid-template-columns` plus a
  one-frame freeze/no-animate dance for `fr` → `pct` shape changes.
- **No icons / no theming framework.** Just CSS variables.
- **No drag-and-drop library.** The pointer-event plugin in `draggable.ts` is
  ~250 lines and ships disabled by default.

---

## See also

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — how the runtime, the freeze-frame,
  the bounds-resolution rules, and the Vue wrapper actually work.
- `demo/` — five working examples covering imperative, declarative, drag-drop,
  dynamic, and the Vue-resizer-slot patterns. `pnpm dev` to run.
