import type SplitPanel from './SplitPanel';
import { SIBLING_RELATION, ConstraintType } from './interfaces';
import { sumSizes } from './utilCalc';

function getSiblingArray(panel: SplitPanel, relation: SIBLING_RELATION) {
  if (panel.pushPanels) {
    return [...((relation === SIBLING_RELATION.before ? panel.siblingsBefore : panel.siblingsAfter) || [])];
  }

  return relation === SIBLING_RELATION.before ? [panel.siblingBefore].filter(Boolean) : [panel.siblingAfter].filter(Boolean);
}

function findPanelMatch(items: SplitPanel[], condition: (sibling: SplitPanel) => boolean) {
  for (const sibling of items) {
    if (condition(sibling)) {
      return sibling;
    }
  }

  return null;
}

export function findNearestSibling(
  panel: SplitPanel,
  relation: SIBLING_RELATION,
  condition: (sibling: SplitPanel) => boolean,
) {
  const siblings = getSiblingArray(panel, relation);

  if (relation === SIBLING_RELATION.before) {
    siblings.reverse();
  }

  return findPanelMatch(siblings, condition);
}

export function findFurthestSibling(
  panel: SplitPanel,
  relation: SIBLING_RELATION,
  condition: (sibling: SplitPanel) => boolean,
) {
  const siblings = getSiblingArray(panel, relation);

  if (relation === SIBLING_RELATION.after) {
    siblings.reverse();
  }

  return findPanelMatch(siblings, condition);
}

export function estimateSizeInfo(panel: SplitPanel, val: ConstraintType) {
  const sizeInfo = panel.getSizeInfo(val);
  const estimatedNewSize = sumSizes(panel.siblings) + sizeInfo.exactSize;
  const panelGrowing = panel.sizeInfo.exactSize < sizeInfo.exactSize;
  const panelShrinking = panel.sizeInfo.exactSize > sizeInfo.exactSize;
  const siblingsNeedShrink = estimatedNewSize > panel.comparativeSize;
  const siblingsNeedGrow = !siblingsNeedShrink;
  const shouldResize = sizeInfo.relativeSize !== panel.sizeInfo.relativeSize;

  return {
    ...sizeInfo,
    shouldResize,
    panelGrowing,
    panelShrinking,
    estimatedNewSize,
    siblingsNeedShrink,
    siblingsNeedGrow,
  };
}
