import './style.scss'

import SplitPanelView from './SplitPanelView';
import SplitPanel from './SplitPanelView/SplitPanel';

customElements.define(SplitPanelView.tag, SplitPanelView);

customElements.whenDefined(SplitPanelView.tag).then(() => {
  const el = document.querySelector(SplitPanelView.tag) as SplitPanelView;

  el.splitPanel = SplitPanel.create({
    id: 'foo',
    resizeElSize: 20,
    children: [
      { id: 'foo1' },
      { id: 'foo2' },
      { id: 'foo3' },
      { id: 'foo4' }
    ]
  });
});