# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-05-14

### Breaking

- **Architecture**: rewritten on top of CSS Grid. JS no longer computes the pixels that CSS will re-derive; the runtime composes a single `grid-template-columns` / `-rows` string per container and the browser handles min/max via `clamp()` in the track string. Cuts the v0.x class of sizing-drift bugs at the root.
- **Vue API**: `<SplitGridView>` takes flat props (`id`, `direction`, `bounds`, `children`) instead of a nested `:root` object. Imperative API moved from a template-ref `SplitGridViewApi` to a `SplitGridHandle` facade resolved by `useSplitGrid(id)` — durable across `v-if` / HMR, accessible from any descendant or ancestor without prop drilling.
- **Dependencies removed**: `@madronejs/core`, `lodash`, `animejs`, `sass`. Plain CSS and plain TypeScript.
- **DOM classes / CSS custom properties renamed**: `.split-panel*` → `.sp-container` / `.sp-panel` / `.sp-resizer`. The `--sp-size` custom property is gone; container sizing is direct (`width: 100%; height: 100%`). Consumer overrides written against the old names need updating.

### Added

- **`<SplitContainer>`**: nested container component for declarative trees with mixed row/column subtrees.
- **`#leaf` / `#resizer` slots**: scoped slot data with reactive `PanelState` / `ResizerState` — per-panel state (`isMaximized`, `isAtDefault`, `isDragging`, `childSizes`, ...) updates live without manual subscriptions.
- **Draggable plugin**: opt-in `configureDraggable` (or `<SplitGridView :draggable>`) with `ghostRender` / `ghostMaxSize` / `ghostMinSize` / `ghostAnchor` / `canDrag` / `canDrop` / `onDrop` / `onDragChange` hooks.

### Fixed

- The bug class behind v0.x: percentage drift between JS and CSS, px-sibling overflow after maximize/minimize, drag-flash mid-resize, slot-content clicks getting swallowed by the resizer's drag handler, and the Vuetify-v4 cascade interaction where `width: var(--sp-size)` resolved to `auto` and panels failed to fill their container.
