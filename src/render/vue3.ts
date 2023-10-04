import {
  defineComponent, VNode, h, shallowRef, PropType, watch, useSlots,
} from 'vue';

import SplitPanel from '@/core/SplitPanel';
import SplitPanelView from './webComponent';

function makeScope(panel: SplitPanel) {
  return { panel };
}

export default defineComponent({
  name: 'SplitPanelView',
  props: {
    splitPanel: Object as PropType<SplitPanel>,
  },
  setup(props) {
    const splitPanelRef = shallowRef<SplitPanelView>();
    const slots = useSlots();

    watch(() => splitPanelRef.value, async (panelRef) => {
      await SplitPanelView.register();
      panelRef?.setSplitPanel(props.splitPanel);
    }, { immediate: true });
    watch(() => props.splitPanel, async (val) => {
      await SplitPanelView.register();
      splitPanelRef.value?.setSplitPanel(val);
    });

    return {
      slots,
      splitPanelRef,
      makeScope,
    };
  },
  render() {
    const { slots } = this;
    const { splitPanel } = this;
    const itemContainers: VNode[] = [];
    const resizeContainers: VNode[] = [];

    if (splitPanel?.allChildren && (slots.item || slots.resize)) {
      for (const child of splitPanel.allChildren) {
        const scope = this.makeScope(child);

        if (slots.item) {
          itemContainers.push(
            h(
              'div',
              {
                slot: SplitPanelView.itemSlotName(child),
                class: 'split-panel-content__inner',
              },
              slots.item(scope)
            )
          );
        }

        if (slots.resize) {
          resizeContainers.push(
            h(
              'div',
              {
                slot: SplitPanelView.resizeSlotName(child),
                class: 'split-panel-resize__inner',
              },
              slots.resize(scope)
            )
          );
        }
      }
    }

    return h(SplitPanelView.tag, {
      ref: (el) => { this.splitPanelRef = el; },
    }, [...itemContainers, ...resizeContainers]);
  },
});
