/**
 * Constrained proportional allocation — the iterative pin-and-redistribute
 * water-fill that backs `applyTargetSize`'s sibling distribution and
 * `equalize`'s even-share pass.
 *
 * Allocate `total` across N entries proportional to `weights[i]`, with
 * each result clamped to `[min[i], max[i]]`. Entries that would fall
 * outside their bounds snap to the bound and drop out of the pool; the
 * remainder redistributes among whoever's still free. Repeats until every
 * survivor's share lands in range (worst case N iterations, single-digit
 * N in practice).
 *
 * Contract:
 *   - All arrays are length N. Callers pre-extract subsets if they only
 *     want to distribute over a subset (e.g. `applyTargetSize` runs this
 *     over siblings only, target's share decided upstream).
 *   - `weights[i] >= 0`. All-zero weights → fall back to equal share.
 *     For "equalize" semantics, pass `weights = [1, 1, ..., 1]`.
 *   - `max[i]` may be `Number.POSITIVE_INFINITY` (no upper bound).
 *   - `min[i] <= max[i]`. Callers responsible for feasibility:
 *     `Σ min <= total <= Σ max`. Outside that range the helper still
 *     terminates and produces a non-NaN result, but the sum won't match
 *     `total` (every entry pinned to its closer bound).
 *
 * Pure function. Unit-testable from the node suite.
 */
export function distributeProportional(
  total: number,
  weights: readonly number[],
  minPx: readonly number[],
  maxPx: readonly number[],
): number[] {
  const n = weights.length;
  const out: number[] = Array.from({ length: n }, () => 0);
  const free = new Set<number>();

  for (let i = 0; i < n; i += 1) free.add(i);

  let remaining = total;

  while (free.size > 0) {
    let weightSum = 0;

    for (const i of free) weightSum += weights[i];

    let snapped = false;

    for (const i of free) {
      // All-zero weights in the free pool → degenerate to equal share.
      const proportion = weightSum > 0 ? weights[i] / weightSum : 1 / free.size;
      const share = remaining * proportion;

      if (share < minPx[i]) {
        out[i] = minPx[i];
        remaining -= minPx[i];
        free.delete(i);
        snapped = true;
      } else if (share > maxPx[i]) {
        out[i] = maxPx[i];
        remaining -= maxPx[i];
        free.delete(i);
        snapped = true;
      }
    }

    if (!snapped) {
      // Every free entry's proportional share landed in [min, max].
      // Commit and finish.
      for (const i of free) {
        const proportion = weightSum > 0 ? weights[i] / weightSum : 1 / free.size;

        out[i] = remaining * proportion;
      }
      break;
    }
  }
  return out;
}
