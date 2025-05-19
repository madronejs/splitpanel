import type SplitPanel from './SplitPanel';

export function sortPanels<T extends SplitPanel>(items: T[]) {
  // Define a helper function to get comparable values, defaulting to sensible values.
  const getMinSize = (item: T) => item.parsedConstraints?.minSize?.relativeValue ?? 0;
  const getMaxSize = (item: T) => item.parsedConstraints?.maxSize?.relativeValue ?? Infinity;
  const hasSize = (item: T) => item.parsedConstraints?.size !== undefined;

  // Prioritize items for resizing:
  // 1. Items with highest minSize.
  // 2. Items with lowest maxSize.
  // 3. Items with parsed size constraints.
  // 4. Everything else.
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
