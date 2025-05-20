<script setup lang="ts" generic="T">
import { provide, shallowRef, watch, onBeforeUnmount } from 'vue';
import SplitPanel from '@/core/SplitPanel';
import configureAnimate from '@/plugins/animate';
import configureDraggable from '@/plugins/draggable';
import { ChildrenChangedEvent, SplitPanelViewSlots, SplitPanelViewProps } from './interfaces';
import SplitPanelBase from './SplitPanelBase.vue';

const props = defineProps<SplitPanelViewProps<T>>();
const slots = defineSlots<SplitPanelViewSlots<T>>();
const splitPanel = shallowRef<SplitPanel>();
const emit = defineEmits<{
  'update:children': [event: ChildrenChangedEvent<T>]
}>();

let disposeListeners: (() => void) | undefined;

function initSplitPanel() {
  disposeListeners?.();
  splitPanel.value ??= SplitPanel.create({
    id: props.itemId,
    resizeElSize: props.resizeElSize,
    showFirstResizeEl: props.showFirstResizeEl,
  })
  splitPanel.value.setAnimateStrategy(props.animateStrategy ?? configureAnimate());
  splitPanel.value.setDraggableStrategy(props.draggableStrategy ?? configureDraggable({
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

  const disposeAdd = splitPanel.value.onAddChildren((children) => {
    emit('update:children', { splitPanel: splitPanel.value, type: 'add', children });
  });
  const disposeRemove = splitPanel.value.onRemoveChildren((children) => {
    emit('update:children', { splitPanel: splitPanel.value, type: 'remove', children });
  });

  disposeListeners = () => {
    disposeAdd();
    disposeRemove();
  };
}

watch(() => props.splitPanel, (newVal) => {
  splitPanel.value = newVal;
  initSplitPanel();
}, { immediate: true });

provide('splitPanel', splitPanel);
defineExpose({ splitPanel });

watch(() => props.showFirstResizeEl, (newVal) => {
  splitPanel.value.setShowFirstResizeEl(newVal);
}, { immediate: true });

watch(() => props.direction, (newVal) => {
  if (newVal) {
    splitPanel.value.setDirection(newVal);
  }
}, { immediate: true });

onBeforeUnmount(() => {
  disposeListeners?.();
});
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
