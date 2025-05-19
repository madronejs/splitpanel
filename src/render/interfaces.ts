import {
  SplitPanelArgs,
  AnimateStrategy,
  DraggableStrategy,
  type SplitPanel,
  type SplitPanelDef,
} from '@/core';

export interface PanelScope {
  panel: SplitPanel,
}

export interface SplitPanelBaseSlots {
  content?: (scope: PanelScope) => any,
  resize?: (scope: PanelScope) => any,
  item?: (scope: PanelScope) => any,
  ghost?: (scope: PanelScope) => any,
  dropZone?: (scope: PanelScope) => any,
  [name: string]: ((...args: any[]) => any) | undefined, // Allow other slots
}

export interface SplitPanelViewSlots {
  resize?: (scope: PanelScope) => any,
  default?: (scope: PanelScope) => any,
  ghost?: (scope: PanelScope) => any,
  dropZone?: (scope: PanelScope) => any,
  [name: string]: (scope: PanelScope) => any,
}

export interface SplitPanelBaseProps {
  splitPanel: SplitPanel,
  manualUnbind?: boolean,
  manualSlots?: boolean,
}

export interface SplitPanelViewProps extends Pick<
  SplitPanelArgs,
  'resizeElSize' | 'showFirstResizeEl' | 'direction'
> {
  splitPanel?: SplitPanel,
  animateStrategy?: AnimateStrategy,
  draggableStrategy?: DraggableStrategy,
}

export interface SplitPanelItemProps extends Omit<SplitPanelDef, 'id' | 'dataArray' | 'children'> {
  /** Id of the panel. Will default to a uniquely generated id. */
  itemId?: string,
}

export interface SplitPanelItemSlots {
  default?: (scope: PanelScope) => any,
}
