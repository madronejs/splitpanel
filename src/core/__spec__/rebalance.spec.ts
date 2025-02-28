import { describe, it, expect } from 'vitest';

import SplitPanel from '../SplitPanel';
import { rebalanceSizes, getBalancedPanelSizeArray } from '../utilBalance';

describe('rebalanceSizes', () => {
  it('does not change sizes when percent sum is less than 100%', () => {
    const sizes = ["20%", "20%"];
    const { balancedSizes, totalRelative } = rebalanceSizes(sizes, 100);

    expect(totalRelative).toEqual(0.4);
    expect(balancedSizes).toEqual([
      { exactValue: 20, relativeValue: 0.2, relative: true },
      { exactValue: 20, relativeValue: 0.2, relative: true },
    ]);
  });

  it('will rebalance the sizes when the percent sum is greater than 100%', () => {
    const sizes = ["20%", "20%", '80%'];
    const { balancedSizes, totalRelative } = rebalanceSizes(sizes, 100);

    expect(totalRelative).toBeCloseTo(1.2);
    expect(balancedSizes).toEqual([
      { exactValue: 16.666666666666664, relativeValue: 0.16666666666666666, relative: true },
      { exactValue: 16.666666666666664, relativeValue: 0.16666666666666666, relative: true },
      { exactValue: 66.66666666666666, relativeValue: 0.6666666666666666, relative: true },
    ]);
  });

  it('will rebalance sizes when the exact sum is greater than the size', () => {
    const sizes = ["20px", "20px", '80px'];
    const { balancedSizes, totalRelative } = rebalanceSizes(sizes, 100);

    expect(totalRelative).toBeCloseTo(1.2);
    expect(balancedSizes).toEqual([
      { exactValue: 16.666666666666664, relativeValue: 0.16666666666666666, relative: false },
      { exactValue: 16.666666666666664, relativeValue: 0.16666666666666666, relative: false },
      { exactValue: 66.66666666666666, relativeValue: 0.6666666666666666, relative: false },
    ]);
  });

  it('will rebalance sizes when the percent and exact sums are greater than the size', () => {
    const sizes = ["20%", "20%", '80px'];
    const { balancedSizes, totalRelative } = rebalanceSizes(sizes, 100);

    expect(totalRelative).toBeCloseTo(1.2);
    expect(balancedSizes).toEqual([
      { exactValue: 16.666666666666664, relativeValue: 0.16666666666666666, relative: true },
      { exactValue: 16.666666666666664, relativeValue: 0.16666666666666666, relative: true },
      { exactValue: 66.66666666666666, relativeValue: 0.6666666666666666, relative: false },
    ]);
  });
});

describe('getBalancedPanelSizeArray', () => {
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

  it.each([
    {
      message: 'balances the sizes for four panels and four 25% sizes',
      size: ['25%', '25%', '25%', '25%'],
      expected: [
        { exactValue: 250, relativeValue: 0.25, relative: true },
        { exactValue: 250, relativeValue: 0.25, relative: true },
        { exactValue: 250, relativeValue: 0.25, relative: true },
        { exactValue: 250, relativeValue: 0.25, relative: true },
      ]
    },
    {
      message: 'balances the sizes for four panels and two 10% sizes',
      size: ['10%', '10%'],
      expected: [
        { exactValue: 100, relativeValue: 0.1, relative: true },
        { exactValue: 100, relativeValue: 0.1, relative: true },
        { exactValue: 250, relativeValue: 0.25, relative: true },
        { exactValue: 250, relativeValue: 0.25, relative: true },
      ]
    },
    {
      message: 'balances the sizes for four panels when the total percent is greater than 100%',
      size: ['50%', '50%', '50%', '50%'],
      expected: [
        { exactValue: 250, relativeValue: 0.25, relative: true },
        { exactValue: 250, relativeValue: 0.25, relative: true },
        { exactValue: 250, relativeValue: 0.25, relative: true },
        { exactValue: 250, relativeValue: 0.25, relative: true },
      ]
    },
  ])('$message', ({ size, expected }) => {
    const panel = create4SplitPanel();

    panel.satisfyConstraints({ initialize: true });

    const { balancedSizes } = getBalancedPanelSizeArray(panel.children.map((item, index) => ({ item, size: size[index] })), BASE_WIDTH);

    expect(balancedSizes).toEqual(expected);
  });

  it('does not let the panels be smaller than the min size', () => {
    const panel = SplitPanel.create({
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
        { id: IDS.ID3, constraints: { minSize: 100 } },
        { id: IDS.ID4 },
      ],
    });

    panel.satisfyConstraints({ initialize: true });

    const { balancedSizes } = getBalancedPanelSizeArray([
      { item: panel.children[0], size: '50%' },
      { item: panel.children[1], size: '50%' },
      { item: panel.children[2], size: '0%' },
      { item: panel.children[3], size: '0%' },
    ], BASE_WIDTH);

    expect(balancedSizes).toEqual([
      { exactValue: 454.5454545454545, relativeValue: 0.45454545454545453, relative: true },
      { exactValue: 454.5454545454545, relativeValue: 0.45454545454545453, relative: true },
      { exactValue: 90.9090909090909, relativeValue: 0.09090909090909091, relative: false },
      { exactValue: 0, relativeValue: 0, relative: true },
    ]);
  });
});
