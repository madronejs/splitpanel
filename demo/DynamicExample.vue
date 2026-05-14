<script setup lang="ts">
/**
 * Dynamic add/remove + layout-command demo using the Vue wrapper.
 *
 * Top toolbar exercises addChild/removeChild for changing the tree shape.
 * Bottom toolbar exercises the layout commands (setSize, expandNext/Prev,
 * equalize, reset). Each leaf has its own close button.
 *
 * The wrapper's #leaf slot renders panel content via Vue templates, so the
 * close button is part of normal Vue reactivity — clicking it calls
 * `grid.removeChild(id)` (where `grid` is the SplitGridHandle from
 * `useSplitGrid('dyn-root')`) and Vue re-renders the toolbar's panel count.
 */
import { computed, ref } from 'vue';
import { SplitGridView, useSplitGrid } from '../src/vue';
import type { LayoutChangeEvent } from '../src';
import type { Node, PanelDirectionInput } from '../src/types';

interface Data { label: string }

const initialChildren: Array<Node<Data>> = [
  { id: 'dyn-a', data: { label: 'A' }, bounds: { min: '60px' } },
  { id: 'dyn-b', data: { label: 'B' }, bounds: { min: '60px' } },
  { id: 'dyn-c', data: { label: 'C' }, bounds: { min: '60px' } },
];

// Resolve the handle by id. This runs in setup() — BEFORE the wrapper
// mounts — so the handle starts out unattached; the wrapper claims it on
// mount and our onChange listener fires from then on.
const grid = useSplitGrid<Data>('dyn-root');
const panelCount = ref(initialChildren.length);
// Track which panel is currently considered "focused" for expandNext/Prev.
const focusedId = ref<string>(initialChildren[0].id);
// Controls whether the layout commands animate; passed as { animate } to each call.
const animate = ref(true);
const layoutOpts = () => ({ animate: animate.value });
// Most recent onChange event, surfaced in the toolbar so demo readers see
// the shape of the payload. Useful for verifying drag fires the event too.
const lastChange = ref<LayoutChangeEvent | null>(null);
const rootDirection = ref<PanelDirectionInput>('row');
let counter = panelCount.value;
const canRemoveLast = computed(() => panelCount.value > 1);

// Pre-mount onChange registration — queued on the handle, drained on
// attach. From the listener's perspective the grid "always was" running.
grid.onChange((event) => {
  lastChange.value = event;
});

function nextLabel() {
  counter += 1;
  return String.fromCodePoint(64 + counter); // 'D', 'E', ...
}

function addRow() {
  const label = nextLabel();
  const id = `dyn-${label}-${Date.now()}`;

  grid.addChild('dyn-root', {
    id,
    data: { label },
    bounds: { size: 'auto', min: '60px' },
  });
  panelCount.value += 1;
  focusedId.value = id;
}

function addColumn() {
  const stamp = Date.now();
  const top = nextLabel();
  const bot = nextLabel();

  grid.addChild('dyn-root', {
    id: `dyn-col-${stamp}`,
    direction: 'column',
    resizer: { size: 8 },
    children: [
      { id: `dyn-${top}-${stamp}`, data: { label: top }, bounds: { min: '40px' } },
      { id: `dyn-${bot}-${stamp}`, data: { label: bot }, bounds: { min: '40px' } },
    ],
  });
  panelCount.value += 2;
}

function rootChildIds(): string[] {
  const root = grid.instance?.get('dyn-root');

  return root && 'sizes' in root ? root.node.children.map((c) => c.id) : [];
}

function remove(id: string) {
  // Approximate the count change: a container's whole subtree disappears too.
  const node = grid.instance?.get(id);
  const removed = node && 'sizes' in node ? node.node.children.length + 1 : 1;

  grid.removeChild(id);
  panelCount.value -= removed;

  if (focusedId.value === id) {
    focusedId.value = rootChildIds()[0] ?? '';
  }
}

function removeLast() {
  const last = rootChildIds().at(-1);

  if (last) remove(last);
}

// ---- Layout commands ----

function shrinkFocused() {
  if (!focusedId.value) return;
  const current = grid.getSize(focusedId.value);

  if (current) grid.setSize(focusedId.value, `${Math.max(5, current.pct / 2)}%`, layoutOpts());
}

function growFocused() {
  if (!focusedId.value) return;
  const current = grid.getSize(focusedId.value);

  if (current) grid.setSize(focusedId.value, `${Math.min(90, current.pct * 1.5)}%`, layoutOpts());
}

function next() {
  const moved = grid.expandNext('dyn-root', layoutOpts());

  if (moved) focusedId.value = moved;
}

function prev() {
  const moved = grid.expandPrev('dyn-root', layoutOpts());

  if (moved) focusedId.value = moved;
}

function toggleFocused() {
  if (!focusedId.value) return;
  grid.toggleExpand(focusedId.value, layoutOpts());
}

function equalizeRoot() {
  grid.equalize('dyn-root', layoutOpts());
}

function resetRoot() {
  grid.reset('dyn-root', layoutOpts());
}

function maximizeFocused() {
  if (focusedId.value) grid.maximize(focusedId.value, layoutOpts());
}

function minimizeFocused() {
  if (focusedId.value) grid.minimize(focusedId.value, layoutOpts());
}

function nextSiblingId(id: string): string | undefined {
  const node = grid.instance?.get(id);

  if (!node || !node.parent) return undefined;
  return node.parent.node.children[node.indexInParent + 1]?.id;
}

function swapWithNext() {
  if (!focusedId.value) return;
  const sib = nextSiblingId(focusedId.value);

  if (sib) grid.swap(focusedId.value, sib);
}

function swapDataWithNext() {
  if (!focusedId.value) return;
  const sib = nextSiblingId(focusedId.value);

  if (sib) grid.swapData(focusedId.value, sib);
}

function renameFocused() {
  if (!focusedId.value) return;
  const label = window.prompt('New label?', focusedId.value);

  if (label) grid.setData(focusedId.value, { label });
}

function flipRootDirection() {
  rootDirection.value = rootDirection.value === 'row' ? 'column' : 'row';
  // The :direction prop is reactive — setting rootDirection.value alone
  // would trigger the watcher in the wrapper. Calling setDirection
  // explicitly with layoutOpts() lets us pass `animate`.
  grid.setDirection('dyn-root', rootDirection.value, layoutOpts());
}

function widenFocusedMin() {
  if (!focusedId.value) return;
  const node = grid.instance?.get(focusedId.value);
  const currentMin = node?.node.bounds?.min;
  const currentPx = typeof currentMin === 'string' && currentMin.endsWith('px')
    ? Number(currentMin.replace('px', ''))
    : 60;

  grid.setBounds(focusedId.value, { min: `${currentPx + 40}px` }, layoutOpts());
}
</script>

<template>
  <div class="dynamic-demo">
    <div class="dynamic-demo__bar">
      <button type="button" @click="addRow">+ row panel</button>
      <button type="button" @click="addColumn">+ column group</button>
      <button type="button" :disabled="!canRemoveLast" @click="removeLast">− remove last</button>
      <span class="dynamic-demo__count">{{ panelCount }} panels</span>
    </div>
    <div class="dynamic-demo__bar dynamic-demo__bar--secondary">
      <span class="dynamic-demo__label">layout commands</span>
      <button type="button" @click="prev">◀ prev</button>
      <button type="button" @click="toggleFocused">⛶ toggle</button>
      <button type="button" @click="next">next ▶</button>
      <span class="dynamic-demo__divider" />
      <button type="button" @click="shrinkFocused">− size</button>
      <button type="button" @click="growFocused">+ size</button>
      <button type="button" @click="maximizeFocused">max</button>
      <button type="button" @click="minimizeFocused">min</button>
      <span class="dynamic-demo__divider" />
      <button type="button" @click="equalizeRoot">equalize</button>
      <button type="button" @click="resetRoot">reset</button>
      <label class="dynamic-demo__check">
        <input v-model="animate" type="checkbox" />
        animate
      </label>
    </div>
    <div class="dynamic-demo__bar dynamic-demo__bar--tertiary">
      <span class="dynamic-demo__label">tree ops</span>
      <button type="button" @click="swapWithNext">swap nodes</button>
      <button type="button" @click="swapDataWithNext">swap data</button>
      <button type="button" @click="renameFocused">rename…</button>
      <span class="dynamic-demo__divider" />
      <button type="button" @click="flipRootDirection">flip direction ({{ rootDirection }})</button>
      <button type="button" @click="widenFocusedMin">min += 40px</button>
      <span class="dynamic-demo__count">
        focused: <strong>{{ focusedId || '—' }}</strong>
        &nbsp;|&nbsp; last change:
        <strong>{{ lastChange ? `${lastChange.reason} on ${lastChange.containerId}` : '—' }}</strong>
      </span>
    </div>
    <div class="dynamic-demo__stage">
      <SplitGridView
        id="dyn-root"
        :direction="rootDirection"
        :children="initialChildren"
        :resizer="{ size: 8 }"
      >
        <template #leaf="{ panel }">
          <div
            class="dyn-panel"
            :class="{
              'dyn-panel--focused': focusedId === panel.id,
              'dyn-panel--maxed': panel.isMaximized,
              'dyn-panel--at-default': panel.isAtDefault,
            }"
            @click="focusedId = panel.id"
          >
            <span class="dyn-panel__label">{{ panel.data?.label ?? panel.id }}</span>
            <span v-if="panel.isMaximized" class="dyn-panel__badge">MAX</span>
            <button class="dyn-panel__close" type="button" @click.stop="remove(panel.id)">×</button>
          </div>
        </template>
      </SplitGridView>
    </div>
  </div>
</template>

<style>
.dynamic-demo {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.dynamic-demo__bar {
  display: flex;
  gap: 8px;
  padding: 8px 10px;
  background: #f0f2f6;
  border-bottom: 1px solid #d8dde6;
  align-items: center;
  flex-wrap: wrap;
}
.dynamic-demo__bar--secondary {
  background: #e9ecf2;
}
.dynamic-demo__bar--tertiary {
  background: #e1e5ed;
}
.dynamic-demo__bar button {
  font: inherit;
  border: 1px solid #c4c9d3;
  background: #fff;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
}
.dynamic-demo__bar button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.dynamic-demo__bar button:hover:not(:disabled) {
  background: #eef1f5;
}
.dynamic-demo__divider {
  width: 1px;
  height: 20px;
  background: #c4c9d3;
  margin: 0 4px;
}
.dynamic-demo__count {
  margin-left: auto;
  color: #5a6577;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.dynamic-demo__label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #5a6577;
  margin-right: 4px;
}
.dynamic-demo__check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #2a3242;
  user-select: none;
}
.dynamic-demo__stage {
  flex: 1;
  min-height: 0;
}

.dyn-panel {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f7f8fa;
  font-weight: 600;
  color: #2a3242;
  cursor: pointer;
  user-select: none;
  transition: background 100ms;
}
.dyn-panel:hover { background: #eef1f5; }
.dyn-panel--focused {
  background: #e8f0ff;
  outline: 2px solid #4f86ff;
  outline-offset: -2px;
}
.dyn-panel--maxed { background: #fef3c7; }
.dyn-panel--at-default { color: #97a0b3; }
.dyn-panel__label {
  font-size: 18px;
}
.dyn-panel__badge {
  position: absolute;
  top: 6px;
  left: 6px;
  background: #d97706;
  color: #fff;
  font-size: 10px;
  padding: 2px 5px;
  border-radius: 3px;
  letter-spacing: 0.04em;
}
.dyn-panel__close {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.08);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}
.dyn-panel__close:hover {
  background: rgba(0, 0, 0, 0.18);
}
</style>
