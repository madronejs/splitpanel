/**
 * Push-cascade drag math with LIFO recovery.
 *
 * Operates on a flat px-array (one entry per child) plus the snapshot of those
 * sizes at drag start. Given a handle index and a px delta, it:
 *
 *   1. Computes how much the shrink side can give (current − min, walking
 *      outward from the handle).
 *   2. Computes how much the grow side can absorb. Grow capacity is the sum
 *      of (a) every shrunk panel's deficit relative to its drag-start snapshot,
 *      plus (b) the immediate neighbor's room to its max above its snapshot.
 *   3. Transfers `min(want, shrinkCap, growCap)` from one side to the other:
 *      - Take from shrink side closest-first (the classic push cascade).
 *      - Give to grow side furthest-first (LIFO recovery): a panel that was
 *        cascade-shrunk last comes back first when the cursor reverses, so
 *        the user gets back exactly what they pushed away. Leftover after
 *        all panels are restored to their snapshots flows into expanding
 *        the immediate neighbor past its snapshot.
 *
 * Pure function — no DOM, no state outside the arrays passed in.
 * Returns the px delta actually applied (sign matches `deltaPx`).
 */

import type { Container } from './types';
import { parseLength, toPx, type ContainerAxisPx } from './length';

const PX_ZERO = { unit: 'px' as const, value: 0 };

export function dragHandle(
  c: Container,
  sizesPx: number[],
  initialPx: number[],
  handle: number,
  deltaPx: number,
  /**
   * Full container axis in px. Used only to resolve percentage `bounds.min` /
   * `bounds.max`, which CSS resolves against the grid container — NOT the
   * content area (availPx). Using availPx here introduces a drift versus
   * what CSS displays and the grid overflows when resizer tracks consume
   * meaningful space.
   */
  containerAxisPx: ContainerAxisPx,
): number {
  if (deltaPx === 0 || handle < 1 || handle > c.children.length - 1) return 0;

  const dir = Math.sign(deltaPx);
  const want = Math.abs(deltaPx);
  const n = c.children.length;

  // Direction conventions:
  //   dir > 0 (right/down drag): grow side reaches toward index 0 (growDir=-1),
  //                              shrink side toward the end (+1).
  //   dir < 0: mirrored.
  const growDir = -dir;
  const shrinkDir = dir;
  const growStart = dir > 0 ? handle - 1 : handle;
  const shrinkStart = dir > 0 ? handle : handle - 1;

  // ----- Plan the grow side -----
  // Restore plan = panels on the grow side whose current < initial, walked
  // outward from handle. We apply in reverse (furthest-first) for LIFO.
  const restorePlan: Array<[number, number]> = [];
  let restoreCap = 0;

  for (let i = growStart; i >= 0 && i < n; i += growDir) {
    const deficit = Math.max(0, initialPx[i] - sizesPx[i]);

    if (deficit > 0) restorePlan.push([i, deficit]);

    restoreCap += deficit;
  }

  restorePlan.reverse();

  // Expansion capacity for the immediate neighbor past its snapshot, clamped
  // by its max. If the immediate is already above its snapshot, the expand
  // baseline is the current size; if it's below, the baseline is the snapshot
  // (the deficit portion is already counted in restoreCap).
  const immediate = growStart;
  const immMaxRaw = c.children[immediate].bounds?.max;
  const immMax = immMaxRaw == null
    ? Number.POSITIVE_INFINITY
    : toPx(parseLength(immMaxRaw), containerAxisPx);
  // Read immMin alongside immMax so the apply step can floor the
  // immediate at its declared min. Without this, a small reverse drag
  // could "restore" the immediate to a snapshot that's below a min
  // that's been bumped since (setBounds between drags, or bounds
  // mutated directly outside the wrapper).
  const immMin = toPx(parseLength(c.children[immediate].bounds?.min, PX_ZERO), containerAxisPx);
  const expandBaseline = Math.max(sizesPx[immediate], initialPx[immediate]);
  const expandCap = Math.max(0, immMax - expandBaseline);

  const growCap = restoreCap + expandCap;

  // ----- Plan the shrink side -----
  const takePlan: Array<[number, number]> = [];
  let takeCap = 0;

  for (let i = shrinkStart; i >= 0 && i < n; i += shrinkDir) {
    const minPx = toPx(parseLength(c.children[i].bounds?.min, PX_ZERO), containerAxisPx);
    const room = Math.max(0, sizesPx[i] - minPx);

    if (room > 0) takePlan.push([i, room]);

    takeCap += room;
  }

  const amount = Math.min(want, growCap, takeCap);

  if (amount === 0) return 0;

  // ----- Apply -----
  let toTake = amount;

  for (const [idx, cap] of takePlan) {
    const take = Math.min(toTake, cap);

    sizesPx[idx] -= take;
    toTake -= take;

    if (toTake === 0) break;
  }

  let toGive = amount;

  for (const [idx, cap] of restorePlan) {
    const give = Math.min(toGive, cap);

    sizesPx[idx] += give;
    toGive -= give;

    if (toGive === 0) break;
  }

  if (toGive > 0) sizesPx[immediate] += toGive;

  // Final floor: don't let the apply leave the immediate below its
  // declared min. Caller-side stale state (e.g. bounds.min raised
  // between drags via a direct bounds mutation rather than the
  // wrapper's setBounds, which would rebalance) can violate this
  // otherwise. Conservation across this drag's involved panels is
  // restored on the next drag op (re-snapshot).
  if (sizesPx[immediate] < immMin) sizesPx[immediate] = immMin;

  return amount * dir;
}
