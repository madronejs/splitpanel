import { describe, expect, it } from 'vitest';
import { trackForChild, trackString } from '../track';
import { parseLength } from '../length';
import type { Container, Leaf } from '../types';
import { PanelDirection } from '../types';

const leaf = (id: string, bounds?: Leaf['bounds']): Leaf => ({ id, bounds });

const row = (...kids: Leaf[]): Container => ({ id: 'r', direction: PanelDirection.Row, children: kids });

describe('trackForChild', () => {
  it('renders an fr-sized track as minmax(min, 1fr)', () => {
    expect(trackForChild(leaf('a'))).toBe('minmax(0px, 1fr)');
    expect(trackForChild(leaf('a', { size: 'auto', min: '120px' }))).toBe('minmax(120px, 1fr)');
  });

  it('keeps minmax(min, 1fr) form even when an auto track has an explicit max', () => {
    // Previously emitted minmax(min, max) when max was set on an fr
    // track. That silently converted the track from flex-fill to a
    // bounded fixed range — same string, different layout/animation
    // shape. Max is dropped on fr tracks; consumers needing a ceiling
    // should use an explicit size with bounds.max.
    expect(trackForChild(leaf('a', { size: 'auto', min: '100px', max: '400px' }))).toBe('minmax(100px, 1fr)');
  });

  it('renders a fixed size with max as clamp(min, size, max)', () => {
    expect(trackForChild(leaf('a', { size: '50%', min: '100px', max: '400px' }))).toBe('clamp(100px, 50%, 400px)');
  });

  it('renders a fixed size without max as max(min, size)', () => {
    expect(trackForChild(leaf('a', { size: '200px', min: '100px' }))).toBe('max(100px, 200px)');
  });

  it('lets `current` override the bounds.size', () => {
    // Drag math passes a resolved pct as `current` to bypass the stored size.
    const node = leaf('a', { size: '20%', min: '50px' });

    expect(trackForChild(node, parseLength('70%'))).toBe('max(50px, 70%)');
  });
});

describe('trackString', () => {
  it('interleaves a 6px resizer between content tracks by default', () => {
    const c = row(leaf('a'), leaf('b'), leaf('c'));
    const out = trackString(c, [undefined, undefined, undefined]);

    expect(out).toBe('minmax(0px, 1fr) 6px minmax(0px, 1fr) 6px minmax(0px, 1fr)');
  });

  it('honors a custom resizer.size', () => {
    const c: Container = {
      id: 'r', direction: PanelDirection.Row, resizer: { size: 12 }, children: [leaf('a'), leaf('b')],
    };

    expect(trackString(c, [undefined, undefined])).toBe('minmax(0px, 1fr) 12px minmax(0px, 1fr)');
  });

  it('respects per-child `sizes` overrides', () => {
    const c = row(leaf('a', { min: '100px' }), leaf('b'), leaf('c', { max: '300px' }));
    const sizes = [parseLength('25%'), parseLength('50%'), parseLength('25%')];
    const out = trackString(c, sizes);

    expect(out).toBe('max(100px, 25%) 6px max(0px, 50%) 6px clamp(0px, 25%, 300px)');
  });

  it('emits a single-track string for a one-child container', () => {
    const c = row(leaf('only', { size: '50%' }));

    expect(trackString(c, [parseLength('50%')])).toBe('max(0px, 50%)');
  });
});
