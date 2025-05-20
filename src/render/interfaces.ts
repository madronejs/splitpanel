import {
  SplitPanelArgs,
  AnimateStrategy,
  DraggableStrategy,
  type SplitPanel,
  type SplitPanelDef,
} from '@/core';

export interface PanelScope<DType> {
  panel: SplitPanel<DType>,
}

export interface SplitPanelBaseSlots<DType> {
  content?: (scope: PanelScope<DType>) => any,
  resize?: (scope: PanelScope<DType>) => any,
  item?: (scope: PanelScope<DType>) => any,
  ghost?: (scope: PanelScope<DType>) => any,
  dropZone?: (scope: PanelScope<DType>) => any,
  [name: string]: ((...args: any[]) => any) | undefined, // Allow other slots
}

export interface SplitPanelViewSlots<DType> {
  resize?: (scope: PanelScope<DType>) => any,
  default?: (scope: PanelScope<DType>) => any,
  ghost?: (scope: PanelScope<DType>) => any,
  dropZone?: (scope: PanelScope<DType>) => any,
  [name: string]: (scope: PanelScope<DType>) => any,
}

export interface SplitPanelBaseProps<DType> {
  splitPanel: SplitPanel<DType>,
  manualUnbind?: boolean,
  manualSlots?: boolean,
}

export type ChildrenChangedEvent<DType> = {
  splitPanel: SplitPanel<DType>,
  type: 'add' | 'remove',
  children: SplitPanelDef[],
};

export interface SplitPanelViewProps<DType> extends Pick<
  SplitPanelArgs,
  'resizeElSize' | 'showFirstResizeEl' | 'direction'
> {
  itemId?: string,
  splitPanel?: SplitPanel<DType>,
  animateStrategy?: AnimateStrategy,
  draggableStrategy?: DraggableStrategy,
}

export interface SplitPanelItemProps<DType> extends Omit<SplitPanelDef<DType>, 'id' | 'dataArray' | 'children'> {
  /** Id of the panel. Will default to a uniquely generated id. */
  itemId?: string,
  /** Constrain the panel to fit the scroll size of the contents */
  constrainToScroll?: boolean,
  /** The order/index of this panel in the parent panel. */
  order?: number,
}

export interface SplitPanelItemSlots<DType> {
  default?: (scope: PanelScope<DType>) => any,
}
