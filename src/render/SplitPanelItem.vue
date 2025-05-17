<script setup lang="ts">
import { onBeforeUnmount, inject } from 'vue';
import { SplitPanel } from '@/core';

import { SplitPanelItemProps, SplitPanelViewSlots } from './interfaces';
import SplitPanelBase from './SplitPanelBase.vue';

const props = defineProps<SplitPanelItemProps>();
const slots = defineSlots<SplitPanelViewSlots>();
const splitPanelParent = inject<SplitPanel>('splitPanel');
const [splitPanel] = splitPanelParent.addChild({ ...props, id: props.itemId });

onBeforeUnmount(() => {
  splitPanelParent.removeChild(splitPanel);
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
