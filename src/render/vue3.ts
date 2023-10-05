import {
  defineComponent,
  getCurrentInstance,
  render,
  ref,
  type VNode,
  h,
  shallowRef,
  type PropType,
  watch,
  watchEffect,
  useSlots,
} from 'vue';
import pick from 'lodash/pick';
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

    type SlotType = 'item' | 'resize';
    type ContentMapEntryType = Record<SlotType, HTMLElement> & {
      added: boolean,
    }

    const instance = getCurrentInstance();
    const refreshContent = ref(0);
    let contentElementMap: Record<string, ContentMapEntryType> = {};

    function renderToDiv(vnode: VNode, element: HTMLDivElement) {
      // Took some inspiration from https://github.com/pearofducks/mount-vue-component
      vnode.appContext = instance.appContext;

      render(vnode, element);
      return element;
    }

    function renderItem(item: SplitPanel, element: HTMLDivElement) {
      if (element) {
        return renderToDiv(h(slots.item, makeScope(item)), element);
      }

      return '';
    }

    function generateContent() {
      const val = props.splitPanel.allChildren;
      const ids = Object.keys(props.splitPanel.allChildMap);

      contentElementMap = pick(contentElementMap, ids);

      for (const item of val) {
        const itemEl = document.createElement('div');

        itemEl.slot = SplitPanelView.itemSlotName(item);
        renderItem(item, itemEl);

        const itemResizeEl = document.createElement('div');

        itemResizeEl.slot = SplitPanelView.resizeSlotName(item);
        renderItem(item, itemResizeEl);

        if (!contentElementMap[item.id]) {
          contentElementMap[item.id] ??= {
            item: itemEl,
            resize: itemResizeEl,
            added: false,
          };

          refreshContent.value += 1;
        }
      }
    }

    watch(() => splitPanelRef.value, async (panelRef) => {
      await SplitPanelView.register();
      panelRef?.setSplitPanel(props.splitPanel);
    }, { immediate: true });
    watch(() => props.splitPanel, async (val) => {
      await SplitPanelView.register();
      splitPanelRef.value?.setSplitPanel(val);
    });

    watchEffect(() => {
      if (splitPanelRef.value && refreshContent.value) {
        for (const id of Object.keys(contentElementMap)) {
          if (!contentElementMap[id].added) {
            splitPanelRef.value.append(
              contentElementMap[id].item,
              contentElementMap[id].resize,
            );
          }
        }
      }
    });

    return {
      slots,
      splitPanelRef,
      makeScope,
      contentElementMap,
      generateContent,
    };
  },
  render() {
    this.generateContent();
    return h(SplitPanelView.tag, {
      ref: (el) => { this.splitPanelRef = el; },
    });
  },
});
