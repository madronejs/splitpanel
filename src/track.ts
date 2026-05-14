/**
 * Builds the `grid-template-columns` / `grid-template-rows` string for a
 * container. This is the one inline style the engine writes per drag frame.
 *
 * Track encoding:
 *   - `fr` size              → `minmax(<min>, 1fr)`           (fills remainder)
 *   - explicit size + max    → `clamp(<min>, <size>, <max>)`  (bounded)
 *   - explicit size, no max  → `max(<min>, <size>)`           (just a floor)
 *
 * Why `clamp` instead of `minmax`: `minmax(min, size)` treats `size` as a max,
 * which collapses the track to `min` whenever total intrinsic content exceeds
 * available space. `clamp` keeps the intended size as the resolved value when
 * it sits between the bounds — which is what users actually mean by "size".
 */

import type {
  Bounds, Container, Length, Node, ResizerSpec,
} from './types';
import { formatLength, parseLength } from './length';

const ZERO: Length = { unit: 'px', value: 0 };

/** Track sizing for one child. `current` overrides `node.bounds.size`. */
export function trackForChild(node: Node, current?: Length): string {
  const bounds: Bounds = (node as { bounds?: Bounds }).bounds ?? {};
  const size = current ?? parseLength(bounds.size);
  const min = parseLength(bounds.min, ZERO);
  const max = bounds.max == null ? undefined : parseLength(bounds.max);

  if (size.unit === 'fr') {
    // Flex-fill: minmax handles min, max is lost (1fr doesn't compose in clamp).
    return `minmax(${formatLength(min)}, ${max ? formatLength(max) : '1fr'})`;
  }

  if (max) {
    return `clamp(${formatLength(min)}, ${formatLength(size)}, ${formatLength(max)})`;
  }
  return `max(${formatLength(min)}, ${formatLength(size)})`;
}

/**
 * Build the full track string for a container. `sizes` (length = children.length)
 * overrides each child's bounds.size. Resizer tracks are interleaved between
 * content tracks at fixed size.
 *
 * `resizer` is the RESOLVED spec — the SplitGrid runtime falls back from
 * `c.resizer` to its own `cfg.resizer` before calling, so this function
 * doesn't need to know about the inheritance chain. Pass `c.resizer`
 * directly if you're calling trackString outside that runtime.
 */
export function trackString(
  c: Container,
  sizes: Array<Length | undefined>,
  resizer: ResizerSpec | undefined = c.resizer,
): string {
  const resizerSize = formatLength(parseLength(resizer?.size ?? 6));
  const parts: string[] = [];

  // Optional leading / trailing resizer tracks (legacy showFirstResizeEl):
  // decorative, sized like the rest, but contain no drag-bound element.
  if (resizer?.first && c.children.length > 0) parts.push(resizerSize);

  for (const [i, child] of c.children.entries()) {
    if (i > 0) parts.push(resizerSize);

    parts.push(trackForChild(child, sizes[i]));
  }

  if (resizer?.last && c.children.length > 0) parts.push(resizerSize);

  return parts.join(' ');
}
