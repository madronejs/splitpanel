import cloneDeep from 'lodash/cloneDeep';
import debounce from 'lodash/debounce';
import uniqBy from 'lodash/uniqBy';
import uniqueId from 'lodash/uniqueId';
import sortBy from 'lodash/sortBy';
import { computed, reactive } from '@madronejs/core';
import { v4 as uuid } from 'uuid';

import {
  type BoxCoord,
  type BoxRect,
  type ConstraintType,
  exactToPx,
  type AnimateStrategy,
  type AnimateStrategyReturn,
  type FlattenStrategy,
  type DraggableStrategy,
  type DraggableStrategyReturn,
  getChildInfo,
  getCoordFromMouseEvent,
  getDistance,
  getSizeInfo,
  getDirectionInfo,
  mergePanelConstraints,
  type MouseEventCallback,
  negateChildren,
  PANEL_DIRECTION,
  STYLE_PREFIX,
  type PanelConstraints,
  parseConstraint,
  parsedToFormatted,
  parsePanelConstraints,
  relativeToPercent,
  resizeEntryToBoxRect,
  type ResizeObserverCallback,
  type ResizeStrategy,
  SIBLING_RELATION,
  type SplitPanelArgs,
  type SplitPanelDef,
  type SizeInfoType,
  sumMinSizes,
  sumSizes,
} from './defs';
import { flattenDepthFirst } from './flatten';
import { resizeNeighbors } from './resize';

type CbMap = {
  resize?: ResizeObserverCallback;
  mousemove?: MouseEventCallback;
  mouseup?: MouseEventCallback;
};

function makeUniqueId() {
  // Human readable but universally unique id
  return `${uniqueId('panel-')}__${uuid()}`;
}

class SplitPanel<DType = any> {
  static create<T = any>(...args: ConstructorParameters<typeof SplitPanel<T>>) {
    return new SplitPanel<T>(...args);
  }

  constructor(options?: SplitPanelArgs<DType>) {
    // Bindings
    this._onElementResize = this._onElementResize.bind(this);
    this._onResizeElMouseDown = this._onResizeElMouseDown.bind(this);
    this._onResizeElResize = this._onResizeElResize.bind(this);
    this._onDblClick = this._onDblClick.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseover = this._onMouseover.bind(this);
    this._onMouseout = this._onMouseout.bind(this);
    this.unbind = this.unbind.bind(this);
    this.attachEl = this.attachEl.bind(this);
    this.attachContentEl = this.attachContentEl.bind(this);
    this.attachResizeEl = this.attachResizeEl.bind(this);
    this.attachDropZoneEl = this.attachDropZoneEl.bind(this);
    this.attachGhostEl = this.attachGhostEl.bind(this);
    // This._onElementClick = this._onElementClick.bind(this);
    // setup
    this._children = [];
    this._root = options?.root;
    this._observeElement = options?.observe ?? true;
    this.resizeEl = null;
    this.contentEl = null;
    this.containerEl = null;
    this._debouncedSatisfyConstraints = debounce(this.satisfyConstraints.bind(this));
    this.parent = options?.parent;
    this._setupRootIfNeeded();
    this.setFlattenStrategy(options?.flattenStrategy);
    this.setResizeStrategy(options?.resizeStrategy);
    this.setDefinition(options);
    this.setPushPanels(options?.pushPanels);
    this.setResizeElSize(options?.resizeElSize);
    this.setResizeElBorderStyle(options?.resizeElBorderStyle);
    this.setShowFirstResizeEl(options?.showFirstResizeEl);
    this.setExpandTolerance(options?.expandTolerance);
    this.setRect(options?.rect);
  }

  /** This panel's unique id */
  @reactive id: string;
  /** This panel's parent (if any) */
  @reactive parent?: SplitPanel<DType>;
  /** Sizing constraints */
  @reactive constraints: PanelConstraints;
  /** Constraints defined by the resize strategy */
  @reactive strategyConstraints: PanelConstraints;
  /** Current element's box */
  @reactive rect: BoxRect;
  /** The html element this panel represents */
  @reactive containerEl: HTMLElement;
  /** Unbind all events for container el */
  @reactive private _unbindContainerEl: () => void;
  /** The html element containing the content of the panel */
  @reactive contentEl: HTMLElement;
  /** Unbind all events for resize el */
  @reactive private _unbindResizeEl: () => void;
  /** The html element for containing the dropzone content of the panel */
  @reactive dropZoneEl: HTMLElement;
  /** Unbind the dropzone element */
  @reactive private _unbindDropZoneEl: () => void;
  /** The html element for handling the drag ghost for this panel */
  @reactive ghostEl: HTMLElement;
  /** Unbind the ghost element */
  @reactive private _unbindGhostEl: () => void;
  /** The html element to act as the resize for this */
  @reactive resizeEl: HTMLElement;
  /** Size of the resize bar */
  @reactive resizeElRect: BoxRect;
  /** If we should add listeners to the elements */
  @reactive private _observeElement: boolean;
  /** Size info snapshot, taken before a resize event */
  @reactive sizeInfoSnapshot: SizeInfoType;
  /** If the mouse is hovering over the resizer */
  @reactive hovering: boolean;

  @reactive private _showFirstResizeEl: boolean;
  /** Show the first resize element */
  @computed get showFirstResizeEl() {
    return this._showFirstResizeEl ?? this.parent?.showFirstResizeEl ?? false;
  }

  @computed get shouldShowResizeEl() {
    return !this.isFirstChild || Boolean(this.parent?.showFirstResizeEl);
  }

  @computed get canResize() {
    return !(this.isRoot || this.isFirstChild);
  }

  /** The data associated with this panel */
  @reactive data: DType;

  /** Array of data associated with the leaf indices (only used at root level) */
  @computed get dataArray(): DType[] {
    return this._allChildInfo.leafPanels.map((panel) => panel.data);
  }

  set dataArray(val) {
    for (const [index, panel] of this._allChildInfo.leafPanels.entries()) {
      panel.setData(val?.[index]);
    }
  }

  @reactive private _direction: PANEL_DIRECTION;

  @computed get inverseDirection() {
    return this._direction === PANEL_DIRECTION.column ? PANEL_DIRECTION.row : PANEL_DIRECTION.column;
  }

  /** The direction the panel is split */
  @computed get direction(): PANEL_DIRECTION {
    if (this.numChildren) {
      return this._direction ?? this.parent?.inverseDirection ?? PANEL_DIRECTION.row;
    }
    return this._direction ?? this.parent?.direction ?? PANEL_DIRECTION.row;
  }

  @computed get contentDirection() {
    return this.parent?.direction ?? this.direction;
  }

  @reactive private _resizeElSize: ConstraintType;
  /** The size of the resize element */
  @computed get resizeElSize() {
    const size = this._resizeElSize ?? this.parent?.resizeElSize;

    if (size == null) {
      return 8;
    }

    return parseConstraint(size, this.comparativeSize).exactValue;
  }

  @reactive private _resizeElBorderStyle: string;
  /** The border style for the resize element */
  @computed get resizeElBorderStyle() {
    return this._resizeElBorderStyle ?? this.parent?._resizeElBorderStyle;
  }

  @reactive private _animateStrategy: AnimateStrategy;
  @reactive private _animateStrategyData: AnimateStrategyReturn;
  /** How to animate the panel */
  @computed get animateStrategy(): AnimateStrategy {
    return this._animateStrategy ?? this.parent?.animateStrategy;
  }

  @reactive protected _draggableStrategy: DraggableStrategy<DType>;
  @reactive protected _draggableStrategyReturn: DraggableStrategyReturn<DType>;
  @computed get draggableStrategy(): DraggableStrategy<DType> {
    return this._draggableStrategy ?? this.parent?.draggableStrategy;
  }

  /** If the current panel is being dragged */
  @computed get isDragging() {
    return !!this._draggableStrategyReturn?.isDragging;
  }

  /** If this panel can have another panel dropped on it */
  @computed get isDropZone() {
    return !this.isRoot && !!this._draggableStrategyReturn?.isDropZone;
  }

  /** The panel being dropped */
  @computed get dropTarget() {
    return this._draggableStrategyReturn?.dropTarget;
  }

  /** The panel being dragged */
  @computed get dragTarget() {
    return this._draggableStrategyReturn?.dragTarget;
  }

  /** If the current panel being dragged is being dropped onto this panel */
  @computed get isDropping() {
    return this.isDropZone && this.dropTarget?.id === this.id;
  }

  @reactive private _flattenStrategy: FlattenStrategy;
  /** How to flatten and order children in the tree */
  @computed get flattenStrategy() {
    return this._flattenStrategy ?? this.parent?.flattenStrategy ?? flattenDepthFirst;
  }

  @reactive private _resizeStrategy: ResizeStrategy;
  /** How to re-balance remaining child sizes after a child's sizes is set */
  @computed get resizeStrategy() {
    return this._resizeStrategy ?? this.parent?.resizeStrategy ?? resizeNeighbors;
  }

  /** Starting drag position */
  @reactive dragPosStart: BoxCoord;
  @reactive private _prevDragPos: BoxCoord;
  /** The previous drag position to determine drag direction/dragRelation */
  @computed get prevDragPos() {
    return this._prevDragPos || this._dragPos || this.dragPosStart;
  }

  set prevDragPos(val) {
    this._prevDragPos = val;
  }

  @reactive private _dragPos: BoxCoord;
  /** Current drag position */
  @computed get dragPos() {
    return this._dragPos || this.dragPosStart;
  }

  set dragPos(val) {
    this._dragPos = val;
  }

  /** If the panel is currently being resized via drag events */
  @computed get resizing() {
    return Boolean(this.dragPosStart);
  }

  /** If any child panel is being dragged */
  @computed get childResizing() {
    return this.children.some((item) => item.resizing);
  }

  /** Distance between the start drag position and the current drag position */
  @computed get dragDistance() {
    return getDistance(this.dragPos, this.dragPosStart, this.contentDirection);
  }

  /** The direction of the current drag */
  @computed get dragRelation() {
    return getDistance(this.prevDragPos, this.dragPos, this.contentDirection) <= 0 ? SIBLING_RELATION.before : SIBLING_RELATION.after;
  }

  /** Relative distance dragged compared to the parent container's size */
  @computed get relativeDragDistance() {
    return this.dragDistance / this.comparativeSize;
  }

  /** The relative size this panel should be based on the drag distance */
  @computed get relativeDragSize() {
    return this.relativeDragDistance + (this.sizeInfoSnapshot?.relativeSize ?? this.sizeInfo.relativeSize);
  }

  private _debouncedSatisfyConstraints: () => void;

  /** If this panel is the root of the panel */
  @computed get isRoot() {
    return !this.parent;
  }

  @reactive private _root?: SplitPanel<DType>;
  /** The root panel item */
  @computed get root(): SplitPanel<DType> {
    return this._root ?? this;
  }

  @reactive private _unbindRoot?: () => void;
  /** Unbind all the event listeners and cleanup */
  unbind() {
    this._unbindResizeEl?.();
    this._unbindContainerEl?.();
    this._unbindDropZoneEl?.();
    this._unbindGhostEl?.();
    this._unbindDraggable();

    if (this.isRoot) {
      this._unbindRoot?.();
    }
  }

  @reactive private _children: Array<SplitPanel<DType>>;
  /** The children of this panel */
  @computed get children(): Array<SplitPanel<DType>> {
    return uniqBy(this._children, 'id') || [];
  }

  @computed private get _childInfo() {
    return getChildInfo(this.children);
  }

  @computed private get _allChildInfo() {
    return getChildInfo(this.allChildren);
  }

  /** Child panels */
  @computed get childMap() {
    return this._childInfo.map;
  }

  /** All descendants of this panel */
  @computed get allChildren(): SplitPanel<DType>[] {
    return this.flattenStrategy(this.children);
  }

  /** A dictionary of all descendants of this panel */
  @computed get allChildMap(): Record<string, SplitPanel<DType>> {
    const map: Record<string, SplitPanel<DType>> = {};

    for (const child of this.allChildren) {
      map[child.id] = child;
    }

    return map;
  }

  /** Current size relative to parent (between 0 and 1) */
  @computed get relativeSize() {
    return this.rectSize / this.comparativeSize;
  }

  /** Sum of minSize values of all children */
  @computed get totalChildMinValues() {
    return sumMinSizes(this.children);
  }

  /** Sum of relative size values of all children */
  @computed get totalChildRelativeSizes() {
    return sumSizes(this.children, {
      sumSource: 'sizeInfo',
      sumProperty: 'relativeSize',
    });
  }

  /** Total available space not spoken for by min values */
  @computed get totalExactAvailableSpace() {
    return this.rectSize - this.totalChildMinValues;
  }

  /** Total relative available space not spoken for by min values */
  @computed get totalRelativeAvailableSpace() {
    return this.totalExactAvailableSpace / this.rectSize;
  }

  /** The absolute minimum size a panel can be */
  @computed get absoluteMin() {
    return Math.max(
      this.parsedUserConstraints.minSize?.exactValue || 0,
      Math.max(this.shouldShowResizeEl ? this.resizeElSize : 0, 0),
    );
  }

  /** The absolute maximum size this panel can be while still respecting the minSizes of its siblings */
  @computed get absoluteMax() {
    if (!this.parent) {
      return Number.POSITIVE_INFINITY;
    }

    return this.parent.totalExactAvailableSpace + this.absoluteMin;
  }

  /** How far the panel can be from its max with before its considered fully expanded */
  @reactive expandTolerance: number;

  /** If the current panel is expanded */
  @computed get fullyExpanded() {
    return this.sizeInfo.exactSize + this.expandTolerance >= this.absoluteMax;
  }

  /** Constraints that must be satisfied regardless of user config or strategy */
  @computed get absoluteConstraints() {
    return parsePanelConstraints({
      minSize: this.absoluteMin,
      maxSize: this.absoluteMax,
    }, this.comparativeSize);
  }

  /** User defined constraints for this panel */
  @computed get parsedUserConstraints() {
    return parsePanelConstraints(this.constraints, this.comparativeSize);
  }

  /** Strategy defined constraints for this panel */
  @computed get parsedStrategyConstraints() {
    return parsePanelConstraints(this.strategyConstraints, this.comparativeSize);
  }

  /** Combined parsed constraints for this panel defined by the user and the strategies */
  @computed get parsedConstraints() {
    return mergePanelConstraints(
      this.absoluteConstraints,
      this.parsedUserConstraints,
      this.parsedStrategyConstraints,
    );
  }

  /** The dimension and axis taken into account based on the direction of this panel's direction */
  @computed get directionInfo() {
    return getDirectionInfo(this.direction);
  }

  /** The dimension and axis taken into account based on the direction of the panel's content direction */
  @computed get contentDirectionInfo() {
    return getDirectionInfo(this.contentDirection);
  }

  /** Current container size in pixels */
  @computed get rectSize() {
    return this.rect?.[this.directionInfo.dimension] || 0;
  }

  /** Current content size in pixels */
  @computed get contentRectSize() {
    return this.rect?.[this.contentDirectionInfo.dimension] || 0;
  }

  /** The size this panel is compared to calculate relative size */
  @computed get comparativeSize() {
    if (this.isRoot) {
      return this.rectSize;
    }

    return this.parent?.rectSize;
  }

  /** Current container size in pixels */
  @computed get resizeRectSize() {
    return this.resizeElRect?.[this.directionInfo.dimension] || 0;
  }

  /** If a size has been explicitly set on this panel */
  @computed get hasSize() {
    return Boolean(this._size);
  }

  /** The first size this panel was set to */
  @reactive originalSize?: ConstraintType;
  @reactive private _size?: ConstraintType;
  /** The finalized size information based on all constraints */
  @computed get sizeInfo() {
    return this.getSizeInfo(this._size);
  }

  /** If this panel can grow based on its constraints */
  @computed get canGrow() {
    return !this.sizeInfo.appliedMax;
  }

  /** If this panel can shrink based on its constraints */
  @computed get canShrink() {
    return !this.sizeInfo.appliedMin;
  }

  @reactive private _pushPanels: boolean;
  /** Push other panels over if the constraints are reached on the current panel */
  @computed get pushPanels() {
    return this._pushPanels ?? this.parent?.pushPanels ?? true;
  }

  /** Styles to apply to the attached element */
  @computed get style() {
    const { formatted, exactMin, exactMax } = this.sizeInfo;
    const style: Record<string, any> = {};

    if (!this.isRoot) {
      style[`--${STYLE_PREFIX.panel}size`] = formatted;

      if (this.canResize && (this.resizing || this.hovering)) {
        style[`--${STYLE_PREFIX.panel}cursor`] = this.contentDirection === PANEL_DIRECTION.column ? 'row-resize' : 'col-resize';
      } else {
        style[`--${STYLE_PREFIX.panel}cursor`] = null;
      }
    }

    style[`--${STYLE_PREFIX.panel}min-size`] = (exactMin !== this.parent?.absoluteMin && Number.isFinite(exactMin)) ? exactToPx(exactMin) : null;
    style[`--${STYLE_PREFIX.panel}max-size`] = (exactMax !== this.parent?.absoluteMax && Number.isFinite(exactMax)) ? exactToPx(exactMax) : null;

    // RESIZE ELEMENT STYLES
    style[`--${STYLE_PREFIX.panelResize}size`] = this.isRoot || this._resizeElSize != null ? exactToPx(this.resizeElSize) : null;
    style[`--${STYLE_PREFIX.panelResize}border`] = this.isRoot || this._resizeElBorderStyle != null ? this.resizeElBorderStyle : null;

    return style;
  }

  @reactive private _rootCallbacks: WeakMap<HTMLElement, CbMap>;
  @computed private get rootCallbacks(): WeakMap<HTMLElement, CbMap> {
    return this.isRoot ? this._rootCallbacks : this.root.rootCallbacks;
  }

  @reactive private _resizeObserver: ResizeObserver;
  @computed private get resizeObserver(): ResizeObserver {
    return this.isRoot ? this._resizeObserver : this.root.resizeObserver;
  }

  /** This panel's index it the entire tree */
  @computed get rootIndex() {
    return this.rootIndexById(this.id);
  }

  /** This panel's index in the entire tree, only counting leaf panels */
  @computed get rootLeafIndex() {
    return this.rootLeafIndexById(this.id);
  }

  /** This panel's index in its parent's children array */
  @computed get index() {
    return this.parent?.indexById(this.id);
  }

  /** If this panel is the first child of its parent */
  @computed get isFirstChild() {
    return this.index === 0;
  }

  /** If this panel is the last child of its parent */
  @computed get isLastChild() {
    return Boolean(this.parent && this.index === this.parent.children.length - 1);
  }

  /** If this panel is not the first or last child of its parent */
  @computed get isMiddleChild() {
    return Boolean(this.parent && !this.isFirstChild && !this.isLastChild);
  }

  /** Siblings that are immediate neighbors to this panel */
  @computed get siblingNeighbors() {
    return [this.siblingBefore, this.siblingAfter].filter(Boolean);
  }

  /** The sibling directly before this panel, if any */
  @computed get siblingBefore() {
    return this.parent?.children[this.index - 1];
  }

  /** The siblings directly before this panel, if any */
  @computed get siblingsBefore() {
    return this.parent?.children.slice(0, this.index);
  }

  /** The sibling directly after this panel, if any */
  @computed get siblingAfter() {
    return this.parent?.children[this.index + 1];
  }

  /** The siblings directly after this panel, if any */
  @computed get siblingsAfter() {
    return this.parent?.children.slice(this.index + 1, this.parent.children.length);
  }

  /** This panel's siblings */
  @computed get siblings() {
    return this.parent?.children?.filter((item) => item.id !== this.id) || [];
  }

  /** Number of children this panel has */
  @computed get numChildren() {
    return this.children?.length || 0;
  }

  /** Get any panel in the entire tree by id */
  byId(id: string): SplitPanel<DType> {
    return this.root.allChildMap[id];
  }

  /** Get the index of a panel in the full tree */
  rootIndexById(id: string) {
    return this.root._allChildInfo.indexMap[id];
  }

  /** Get the index of a leaf panel in the full tree */
  rootLeafIndexById(id: string) {
    return this.root._allChildInfo.leafIndexMap[id];
  }

  /** Get the index of a leaf panel within the context of its parent */
  indexById(id: string) {
    return this._childInfo.indexMap[id];
  }

  /** Calculate size information based on this panel's constraints */
  getSizeInfo(size?: ConstraintType): SizeInfoType {
    return getSizeInfo({
      size,
      parsedConstraints: this.parsedConstraints,
      rectSize: this.rectSize,
      relativeSize: this.relativeSize,
      comparativeSize: this.comparativeSize,
    });
  }

  /** The raw definition for this panel and all of its children */
  getRawDefinition(options?: {includeData?: boolean}): SplitPanelDef<DType> {
    const def: SplitPanelDef<DType> = { id: this.id };

    if (this.data != null && options?.includeData) {
      def.data = this.data;
    }

    if (Object.keys(this.constraints || {}).length > 0) {
      def.constraints = this.constraints;
    }

    if (this.numChildren) {
      def.children = this.children.map((item) => item.getRawDefinition(options));
    }

    if (this._direction) {
      def.direction = this._direction;
    }

    return def;
  }

  /** Set the id of this panel */
  setId(val: string) {
    this.id = val ?? this.id ?? makeUniqueId();
  }

  /** Set the current bounding box of this item */
  setRect(val: BoxRect) {
    if (val) {
      this.rect = val;
    }
  }

  /** Set the current bounding box of this panel's resize bar */
  setResizeRect(val: BoxRect) {
    if (val) {
      this.resizeElRect = val;
    }
  }

  /** Set the expandTolerance */
  setExpandTolerance(val: number) {
    this.expandTolerance = val ?? 100;
  }

  /** Set the data associated with this panel */
  setData(val: DType) {
    this.data = val;
  }

  /** Set the data associated with the root of the tree */
  setDataArray(val: DType[]) {
    if (this.numChildren) {
      this.dataArray = val;
    }
  }

  /** Swap data with another panel */
  swapData(panel: SplitPanel<DType>) {
    if (panel) {
      const temp = panel.data;

      panel.setData(this.data);
      this.setData(temp);
    }
  }

  /** Move data from panel to this index, and shift other data over */
  moveData(panel: SplitPanel<DType>) {
    if (panel) {
      const cpy = [...panel.root.dataArray];
      // take the element that was moved, and remove it from the array
      const [toInsert] = cpy.splice(panel.rootLeafIndex, 1);

      // insert the moved element into its new place
      cpy.splice(this.rootLeafIndex, 0, toInsert);

      panel.root.setDataArray(cpy);
    }
  }

  setShowFirstResizeEl(val: boolean) {
    this._showFirstResizeEl = val;
  }

  /** Set the size of the resize element */
  setResizeElSize(val: ConstraintType) {
    this._resizeElSize = val ?? null;
  }

  setResizeElBorderStyle(val: string) {
    this._resizeElBorderStyle = val;
  }

  /** Set the direction of this panel */
  setDirection(direction: PANEL_DIRECTION) {
    this._direction = direction;
    this.satisfyConstraints();
  }

  /** Set this panel's size constraints */
  setConstraints(constraints: PanelConstraints) {
    this.constraints = constraints ?? {};
  }

  /** Used in the resize strategies -- strategy specific sizing constraints */
  setStrategyConstraints(constraints: PanelConstraints) {
    this.strategyConstraints = constraints ?? {};
  }

  /** Set the animation strategy for this panel */
  setAnimateStrategy(strategy: AnimateStrategy) {
    this._animateStrategy = strategy;
  }

  /** Set the draggable strategy for this panel */
  setDraggableStrategy(strategy: DraggableStrategy) {
    this._draggableStrategy = strategy;
  }

  /** Set the flatten strategy for this panel */
  setFlattenStrategy(strategy: FlattenStrategy) {
    this._flattenStrategy = strategy;
  }

  /** Set the resize strategy for this panel */
  setResizeStrategy(strategy: ResizeStrategy) {
    this._resizeStrategy = strategy;
  }

  /** Set if the current sizing strategy should turn off panel pushing */
  setPushPanels(val: boolean) {
    this._pushPanels = val;
  }

  /** Configure this panel based on the provided panel definition */
  setDefinition(val: SplitPanelDef<DType>) {
    this.setId(val?.id);
    this.setChildren(val?.children);
    this.setConstraints(val?.constraints);

    if (Array.isArray(val?.dataArray)) {
      this.setDataArray(val?.dataArray);
    } else {
      this.setData(val?.data);
    }

    this.setDirection(val?.direction);
  }

  /** Clear this panel's size info snapshot */
  clearSizeInfoSnapshot() {
    this.sizeInfoSnapshot = undefined;
  }

  /** Clear all size info snapshots of all direct children */
  clearChildSizeInfoSnapshot() {
    for (const item of this.children) {
      item.clearSizeInfoSnapshot();
    }
  }

  /** Snapshot this panel's current size info to aid in size calculations */
  snapshotSizeInfo() {
    this.sizeInfoSnapshot = cloneDeep(this.sizeInfo);
  }

  /** Snapshot the size info of all direct children */
  snapshotChildSizeInfo() {
    for (const item of this.children) {
      item.snapshotSizeInfo();
    }
  }

  /** Calculate a new size based on the current size and the value passed in */
  getAddSizeValue(val: ConstraintType) {
    const parsed = parseConstraint(val, this.comparativeSize);
    return this.sizeInfo.relative
      ? relativeToPercent(parsed.relativeValue + this.sizeInfo.relativeSize)
      : exactToPx(parsed.exactValue + this.sizeInfo.exactSize);
  }

  /** Add or remove from this panel */
  addSize(val: ConstraintType) {
    this.setSize(this.getAddSizeValue(val));
  }

  /** Set the size of this panel */
  setSize(
    /** The new size (can be in px or %) */
    val: ConstraintType,
  ) {
    const info = this.getSizeInfo(val);

    this.originalSize ??= val;
    this._size = parsedToFormatted(info);
  }

  /** Set the size of this panel and resize its siblings based on the resize strategy */
  resize(
    /** The new size (can be in px or %) */
    val: ConstraintType,
  ) {
    const needsSnapshot = !this.sizeInfoSnapshot;

    // Handle the case where we're resizing outside the context of a drag event
    if (needsSnapshot) {
      this.parent?.snapshotChildSizeInfo();
    }

    this.parent?.resizeStrategy?.(this, val);

    if (needsSnapshot) {
      this.parent?.clearChildSizeInfoSnapshot();
    }
  }

  async animateChildren(val?: ConstraintType, items?: SplitPanel<DType>[]) {
    this._animateStrategyData?.cancel?.();
    this.snapshotChildSizeInfo();

    const newItems = items ?? this.children;

    this._animateStrategyData = this.animateStrategy?.(this, newItems, val);
    await this._animateStrategyData?.promise;

    if (!this.animateStrategy) {
      const others = negateChildren(this, newItems);
      const parsed = val == null ? undefined : getSizeInfo({
        size: val,
        rectSize: this.contentRectSize,
        comparativeSize: this.contentRectSize,
      });

      for (const item of newItems) {
        item.setSize(parsed.formatted);
      }

      this.satisfyConstraints({ items: others });
    }

    this.clearChildSizeInfoSnapshot();
  }

  /** Animate this panel to a new size */
  async animateResize(val: ConstraintType) {
    await this.parent?.animateChildren(val, [this]);
  }

  /** Set all children to equal sizes */
  async equalizeChildrenSizes(options?: { recursive?: boolean }) {
    if (this.numChildren) {
      const promises = [this.animateChildren(relativeToPercent(1 / this.numChildren))];

      if (options?.recursive) {
        promises.push(...this.children.map((child) => child.equalizeChildrenSizes(options)));
      }

      await Promise.all(promises);
    }
  }

  /** Set all children to their original sizes */
  async resetChildrenSizes(options?: { recursive?: boolean }) {
    if (this.numChildren) {
      const promises = [this.animateChildren()];

      if (options?.recursive) {
        promises.push(...this.children.map((child) => child.resetChildrenSizes(options)));
      }

      await Promise.all(promises);
    }
  }

  async maximize() {
    return this.animateResize('100%');
  }

  async minimize() {
    return this.animateResize('0%');
  }

  /** Expand or collapse a panel */
  async toggleExpanded() {
    let target: SplitPanel<DType>;

    if (this.fullyExpanded) {
      target = this.siblingBefore;
      target ??= this.siblingAfter;
    } else {
      target = this;
    }

    await target?.maximize();
  }

  /** Calculate the new sizes for the panels without setting any new sizes */
  calculateSizes(
    options: {
      /** The item (or items) that will have their sizes set */
      item?: SplitPanel<DType> | SplitPanel<DType>[],
      /** The new size to apply to the item(s) passed */
      size?: ConstraintType,
      /** The items that should change sizes in response to the items that had their sizes set */
      itemsToConstrain?: SplitPanel<DType> | SplitPanel<DType>[],
    }
  ): Record<string, SizeInfoType> {
    const newItems = options?.itemsToConstrain ? [options.itemsToConstrain].flat().filter(Boolean) : undefined;
    const itemsToConsider = newItems || this.children;
    const sizeMap: Record<string, SizeInfoType> = {};

    const addToSizeMap = (child: SplitPanel<DType>, sizeInfo?: SizeInfoType) => {
      const newSizeInfo = sizeInfo?.parsedSize ? sizeInfo : child.sizeInfo;

      if (newSizeInfo?.parsedSize) {
        sizeMap[child.id] = newSizeInfo;
      }
    };

    for (const child of this.children) {
      addToSizeMap(child);
    }

    let leftToAllocate = this.rectSize;
    let itemsToSum = this.children;
    const itemsToSet = options.item ? [options.item].flat() : undefined;

    if (itemsToSet) {
      itemsToSum = negateChildren(this, itemsToSet);

      for (const item of itemsToSet) {
        const sizeInfo = item.getSizeInfo(options.size ?? item.originalSize);

        leftToAllocate -= sizeInfo?.exactSize ?? 0;
        addToSizeMap(item, sizeInfo);
      }
    }

    if (itemsToConsider.length === 0) {
      return sizeMap;
    }

    const diff = leftToAllocate - sumSizes(itemsToSum);

    if (newItems) {
      leftToAllocate -= sumSizes(negateChildren(this, newItems));
    }

    const getRemaining = (divideBy = 1) => {
      const fractionRemaining = leftToAllocate / this.rectSize;
      const relativeSize = fractionRemaining / divideBy;
      return (Number.isNaN(relativeSize) || !Number.isFinite(relativeSize)) ? undefined : relativeSize;
    };

    if (this.rectSize && Number.isFinite(this.rectSize)) {
      const remainingToObserve = new Set<SplitPanel<DType>>(itemsToConsider);
      // find the items with the smallest set size and address those first so the remaining items can be given more space
      const sortedItems: SplitPanel<DType>[] = sortBy(itemsToConsider, (item: SplitPanel<DType>) => item.parsedConstraints?.size);

      for (const item of sortedItems) {
        const remaining = relativeToPercent(getRemaining(remainingToObserve.size));
        const canGrow = item.canGrow && diff >= 0;
        const canShrink = item.canShrink && diff < 0;
        let newSize: SizeInfoType;

        if (!item.hasSize) {
          newSize = item.getSizeInfo(
            parsedToFormatted(item.parsedConstraints?.size)
            ?? remaining
          );
        } else if (canGrow || canShrink) {
          newSize = item.getSizeInfo(remaining);
        } else {
          newSize = item.sizeInfo;
        }

        if (newSize) {
          leftToAllocate -= newSize.exactSize;
          addToSizeMap(item, newSize);
        }

        remainingToObserve.delete(item);
      }
    }

    return sizeMap;
  }

  /** Satisfy the constraints for the given items, or all children if no items passed in */
  satisfyConstraints(
    options?: {
      items?: SplitPanel<DType> | Array<SplitPanel<DType>>,
    }
  ) {
    const sizeMap = this.calculateSizes({
      itemsToConstrain: options?.items,
    });

    for (const id of Object.keys(sizeMap)) {
      this.byId(id)?.setSize(sizeMap[id].formatted);
    }
  }

  private _addRootCb<T extends keyof CbMap>(el: HTMLElement, type: T, val: CbMap[T]) {
    if (!this.rootCallbacks.has(el)) {
      this.rootCallbacks.set(el, {});
    }

    const map = this.rootCallbacks.get(el);

    map[type] = val;
  }

  private _removeRootCb<T extends keyof CbMap>(el: HTMLElement, type: T) {
    const map = this.rootCallbacks.get(el);

    if (map) {
      map[type] = undefined;
    }
  }

  /** Attach a DOM element to this panel */
  attachEl(
    /** The element to attach */
    el: HTMLElement
  ) {
    if (el && this.containerEl !== el) {
      const toUnbind: Array<(() => void)> = [];

      this._unbindContainerEl?.();
      this.containerEl = el;

      if (this._observeElement) {
        toUnbind.push(() => {
          if (this.containerEl) {
            this.resizeObserver.unobserve(this.containerEl);
            this._removeRootCb(this.containerEl, 'resize');
          }
        });
        this._addRootCb(el, 'resize', this._onElementResize);
        this._addRootCb(el, 'mousemove', this._onMouseMove);
        this._addRootCb(el, 'mouseup', this._onMouseUp);
        this.resizeObserver.observe(el);
        this._debouncedSatisfyConstraints();
      }

      this._setupDraggable();
      this._unbindContainerEl = () => {
        for (const cb of toUnbind) cb();
      };
    }
  }

  attachDropZoneEl(el: HTMLElement) {
    if (el && this.dropZoneEl !== el) {
      this.dropZoneEl = el;
    }
  }

  attachGhostEl(el: HTMLElement) {
    if (el && this.ghostEl !== el) {
      this.ghostEl = el;
    }
  }

  /** Attach a DOM element to act as the content for this panel */
  attachContentEl(el: HTMLElement) {
    if (el && this.contentEl !== el) {
      this.contentEl = el;
    }
  }

  /** Attach a DOM element to act as the resize */
  attachResizeEl(
    /** The element to use as the resize or a css selector */
    el: HTMLElement
  ) {
    if (el && this.resizeEl !== el) {
      this._unbindResizeEl?.();
      this.resizeEl = el;

      if (this.resizeEl && this._observeElement) {
        this._addRootCb(this.resizeEl, 'resize', this._onResizeElResize);
        this.resizeObserver.observe(this.resizeEl);
        this.resizeEl.addEventListener('mousedown', this._onResizeElMouseDown);
        this.resizeEl.addEventListener('touchstart', this._onResizeElMouseDown);
        this.resizeEl.addEventListener('dblclick', this._onDblClick);
        this.resizeEl.addEventListener('mouseover', this._onMouseover);
        this.resizeEl.addEventListener('mouseout', this._onMouseout);

        this._unbindResizeEl = () => {
          if (this.resizeEl && this._observeElement) {
            this.resizeObserver.unobserve(this.resizeEl);
            this._removeRootCb(this.resizeEl, 'resize');
            this.resizeEl.removeEventListener('mousedown', this._onResizeElMouseDown);
            this.resizeEl.removeEventListener('touchstart', this._onResizeElMouseDown);
            this.resizeEl.removeEventListener('dblclick', this._onDblClick);
            this.resizeEl.removeEventListener('mouseover', this._onMouseover);
            this.resizeEl.removeEventListener('mouseout', this._onMouseout);
          }

          this.resizeEl = undefined;
        };
      }
    }
  }

  /** Create a child panel that inherits properties from this panel */
  private _createChild(item?: SplitPanelDef<DType>) {
    return SplitPanel.create<DType>({
      ...item,
      id: item?.id ?? makeUniqueId(),
      parent: this,
      root: this.root,
      observe: this._observeElement,
    });
  }

  /** Create multiple children. If the id conflicts with an existing id, it will be ignored. */
  private _createChildren(items: Array<SplitPanelDef<DType>>) {
    const children: Array<SplitPanel<DType>> = [];

    if (items) {
      for (const item of items) {
        const child = this._createChild(item);

        if (!this.childMap[child.id]) {
          children.push(child);
        }
      }
    }
    return children;
  }

  /** Add child panels */
  addChild(...items: Array<SplitPanelDef<DType>>) {
    const children = this._createChildren(items);

    this._children.push(...children);
    return children;
  }

  /** Add n new children with the given configuration */
  addNumChildren(num: number, def?: Omit<SplitPanelDef<DType>, 'id'>) {
    return this.addChild(...Array.from({ length: num }).map(() => ({
      ...def,
      id: makeUniqueId(),
    })));
  }

  /** Remove a child panel */
  removeChild(...ids: Array<string | SplitPanel<DType>>) {
    const removed: Array<SplitPanel<DType>> = [];

    if (ids.length > 0) {
      const toRemove = new Set(ids.map((item) => (typeof item === 'string' ? item : item?.id)));

      this._children = this._children.filter((item) => {
        const needsRemove = toRemove.has(item.id);

        if (needsRemove) {
          item.unbind();
          removed.push(item);
        }

        return !needsRemove;
      });
    }

    return removed;
  }

  /** Remove this panel from its parent */
  remove() {
    this.parent?.removeChild(this.id);
  }

  /** Remove n children from the end of the given configuration to match */
  removeNumChildren(num: number) {
    return this.removeChild(...this.children.slice(Math.max(this.children.length - num, 0)));
  }

  syncNumChildren(
    num: number,
    options?: {
      childTemplate?: SplitPanelDef<DType>,
    },
  ) {
    const diff = num - this.numChildren;
    const numToCreate = Math.max(diff, 0);
    const numToRemove = diff < 0 ? Math.abs(diff) : 0;
    let created: Array<SplitPanel<DType>>;
    let removed: Array<SplitPanel<DType>>;

    if (numToCreate) {
      created = this.addNumChildren(numToCreate, options?.childTemplate);
    } else if (numToRemove) {
      removed = this.removeNumChildren(numToRemove);
    }

    return {
      created: created || [],
      removed: removed || [],
    };
  }

  /** Set the children for this panel (will remove existing panels) */
  setChildren(items: Array<SplitPanelDef<DType>>) {
    this._children = this._createChildren(items);
  }

  private _unbindDraggable() {
    this._draggableStrategyReturn?.unbind?.();
    this._draggableStrategyReturn = null;
  }

  private _setupDraggable() {
    this._unbindDraggable();
    this._draggableStrategyReturn = this.draggableStrategy?.(this);
  }

  // ///////////////////////////////////////
  // Events
  // ///////////////////////////////////////

  private _onElementResize(data: ResizeObserverEntry) {
    this.setRect(resizeEntryToBoxRect(data));
  }

  private _onResizeElResize(data: ResizeObserverEntry) {
    this.setResizeRect(resizeEntryToBoxRect(data));
  }

  private _onResizeElMouseDown(e: MouseEvent | TouchEvent) {
    this.parent?.snapshotChildSizeInfo();
    this.dragPosStart = getCoordFromMouseEvent(e);
    e.preventDefault();
  }

  private _onMouseover() {
    this.hovering = true;
  }

  private _onMouseout() {
    this.hovering = false;
  }

  private _onMouseUp() {
    this.parent?.clearChildSizeInfoSnapshot();
    this.dragPosStart = undefined;
    this.dragPos = undefined;
    this.prevDragPos = undefined;
  }

  private _onMouseMove(e: MouseEvent) {
    if (!this.canResize) {
      return;
    }

    this.prevDragPos = this.dragPos;
    this.dragPos = getCoordFromMouseEvent(e);
    this.resize(relativeToPercent(this.relativeDragSize));
  }

  private async _onDblClick() {
    return this.toggleExpanded();
  }

  // ///////////////////////////////////////
  // Parent helpers
  // ///////////////////////////////////////

  private _setupRootIfNeeded() {
    if (this.isRoot && this._observeElement) {
      this._rootCallbacks = new WeakMap();
      this._resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          this.rootCallbacks.get(entry.target as HTMLElement)?.resize?.(entry);
        }
      });

      // MOUSE UP
      const onMouseUp = (e) => {
        this._cbAllChildren('mouseup', e);
      };

      document.addEventListener('mouseup', onMouseUp);
      document.addEventListener('touchend', onMouseUp);

      // MOUSE MOVE

      const onMouseMove = (e) => {
        this._cbAllChildren('mousemove', e, (child) => child.resizing);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('touchmove', onMouseMove);

      this._unbindRoot = () => {
        this._resizeObserver.disconnect();
        document.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('touchend', onMouseUp);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('touchmove', onMouseMove);
      };
    }
  }

  private _cbAllChildren<T extends keyof CbMap>(type: T, payload, filter?: ((child: SplitPanel<DType>) => boolean)) {
    for (const child of this.allChildren) {
      const result = filter?.(child);

      if (result ?? result === undefined) {
        this.rootCallbacks.get(child.containerEl)?.[type]?.(payload);
      }
    }
  }
}

export default SplitPanel;
