import cloneDeep from 'lodash/cloneDeep';
import debounce from 'lodash/debounce';
import differenceBy from 'lodash/differenceBy';
import uniqBy from 'lodash/uniqBy';
import orderBy from 'lodash/orderBy';
import uniqueId from 'lodash/uniqueId';
import { computed, reactive, watch } from '@madronejs/core';
import { v4 as uuid } from 'uuid';

import {
  MouseEventCallback,
  SplitPanelArgs,
  PanelConstraints,
  BoxCoord,
  BoxRect,
  PanelDirection,
  ResizeStrategy,
  SplitPanelDef,
  SizeInfoType,
  FlattenStrategy,
  ResizeFn,
  ResizeObserverCallback,
  AnimateStrategy,
  DraggableStrategy,
  DraggableStrategyReturn,
  ConstraintType,
  AnimateStrategyReturn,
  SizeInfoOptions,
  SiblingRelation,
  StylePrefix,
  BoxDims,
} from './interfaces';
import {
  getDistance, getDirectionInfo, htmlElementToBoxRect, getCoordFromMouseEvent, resizeEntryToBoxRect,
} from './utilRect';
import { getChildInfo, negateChildren } from './utilChild';
import { flattenDepthFirst } from './flatten';
import { resizeNeighbors } from './resize';
import {
  relativeToPercent, parsedToFormatted, parseConstraint, parsePanelConstraints, exactToPx,
} from './utilParse';
import { mergePanelConstraints } from './utilConstraint';
import { sumSizes, sumMinSizes, withinTolerance } from './utilMath';
import {
  getSizeInfo,
  rebalanceSizes,
} from './utilCalc';
import { sortPanels } from './utilSort';

type CbMap = {
  resize?: ResizeObserverCallback,
  mousemove?: MouseEventCallback,
  mouseup?: MouseEventCallback,
  visibilitychange?: EventListener,
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
    this._onContentElResize = this._onContentElResize.bind(this);
    this._onDblClick = this._onDblClick.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseover = this._onMouseover.bind(this);
    this._onMouseout = this._onMouseout.bind(this);
    this._onVisibilityChange = this._onVisibilityChange.bind(this);
    this.unbind = this.unbind.bind(this);
    this.attachEl = this.attachEl.bind(this);
    this.attachContentEl = this.attachContentEl.bind(this);
    this.attachResizeEl = this.attachResizeEl.bind(this);
    this.attachDropZoneEl = this.attachDropZoneEl.bind(this);
    this.attachGhostEl = this.attachGhostEl.bind(this);
    this.toggleDisabled = this.toggleDisabled.bind(this);
    this.setDisabled = this.setDisabled.bind(this);
    this._removeChildrenCallbacks = new Set();
    this._addChildrenCallbacks = new Set();

    // This._onElementClick = this._onElementClick.bind(this);
    // setup
    this._children = [];
    this._readyCallbacks = new Set();
    this._root = options?.root;
    this._observeElement = options?.observe ?? true;
    this.order = options?.order ?? null;
    this.resizeEl = null;
    this.contentEl = null;
    this.containerEl = null;
    this.queueRerender = debounce(this.satisfyConstraints.bind(this));
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
    this.setEnabledSizer(options?.enabledSizer);
    this.setDisabled(options?.disabled ?? false);
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
  /** The content element rect */
  @reactive contentElRect: BoxRect;
  /** Scroll dimensions of the content element */
  @reactive contentElScrollDims: BoxDims;
  /** Unbind the content el */
  @reactive private _unbindContentEl: () => void;
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
  /** If this panel is "disabled" (ie. omitted from the layout) */
  @reactive disabled: boolean = false;
  @reactive private _readyPromise: Promise<void>;
  @reactive private _syncReady: boolean = true;
  @reactive private _constraintsReady: boolean = false;
  @reactive private _readyCallbacks: Set<() => void>;
  @reactive private _enabledSizer: ResizeFn<DType>;
  @reactive private _removeChildrenCallbacks: Set<(panels: Array<SplitPanel<DType>>) => void>;
  @reactive private _addChildrenCallbacks: Set<(panels: Array<SplitPanel<DType>>) => void>;
  /**
   * The preferred display order of this panel in its parent panel.
   * If unset, will be in insertion order.
   * Strings will be cast to numbers.
   */
  @reactive order: number | string;

  @reactive private _showFirstResizeEl: boolean;
  /** Show the first resize element */
  @computed get showFirstResizeEl() {
    return this._showFirstResizeEl ?? this.parent?.showFirstResizeEl ?? false;
  }

  @computed get shouldShowResizeEl() {
    return !this.isFirstChild || Boolean(this.parent?.showFirstResizeEl);
  }

  /** If the panel's container element has a nonzero width and height */
  @computed get hasRect() {
    return Boolean(this.rect?.width && this.rect?.height);
  }

  /** If the panel has a width and height, and the initial constraints are satisfied */
  @computed get isReady() {
    return this._constraintsReady && this._syncReady && this.hasRect;
  }

  /** If the panel is ready and all children are ready */
  @computed get isDeeplyReady() {
    return this.isReady && this.children.every((child) => child.isDeeplyReady);
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

  @reactive private _direction: PanelDirection;

  /**
   * The inverse direction of the panel
   * @example
   * ```ts
   * const panel = SplitPanel.create({ direction: PanelDirection.Row });
   * console.log(panel.inverseDirection); // Column
   * ```
   */
  @computed get inverseDirection() {
    return this._direction === PanelDirection.Column ? PanelDirection.Row : PanelDirection.Column;
  }

  /** The direction the panel is split */
  @computed get direction(): PanelDirection {
    if (this.numChildren) {
      return this._direction ?? this.parent?.inverseDirection ?? PanelDirection.Row;
    }
    return this._direction ?? this.parent?.direction ?? PanelDirection.Row;
  }

  /**
   * The direction the content of the panel is split.
   * If not set, it will default to the panel's parent direction.
   */
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
    return getDistance(this.prevDragPos, this.dragPos, this.contentDirection) <= 0 ? SiblingRelation.Before : SiblingRelation.After;
  }

  /** Relative distance dragged compared to the parent container's size */
  @computed get relativeDragDistance() {
    return this.dragDistance / this.comparativeSize;
  }

  /** The relative size this panel should be based on the drag distance */
  @computed get relativeDragSize() {
    return this.relativeDragDistance + (this.sizeInfoSnapshot?.relativeSize ?? this.sizeInfo.relativeSize);
  }

  /** Queue a re-render after a debounce. */
  queueRerender: () => void;

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
    this._unbindContentEl?.();
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
    return orderBy(uniqBy(this._children, 'id'), (item) => Number(item.order)) || [];
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

  @computed private get _absoluteMinResizeElSize() {
    return Math.max(this.shouldShowResizeEl ? this.resizeElSize : 0, 0);
  }

  /** The absolute minimum size a panel can be */
  @computed get absoluteMin() {
    if (this.disabled) {
      return this._absoluteMinResizeElSize;
    }

    return Math.max(
      this.parsedUserConstraints.minSize?.exactValue || 0,
      this._absoluteMinResizeElSize,
    );
  }

  /** The absolute maximum size this panel can be while still respecting the minSizes of its siblings */
  @computed get absoluteMax() {
    if (this.disabled) {
      return this._absoluteMinResizeElSize;
    }

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

  /** If the current panel is collapsed */
  @computed get fullyCollapsed() {
    return this.sizeInfo.exactSize <= this.absoluteMin;
  }

  /** The current child panel that is fully expanded */
  @computed get expandedChild() {
    return this.children.find((child) => child.fullyExpanded);
  }

  /** The next child panel that can be fully expanded */
  @computed get nextExpandibleChild() {
    return this.expandedChild ? this.expandedChild.siblingAfter : this.children[0];
  }

  /** The previous child panel that can be fully expanded */
  @computed get prevExpandibleChild() {
    return this.expandedChild?.siblingBefore;
  }

  /** If all children are equal sizes */
  @computed get allChildrenEqual() {
    return this.children.every((child) => child.sizeInfo.exactSize === this.children[0].sizeInfo.exactSize);
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
    return parsePanelConstraints(this.disabled ? null : this.constraints, this.comparativeSize);
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

  /** Current scroll size in pixels */
  @computed get contentScrollSize() {
    return this.disabled ? 0 : this.contentElScrollDims?.[this.contentDirectionInfo.dimension] || 0;
  }

  /** The size this panel is compared to calculate relative size */
  @computed get comparativeSize() {
    if (this.isRoot) {
      return this.rectSize;
    }

    return this.parent?.rectSize;
  }

  /** Current resize element size in pixels */
  @computed get resizeRectSize() {
    return this.resizeElRect?.[this.directionInfo.dimension] || 0;
  }

  /** Current container element size in pixels */
  @computed get contentElRectSize() {
    return this.contentElRect?.[this.contentDirectionInfo.dimension] || 0;
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

  /** If the panel can be resized */
  @computed get canResize() {
    return !(this.isRoot || this.disabled) && (this.canGrow || this.canShrink);
  }

  /** If this panel can grow based on its constraints */
  @computed get canGrow() {
    return !this.disabled && !withinTolerance(this.sizeInfo.exactSize, this.sizeInfo.exactMax);
  }

  /** If this panel can shrink based on its constraints */
  @computed get canShrink() {
    return !this.disabled && !withinTolerance(this.sizeInfo.exactSize, this.sizeInfo.exactMin);
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
      style[`--${StylePrefix.Panel}size`] = formatted;

      if (this.canResize && !this.isFirstChild && (this.resizing || this.hovering)) {
        style[`--${StylePrefix.Panel}cursor`] = this.contentDirection === PanelDirection.Column ? 'row-resize' : 'col-resize';
      } else {
        style[`--${StylePrefix.Panel}cursor`] = null;
      }
    }

    style[`--${StylePrefix.Panel}opacity`] = this.isReady ? 1 : 0;
    style[`--${StylePrefix.Panel}min-size`] = (exactMin !== this.parent?.absoluteMin && Number.isFinite(exactMin)) ? exactToPx(exactMin) : null;
    style[`--${StylePrefix.Panel}max-size`] = (exactMax !== this.parent?.absoluteMax && Number.isFinite(exactMax)) ? exactToPx(exactMax) : null;

    // RESIZE ELEMENT STYLES
    style[`--${StylePrefix.PanelResize}size`] = this.isRoot || this._resizeElSize != null ? exactToPx(this.resizeElSize) : null;
    style[`--${StylePrefix.PanelResize}border`] = this.isRoot || this._resizeElBorderStyle != null ? this.resizeElBorderStyle : null;

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
    return this.parent?.children.slice(this.index + 1);
  }

  /** This panel's siblings */
  @computed get siblings() {
    return this.parent?.children?.filter((item) => item.id !== this.id) || [];
  }

  /** If any of this panel's siblings can be resized */
  @computed get siblingsResizable() {
    return this.siblings.some((item) => item.canResize);
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
  getSizeInfo(size?: ConstraintType, options?: Partial<Omit<SizeInfoOptions, 'size'>>): SizeInfoType {
    return getSizeInfo({
      size,
      parsedConstraints: this.parsedConstraints,
      rectSize: this.rectSize,
      comparativeSize: this.comparativeSize,
      ...options,
    });
  }

  /** The raw definition for this panel and all of its children */
  getRawDefinition(options?: { includeData?: boolean }): SplitPanelDef<DType> {
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
      const hadRect = this.hasRect;

      this.rect = val;

      if (!hadRect && this.hasRect) {
        this.queueRerender();
      }
    }
  }

  /** Set the current bounding box of this panel's resize bar */
  setResizeRect(val: BoxRect) {
    if (val) {
      this.resizeElRect = val;
    }
  }

  /** Set the current bounding box of this panel's content */
  setContentRect(val: BoxRect) {
    if (val) {
      this.contentElRect = val;
      this.setContentScrollDims();
    }
  }

  /** Set the current scroll dimensions of the content element */
  setContentScrollDims() {
    if (!this.contentEl) return;

    this.contentElScrollDims = {
      width: this.contentEl.scrollWidth,
      height: this.contentEl.scrollHeight,
    };
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

  /**
   * Set a resizer function that will determine the size of the panel when transitioning
   * from disabled to enabled
   * @param val The resize function
   */
  setEnabledSizer(val: ResizeFn<DType>) {
    this._enabledSizer = val;
  }

  /**
   * Disable this panel so that only the resize element is shown
   * @param val The new disabled state
   */
  setDisabled(val: boolean = true) {
    const disabled = !!val;

    if (this.disabled === disabled) return;

    const resizeFn = this._enabledSizer
      || ((panel) => parsedToFormatted(panel.parsedConstraints.size));

    this.disabled = disabled;

    const newSize = this.disabled ? 0 : resizeFn(this);

    if (newSize != null) {
      this.setSize(newSize);
      this.parent?.queueRerender();
    }
  }

  /** Toggle the disabled state of this panel */
  toggleDisabled() {
    this.setDisabled(!this.disabled);
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
  setDirection(direction: PanelDirection) {
    this._direction = direction;
    this.queueRerender();
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

  /**
   * Set child panel sizes
   * @param sizes Mapping of panel ids to their new sizes
   * @param options Options to change the resize behavior
   */
  async setChildrenSizes(sizes: Record<string, ConstraintType>, options?: { animate?: boolean }) {
    const sizeArray: ConstraintType[] = [];
    const panels: SplitPanel<DType>[] = [];

    for (const id of Object.keys(sizes || {})) {
      const panel = this.byId(id);

      if (panel && sizes[id] != null) {
        sizeArray.push(sizes[id]);
        panels.push(panel);
      }
    }

    if (options?.animate === false) {
      this.satisfyConstraints({ items: panels, size: sizeArray });
    } else {
      await this.animateChildren(sizeArray, panels);
    }
  }

  async animateChildren(val?: ConstraintType | ConstraintType[], items?: SplitPanel<DType>[]) {
    this._animateStrategyData?.cancel?.();
    this.snapshotChildSizeInfo();

    const newItems = items ?? this.children;

    this._animateStrategyData = this.animateStrategy?.(this, newItems, val);
    await this._animateStrategyData?.promise;

    if (!this.animateStrategy) {
      const others = negateChildren(this, newItems);
      const parsed = (val == null || Array.isArray(val))
        ? undefined
        : getSizeInfo({
            size: val,
            rectSize: this.contentRectSize,
            comparativeSize: this.contentRectSize,
          });

      let index = 0;

      for (const item of newItems) {
        const newSize = Array.isArray(val)
          ? getSizeInfo({
              size: val[index],
              rectSize: this.contentRectSize,
              comparativeSize: this.contentRectSize,
            })
          : parsed;

        item.setSize(newSize.formatted);
        index += 1;
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
      const sizeMap = this.calculateSizes({
        item: this.children,
        size: relativeToPercent(1 / this.numChildren),
      });
      const needsResize = this.children.some((item) => item.sizeInfo.relativeSize !== sizeMap[item.id]?.relativeSize);

      if (needsResize || options?.recursive) {
        const sizeArray = this.children.map((item) => sizeMap[item.id]?.formatted).filter(Boolean);
        const promises = [this.animateChildren(sizeArray, this.children)];

        if (options?.recursive) {
          promises.push(...this.children.map((child) => child.equalizeChildrenSizes(options)));
        }

        await Promise.all(promises);
      }
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

  /** Expand the next possible child panel */
  async maximizeNext() {
    await this.nextExpandibleChild?.maximize();
  }

  /** Expand the previous possible child panel */
  async maximizePrev() {
    await this.prevExpandibleChild?.maximize();
  }

  /**
   * Calculate the new sizes for the panels without setting any new sizes
   */
  calculateSizes(
    options?: {
      /** The item (or items) that will have their sizes set */
      item?: SplitPanel<DType> | SplitPanel<DType>[],
      /** The new size to apply to the item(s) passed */
      size?: ConstraintType | ConstraintType[],
      /** The items that should change sizes in response to the items that had their sizes set */
      itemsToConstrain?: SplitPanel<DType> | SplitPanel<DType>[],
      /** Ignore the current size of the panels and calculate what the panel should be */
      initialize?: boolean,
    }
  ): Record<string, SizeInfoType> {
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
    const itemsToConstrain = options?.itemsToConstrain ? [options.itemsToConstrain].flat().filter(Boolean) : undefined;
    const itemsToConsider = itemsToConstrain || negateChildren(this, itemsToSet);

    // We're explicitly setting the sizes of some panels here.
    if (itemsToSet) {
      itemsToSum = negateChildren(this, itemsToSet);

      const sizes: ConstraintType[] = [];

      for (const item of itemsToSet) {
        sizes.push(Array.isArray(options.size) ? options.size[itemsToSet.indexOf(item)] : options.size);
      }

      const { balancedSizes } = rebalanceSizes(
        sizes,
        this.rectSize,
        itemsToSum.map((item) => item.sizeInfo.exactMin)
      );
      let index = 0;

      for (const item of itemsToSet) {
        const bSize = balancedSizes[index];
        const sizeInfo = item.getSizeInfo(bSize ? bSize.exactValue : item.sizeInfo.formatted);

        leftToAllocate -= sizeInfo?.exactSize ?? 0;
        addToSizeMap(item, sizeInfo);
        index += 1;
      }
    }

    if (itemsToConsider.length === 0) {
      return sizeMap;
    }

    const diff = leftToAllocate - sumSizes(itemsToSum);
    const growing = diff >= 0;
    const shrinking = diff < 0;

    if (itemsToConstrain) {
      leftToAllocate -= sumSizes(negateChildren(this, itemsToConstrain));
    }

    const getRemaining = (divideBy = 1) => {
      const fractionRemaining = leftToAllocate / this.rectSize;
      const relativeSize = fractionRemaining / divideBy;
      return (Number.isNaN(relativeSize) || !Number.isFinite(relativeSize)) ? undefined : relativeSize;
    };

    if (this.rectSize && Number.isFinite(this.rectSize)) {
      const remainingToObserve = new Set<SplitPanel<DType>>(itemsToConsider);
      const sortedItems = sortPanels(itemsToConsider);

      for (const item of sortedItems) {
        const remaining = relativeToPercent(getRemaining(remainingToObserve.size));
        let newSize: SizeInfoType;

        if (!item.hasSize || options?.initialize) {
          newSize = item.getSizeInfo(
            parsedToFormatted(item.parsedConstraints?.size)
            ?? remaining
          );
        } else if ((item.canGrow && (growing || !itemsToConstrain)) || (item.canShrink && (shrinking || !itemsToConstrain))) {
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
      /** The new size to apply to the item(s) passed */
      size?: ConstraintType | ConstraintType[],
      /** Ignore the current size of the panels and calculate what the panel should be */
      initialize?: boolean,
    }
  ) {
    // If the panel has no rect, we can't satisfy constraints
    if (!this.hasRect) return;

    const sizeMap = this.calculateSizes({
      size: options?.size,
      itemsToConstrain: options?.items,
      initialize: options?.initialize,
    });

    for (const id of Object.keys(sizeMap)) {
      this.byId(id)?.setSize(sizeMap[id].formatted);
    }

    this._constraintsReady = true;
  }

  /** Recalculate the sizes of all children based on the current constraints */
  recalculate() {
    this.satisfyConstraints({ initialize: true });
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
      this._constraintsReady = false;

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
        this.setRect(htmlElementToBoxRect(el));
        this.resizeObserver.observe(el);
        this.queueRerender();
      }

      this._setupDraggable();
      this._unbindContainerEl = () => {
        for (const cb of toUnbind) cb();
      };
    }
  }

  /** Attach a DOM element to act as the drop zone for this panel */
  attachDropZoneEl(el: HTMLElement) {
    if (el && this.dropZoneEl !== el) {
      this.dropZoneEl = el;
    }
  }

  /** Attach a DOM element to act as the content for the drag ghost for this panel */
  attachGhostEl(el: HTMLElement) {
    if (el && this.ghostEl !== el) {
      this.ghostEl = el;
    }
  }

  /** Attach a DOM element to act as the content for this panel */
  attachContentEl(el: HTMLElement) {
    if (el && this.contentEl !== el) {
      this._unbindContentEl?.();
      this.contentEl = el;

      const toUnbind: Array<(() => void)> = [];

      if (this._observeElement) {
        this._addRootCb(this.contentEl, 'resize', this._onContentElResize);
        this.resizeObserver.observe(this.contentEl);

        toUnbind.push(() => {
          if (this.contentEl) {
            this.resizeObserver.unobserve(this.contentEl);
            this._removeRootCb(this.contentEl, 'resize');
          }
        });
      }

      this._unbindContentEl = () => {
        for (const cb of toUnbind) cb();
      };
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
        this.resizeObserver.unobserve(this.resizeEl);
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
  createChild(item?: SplitPanelDef<DType>) {
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
        const child = this.createChild(item);

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

    this._children = [...this._children, ...children];

    for (const cb of this._addChildrenCallbacks) cb(children);
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

    for (const cb of this._removeChildrenCallbacks) cb(removed);
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

  /** Add, update, or remove children based on the new configuration */
  syncChildren(items: Array<SplitPanelDef<DType>>, options?: { satisfyConstraints?: boolean }) {
    this._syncReady = false;

    const satisfyConstraints = options?.satisfyConstraints ?? true;
    const newItems: Array<SplitPanel<DType>> = [];
    const toRemove = differenceBy(this.children, items, 'id');

    for (const item of items) {
      const existing = this.childMap[item.id];

      if (existing) {
        existing.setDefinition(item);
        newItems.push(existing);
      } else {
        newItems.push(this.createChild(item));
      }
    }

    this._children = newItems;
    this.removeChild(...toRemove.map((item) => item.id));
    this._syncReady = true;

    if (satisfyConstraints) {
      this.satisfyConstraints();
    }

    return this._readyPromise;
  }

  private _unbindDraggable() {
    this._draggableStrategyReturn?.unbind?.();
    this._draggableStrategyReturn = null;
  }

  private _setupDraggable() {
    this._unbindDraggable();
    this._draggableStrategyReturn = this.draggableStrategy?.(this);
  }

  private _setupReadyPromise() {
    this._readyPromise = new Promise<void>((resolve) => {
      const dispose = this.onReady(() => {
        dispose();
        resolve();
      });
    });
  }

  /**
   * Listen for when the panel and all its children are ready
   * @param cb Callback to run when the panel is ready
   * @returns disposer
   */
  onReady(cb: () => void) {
    this._readyCallbacks.add(cb);
    return () => this._readyCallbacks.delete(cb);
  }

  /**
   * Listen for when this panel has children removed
   * @param cb Callback to run when children of this panel are removed
   * @returns Disposer function
   */
  onRemoveChildren(cb: (panels: Array<SplitPanel<DType>>) => void) {
    this._removeChildrenCallbacks.add(cb);
    return () => this._removeChildrenCallbacks.delete(cb);
  }

  /**
   * Listen for when this panel has children added
   * @param cb Callback to run when children are added to this panel
   * @returns Disposer function
   */
  onAddChildren(cb: (panels: Array<SplitPanel<DType>>) => void) {
    this._addChildrenCallbacks.add(cb);
    return () => this._addChildrenCallbacks.delete(cb);
  }

  // ///////////////////////////////////////
  // Events
  // ///////////////////////////////////////

  private _onVisibilityChange() {
    if (typeof document !== 'undefined' && document.visibilityState !== 'hidden') {
      this.queueRerender();
    }
  }

  private _onElementResize(data: ResizeObserverEntry) {
    this.setRect(resizeEntryToBoxRect(data));
  }

  private _onResizeElResize(data: ResizeObserverEntry) {
    this.setResizeRect(resizeEntryToBoxRect(data));
  }

  private _onContentElResize(data: ResizeObserverEntry) {
    this.setContentRect(resizeEntryToBoxRect(data));
  }

  private _onResizeElMouseDown(e: MouseEvent | TouchEvent) {
    // There are no other resizable panels, so this is a no-op
    // or if this is the first child, we don't want to resize
    if (!this.siblingsResizable || this.isFirstChild) return;

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
    if ((!this.canResize && !this.isFirstChild) || !this.siblingsResizable) {
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

      // WATCH DEEP READY
      const readyDisposer = watch(() => this.isDeeplyReady, (val, old) => {
        if (val && !old) {
          // READY
          for (const cb of this._readyCallbacks) {
            cb();
          }
        } else if (!val && old) {
          // NOT READY
          this._setupReadyPromise();
        }
      }, { immediate: true });

      // VISIBILITY CHANGE
      const onVisibilityChange = (e) => {
        this._cbAllChildren('visibilitychange', e);
      };

      document.addEventListener('visibilitychange', onVisibilityChange);

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
        document.removeEventListener('visibilitychange', onVisibilityChange);
        readyDisposer();
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
