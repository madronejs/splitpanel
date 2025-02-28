import { describe, expect, it } from 'vitest';

import { PANEL_DIRECTION } from './interfaces';
import { resizeAll } from './resize';
import SplitPanel from './SplitPanel';

const BASE_WIDTH = 1000;

enum IDS {
  ID1 = 'ID1',
  ID2 = 'ID2',
  ID3 = 'ID3',
  ID4 = 'ID4',
}

function create4SplitPanel() {
  return SplitPanel.create({
    observe: false,
    resizeElSize: 0,
    rect: {
      x: 0,
      y: 0,
      width: BASE_WIDTH,
      height: 10,
    },
    children: [
      { id: IDS.ID1 },
      { id: IDS.ID2 },
      { id: IDS.ID3 },
      { id: IDS.ID4 },
    ],
  });
}

function create4SplitPanelResizeAll() {
  const splitPanel = create4SplitPanel();

  splitPanel.setResizeStrategy(resizeAll);

  return splitPanel;
}

describe('SplitPanel', () => {
  it.each([
    {
      id: IDS.ID1,
      expectedIds: [],
    },
    {
      id: IDS.ID2,
      expectedIds: [IDS.ID1],
    },
    {
      id: IDS.ID3,
      expectedIds: [IDS.ID1, IDS.ID2],
    },
    {
      id: IDS.ID4,
      expectedIds: [IDS.ID1, IDS.ID2, IDS.ID3],
    },
  ])('calculates siblingsBefore for $id', ({ id, expectedIds }) => {
    const splitPanel = create4SplitPanel();

    expect(splitPanel.byId(id).siblingsBefore.map((item) => item.id)).toEqual(expectedIds);
  });

  it.each([
    {
      id: IDS.ID1,
      expectedIds: [IDS.ID2, IDS.ID3, IDS.ID4],
    },
    {
      id: IDS.ID2,
      expectedIds: [IDS.ID3, IDS.ID4],
    },
    {
      id: IDS.ID3,
      expectedIds: [IDS.ID4],
    },
    {
      id: IDS.ID4,
      expectedIds: [],
    },
  ])('calculates siblingsAfter for $id', ({ id, expectedIds }) => {
    const splitPanel = create4SplitPanel();

    expect(splitPanel.byId(id).siblingsAfter.map((item) => item.id)).toEqual(expectedIds);
  });

  describe('setId', () => {
    it('can change the id of a panel', () => {
      const splitPanel = create4SplitPanel();
      const child = splitPanel.byId(IDS.ID3);

      child.setId('foobar');
      expect(child.id).toEqual('foobar');
    });

    it('changes the id in the childMap', () => {
      const splitPanel = create4SplitPanel();

      splitPanel.byId(IDS.ID3).setId('foobar');
      expect(Object.keys(splitPanel.childMap)).toEqual([IDS.ID1, IDS.ID2, 'foobar', IDS.ID4]);
    });

    it('can access changed panel via the byId method', () => {
      const splitPanel = create4SplitPanel();
      const child = splitPanel.byId(IDS.ID3);

      child.setId('foobar');
      expect(child === splitPanel.byId('foobar')).toBeTruthy();
    });
  });

  describe('add/remove child', () => {
    it('can add a child', () => {
      const splitPanel = create4SplitPanel();

      expect(splitPanel.numChildren).toEqual(Object.keys(IDS).length);

      splitPanel.addChild({ id: 'foobar' });

      expect(Object.keys(splitPanel.childMap)).toEqual([Object.keys(IDS), 'foobar'].flat());
    });

    it('can remove a child by id', () => {
      const splitPanel = create4SplitPanel();

      splitPanel.removeChild(IDS.ID3);
      expect(Object.keys(splitPanel.childMap)).toEqual([IDS.ID1, IDS.ID2, IDS.ID4]);
    });

    it('can remove itself from its parent', () => {
      const splitPanel = create4SplitPanel();

      splitPanel.byId(IDS.ID3).remove();
      expect(Object.keys(splitPanel.childMap)).toEqual([IDS.ID1, IDS.ID2, IDS.ID4]);
    });
  });

  describe('add/remove nested child', () => {
    it('automatically sets direction', () => {
      const splitPanel = create4SplitPanel();
      const sp1 = splitPanel.byId(IDS.ID1);

      sp1.addChild({ id: 'foobar' });
      expect(sp1.direction).toEqual(PANEL_DIRECTION.column);
    });
  });

  describe('constraints', () => {
    it('calculates absoluteMin as zero', () => {
      const splitPanel = create4SplitPanel();

      for (const id of Object.values(IDS)) {
        expect(splitPanel.byId(id).absoluteMin).toEqual(0);
      }
    });

    it('calculates absoluteMax as full width if no minSize defined', () => {
      const splitPanel = create4SplitPanel();

      for (const id of Object.values(IDS)) {
        expect(splitPanel.byId(id).absoluteMax).toEqual(BASE_WIDTH);
      }
    });

    it('calculates absoluteMax based on minSize of siblings', () => {
      const splitPanel = create4SplitPanel();

      for (const id of Object.values(IDS)) {
        splitPanel.byId(id).setConstraints({ minSize: 100 });
      }

      for (const id of Object.values(IDS)) {
        expect(splitPanel.byId(id).absoluteMax).toEqual(700);
      }
    });

    it('can have its size set to a value between the minSize and maxSize', () => {
      const splitPanel = create4SplitPanelResizeAll();
      const child = splitPanel.byId(IDS.ID4);

      child.setConstraints({
        minSize: 100,
        maxSize: 200,
      });
      child.setSize(150);

      expect(splitPanel.byId(IDS.ID4).sizeInfo.relativeSize).toEqual(0.15);
      expect(splitPanel.byId(IDS.ID4).sizeInfo.exactSize).toEqual(150);
    });

    it('does not shrink below a min width panel constraint', () => {
      const splitPanel = create4SplitPanelResizeAll();
      const child = splitPanel.byId(IDS.ID4);

      child.setConstraints({ minSize: 100 });
      child.setSize(0);

      expect(splitPanel.byId(IDS.ID4).sizeInfo.relativeSize).toEqual(0.1);
      expect(splitPanel.byId(IDS.ID4).sizeInfo.exactSize).toEqual(100);
    });

    it('does not grow beyond a max width panel constraint', () => {
      const splitPanel = create4SplitPanelResizeAll();
      const child = splitPanel.byId(IDS.ID4);

      child.setConstraints({ maxSize: 100 });
      child.setSize(BASE_WIDTH);

      expect(splitPanel.byId(IDS.ID4).sizeInfo.relativeSize).toEqual(0.1);
      expect(splitPanel.byId(IDS.ID4).sizeInfo.exactSize).toEqual(100);
    });
  });

  describe('resizeStrategyNeighbor', () => {
    it('grows sibling before and shrinks self if size set', () => {
      const splitPanel = create4SplitPanelResizeAll();

      splitPanel.satisfyConstraints();

      splitPanel.byId(IDS.ID2).resize(200);
      expect(splitPanel.byId(IDS.ID1).sizeInfo.exactSize).toEqual(300);
      expect(splitPanel.byId(IDS.ID3).sizeInfo.exactSize).toEqual(250);
      expect(splitPanel.byId(IDS.ID4).sizeInfo.exactSize).toEqual(250);
    });

    it('begins to shrink neighbor after if size set below 0', () => {
      const splitPanel = create4SplitPanelResizeAll();

      splitPanel.satisfyConstraints();

      splitPanel.byId(IDS.ID2).resize(-50);
      expect(splitPanel.byId(IDS.ID1).sizeInfo.exactSize).toEqual(550);
      expect(splitPanel.byId(IDS.ID3).sizeInfo.exactSize).toEqual(200);
      expect(splitPanel.byId(IDS.ID4).sizeInfo.exactSize).toEqual(250);
    });
  });
});
