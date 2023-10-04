import anime from 'animejs';
import {
  relativeToPercent, exactToPx, type getSizeInfo, AnimateStrategy, negateChildren, ConstraintType,
} from '@/core/defs';
import type SplitPanel from '@/core/SplitPanel';

export default function configureAnimate(config?: Omit<anime.AnimeAnimParams, 'update'>): AnimateStrategy {
  return (panel: SplitPanel, items: SplitPanel[], sizeInfo?: ReturnType<typeof getSizeInfo>) => {
    const panelMap: Record<string, {
      item: SplitPanel,
      size: ConstraintType,
    }> = {};
    const others = negateChildren(panel, items);
    const vals = items.map((item) => {
      const newSize = sizeInfo?.relative == null || sizeInfo.relative
        ? relativeToPercent(item.sizeInfo.relativeSize)
        : exactToPx(item.sizeInfo.exactSize);

      panelMap[item.id] = {
        item,
        size: newSize,
      };
      return panelMap[item.id];
    });

    const timeline = anime.timeline({
      update: () => {
        panel.satisfyConstraints({ incremental: true, items: others });
      },
    });

    for (const item of items) {
      const itemVal = panelMap[item.id];

      timeline
        .add({
          duration: config?.duration ?? 750,
          easing: 'easeInOutQuart',
          size: sizeInfo?.formatted ?? item.originalSize,
          ...config,
          targets: itemVal,
          update: () => {
            for (const id of Object.keys(panelMap)) {
              panelMap[id].item.setSize(panelMap[id].size);
            }
          },
        }, 0);
    }

    return {
      promise: timeline.finished,
      cancel: () => timeline.pause(),
    };
  };
}
