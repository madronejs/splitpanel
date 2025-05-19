import type SplitPanel from './SplitPanel';

export function sortPanels<T extends SplitPanel>(items: T[]) {
  const getMinSize = (item: T) => item.parsedConstraints?.minSize?.relativeValue ?? 0;
  const getMaxSize = (item: T) => item.parsedConstraints?.maxSize?.relativeValue ?? Infinity;
  const hasSize = (item: T) => item.parsedConstraints?.size !== undefined;

  return [...items].sort((a, b) => {
    // 1. Highest minSize
    const minComparison = getMinSize(b) - getMinSize(a);

    if (minComparison !== 0) {
      return minComparison;
    }

    // 2. Lowest maxSize
    const maxComparison = getMaxSize(a) - getMaxSize(b);

    if (maxComparison !== 0) {
      return maxComparison;
    }

    // 3. Any size
    const sizeComparison = (hasSize(a) ? -1 : 1) - (hasSize(b) ? -1 : 1);

    if (sizeComparison !== 0) {
      return sizeComparison;
    }

    // 4. Default
    return 0;
  });
}
