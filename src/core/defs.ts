import differenceBy from 'lodash/differenceBy';
import pick from 'lodash/pick';
import round from 'lodash/round';
import camelCase from 'lodash/camelCase';

import type SplitPanel from './SplitPanel';

export type ConstraintType = string | number;
export type ResizeStrategy = (panel: SplitPanel, val: ConstraintType) => void;
export type FlattenStrategy = (items: SplitPanelDef[]) => SplitPanelDef[];
export type AnimateStrategyReturn = {
  promise: Promise<void>,
  cancel: () => void,
};
export type AnimateStrategy = (panel: SplitPanel, items: SplitPanel[], sizeInfo?: ReturnType<typeof getSizeInfo>) => AnimateStrategyReturn;
export type DraggableStrategyReturn = {
  unbind?: () => void,
};
export type DraggableStrategy = (panel: SplitPanel) => DraggableStrategyReturn;

export type PanelConstraints = {
  /** Minimum size */
  minSize?: ConstraintType;
  /** Maximum size */
  maxSize?: ConstraintType;
  /** Default size */
  size?: ConstraintType;
};

export type BoxDims = {
  width?: number;
  height?: number;
};

export type BoxCoord = {
  x: number;
  y: number;
};

export type BoxRect = BoxDims & BoxCoord;

export enum PANEL_DIRECTION {
  /** Split vertically (create columns) */
  column = 'column',
  /** Split horizontally (create rows) */
  row = 'row',
}

export enum SIBLING_RELATION {
  before = 'siblingBefore',
  after = 'siblingAfter',
}

export enum DIMENSION {
  width = 'width',
  height = 'height',
}

export enum AXIS {
  x = 'x',
  y = 'y',
}

export enum STYLE_PREFIX {
  panel = 'sp-',
  panelResize = 'sp-resize-'
}

export type SplitPanelDef<DType = any> = {
  /** Panel id. If not set, one will be automatically generated */
  id?: string;
  /** (Root only) Set the data array for the panel tree */
  dataArray?: DType[],
  /** Optional data to associate with the panel */
  data?: DType;
  /** Sizing constraints for the panel */
  constraints?: PanelConstraints;
  /** This panel's children */
  children?: Array<SplitPanelDef<DType>>;
  /** This panel's direction */
  direction?: PANEL_DIRECTION;
};

export type SplitPanelArgs<DType = any> = SplitPanelDef<DType> & {
  /** The parent of the current panel */
  parent?: SplitPanel<DType>;
  /** The root panel */
  root?: SplitPanel<DType>;
  /** Push other panels if current panel can no longer be resized */
  pushPanels?: boolean;
  /** How to re-balance remaining child sizes after a child's sizes is set */
  resizeStrategy?: ResizeStrategy;
  /** How to flatten the tree structure to calculate indices */
  flattenStrategy?: FlattenStrategy;
  /** Use built in resize observer or not (defaults to true) */
  observe?: boolean;
  /** Starting box size */
  rect?: BoxRect;
  /** Animation duration in milliseconds */
  animationDuration?: number;
  /** How far the panel can be from its max with before its considered fully expanded */
  expandTolerance?: number;
  /** Show the first resize element */
  showFirstResizeEl?: boolean;
  /** Selector for the resize element */
  resizeElSelector?: string;
  /** The width/height of the resize element */
  resizeElSize?: ConstraintType;
  /** Border styles for the resize element */
  resizeElBorderStyle?: string;
};

export type ParsedConstraint = {
  /** If constraint is relative */
  relative: boolean;
  /** Number between 0 and 1 */
  relativeValue: number;
  /** Exact pixel value */
  exactValue: number;
};

export type ParsedPanelConstraints = {
  [K in keyof PanelConstraints]: ParsedConstraint;
};

export type ResizeObserverCallback = (event: ResizeObserverEntry) => void;
export type MouseEventCallback = (event: MouseEvent) => void;

export const RELATIVE_MULTIPLIER = 100;
export const RELATIVE_SYMBOL = '%';
export const EXACT_SYMBOL = 'px';

export function roundVal(val: number, precision?: number) {
  return round(val, precision ?? 10);
}

export function camelCaseObject(obj: Record<string, any>) {
  const newStyle = {};

  for (const key of Object.keys(obj || {})) {
    newStyle[camelCase(key)] = obj[key];
  }

  return newStyle;
}

export function parseConstraint(val: string | number, comparativeSize: number): ParsedConstraint {
  const isNumber = typeof val === 'number';
  const relative = typeof val === 'string' ? val?.endsWith?.(RELATIVE_SYMBOL) : !isNumber;
  let parsedValue = isNumber ? val : Number.parseFloat(val);
  let relativeValue: number;
  let exactValue: number;

  parsedValue = Number.isNaN(parsedValue) || typeof parsedValue !== 'number' ? null : parsedValue;

  if (relative) {
    relativeValue = parsedValue / RELATIVE_MULTIPLIER;
    exactValue = comparativeSize * relativeValue;
  } else {
    exactValue = parsedValue;
    relativeValue = parsedValue / comparativeSize;
  }

  return { relative, relativeValue, exactValue };
}

export function relativeToPercent(val: number) {
  return `${val * RELATIVE_MULTIPLIER}${RELATIVE_SYMBOL}`;
}

export function exactToPx(val: number) {
  return `${val}${EXACT_SYMBOL}`;
}

export function parsedToFormatted(parsed: ParsedConstraint | ReturnType<typeof getSizeInfo>): string {
  if (!parsed) return undefined;
  if ('relativeValue' in parsed) {
    return parsed.relative
      ? relativeToPercent(parsed.relativeValue)
      : exactToPx(parsed.exactValue);
  }
  return parsed.relative
    ? relativeToPercent(parsed.relativeSize)
    : exactToPx(parsed.exactSize);
}

export function parsePanelConstraints(val: PanelConstraints, comparativeSize: number) {
  const constraints: ParsedPanelConstraints = {};

  for (const key of Object.keys(val || {})) {
    constraints[key] = parseConstraint(val[key], comparativeSize);
  }

  return constraints;
}

export function resizeEntryToBoxRect(data: ResizeObserverEntry) {
  const target = data.target as HTMLElement;
  const rect = target.getBoundingClientRect();
  return pick(rect, ['x', 'y', 'width', 'height']) as BoxRect;
}

export function getCoordFromMouseEvent(e: MouseEvent | TouchEvent): BoxCoord {
  if ('touches' in e) {
    return {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  }

  return { x: e.pageX, y: e.pageY };
}

export function getDirectionInfo(direction: PANEL_DIRECTION) {
  return direction === PANEL_DIRECTION.column ? {
    dimension: DIMENSION.height,
    dimensionInverse: DIMENSION.width,
    axis: AXIS.y,
    axisInverse: AXIS.x,
  } : {
    dimension: DIMENSION.width,
    dimensionInverse: DIMENSION.height,
    axis: AXIS.x,
    axisInverse: AXIS.y,
  };
}

export function getDistance(
  coord1: BoxCoord,
  coord2: BoxCoord,
  direction?: PANEL_DIRECTION,
): number {
  if (!coord1 || !coord2) {
    return 0;
  }

  const { x: x1, y: y1 } = coord1;
  const { x: x2, y: y2 } = coord2;

  // Don't need to be too fancy here... diagonal distance doesn't matter.
  if (direction === PANEL_DIRECTION.row) {
    return x2 - x1;
  }

  return y2 - y1;
}

/** Get a list of the children minus the items passed in */
export function negateChildren(panel: SplitPanel, items: SplitPanel[]) {
  return differenceBy(panel.children, items, 'id');
}

function mergeConstraint(
  constraints: ParsedConstraint[],
  compare?: (c1: ParsedConstraint, c2: ParsedConstraint) => number,
  getter?: (items: ParsedConstraint[]) => ParsedConstraint,
): ParsedConstraint {
  const filtered = constraints.filter(Boolean);

  if (filtered.length === 0) {
    return null;
  }

  if (filtered.length === 1) {
    return filtered[0];
  }

  if (compare) {
    filtered.sort(compare);
  }

  return getter ? getter(filtered) : filtered[0];
}

export function mergePanelConstraints(...constraints: ParsedPanelConstraints[]) {
  const size: ParsedConstraint[] = [];
  const minSize: ParsedConstraint[] = [];
  const maxSize: ParsedConstraint[] = [];

  for (const item of constraints) {
    if (item.size?.exactValue > 0) {
      size.push(item.size);
    }

    if (item.minSize) {
      minSize.push(item.minSize);
    }

    if (item.maxSize) {
      maxSize.push(item.maxSize);
    }
  }

  const merged: ParsedPanelConstraints = {
    // Default to the override
    size: mergeConstraint(size, null, (items) => items.at(-1)),
    // Get the larger of the two constraints
    minSize: mergeConstraint(minSize, (c1, c2) => (c1.exactValue > c2.exactValue ? -1 : 1)),
    // Get the smaller of the two constraints
    maxSize: mergeConstraint(maxSize, (c1, c2) => (c1.exactValue > c2.exactValue ? 1 : -1)),
  };
  const normalized: ParsedPanelConstraints = {};

  for (const key of Object.keys(merged)) {
    if (merged[key]) {
      normalized[key] = merged[key];
    }
  }

  return normalized;
}

export function getChildInfo<T>(children: Array<SplitPanel<T>>) {
  const map: Record<string, SplitPanel<T>> = {};
  const indexMap: Record<string, number> = {};
  const leafIndexMap: Record<string, number> = {};
  const leafPanels: SplitPanel<T>[] = [];

  for (const [index, child] of (children || []).entries()) {
    map[child.id] = child;
    indexMap[child.id] = index;

    if (!child.numChildren) {
      leafIndexMap[child.id] = leafPanels.length;
      leafPanels.push(child);
    }
  }

  return {
    /** Id to panel mapping */
    map,
    /** An id to numeric index map showing where in the top level array each child is */
    indexMap,
    /** An id to index map only taking leaf panels into consideration */
    leafIndexMap,
    /** Total number of leaf panels */
    totalLeafPanels: leafPanels.length,
    /** All of the leaf panels */
    leafPanels,
  };
}

export function getSizeInfo(
  options: {
    parsedConstraints?: ParsedPanelConstraints;
    size?: ConstraintType;
    rectSize?: number;
    relativeSize?: number;
    comparativeSize?: number;
  },
) {
  const { minSize, maxSize } = options.parsedConstraints || {};
  const parsedSize = options.size === undefined ? undefined : parseConstraint(options.size, options.comparativeSize);
  let newRelativeSize = parsedSize?.relativeValue ?? options.relativeSize;
  let newSize = parsedSize?.exactValue ?? options.rectSize ?? 0;
  let useRelative = true;
  let appliedMin = false;
  let appliedMax = false;
  let appliedSize = false;

  if (minSize) {
    const originSize = newSize;

    newRelativeSize = Math.max(minSize.relativeValue, newRelativeSize);
    newSize = Math.max(minSize.exactValue, newSize);
    appliedMin = originSize !== newSize;

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

type NumberKeys<T> = {
  [K in keyof T]: T[K] extends number ? K : never
}[keyof T];

export type SumOptions = {
  includeNegative?: boolean;
  sumSource?: 'sizeInfo' | 'sizeInfoSnapshot';
  sumProperty?: NumberKeys<ReturnType<typeof getSizeInfo>>;
  getter?: (panel: SplitPanel) => number;
};

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

function getSiblingArray(panel: SplitPanel, relation: SIBLING_RELATION) {
  if (panel.pushPanels) {
    return [...((relation === SIBLING_RELATION.before ? panel.siblingsBefore : panel.siblingsAfter) || [])];
  }

  return relation === SIBLING_RELATION.before ? [panel.siblingBefore].filter(Boolean) : [panel.siblingAfter].filter(Boolean);
}

function findPanelMatch(items: SplitPanel[], condition: (sibling: SplitPanel) => boolean) {
  for (const sibling of items) {
    if (condition(sibling)) {
      return sibling;
    }
  }

  return null;
}

export function findNearestSibling(
  panel: SplitPanel,
  relation: SIBLING_RELATION,
  condition: (sibling: SplitPanel) => boolean,
) {
  const siblings = getSiblingArray(panel, relation);

  if (relation === SIBLING_RELATION.before) {
    siblings.reverse();
  }

  return findPanelMatch(siblings, condition);
}

export function findFurthestSibling(
  panel: SplitPanel,
  relation: SIBLING_RELATION,
  condition: (sibling: SplitPanel) => boolean,
) {
  const siblings = getSiblingArray(panel, relation);

  if (relation === SIBLING_RELATION.after) {
    siblings.reverse();
  }

  return findPanelMatch(siblings, condition);
}

export function estimateSizeInfo(panel: SplitPanel, val: ConstraintType) {
  const sizeInfo = panel.getSizeInfo(val);
  const estimatedNewSize = sumSizes(panel.siblings) + sizeInfo.exactSize;
  const panelGrowing = panel.sizeInfo.exactSize < sizeInfo.exactSize;
  const panelShrinking = panel.sizeInfo.exactSize > sizeInfo.exactSize;
  const siblingsNeedShrink = estimatedNewSize > panel.comparativeSize;
  const siblingsNeedGrow = !siblingsNeedShrink;
  const shouldResize = sizeInfo.relativeSize !== panel.sizeInfo.relativeSize;

  return {
    ...sizeInfo,
    shouldResize,
    panelGrowing,
    panelShrinking,
    estimatedNewSize,
    siblingsNeedShrink,
    siblingsNeedGrow,
  };
}
