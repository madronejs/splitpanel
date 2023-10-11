import {
  defineComponent,
  computed,
  shallowRef,
  useSlots,
  SlotsType,
  type PropType,
} from 'vue';
import SplitPanel from '@/core/SplitPanel';

function makeScope(panel: SplitPanel) {
  return { panel };
}

const SplitPanelView = defineComponent({
  name: 'SplitPanelView',
  props: {
    splitPanel: Object as PropType<SplitPanel>,
  },
  setup(props) {
    return {
      // splitPanel: computed(() => props.splitPanel),
      slots: useSlots(),
    };
  },
  render() {
    const sPanel: SplitPanel = this.splitPanel;
    const panelSlots: SlotsType = this.slots;

    return (
      <div
        ref={sPanel.attachEl}
        class={{
          'split-panel': true,
          'split-panel-root': sPanel.isRoot,
          'split-panel-parent': !!sPanel.numChildren,
          [`direction-${sPanel.direction}`]: true,
        }}
        style={sPanel.style}
      >
        {
          sPanel.isRoot
            ? null
            : (
              <div
                ref={sPanel.attachResizeEl}
                class={{
                  'split-panel-resize': true,
                  dragging: sPanel.dragging,
                }}
                style={sPanel.resizeElStyle}
              >
                {this.slots.resize?.(makeScope(sPanel))}
              </div>
            )
        }
        <div
          class='split-panel-content'
          ref={sPanel.attachContentEl}
        >
          {sPanel.numChildren
            ? sPanel.children.map((child) => (
              <SplitPanelView splitPanel={child}>{panelSlots}</SplitPanelView>
            ))
            : (
              <div
                class='split-panel-content-inner'
              >
                {this.slots.item?.(makeScope(sPanel))}
              </div>
            )
          }
        </div>
      </div>
    );
  },
});

export default SplitPanelView;
