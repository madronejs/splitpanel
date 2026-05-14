/**
 * Direction-aware DOM helpers. Pulled out so the same one-liner doesn't
 * appear inline at every callsite that needs to read a rendered px size
 * along the active grid axis.
 *
 * Keep it small: only utilities that are genuinely DOM-touching AND
 * direction-aware belong here. Pure Length / track math lives in
 * `length.ts` / `track.ts`; DOM-touching code that doesn't care about
 * direction stays in the module that owns it.
 */
import { PanelDirection, type PanelDirectionInput } from './types';

/**
 * Extract the active-axis size from a bounding-client rect.
 *
 * Row containers grow along x → width. Column containers grow along
 * y → height. The mapping appears at ~9 inline sites across the
 * runtime; this is the canonical form. Pure on `rect` — the caller is
 * the one paying for the layout-forcing `getBoundingClientRect()`.
 */
export function axisExtent(rect: DOMRect, direction: PanelDirectionInput): number {
  return direction === PanelDirection.Row ? rect.width : rect.height;
}

/**
 * Convenience: read the rect and return only the active-axis size.
 * Calls `getBoundingClientRect()` for you — use `axisExtent` directly
 * when you already have a rect (or need both width AND height).
 *
 * Triggers a layout flush like any `getBoundingClientRect` call.
 */
export function measureAxis(el: HTMLElement, direction: PanelDirectionInput): number {
  return axisExtent(el.getBoundingClientRect(), direction);
}

/**
 * Snapshot the rendered axis size of each content child of `containerEl`.
 * Returns an array of length `count` — entry `i` is the px size of the
 * i-th child along `direction`, or `0` if the resolver couldn't find an
 * element (mid-mount, mid-mutation, container detached, etc).
 *
 * `childAt` is a caller-supplied resolver because the DOM walk varies by
 * site — SplitGrid's `childElementAt` skips `.sp-resizer` siblings;
 * pointerDrag receives one through its adapter so tests can stub it.
 */
export function measureChildrenPx(
  containerEl: HTMLElement,
  direction: PanelDirectionInput,
  count: number,
  childAt: (el: HTMLElement, i: number) => HTMLElement | undefined,
): number[] {
  return Array.from({ length: count }, (_, i) => {
    const child = childAt(containerEl, i);

    return child ? measureAxis(child, direction) : 0;
  });
}
