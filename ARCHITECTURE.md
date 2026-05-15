# Architecture

How this library actually works, top to bottom. Read after the README.

## The core idea: CSS Grid is the source of truth

A `SplitGrid` container is one DOM element with `display: grid` and a single
inline custom property `--sp-tracks`:

```html
<div class="sp-container" data-direction="row"
     style="--sp-tracks: 220px 6px minmax(0px, 1fr) 6px clamp(80px, 30%, 400px)">
  <div class="sp-panel" data-id="a"></div>
  <div class="sp-resizer" data-handle="1"></div>
  <div class="sp-panel" data-id="b"></div>
  <div class="sp-resizer" data-handle="2"></div>
  <div class="sp-panel" data-id="c"></div>
</div>
```

```css
.sp-container[data-direction="row"] {
  grid-template-columns: var(--sp-tracks);
  grid-auto-rows: 100%;
  transition: grid-template-columns 750ms cubic-bezier(.77, 0, .175, 1);
}
```

The browser does all the layout, animation, and clamping. JS only writes the
`--sp-tracks` string — typically once per drag frame, once per programmatic
size change, never per child element.

That gives you a very small surface: **whoever writes `--sp-tracks` controls
the world.** The whole runtime is one giant funnel into `writeTracks()`.

## The data model

Three core types in [`src/types.ts`](./src/types.ts):

```ts
enum PanelDirection { Row = 'row', Column = 'column' }

type LengthInput = number | `${number}px` | `${number}%` | 'auto' | string;
type Length = { unit: 'px' | 'pct' | 'fr', value: number };

interface Leaf<T = unknown> {
  id: string;
  data?: T;
  bounds?: { size?: LengthInput, min?: LengthInput, max?: LengthInput };
}

interface Container<T = unknown> {
  id: string;
  direction: PanelDirection;
  children: Array<Node<T>>;     // required internally
  bounds?: Bounds;
  resizer?: ResizerSpec;
}

interface ContainerInput<T = unknown> {
  id: string;
  direction: PanelDirection;
  children?: Array<Node<T>>;    // optional — for declarative APIs
  bounds?: Bounds;
  resizer?: ResizerSpec;
}
```

`PanelDirection` is a real string enum: `'row'` literals don't typecheck
at TS-checked call sites. Template-string scope (`<SplitGridView :root="{
direction: 'row', ... }">`) still passes the string at runtime — Vue
templates aren't fully type-checked the same way as TS files.

`Container` and `ContainerInput` are the same shape except `children`:
`ContainerInput`'s is optional, used by `<SplitGridView>`'s `root` prop
because declarative `<SplitPanel>` slot children register themselves
during setup. The wrapper normalizes via `?? []` before handing the
definition to `new SplitGrid()`, which sees the strict `Container`.

The `bounds` on a `Leaf` describes the leaf's *slot* in its parent's axis —
not the leaf's content size. `bounds.size` is the *initial* size; the runtime
remembers a `sizes: Length[]` array on each container that the user (or
imperative API) has since adjusted. The `bounds.size` field is the
"definition" anchor that `reset()` restores to and `isAtDefault()` compares
against.

`Length` has three normalized units:

- `'px'` — fixed.
- `'pct'` — percentage. Resolved by CSS against the **full grid container
  axis**, including resizer tracks. Internally always stored as
  *containerAxisPx-relative* (see "Two denominators" below).
- `'fr'` — flex share. Represents `'auto'` input. Emitted to the track string
  as `minmax(<min>, 1fr)`. Whenever a layout op needs to do exact math on a
  panel currently in `fr` units, `freezeFrTracks` converts it to `pct` first.

## The runtime: `SplitGrid` ([`src/SplitGrid.ts`](./src/SplitGrid.ts))

Owns:

- `byId: Map<string, NodeState>` — flat index for O(1) lookups.
- `rootEl: ContainerState` — the root container's runtime state (DOM el,
  current sizes, maximize state, availPx).
- `dragStates: WeakMap<HTMLElement, PointerDragState>` — per-resizer
  pointer-event adapters, disposed when their element detaches.
- `subscribers: Set<LayoutListener>` — fanout for `onChange` events.

Public methods fall into three groups:

### Structural

- `addChild(parentId, def, index?)`
- `removeChild(id)`
- `swap(idA, idB)` — moves nodes between positions (and between containers).
- `syncChildren(containerId, defs)` — diff against current children, emit
  add/remove/swap as needed.

All four route through `mutateStructure(c, fn)`, a private helper that
wraps the per-container boilerplate every structural mutation needs:
detach resizers → run the mutator → renormalize pct sizes → clear max
state → reindex `indexInParent` → rebuild resizers → writeTracks with
`animate: false`. Cross-parent swap calls it twice (once per affected
parent). Adding a new structural method gets these steps for free —
critically, without forgetting to clear the maximize snapshot or
renormalize pct sizes after the track count changes.

### Sizing

- `setSize`, `setBounds`, `equalize`, `reset` — direct manipulation.
  `setSize` and `setBounds` short-circuit on reference-equal inputs to
  defend against Vue's shallow-watcher recursion.
- `maximize`, `minimize`, `toggleMaximize` — single-panel state changes.
  Both `maximize` and `toggleExpand` record `parent.max = { id,
  restore: Length[] }` (a snapshot of sizes pre-maximize) so `isMaximized`
  reflects the state and `toggleExpand` can revert. `minimize` (and the
  reverting half of `toggleExpand`) clear `parent.max` back to `null`.
  The "at most one maximized child per container" invariant is
  structural — `max` is a single field, not a Map.
- `toggleExpand` — alternates "maximize ↔ restore prior layout via snapshot".
- `expandNext` / `expandPrev` — walk the maximize state forward/back through
  a container's children.

### Data

- `setData`, `setDataArray`, `swapData`, `moveData` — change `leaf.data`
  without touching positions. Drag-drop uses these.

### Queries

- `get(id)`, `getSize(id)`, `isMaximized`, `isAtDefault`, `getRawDefinition`.
- `settle(containerId?, opts?)` — `Promise<void>` that resolves on
  `transitionend` for the affected container(s), with a timeout fallback so
  you never hang on a no-op write.

## The freeze/animate dance

This is the trickiest invariant to keep straight.

CSS can interpolate between two `length-percentage` track values smoothly
(e.g. animating `200px` → `50%`). It **cannot** smoothly interpolate between
a `length-percentage` and a flex-fr value (e.g. `minmax(0, 1fr)` → `max(0, 50%)`)
— the two CSS function shapes are different, so the browser falls back to a
discrete jump. Mid-animation you see a flash of container background.

So before any animation that crosses that boundary, `freezeFrTracks(c)`:

1. Reads each child's current rendered px size via `getBoundingClientRect`.
2. Converts to `pct` relative to the full container axis.
3. Writes those concrete pct sizes into `c.sizes`.
4. Sets `data-no-animate` on the container, calls `writeTracks`, then forces
   a synchronous layout flush by reading `offsetWidth`, then removes
   `data-no-animate`.
5. The caller then does its animated write.

The result: animation always goes pct → pct, smoothly.

`data-no-animate` is also set transiently by `addChild` / `removeChild` /
`swap` — the track *count* changes there, and CSS can't animate between
different numbers of tracks. The snap is intentional.

`data-dragging` does the same thing for live drag — every pointermove fires
a `writeTracks` and we don't want the transition to chase the cursor.

## The percentage denominator (and how the brand keeps it honest)

CSS Grid resolves percentage track values against the **full grid
container** (`width` / `height`), including resizer tracks. The runtime
must agree — anything resolving a `pct` length against a different
denominator drifts versus what CSS paints.

| What                | Denominator         |
|---------------------|---------------------|
| `bounds.min` / `bounds.max` resolution | `containerAxisPx` |
| `setSize(id, '50%')` resolution        | `containerAxisPx` |
| Stored `pct` sizes in `c.sizes`        | `containerAxisPx` |
| Sibling-rebalance budget               | `availPx` (content area = container − resizer tracks) |

The first three rules used to mix denominators — that was the bug
shape this codebase kept almost re-introducing. Now everything that
resolves a pct to px uses `containerAxisPx`. The sibling-rebalance
math in `applyTargetSize` uses `availPx` only for the budget split
(how much room siblings get after the target takes its share), not
for resolving any specific length.

To stop the bug from coming back: `ContainerAxisPx` is a **branded
type** (nominal `number`) in `length.ts`. `toPx`, `pxToPct`,
`clampToBounds`, `boundsMinPx`, `parseLengthToPxAxis`,
`resizerTracksPx`, `dragHandle`'s axis param, and `PointerDragState`'s
internal `containerAxisPx` field all take `ContainerAxisPx`, not
`number`. Producers stamp at the boundary via `asContainerAxis(n)`.
A careless `toPx(l, parent.availPx)` is a compile error.

The browser project also runs a property test (`invariant.browser.spec.ts`)
that asserts "rendered tracks sum to container width within ±3px" after
random sequences of public layout ops (8 op kinds, 1–12 ops per
sequence, 40 runs). fast-check's shrinker turns any new drift into a
minimal repro automatically — it has already caught two real bugs
(`absorbVacancy` leaving 988px of dead space when the removed panel was
maximized; `makeRoom` scaling pct sizes below their `bounds.min`,
producing 4px CSS-vs-JS divergence).

`resizerTracksPx(c, axisPx)` returns the total resizer-track budget. It
counts:

- `(children.length − 1)` inner dividers.
- `+1` if `resizer.first` and there's at least one child.
- `+1` if `resizer.last`.

Same formula `trackString` uses to build the actual track string — they
must stay in lockstep, or `availPx` (which `refreshAvail` and `measureAll`
derive as `containerAxisPx − resizerTracksPx`) reports a budget that
disagrees with what CSS leaves the content tracks.

### Iterative pin-and-reshare

Two layout ops use the same shape of algorithm: `equalize` and `makeRoom`.
Both have to distribute a pct budget across N children while honoring
each child's `bounds.min` as a floor:

1. Compute a candidate share = `budget / freeCount`.
2. Any free child whose min pct exceeds the share pins at its min; remove
   from free set; subtract its min from the budget.
3. Repeat until no more pinning is needed.
4. All remaining free children get the same final share.

Without the iterative pinning, naive proportional scaling lets a child's
stored pct fall below its `bounds.min`. CSS then clamps the rendered
track up to the min while the runtime believes the stored value is the
truth — the rendered total overflows the container by the gap. This is
the bug shape the property test caught in `makeRoom`.

## The drag

Two layers: the pure math in `drag.ts` and the pointer-event adapter in
`pointerDrag.ts`.

### `drag.ts` — pure push-cascade with LIFO recovery

A pure function: given current px sizes, the drag-start snapshot, a handle
index, and a delta, return how much was actually applied and mutate the
sizes array in place. No DOM, no state outside the arguments.

1. **Plan grow side.** Walk outward from the handle on the grow side,
   accumulating each panel's *deficit* relative to its drag-start snapshot.
   These are panels that were shrunk earlier in the drag and have room to
   restore. Reverse the order so we restore furthest-first — that gives the
   "last shrunk, first restored" UX users expect when reversing direction.
2. **Plan shrink side.** Walk outward from the handle on the shrink side,
   accumulating each panel's room above its min. Closest-first.
3. **Transfer `min(want, growCap, takeCap)`** from one side to the other.
   Any leftover after restoring snapshots flows into expanding the
   immediate neighbor past its snapshot, up to its `max`.

### `pointerDrag.ts` — `PointerDragState` class

Owns the pointer-event lifecycle around the pure math. Replaced an
inline 80-line closure in `SplitGrid.attachDrag` whose three weaknesses
were:

- The `pointerup`-only cleanup leaked global listeners on `pointercancel`,
  window blur, and mid-drag DOM detach.
- Closure state couldn't be inspected from tests without a real grid.
- No explicit lifecycle.

`PointerDragState` has an `idle ↔ active` lifecycle and a single
`end(reason)` cleanup funnel. Termination routes: `'up'` | `'cancel'` |
`'blur'` | `'unmount'`. All four call `end`, which releases pointer
capture, clears `data-dragging`, and removes every global listener.

SplitGrid stores instances in a `WeakMap<HTMLElement, PointerDragState>`
keyed by resizer element and disposes them in `detachResizers`. Full-grid
teardown walks every `.sp-resizer` in the host and disposes — necessary
because the WeakMap entries are still reachable via JS until the elements
GC, and we don't want their global listeners hanging around in that window.

The adapter takes a `DragAdapter` interface (resizer-track px math,
child-element lookup, post-apply hook, optional log) so the class
doesn't depend on `SplitGrid` directly. Tests in `pointerDrag.dom.spec.ts`
supply a stub adapter and dispatch synthetic PointerEvents.

## The Vue wrapper ([`src/vue/`](./src/vue/))

Three components:

### `<SplitGridView>`

A real `<div class="sp-vue-host">` (NOT `display: contents` — that prevents
devtools highlighting and breaks any `class="w-100 h-100"` the consumer
applies). Owns a `SplitGrid` instance and four `shallowReactive` collections:

- `leafEntries: Map<id, { el, leaf }>` — leaf DOM elements created by the
  runtime, paired with their `<SplitPanel>` definition.
- `resizerEntries: Map<key, { el, state }>` — divider elements + adjacent
  node info, keyed by `${containerId}#${handleIdx}`.
- `panelStates: Map<id, PanelState>` — reactive per-panel state
  (`isMaximized`, `isDragging`, `size`, container-only `childSizes` /
  `maximizedChildId`, etc.) that the `#leaf` slot scope reads.
- `ownedResizers: Set<key>` — divider keys claimed by a `<SplitPanel>`'s
  per-panel `#resizer` slot so the wrapper-level slot can skip them
  without double-teleporting.

Template: a hidden `<div class="sp-vue-declarative">` collects the default
slot (where consumers put their `<SplitPanel>`s) — the components instantiate
their setups and register, but their visual output is `display: none`. Then
`<Teleport>` pairs ship slot content from `<SplitPanel>` into the matching
leaf element, and from `#leaf` / `#resizer` into the runtime-created DOM.

The `provide`/`inject` channel publishes a `SplitGridContext` so child
components can call `useSplitGrid()` / `usePanelState(id)` without prop
drilling, plus a `ChildRegistry` so nested `<SplitPanel>` / `<SplitContainer>`
can register themselves with their nearest enclosing container.

**Parent components** (the consumer that mounts `<SplitGridView>` itself)
can't `inject`, so the ref-exposed `getPanelState(id)` is the equivalent
hook for that side. It reads from the same reactive `panelStates` map, so
a `computed(() => gridRef.value?.getPanelState('root'))` in the parent
re-runs on every layout change that touches the id. The dashboard
consumer uses this for toolbar disabled-state computeds (`childSizes`,
`maximizedChildId`).

### `<SplitPanel>`

On setup:

1. Injects the nearest `ChildRegistry`.
2. Resolves an id (explicit `panelId` prop or auto-generated from the Vue
   instance uid).
3. Builds a `Leaf` def from props.
4. Calls `registry.registerChild(leaf)` — which either pushes into the
   wrapper's `pendingChildren` (before mount) or dispatches to
   `grid.addChild` (after mount).
5. `onBeforeUnmount`: calls `unregisterChild(id)`.

Two `<Teleport>`s render the slot content:

- Default slot (`<slot :panel="state" />`) into the leaf element the
  runtime created.
- `#resizer` slot into the leading divider (the divider between this panel
  and its previous sibling, or the `resizer.first` edge for the first
  child). Ownership is published to `context.ownedResizers` so the
  wrapper-level `#resizer` slot skips dividers a panel has claimed.

Shallow watchers on `size`/`min`/`max`/`data` propagate prop changes to
`grid.setBounds` and `grid.setData`. **Never bind an inline object literal**
to `:data` — every render creates a new reference, the watcher fires,
`setData` re-renders the wrapper, and you loop. Use a `ref` or `computed`
so reference equality holds when nothing changed.

### `<SplitContainer>`

A nested container node. Same registration pattern: registers with its
enclosing `ChildRegistry` as a `Container` def, then publishes its OWN
`ChildRegistry` for any `<SplitPanel>`s inside it. The pending-children
buffer at this level becomes the container's `children` array at mount.

### Why `Teleport`

It would be simpler to render slot content into the `<SplitPanel>`'s own
DOM and have the runtime move it. But:

- The runtime creates the leaf element with the right class, dataset
  attributes (`data-id`, etc.), and grid-item positioning.
- Vue owns the slot vnode lifecycle. Moving DOM around behind Vue's back
  breaks unmount cleanup.

Teleport gives us both: Vue keeps the vnode tree consistent (and cleans up
on unmount), while the actual DOM child lives where the runtime wants it.

## The CSS layer ([`src/styles.css`](./src/styles.css))

About 140 lines of plain CSS. Two responsibilities:

1. **Geometry.** `.sp-container { display: grid; transition: grid-template-*
   …; }` plus direction-keyed track templates and the `data-no-animate` /
   `data-dragging` opt-outs.
2. **Default indicator.** `.sp-resizer-handle` is a real centered `<div>`
   (not a `::before` pseudo — that prevented the handle from receiving its
   own dblclick if we wanted to). Themable via `--sp-indicator-*` CSS
   variables.

Hiding the default handle when a consumer teleports custom content into a
divider: `.sp-resizer:has(> *:not(.sp-resizer-handle)) > .sp-resizer-handle
{ display: none; }`. Vue's `<Teleport>` puts slot children directly into
the target, so `:has()` is a reliable "the consumer customized this"
signal.

The host wrapper (`.sp-vue-host`) is a real block element with
`width: 100%; height: 100%; min-*: 0; position: relative` — consumer
classes (`w-100`, flex utilities) attach to a box, devtools can highlight
it, and the inner grid container has a defined parent to size against.

## Layout-change events

Every state-mutating method calls `this.emit(reason, container, nodeIds)`,
which fans out to subscribers and the configured `onChange` callback.

```ts
interface LayoutChangeEvent {
  containerId: string;
  nodeIds: string[];     // empty for "everyone in the container" events
  reason: 'drag' | 'set-size' | 'set-bounds' | 'maximize' | 'minimize'
        | 'toggle-expand' | 'equalize' | 'reset' | 'add-child'
        | 'remove-child' | 'swap' | 'set-direction' | …
}
```

The Vue wrapper subscribes once and translates these into reactive map
updates — refreshing only the panel states the event touched.

`freezeFrTracks` deliberately does NOT emit a change event; it's a
measurement-only intermediate step on the way to the real change, and
emitting from it would double-fire.

## Build

Vite library mode, two entry points:

- `splitpanel` — the framework-free core. Imports `./styles.css` as a side
  effect so the published `dist/splitpanel.css` actually ships the layout
  rules. (Nothing else imports the stylesheet; without this side effect the
  CSS bundle is empty.)
- `vue` — the Vue 3 wrapper. `external: ['vue']` so we never bundle Vue.

Both produce ESM + CJS + `.d.ts`. The Vue SFCs' `<style>` blocks merge into
the same `dist/splitpanel.css` (Vite's `cssFileName: 'splitpanel'`).

## Don'ts (load-bearing invariants)

- **Don't reintroduce `lodash`, `@madronejs/core`, `animejs`, or `sass`.**
  Plain CSS only; inline whatever utility you'd reach for. The library
  ships zero runtime dependencies.
- **Don't add Vue imports to the framework-free core** (`src/index.ts` or
  anything reachable from it). Vue lives under `src/vue/` and is exported
  via the `./vue` subpath.
- **Don't fire `onChange` from inside `freezeFrTracks`** or any measurement
  path. It's a layout-mutation event.
- **Don't pass `availPx` where a `ContainerAxisPx` is expected.** The
  brand makes this a compile error, but if you're tempted to widen
  the parameter back to `number`, don't — the brand is the one thing
  preventing a class of bugs we already shipped twice.
- **Don't bind inline object literals to `<SplitPanel>` props** — `:data`,
  `:size`, etc. Vue's shallow watchers fire on every render. The
  runtime's `setBounds` / `setData` short-circuit on reference-equal
  inputs as a backstop, but they still allocate a watcher tick per
  render. Use refs/computeds.
- **Don't use `inset: …` shorthand** with an explicit `width`/`height`.
  Browsers resolve the over-constraint inconsistently. Use
  `top: 50%; left: 50%; translate: -50% -50%` (which is what
  `.sp-resizer-handle` does).
- **Don't write to `container.max` directly outside the four sites that
  own it.** The `Maximize` sum type prevents `id` and `restore` from
  drifting apart structurally; the maintenance rule is that only
  `maximize` / `minimize` / `toggleExpand` / `mutateStructure` are
  allowed to assign to it.
- **Resizer handlers close over the container, not specific children.**
  After any structural mutation, detach + rebuild every resizer in the
  affected container(s) — `handleIdx` closures would otherwise be
  stale. `mutateStructure` does this for you; just route new
  structural ops through it.

## File map

```
src/
  types.ts                Bounds, Length, Leaf, Container, ContainerInput,
                          Node (recursive), PanelDirection, ResizerSpec.
  length.ts               parse/format/toPx/pxToPct + ContainerAxisPx
                          brand + asContainerAxis stamper.            (pure)
  track.ts                trackForChild / trackString — the inline
                          grid-template-* style.                       (pure)
  drag.ts                 push-cascade + LIFO recovery.                (pure)
  pointerDrag.ts          PointerDragState class — pointer-event
                          adapter around drag.ts. Lifecycle:
                          idle ↔ active; end(reason) cleanup funnel.
  draggable.ts            configureDraggable plugin: pointer events,
                          ghost rendering, threshold gating.
  SplitGrid.ts            The runtime: mount, layout commands
                          (mutateStructure helper for add/remove/swap),
                          maximize (Maximize sum type), drag wiring
                          (WeakMap<el, PointerDragState>), subscriber
                          fanout, debug logs.
  styles.css              ~140 lines of plain CSS. Side-effect imported
                          from src/index.ts so it actually ships.
  index.ts                Public framework-free surface.

  vue/
    SplitGridView.vue     Vue 3 wrapper. defineExpose<SplitGridViewApi<T>>.
                          Reactive panelStates map; ref-exposed
                          getPanelState(id) for parent components.
    SplitPanel.vue        Declarative Leaf component.
    SplitContainer.vue    Declarative nested Container component.
    composables.ts        useSplitGrid / usePanelState hooks.
    context.ts            provide/inject types: SplitGridContext,
                          ChildRegistry, PanelState, ResizerState,
                          SplitGridViewApi.
    index.ts              Public Vue subpath surface.

  __spec__/               Pure-function + happy-dom tests (node project).
    drag.spec.ts          Pure drag-math fuzzing.
    length.spec.ts        Length parsing, toPx, pxToPct.
    track.spec.ts         trackString assembly.
    SplitGrid.dom.spec.ts Runtime behavior under happy-dom.
    draggable.dom.spec.ts configureDraggable plugin.
    pointerDrag.dom.spec.ts PointerDragState lifecycle + disposal.
    layout.browser.spec.ts  Real-layout regressions (browser project).
    invariant.browser.spec.ts fast-check property test for the
                              tracks-sum-to-container invariant.

  vue/__spec__/           Vue-side dom tests (happy-dom).
    SplitGridView.dom.spec.ts
    SplitPanel/etc.
    declarative.dom.spec.ts Declarative tree + per-panel #resizer slot.
    composables.dom.spec.ts useSplitGrid / usePanelState.

demo/                     Five end-to-end examples (run with `pnpm dev`).
```

## Workflow

Test-first. Pattern that's been working in this repo:

1. Update the test file: change existing contracts the new behavior
   breaks, add new tests for the new behavior.
2. `pnpm test --run` — confirm new tests fail with the expected message.
3. Implement the change.
4. `pnpm test --run` until green.
5. `pnpm lint` and `pnpm build-types` before committing.
6. Single-purpose commits. Tests live in the same commit as the
   implementation they guard.

### Where to put the assertion

Two vitest projects (see `vitest.config.ts`):

- **`node`** — happy-dom for DOM tests, plain node for pure-fn tests. Fast
  (ms per file). Assert on **state shape** — `parent.sizes` units/values,
  `parent.max?.id`, `isMaximized(id)`, emitted `onChange` reasons.
  happy-dom doesn't run real CSS layout, so don't assert exact pixels here.

- **`browser`** — headless Chromium via `@vitest/browser-playwright`.
  Real CSS Grid. Slower (seconds). Assert on `getBoundingClientRect()`
  widths — these tests catch the bug class node tests are structurally
  blind to (JS-vs-CSS percentage drift, resizer overflow, min-clamping
  rendered-vs-stored gaps).

`pnpm test:node` and `pnpm test:browser` run them independently; `pnpm test`
runs both.

File globs route tests by suffix: `*.spec.ts` → node, `*.browser.spec.ts`
→ browser. `*.dom.spec.ts` is a naming convention for happy-dom tests
within the node project; the `// @vitest-environment happy-dom` pragma
at the top of the file is what actually switches the env.
