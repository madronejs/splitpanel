import type { SplitPanelDef } from './defs';

function getChildren(item: SplitPanelDef) {
  return item?.children || [];
}

export function flattenDepthFirst(items: SplitPanelDef | SplitPanelDef[]) {
  const flat: SplitPanelDef[] = [];

  [items].flat().forEach((item) => {
    const children = getChildren(item);

    flat.push(item);

    if (children.length) {
      flat.push(...flattenDepthFirst(children));
    }
  });

  return flat;
}

export function flattenBreadthFirst(items: SplitPanelDef | SplitPanelDef[]) {
  const flat: SplitPanelDef[] = [items].flat();

  flat.forEach((item) => {
    const children = getChildren(item);

    if (children.length) {
      flat.push(...flattenBreadthFirst(children));
    }
  });

  return flat;
}
