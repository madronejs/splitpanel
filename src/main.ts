import './style.scss';

import { SplitPanel, SplitPanelView } from './SplitPanelView';

customElements.define(SplitPanelView.tag, SplitPanelView);

await SplitPanelView.register();

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
