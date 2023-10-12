import { type DraggableStrategy } from '@/core/defs';
import type SplitPanel from '@/core/SplitPanel';

export default function configureAnimate(config?: Omit<anime.AnimeAnimParams, 'update'>): DraggableStrategy {
  return (panel: SplitPanel) => {
    console.log('panel:', panel);

    const unbind = () => console.log('unbind:', panel);

    return {
      unbind,
    };
  };
}
