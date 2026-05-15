// @vitest-environment happy-dom
/**
 * Tests for the configureDraggable plugin. happy-dom doesn't run real layout,
 * so we can't simulate cursor-motion-driven drag end-to-end — `elementFromPoint`
 * always returns null. The drag pipeline is therefore tested by sending the
 * pointer events directly to the panel elements, which gives `e.target` the
 * needed shape without needing layout.
 *
 * What we cover:
 *  - default onDrop swaps data between source and target.
 *  - canDrag / canDrop predicates gate the cycle correctly.
 *  - the dispose function detaches listeners.
 *  - onDragChange fires with the right `{ sourceId, targetId }` shape.
 *
 * What we don't cover (relies on real layout): cursor-position hit-testing,
 * the start-threshold (we synthesize a long-enough move directly), and any
 * ghost-image positioning. Those are verified manually in the demo.
 */
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { SplitGrid } from '../SplitGrid';
import { configureDraggable } from '../draggable';
import type { Container } from '../types';
import { PanelDirection } from '../types';

let host: HTMLElement;

beforeEach(() => {
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 400, width: 800, height: 400, toJSON: () => ({}),
  } as DOMRect));
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  host.remove();
});

function tree(): Container<{ label: string }> {
  return {
    id: 'root',
    direction: PanelDirection.Row,
    children: [
      { id: 'a', data: { label: 'A' } },
      { id: 'b', data: { label: 'B' } },
      { id: 'c', data: { label: 'C' } },
    ],
  };
}

function mount() {
  const grid = new SplitGrid<{ label: string }>({ root: tree() });

  grid.mount(host);
  return grid;
}

function panelEl(id: string): HTMLElement {
  return host.querySelector(`.sp-panel[data-id="${id}"]`) as HTMLElement;
}

/**
 * Send pointer events that simulate "press on source, move over target,
 * release over target". We send them on the elements directly because
 * happy-dom's elementFromPoint always returns null — the plugin has a
 * fallback that reads `e.target` so this still exercises the right path.
 */
function simulateDrag(source: HTMLElement, target: HTMLElement, distance = 20): void {
  source.dispatchEvent(new PointerEvent('pointerdown', {
    clientX: 100, clientY: 100, bubbles: true,
  }));
  document.dispatchEvent(new PointerEvent('pointermove', {
    clientX: 100 + distance, clientY: 100, bubbles: true,
  }));
  target.dispatchEvent(new PointerEvent('pointermove', {
    clientX: 400, clientY: 100, bubbles: true,
  }));
  target.dispatchEvent(new PointerEvent('pointerup', {
    clientX: 400, clientY: 100, bubbles: true,
  }));
}

describe('configureDraggable', () => {
  it('default onDrop swaps data between source and target', () => {
    const grid = mount();

    configureDraggable(grid);

    simulateDrag(panelEl('a'), panelEl('c'));

    expect((grid.get('a')!.node as { data: { label: string } }).data.label).toBe('C');
    expect((grid.get('c')!.node as { data: { label: string } }).data.label).toBe('A');
  });

  it('custom onDrop is called instead of the default', () => {
    const grid = mount();
    const onDrop = vi.fn();

    configureDraggable(grid, { onDrop });

    simulateDrag(panelEl('a'), panelEl('b'));
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'a', targetId: 'b' }));

    // Default was NOT called — data wasn't swapped.
    expect((grid.get('a')!.node as { data: { label: string } }).data.label).toBe('A');
  });

  it('canDrag blocks the cycle for panels that fail the predicate', () => {
    const grid = mount();
    const onDrop = vi.fn();

    configureDraggable(grid, {
      canDrag: (id) => id !== 'a',
      onDrop,
    });

    simulateDrag(panelEl('a'), panelEl('b'));
    expect(onDrop).not.toHaveBeenCalled();

    simulateDrag(panelEl('b'), panelEl('a'));
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it('canDrop blocks drop on disallowed targets', () => {
    const grid = mount();
    const onDrop = vi.fn();

    configureDraggable(grid, {
      canDrop: (_source, target) => target !== 'c',
      onDrop,
    });

    simulateDrag(panelEl('a'), panelEl('c'));
    expect(onDrop).not.toHaveBeenCalled();

    simulateDrag(panelEl('a'), panelEl('b'));
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it('dropping a panel on itself is rejected', () => {
    const grid = mount();
    const onDrop = vi.fn();

    configureDraggable(grid, { onDrop });

    simulateDrag(panelEl('a'), panelEl('a'));
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('onDragChange reports source set + target updates + clear', () => {
    const grid = mount();
    const onDragChange = vi.fn();

    configureDraggable(grid, { onDragChange });

    simulateDrag(panelEl('a'), panelEl('b'));

    const states = onDragChange.mock.calls.map((args) => args[0] as { sourceId: string | null, targetId: string | null });

    // First fire: drag started (source=a, target=null until pointermove hits b).
    // Mid fire: target=b.
    // Final fire: cleared back to null/null.
    expect(states.some((s) => s.sourceId === 'a')).toBe(true);
    expect(states.some((s) => s.targetId === 'b')).toBe(true);
    expect(states.at(-1)).toEqual({ sourceId: null, targetId: null });
  });

  it('dispose detaches the pointerdown listener', () => {
    const grid = mount();
    const onDrop = vi.fn();
    const dispose = configureDraggable(grid, { onDrop });

    dispose();
    simulateDrag(panelEl('a'), panelEl('b'));
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('renders a ghost element while dragging and removes it on drop', () => {
    const grid = mount();

    configureDraggable(grid);

    panelEl('a').dispatchEvent(new PointerEvent('pointerdown', {
      clientX: 50, clientY: 50, bubbles: true,
    }));
    document.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 70, clientY: 50, bubbles: true,
    }));

    const ghost = document.querySelector('.sp-drag-ghost') as HTMLElement | null;

    expect(ghost).not.toBeNull();
    expect(ghost!.style.position).toBe('fixed');
    expect(ghost!.style.pointerEvents).toBe('none');

    document.dispatchEvent(new PointerEvent('pointerup', {
      clientX: 70, clientY: 50, bubbles: true,
    }));

    expect(document.querySelector('.sp-drag-ghost')).toBeNull();
  });

  it('ghost follows the pointer with default bottom-center anchor', () => {
    const grid = mount();

    // The ghost is a clone of the source — own-prop overrides on the
    // original don't carry over, so we mock at the prototype level for the
    // anchor-math assertions to be deterministic.
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 60, width: 100, height: 60, toJSON: () => ({}),
    } as DOMRect));

    configureDraggable(grid);

    panelEl('a').dispatchEvent(new PointerEvent('pointerdown', {
      clientX: 200, clientY: 200, bubbles: true,
    }));
    document.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 300, clientY: 300, bubbles: true,
    }));

    const ghost = document.querySelector('.sp-drag-ghost') as HTMLElement;

    // default anchor {x: 0.5, y: 1} → translate by (-width*0.5, -height*1)
    // left = 300 - 100*0.5 = 250; top = 300 - 60*1 = 240
    expect(ghost.style.left).toBe('250px');
    expect(ghost.style.top).toBe('240px');

    document.dispatchEvent(new PointerEvent('pointerup', {
      clientX: 300, clientY: 300, bubbles: true,
    }));
  });

  it('ghostAnchor overrides the cursor offset', () => {
    const grid = mount();

    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 60, width: 100, height: 60, toJSON: () => ({}),
    } as DOMRect));

    configureDraggable(grid, { ghostAnchor: () => ({ x: 0, y: 0 }) });

    panelEl('a').dispatchEvent(new PointerEvent('pointerdown', {
      clientX: 100, clientY: 100, bubbles: true,
    }));
    document.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 300, clientY: 200, bubbles: true,
    }));

    const ghost = document.querySelector('.sp-drag-ghost') as HTMLElement;

    // top-left anchor: ghost left/top match the cursor exactly.
    expect(ghost.style.left).toBe('300px');
    expect(ghost.style.top).toBe('200px');

    document.dispatchEvent(new PointerEvent('pointerup', {
      clientX: 300, clientY: 200, bubbles: true,
    }));
  });

  // Regression: the ghost is reparented to `document.body`, detaching it
  // from whatever sized box it was previously sharing with the source
  // panel. Children that adapt to their container (virtualized lists
  // sizing by visible area, `flex: 1` columns, etc) then grow to fill
  // body. Pinning the ghost's width/height to the source's measured
  // rect at mount time keeps it the size of what the user grabbed.
  it('pins the ghost to the source panel\'s measured dimensions', () => {
    const grid = mount();

    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      x: 0, y: 0, top: 0, left: 0, right: 240, bottom: 80, width: 240, height: 80, toJSON: () => ({}),
    } as DOMRect));

    configureDraggable(grid);

    panelEl('a').dispatchEvent(new PointerEvent('pointerdown', {
      clientX: 50, clientY: 50, bubbles: true,
    }));
    document.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 70, clientY: 50, bubbles: true,
    }));

    const ghost = document.querySelector('.sp-drag-ghost') as HTMLElement;

    expect(ghost.style.width).toBe('240px');
    expect(ghost.style.height).toBe('80px');

    document.dispatchEvent(new PointerEvent('pointerup', {
      clientX: 70, clientY: 50, bubbles: true,
    }));
  });

  // Optional caps for the pinned dimensions: dashboard-style layouts have
  // tall column widgets, and a full-height ghost blocks the user's view
  // of the drop zone. `ghostMaxSize.height` clips the ghost without
  // requiring a custom `ghostRender` factory.
  it('ghostMaxSize caps the pinned dimensions', () => {
    const grid = mount();

    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      x: 0, y: 0, top: 0, left: 0, right: 240, bottom: 500, width: 240, height: 500, toJSON: () => ({}),
    } as DOMRect));

    configureDraggable(grid, { ghostMaxSize: { height: 80 } });

    panelEl('a').dispatchEvent(new PointerEvent('pointerdown', {
      clientX: 50, clientY: 50, bubbles: true,
    }));
    document.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 70, clientY: 50, bubbles: true,
    }));

    const ghost = document.querySelector('.sp-drag-ghost') as HTMLElement;

    expect(ghost.style.width).toBe('240px');
    expect(ghost.style.height).toBe('80px');

    document.dispatchEvent(new PointerEvent('pointerup', {
      clientX: 70, clientY: 50, bubbles: true,
    }));
  });

  // Symmetric to max: floor the ghost so a 0-sized source doesn't render
  // an invisible drag affordance.
  it('ghostMinSize floors the pinned dimensions', () => {
    const grid = mount();

    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      x: 0, y: 0, top: 0, left: 0, right: 10, bottom: 10, width: 10, height: 10, toJSON: () => ({}),
    } as DOMRect));

    configureDraggable(grid, { ghostMinSize: { width: 120, height: 40 } });

    panelEl('a').dispatchEvent(new PointerEvent('pointerdown', {
      clientX: 50, clientY: 50, bubbles: true,
    }));
    document.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 70, clientY: 50, bubbles: true,
    }));

    const ghost = document.querySelector('.sp-drag-ghost') as HTMLElement;

    expect(ghost.style.width).toBe('120px');
    expect(ghost.style.height).toBe('40px');

    document.dispatchEvent(new PointerEvent('pointerup', {
      clientX: 70, clientY: 50, bubbles: true,
    }));
  });

  // A custom ghostRender may need its own dimensions (e.g. a small drag
  // icon, not a panel-sized copy). If the consumer set width/height
  // explicitly, leave it alone.
  it('does not overwrite width/height a custom ghostRender already set', () => {
    const grid = mount();

    const custom = document.createElement('div');

    custom.className = 'my-custom-ghost';
    custom.style.width = '32px';
    custom.style.height = '32px';

    const ghostRender = () => custom;

    configureDraggable(grid, { ghostRender });

    panelEl('a').dispatchEvent(new PointerEvent('pointerdown', {
      clientX: 50, clientY: 50, bubbles: true,
    }));
    document.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 70, clientY: 50, bubbles: true,
    }));

    const ghost = document.querySelector('.sp-drag-ghost') as HTMLElement;

    expect(ghost.style.width).toBe('32px');
    expect(ghost.style.height).toBe('32px');

    document.dispatchEvent(new PointerEvent('pointerup', {
      clientX: 70, clientY: 50, bubbles: true,
    }));
  });

  it('custom ghostRender replaces the default clone', () => {
    const grid = mount();

    const custom = document.createElement('div');

    custom.className = 'my-custom-ghost';
    custom.textContent = 'dragging…';

    const ghostRender = vi.fn(() => custom);

    configureDraggable(grid, { ghostRender });

    panelEl('a').dispatchEvent(new PointerEvent('pointerdown', {
      clientX: 50, clientY: 50, bubbles: true,
    }));
    document.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 70, clientY: 50, bubbles: true,
    }));

    expect(ghostRender).toHaveBeenCalledTimes(1);
    // The returned element is what's mounted (still wrapped with the marker class).
    expect(document.querySelector('.my-custom-ghost')).toBe(custom);
    expect(custom.classList.contains('sp-drag-ghost')).toBe(true);

    document.dispatchEvent(new PointerEvent('pointerup', {
      clientX: 70, clientY: 50, bubbles: true,
    }));
    expect(document.querySelector('.sp-drag-ghost')).toBeNull();
  });

  it('ghost: false disables ghost rendering entirely', () => {
    const grid = mount();

    configureDraggable(grid, { ghost: false });

    panelEl('a').dispatchEvent(new PointerEvent('pointerdown', {
      clientX: 50, clientY: 50, bubbles: true,
    }));
    document.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 70, clientY: 50, bubbles: true,
    }));

    expect(document.querySelector('.sp-drag-ghost')).toBeNull();

    document.dispatchEvent(new PointerEvent('pointerup', {
      clientX: 70, clientY: 50, bubbles: true,
    }));
  });

  it('dispose mid-drag removes the ghost', () => {
    const grid = mount();
    const dispose = configureDraggable(grid);

    panelEl('a').dispatchEvent(new PointerEvent('pointerdown', {
      clientX: 50, clientY: 50, bubbles: true,
    }));
    document.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 70, clientY: 50, bubbles: true,
    }));

    expect(document.querySelector('.sp-drag-ghost')).not.toBeNull();

    dispose();

    expect(document.querySelector('.sp-drag-ghost')).toBeNull();
  });

  it('respects a custom `dragSelector` (only matching children initiate drag)', () => {
    const grid = mount();
    const onDrop = vi.fn();

    // Add a handle child to panel A; only it should be draggable.
    const handle = document.createElement('span');

    handle.className = 'drag-me';
    panelEl('a').append(handle);

    configureDraggable(grid, { dragSelector: '.drag-me', onDrop });

    // Click on the bare panel A — no drag handle, should not start.
    simulateDrag(panelEl('a'), panelEl('b'));
    expect(onDrop).not.toHaveBeenCalled();

    // Click on the handle inside A — should start a drag.
    simulateDrag(handle, panelEl('b'));
    expect(onDrop).toHaveBeenCalledTimes(1);
  });
});
