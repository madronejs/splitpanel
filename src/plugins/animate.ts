import anime from 'animejs';
import {
  relativeToPercent, exactToPx, type getSizeInfo, AnimateStrategy,
} from '@/core/defs';
import type SplitPanel from '@/core/SplitPanel';

export default function configureAnimate(config?: Omit<anime.AnimeAnimParams, 'update'>): AnimateStrategy {
  return (panel: SplitPanel, sizeInfo: ReturnType<typeof getSizeInfo>) => {
    const timeline = anime.timeline();
    const vals = {
      size: sizeInfo.relative
        ? relativeToPercent(panel.sizeInfo.relativeSize)
        : exactToPx(panel.sizeInfo.exactSize),
    };

    timeline
      .add({
        duration: panel.animationDuration,
        easing: 'easeInOutQuart',
        size: sizeInfo.formatted,
        ...config,
        targets: vals,
        update: () => {
          panel.setSize(vals.size);
          panel.parent?.satisfyConstraints({ incremental: true });
        },
      });

    return {
      promise: timeline.finished,
      cancel: () => timeline.pause(),
    };
  };
}
