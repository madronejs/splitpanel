// @vitest-environment happy-dom
/**
 * DOM-bound tests for the Vue wrapper. We focus on the two things easy to
 * regress: (1) the exposed handle surface — every imperative method the demo
 * reaches for must be reachable via the SplitGridHandle, (2) the `@change`
 * re-emit when the underlying SplitGrid fires its onChange. Slot rendering
 * via Teleport is intentionally not asserted; it relies on real layout in a
 * way happy-dom doesn't faithfully reproduce.
 */
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import SplitGridView from '../SplitGridView.vue';
import { registry } from '../handle';
import type { SplitGridHandle } from '../handle';
import { PanelDirection } from '../../types';

beforeEach(() => {
  // happy-dom returns 0×0 rects without help.
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 400, width: 800, height: 400, toJSON: () => ({}),
  } as DOMRect));
});

afterEach(() => {
  document.body.innerHTML = '';

  for (const id of registry.keys()) registry.delete(id);
});

function mountView(id = 'root') {
  return mount(SplitGridView, {
    props: {
      id,
      direction: PanelDirection.Row,
      children: [
        { id: 'a', data: { label: 'A' } },
        { id: 'b', data: { label: 'B' } },
      ],
    },
    attachTo: document.body,
    slots: { leaf: '<div>{{ panel.id }}</div>' },
  });
}

describe('SplitGridView: exposed handle', () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    wrapper = mountView();
  });

  it('exposes the handle on the template ref', () => {
    const exposed = wrapper.vm as unknown as { handle: SplitGridHandle };

    expect(exposed.handle).toBeTruthy();
    expect(exposed.handle.id).toBe('root');
    expect(exposed.handle.isReady.value).toBe(true);
  });

  it('exposes every imperative method the demo uses via the handle', () => {
    const { handle } = (wrapper.vm as unknown as { handle: SplitGridHandle });
    const expected = [
      'addChild', 'removeChild',
      'setSize', 'getSize',
      'toggleExpand', 'expandNext', 'expandPrev',
      'equalize', 'reset',
      'maximize', 'minimize',
      'swap', 'swapData', 'setData',
      'setDirection', 'setBounds',
    ];

    for (const name of expected) {
      expect(typeof (handle as unknown as Record<string, unknown>)[name], `handle.${name} missing`).toBe('function');
    }
  });

  it('handle.instance is the underlying SplitGrid', () => {
    const { handle } = (wrapper.vm as unknown as { handle: SplitGridHandle });

    expect(handle.instance).toBeTruthy();
    expect(typeof handle.instance!.get).toBe('function');
  });
});

describe('SplitGridView: @change re-emit', () => {
  it('re-emits the core onChange as a `change` event', () => {
    const wrapper = mountView();
    const { handle } = (wrapper.vm as unknown as { handle: SplitGridHandle<{ label: string }> });

    handle.addChild('root', { id: 'c', data: { label: 'C' } });

    const events = wrapper.emitted('change');

    expect(events).toBeTruthy();
    expect(events!.length).toBeGreaterThan(0);
    expect(events![0][0]).toMatchObject({ reason: 'add-child', containerId: 'root' });
  });

  it('fires with each distinct reason as the consumer calls layout methods', () => {
    const wrapper = mountView();
    const { handle } = (wrapper.vm as unknown as { handle: SplitGridHandle });

    handle.setSize('a', '30%');
    handle.equalize('root');
    handle.toggleExpand('a');

    const reasons = (wrapper.emitted('change') ?? []).map((args) => (args[0] as { reason: string }).reason);

    expect(reasons).toContain('set-size');
    expect(reasons).toContain('equalize');
    expect(reasons).toContain('toggle-expand');
  });
});
