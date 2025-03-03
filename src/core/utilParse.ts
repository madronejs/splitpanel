import {
  ParsedConstraint,
  RELATIVE_SYMBOL,
  RELATIVE_MULTIPLIER,
  EXACT_SYMBOL,
  SizeInfoType,
  PanelConstraints,
  ParsedPanelConstraints,
} from './interfaces';

export function parseConstraint(val: string | number, comparativeSize: number): ParsedConstraint {
  const isNumber = typeof val === 'number';
  const relative = typeof val === 'string' ? val?.endsWith?.(RELATIVE_SYMBOL) : !isNumber;
  let parsedValue = isNumber ? val : Number.parseFloat(val);
  let relativeValue: number;
  let exactValue: number;

  parsedValue = Number.isNaN(parsedValue) || typeof parsedValue !== 'number' ? null : parsedValue;

  if (relative) {
    relativeValue = parsedValue / RELATIVE_MULTIPLIER;
    exactValue = comparativeSize * relativeValue;
  } else {
    exactValue = parsedValue;
    relativeValue = parsedValue / comparativeSize;
  }

  return { relative, relativeValue, exactValue };
}

export function relativeToPercent(val: number) {
  return `${val * RELATIVE_MULTIPLIER}${RELATIVE_SYMBOL}`;
}

export function exactToPx(val: number) {
  return `${val}${EXACT_SYMBOL}`;
}

export function parsedToFormatted(parsed: ParsedConstraint | SizeInfoType): string {
  if (!parsed) return undefined;
  if ('relativeValue' in parsed) {
    return parsed.relative
      ? relativeToPercent(parsed.relativeValue)
      : exactToPx(parsed.exactValue);
  }
  return parsed.relative
    ? relativeToPercent(parsed.relativeSize)
    : exactToPx(parsed.exactSize);
}

export function parsePanelConstraints(val: PanelConstraints, comparativeSize: number) {
  const constraints: ParsedPanelConstraints = {};

  for (const key of Object.keys(val || {})) {
    constraints[key] = parseConstraint(val[key], comparativeSize);
  }

  return constraints;
}
