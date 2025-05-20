<script setup lang="ts" generic="T">
import { onBeforeUnmount, computed } from 'vue';
import SplitPanel from '@/core/SplitPanel';
import { PanelScope, SplitPanelBaseSlots, SplitPanelBaseProps } from './interfaces';

function makeScope(panel: SplitPanel<T>): PanelScope<T> {
  return { panel };
}

defineOptions({
  name: 'SplitPanelBase',
});

const props = defineProps<SplitPanelBaseProps<T>>();
const slots = defineSlots<SplitPanelBaseSlots<T>>();

onBeforeUnmount(() => {
  if (!props.manualUnbind && props.splitPanel?.isRoot) {
    props.splitPanel.unbind();
  }
});

const panelClasses = computed(() => ({
  'split-panel': true,
  'split-panel-root': props.splitPanel.isRoot,
  'split-panel-parent': !!props.splitPanel.numChildren,
  [`direction-${props.splitPanel.direction}`]: true,
}));

const resizeClasses = computed(() => ({
  'split-panel-resize': true,
  resizing: props.splitPanel.resizing,
}));
</script>

<template>
  <div
    :ref="splitPanel.attachEl"
    :class="panelClasses"
    :style="splitPanel.style"
  >
    <div
      v-if="!splitPanel.isRoot && !(splitPanel.isFirstChild && !splitPanel.showFirstResizeEl)"
      :ref="splitPanel.attachResizeEl"
      :class="resizeClasses"
    >
      <div class="split-panel-resize-inner">
        <slot
          name="resize"
          v-bind="makeScope(splitPanel)"
        />
      </div>
    </div>
    <div
      class="split-panel-content"
      :ref="splitPanel.attachContentEl"
    >
      <slot
        v-if="slots.content"
        name="content"
        v-bind="makeScope(splitPanel)"
      />
      <template v-else-if="splitPanel.numChildren">
        <SplitPanelBase
          v-for="child in splitPanel.children"
          :key="child.id"
          :splitPanel="child"
        >
          <template
            v-for="(_, name) in slots"
            #[name]="slotProps"
          >
            <slot
              :name="name"
              v-bind="slotProps"
            />
          </template>
        </SplitPanelBase>
      </template>
      <template v-else>
        <div class="split-panel-content-inner">
          <slot
            name="item"
            v-bind="makeScope(splitPanel)"
          />
        </div>
      </template>
    </div>
    <div
      v-if="$slots.ghost"
      :ref="splitPanel.attachGhostEl"
      class="split-panel-ghost"
    >
      <slot
        name="ghost"
        v-bind="makeScope(splitPanel)"
      />
    </div>
    <div
      :ref="splitPanel.attachDropZoneEl"
      class="split-panel-dropzone"
    >
      <slot
        name="dropZone"
        v-bind="makeScope(splitPanel)"
      />
    </div>
  </div>
</template>
