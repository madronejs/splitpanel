import { describe, expect, it } from 'vitest';

import SplitPanel from './SplitPanel';


describe('calculateSizes', () => {
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
      showFirstResizeEl: true,
      resizeElSize: 20,
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

  it.each([
    {
      id: IDS.ID1,
      size: '100%',
      expectSizes: {
        [IDS.ID1]: '94%',
        [IDS.ID2]: '20px',
        [IDS.ID3]: '20px',
        [IDS.ID4]: '20px',
      },
    },
    {
      id: IDS.ID2,
      size: '100%',
      expectSizes: {
        [IDS.ID2]: '94%',
        [IDS.ID1]: '20px',
        [IDS.ID3]: '20px',
        [IDS.ID4]: '20px',
      },
    },
    {
      id: IDS.ID3,
      size: '100%',
      expectSizes: {
        [IDS.ID3]: '94%',
        [IDS.ID2]: '20px',
        [IDS.ID1]: '20px',
        [IDS.ID4]: '20px',
      },
    },
    {
      id: IDS.ID4,
      size: '100%',
      expectSizes: {
        [IDS.ID4]: '94%',
        [IDS.ID2]: '20px',
        [IDS.ID3]: '20px',
        [IDS.ID1]: '20px',
      },
    },
  ])('calculates correct sizes for items $id set to $size', ({ id, expectSizes, size }) => {
    const splitPanel = create4SplitPanel();
    const item = splitPanel.byId(id);
    const sizes = splitPanel.calculateSizes({
      item,
      size,
      itemsToConstrain: item.siblings,
    });

    for (const key of Object.keys(sizes)) {
      expect(sizes[key].formatted).toEqual(expectSizes[key]);
    }
  });

  it.each([
    {
      size: '50%',
      ids: [IDS.ID1],
      expectedSizes: {
        [IDS.ID1]: '50%',
        [IDS.ID2]: '16.666666669999998%',
        [IDS.ID3]: '16.666666669999998%',
        [IDS.ID4]: '16.666666669999998%',
      }
    },
    {
      size: '20%',
      ids: [IDS.ID1],
      expectedSizes: {
        [IDS.ID1]: '20%',
        [IDS.ID2]: '26.66666667%',
        [IDS.ID3]: '26.66666667%',
        [IDS.ID4]: '26.66666667%',
      }
    },
    {
      size: '20%',
      ids: [IDS.ID1, IDS.ID2],
      expectedSizes: {
        [IDS.ID1]: '20%',
        [IDS.ID2]: '20%',
        [IDS.ID3]: '30%',
        [IDS.ID4]: '30%',
      }
    },
    {
      size: '20%',
      ids: [IDS.ID1, IDS.ID2, IDS.ID3],
      expectedSizes: {
        [IDS.ID1]: '20%',
        [IDS.ID2]: '20%',
        [IDS.ID3]: '20%',
        [IDS.ID4]: '40%',
      }
    },
    {
      size: ['10%', '20%', '30%', '40%'],
      ids: [IDS.ID1, IDS.ID2, IDS.ID3],
      expectedSizes: {
        [IDS.ID1]: '10%',
        [IDS.ID2]: '20%',
        [IDS.ID3]: '30%',
        [IDS.ID4]: '40%',
      }
    },
    {
      size: '50%',
      ids: [IDS.ID1, IDS.ID2],
      expectedSizes: {
        [IDS.ID1]: '47%',
        [IDS.ID2]: '47%',
        [IDS.ID3]: '16.666666669999998%',
        [IDS.ID4]: '16.666666669999998%',
      }
    },
  ])('can adjust $ids to be the correct size when set to $size', ({ size, expectedSizes, ids }) => {
    const splitPanel = create4SplitPanel();
    const item = ids.map((id) => splitPanel.byId(id));
    const sizes = splitPanel.calculateSizes({
      item,
      size,
    });

    Object.keys(expectedSizes).forEach((key) => {
      expect(sizes[key].formatted).toEqual(expectedSizes[key]);
    });
  });
});
