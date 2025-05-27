import { createTimeline, DefaultsParams } from 'animejs';

import { relativeToPercent } from '@/core/utilParse';
import { AnimateStrategy, ConstraintType } from '@/core/interfaces';
import type SplitPanel from '@/core/SplitPanel';

export default function configureAnimate(config?: Omit<DefaultsParams, 'onUpdate'>): AnimateStrategy {
  return (
    /** The container panel */
    panel: SplitPanel,
    /** The items to animate */
    items: SplitPanel[],
    /** The size (or parallel array of sizes) */
    size?: ConstraintType | ConstraintType[]
  ) => {
    const timeline = createTimeline({ defaults: { autoplay: false } });
    const newSizes = panel.calculateSizes({
      item: items,
      size,
    });

    for (const item of panel.children) {
      const sizeInfo = newSizes[item.id];
      const startSize = relativeToPercent(item.sizeInfo.relativeSize);
      const targets = { size: startSize };
      const parsedFinalSize = item.getSizeInfo(sizeInfo?.formatted ?? item.originalSize);
      const finalSize = relativeToPercent(parsedFinalSize.relativeSize);

      if (startSize !== finalSize) {
        timeline
          .add(targets, {
            duration: config?.duration ?? 750,
            ease: 'inOutQuart',
            size: finalSize,
            ...config,
            onUpdate: () => {
              item.setSize(targets.size);
            },
          }, 0);
      }
    }

    timeline.play();

    return {
      promise: timeline.then(),
      cancel: () => timeline.pause(),
    };
  };
}
