import anime from 'animejs';
import {
  relativeToPercent, exactToPx, type getSizeInfo, AnimateStrategy, negateChildren,
} from '@/core/defs';
import type SplitPanel from '@/core/SplitPanel';

export default function configureAnimate(config?: Omit<anime.AnimeAnimParams, 'update'>): AnimateStrategy {
  return (panel: SplitPanel, items: SplitPanel[], sizeInfo?: ReturnType<typeof getSizeInfo>) => {
    const others = negateChildren(panel, items);
    const onUpdate = () => panel.satisfyConstraints({ incremental: true, items: others });
    const timeline = anime.timeline({
      update: onUpdate,
      complete: onUpdate,
    });

    for (const item of items) {
      const startSize = sizeInfo?.relative == null || sizeInfo.relative
        ? relativeToPercent(item.sizeInfo.relativeSize)
        : exactToPx(item.sizeInfo.exactSize);
      const targets = { size: startSize };
      const finalSize = item.getSizeInfo(sizeInfo?.formatted ?? item.originalSize).formatted;

      timeline
        .add({
          duration: config?.duration ?? 1000,
          easing: 'easeInOutQuart',
          size: finalSize,
          ...config,
          targets,
          update: () => {
            item.setSize(targets.size);
          },
        }, 0);
    }

    return {
      promise: timeline.finished,
      cancel: () => timeline.pause(),
    };
  };
}
