import { ConstraintType, ParsedConstraint, SizeInfoOptions, SizedItem } from './interfaces';
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

export function rebalanceSizes(size: ConstraintType | ConstraintType[], comparativeSize: number): {
  totalRelative: number,
  totalExact: number,
  balancedSizes: ParsedConstraint[],
} {
  const sizes = [size || []].flat();

  const balancedSizes: ParsedConstraint[] = [];
  let totalExact: number = 0;
  let totalRelative: number = 0;

  for (const item of sizes) {
    const parsed = parseConstraint(item, comparativeSize);

    totalRelative += parsed.relativeValue;
    totalExact += parsed.exactValue;
    balancedSizes.push(parsed);
  }

  if (totalRelative > 1) {
    for (const item of balancedSizes) {
      item.relativeValue /= totalRelative;
      item.exactValue = item.relativeValue * comparativeSize;
    }
  }

  return {
    totalRelative,
    totalExact,
    balancedSizes,
  };
}

export function getBalancedPanelSizeArray(
  items: SizedItem[],
  comparativeSize: number,
) {
  const sizes: ConstraintType[] = [];

  for (const { size, item } of items) {
    console.log('size', size, item.getSizeInfo(size).formatted);
    sizes.push(size ? item.getSizeInfo(size).formatted : item.sizeInfo.exactMin);
  }


  // const panels = [panel || []].flat();
  // const sizes = Array.isArray(size)
  //   ? panels.map((p, i) => p.getSizeInfo(size[i] != null ? size[i] : p.sizeInfo.formatted, { comparativeSize }).formatted)
  //   : panels.map((p) => p.getSizeInfo(size, { comparativeSize }).formatted);

  return rebalanceSizes(sizes, comparativeSize);
}



