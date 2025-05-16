<script setup lang="ts">
import { onBeforeUnmount, inject } from 'vue';
import { SplitPanel } from '@/core';

import { SplitPanelItemProps } from './interfaces';
import SplitPanelBase from './SplitPanelBase.vue';

const props = defineProps<SplitPanelItemProps>();
const splitPanelParent = inject<SplitPanel>('splitPanel');
const [splitPanel] = splitPanelParent.addChild({ ...props, id: props.itemId });

onBeforeUnmount(() => {
  splitPanelParent.removeChild(splitPanel);
});
</script>

<template>
  <SplitPanelBase :split-panel="splitPanel">
    <template #item="scope">
      <slot v-bind="scope" />
    </template>
  </SplitPanelBase>
</template>
