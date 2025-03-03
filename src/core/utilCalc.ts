import { ConstraintType, ParsedConstraint, SizeInfoOptions } from './interfaces';
import { parseConstraint, relativeToPercent, exactToPx } from './utilParse';
import { roundVal } from './utilMath';

export function getSizeInfo(options: SizeInfoOptions) {
  const { minSize, maxSize, size } = options.parsedConstraints || {};
  const parsedSize = options.size === undefined ? size : parseConstraint(options.size, options.comparativeSize);
  let newRelativeSize = parsedSize?.relativeValue ?? (options.rectSize / options.comparativeSize);
  let newSize = parsedSize?.exactValue ?? options.rectSize ?? 0;
  let useRelative = true;
  let appliedMin = false;
  let appliedMax = false;
  let appliedSize = false;

  if (minSize) {
    const originSize = newSize;

    newRelativeSize = Math.max(minSize.relativeValue, newRelativeSize);
    newSize = Math.max(minSize.exactValue, newSize);
    appliedMin = originSize !== newSize || newSize === minSize.exactValue;

    if (appliedMin) {
      useRelative = false;
    }
  }

  if (maxSize) {
    const originSize = newSize;

    newRelativeSize = Math.min(maxSize.relativeValue, newRelativeSize);
    newSize = Math.min(maxSize.exactValue, newSize);
    appliedMax = originSize !== newSize;
  }

  newRelativeSize = roundVal(newRelativeSize);
  newSize = roundVal(newSize);

  const min = minSize?.exactValue ?? 0;

  if (newSize <= min) {
    appliedMin = true;
    newSize = min;
    newRelativeSize = newSize / options.comparativeSize;
  }

  // If we applied a min or max, we didn't apply the given size
  appliedSize &&= !(appliedMin || appliedMax);

  return {
    parsedSize,
    relativeMin: minSize?.relativeValue,
    exactMin: min,
    relative: useRelative,
    relativeSize: newRelativeSize,
    relativeMax: maxSize?.relativeValue,
    exactMax: maxSize?.exactValue,
    exactSize: newSize,
    formatted: useRelative ? relativeToPercent(newRelativeSize) : exactToPx(newSize),
    appliedSize,
    appliedMax,
    appliedMin,
  };
}

export function rebalanceSizes(
  /** Adjust these sizes */
  sizesToBalance: ConstraintType | ConstraintType[],
  /** The container size */
  comparativeSize: number,
  /** Consider these sizes, but don't adjust them */
  sizesToConsider?: ConstraintType | ConstraintType[]
): {
  totalRelative: number,
  totalExact: number,
  balancedSizes: ParsedConstraint[],
  reservedSizes: ParsedConstraint[],
} {
  const sizes = [sizesToBalance || []].flat();
  const sizesConsider = [sizesToConsider || []].flat();

  const balancedSizes: ParsedConstraint[] = [];
  const reservedSizes: ParsedConstraint[] = [];
  let remainingRelative = 1;
  let remainingExact = comparativeSize;
  let totalExact: number = 0;
  let totalRelative: number = 0;
  let totalBalancedRelative: number = 0;

  for (const item of sizesConsider) {
    const parsed = parseConstraint(item, comparativeSize);

    totalRelative += parsed.relativeValue;
    totalExact += parsed.exactValue;
    remainingRelative -= parsed.relativeValue;
    remainingExact -= parsed.exactValue;
    reservedSizes.push(parsed);
  }

  for (const item of sizes) {
    const parsed = parseConstraint(item, comparativeSize);

    totalRelative += parsed.relativeValue;
    totalBalancedRelative += parsed.relativeValue;
    totalExact += parsed.exactValue;
    balancedSizes.push(parsed);
  }

  if (totalRelative > 1) {
    const scaleFactor = remainingRelative / totalBalancedRelative;
    for (const item of balancedSizes) {
      item.relativeValue = roundVal(item.relativeValue * scaleFactor);
      item.exactValue = item.relativeValue * comparativeSize;
    }
  }

  return {
    totalRelative,
    totalExact,
    balancedSizes,
    reservedSizes,
  };
}
