import differenceBy from 'lodash/differenceBy';
import type SplitPanel from './SplitPanel';

export function getChildInfo<T>(children: Array<SplitPanel<T>>) {
  const map: Record<string, SplitPanel<T>> = {};
  const indexMap: Record<string, number> = {};
  const leafIndexMap: Record<string, number> = {};
  const leafPanels: SplitPanel<T>[] = [];

  for (const [index, child] of (children || []).entries()) {
    map[child.id] = child;
    indexMap[child.id] = index;

    if (!child.numChildren) {
      leafIndexMap[child.id] = leafPanels.length;
      leafPanels.push(child);
    }
  }

  return {
    /** Id to panel mapping */
    map,
    /** An id to numeric index map showing where in the top level array each child is */
    indexMap,
    /** An id to index map only taking leaf panels into consideration */
    leafIndexMap,
    /** Total number of leaf panels */
    totalLeafPanels: leafPanels.length,
    /** All of the leaf panels */
    leafPanels,
  };
}

/** Get a list of the children minus the items passed in */
export function negateChildren(panel: SplitPanel, items: SplitPanel[]) {
  return differenceBy(panel.children, items, 'id');
}
