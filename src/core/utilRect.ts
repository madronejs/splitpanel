import pick from 'lodash/pick';
import { BoxRect, BoxCoord, DIMENSION, PANEL_DIRECTION, AXIS } from './interfaces';

export function resizeEntryToBoxRect(data: ResizeObserverEntry) {
  const target = data.target as HTMLElement;
  const rect = target.getBoundingClientRect();
  return pick(rect, ['x', 'y', 'width', 'height']) as BoxRect;
}

export function htmlElementToBoxRect(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  return pick(rect, ['x', 'y', 'width', 'height']) as BoxRect;
}

export function getCoordFromMouseEvent(e: MouseEvent | TouchEvent): BoxCoord {
  if ('touches' in e) {
    return {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  }

  return { x: e.pageX, y: e.pageY };
}

export function getDirectionInfo(direction: PANEL_DIRECTION) {
  return direction === PANEL_DIRECTION.column ? {
    dimension: DIMENSION.height,
    dimensionInverse: DIMENSION.width,
    axis: AXIS.y,
    axisInverse: AXIS.x,
  } : {
    dimension: DIMENSION.width,
    dimensionInverse: DIMENSION.height,
    axis: AXIS.x,
    axisInverse: AXIS.y,
  };
}

export function getDistance(
  coord1: BoxCoord,
  coord2: BoxCoord,
  direction?: PANEL_DIRECTION,
): number {
  if (!coord1 || !coord2) {
    return 0;
  }

  const { x: x1, y: y1 } = coord1;
  const { x: x2, y: y2 } = coord2;

  // Don't need to be too fancy here... diagonal distance doesn't matter.
  if (direction === PANEL_DIRECTION.row) {
    return x2 - x1;
  }

  return y2 - y1;
}
