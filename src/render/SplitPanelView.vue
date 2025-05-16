<script setup lang="ts">
import { provide, watch } from 'vue';
import SplitPanel from '@/core/SplitPanel';
import configureAnimate from '@/plugins/animate';
import configureDraggable from '@/plugins/draggable';
import { SplitPanelViewSlots, SplitPanelViewProps } from './interfaces';
import SplitPanelBase from './SplitPanelBase.vue';

const props = defineProps<SplitPanelViewProps>();
const slots = defineSlots<SplitPanelViewSlots>();
const splitPanel = SplitPanel.create({
  resizeElSize: props.resizeElSize,
  showFirstResizeEl: props.showFirstResizeEl,
});

provide('splitPanel', splitPanel);

splitPanel.setAnimateStrategy(props.animateStrategy ?? configureAnimate());
splitPanel.setDraggableStrategy(props.draggableStrategy ?? configureDraggable({
  dragSelector: '.drag-handle',
  canDrag: () => true,
  onDrop: (data) => {
    if (data?.panel) {
      const { target, panel } = data;
      target.moveData(panel);
    }
  },
  ghostAnchor: () => ({ x: 0.5, y: 0.5 }),
}));

watch(() => props.showFirstResizeEl, (newVal) => {
  splitPanel.setShowFirstResizeEl(newVal);
}, { immediate: true });

watch(() => props.direction, (newVal) => {
  if (newVal) {
    splitPanel.setDirection(newVal);
  }
}, { immediate: true });
</script>

<template>
  <SplitPanelBase :split-panel="splitPanel">
    <template v-if="slots.resize" #resize="scope">
      <slot
        name="resize"
        v-bind="scope"
      />
    </template>
    <template v-if="slots.ghost" #ghost="scope">
      <slot
        name="ghost"
        v-bind="scope"
      />
    </template>
    <template v-if="slots.dropZone" #dropZone="scope">
      <slot
        name="dropZone"
        v-bind="scope"
      />
    </template>
    <template #content="scope">
      <slot
        name="default"
        v-bind="scope"
      />
    </template>
  </SplitPanelBase>
</template>
