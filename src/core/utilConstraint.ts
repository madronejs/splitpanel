import { ParsedConstraint, ParsedPanelConstraints } from './interfaces';

function mergeConstraint(
  constraints: ParsedConstraint[],
  compare?: (c1: ParsedConstraint, c2: ParsedConstraint) => number,
  getter?: (items: ParsedConstraint[]) => ParsedConstraint,
): ParsedConstraint {
  const filtered = constraints.filter(Boolean);

  if (filtered.length === 0) {
    return null;
  }

  if (filtered.length === 1) {
    return filtered[0];
  }

  if (compare) {
    filtered.sort(compare);
  }

  return getter ? getter(filtered) : filtered[0];
}

export function mergePanelConstraints(...constraints: ParsedPanelConstraints[]) {
  const size: ParsedConstraint[] = [];
  const minSize: ParsedConstraint[] = [];
  const maxSize: ParsedConstraint[] = [];

  for (const item of constraints) {
    if (item.size?.exactValue > 0) {
      size.push(item.size);
    }

    if (item.minSize) {
      minSize.push(item.minSize);
    }

    if (item.maxSize) {
      maxSize.push(item.maxSize);
    }
  }

  const merged: ParsedPanelConstraints = {
    // Default to the override
    size: mergeConstraint(size, null, (items) => items.at(-1)),
    // Get the larger of the two constraints
    minSize: mergeConstraint(minSize, (c1, c2) => (c1.exactValue > c2.exactValue ? -1 : 1)),
    // Get the smaller of the two constraints
    maxSize: mergeConstraint(maxSize, (c1, c2) => (c1.exactValue > c2.exactValue ? 1 : -1)),
  };

  const normalized: ParsedPanelConstraints = {};

  for (const key of Object.keys(merged)) {
    if (merged[key]) {
      normalized[key] = merged[key];
    }
  }

  return normalized;
}
