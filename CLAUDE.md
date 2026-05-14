# splitpanel — Claude notes

CSS Grid-based split panel runtime + optional Vue wrapper. Framework-free
core lives in `src/`; Vue wrapper in `src/vue/`. No reactivity dependency
(`@madronejs/core` was removed); no lodash. Single source of truth for sizing
is `parent.sizes: Length[]`; CSS Grid does layout via one
`grid-template-columns` (or `-rows`) string per container.

## Workflow

**Test-first.** When adding behavior, write the failing tests first, then
implement until they pass. The pattern that's been working in this repo:

1. Update the test file: change existing test contracts that the new
   behavior breaks, and add new tests for the new behavior.
2. Run `pnpm test --run` — confirm the new tests fail with the expected
   error message (e.g., "is not a function", or the right shape of mismatch).
3. Implement the change.
4. `pnpm test --run` until green.
5. `pnpm lint` and `pnpm build-types` before committing.
6. Single-purpose commits. Tests live in the same commit as the
   implementation they're guarding.

If a behavior is too layout-dependent for the happy-dom tests to assert
robustly (no real CSS layout), assert on **state shape** in the node
suite — `parent.sizes` units/values, `isMaximized` / `parent.max` shape,
emitted `onChange` reasons — and write a real-layout assertion in the
**browser suite** (`*.browser.spec.ts`, headless Chromium via Playwright)
for the pixel side.

## Commands

| | |
|---|---|
| `pnpm test --run` | one-shot vitest (both projects) |
| `pnpm test:node`  | node + happy-dom only (fast, ms-per-file) |
| `pnpm test:browser`| Chromium-via-Playwright only (slower, real layout) |
| `pnpm test`       | watch mode |
| `pnpm lint`       | eslint (`--fix` auto-fixes most) |
| `pnpm build-types`| vue-tsc + tsc-alias; emits `types/` |
| `pnpm dev`        | vite dev server; demo at `/` |
| `pnpm build`      | library build to `dist/` |

## Testing conventions

Tests live in two vitest **projects** (see `vitest.config.ts`):

- `node` — fast, no real browser. Pure functions and DOM-stub tests
  (happy-dom via the `// @vitest-environment happy-dom` pragma). Most
  assertions live here; runs in milliseconds per file.
- `browser` — Chromium-via-Playwright. Real CSS Grid layout, real
  `getBoundingClientRect`. Use for the class of bug the node suite
  can't see by construction (JS-vs-CSS percentage drift, resizer
  overflow, transition timing).

File globs route by suffix:

- **All test files** live in `__spec__/` folders next to the code they test,
  named `*.spec.ts`. The repo uses this layout instead of co-located
  `*.test.ts`.
- **Pure-function modules** → `src/__spec__/<name>.spec.ts`, node env.
  No DOM stubs needed. Examples: `drag.spec.ts`, `track.spec.ts`,
  `length.spec.ts`.
- **Runtime / Vue tests** → `*.dom.spec.ts` with `// @vitest-environment
  happy-dom` as the **first line of the file**. The `.dom.spec.ts` suffix
  is a naming convention so the tree tips you off; the pragma is what
  actually switches the env. Vitest 4 removed `environmentMatchGlobs`.
- **Real-layout tests** → `*.browser.spec.ts`. Run only in the browser
  project. Assert on `getBoundingClientRect()` widths — these tests
  exist to catch JS↔CSS drift the node suite misses.
- happy-dom returns a zero-sized rect by default. In `beforeEach`, stub
  `Element.prototype.getBoundingClientRect` to a known size so `availPx > 0`
  and the math runs deterministically. **Don't assert exact pixel layouts**
  in the node suite — assert on the state and emitted events; assert
  pixels in the browser suite instead.
- **Don't share a tree definition across tests** — `grid.setData` and
  similar mutate `node.data` in place, so a shared `const tree = { ... }`
  will leak state between tests. Use a `makeTree()` factory and call it
  in each `it`/`mount`.
- happy-dom's CSS selector engine doesn't handle special characters in
  attribute values cleanly (e.g. `[data-x="A!"]` returns null even when
  the element exists). Use plain ASCII labels in test fixtures.
- `data-id` collides with SplitGrid's own attribute on `.sp-panel` /
  `.sp-container` elements — use a different attribute name (e.g.
  `data-test`) inside slot templates that query by ID.

## Architecture

```
src/
  types.ts              Bounds, Length, Leaf, Container, Node (recursive)
  length.ts             parse/format/toPx/pxToPct                     (pure)
  track.ts              trackForChild/trackString — the one inline    (pure)
                        style per container
  drag.ts               push-cascade + LIFO recovery                  (pure)
  SplitGrid.ts          runtime: mount, drag wiring, tree mutation
                        (addChild/removeChild/swap), layout commands
                        (setSize, equalize, reset, toggleExpand,
                        expandNext/Prev, maximize/minimize), state queries
                        (isMaximized, isAtDefault, getSize), onChange.
  vue/
    SplitGridView.vue   Vue 3 wrapper. #leaf and #resizer slots are
                        teleported into the elements SplitGrid creates.
                        defineExpose surfaces every method.
demo/
  *.vue                 Per-section demo apps mounted by main.ts.
```

## Conventions

- **Vue SFCs: script first**, then `<template>`, then `<style>`. Component-
  level docs go inside the script as a JSDoc block; HTML comments at the
  top of a `.vue` file get stripped by the lint auto-fixer.
- **Layout methods accept `LayoutOptions`** (`{ animate?: boolean }`).
  Default is `true`. `false` writes through a `[data-no-animate]` attribute
  toggle that suppresses the CSS transition for that paint.
- **Two pct denominators, two brand types.** `ContainerAxisPx` is the
  full grid container axis — what CSS resolves `<pct>` track values
  against, and what user-input pct means (`setSize('50%')`, `bounds.min:
  '40%'`). `PctBudgetPx` is the storage denominator: `availPx −
  Σpx_tracks(c.sizes)`. Stored `c.sizes` pct values are "% of
  PctBudgetPx" — that's why a saturated layout sums to exactly 100 in
  storage form regardless of resizer-track count or px siblings.
  The brands (`length.ts`) keep the two straight at compile time;
  producers stamp via `asContainerAxis` / `asPctBudget`. The single
  bridge is `SplitGrid.sizesForCss`, which scales each stored pct by
  `budget / container` at the `writeTracks` boundary so the CSS-bound
  value resolves back to the same physical px. Don't reintroduce
  `renormalizePctSizes` — `makeRoom` and `absorbVacancy` maintain the
  sum-to-100 invariant directly. The property test in
  `invariant.browser.spec.ts` is the runtime backstop.
- **`Maximize` is a sum type, not paired fields.** `parent.max` is
  `null | { id, restore }`. Only `maximize` / `minimize` / `toggleExpand`
  / `mutateStructure` assign to it; new readers do `parent.max?.id` and
  `parent.max?.restore`. Don't reintroduce a `maxId: string | null` /
  `restore: Length[] | null` pair.
- **Structural mutations go through `mutateStructure(c, fn)`.**
  `addChild` / `removeChild` / `swap` are the current users; any new
  structural method should too. The helper handles detach-resizers →
  mutate → clear-max → reindex → rebuild-resizers → writeTracks-no-
  animate. The mutate callback itself is responsible for keeping the
  sum-to-100 storage invariant alive (`makeRoom` on inserts,
  `absorbVacancy` on removes). Missing any of those steps leads to the
  layout-drift class of bugs.
- **Refs in `defineExpose` auto-unwrap on parent access.** When the demo
  does `componentRef.value.instance`, Vue returns the unwrapped value —
  do NOT add a `.value` after `instance`. Locked in by a regression test
  in `src/vue/SplitGridView.dom.test.ts`.

## Vue: reactive prop gotcha

`<SplitPanel>` watches `data`/`size`/`min`/`max` (and `<SplitContainer>`
watches `direction`) shallowly. The watcher fires on **reference change** —
no deep traversal, by convention. Two consequences:

- To update from outside, **swap the prop's value to a new reference**:
  `tab.data = { ...tab.data, label: 'new' }`. Mutating `tab.data.label = 'new'`
  in place won't trigger the watcher.
- **Never bind an inline object literal** like `:data="{ label }"` — every
  render creates a fresh reference, the watcher fires, `setData` re-renders
  the wrapper, fresh reference again, and you loop. Vue catches this with
  "Maximum recursive updates exceeded." Use a `ref` or a `computed` for the
  payload so the reference is stable when nothing has actually changed.

## Don'ts

- Don't reintroduce `lodash`, `@madronejs/core`, `animejs`, or `sass`.
  Plain CSS only; replicate utility functions inline if you need them.
- Don't add Vue imports to the framework-free core (`src/index.ts` or
  anything reachable from it). Vue lives under `src/vue/` and is exported
  via the `./vue` subpath.
- Don't use `inset: ... ...` shorthand to absolutely-position an element
  that also has an explicit `width`/`height`. Browsers resolve the over-
  constraint inconsistently. Use `top: 50%; left: 50%; translate: -50% -50%`.
- Don't fire `onChange` from inside `freezeFrTracks` or measurement-only
  paths. It's a layout-mutation event; freeze is a no-animate intermediate
  step on the way to the real change, and emitting from it would
  double-fire.
