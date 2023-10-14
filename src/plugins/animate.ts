import anime from 'animejs';
import {
  relativeToPercent,
  AnimateStrategy,
  negateChildren,
  ConstraintType,
} from '@/core/defs';
import type SplitPanel from '@/core/SplitPanel';

export default function configureAnimate(config?: Omit<anime.AnimeAnimParams, 'update'>): AnimateStrategy {
  return (panel: SplitPanel, items: SplitPanel[], size?: ConstraintType) => {
    const others = negateChildren(panel, items);
    const timeline = anime.timeline({ autoplay: false });
    const newSizes = panel.calculateSizes({
      item: items,
      size,
      itemsToConstrain: others,
    });

    for (const item of panel.children) {
      const sizeInfo = newSizes[item.id];
      const startSize = relativeToPercent(item.sizeInfo.relativeSize);
      const targets = { size: startSize };
      const parsedFinalSize = item.getSizeInfo(sizeInfo?.formatted ?? item.originalSize);
      const finalSize = relativeToPercent(parsedFinalSize.relativeSize);

      if (startSize !== finalSize) {
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
    }

    timeline.play();

    return {
      promise: timeline.finished,
      cancel: () => timeline.pause(),
    };
  };
}
