import anime from 'animejs';
import {
  relativeToPercent, exactToPx, type getSizeInfo, AnimateStrategy, negateChildren,
} from '@/core/defs';
import type SplitPanel from '@/core/SplitPanel';

export default function configureAnimate(config?: Omit<anime.AnimeAnimParams, 'update'>): AnimateStrategy {
  return (panel: SplitPanel, items: SplitPanel[], sizeInfo: ReturnType<typeof getSizeInfo>) => {
    const timeline = anime.timeline();
    const panelMap: Record<string, {
      item: SplitPanel,
      size: string,
    }> = {};
    const others = negateChildren(panel, items);
    const vals = items.map((item) => {
      panelMap[item.id] = {
        item,
        size: sizeInfo.relative
          ? relativeToPercent(item.sizeInfo.relativeSize)
          : exactToPx(item.sizeInfo.exactSize),
      };
      return panelMap[item.id];
    });

    timeline
      .add({
        duration: config?.duration ?? 750,
        easing: 'easeInOutQuart',
        size: sizeInfo.formatted,
        ...config,
        targets: vals,
        update: () => {
          for (const id of Object.keys(panelMap)) {
            panelMap[id].item.setSize(panelMap[id].size);
          }

          panel.satisfyConstraints({ incremental: true, items: others });
        },
      });

    return {
      promise: timeline.finished,
      cancel: () => timeline.pause(),
    };
  };
}
