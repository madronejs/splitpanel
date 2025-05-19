<script setup lang="ts">
import { onBeforeUnmount, inject, ShallowRef, watch } from 'vue';
import { SplitPanel } from '@/core';

import { SplitPanelItemProps, SplitPanelViewSlots } from './interfaces';
import SplitPanelBase from './SplitPanelBase.vue';

const props = defineProps<SplitPanelItemProps>();
const slots = defineSlots<SplitPanelViewSlots>();
const splitPanelParent = inject<ShallowRef<SplitPanel>>('splitPanel');
const [splitPanel] = splitPanelParent.value.addChild({ ...props, id: props.itemId });

watch(() => props.constraints, (val) => {
  splitPanel.setConstraints(val);
  splitPanelParent.value.satisfyConstraints();
});

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
