// @vitest-environment happy-dom
/**
 * DOM-bound tests for the SplitGrid runtime. The `// @vitest-environment`
 * pragma above tells vitest to load happy-dom for this file. The
 * `.dom.test.ts` suffix is a naming convention so the tree tips you off.
 *
 * Layout-resolved measurements (getBoundingClientRect, computed track widths)
 * aren't accurate under happy-dom because no real layout engine runs. We stub
 * getBoundingClientRect to return a fixed 1000×500 rect so the bits of the
 * runtime that read it produce deterministic numbers. Tests that wouldn't be
 * robust against that stub (e.g. asserting an exact pct after setSize) are
 * deliberately not written here — they're better covered by manual demo runs.
 */
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { SplitGrid } from '../SplitGrid';
import type { LayoutChangeEvent } from '../SplitGrid';
import type { Container } from '../types';
import { PanelDirection } from '../types';

let host: HTMLElement;
const onChange = vi.fn<(e: LayoutChangeEvent) => void>();

beforeEach(() => {
  // happy-dom returns a zero-sized rect by default; fix it so availPx > 0.
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 500, width: 1000, height: 500, toJSON: () => ({}),
  } as DOMRect));
  host = document.createElement('div');
  document.body.append(host);
  onChange.mockReset();
});

afterEach(() => {
  host.remove();
});

function tree(): Container {
  return {
    id: 'root',
    direction: PanelDirection.Row,
    children: [
      { id: 'a', bounds: { min: '40px' }, data: { label: 'A' } },
      { id: 'b', bounds: { min: '40px' }, data: { label: 'B' } },
      { id: 'c', bounds: { min: '40px' }, data: { label: 'C' } },
    ],
  };
}

function mount(root: Container = tree()) {
  const grid = new SplitGrid({ root, onChange });

  grid.mount(host);
  return grid;
}

describe('mount / unmount', () => {
  it('builds the DOM mirror: one container + N panels + (N-1) resizers', () => {
    mount();

    const container = host.querySelector('.sp-container')!;

    expect(container).toBeTruthy();
    expect(container.querySelectorAll(':scope > .sp-panel')).toHaveLength(3);
    expect(container.querySelectorAll(':scope > .sp-resizer')).toHaveLength(2);
  });

  it('writes a `--sp-tracks` inline custom property on the container', () => {
    mount();

    const tracks = (host.querySelector('.sp-container') as HTMLElement).style.getPropertyValue('--sp-tracks');

    expect(tracks).toContain('1fr');
    // 3 content tracks + 2 resizer tracks.
    expect(tracks.split(/\s+(?=(?:[^()]|\([^()]*\))*$)/)).toHaveLength(5);
  });

  it('unmount detaches the root element', () => {
    const grid = mount();

    grid.unmount();
    expect(host.children).toHaveLength(0);
  });

  it('unmount cancels any pending scheduleMeasure rAF', () => {
    // Regression: scheduleMeasure used to set rafScheduled = true and
    // never cancel the rAF. If the host went away mid-frame, the
    // dedup guard prevented future measure requests on a re-attached
    // instance from running. The fix cancels the pending handle and
    // resets the flag so a fresh scheduleMeasure can fire.
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame');
    const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const grid = mount();

    // Trigger a scheduleMeasure via ResizeObserver-equivalent path. The
    // public surface doesn't expose it directly; the existing rAF call
    // chain (mount → buildContainer paths, or measureAll's write) is
    // enough to leave at least one rAF in flight after mount.
    // To force one: bump `scheduleMeasure` via a writeTracks debug path
    // is invasive; instead, drive a no-op layout that schedules nothing.
    // The mount itself doesn't schedule (synchronous measure path), so
    // we synthesize the case: call `scheduleMeasure` via the
    // ResizeObserver callback path the constructor wired up.
    //
    // happy-dom doesn't fire ResizeObserver; reach into the spy and
    // confirm SOME rAF was enqueued during normal lifecycle, then
    // confirm unmount cancels what's pending.
    rafSpy.mockClear();

    // Force a measure schedule by emulating a resize — easier via the
    // `setDirection` path which calls scheduleMeasure.
    grid.setDirection('root', PanelDirection.Column);
    expect(rafSpy).toHaveBeenCalled();

    const lastHandle = rafSpy.mock.results.at(-1)?.value as number | undefined;

    grid.unmount();

    // unmount called cancelAnimationFrame with the pending handle.
    expect(cancelSpy).toHaveBeenCalled();

    if (lastHandle != null) expect(cancelSpy).toHaveBeenCalledWith(lastHandle);

    rafSpy.mockRestore();
    cancelSpy.mockRestore();
  });
});

describe('addChild / removeChild', () => {
  it('appends a child by default and emits add-child', () => {
    const grid = mount();

    grid.addChild('root', { id: 'd', data: { label: 'D' } });

    const grid2 = grid;
    const container = host.querySelector('.sp-container')!;

    expect(container.querySelectorAll(':scope > .sp-panel')).toHaveLength(4);
    expect(container.querySelectorAll(':scope > .sp-resizer')).toHaveLength(3);
    expect(grid2.get('d')).toBeDefined();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ reason: 'add-child' }));
  });

  it('inserts at an explicit index', () => {
    const grid = mount();

    grid.addChild('root', { id: 'x', data: { label: 'X' } }, 1);

    const ids = [...host.querySelectorAll('.sp-panel')].map((el) => (el as HTMLElement).dataset.id);

    expect(ids).toEqual(['a', 'x', 'b', 'c']);
  });

  it('rejects duplicate ids without mutating', () => {
    const grid = mount();

    grid.addChild('root', { id: 'a', data: { label: 'dup' } });
    expect(host.querySelectorAll('.sp-panel')).toHaveLength(3);
  });

  it('removeChild detaches the element and clears its byId entry', () => {
    const grid = mount();

    grid.removeChild('b');
    expect(host.querySelectorAll('.sp-panel')).toHaveLength(2);
    expect(grid.get('b')).toBeUndefined();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ reason: 'remove-child' }));
  });

  it('removeChild is a no-op for the root', () => {
    const grid = mount();

    grid.removeChild('root');
    expect(host.querySelectorAll('.sp-container')).toHaveLength(1);
    expect(grid.get('root')).toBeDefined();
  });

  it('suppresses the transition during add (track count change can\'t animate)', () => {
    const grid = mount();
    const rootEl = host.querySelector('.sp-container') as HTMLElement;

    // Spy on `.dataset` writes is fragile; instead read the attribute back
    // right after addChild. The implementation sets `data-no-animate` for
    // the write, forces a layout, then removes it. The final state should
    // have the attribute absent — proving the write completed without
    // leaving the transition-suppress flag stuck on.
    grid.addChild('root', { id: 'd' });
    expect(Object.hasOwn(rootEl.dataset, 'noAnimate')).toBe(false);
  });

  it('suppresses the transition during remove', () => {
    const grid = mount();
    const rootEl = host.querySelector('.sp-container') as HTMLElement;

    grid.removeChild('b');
    expect(Object.hasOwn(rootEl.dataset, 'noAnimate')).toBe(false);
  });

  it('addChild after equalize+remove cycle keeps new panel inside the container', () => {
    // Regression for two related bugs:
    //   1. Once any layout op runs (equalize, maximize, setSize), fr tracks
    //      freeze into pct via freezeFrTracks. A fresh `1fr` track spliced
    //      in by addChild would be allocated zero (or negative) space and
    //      render outside the viewport. `makeRoom` fixes this by converting
    //      the new fr to its fair pct share.
    //   2. Each structural mutation changes the resizer-track count, so
    //      the pct budget changes. The sum-to-100 invariant (stored pct
    //      sizes sum to 100% of pctBudgetPx) is maintained by `makeRoom`
    //      on insert and `absorbVacancy` on remove. Without that, drift
    //      compounds across cycles and the new panel renders just past
    //      the container edge.
    const grid = mount();

    grid.equalize('root');
    grid.removeChild('b');
    grid.removeChild('c');
    grid.addChild('root', { id: 'd' });
    grid.addChild('root', { id: 'e' });
    grid.addChild('root', { id: 'f' });
    grid.addChild('root', { id: 'g' });

    const state = grid.get('root');

    if (!state || !('sizes' in state)) throw new Error('expected container');

    const { sizes } = state;
    const pctSizes = sizes.filter((s) => s.unit === 'pct');

    // All sizes should now be pct (frs converted via makeRoom on each insert).
    expect(pctSizes).toHaveLength(sizes.length);

    // Storage-form invariant: pct values sum to exactly 100. The CSS
    // emit at writeTracks scales by budget/container so the rendered
    // tracks fit inside the actual container axis.
    const sum = pctSizes.reduce((a, s) => a + s.value, 0);

    expect(sum).toBeCloseTo(100, 1);

    // Cycle-add preserves equality of surviving siblings — five panels
    // at an even 1/5 share of 100% = 20% each in storage form.
    for (const s of pctSizes) {
      expect(s.value).toBeCloseTo(20, 1);
    }
  });

  it('addChild and removeChild clear any maximize state on the container', () => {
    // Regression: `maxId` / `restore` track the maximize snapshot. After a
    // structural mutation the snapshot length wouldn't match `sizes.length`
    // anymore, so `toggleExpand` restore would corrupt the layout. Cleared
    // explicitly on every add and remove.
    const grid = mount();

    grid.toggleExpand('b');
    expect(grid.isMaximized('b')).toBe(true);

    grid.addChild('root', { id: 'x' });
    expect(grid.isMaximized('b')).toBe(false);

    grid.toggleExpand('c');
    expect(grid.isMaximized('c')).toBe(true);

    grid.removeChild('a');
    expect(grid.isMaximized('c')).toBe(false);
  });

  it('keeps the new panel in the grid after a clear-and-readd cycle', () => {
    const grid = mount();

    // Clear everything.
    grid.removeChild('a');
    grid.removeChild('b');
    grid.removeChild('c');
    expect((grid.get('root') as { node: { children: unknown[] } }).node.children).toEqual([]);
    // Re-add. The track string must be set such that the new panel is the
    // sole track (and therefore the panel is positioned inside the grid,
    // not in an implicit row).
    grid.addChild('root', { id: 'fresh' });

    const tracks = (host.querySelector('.sp-container') as HTMLElement)
      .style.getPropertyValue('--sp-tracks');

    expect(tracks).toContain('1fr');
    // No resizers needed for a single child.
    expect(tracks.split(/\s+(?=(?:[^()]|\([^()]*\))*$)/)).toHaveLength(1);
  });
});

describe('swap (structural)', () => {
  it('reorders two leaves within the same parent and emits swap', () => {
    const grid = mount();

    grid.swap('a', 'c');

    const ids = [...host.querySelectorAll(':scope > .sp-container > .sp-panel')]
      .map((el) => (el as HTMLElement).dataset.id);

    expect(ids).toEqual(['c', 'b', 'a']);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ reason: 'swap' }));
  });

  it('updates indexInParent for the swapped nodes', () => {
    const grid = mount();

    grid.swap('a', 'c');
    expect(grid.get('a')?.indexInParent).toBe(2);
    expect(grid.get('c')?.indexInParent).toBe(0);
  });

  it('cross-parent swap moves nodes between containers', () => {
    const root: Container = {
      id: 'root',
      direction: PanelDirection.Row,
      children: [
        { id: 'a' },
        {
          id: 'group',
          direction: PanelDirection.Column,
          children: [{ id: 'b' }, { id: 'c' }],
        },
      ],
    };
    const grid = mount(root);

    grid.swap('a', 'b');
    // `a` now lives inside `group`; `b` is at the root.
    expect(grid.get('a')?.parent?.node.id).toBe('group');
    expect(grid.get('b')?.parent?.node.id).toBe('root');
  });

  it('cross-parent swap emits a single composed event with both container ids', () => {
    // Previously fired two 'swap' events, one per container. Consumers
    // had to dedupe by inspecting nodeIds. The composed shape is a
    // single event with containerId = [pA, pB] and sizes = [aSizes, bSizes].
    const root: Container = {
      id: 'root',
      direction: PanelDirection.Row,
      children: [
        { id: 'a' },
        {
          id: 'group',
          direction: PanelDirection.Column,
          children: [{ id: 'b' }, { id: 'c' }],
        },
      ],
    };
    const grid = mount(root);
    const swaps: LayoutChangeEvent[] = [];

    grid.subscribe((e) => {
      if (e.reason === 'swap') swaps.push(e);
    });

    grid.swap('a', 'b');

    expect(swaps).toHaveLength(1);

    const ev = swaps[0];

    expect(Array.isArray(ev.containerId)).toBe(true);
    expect(ev.containerId).toEqual(expect.arrayContaining(['root', 'group']));
    expect(Array.isArray(ev.sizes)).toBe(true);
    // sizes follows containerId order: sizes[i] are containerId[i]'s child sizes.
    expect((ev.sizes as unknown as unknown[]).length).toBe(2);
    expect(ev.nodeIds).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('same-parent swap stays a single-container event', () => {
    const grid = mount();
    const swaps: LayoutChangeEvent[] = [];

    grid.subscribe((e) => {
      if (e.reason === 'swap') swaps.push(e);
    });

    grid.swap('a', 'c');
    expect(swaps).toHaveLength(1);
    expect(typeof swaps[0].containerId).toBe('string');
    expect(swaps[0].containerId).toBe('root');
  });

  it('rejects ancestor/descendant swap', () => {
    const root: Container = {
      id: 'root',
      direction: PanelDirection.Row,
      children: [{
        id: 'group', direction: PanelDirection.Column, children: [{ id: 'inner' }],
      }],
    };
    const grid = mount(root);

    grid.swap('group', 'inner');
    expect(grid.get('group')?.parent?.node.id).toBe('root');
    expect(grid.get('inner')?.parent?.node.id).toBe('group');
  });
});

describe('setData / swapData', () => {
  it('setData updates a leaf\'s data and emits set-data; sizes untouched', () => {
    const grid = mount();
    const before = (grid.get('root') as { sizes: unknown[] }).sizes;
    const beforeCopy = [...before];

    grid.setData('a', { label: 'A!' });

    const state = grid.get('a');

    expect((state?.node as { data: { label: string } }).data.label).toBe('A!');
    expect((grid.get('root') as { sizes: unknown[] }).sizes).toEqual(beforeCopy);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ reason: 'set-data' }));
  });

  it('swapData exchanges the data fields and keeps slots in place', () => {
    const grid = mount();

    grid.swapData('a', 'c');

    const aData = (grid.get('a')?.node as { data: { label: string } }).data;
    const cData = (grid.get('c')?.node as { data: { label: string } }).data;

    expect(aData.label).toBe('C');
    expect(cData.label).toBe('A');

    // Slots stay in place.
    const ids = [...host.querySelectorAll(':scope > .sp-container > .sp-panel')]
      .map((el) => (el as HTMLElement).dataset.id);

    expect(ids).toEqual(['a', 'b', 'c']);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ reason: 'swap-data' }));
  });

  it('swapData no-ops on containers', () => {
    const root: Container = {
      id: 'root',
      direction: PanelDirection.Row,
      children: [
        { id: 'g', direction: PanelDirection.Column, children: [{ id: 'g1' }] },
        { id: 'leaf', data: { label: 'L' } },
      ],
    };
    const grid = mount(root);
    const before = (grid.get('leaf')?.node as { data: unknown }).data;

    grid.swapData('g', 'leaf');
    expect((grid.get('leaf')?.node as { data: unknown }).data).toBe(before);
  });
});

describe('setBounds / setDirection', () => {
  it('setBounds merges partial bounds and emits set-bounds', () => {
    const grid = mount();

    grid.setBounds('a', { min: '120px' });
    expect(grid.get('a')?.node.bounds?.min).toBe('120px');
    // Pre-existing fields stay (data/etc).
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ reason: 'set-bounds' }));
  });

  it('setBounds with a `size` rebalances siblings into the requested share', () => {
    const grid = mount();

    grid.setBounds('a', { size: '40%' });

    const { sizes } = (grid.get('root') as { sizes: Array<{ unit: string, value: number }> });

    // Storage is "% of pctBudgetPx", so `setBounds({size: '40%'})` (user
    // input = 40% of container) lands slightly *above* 40 — for a 1000px
    // container with two 6px resizers the value is 40 × 1000/988 ≈ 40.49.
    // The CSS emit at writeTracks scales back; the rendered panel is 40%
    // of the container. Sum-to-100 is the saturation invariant in storage.
    expect(sizes[0].unit).toBe('pct');
    expect(sizes[0].value).toBeGreaterThan(40);
    expect(sizes[0].value).toBeLessThan(41);
    expect(sizes.reduce((acc, s) => acc + s.value, 0)).toBeCloseTo(100, 1);
  });

  it('setBounds raises a panel up to a new min and shrinks siblings to fit', () => {
    const grid = mount();

    // Drive `a` to its current (small) min first.
    grid.minimize('a');

    const sizesBefore = (grid.get('root') as { sizes: Array<{ value: number }> }).sizes;

    expect(sizesBefore[0].value).toBeLessThan(10);

    // Now raise the min well above the current size. The fix is that we must
    // re-clamp the stored size AND rebalance siblings — otherwise CSS's
    // `clamp()` resolves `a` to the new min, siblings keep their large pcts,
    // and the total tracks overflow the container.
    grid.setBounds('a', { min: '300px' });

    const { sizes } = (grid.get('root') as { sizes: Array<{ unit: string, value: number }> });

    expect(sizes[0].unit).toBe('pct');
    // 300px ≈ 30% of the 1000px stub container.
    expect(sizes[0].value).toBeGreaterThan(25);
    // No overflow: pct-only sum + resizer fraction = 100%.
    expect(sizes.reduce((acc, s) => acc + s.value, 0)).toBeLessThanOrEqual(100);
  });

  it('setBounds lowers a panel onto a new max and grows siblings to fill', () => {
    const grid = mount();

    // Push `a` up to a large size first.
    grid.setSize('a', '80%');

    const sizesBefore = (grid.get('root') as { sizes: Array<{ value: number }> }).sizes;

    expect(sizesBefore[0].value).toBeGreaterThan(50);

    // Cap it. Same bug as the min case, opposite direction.
    grid.setBounds('a', { max: '100px' });

    const { sizes } = (grid.get('root') as { sizes: Array<{ unit: string, value: number }> });

    expect(sizes[0].value).toBeLessThan(15); // 100px ≈ 10% of 1000
    expect(sizes.reduce((acc, s) => acc + s.value, 0)).toBeLessThanOrEqual(100);
  });

  it('setBounds on the root persists bounds and emits set-bounds', () => {
    // Root has no parent container to rebalance against, so the body's
    // sibling-rebalance branch is skipped — but the bounds patch still
    // needs to land in node.bounds, and subscribers persisting bounds via
    // onChange need to see the change.
    const grid = mount();

    onChange.mockReset();
    grid.setBounds('root', { min: '100px', max: '900px' });
    expect(grid.get('root')?.node.bounds?.min).toBe('100px');
    expect(grid.get('root')?.node.bounds?.max).toBe('900px');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'set-bounds', containerId: 'root', nodeIds: ['root'],
    }));
  });

  it('setDirection toggles the container\'s axis attribute', () => {
    const grid = mount();
    const containerEl = host.querySelector('.sp-container') as HTMLElement;

    expect(containerEl.dataset.direction).toBe('row');
    grid.setDirection('root', PanelDirection.Column);
    expect(containerEl.dataset.direction).toBe('column');
    // `node` is typed as `Leaf | Container`; direction lives only on Container.
    expect((grid.get('root')?.node as { direction: string }).direction).toBe('column');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ reason: 'set-direction' }));
  });

  it('setDirection is a no-op when the direction is unchanged', () => {
    const grid = mount();

    onChange.mockReset();
    grid.setDirection('root', PanelDirection.Row);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('layout commands (setSize, equalize, reset)', () => {
  it('setSize emits set-size', () => {
    const grid = mount();

    grid.setSize('a', '30%');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ reason: 'set-size' }));
  });

  it('setSize is a no-op when availPx is 0 (pre-measure / detached host)', () => {
    // Regression: when the host has a zero rect (mid-mount, detached, or
    // display:none parent), applyTargetSize used to distribute zero across
    // every child and store [0%, 0%, ...]. The next legitimate measure
    // would then paint a collapsed grid until equalize/reset ran again.
    const grid = mount();
    const before = (grid.get('root') as { sizes: Array<{ unit: string, value: number }> }).sizes
      .map((s) => ({ ...s }));

    // Stub the rect back to zero so refreshAvail produces availPx = 0
    // *for this op only*. The mounted state still has the prior 1000×500
    // sizes from the beforeEach stub frozen into c.sizes.
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}),
    } as DOMRect));

    grid.setSize('a', '50%');

    const after = (grid.get('root') as { sizes: Array<{ unit: string, value: number }> }).sizes;

    // Sizes are unchanged (no all-zeros write). The new behavior is the
    // op short-circuits; before the fix every entry would be 0%.
    for (const [i, s] of after.entries()) {
      expect(s.unit).toBe(before[i].unit);
      expect(s.value).toBeCloseTo(before[i].value, 3);
    }
  });

  it('equalize emits equalize and writes pct sizes for every child', () => {
    const grid = mount();

    grid.equalize('root');

    const { sizes } = (grid.get('root') as { sizes: Array<{ unit: string }> });

    for (const s of sizes) expect(s.unit).toBe('pct');

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ reason: 'equalize' }));
  });

  it('equalize on all-pct stores exactly 100/N per child (sum-to-100)', () => {
    const grid = mount();

    grid.equalize('root');

    const { sizes } = (grid.get('root') as { sizes: Array<{ unit: string, value: number }> });

    // 3 children → each stores 33.33... pct.
    for (const s of sizes) {
      expect(s.unit).toBe('pct');
      expect(s.value).toBeCloseTo(100 / 3, 2);
    }

    expect(sizes.reduce((a, s) => a + s.value, 0)).toBeCloseTo(100, 1);
  });

  it('equalize on all-px keeps px units and rendered widths are equal', () => {
    // Storage form: an all-px container stores `avail/N` px per child.
    // The sum-to-100 pct invariant doesn't apply (no pct entries).
    // CSS still renders equal widths via the px tracks directly.
    const grid = mount({
      id: 'root',
      direction: PanelDirection.Row,
      children: [
        { id: 'a', bounds: { size: '300px' } },
        { id: 'b', bounds: { size: '300px' } },
        { id: 'c', bounds: { size: '300px' } },
      ],
    });

    grid.equalize('root');

    const { sizes } = (grid.get('root') as { sizes: Array<{ unit: string, value: number }> });

    for (const s of sizes) expect(s.unit).toBe('px');

    // 1000px container - 12px resizers = 988 avail; 988 / 3 ≈ 329.33 per child.
    const expected = 988 / 3;

    for (const s of sizes) expect(s.value).toBeCloseTo(expected, 0);
  });

  it('reset restores each child\'s bounds.size (or `fr` if unset)', () => {
    const grid = mount({
      id: 'root',
      direction: PanelDirection.Row,
      children: [
        { id: 'a', bounds: { size: '25%' } },
        { id: 'b', bounds: { size: '50%' } },
        { id: 'c' },
      ],
    });

    // Drag-like mutation to dirty the sizes first.
    grid.setSize('a', '10%');
    grid.reset('root');

    const { sizes } = (grid.get('root') as { sizes: Array<{ unit: string, value: number }> });

    // `bounds.size: '25%'` is user-input form (% of container). Storage
    // is "% of pctBudgetPx" — for a 1000px container with two 6px
    // resizers, budget = 988, so the stored value is 25 × 1000/988 ≈
    // 25.30. The CSS emit at writeTracks scales back so the rendered
    // panel is still 25% of the container.
    expect(sizes[0].unit).toBe('pct');
    expect(sizes[0].value).toBeCloseTo(25 * (1000 / 988), 2);
    expect(sizes[1].unit).toBe('pct');
    expect(sizes[1].value).toBeCloseTo(50 * (1000 / 988), 2);
    expect(sizes[2]).toEqual({ unit: 'fr', value: 1 });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ reason: 'reset' }));
  });

  it('maximize/minimize set size to 100% / 0%', () => {
    const grid = mount();

    grid.maximize('a');

    const afterMax = grid.get('a');

    if (!afterMax?.parent) throw new Error('expected parent');

    // Stored pct sums to 100 when saturated — maximized 'a' takes the
    // whole pct budget, siblings drop to their mins (which are px-sized
    // here so they stay px in storage).
    expect(afterMax.parent.sizes[0].unit).toBe('pct');
    expect(afterMax.parent.sizes[0].value).toBeGreaterThan(50);

    grid.minimize('a');

    const afterMin = grid.get('a');

    if (!afterMin?.parent) throw new Error('expected parent');

    // After minimize the target is at its lower clamp (its bounds.min:
    // '40px' here), so the stored unit reflects the storage convention
    // — anything except 1fr means the size was actually applied.
    expect(afterMin.parent.sizes[0].unit).not.toBe('fr');
  });

  it('maximize / minimize emit distinguishable reasons (not set-size)', () => {
    // Consumers persisting layout via onChange need to tell "user dragged
    // to 100%" from "panel maximized" — same final size, different intent.
    // The two paths used to share `setSize`, which only ever emitted
    // 'set-size'; now they emit dedicated reasons.
    const grid = mount();
    const reasons: string[] = [];

    grid.subscribe((e) => reasons.push(e.reason));

    grid.maximize('a');
    grid.minimize('a');

    expect(reasons).toContain('maximize');
    expect(reasons).toContain('minimize');
    // The setSize path was the bug — make sure neither maximize nor
    // minimize fires 'set-size' as a side effect.
    expect(reasons).not.toContain('set-size');
  });

  it('toggleMaximize emits maximize then minimize', () => {
    const grid = mount();
    const reasons: string[] = [];

    grid.subscribe((e) => reasons.push(e.reason));

    grid.toggleMaximize('a');
    grid.toggleMaximize('a');

    expect(reasons).toEqual(['maximize', 'minimize']);
  });

  it('maximize records a snapshot so isMaximized reflects the state', () => {
    const grid = mount();

    expect(grid.isMaximized('a')).toBe(false);
    grid.maximize('a');
    expect(grid.isMaximized('a')).toBe(true);
  });

  it('minimize clears the maximize snapshot', () => {
    const grid = mount();

    grid.maximize('a');
    expect(grid.isMaximized('a')).toBe(true);
    grid.minimize('a');
    expect(grid.isMaximized('a')).toBe(false);
  });

  it('maximize on a second panel restores the previous maximized panel first', () => {
    const grid = mount();

    grid.maximize('a');
    grid.maximize('b');
    expect(grid.isMaximized('a')).toBe(false);
    expect(grid.isMaximized('b')).toBe(true);
  });

  it('toggleMaximize alternates between maximize and minimize', () => {
    const grid = mount();

    grid.toggleMaximize('a');
    expect(grid.isMaximized('a')).toBe(true);
    grid.toggleMaximize('a');
    expect(grid.isMaximized('a')).toBe(false);

    const sizeAfterMin = grid.get('a');

    // After minimize we expect the panel to be at its min (40px in this
    // tree's spec). State carries unit/value; assert it's not the default
    // 1fr — that would mean we hadn't actually shrunk.
    if (sizeAfterMin?.parent) {
      const sz = sizeAfterMin.parent.sizes[sizeAfterMin.indexInParent];

      expect(sz.unit).not.toBe('fr');
    }
  });
});

describe('toggleExpand and expandNext/Prev', () => {
  it('toggleExpand snapshots on first call and restores on second', () => {
    const grid = mount();

    grid.toggleExpand('b');
    expect(grid.isMaximized('b')).toBe(true);
    grid.toggleExpand('b');
    expect(grid.isMaximized('b')).toBe(false);
  });

  it('only one panel is maximized at a time within a container', () => {
    const grid = mount();

    grid.toggleExpand('a');
    grid.toggleExpand('b'); // restores `a`, then snapshots/maximizes `b`
    expect(grid.isMaximized('a')).toBe(false);
    expect(grid.isMaximized('b')).toBe(true);
  });

  it('expandNext maximizes the first child when nothing is currently maximized', () => {
    const grid = mount();

    expect(grid.expandNext('root')).toBe('a');
    expect(grid.isMaximized('a')).toBe(true);
  });

  it('expandNext moves the maximize state to the next sibling', () => {
    const grid = mount();

    grid.toggleExpand('a');

    const moved = grid.expandNext('root');

    expect(moved).toBe('b');
    expect(grid.isMaximized('a')).toBe(false);
    expect(grid.isMaximized('b')).toBe(true);
  });

  it('expandNext returns undefined when the last child is already maximized', () => {
    const grid = mount();

    grid.toggleExpand('c');
    expect(grid.expandNext('root')).toBeUndefined();
    // `c` stays maximized — no-op, not an unmaximize.
    expect(grid.isMaximized('c')).toBe(true);
  });

  it('expandPrev cycles backward and stops at the first child', () => {
    const grid = mount();

    grid.toggleExpand('c');
    expect(grid.expandPrev('root')).toBe('b');
    expect(grid.expandPrev('root')).toBe('a');
    expect(grid.expandPrev('root')).toBeUndefined();
    expect(grid.isMaximized('a')).toBe(true);
  });

  it('expandPrev maximizes the last child when nothing is currently maximized', () => {
    const grid = mount();

    expect(grid.expandPrev('root')).toBe('c');
    expect(grid.isMaximized('c')).toBe(true);
  });

  it('returns undefined for unknown or non-container ids', () => {
    const grid = mount();

    expect(grid.expandNext('nope')).toBeUndefined();
    // Leaves can't be cycled — they have no children.
    expect(grid.expandNext('a')).toBeUndefined();
  });
});

describe('state queries', () => {
  it('isMaximized reflects the snapshot membership', () => {
    const grid = mount();

    expect(grid.isMaximized('a')).toBe(false);
    grid.toggleExpand('a');
    expect(grid.isMaximized('a')).toBe(true);
    grid.toggleExpand('a');
    expect(grid.isMaximized('a')).toBe(false);
  });

  it('isMaximized is false for the root (never maximizable)', () => {
    const grid = mount();

    expect(grid.isMaximized('root')).toBe(false);
  });

  it('getMaximizedIndex returns -1 with no max, or the child index when set', () => {
    const grid = mount();

    expect(grid.getMaximizedIndex('root')).toBe(-1);
    grid.maximize('b');
    expect(grid.getMaximizedIndex('root')).toBe(1);
    grid.maximize('c');
    expect(grid.getMaximizedIndex('root')).toBe(2);
    grid.minimize('c');
    expect(grid.getMaximizedIndex('root')).toBe(-1);
  });

  it('getMaximizedIndex returns -1 for leaves and unknown ids', () => {
    const grid = mount();

    expect(grid.getMaximizedIndex('a')).toBe(-1); // leaf
    expect(grid.getMaximizedIndex('unknown')).toBe(-1); // not in tree
  });

  it('areChildrenEqual is true after equalize, false after a size change', () => {
    const grid = mount();

    grid.equalize('root');
    expect(grid.areChildrenEqual('root')).toBe(true);
    grid.setSize('a', '50%');
    expect(grid.areChildrenEqual('root')).toBe(false);
    grid.equalize('root');
    expect(grid.areChildrenEqual('root')).toBe(true);
  });

  it('areChildrenEqual is true for containers with fewer than two children', () => {
    const grid = new SplitGrid({
      root: {
        id: 'r',
        direction: PanelDirection.Row,
        children: [{ id: 'only' }],
      },
    });

    grid.mount(host);
    expect(grid.areChildrenEqual('r')).toBe(true);
  });

  it('areChildrenEqual is false for leaves and unknown ids', () => {
    const grid = mount();

    expect(grid.areChildrenEqual('a')).toBe(false);
    expect(grid.areChildrenEqual('unknown')).toBe(false);
  });

  it('isAtDefault is true on mount and after reset, false after a size change', () => {
    const grid = mount({
      id: 'root',
      direction: PanelDirection.Row,
      children: [
        { id: 'a', bounds: { size: '25%' } },
        { id: 'b', bounds: { size: '50%' } },
        { id: 'c' },
      ],
    });

    expect(grid.isAtDefault('a')).toBe(true);
    expect(grid.isAtDefault('c')).toBe(true);

    grid.setSize('a', '40%');
    expect(grid.isAtDefault('a')).toBe(false);
    // Siblings re-balance, so they're also off-default after a setSize.
    expect(grid.isAtDefault('b')).toBe(false);

    grid.reset('root');
    expect(grid.isAtDefault('a')).toBe(true);
    expect(grid.isAtDefault('b')).toBe(true);
    expect(grid.isAtDefault('c')).toBe(true);
  });
});

describe('onChange', () => {
  it('fires once per accepted layout mutation', () => {
    const grid = mount();

    onChange.mockReset();
    grid.setSize('a', '30%');
    grid.toggleExpand('b');
    grid.equalize('root');
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('includes a cloned sizes snapshot the consumer can keep', () => {
    const grid = mount();

    onChange.mockReset();
    grid.equalize('root');

    const event = onChange.mock.calls[0][0];
    const liveSizes = (grid.get('root') as { sizes: unknown[] }).sizes;

    expect(event.sizes).toEqual(liveSizes);
    expect(event.sizes).not.toBe(liveSizes); // different array reference
  });
});

describe('syncChildren (bulk diff/sync)', () => {
  it('removes children not present in the new defs', () => {
    const grid = mount();

    grid.syncChildren('root', [
      { id: 'a' },
      { id: 'c' },
    ]);

    const ids = (grid.get('root') as { node: { children: Array<{ id: string }> } })
      .node.children.map((c) => c.id);

    expect(ids).toEqual(['a', 'c']);
    expect(grid.get('b')).toBeUndefined();
  });

  it('appends new children at the end when they do not exist yet', () => {
    const grid = mount();

    grid.syncChildren('root', [
      { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd', data: { label: 'D' } },
    ]);

    const ids = (grid.get('root') as { node: { children: Array<{ id: string }> } })
      .node.children.map((c) => c.id);

    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });

  it('inserts new children at the requested index', () => {
    const grid = mount();

    grid.syncChildren('root', [
      { id: 'x', data: { label: 'X' } },
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ]);

    const ids = (grid.get('root') as { node: { children: Array<{ id: string }> } })
      .node.children.map((c) => c.id);

    expect(ids).toEqual(['x', 'a', 'b', 'c']);
  });

  it('reorders existing children to match the new sequence', () => {
    const grid = mount();

    grid.syncChildren('root', [
      { id: 'c' }, { id: 'a' }, { id: 'b' },
    ]);

    const ids = (grid.get('root') as { node: { children: Array<{ id: string }> } })
      .node.children.map((c) => c.id);

    expect(ids).toEqual(['c', 'a', 'b']);
  });

  it('handles mixed insert + remove + reorder in one call', () => {
    const grid = mount();

    grid.syncChildren('root', [
      { id: 'new', data: { label: 'New' } },
      { id: 'c' },
      { id: 'a' },
    ]);

    const ids = (grid.get('root') as { node: { children: Array<{ id: string }> } })
      .node.children.map((c) => c.id);

    expect(ids).toEqual(['new', 'c', 'a']);
    // `b` was not in the new defs.
    expect(grid.get('b')).toBeUndefined();
  });

  it('fires per-underlying-op events: one add-child / remove-child / swap per granular mutation', () => {
    // syncChildren composes add/remove/swap; each underlying call still
    // fires its own onChange (this is documented contract). Subscribers
    // see N events for an N-step reconcile — never coalesces. This test
    // locks the count so refactors that batch the inner calls have to
    // make an intentional decision about the emit shape.
    const grid = mount();
    const events: string[] = [];

    grid.subscribe((e) => events.push(e.reason));

    // Mixed: remove b, insert d at index 0, swap a/c. Underlying ops:
    //   removeChild('b')          → 'remove-child'
    //   addChild(d, 0)            → 'add-child'
    //   swap(c, a) (positions 1↔2) → 'swap'
    grid.syncChildren('root', [
      { id: 'd', data: { label: 'D' } },
      { id: 'c' },
      { id: 'a' },
    ]);

    expect(events.filter((r) => r === 'remove-child')).toHaveLength(1);
    expect(events.filter((r) => r === 'add-child')).toHaveLength(1);
    expect(events.filter((r) => r === 'swap')).toHaveLength(1);
  });

  it('no-ops cleanly when defs match the current children', () => {
    const grid = mount();
    const before = [...(grid.get('root') as { sizes: unknown[] }).sizes];

    grid.syncChildren('root', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect((grid.get('root') as { sizes: unknown[] }).sizes).toEqual(before);
  });

  it('clears the container when given an empty list', () => {
    const grid = mount();

    grid.syncChildren('root', []);
    expect((grid.get('root') as { node: { children: unknown[] } }).node.children).toEqual([]);
  });

  it('is a no-op for non-container / unknown ids', () => {
    const grid = mount();

    grid.syncChildren('nope', [{ id: 'x' }]);
    grid.syncChildren('a', [{ id: 'x' }]); // 'a' is a leaf
    // Tree unchanged.
    expect((grid.get('root') as { node: { children: Array<{ id: string }> } })
      .node.children.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('setDataArray (bulk data update)', () => {
  it('sets data on each leaf in the list', () => {
    const grid = mount();

    grid.setDataArray([
      { id: 'a', data: { label: 'Aprime' } },
      { id: 'c', data: { label: 'Cprime' } },
    ]);

    const aData = (grid.get('a')?.node as { data: { label: string } }).data;
    const cData = (grid.get('c')?.node as { data: { label: string } }).data;

    expect(aData.label).toBe('Aprime');
    expect(cData.label).toBe('Cprime');
    // `b` untouched.
    expect((grid.get('b')?.node as { data: { label: string } }).data.label).toBe('B');
  });

  it('skips unknown ids without throwing', () => {
    const grid = mount();

    expect(() => {
      grid.setDataArray([
        { id: 'a', data: { label: 'A1' } },
        { id: 'nope', data: { label: 'gone' } },
      ]);
    }).not.toThrow();
    expect((grid.get('a')?.node as { data: { label: string } }).data.label).toBe('A1');
  });

  it('fires one set-data event per affected leaf', () => {
    const grid = mount();

    onChange.mockReset();
    grid.setDataArray([
      { id: 'a', data: { label: 'A1' } },
      { id: 'b', data: { label: 'B1' } },
    ]);

    const reasons = onChange.mock.calls.map((c) => (c[0] as { reason: string }).reason);

    expect(reasons.filter((r) => r === 'set-data').length).toBe(2);
  });
});

describe('subscribe', () => {
  it('registers a callback that fires alongside cfg.onChange', () => {
    const grid = mount();
    const sub = vi.fn();

    grid.subscribe(sub);
    onChange.mockReset();

    grid.setSize('a', '30%');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(sub).toHaveBeenCalledTimes(1);
  });

  it('supports multiple subscribers', () => {
    const grid = mount();
    const sub1 = vi.fn();
    const sub2 = vi.fn();

    grid.subscribe(sub1);
    grid.subscribe(sub2);
    grid.equalize('root');
    expect(sub1).toHaveBeenCalledTimes(1);
    expect(sub2).toHaveBeenCalledTimes(1);
  });

  it('returns an unsubscribe function', () => {
    const grid = mount();
    const sub = vi.fn();
    const off = grid.subscribe(sub);

    grid.setSize('a', '20%');
    expect(sub).toHaveBeenCalledTimes(1);

    off();
    grid.setSize('a', '40%');
    expect(sub).toHaveBeenCalledTimes(1);
  });

  it('isolates subscriber errors so one bad listener does not block the rest', () => {
    const grid = mount();
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();

    grid.subscribe(bad);
    grid.subscribe(good);

    // Should not throw out of setSize.
    expect(() => grid.setSize('a', '30%')).not.toThrow();
    expect(good).toHaveBeenCalled();
  });
});

describe('event nodeIds', () => {
  it('set-data includes the affected leaf', () => {
    const grid = mount();
    const sub = vi.fn();

    grid.subscribe(sub);
    grid.setData('a', { label: 'A!' });
    expect(sub).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'set-data', nodeIds: ['a'],
    }));
  });

  it('swap-data includes both leaves', () => {
    const grid = mount();
    const sub = vi.fn();

    grid.subscribe(sub);
    grid.swapData('a', 'b');
    expect(sub).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'swap-data', nodeIds: expect.arrayContaining(['a', 'b']),
    }));
  });

  it('add-child / remove-child carry the new / removed id', () => {
    const grid = mount();
    const sub = vi.fn();

    grid.subscribe(sub);
    grid.addChild('root', { id: 'd', data: { label: 'D' } });
    expect(sub).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'add-child', nodeIds: ['d'],
    }));

    sub.mockReset();
    grid.removeChild('b');
    expect(sub).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'remove-child', nodeIds: ['b'],
    }));
  });

  it('set-size carries the resized leaf', () => {
    const grid = mount();
    const sub = vi.fn();

    grid.subscribe(sub);
    grid.setSize('a', '30%');
    expect(sub).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'set-size', nodeIds: ['a'],
    }));
  });

  it('toggle-expand carries the toggled leaf', () => {
    const grid = mount();
    const sub = vi.fn();

    grid.subscribe(sub);
    grid.toggleExpand('a');
    expect(sub).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'toggle-expand', nodeIds: ['a'],
    }));
  });

  it('equalize / reset / drag use an empty nodeIds (every child affected)', () => {
    const grid = mount();
    const sub = vi.fn();

    grid.subscribe(sub);
    grid.equalize('root');
    grid.reset('root');

    const eqEvent = sub.mock.calls[0][0];
    const rsEvent = sub.mock.calls[1][0];

    expect(eqEvent.nodeIds).toEqual([]);
    expect(rsEvent.nodeIds).toEqual([]);
  });
});

describe('getRawDefinition', () => {
  it('returns undefined when the grid has not been mounted', () => {
    const grid = new SplitGrid({ root: tree() });

    // Before mount: no element-derived sizes to report. Return undefined
    // rather than guessing.
    expect(grid.getRawDefinition()).toBeUndefined();
  });

  it('returns a deep clone of the live tree (root + children)', () => {
    const grid = mount();
    const def = grid.getRawDefinition();

    expect(def).toBeDefined();
    expect(def!.id).toBe('root');
    expect(def!.direction).toBe('row');
    expect(def!.children?.map((c) => c.id)).toEqual(['a', 'b', 'c']);

    // Deep clone — mutating the returned definition doesn't touch the
    // running grid.
    def!.children!.push({ id: 'ghost' });
    expect(grid.get('ghost')).toBeUndefined();
  });

  it('bakes current sizes into bounds.size by default', () => {
    const grid = mount();

    grid.setSize('a', '300px');

    const def = grid.getRawDefinition();
    const a = def!.children!.find((c) => c.id === 'a')!;

    // Current size is in px (we measure off rect). The serialized form
    // should reflect what the user is actually looking at, not the
    // original definition's `auto`.
    expect(a.bounds?.size).toMatch(/^\d+px$/);
  });

  it('preserves the original bounds.size when withCurrentSizes is false', () => {
    const grid = mount({
      id: 'root',
      direction: PanelDirection.Row,
      children: [
        { id: 'a', bounds: { size: '200px' } },
        { id: 'b' },
      ],
    });

    grid.setSize('a', '400px');

    const def = grid.getRawDefinition({ withCurrentSizes: false });
    const a = def!.children!.find((c) => c.id === 'a')!;

    expect(a.bounds?.size).toBe('200px');
  });

  it('round-trips: rebuilding a grid from getRawDefinition produces matching ids', () => {
    const grid = mount();
    const def = grid.getRawDefinition()!;
    const replica = new SplitGrid({ root: def });

    replica.mount(document.createElement('div'));
    expect(replica.get('a')).toBeDefined();
    expect(replica.get('b')).toBeDefined();
    expect(replica.get('c')).toBeDefined();
  });

  it('includes data by default and strips it when includeData is false', () => {
    const grid = mount();
    const withData = grid.getRawDefinition()!;
    const withoutData = grid.getRawDefinition({ includeData: false })!;

    const aWith = withData.children!.find((c) => c.id === 'a') as { data?: { label: string } };
    const aWithout = withoutData.children!.find((c) => c.id === 'a') as { data?: { label: string } };

    expect(aWith.data?.label).toBe('A');
    expect(aWithout.data).toBeUndefined();
  });

  it('recurses through nested containers', () => {
    const grid = mount({
      id: 'root',
      direction: PanelDirection.Row,
      children: [
        { id: 'a' },
        {
          id: 'mid',
          direction: PanelDirection.Column,
          children: [
            { id: 'mid-a' },
            { id: 'mid-b' },
          ],
        },
      ],
    });

    const def = grid.getRawDefinition()!;
    const mid = def.children!.find((c) => c.id === 'mid') as { direction: string, children: Array<{ id: string }> };

    expect(mid.direction).toBe('column');
    expect(mid.children.map((c) => c.id)).toEqual(['mid-a', 'mid-b']);
  });
});

describe('settle (transitionend wait)', () => {
  it('returns a resolved Promise when grid is not mounted', async () => {
    const grid = new SplitGrid({ root: tree() });

    // Nothing to wait on; the helper should be a no-op rather than hang.
    await expect(grid.settle()).resolves.toBeUndefined();
  });

  it('resolves when transitionend fires on the container', async () => {
    const grid = mount();
    const rootEl = host.querySelector('.sp-container') as HTMLElement;
    const settled = vi.fn();
    const promise = grid.settle('root').then(() => settled());

    // Microtask flush — settle hasn't seen any event yet.
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    rootEl.dispatchEvent(new TransitionEvent('transitionend', {
      propertyName: 'grid-template-columns', bubbles: true,
    }));
    await promise;
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('ignores transitionend for unrelated properties', async () => {
    const grid = mount();
    const rootEl = host.querySelector('.sp-container') as HTMLElement;
    let resolved = false;
    // Keep the promise to await on at the end — `await Promise.resolve()`
    // only flushes one microtask, but Promise.all → outer-async-fn adds
    // a couple more hops. Awaiting the actual promise is robust.
    const p = grid.settle('root').then(() => {
      resolved = true;
    });

    // An unrelated transitionend (e.g. opacity, height) should not unblock.
    rootEl.dispatchEvent(new TransitionEvent('transitionend', {
      propertyName: 'opacity', bubbles: true,
    }));
    // Flush a few microtasks; resolved must still be false.
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);

    rootEl.dispatchEvent(new TransitionEvent('transitionend', {
      propertyName: 'grid-template-columns', bubbles: true,
    }));
    await p;
    expect(resolved).toBe(true);
  });

  it('falls back to a timeout when no transitionend fires', async () => {
    const grid = mount();
    const start = Date.now();

    await grid.settle('root', { timeout: 30 });

    const elapsed = Date.now() - start;

    // happy-dom never fires transitionend naturally; the helper has to
    // unblock via its timeout. Be generous on the upper bound — CI is slow.
    expect(elapsed).toBeGreaterThanOrEqual(25);
    expect(elapsed).toBeLessThan(1000);
  });

  it('settle() with no containerId waits for every container', async () => {
    const grid = mount({
      id: 'root',
      direction: PanelDirection.Row,
      children: [
        { id: 'a' },
        {
          id: 'mid',
          direction: PanelDirection.Column,
          children: [{ id: 'm1' }, { id: 'm2' }],
        },
      ],
    });
    const containers = host.querySelectorAll('.sp-container');
    let resolved = false;
    // Keep the promise handle so we can await it after the second dispatch
    // — async-fn-around-Promise.all hops a few microtasks; awaiting the
    // actual promise is more robust than counting flushes.
    const p = grid.settle().then(() => {
      resolved = true;
    });

    // Only the root fires — promise stays pending while inner is in flight.
    (containers[0] as HTMLElement).dispatchEvent(new TransitionEvent('transitionend', {
      propertyName: 'grid-template-columns', bubbles: true,
    }));
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);

    // Inner finishes too — now the all-settled promise resolves.
    (containers[1] as HTMLElement).dispatchEvent(new TransitionEvent('transitionend', {
      propertyName: 'grid-template-rows', bubbles: true,
    }));
    await p;
    expect(resolved).toBe(true);
  });

  it('settle on a non-container id is a resolved no-op', async () => {
    const grid = mount();

    // Leaves don't animate themselves (they're inside a container's track);
    // calling settle on a leaf should resolve immediately rather than wait.
    await expect(grid.settle('a')).resolves.toBeUndefined();
  });
});

// Helper hoisted out — eslint requires top-level scoping for this style.
function makeMoveDataTree(items: string[]): Container<{ label: string }> {
  return {
    id: 'root',
    direction: PanelDirection.Row,
    children: items.map((label) => ({ id: label.toLowerCase(), data: { label } })),
  };
}

describe('moveData', () => {
  it('moves data from source into target slot, shifting intermediates', () => {
    // [A,B,C,D] move A onto C → A leaves its slot, slides into C's position;
    // B and C shift left to fill the gap; D stays put. The IDs (and slot
    // positions) don't change — only the data flows between them.
    const grid = new SplitGrid<{ label: string }>({ root: makeMoveDataTree(['A', 'B', 'C', 'D']) });

    grid.mount(host);
    grid.moveData('a', 'c');

    const labels = ['a', 'b', 'c', 'd'].map(
      (id) => ((grid.get(id)?.node) as { data: { label: string } }).data.label,
    );

    expect(labels).toEqual(['B', 'C', 'A', 'D']);
  });

  it('moves backward correctly (later → earlier)', () => {
    const grid = new SplitGrid<{ label: string }>({ root: makeMoveDataTree(['A', 'B', 'C', 'D']) });

    grid.mount(host);
    grid.moveData('d', 'b');

    const labels = ['a', 'b', 'c', 'd'].map(
      (id) => ((grid.get(id)?.node) as { data: { label: string } }).data.label,
    );

    // Source D removed → [A, B, C]; insert at target B's index (1) → [A, D, B, C]
    expect(labels).toEqual(['A', 'D', 'B', 'C']);
  });

  it('emits move-data with both ids in nodeIds', () => {
    const grid = new SplitGrid<{ label: string }>({ root: makeMoveDataTree(['A', 'B', 'C']) });
    const sub = vi.fn();

    grid.mount(host);
    grid.subscribe(sub);
    grid.moveData('a', 'c');

    expect(sub).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'move-data',
      nodeIds: expect.arrayContaining(['a', 'c']),
    }));
  });

  it('no-ops when source === target', () => {
    const grid = new SplitGrid<{ label: string }>({ root: makeMoveDataTree(['A', 'B', 'C']) });
    const sub = vi.fn();

    grid.mount(host);
    grid.subscribe(sub);
    grid.moveData('a', 'a');
    expect(sub).not.toHaveBeenCalled();
  });

  it('no-ops on cross-parent moves (only same-container rearranges)', () => {
    const grid = new SplitGrid<{ label: string }>({
      root: {
        id: 'root',
        direction: PanelDirection.Row,
        children: [
          { id: 'a', data: { label: 'A' } },
          {
            id: 'group',
            direction: PanelDirection.Column,
            children: [
              { id: 'b', data: { label: 'B' } },
              { id: 'c', data: { label: 'C' } },
            ],
          },
        ],
      },
    });

    grid.mount(host);
    // Move-with-shift is undefined across parents (the slot positions are
    // in different containers). Cross-parent is a swap-shaped operation;
    // keep moveData strict, and swap remains the cross-parent option.
    grid.moveData('a', 'b');
    expect(((grid.get('a')?.node) as { data: { label: string } }).data.label).toBe('A');
    expect(((grid.get('b')?.node) as { data: { label: string } }).data.label).toBe('B');
  });
});

describe('PanelDirection constant', () => {
  it('Row and Column expand to the strings CSS Grid expects', () => {
    // The const constants are the only spelling now (the Direction type
    // alias was dropped). Their runtime values still match the strings
    // CSS Grid's `grid-auto-flow` / `grid-template-*` direction families
    // expect, which is what makes `direction === PanelDirection.Row`
    // work both as TS comparison and as the value the runtime feeds CSS.
    expect(PanelDirection.Row).toBe('row');
    expect(PanelDirection.Column).toBe('column');
  });
});

describe('resizer.first / resizer.last (decorative edge resizers)', () => {
  it('renders a leading resizer when `resizer.first` is true', () => {
    new SplitGrid({
      root: {
        id: 'root',
        direction: PanelDirection.Row,
        resizer: { first: true },
        children: [{ id: 'a' }, { id: 'b' }],
      },
    }).mount(host);

    const resizers = host.querySelectorAll('.sp-resizer');

    // 2 children → 1 inner divider + 1 leading edge = 2 total.
    expect(resizers).toHaveLength(2);

    // The leading edge appears before any .sp-panel.
    const first = host.querySelector('.sp-container > :first-child') as HTMLElement;

    expect(first.classList.contains('sp-resizer')).toBe(true);
    expect(first.dataset.edge).toBe('leading');
  });

  it('renders a trailing resizer when `resizer.last` is true', () => {
    new SplitGrid({
      root: {
        id: 'root',
        direction: PanelDirection.Row,
        resizer: { last: true },
        children: [{ id: 'a' }, { id: 'b' }],
      },
    }).mount(host);

    const last = host.querySelector('.sp-container > :last-child') as HTMLElement;

    expect(last.classList.contains('sp-resizer')).toBe(true);
    expect(last.dataset.edge).toBe('trailing');
  });

  it('decorative edges do not bind drag (no pointerdown handler resizes anything)', () => {
    const grid = new SplitGrid({
      root: {
        id: 'root',
        direction: PanelDirection.Row,
        resizer: { first: true },
        children: [{ id: 'a', bounds: { min: '40px' } }, { id: 'b', bounds: { min: '40px' } }],
      },
    });

    grid.mount(host);

    const leading = host.querySelector('.sp-resizer[data-edge="leading"]') as HTMLElement;
    const beforeTracks = (host.querySelector('.sp-container') as HTMLElement)
      .style.getPropertyValue('--sp-tracks');

    leading.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: 0, clientY: 0, bubbles: true, button: 0,
    }));
    document.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 100, clientY: 0, bubbles: true,
    }));
    document.dispatchEvent(new PointerEvent('pointerup', {
      clientX: 100, clientY: 0, bubbles: true,
    }));

    const afterTracks = (host.querySelector('.sp-container') as HTMLElement)
      .style.getPropertyValue('--sp-tracks');

    expect(afterTracks).toBe(beforeTracks);
  });

  it('track string includes the extra leading/trailing tracks', () => {
    new SplitGrid({
      root: {
        id: 'root',
        direction: PanelDirection.Row,
        resizer: { first: true, last: true, size: 16 },
        children: [{ id: 'a' }, { id: 'b' }],
      },
    }).mount(host);

    const tracks = (host.querySelector('.sp-container') as HTMLElement)
      .style.getPropertyValue('--sp-tracks');
    // 1 leading + 2 content + 1 inner + 1 trailing = 5 tracks.
    const parts = tracks.split(/\s+(?=(?:[^()]|\([^()]*\))*$)/);

    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe('16px');
    expect(parts.at(-1)).toBe('16px');
  });

  it('leading-edge `resizer.after` reports children[0] (not undefined)', () => {
    // Regression: the inner-divider formula `after = children[handleIdx]`
    // returns children[-1] === undefined for the leading edge, leaving
    // consumers with no way to identify the adjacent panel (e.g. to label
    // it in a wrapper #resizer slot). Leading edge sits BEFORE children[0],
    // so children[0] is what `after` should report.
    const seen: Array<{ index: number, beforeId: string | undefined, afterId: string | undefined }> = [];

    new SplitGrid({
      root: {
        id: 'root',
        direction: PanelDirection.Row,
        resizer: {
          first: true,
          last: true,
          render: (_el, ctx) => {
            seen.push({
              index: ctx.index,
              beforeId: ctx.before?.id,
              afterId: ctx.after?.id,
            });
          },
        },
        children: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      },
    }).mount(host);

    const leading = seen.find((s) => s.index === -1);
    const trailing = seen.find((s) => s.index === 3);
    const inner = seen.find((s) => s.index === 1);

    expect(leading).toEqual({ index: -1, beforeId: undefined, afterId: 'a' });
    expect(trailing).toEqual({ index: 3, beforeId: 'c', afterId: undefined });
    expect(inner).toEqual({ index: 1, beforeId: 'a', afterId: 'b' });
  });

  it('inner-divider dblclick toggles maximize; triple-click equalizes', () => {
    // Two click-count gestures:
    //   detail=2 (dblclick) → toggleMaximize on edge-closer adjacent panel
    //                         (delayed by TRIPLE_CLICK_GRACE_MS so a
    //                         follow-up third click can promote to
    //                         equalize before the maximize fires).
    //   detail=3 (triple)   → equalize parent container (cancels pending).
    vi.useFakeTimers();

    try {
      const grid = new SplitGrid({
        root: {
          id: 'root',
          direction: PanelDirection.Row,
          children: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        },
      });

      grid.mount(host);

      const divider = host.querySelector('.sp-container > .sp-resizer') as HTMLElement;

      expect(divider).toBeTruthy();

      // detail=2 schedules toggleMaximize after the grace window.
      divider.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
      expect(grid.isMaximized('a')).toBe(false);
      vi.advanceTimersByTime(300);
      // For divider 1 in [A B C], target = A (tie broken toward "before").
      expect(grid.isMaximized('a')).toBe(true);

      // detail=2 queues pending, detail=3 cancels and equalizes.
      divider.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
      divider.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 3 }));
      vi.advanceTimersByTime(300);
      expect(grid.isMaximized('a')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('decorative edge resizers have no handle (handle is inner-divider-only)', () => {
    // Decorative edges are chrome the consumer paints into — no drag, no
    // built-in handle. The dblclick / triple-click gestures still apply
    // (asserted in the next test); the handle is purely visual.
    const grid = new SplitGrid({
      root: {
        id: 'root',
        direction: PanelDirection.Row,
        resizer: { first: true, last: true },
        children: [{ id: 'a' }, { id: 'b' }],
      },
    });

    grid.mount(host);

    const leading = host.querySelector('.sp-resizer[data-edge="leading"]') as HTMLElement;

    expect(leading.querySelector('.sp-resizer-handle')).toBeNull();
  });

  it('decorative edge resizer dblclick expands the adjacent panel', () => {
    // The leading edge is the "header bar to the left of panel[0]" the
    // legacy showFirstResizeEl pattern uses. It must not be draggable
    // (asserted by the test above), but it SHOULD respond to dblclick by
    // maximizing the panel it sits next to — that's the main affordance
    // the bar exists for. Same on the trailing edge for the last panel.
    // Triple-click on either edge equalizes the parent.
    vi.useFakeTimers();

    try {
      const grid = new SplitGrid({
        root: {
          id: 'root',
          direction: PanelDirection.Row,
          resizer: { first: true, last: true },
          children: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        },
      });

      grid.mount(host);

      const leading = host.querySelector('.sp-resizer[data-edge="leading"]') as HTMLElement;

      leading.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
      vi.advanceTimersByTime(300);
      expect(grid.isMaximized('a')).toBe(true);

      // Restore via second dblclick (toggleMaximize → minimize once snapshotted).
      leading.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
      vi.advanceTimersByTime(300);
      expect(grid.isMaximized('a')).toBe(false);

      const trailing = host.querySelector('.sp-resizer[data-edge="trailing"]') as HTMLElement;

      trailing.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
      vi.advanceTimersByTime(300);
      expect(grid.isMaximized('c')).toBe(true);

      // Triple-click on the trailing edge clears the maximize via equalize.
      trailing.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
      trailing.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 3 }));
      vi.advanceTimersByTime(300);
      expect(grid.isMaximized('c')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('equalize gives equal sizes when no min exceeds the even share', () => {
    // Regression: the old equalize formula was `min + (avail - Σmin) / N`.
    // With mins [294, 0] and avail 1136, that gave [715, 421] — visibly
    // unequal even though every min was below the even share of 568. The
    // user observed this as `[48.299%, 48.299%]` shifting to
    // `[60.799%, 35.799%]` between consecutive writeTracks in the
    // dashboard log. The correct semantic: aim for `avail / N`; only
    // pin a panel at its min when the min exceeds that share, and re-
    // share over remaining panels.
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
    grid.equalize('root');

    const state = grid.get('root');

    if (!state || !('sizes' in state)) throw new Error('expected container');

    const [a, b] = state.sizes;

    if (a.unit !== 'pct' || b.unit !== 'pct') throw new Error('expected pct');

    // 1000px container, 1 inner divider × 20px = 20px, avail = budget
    // = 980. Even share is 490px. Panel a's 25% min is 250px, well
    // below the share. Storage form (% of budget): each panel = 50%
    // exactly, sum = 100. CSS-emit scales by budget/container =
    // 980/1000 so the painted track is still 49% of container.
    expect(a.value).toBeCloseTo(50, 2);
    expect(b.value).toBeCloseTo(50, 2);
  });

  it('equalize pins panels whose min exceeds the even share and re-shares the rest', () => {
    // When a min CAN'T be satisfied at the even share, that panel pins
    // at its min and the remaining panels split the leftover. The
    // iterative pin-and-reshare handles the cascade if multiple panels
    // need pinning.
    const grid = new SplitGrid({
      root: {
        id: 'root',
        direction: PanelDirection.Row,
        resizer: { size: 20 },
        children: [
          { id: 'a', bounds: { min: '60%' } }, // min = 600, well above avail/3
          { id: 'b' },
          { id: 'c' },
        ],
      },
    });

    grid.mount(host);
    grid.equalize('root');

    const state = grid.get('root');

    if (!state || !('sizes' in state)) throw new Error('expected container');

    const [a, b, c] = state.sizes;

    if (a.unit !== 'pct' || b.unit !== 'pct' || c.unit !== 'pct') throw new Error('expected pct');

    // 1000px container, 2 resizers × 20 = 40, avail = budget = 960.
    // Even share would be 320. Panel a's min = 60% × 1000 = 600 > 320,
    // so a pins at 600. Remaining avail = 360, shared between b and c
    // = 180 each. As pct of 960 budget: a = 62.5%, b = c = 18.75%.
    // Sum = 100. CSS-emit scales each by 960/1000 = 0.96 so the painted
    // widths are 60%/18%/18% of container.
    expect(a.value).toBeCloseTo(62.5, 2);
    expect(b.value).toBeCloseTo(18.75, 2);
    expect(c.value).toBeCloseTo(18.75, 2);
  });

  it('setBounds short-circuits when no field actually changed (Vue recursion guard)', () => {
    // Defense against Vue's shallow watcher firing on every render of
    // `<SplitPanel :size="someComputed">` — even when the computed
    // returns the same value, the watcher refires. Without this guard
    // every render path through SplitPanel produces an applyTargetSize
    // call and emits a 'set-bounds' onChange event. The fixture below
    // attaches a subscriber to count emits.
    const grid = new SplitGrid({
      root: {
        id: 'root',
        direction: PanelDirection.Row,
        children: [
          { id: 'a', bounds: { min: '25%', size: '40%' } },
          { id: 'b' },
        ],
      },
    });
    let emits = 0;

    grid.subscribe(() => {
      emits += 1;
    });
    grid.mount(host);

    const baseline = emits;

    // Same bounds → no emit, no applyTargetSize.
    grid.setBounds('a', { min: '25%' });
    grid.setBounds('a', { size: '40%' });
    grid.setBounds('a', { min: '25%', size: '40%' });
    expect(emits).toBe(baseline);

    // Real change → exactly one emit.
    grid.setBounds('a', { min: '30%' });
    expect(emits).toBe(baseline + 1);
  });

  it('setData short-circuits when the new value is reference-equal', () => {
    // Same Vue-recursion defense for the data path. Object.is means the
    // same primitive or same object reference both count as no-op.
    const grid = new SplitGrid<{ label: string }>({
      root: {
        id: 'root',
        direction: PanelDirection.Row,
        children: [{ id: 'a', data: { label: 'A' } }, { id: 'b' }],
      },
    });
    let emits = 0;

    grid.subscribe(() => {
      emits += 1;
    });
    grid.mount(host);

    const baseline = emits;
    const original = (grid.get('a') as { node: { data: { label: string } } }).node.data;

    // Setting to the same reference → no-op.
    grid.setData('a', original);
    expect(emits).toBe(baseline);

    // Different reference (even with equivalent shape) → counts as
    // changed. This is the documented contract: `setData` is a
    // reference-equality check, not a deep one.
    grid.setData('a', { label: 'A' });
    expect(emits).toBe(baseline + 1);
  });

  it('setBounds (no size patch) is idempotent — does not drift sizes on repeat calls', () => {
    // Regression: setBounds with patch = {min: …} reads
    // `parent.sizes[targetIdx]` (a pct value stored as "% of
    // containerAxisPx") and converts to px. The conversion used `avail`
    // (= container − resizer tracks) as the denominator — but pct values
    // are container-relative, so the resulting px was `pct × resizerTracksPx`
    // smaller than the panel's actual rendered size. Each setBounds call
    // shrank the target and gave the slack to siblings, drifting the
    // layout further on every iteration. The dashboard hit this when
    // SplitPanel's `:min` watcher fired after layout-options resolved:
    // post-equalize sizes shifted from [48.3%, 48.3%] to [60.8%, 35.8%]
    // on a single setBounds.
    //
    // Fix: all toPx denominators use containerAxisPx (matching CSS). After
    // the fix, setBounds with only a min update is idempotent — the
    // current size round-trips through toPx unchanged.
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

    const stateBefore = grid.get('root');

    if (!stateBefore || !('sizes' in stateBefore)) throw new Error('expected container');

    const sizesBefore = stateBefore.sizes.map((s) => (s.unit === 'pct' ? s.value : Number.NaN));

    grid.setBounds('a', { min: '25%' });

    const stateAfter = grid.get('root');

    if (!stateAfter || !('sizes' in stateAfter)) throw new Error('expected container');

    const sizesAfter = stateAfter.sizes.map((s) => (s.unit === 'pct' ? s.value : Number.NaN));

    // Panel 'a' is at 48.something% post-equalize, well above its new
    // 25% min — so the min adds a floor but doesn't grow the panel.
    // Sibling 'b' should also stay put.
    for (const [i, element] of sizesBefore.entries()) {
      expect(sizesAfter[i]).toBeCloseTo(element, 1);
    }
  });

  it('percentage bounds resolve against full container — sum of tracks fits exactly', () => {
    // Regression for the JS-vs-CSS percentage drift: bounds.min/max
    // resolved against availPx in JS but CSS resolves the same percentages
    // against the full container including resizer tracks. With
    // `min: 25%` on panel A in a 5-panel row with leading edge + 4 inner
    // dividers (5 × 20px = 100px) on a 1000px-wide stub, the old code
    // clamped A to 0.25 × 900 = 225px while CSS painted it at 0.25 × 1000
    // = 250px — the 25px difference cascades into overflow.
    //
    // Container axis in this test fixture is 1000px (from the beforeEach
    // getBoundingClientRect stub).
    const grid = new SplitGrid({
      root: {
        id: 'root',
        direction: PanelDirection.Row,
        resizer: { first: true, size: 20 },
        children: [
          { id: 'a', bounds: { min: '25%' } },
          { id: 'b' },
          { id: 'c' },
          { id: 'd' },
          { id: 'e' },
        ],
      },
    });

    grid.mount(host);
    // Minimize A: requests 0%, clamped to its 25% min. The JS-resolved
    // floor must match CSS's 25% of 1000 = 250px, NOT 25% of (1000-80)
    // = 230px. Then siblings get (1000 - 250 - 80) / 4 = 167.5px each.
    grid.minimize('a');

    const state = grid.get('root');

    if (!state || !('sizes' in state)) throw new Error('expected container');

    const { sizes } = state;

    if (sizes.some((s) => s.unit !== 'pct')) {
      throw new Error(`expected pct sizes, got ${sizes.map((s) => s.unit).join(',')}`);
    }

    // Stored sizes are in budget-pct form, sum-to-100 invariant. avail =
    // 1000 − 5 × 20 = 900, so the budget for pct sizes is 900. Panel A
    // clamped to its 25% min (250px) — in budget-pct that's 250/900 ≈
    // 27.78. Siblings (4 of them) share 900 − 250 = 650 → 162.5 each
    // → 162.5/900 ≈ 18.06 each. Sum = 27.78 + 4 × 18.06 = 100.
    const panelPctSum = sizes.reduce((a, s) => a + s.value, 0);

    expect(panelPctSum).toBeCloseTo(100, 1);
    expect(sizes[0].value).toBeCloseTo(250 / 900 * 100, 1);
  });

  it('subtracts leading + trailing resizer tracks from availPx', () => {
    // Regression: refreshAvail used to only subtract `(children-1)` inner
    // dividers, ignoring resizer.first / resizer.last. With `first` + `last`
    // on at 20px each + 2 children, the previous formula gave a budget that
    // exceeded the real container axis by 40px — every downstream pixel
    // calculation (maximize, setSize, drag clamp) over-shot, and the grid
    // overflowed the visible area. Container is 1000px wide in tests;
    // 1 leading + 1 inner + 1 trailing = 3 resizer tracks at 20px = 60px,
    // so availPx must be 940.
    const grid = new SplitGrid({
      root: {
        id: 'root',
        direction: PanelDirection.Row,
        resizer: { first: true, last: true, size: 20 },
        children: [{ id: 'a' }, { id: 'b' }],
      },
    });

    grid.mount(host);

    // Trigger any layout op that calls refreshAvail; maximize is the most
    // sensitive — it computes target = avail - siblingMins, so an inflated
    // avail produces a panel size > container.
    grid.maximize('a');

    const state = grid.get('root');

    if (!state || !('sizes' in state)) throw new Error('expected container');

    const aSize = state.sizes[0];
    const bSize = state.sizes[1];

    if (aSize.unit !== 'pct' || bSize.unit !== 'pct') {
      throw new Error(`expected pct sizes, got ${aSize.unit}/${bSize.unit}`);
    }

    // Sizes are persisted as % of pctBudgetPx (= avail = container −
    // resizers = 1000 − 60 = 940), sum-to-100 when saturated. Resolving
    // each stored pct back to physical px against `budget` gives the
    // panel widths; those plus the resizer total must close at 1000.
    // If refreshAvail had been wrong by +40px (counting only inner
    // dividers, not the leading/trailing edges), aSize would compute
    // to ~100% on its own — leaving no room for b and forcing the grid
    // past 1000px.
    const budget = 940;
    const aPx = (aSize.value / 100) * budget;
    const bPx = (bSize.value / 100) * budget;

    expect(aPx + bPx + 60).toBeCloseTo(1000, 0);
  });

  it('childElementAt still resolves the correct panel when edges are enabled', () => {
    const grid = new SplitGrid({
      root: {
        id: 'root',
        direction: PanelDirection.Row,
        resizer: { first: true, last: true },
        children: [
          { id: 'a', bounds: { min: '40px' } },
          { id: 'b', bounds: { min: '40px' } },
        ],
      },
    });

    grid.mount(host);

    // setSize internally relies on childElementAt to measure the
    // target's current px — this passes only if the edge offset is
    // accounted for.
    grid.setSize('b', '300px');
    // No throw == pass. We don't assert exact pixels (happy-dom).
    expect(grid.get('b')).toBeDefined();
  });
});
