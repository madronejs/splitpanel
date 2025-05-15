import { describe, it, expect } from 'vitest';

import { rebalanceSizes } from '../utilCalc';

describe('rebalanceSizes', () => {
  it('does not change sizes when percent sum is less than 100%', () => {
    const sizes = ['20%', '20%'];
    const { balancedSizes, totalRelative } = rebalanceSizes(sizes, 100);

    expect(totalRelative).toEqual(0.4);
    expect(balancedSizes).toEqual([
      { exactValue: 20, relativeValue: 0.2, relative: true },
      { exactValue: 20, relativeValue: 0.2, relative: true },
    ]);
  });

  it('will rebalance the sizes when the percent sum is greater than 100%', () => {
    const sizes = ['20%', '20%', '80%'];
    const { balancedSizes, totalRelative } = rebalanceSizes(sizes, 100);

    expect(totalRelative).toBeCloseTo(1.2);
    expect(balancedSizes).toEqual([
      { exactValue: 16.666_666_669_999_998, relativeValue: 0.166_666_666_7, relative: true },
      { exactValue: 16.666_666_669_999_998, relativeValue: 0.166_666_666_7, relative: true },
      { exactValue: 66.666_666_67, relativeValue: 0.666_666_666_7, relative: true },
    ]);
  });

  it('will rebalance sizes when the exact sum is greater than the size', () => {
    const sizes = ['20px', '20px', '80px'];
    const { balancedSizes, totalRelative } = rebalanceSizes(sizes, 100);

    expect(totalRelative).toBeCloseTo(1.2);
    expect(balancedSizes).toEqual([
      { exactValue: 16.666_666_669_999_998, relativeValue: 0.166_666_666_7, relative: false },
      { exactValue: 16.666_666_669_999_998, relativeValue: 0.166_666_666_7, relative: false },
      { exactValue: 66.666_666_67, relativeValue: 0.666_666_666_7, relative: false },
    ]);
  });

  it('will rebalance sizes when the percent and exact sums are greater than the size', () => {
    const sizes = ['20%', '20%', '80px'];
    const { balancedSizes, totalRelative } = rebalanceSizes(sizes, 100);

    expect(totalRelative).toBeCloseTo(1.2);
    expect(balancedSizes).toEqual([
      { exactValue: 16.666_666_669_999_998, relativeValue: 0.166_666_666_7, relative: true },
      { exactValue: 16.666_666_669_999_998, relativeValue: 0.166_666_666_7, relative: true },
      { exactValue: 66.666_666_67, relativeValue: 0.666_666_666_7, relative: false },
    ]);
  });

  it('will rebalance sizes and consider reserved space', () => {
    const sizes = ['100%'];
    const { balancedSizes, reservedSizes } = rebalanceSizes(sizes, 100, ['20px']);

    expect(balancedSizes).toEqual([
      { exactValue: 80, relativeValue: 0.8, relative: true },
    ]);

    expect(reservedSizes).toEqual([
      { exactValue: 20, relativeValue: 0.2, relative: false },
    ]);
  });

  it('will rebalance string and number sizes', () => {
    const sizes = ['50%', '50%'];
    const { balancedSizes, totalRelative } = rebalanceSizes(sizes, 100, [30, 30]);

    expect(totalRelative).toBeCloseTo(1.6);
    expect(balancedSizes).toEqual([
      { exactValue: 20, relativeValue: 0.2, relative: true },
      { exactValue: 20, relativeValue: 0.2, relative: true },
    ]);
  });
});
