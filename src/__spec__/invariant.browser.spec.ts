/**
 * Property tests for the layout invariant the runtime is built around:
 *
 *   for any sequence of public layout operations, the sum of rendered
 *   panel + resizer widths equals the container's measured axis width
 *   within ~1px of sub-pixel rounding noise.
 *
 * This is the bug shape we kept almost re-introducing: the
 * `containerAxisPx` vs `availPx` denominator confusion produced drift
 * that summed to a non-zero overflow in real CSS but passed every
 * state-shape assertion in the node suite. fast-check generates random
 * operation sequences and asserts the invariant after each one. If
 * any sequence breaks it, the shrunk counterexample is the regression
 * test for whatever just got reverted.
 *
 * Browser project so real CSS layout runs (happy-dom can't). Slower —
 * one mount + replay per shrunk case — so the `numRuns` budget is
 * intentionally modest. Bump it locally when chasing a flake.
 */
import {
  afterEach, beforeEach, describe, expect, it,
} from 'vitest';
import * as fc from 'fast-check';
import { SplitGrid } from '../SplitGrid';
import { PanelDirection } from '../types';
import '../styles.css';

const CONTAINER_WIDTH = 1000;
const CONTAINER_HEIGHT = 400;

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  host.style.cssText = `width: ${CONTAINER_WIDTH}px; height: ${CONTAINER_HEIGHT}px; position: fixed; top: 0; left: 0;`;
  document.body.append(host);
});

afterEach(() => {
  host.remove();
});

type Op = | { kind: 'equalize' }
  | { kind: 'maximize', panel: number }
  | { kind: 'minimize', panel: number }
  | { kind: 'setSize', panel: number, pct: number }
  | { kind: 'setBoundsMin', panel: number, pct: number }
  | { kind: 'reset' }
  | { kind: 'remove', panel: number }
  | { kind: 'add' };

/**
 * Replay a sequence of operations and assert that the rendered tracks
 * fit the container at the end. Sub-pixel rounding gives a small
 * tolerance — anything past ±2px is real drift.
 *
 * Operations animate by default, so we await `settle()` before reading
 * the rendered widths — otherwise getBoundingClientRect returns
 * mid-transition values that don't reflect the runtime's final state.
 */
function assertFitsContainer(ops: Op[]): void {
  const initialChildren = [
    { id: 'a' },
    { id: 'b' },
    { id: 'c' },
    { id: 'd' },
  ] as Array<{ id: string, bounds?: { min?: string } }>;
  const grid = new SplitGrid({
    root: {
      id: 'root',
      direction: PanelDirection.Row,
      resizer: { size: 6 },
      children: initialChildren,
    },
  });

  grid.mount(host);

  let nextId = 100;

  for (const op of ops) {
    const state = grid.get('root');

    if (!state || !('sizes' in state)) throw new Error('expected container');

    const ids = state.node.children.map((c) => c.id);

    // `animate: false` everywhere: the invariant is about the runtime's
    // final intent, not what CSS shows mid-transition. Skipping animation
    // also means we don't have to await settle() between every op — the
    // browser commits the new tracks immediately via the `[data-no-animate]`
    // path. Drops test runtime from ~30s to ~3s.
    const opts = { animate: false } as const;

    switch (op.kind) {
      case 'equalize': {
        grid.equalize('root', opts);
        break;
      }
      case 'reset': {
        grid.reset('root', opts);
        break;
      }
      case 'maximize': {
        if (ids[op.panel]) grid.maximize(ids[op.panel], opts);
        break;
      }
      case 'minimize': {
        if (ids[op.panel]) grid.minimize(ids[op.panel], opts);
        break;
      }
      case 'setSize': {
        if (ids[op.panel]) grid.setSize(ids[op.panel], `${op.pct}%`, opts);
        break;
      }
      case 'setBoundsMin': {
        if (ids[op.panel]) grid.setBounds(ids[op.panel], { min: `${op.pct}%` }, opts);
        break;
      }
      case 'remove': {
        if (ids[op.panel] && ids.length > 1) grid.removeChild(ids[op.panel]);
        break;
      }
      case 'add': {
        nextId += 1;
        grid.addChild('root', { id: `n${nextId}` });
        break;
      }
      default: {
        // Op kinds are an exhaustive union; this branch only runs if a
        // new kind is added to the union without a handler here. Throw
        // so the omission surfaces immediately rather than silently
        // skipping ops.
        const exhaustive: never = op;

        throw new Error(`unhandled op: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  // Read the final layout. Operations ran with `animate: false`, so the
  // tracks committed synchronously — no settle() wait needed. Tracks sum
  // (panels + resizers) must equal the container width.
  const container = host.querySelector('.sp-container') as HTMLElement;
  const containerWidth = container.getBoundingClientRect().width;
  const children = [...container.children] as HTMLElement[];
  const childrenSum = children.reduce(
    (a, el) => a + el.getBoundingClientRect().width,
    0,
  );

  // Tolerance: sub-pixel rounding across N tracks. With up to ~10
  // children + interleaved resizer tracks, browsers can round each track
  // independently, accumulating ~0.2px of noise per pair. 3px keeps the
  // assertion meaningful (a real drift bug pushes well past 3px on a
  // 1000px container) while tolerating the rounding floor.
  expect(Math.abs(childrenSum - containerWidth)).toBeLessThan(3);

  // Storage-form invariant: for any container whose c.sizes carries
  // pct entries, those pct values sum to exactly 100 — the "saturated
  // layout sums to 100 in storage form" rule from CLAUDE.md. This is
  // independent of the rendered-px check above: writeTracks' CSS-emit
  // boundary corrects drift on the way out, so a broken storage sum
  // can render correctly and still leak through any downstream code
  // that reads c.sizes (consumers, settle, getRawDefinition, etc.).
  const rootState = grid.get('root');

  if (rootState && 'sizes' in rootState) {
    const pctEntries = rootState.sizes.filter((s) => s.unit === 'pct');

    if (pctEntries.length > 0) {
      const pctSum = pctEntries.reduce((a, s) => a + s.value, 0);

      expect(Math.abs(pctSum - 100)).toBeLessThan(0.5);
    }
  }
}

const arbOp = fc.oneof(
  fc.constant({ kind: 'equalize' as const }),
  fc.constant({ kind: 'reset' as const }),
  fc.constant({ kind: 'add' as const }),
  fc.record({
    kind: fc.constant('maximize' as const),
    panel: fc.integer({ min: 0, max: 5 }),
  }),
  fc.record({
    kind: fc.constant('minimize' as const),
    panel: fc.integer({ min: 0, max: 5 }),
  }),
  fc.record({
    kind: fc.constant('setSize' as const),
    panel: fc.integer({ min: 0, max: 5 }),
    pct: fc.integer({ min: 0, max: 100 }),
  }),
  fc.record({
    kind: fc.constant('setBoundsMin' as const),
    panel: fc.integer({ min: 0, max: 5 }),
    // Cap to 15%. With up to ~6 panels, six mins of 15% sum to 90%,
    // leaving 10% headroom for resizer tracks. Higher values produce
    // sequences where user-supplied mins genuinely can't fit — CSS
    // Grid would (correctly) overflow, but that's a different kind of
    // failure than the drift we're hunting.
    pct: fc.integer({ min: 0, max: 15 }),
  }),
  fc.record({
    kind: fc.constant('remove' as const),
    panel: fc.integer({ min: 0, max: 5 }),
  }),
);

describe('layout invariant — tracks always sum to container width', () => {
  it('holds across arbitrary operation sequences', () => {
    fc.assert(
      fc.property(
        fc.array(arbOp, { minLength: 1, maxLength: 12 }),
        (ops) => {
          host.replaceChildren();
          assertFitsContainer(ops);
        },
      ),
      // Budget is small because each run mounts a fresh grid and forces
      // multiple real layout passes. The shrinker still narrows any
      // failure to a minimal repro automatically.
      { numRuns: 40 },
    );
  });
});
