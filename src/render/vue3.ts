import { defineComponent, VNode, Slots, h, shallowRef, PropType, watch, useSlots } from 'vue';

import SplitPanel from '@/core/SplitPanel'
import SplitPanelView from './webComponent';

export default defineComponent({
  name: 'SplitPanelView',
  props: {
    splitPanel: Object as PropType<SplitPanel>,
  },
  setup(props) {
    const splitPanelRef = shallowRef<SplitPanelView>();
    const slots = useSlots();

    function makeScope(panel: SplitPanel) {
      return { panel };
    }

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
    const slots: Slots = this.slots;
    const splitPanel: SplitPanel = this.splitPanel;
    const itemContainers: VNode[] = [];
    const resizeContainers: VNode[] = [];

    if (splitPanel?.allChildren && (slots.item || slots.resize)) {
      splitPanel.allChildren.forEach((child) => {
        const scope = this.makeScope(child);

        if (slots.item) {
          itemContainers.push(
            h(
              'div',
              {
                slot: SplitPanelView.itemSlotName(child),
                class: 'split-panel-content__inner'
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
                class: 'split-panel-resize__inner'
              },
              slots.resize(scope)
            )
          );
        }
      });
    }

    return h(SplitPanelView.tag, {
      ref: (el) => { this.splitPanelRef = el; },
    }, [...itemContainers, ...resizeContainers]);
  },
});
