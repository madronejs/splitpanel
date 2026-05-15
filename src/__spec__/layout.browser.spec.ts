/**
 * Real-browser layout tests. These run in headless Chromium via
 * `@vitest/browser-playwright` — every getBoundingClientRect call gets a
 * real CSS Grid layout pass, which is the part happy-dom can't simulate.
 *
 * The node/happy-dom suite covers state-shape invariants (sizes array,
 * snapshot membership, onChange reasons). This suite covers the part the
 * state shape can't tell you: does the rendered layout actually fit in
 * the container, with every track at the size JS thinks it has? The
 * JS-vs-CSS percentage drift bug shipped because tests measured the JS
 * half but never the CSS half — this is the antidote.
 *
 * Conventions for browser tests:
 *   - Mount a fresh `.host` div per test, fixed size, attached to body.
 *   - Tear down in afterEach (remove the host).
 *   - Assert on `getBoundingClientRect()` widths/heights, not on the
 *     internal `sizes` array — the whole point is real layout.
 *   - Tolerances of ~1px for cross-track sums (subpixel rounding).
 */
import {
  afterEach, beforeEach, describe, expect, it,
} from 'vitest';
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

function widthsOf(selector: string): number[] {
  return [...host.querySelectorAll<HTMLElement>(selector)].map(
    (el) => el.getBoundingClientRect().width,
  );
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

describe('layout — real grid', () => {
  it('equalize gives every panel exactly avail/N when no min exceeds the share', async () => {
    const grid = new SplitGrid({
      root: {
        id: 'root',
        direction: PanelDirection.Row,
        resizer: { size: 20 },
        children: [
          { id: 'a', bounds: { min: '25%' } },
          { id: 'b' },
          { id: 'c' },
        ],
      },
    });

    grid.mount(host);
    grid.equalize('root');
    await grid.settle();

    // 1000px container, 2 inner resizers × 20 = 40, avail = 960.
    // Even share = 320. Panel a's 25% min is 250 — below share, so all
    // three end up at 320. This is the regression case the node tests
    // can prove via sizes but only the browser can prove via px.
    const panels = widthsOf('.sp-panel');

    expect(panels).toHaveLength(3);

    for (const w of panels) expect(w).toBeCloseTo(320, 0);

    // Grid + resizers sum to container.
    const all = widthsOf('.sp-container > *');

    expect(sum(all)).toBeCloseTo(CONTAINER_WIDTH, 0);
  });

  it('maximize fills the available content area with no overflow', async () => {
    const grid = new SplitGrid({
      root: {
        id: 'root',
        direction: PanelDirection.Row,
        resizer: { size: 20 },
        children: [
          { id: 'a', bounds: { min: '25%' } },
          { id: 'b' },
        ],
      },
    });

    grid.mount(host);
    grid.maximize('a');
    await grid.settle();

    const [aw, bw] = widthsOf('.sp-panel');
    const all = widthsOf('.sp-container > *');

    // Maximized panel takes ~all of avail. The other panel can shrink to 0
    // (no min). One 20px resizer divides them. Total must fit container.
    expect(aw).toBeGreaterThan(900);
    expect(bw).toBeCloseTo(0, 0);
    expect(sum(all)).toBeCloseTo(CONTAINER_WIDTH, 0);
  });

  // Regression for the "double-click pushes the px-sized panel off screen"
  // bug. When the target's sibling is stored in px units (e.g. a fixed-size
  // markers panel next to a 1fr media viewer), maximizing the target
  // physically computes the right pixel split but used to convert ALL sizes
  // to pct against the pre-mutation budget — which still subtracted the
  // sibling's px. The resulting pct values summed to >100% and CSS
  // overflowed the container.
  it('maximize next to a px-sized sibling does not overflow the container', async () => {
    const grid = new SplitGrid({
      root: {
        id: 'root',
        direction: PanelDirection.Row,
        resizer: { size: 5 },
        children: [
          { id: 'player' },
          { id: 'markers', bounds: { size: '400px', min: '250px', max: '600px' } },
        ],
      },
    });

    grid.mount(host);
    await grid.settle();
    grid.maximize('player');
    await grid.settle();

    const [playerW, markersW] = widthsOf('.sp-panel');
    const all = widthsOf('.sp-container > *');

    // markers compresses to its 250px min; player takes the rest of avail.
    // Avail = 1000 - 5 (resizer) = 995. Player = 995 - 250 = 745.
    expect(markersW).toBeCloseTo(250, 0);
    expect(playerW).toBeCloseTo(745, 0);
    // The cardinal sin: total layout must fit the container, not overflow.
    expect(sum(all)).toBeCloseTo(CONTAINER_WIDTH, 0);
  });

  // Round-trip of the dblclick gesture: maximize the unbounded panel
  // (player), then minimize it back to 0%. The sibling (markers) has
  // min=250 / max=600 — it must NEVER exceed either bound across the cycle.
  // Pre-fix, the second dblclick (minimize) handed all the freed space to
  // markers and it ballooned to ~995px.
  it('minimize honors a sibling px-max — target absorbs the leftover', async () => {
    const grid = new SplitGrid({
      root: {
        id: 'root',
        direction: PanelDirection.Row,
        resizer: { size: 5 },
        children: [
          { id: 'player' },
          { id: 'markers', bounds: { size: '400px', min: '250px', max: '600px' } },
        ],
      },
    });

    grid.mount(host);
    await grid.settle();
    grid.maximize('player');
    await grid.settle();
    grid.minimize('player');
    await grid.settle();

    const [playerW, markersW] = widthsOf('.sp-panel');
    const all = widthsOf('.sp-container > *');

    // markers caps at its 600 max; player absorbs the leftover so the
    // layout still fills the container.
    expect(markersW).toBeCloseTo(600, 0);
    expect(playerW).toBeCloseTo(CONTAINER_WIDTH - 600 - 5, 0);
    expect(sum(all)).toBeCloseTo(CONTAINER_WIDTH, 0);
  });

  // Regression for the "drag flashes after a max/min toggle" bug. After
  // maximize → minimize, the sibling is stored in px (preserve-unit) and
  // the target in pct. A drag's writeback used to convert ALL sizes to
  // pct against a budget computed BEFORE the reassign — same shape as
  // the applyTargetSize bug, surfacing on every pointermove. The CSS
  // values resolved to ~150% per track for a single paint frame before
  // the next move corrected, producing a visible flash.
  it('dragging the resizer after a max/min cycle does not overflow the container', async () => {
    const grid = new SplitGrid({
      root: {
        id: 'root',
        direction: PanelDirection.Row,
        resizer: { size: 5 },
        children: [
          { id: 'player' },
          { id: 'markers', bounds: { size: '400px', min: '250px', max: '600px' } },
        ],
      },
    });

    grid.mount(host);
    await grid.settle();
    grid.maximize('player');
    await grid.settle();
    grid.minimize('player');
    await grid.settle();

    // Now drag the inner resizer slightly to the left.
    const resizer = host.querySelector<HTMLElement>('.sp-container > .sp-resizer')!;
    const startX = resizer.getBoundingClientRect().left + 2;

    // Drag RIGHT — shrinking markers (away from its max), so the drag
    // math has room to apply. A leftward drag would be a no-op since
    // markers is already at its 600px max and can't grow further.
    resizer.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, clientX: startX, clientY: 50, pointerId: 1,
    }));
    globalThis.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, clientX: startX + 10, clientY: 50,
    }));
    globalThis.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await grid.settle();

    const all = widthsOf('.sp-container > *');
    const [, markersW] = widthsOf('.sp-panel');

    expect(sum(all)).toBeCloseTo(CONTAINER_WIDTH, 0);
    // markers stayed under its max.
    expect(markersW).toBeLessThanOrEqual(600 + 0.5);
  });

  // Same shape as the applyTargetSize / pointer-drag fixes, but in
  // `equalize`. Reachable via triple-click on a divider. The unit
  // preservation has to apply here too, or the same overflow surfaces
  // when the triple-click runs on a container that contains a px sibling.
  it('equalize next to a px-sized sibling does not overflow the container', async () => {
    const grid = new SplitGrid({
      root: {
        id: 'root',
        direction: PanelDirection.Row,
        resizer: { size: 5 },
        children: [
          { id: 'player' },
          { id: 'markers', bounds: { size: '400px', min: '250px', max: '600px' } },
        ],
      },
    });

    grid.mount(host);
    await grid.settle();
    // Maximize/minimize first so markers is at its 600 max and player at pct.
    grid.maximize('player');
    await grid.settle();
    grid.minimize('player');
    await grid.settle();
    grid.equalize('root');
    await grid.settle();

    const all = widthsOf('.sp-container > *');
    const [, markersW] = widthsOf('.sp-panel');

    expect(sum(all)).toBeCloseTo(CONTAINER_WIDTH, 0);
    expect(markersW).toBeLessThanOrEqual(600 + 0.5);
  });

  it('minimize collapses to the min and gives the slack to siblings', async () => {
    const grid = new SplitGrid({
      root: {
        id: 'root',
        direction: PanelDirection.Row,
        resizer: { size: 20 },
        children: [
          { id: 'a', bounds: { min: '25%' } },
          { id: 'b' },
        ],
      },
    });

    grid.mount(host);
    grid.minimize('a');
    await grid.settle();

    // Panel a clamps to its 25% min = 250px. Sibling takes the rest.
    const [aw, bw] = widthsOf('.sp-panel');
    const all = widthsOf('.sp-container > *');

    expect(aw).toBeCloseTo(250, 0);
    expect(bw).toBeCloseTo(CONTAINER_WIDTH - 250 - 20, 0); // 730
    expect(sum(all)).toBeCloseTo(CONTAINER_WIDTH, 0);
  });

  it('resizer.first adds a leading edge track and the layout still fits', async () => {
    // The bug we hunted in the dashboard: pre-fix, `resizer.first` was
    // not subtracted from availPx in JS, so every downstream pixel
    // computation over-shot and the grid overflowed by `resizerSize × edges`.
    const grid = new SplitGrid({
      root: {
        id: 'root',
        direction: PanelDirection.Row,
        resizer: { size: 20, first: true, last: true },
        children: [
          { id: 'a', bounds: { min: '25%' } },
          { id: 'b' },
          { id: 'c' },
        ],
      },
    });

    grid.mount(host);
    grid.maximize('a');
    await grid.settle();

    // 1 leading + 2 inner + 1 trailing = 4 resizer tracks × 20px = 80px.
    // The grid must still fit; the maximized panel takes the rest.
    const all = widthsOf('.sp-container > *');

    expect(sum(all)).toBeCloseTo(CONTAINER_WIDTH, 0);

    const resizers = widthsOf('.sp-resizer');

    expect(resizers).toHaveLength(4);

    for (const w of resizers) expect(w).toBeCloseTo(20, 0);
  });

  it('setBounds (min-only patch) is idempotent — no drift on the rendered layout', async () => {
    // The dashboard's `setBounds(panel, {min: '25%'})` was shifting
    // sizes from [48.299%, 48.299%] to [60.799%, 35.799%] on a single
    // call — visible as a sudden 12.5% shift in rendered widths. After
    // the toPx-denominator fix, the rendered layout should be stable.
    const grid = new SplitGrid({
      root: {
        id: 'root',
        direction: PanelDirection.Row,
        resizer: { size: 20 },
        children: [{ id: 'a' }, { id: 'b' }],
      },
    });

    grid.mount(host);
    grid.equalize('root');
    await grid.settle();

    const before = widthsOf('.sp-panel');

    grid.setBounds('a', { min: '25%' });
    await grid.settle();

    const after = widthsOf('.sp-panel');

    for (const [i, element] of before.entries()) {
      expect(after[i]).toBeCloseTo(element, 0);
    }
  });

  it('cycle of equalize → remove → add keeps the new panel inside the container', async () => {
    // The off-screen-panel bug. After equalize, pct sizes saturate the
    // pct budget; a fresh `1fr` track inserted by addChild would render
    // at zero width past the container edge. `makeRoom` +
    // `renormalizePctSizes` fix this — every newly-added panel ends up
    // with non-zero rendered width inside the container.
    const grid = new SplitGrid({
      root: {
        id: 'root',
        direction: PanelDirection.Row,
        children: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      },
    });

    grid.mount(host);
    grid.equalize('root');
    await grid.settle();
    grid.removeChild('b');
    grid.removeChild('c');
    await grid.settle();
    grid.addChild('root', { id: 'd' });
    grid.addChild('root', { id: 'e' });
    grid.addChild('root', { id: 'f' });
    await grid.settle();

    const panels = widthsOf('.sp-panel');

    expect(panels).toHaveLength(4);

    for (const w of panels) {
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThanOrEqual(CONTAINER_WIDTH);
    }

    const all = widthsOf('.sp-container > *');

    expect(sum(all)).toBeCloseTo(CONTAINER_WIDTH, 0);
  });

  // Regression: after a window/container resize, the runtime updates
  // `availPx` (via ResizeObserver → measureAll) but used to leave the
  // CSS `--sp-tracks` string at the value written by the LAST layout op.
  // CSS Grid re-resolved that stale pct string against the new
  // container size, and any container with px-sized siblings (or
  // resizer-track px) drifted off the new bounds. Now writeAllTracks
  // fires after every measure, so the rendered widths re-match.
  it('container resize re-emits tracks so px siblings + pct siblings re-fit', async () => {
    const grid = new SplitGrid({
      root: {
        id: 'root',
        direction: PanelDirection.Row,
        resizer: { size: 5 },
        children: [
          { id: 'player' },
          { id: 'markers', bounds: { size: '400px', min: '250px', max: '600px' } },
        ],
      },
    });

    grid.mount(host);
    await grid.settle();

    // Force the player's fr track to freeze into a stored pct. Without
    // this, CSS resolves `minmax(0, 1fr)` dynamically against the
    // current container width and there's no drift to test. After any
    // layout op (setSize / equalize / maximize) the fr → pct freeze
    // turns the player into a stored-pct track, which is where stale
    // `--sp-tracks` would bite on resize.
    grid.equalize('root');
    await grid.settle();
    grid.maximize('player');
    await grid.settle();

    // Resize the container. The ResizeObserver fires; the runtime needs
    // to re-write --sp-tracks so CSS resolves against the new width.
    host.style.width = '800px';

    // ResizeObserver dispatches off the rendering steps, then the
    // runtime debounces via rAF. Four frames gives both a chance to
    // settle in Chromium under load.
    for (let i = 0; i < 4; i += 1) {
      await new Promise((r) => requestAnimationFrame(r));
    }

    // After maximize + resize to 800: markers clamps to its 250 min,
    // player takes the remainder (800 − 5 resizer − 250 = 545). The
    // exact split is the point — what matters is the layout still fits
    // the new container width.
    expect(sum(widthsOf('.sp-container > *'))).toBeCloseTo(800, 0);
  });
});
