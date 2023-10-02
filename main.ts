import { createApp, defineComponent, reactive, computed, watch, toRaw, h } from 'vue';
import Madrone, { MadroneVue3 } from 'madronejs';
import { SplitPanel, SplitPanelView } from './src';
import { default as VueSplitPanelView } from './src/render/vue3';

Madrone.use(MadroneVue3({
  reactive, computed, watch, toRaw,
}));

import './src/style.scss';
import './testStyle.scss';

function createTestPanel() {
  return SplitPanel.create({
    id: 'foo',
    resizeElSize: 20,
    children: [
      { id: 'foo1' },
      { id: 'foo2' },
      { id: 'foo3' },
      { id: 'foo4' },
    ],
  });
}

const vSplitPanel = createTestPanel();
// vue app
const app = createApp(defineComponent({
  name: 'TestApp',
  render: () => h(
    VueSplitPanelView,
    { class: 'h-100', splitPanel: vSplitPanel },
    {
      item: (scope) => h('div', { class: 'panel-item w-100 h-100' }, [`${scope.panel.id}: ${scope.panel.sizeInfo.formatted}`]),
      resize: (scope) => h('div', { class: 'panel-resize w-100 h-100' }, [`${scope.panel.id}: ${scope.panel.sizeInfo.formatted}`]),
    }
  ),
}));

app.mount('#app');

// web component
SplitPanelView.register().then(() => {
  const el = document.querySelector('#webc') as SplitPanelView;

  el.splitPanel = createTestPanel();
});
