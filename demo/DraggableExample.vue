<script setup lang="ts">
/**
 * Drag-drop reorder demo. Each panel carries a {label, color} payload.
 * Grabbing one by its handle and dropping on another fires `swapData`
 * (the plugin's default) — the slots stay anchored to their grid
 * positions but the data flows between them.
 *
 * Reactive flags off the slot scope:
 *   - panel.isDragging   → the panel being held
 *   - panel.isDropTarget → the panel the cursor is currently over
 *
 * The `dragSelector` config is set to `.drag-handle` so only the explicit
 * grab handle starts a drag — clicking inside the body of a panel does
 * nothing.
 */
import { SplitGridView } from '../src/vue';
import type { DraggableConfig } from '../src/draggable';
import type { Node } from '../src/types';

interface Tile { label: string, color: string }

const children: Array<Node<Tile>> = [
  { id: 'tile-a', bounds: { min: '120px' }, data: { label: 'Alpha',  color: '#f97316' } },
  { id: 'tile-b', bounds: { min: '120px' }, data: { label: 'Bravo',  color: '#0ea5e9' } },
  { id: 'tile-c', bounds: { min: '120px' }, data: { label: 'Charlie',color: '#22c55e' } },
  { id: 'tile-d', bounds: { min: '120px' }, data: { label: 'Delta',  color: '#a855f7' } },
];

const draggable: DraggableConfig<Tile> = {
  // Only the explicit grab handle initiates a drag — clicks elsewhere in
  // the panel body don't accidentally start one.
  dragSelector: '.drag-handle',
  // Top-left anchor — the cursor sits at the corner of the ghost. The
  // default is `{x: 0.5, y: 1}` (cursor at bottom-center, matching the
  // legacy plugin).
  ghostAnchor: () => ({ x: 0, y: 0 }),
  // The default onDrop already calls grid.swapData(source, target), but
  // making it explicit is good documentation for this example.
  onDrop: ({ sourceId, targetId, grid }) => grid.swapData(sourceId, targetId),
};
</script>

<template>
  <SplitGridView id="drag-root" direction="row" :children="children" :resizer="{ size: 8 }" :draggable="draggable">
    <template #leaf="{ panel }">
      <div
        class="drag-tile"
        :class="{
          'drag-tile--dragging': panel.isDragging,
          'drag-tile--target': panel.isDropTarget,
          'drag-tile--zone': panel.isDropZone,
        }"
        :style="{ background: panel.data?.color }"
      >
        <div class="drag-tile__header">
          <span class="drag-handle" title="Grab to drag" aria-label="Drag handle">⠿</span>
          <strong>{{ panel.data?.label }}</strong>
        </div>
        <p class="drag-tile__hint">
          Drop another tile here to swap data.<br>
          <small v-if="panel.isDropTarget">↓ release to swap ↓</small>
        </p>
      </div>
    </template>
  </SplitGridView>
</template>

<style>
.drag-tile {
  position: relative;
  width: 100%;
  height: 100%;
  padding: 14px 14px 16px;
  color: #fff;
  display: flex;
  flex-direction: column;
  gap: 8px;
  user-select: none;
  transition: outline 120ms, transform 120ms, opacity 120ms;
  outline: 2px solid transparent;
}
.drag-tile__header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
}
.drag-tile__hint {
  margin: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
}
.drag-handle {
  cursor: grab;
  font-size: 18px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.2);
  user-select: none;
  touch-action: none;
}
.drag-handle:active { cursor: grabbing; }

.drag-tile--dragging {
  opacity: 0.55;
  transform: scale(0.985);
}
.drag-tile--target {
  outline-color: #fff;
  outline-offset: -3px;
  filter: brightness(1.06);
}
.drag-tile--zone:not(.drag-tile--target) {
  /* Every panel that could receive a drop right now — softer cue than the
     cursor-target outline above. */
  outline-color: rgba(255, 255, 255, 0.5);
  outline-offset: -3px;
}

/* Style the ghost so it reads as a hovering preview rather than a clone
   of the source. The plugin sets position/pointer-events/z-index itself;
   everything below is pure visual polish. */
.sp-drag-ghost {
  width: 160px;
  height: 80px;
  opacity: 0.85;
  border-radius: 6px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  transform: rotate(-2deg);
  transition: none;
}
.sp-drag-ghost .drag-tile__hint { display: none; }
</style>
