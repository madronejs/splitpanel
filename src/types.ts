/**
 * Core types for the grid-based split panel.
 *
 * The model is deliberately minimal: a Length is either px or %, every node is
 * either a Leaf (carries data) or a Container (lays out children on one axis),
 * and Bounds carry size/min/max in those same Length units. CSS Grid does the
 * resolution and clamping at layout time — these types only describe intent.
 */

/**
 * Container layout axis. String-valued enum so:
 *   - `PanelDirection.Row` is the canonical, autocomplete-friendly form.
 *   - Runtime value is `'row'` / `'column'` (what CSS Grid expects), so
 *     `el.dataset.direction = direction` and template-string equivalents
 *     keep working without unwrap calls.
 *   - Tree-shakeable like any other module export (we don't use
 *     `const enum`, which `isolatedModules` rejects).
 *
 * Public input types use `PanelDirectionInput` (below), which accepts
 * either the enum member or the bare string literal — string enums in
 * TypeScript are nominal, so a `setDirection('row')` call from outside
 * the library would otherwise be a `TS2345` even though `'row'` is
 * literally what the enum holds. The string-literal form is the
 * DX-friendly fallback for callers who don't want the enum import.
 */
export enum PanelDirection {
  Row = 'row',
  Column = 'column',
}

/**
 * Either the enum member (`PanelDirection.Row`) or the bare string
 * literal (`'row'`). Use this at every public API boundary that takes
 * a direction from the caller; internal storage keeps the enum form,
 * which the strict comparison (`x === PanelDirection.Row`) handles
 * uniformly since both sides are the same runtime string.
 *
 * Spelled as a template-literal type so the union stays in sync with
 * the enum automatically: adding `Diagonal = 'diagonal'` to the enum
 * would expand `PanelDirectionInput` without a manual edit here.
 */
export type PanelDirectionInput = PanelDirection | `${PanelDirection}`;

/**
 * A user-supplied size value: number (px), `'<n>px'`, `'<n>%'`, or `'auto'` (fill).
 *
 * The `(string & {})` branch lets dynamic strings (e.g. a computed value of
 * type `string | undefined`) bind to `:size` / `:min` / `:max` without a
 * cast — the runtime parser is tolerant and falls back to the default for
 * unparseable values. The template-literal members still drive IDE
 * autocomplete for literal arguments.
 */
export type LengthInput = number | `${number}px` | `${number}%` | 'auto' | (string & Record<never, never>);

/** Internal normalized length. `unit: 'fr'` represents `'auto'` (one flex share). */
export type Length = | { unit: 'px', value: number }
  | { unit: 'pct', value: number }
  | { unit: 'fr', value: number };

export interface Bounds {
  /** Default/current track size. Defaults to `'auto'` (1fr). */
  size?: LengthInput,
  /** Lower bound enforced via CSS `clamp()`/`minmax()`. */
  min?: LengthInput,
  /** Upper bound. Ignored on `'auto'` tracks (composition with `1fr` is lossy). */
  max?: LengthInput,
}

export interface Leaf<T = unknown> {
  id: string,
  data?: T,
  bounds?: Bounds,
}

export interface ResizerSpec {
  /** Track size of the divider between two children. Defaults to `6px`. */
  size?: LengthInput,
  /**
   * Optional render hook called once when the divider element is created.
   * Mutate `el` to add content/classes.
   */
  render?: (el: HTMLElement, ctx: ResizerCtx) => void,
  /**
   * Render a leading resizer track BEFORE the first child. Decorative —
   * not bound to drag because there's no panel before it. Matches the
   * legacy `showFirstResizeEl` slot used to put per-section chrome around
   * each panel. Default: `false`.
   */
  first?: boolean,
  /**
   * Render a trailing resizer track AFTER the last child. Also decorative,
   * symmetric with `first`. Default: `false`.
   */
  last?: boolean,
}

export interface ResizerCtx {
  /**
   * Handle index within its container. `1..(children.length-1)` for normal
   * dividers between siblings; `-1` for the optional leading edge resizer
   * (when `resizer.first` is true); `children.length` for the trailing edge.
   */
  index: number,
  /**
   * Node immediately before this divider. `undefined` for the leading
   * decorative resizer (there's no panel before the first child).
   */
  before: Node | undefined,
  /**
   * Node immediately after this divider. `undefined` for the trailing
   * decorative resizer.
   */
  after: Node | undefined,
}

export interface Container<T = unknown> {
  id: string,
  direction: PanelDirectionInput,
  children: Array<Node<T>>,
  /** How this container sits inside its parent. Ignored on the root. */
  bounds?: Bounds,
  /** Divider spec used between children of this container. */
  resizer?: ResizerSpec,
}

/**
 * User-facing input type for declarative APIs (the `<SplitGridView>`
 * `root` prop, etc.) where `children` is optional — declarative
 * `<SplitPanel>` slot children will register themselves via inject
 * channel, so the consumer's root object doesn't need to spell out an
 * empty array. The runtime normalizes via `?? []` on intake.
 *
 * The internal `Container` keeps `children` required because every
 * `ContainerState` always has its children array populated post-mount.
 */
export interface ContainerInput<T = unknown> {
  id: string,
  direction: PanelDirectionInput,
  children?: Array<Node<T>>,
  bounds?: Bounds,
  resizer?: ResizerSpec,
}

export type Node<T = unknown> = Leaf<T> | Container<T>;

export const isContainer = <T>(n: Node<T>): n is Container<T> => 'children' in n && Array.isArray((n as Container<T>).children);
