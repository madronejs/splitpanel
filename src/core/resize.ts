import type SplitPanel from './SplitPanel';
import { ConstraintType, SIBLING_RELATION, SumOptions, PanelConstraints } from './interfaces';
import { estimateSizeInfo, findNearestSibling, findFurthestSibling } from './utilSibling';
import { roundVal, sumMinSizes, sumSizes, sumSizesBetween } from './utilCalc';
import { relativeToPercent } from './utilParse';

export function resizeAll(panel: SplitPanel, val: ConstraintType) {
  if (!panel?.parent) {
    return;
  }

  const {
    appliedMin, relativeSize, parsedSize, siblingsNeedGrow,
  } = estimateSizeInfo(panel, val);
  const toSatisfy: SplitPanel[] = [];

  if (appliedMin) {
    panel.setSize(val);

    const shrinkableAfter = findNearestSibling(panel, SIBLING_RELATION.after, (sibling) => sibling.canShrink);
    const growableBefore = findNearestSibling(panel, SIBLING_RELATION.before, (sibling) => sibling.canGrow);

    if (shrinkableAfter?.sizeInfoSnapshot) {
      const shrinkBy = relativeSize - parsedSize.relativeValue;
      const newSize = shrinkableAfter.sizeInfoSnapshot.relativeSize - shrinkBy;

      shrinkableAfter.setSize(relativeToPercent(newSize));
    }

    if (growableBefore) {
      toSatisfy.push(growableBefore);
    }
  } else {
    const shrinkableBefore = findNearestSibling(panel, SIBLING_RELATION.before, (sibling) => sibling.canShrink);

    if (siblingsNeedGrow || shrinkableBefore) {
      panel.setSize(val);
      toSatisfy.push(...panel.siblingsBefore);
    }
  }

  if (toSatisfy.length > 0) {
    panel.parent.satisfyConstraints({ items: toSatisfy });
  }
}

export function resizeNeighbors(panel: SplitPanel, val: ConstraintType) {
  if (!panel?.parent) {
    return;
  }

  const {
    appliedMin, parsedSize, siblingsNeedGrow, panelGrowing,
  } = estimateSizeInfo(panel, val);
  const toSatisfy: SplitPanel[] = [];
  const relativeSnapshotOptions: SumOptions = {
    sumSource: 'sizeInfoSnapshot',
    sumProperty: 'relativeSize',
  };
  const relativeSizeOptions: SumOptions = {
    sumSource: 'sizeInfo',
    sumProperty: 'relativeSize',
  };
  const afterSumOriginal = sumSizes(panel.siblingsAfter, relativeSnapshotOptions);
  const afterSumCurrent = sumSizes(panel.siblingsAfter, relativeSizeOptions);
  const afterSumLess = afterSumCurrent < afterSumOriginal;
  const afterSumExact = afterSumOriginal * panel.parent.rectSize;
  const minValuesBefore = sumMinSizes(panel.siblingsBefore);
  const maxPossibleSize = panel.parent.rectSize - afterSumExact - minValuesBefore;
  const constrainedPanels = new Set<SplitPanel>();
  const constrainPanel = (item: SplitPanel, constraints: PanelConstraints) => {
    item.setStrategyConstraints(constraints);
    constrainedPanels.add(item);
  };

  constrainPanel(panel, {
    maxSize: roundVal(maxPossibleSize, 0),
  });

  if (panel.pushPanels && (appliedMin || afterSumLess)) {
    // The current panel can NOT be resized (ie. it has a zero width, or has reached its min width).
    panel.setSize(val);

    let siblingAfter: SplitPanel;

    // If we're resizing in the "before" direction (ie. left or up), find the furthest sibling in the
    // "after" direction (ie. right or down) that can be increased in size.
    // If we're resizing in the "after" direction, find the nearest sibling that can shrink.
    if ((panel.dragRelation === SIBLING_RELATION.before || panelGrowing) && afterSumLess) {
      siblingAfter = findFurthestSibling(
        panel,
        SIBLING_RELATION.after,
        (sibling) => sibling.canGrow && (
          !sibling.sizeInfoSnapshot
          || sibling.sizeInfoSnapshot.relativeSize > sibling.sizeInfo.relativeSize
        ),
      );

      // Set a max size constraint to its initial size so it doesn't get bigger
      // than the size it initially started at
      constrainPanel(siblingAfter, {
        maxSize: siblingAfter.sizeInfoSnapshot.exactSize,
      });
    } else {
      siblingAfter = findNearestSibling(panel, SIBLING_RELATION.after, (sibling) => sibling.canShrink);
    }

    if (siblingAfter) {
      const sizesAfter = sumSizesBetween(panel.siblingAfter, siblingAfter, relativeSnapshotOptions);
      const offsetAfter = sumSizesBetween(panel, siblingAfter.siblingBefore, relativeSizeOptions);
      const newSize = sizesAfter + parsedSize.relativeValue - offsetAfter;

      siblingAfter.setSize(relativeToPercent(newSize));
    }

    const growableBefore = findNearestSibling(panel, SIBLING_RELATION.before, (sibling) => sibling.canGrow);

    if (growableBefore) {
      toSatisfy.push(growableBefore);
    }
  } else {
    // The current panel can be resized
    const shrinkableBefore = findNearestSibling(panel, SIBLING_RELATION.before, (sibling) => sibling.canShrink);
    const shrinkableAfter = findNearestSibling(panel, SIBLING_RELATION.after, (sibling) => sibling.canShrink);

    if (siblingsNeedGrow) {
      // The current panel is _decreasing_ in size, meaning any panel "before" should grow
      panel.setSize(val);

      const beforeSumOriginal = sumSizes(panel.siblingsBefore, relativeSnapshotOptions);
      const beforeSumCurrent = sumSizes(panel.siblingsBefore, relativeSizeOptions);
      const beforeSumLess = beforeSumCurrent < beforeSumOriginal;
      let growableBefore: SplitPanel;

      if ((panel.dragRelation === SIBLING_RELATION.after || panelGrowing) && beforeSumLess) {
        growableBefore = findFurthestSibling(
          panel,
          SIBLING_RELATION.before,
          (sibling) => sibling.canGrow && (
            !sibling.sizeInfoSnapshot
            || sibling.sizeInfoSnapshot.relativeSize > sibling.sizeInfo.relativeSize
          ),
        );

        // Set a max size constraint to its initial size so it doesn't get bigger
        // than the size it initially started at
        constrainPanel(growableBefore, {
          maxSize: growableBefore.sizeInfoSnapshot.exactSize,
        });
      } else {
        growableBefore = findNearestSibling(panel, SIBLING_RELATION.before, (sibling) => sibling.canGrow);
      }

      if (growableBefore) {
        toSatisfy.push(growableBefore);
      }
    } else if (shrinkableBefore) {
      // The current panel is _increasing_ in size, meaning any panel "before" should shrink
      panel.setSize(val);
      toSatisfy.push(shrinkableBefore);
    } else if (!panel.siblingBefore && shrinkableAfter) {
      // The current panel is _increasing_ in size, but there is nothing we can shrink "before"
      // so we should shrink something "after"
      panel.setSize(val);
      toSatisfy.push(shrinkableAfter);
    }
  }

  if (toSatisfy.length > 0) {
    panel.parent.satisfyConstraints({ items: toSatisfy });
  }

  // In the event that we're not resizing, and the relative size of all children exceeds 100%,
  // we need to rebalance all siblings to match the constraints.
  if (!panel.resizing && panel.parent?.totalChildRelativeSizes > 1) {
    panel.parent.satisfyConstraints({ items: panel.siblings });
  }

  // Clear out any strategy constraints
  for (const item of constrainedPanels) {
    item.setStrategyConstraints(null);
  }
}
