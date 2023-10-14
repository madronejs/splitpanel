import {
  createApp, defineComponent, reactive, computed, watch, toRaw, h,
} from 'vue';
import Madrone, { MadroneVue3 } from '@madronejs/core';
import { SplitPanel } from './src';
// import SplitPanelView from './src/render/webComponent';
import VueSplitPanelView from './src/render/vue3';
import configureAnimate from './src/plugins/animate';
import configureDraggable from './src/plugins/draggable';

import './src/style.scss';
import './testStyle.scss';

Madrone.use(MadroneVue3({
  reactive, computed, watch, toRaw,
}));

function createTestPanel() {
  const panel = SplitPanel.create({
    id: 'foo',
    resizeElSize: 20,
    showFirstResizeEl: true,
    children: [
      { id: 'foo1', data: 'data1' },
      {
        id: 'foo2',
        // direction: 'column',
        // children: [
        //   { id: 'foo5', data: 'data2' },
        //   { id: 'foo6', data: 'data3' },
        // ],
      },
      { id: 'foo7', constraints: { size: '10%' }, data: 'data4' },
      // { id: 'foo8', constraints: { size: '20%' } },
      { id: 'foo3' },
      { id: 'foo4' },
      // { id: 'foo5' },
    ],
  });

  panel.setAnimateStrategy(configureAnimate());
  panel.setDraggableStrategy(configureDraggable({
    onDrop: (evt) => {
      evt.target.swapData(evt.panel);
    },
    ghostAnchor: () => ({ x: 0.5, y: 0.5 }),
  }));

  return panel;
}

const vSplitPanel = createTestPanel();

(window as any).splitPanel = vSplitPanel;

// vue app
const app = createApp(defineComponent({
  name: 'TestApp',
  render: () => (
    <VueSplitPanelView
      class="h-100 w-100"
      splitPanel={vSplitPanel}
    >
      {{
        resize: (scope) => (
          <div class="panel-resize w-100 h-100">
            {`${scope.panel.id}: ${scope.panel.sizeInfo.formatted}`}
          </div>
        ),
        item: (scope) => (
          <div class="panel-item w-100 h-100">
            {`${scope.panel.id}: ${scope.panel.sizeInfo.formatted}`}
            <div class="drag-handle">handle</div>
            <div>data: {scope.panel.data}</div>
          </div>
        ),
      }}
    </VueSplitPanelView>
  ),
}));

app.mount('#app');

// // web component
// SplitPanelView.register().then(() => {
//   const el = document.querySelector('#webc') as SplitPanelView;

//   el.splitPanel = createTestPanel();
// });
