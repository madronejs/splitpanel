import { watch } from '@madronejs/core';
import { type DraggableStrategy, type DraggableStrategyReturn } from '@/core/defs';
import type SplitPanel from '@/core/SplitPanel';

import 'drag-drop-touch';

function addClone(event: DragEvent, el) {
  if (!event.dataTransfer) return undefined;

  // make a deep clone of the template/invisible ghost,
  const cloned = el.cloneNode(true);

  // temporarily put it way off screen so we can't see it
  cloned.style.position = 'fixed';
  cloned.style.top = '-100vh';
  cloned.style.left = '-100vw';
  cloned.style.display = 'block';

  document.body.append(cloned);

  const { width, height } = cloned.getBoundingClientRect();

  event.dataTransfer.setDragImage(cloned, width * 0.5, height);
  return cloned;
}

function onDragOver(e: DragEvent) {
  e.preventDefault();
}

export default function configureDraggable(
  options?: {
    dragSelector?: string,
    dropSelector?: string,
    canDrag?: (panel: SplitPanel) => boolean,
    canDrop?: (panel: SplitPanel) => boolean,
  }
): DraggableStrategy {
  return (panel: SplitPanel) => {
    const dragSelector = options?.dragSelector ?? '.drag-handle';
    const dropSelector = options?.dropSelector;
    let unbindSetup: () => void;
    let unbindDrag: () => void;
    let unbindDrop: () => void;
    let dragHandle: HTMLElement;
    let dropZone: HTMLElement;
    let ghostEl: HTMLElement;
    const returnVal: DraggableStrategyReturn = {
      unbind: undefined,
    };

    function checkDrop() {
      return !panel.numChildren && (options?.canDrop === undefined || options?.canDrop?.(panel) === true);
    }

    function onDrop(e: DragEvent) {
      const id = e.dataTransfer.getData('text/plain');
      const droppedPanel = panel.byId(id);

      if (droppedPanel) {
        panel.swapData(droppedPanel);
      }
    }

    function setupDropIfNeeded() {
      if (dropZone || !checkDrop()) return;

      dropZone = panel.contentEl?.querySelector(dropSelector) ?? panel.contentEl;

      if (!dropZone) return;

      dropZone.addEventListener('drop', onDrop);
      dropZone.addEventListener('dragover', onDragOver);

      unbindDrop = () => {
        dropZone.removeEventListener('drop', onDrop);
        dropZone.removeEventListener('dragover', onDragOver);
      };
    }

    function checkDrag() {
      return !panel.numChildren && (options?.canDrag === undefined || options?.canDrag?.(panel) === true);
    }

    function onDrag(e: DragEvent) {
      ghostEl = addClone(e, panel.contentEl);
      e.dataTransfer.dropEffect = 'move';
      e.dataTransfer.setData('text/plain', panel.id);
    }

    function setupDragIfNeeded() {
      if (dragHandle || !checkDrag()) return;

      dragHandle = panel.contentEl?.querySelector(dragSelector);

      if (!dragHandle || !panel.contentEl) return;

      const originalDraggable = dragHandle.getAttribute('draggable');

      dragHandle.setAttribute('draggable', 'true');
      dragHandle.addEventListener('touchstart', onDrag);
      dragHandle.addEventListener('dragstart', onDrag);

      unbindDrag = () => {
        dragHandle.setAttribute('draggable', originalDraggable);
        dragHandle.removeEventListener('touchstart', onDrag);
        dragHandle.removeEventListener('dragstart', onDrag);
        dragHandle.removeEventListener('dragend', unbindDrag);
        ghostEl?.remove();
        dragHandle = undefined;
      };

      dragHandle.addEventListener('dragend', unbindDrag);
    }

    function scan() {
      setupDropIfNeeded();
      setupDragIfNeeded();
    }

    function setupListeners() {
      panel.contentEl.addEventListener('mousedown', scan);
      panel.contentEl.addEventListener('touchstart', scan, { passive: true });

      unbindSetup = () => {
        panel.contentEl.removeEventListener('mousedown', scan);
        panel.contentEl.removeEventListener('touchstart', scan);
      };
    }

    const disposeChildWatcher = watch(() => !panel.numChildren, (isChild) => {
      if (isChild) {
        setupListeners();
        scan();
      } else {
        unbindSetup?.();
        unbindDrag?.();
      }
    }, { immediate: true });

    returnVal.unbind = () => {
      disposeChildWatcher();
      unbindSetup?.();
      unbindDrag?.();
      unbindDrop?.();
    };

    return returnVal;
  };
}
