import './src/style.scss';

import { SplitPanel, SplitPanelView } from './src';

customElements.define(SplitPanelView.tag, SplitPanelView);

SplitPanelView.register().then(() => {
  const el = document.querySelector(SplitPanelView.tag) as SplitPanelView;

  el.splitPanel = SplitPanel.create({
    id: 'foo',
    resizeElSize: 20,
    children: [
      { id: 'foo1' },
      { id: 'foo2' },
      { id: 'foo3' },
      { id: 'foo4' },
    ],
  });
});
