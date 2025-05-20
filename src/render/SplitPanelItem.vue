<script setup lang="ts" generic="T">
import { computed, onBeforeUnmount, inject, ShallowRef, watch } from 'vue';
import { type SplitPanel, type PanelConstraints } from '@/core';

import { SplitPanelItemProps, SplitPanelViewSlots } from './interfaces';
import SplitPanelBase from './SplitPanelBase.vue';

const props = defineProps<SplitPanelItemProps<T>>();
const slots = defineSlots<SplitPanelViewSlots<T>>();
const splitPanelParent = inject<ShallowRef<SplitPanel>>('splitPanel');
const [splitPanel] = splitPanelParent.value.addChild({ ...props, id: props.itemId });

const panelConstraints = computed<PanelConstraints>(() => {
  if (props.constrainToScroll && splitPanel.contentScrollSize) {
    return {
      minSize: splitPanel.contentScrollSize,
      maxSize: splitPanel.contentScrollSize,
    };
  }

  return props.constraints;
});

function setConstraints() {
  if (!panelConstraints.value) return;

  splitPanel.setConstraints(panelConstraints.value);
  splitPanelParent.value.queueRerender();
}

watch(() => panelConstraints.value, setConstraints, { immediate: true });

defineExpose({ splitPanel });
onBeforeUnmount(() => {
  splitPanelParent.value.removeChild(splitPanel);
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
    <template #item="scope">
      <slot v-bind="scope" />
    </template>
  </SplitPanelBase>
</template>
