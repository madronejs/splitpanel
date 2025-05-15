import type SplitPanel from './SplitPanel';

export type ConstraintType = string | number;
export type ResizeStrategy = (panel: SplitPanel, val: ConstraintType) => void;
export type FlattenStrategy = (items: SplitPanelDef[]) => SplitPanelDef[];
export type AnimateStrategyReturn = {
  promise: Promise<void>,
  cancel: () => void,
};
export type AnimateStrategy = (panel: SplitPanel, items: SplitPanel[], size?: ConstraintType | ConstraintType[]) => AnimateStrategyReturn;
export type DraggableStrategyReturn<DType = any> = {
  /** The split panel currently being dragged */
  dragTarget: SplitPanel<DType>,
  /** The split panel that the current panel being dragged will be dropped on */
  dropTarget: SplitPanel<DType>,
  /** If the current panel is being dragged */
  isDragging: boolean,
  /** If the current panel can be a drop zone */
  isDropZone: boolean,
  /** Cleanup */
  unbind?: () => void,
};
export type DraggableStrategy<DType = any> = (panel: SplitPanel<DType>) => DraggableStrategyReturn<DType>;

export type PanelConstraints = {
  /** Minimum size */
  minSize?: ConstraintType,
  /** Maximum size */
  maxSize?: ConstraintType,
  /** Default size */
  size?: ConstraintType,
};

type NumberKeys<T> = {
  [K in keyof T]: T[K] extends number ? K : never
}[keyof T];

export type SumOptions = {
  includeNegative?: boolean,
  sumSource?: 'sizeInfo' | 'sizeInfoSnapshot',
  sumProperty?: NumberKeys<SizeInfoType>,
  getter?: (panel: SplitPanel) => number,
};

export type BoxDims = {
  width?: number,
  height?: number,
};

export type BoxCoord = {
  x: number,
  y: number,
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
  id?: string,
  /** (Only applies to parent items) Set the data array for the subtree */
  dataArray?: DType[],
  /** Optional data to associate with the panel */
  data?: DType,
  /** Sizing constraints for the panel */
  constraints?: PanelConstraints,
  /** This panel's children */
  children?: Array<SplitPanelDef<DType>>,
  /** This panel's direction */
  direction?: PANEL_DIRECTION,
};

export type SplitPanelArgs<DType = any> = SplitPanelDef<DType> & {
  /** The parent of the current panel */
  parent?: SplitPanel<DType>,
  /** The root panel */
  root?: SplitPanel<DType>,
  /** Push other panels if current panel can no longer be resized */
  pushPanels?: boolean,
  /** How to re-balance remaining child sizes after a child's sizes is set */
  resizeStrategy?: ResizeStrategy,
  /** How to flatten the tree structure to calculate indices */
  flattenStrategy?: FlattenStrategy,
  /** Use built in resize observer or not (defaults to true) */
  observe?: boolean,
  /** Starting box size */
  rect?: BoxRect,
  /** Animation duration in milliseconds */
  animationDuration?: number,
  /** How far the panel can be from its max with before its considered fully expanded */
  expandTolerance?: number,
  /** Show the first resize element */
  showFirstResizeEl?: boolean,
  /** Selector for the resize element */
  resizeElSelector?: string,
  /** The width/height of the resize element */
  resizeElSize?: ConstraintType,
  /** Border styles for the resize element */
  resizeElBorderStyle?: string,
};

export type ParsedConstraint = {
  /** If constraint is relative */
  relative: boolean,
  /** Number between 0 and 1 */
  relativeValue: number,
  /** Exact pixel value */
  exactValue: number,
};

export type ParsedPanelConstraints = {
  [K in keyof PanelConstraints]: ParsedConstraint;
};

export type SizeInfoType = {
  parsedSize: ParsedConstraint,
  relativeMin: number,
  exactMin: number,
  relative: boolean,
  relativeSize: number,
  relativeMax: number,
  exactMax: number,
  exactSize: number,
  formatted: string,
  appliedSize: boolean,
  appliedMax: boolean,
  appliedMin: boolean,
};
export type SizeInfoOptions = {
  /** Constraints */
  parsedConstraints?: ParsedPanelConstraints,
  /** Target size */
  size: ConstraintType,
  /** Current container size */
  rectSize: number,
  /** Parent container size */
  comparativeSize: number,
};

export type ResizeObserverCallback = (event: ResizeObserverEntry) => void;
export type MouseEventCallback = (event: MouseEvent) => void;

export const RELATIVE_MULTIPLIER = 100;
export const RELATIVE_SYMBOL = '%';
export const EXACT_SYMBOL = 'px';
