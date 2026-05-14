<script setup lang="ts">
/**
 * Custom resizer using the Vue wrapper's `#resizer` scoped slot.
 *
 * Demonstrates two things in one example:
 *   1. The slot — Vue template content teleported into each resizer element,
 *      with reactive access to the adjacent panels' definitions.
 *   2. A wider-than-default resizer track (`size: 28`) so there's visual room
 *      for a richer drag handle.
 *
 * The slot scope is `{ resizer: ResizerState }`. Here we use
 * `resizer.before` / `resizer.after` to render the ids of the panels the
 * handle sits between, and a chevron pair as the grip glyph. The whole
 * element is the drag surface — children inherit the cursor and pointer
 * behavior from SplitGrid's resizer wiring.
 */
import { SplitGridView } from '../src/vue';
import type { Node } from '../src/types';

interface Data { label: string }

const children: Array<Node<Data>> = [
  { id: 'docs', data: { label: 'Documentation' }, bounds: { size: '25%', min: '160px' } },
  { id: 'preview', data: { label: 'Live preview' }, bounds: { min: '200px' } },
  { id: 'meta', data: { label: 'Metadata' }, bounds: { size: '20%', min: '140px' } },
];
</script>

<template>
  <SplitGridView id="vr-root" direction="row" :children="children" :resizer="{ size: 28 }">
    <template #leaf="{ panel }">
      <div class="vr-panel">
        <span class="vr-panel__id">{{ panel.id }}</span>
        <span class="vr-panel__label">{{ panel.data?.label }}</span>
      </div>
    </template>
    <template #resizer="{ resizer }">
      <div class="vr-resizer">
        <span class="vr-resizer__side">{{ resizer.before.id }}</span>
        <span class="vr-resizer__grip" aria-hidden="true">⇔</span>
        <span class="vr-resizer__side">{{ resizer.after.id }}</span>
      </div>
    </template>
  </SplitGridView>
</template>

<style>
.vr-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: #fbfbfd;
}
.vr-panel__id {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #97a0b3;
}
.vr-panel__label {
  font-weight: 600;
  font-size: 14px;
  color: #1a202c;
}

/*
  The host of the slot (`.sp-resizer`) is the grid track itself, so this
  fills its full width/height. The wrapper's CSS still owns the cursor
  (col-resize / row-resize) and the dragging affordance.
*/
.vr-resizer {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: linear-gradient(180deg, #2d3a52 0%, #1e2738 100%);
  color: #cbd3e3;
  font-size: 10px;
  letter-spacing: 0.04em;
  pointer-events: none; /* drag goes through to the resizer; nothing here is clickable */
  user-select: none;
}
.vr-resizer__side {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-variant: small-caps;
  color: #8a93a8;
}
.vr-resizer__grip {
  font-size: 16px;
  color: #fff;
  opacity: 0.85;
}

/* Light up the gradient while a drag is in progress. */
.sp-container[data-dragging] .vr-resizer {
  background: linear-gradient(180deg, #4f86ff 0%, #2c5cc5 100%);
  color: #ffffff;
}

/* The default grip-dots pseudo-element fights with our custom content;
   suppress it just for this example. */
.vr-resizer ~ ::before,
.sp-container > .sp-resizer:has(.vr-resizer)::before {
  content: none;
}
</style>
