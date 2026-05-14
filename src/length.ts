/**
 * Length parsing and conversion.
 *
 * Three internal units:
 *   - `px`: absolute pixels
 *   - `pct`: percent of the available content space (0–100)
 *   - `fr`: one flex share; only meaningful inside CSS Grid's `1fr` tracks
 *
 * `'auto'` parses to `{ unit: 'fr', value: 1 }`. `fr` lengths can't be added to
 * a px delta — callers detect this and convert to `pct` before doing drag math.
 */

import type { Length, LengthInput } from './types';

const PCT_RE = /^(-?\d+(?:\.\d+)?)%$/;
const PX_RE = /^(-?\d+(?:\.\d+)?)px$/;
const DEFAULT_FALLBACK: Length = { unit: 'fr', value: 1 };

export function parseLength(input: LengthInput | undefined, fallback: Length = DEFAULT_FALLBACK): Length {
  if (input == null) return fallback;

  if (input === 'auto') return { unit: 'fr', value: 1 };

  if (typeof input === 'number') return { unit: 'px', value: input };

  const pct = PCT_RE.exec(input);

  if (pct) return { unit: 'pct', value: Number(pct[1]) };

  const px = PX_RE.exec(input);

  if (px) return { unit: 'px', value: Number(px[1]) };

  // Tolerate bare-number strings like "200".
  const n = Number(input);

  if (Number.isFinite(n)) return { unit: 'px', value: n };

  return fallback;
}

/** Render a Length as a CSS value. `fr` becomes `1fr`. */
export function formatLength(l: Length): string {
  if (l.unit === 'px') return `${l.value}px`;

  if (l.unit === 'pct') return `${l.value}%`;
  return `${l.value}fr`;
}

/**
 * Two denominators show up in the runtime; both are pixel counts, but they
 * mean different things and mixing them up is the most common bug shape in
 * this codebase. Brand types keep them straight at compile time.
 *
 * `ContainerAxisPx` — the container's FULL axis size (width for row, height
 * for column, INCLUDING resizer tracks). This is what CSS Grid uses to
 * resolve a `<pct>` track in `grid-template-columns: 50% …`. Use it for:
 *   - Resolving user-supplied pct inputs (`setSize('50%')`, `bounds.min:
 *     '40%'`, `bounds.size: '25%'`) — user means "% of the container".
 *   - Emitting pct values back to CSS via `--sp-tracks`.
 *
 * `PctBudgetPx` — the container's content-area budget for pct/fr tracks =
 * `availPx − Σpx_tracks(c.sizes)`. This is the denominator the runtime uses
 * internally for `c.sizes` pct values, so the saturation invariant is
 * "stored pct sizes sum to exactly 100" regardless of resizer-track count
 * or px siblings. Use it for:
 *   - Writing `c.sizes[i]` values (`pxToPct(px, budget)`).
 *   - Reading them back to px (`toPx(c.sizes[i], budget)`).
 *
 * The single CSS-emit boundary is `SplitGrid.sizesForCss`, which scales each
 * stored avail-pct value by `budget / containerAxis` so the value handed to
 * CSS resolves back to the same physical px.
 */
export type ContainerAxisPx = number & { readonly __brand: 'ContainerAxisPx' };
export type PctBudgetPx = number & { readonly __brand: 'PctBudgetPx' };

/** Either denom — both are pixel counts; the brand records WHICH pixel count. */
export type PctDenomPx = ContainerAxisPx | PctBudgetPx;

/** Stamp a raw number as a ContainerAxisPx at the boundary. */
export function asContainerAxis(n: number): ContainerAxisPx {
  return n as ContainerAxisPx;
}

/** Stamp a raw number as a PctBudgetPx at the boundary. */
export function asPctBudget(n: number): PctBudgetPx {
  return n as PctBudgetPx;
}

/**
 * Resolve a length to pixels against the given denominator. `pct` lengths
 * scale against the denom; `px` lengths pass through; `fr` returns the denom
 * as a best-effort fallback — callers branch on unit before reaching here
 * when they care.
 *
 * The denom is branded so the caller has to be explicit about which it
 * means. User-input pct resolves against `ContainerAxisPx` (matching CSS);
 * stored pct resolves against `PctBudgetPx` (matching `c.sizes` semantics).
 */
export function toPx(l: Length, denomPx: PctDenomPx): number {
  if (l.unit === 'px') return l.value;

  if (l.unit === 'pct') return (l.value / 100) * denomPx;
  // 'fr': best-effort; callers should branch on unit before reaching here.
  return denomPx;
}

/** Convert a px value to a percent of the given denom. */
export function pxToPct(px: number, denomPx: PctDenomPx): number {
  if (denomPx <= 0) return 0;
  return (px / denomPx) * 100;
}

/**
 * Coerce a length to a concrete (`px` or `pct`) value, picking the unit of
 * `preferUnit` when the input is `fr`. Used when a flex-fill track has to
 * become specific because the user just dragged it.
 */
export function concretize(l: Length, denomPx: PctDenomPx, preferUnit: 'px' | 'pct' = 'pct'): Length {
  if (l.unit !== 'fr') return l;
  return preferUnit === 'px'
    ? { unit: 'px', value: denomPx }
    : { unit: 'pct', value: 100 };
}

/**
 * Storage-form unit — narrower than `Length['unit']`, which also admits
 * `'fr'`. `fr` lives only at the user-input boundary; by the time a Length
 * lands in `c.sizes`, it's been concretized to one of these two via
 * `freezeFrTracks`. Helpers that operate in storage form (`sizesFromPx`,
 * writeback sites) speak `StorageUnit` so the type system tracks that
 * narrowing.
 */
export type StorageUnit = 'pct' | 'px';

/**
 * Build a storage-form `Length[]` from new pixel sizes plus an explicit
 * unit choice per entry. The pct budget (denominator for pct entries) is
 * derived from THIS function's own px decisions — never from a caller's
 * pre-mutation `sizes` array.
 *
 * That rule is what defends the recurring "stale budget, all-pct
 * overflow" bug shape: a writeback site that reads `pctBudgetPx(c)`
 * before reassigning `c.sizes` ends up subtracting a stale px value
 * from the budget, the reassigned all-pct array then resolves against
 * a different denominator at `sizesForCss`, and CSS overflows by a
 * factor of `oldBudget / availPx`. Every writeback that wants to
 * support px siblings goes through here and inherits the right
 * denominator by construction.
 *
 * `units[i] === 'px'` means "store this entry as px with `newPxs[i]`
 * as the value." Anything else means "store as pct, value =
 * `pxToPct(newPxs[i], computedBudget)`." Callers map fr → pct
 * themselves before calling (the storage convention is two-unit).
 *
 * Pure function. Lives here (next to `pxToPct` / `asPctBudget`) so
 * it's unit-testable from the node suite without an HTML host.
 */
export function sizesFromPx(
  newPxs: number[],
  units: ReadonlyArray<StorageUnit>,
  availPx: number,
): Length[] {
  let pxSum = 0;

  for (const [i, px] of newPxs.entries()) {
    if (units[i] === 'px') pxSum += px;
  }

  const budget = asPctBudget(Math.max(0, availPx - pxSum));

  return newPxs.map((px, i) => (units[i] === 'px'
    ? { unit: 'px' as const, value: px }
    : { unit: 'pct' as const, value: pxToPct(px, budget) }));
}
