// Side-effect import: the core grid CSS (`.sp-container`, `.sp-panel`,
// `.sp-resizer`, track templates, dragging/animation states). Without this
// import, Vite has no entry pulling `styles.css` into the build and the
// published `dist/splitpanel.css` ships empty of layout rules — `<style>`
// blocks from the Vue SFCs would be there, but consumers would see flat,
// un-gridded panels. Keep this first so it's clearly the side effect.
import './styles.css';

export { SplitGrid } from './SplitGrid';
export type {
  SplitGridConfig,
  LeafCtx,
  LayoutOptions,
  LayoutChangeEvent,
  LayoutChangeReason,
  LayoutListener,
  PanelSizeReport,
} from './SplitGrid';
export type {
  Bounds,
  Container,
  ContainerInput,
  Leaf,
  Length,
  LengthInput,
  Node,
  PanelDirectionInput,
  ResizerCtx,
  ResizerSpec,
} from './types';
export { isContainer, PanelDirection } from './types';
export { parseLength, formatLength } from './length';
export { trackString, trackForChild } from './track';
export { dragHandle } from './drag';
export { configureDraggable } from './draggable';
export type {
  DraggableConfig, DropEvent, DragChangeEvent, BoxCoord, GhostContext,
} from './draggable';
