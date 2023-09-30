import { describe, expect, it } from 'vitest';

import { flattenBreadthFirst, flattenDepthFirst } from './flatten';
import { examplePanel1 } from './flatten.mock';
import SplitPanel from './SplitPanel';

describe('flatten strategies', () => {
  describe.each([
    {
      message: 'flattenDepthFirst',
      strategy: flattenDepthFirst,
      globalOrder: [
        'test1',
        'test1-child1',
        'test1-child1-child1',
        'test1-child1-child2',
        'test1-child2',
        'test1-child3',
        'test1-child3-child1',
        'test1-child3-child2',
      ],
      globalIndexMap: {
        'test1-child1': 0,
        'test1-child1-child1': 1,
        'test1-child1-child2': 2,
        'test1-child2': 3,
        'test1-child3': 4,
        'test1-child3-child1': 5,
        'test1-child3-child2': 6,
      },
      parentIndexMap: {
        'test1-child1': 0,
        'test1-child1-child1': 0,
        'test1-child1-child2': 1,
        'test1-child2': 1,
        'test1-child3': 2,
        'test1-child3-child1': 0,
        'test1-child3-child2': 1,
      },
      globalLeafIndexMap: {
        'test1-child1-child1': 0,
        'test1-child1-child2': 1,
        'test1-child2': 2,
        'test1-child3-child1': 3,
        'test1-child3-child2': 4,
      },
    },
    {
      message: 'flattenBreadthFirst',
      strategy: flattenBreadthFirst,
      globalOrder: [
        'test1',
        'test1-child1',
        'test1-child2',
        'test1-child3',
        'test1-child1-child1',
        'test1-child1-child2',
        'test1-child3-child1',
        'test1-child3-child2',
      ],
      globalIndexMap: {
        'test1-child1': 0,
        'test1-child2': 1,
        'test1-child3': 2,
        'test1-child1-child1': 3,
        'test1-child1-child2': 4,
        'test1-child3-child1': 5,
        'test1-child3-child2': 6,
      },
      parentIndexMap: {
        'test1-child1': 0,
        'test1-child1-child1': 0,
        'test1-child1-child2': 1,
        'test1-child2': 1,
        'test1-child3': 2,
        'test1-child3-child1': 0,
        'test1-child3-child2': 1,
      },
      globalLeafIndexMap: {
        'test1-child2': 0,
        'test1-child1-child1': 1,
        'test1-child1-child2': 2,
        'test1-child3-child1': 3,
        'test1-child3-child2': 4,
      },
    },
  ])('$message', ({
    globalOrder, globalIndexMap, strategy, parentIndexMap, globalLeafIndexMap,
  }) => {
    it('has expected global order', () => {
      const flat = strategy(examplePanel1);

      expect(flat.map((item) => item.id)).toEqual(globalOrder);
    });

    it.each([
      {
        id: 'test1',
        expected: undefined,
      },
      ...Object.keys(globalIndexMap).map((id) => ({
        id,
        expected: globalIndexMap[id],
      })),
    ])('rootIndexById matches $expected for $id', ({ id, expected }) => {
      const splitPanel = SplitPanel.create({
        ...examplePanel1,
        observe: false,
        flattenStrategy: strategy,
      });

      expect(splitPanel.rootIndexById(id)).toEqual(expected);
    });

    it.each([
      {
        id: 'test1',
        expected: undefined,
      },
      ...Object.keys(parentIndexMap).map((id) => ({
        id,
        expected: parentIndexMap[id],
      })),
    ])('indexById matches $expected for $id', ({ id, expected }) => {
      const splitPanel = SplitPanel.create({
        ...examplePanel1,
        observe: false,
        flattenStrategy: strategy,
      });

      expect(splitPanel.byId(id)?.parent?.indexById(id)).toEqual(expected);
      expect(splitPanel.byId(id)?.index).toEqual(expected);
    });

    it.each([
      ...['test1', 'test1-child1', 'test1-child3'].map((id) => ({
        id,
        expected: undefined,
      })),
      ...Object.keys(globalLeafIndexMap).map((id) => ({
        id,
        expected: globalLeafIndexMap[id],
      })),
    ])('rootLeafIndexById matches $expected for $id', ({ id, expected }) => {
      const splitPanel = SplitPanel.create({
        ...examplePanel1,
        observe: false,
        flattenStrategy: strategy,
      });

      expect(splitPanel?.rootLeafIndexById(id)).toEqual(expected);
    });
  });
});
