import type { SplitPanelDef } from './defs';

function getChildren(item: SplitPanelDef) {
  return item?.children || [];
}

export function flattenDepthFirst(items: SplitPanelDef | SplitPanelDef[]) {
  const flat: SplitPanelDef[] = [];

  for (const item of [items].flat()) {
    const children = getChildren(item);

    flat.push(item);

    if (children.length > 0) {
      flat.push(...flattenDepthFirst(children));
    }
  }

  return flat;
}

export function flattenBreadthFirst(items: SplitPanelDef | SplitPanelDef[]) {
  const flat: SplitPanelDef[] = [items].flat();
  // need to shallow clone array otherwise we iterate
  // over the new items we're adding
  const shallowClone = [...flat];

  for (const item of shallowClone) {
    const children = getChildren(item);

    if (children.length > 0) {
      flat.push(...flattenBreadthFirst(children));
    }
  }

  return flat;
}
