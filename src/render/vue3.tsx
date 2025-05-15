import {
  defineComponent,
  useSlots,
  SlotsType,
  onBeforeUnmount,
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
    manualUnbind: Boolean,
  },
  setup(props) {
    onBeforeUnmount(() => {
      if (!props.manualUnbind && props.splitPanel?.isRoot) {
        props.splitPanel?.unbind();
      }
    });
    return {
      slots: useSlots(),
    };
  },
  render() {
    const sPanel: SplitPanel = this.splitPanel;

    if (!sPanel) return null;

    const panelSlots: SlotsType = this.slots;
    const scope = makeScope(sPanel);

    return (
      <div
        ref={ sPanel.attachEl }
        class={ {
          'split-panel': true,
          'split-panel-root': sPanel.isRoot,
          'split-panel-parent': !!sPanel.numChildren,
          [`direction-${sPanel.direction}`]: true,
        } }
        style={ sPanel.style }
      >
        {
          sPanel.isRoot || (sPanel.isFirstChild && !sPanel.showFirstResizeEl)
            ? null
            : (
              <div
                ref={ sPanel.attachResizeEl }
                class={ {
                  'split-panel-resize': true,
                  resizing: sPanel.resizing,
                } }
              >
                <div class="split-panel-resize-inner">
                  {this.slots.resize?.(scope)}
                </div>
              </div>
              )
        }
        <div
          class="split-panel-content"
          ref={ sPanel.attachContentEl }
        >
              {sPanel.numChildren
                ? sPanel.children.map((child) => (
                  <SplitPanelView key={ child.id } splitPanel={ child }>{ panelSlots }</SplitPanelView>
                  ))
                : (
                  <div key={ `${sPanel.id}_container` } class="split-panel-content-inner">{this.slots.item?.(scope)}</div>
                  )}
        </div>
        {
          this.slots.ghost
            ? (
            <div
              ref={ sPanel.attachGhostEl }
              class="split-panel-ghost"
            >{this.slots.ghost?.(scope)}
            </div>
              )
            : null
        }
        <div
          ref={ sPanel.attachDropZoneEl }
          class="split-panel-dropzone"
        >{this.slots.dropZone?.(scope)}
        </div>
      </div>
    );
  },
});

export default SplitPanelView;
