import round from 'lodash/round';

import type SplitPanel from './SplitPanel';
import { SumOptions } from './interfaces';

export function roundVal(val: number, precision?: number) {
  return round(val, precision ?? 10);
}

/** Get the total combined width in pixels of the items passed */
export function sumSizes(items: SplitPanel[], options?: SumOptions) {
  let sum = 0;

  for (const item of items) {
    const px = options?.getter?.(item) ?? item?.[options?.sumSource || 'sizeInfo']?.[options?.sumProperty || 'exactSize'];

    if (typeof px === 'number' && !Number.isNaN(px)) {
      sum += options?.includeNegative ? px : Math.max(px, 0);
    }
  }

  return sum;
}

export function sumSizesBetween(item1: SplitPanel, item2: SplitPanel, options?: SumOptions) {
  if (item1?.parent !== item2?.parent || !item1?.parent) {
    return 0;
  }

  const { parent, index: index1 } = item1;
  const { index: index2 } = item2;

  if (index1 === index2) {
    return options?.getter?.(item1) ?? item1[options?.sumSource || 'sizeInfo'][options?.sumProperty || 'exactSize'];
  }

  const allInRange = parent.children.slice(index1, index2 + 1);

  return sumSizes(allInRange, options);
}

export function sumMinSizes(items: SplitPanel[]) {
  return sumSizes(items, {
    getter: (item) => item.absoluteMin,
  });
}
