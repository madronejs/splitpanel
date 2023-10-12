import { watch } from '@madronejs/core';
import { type DraggableStrategy, type DraggableStrategyReturn, BoxCoord } from '@/core/defs';
import type SplitPanel from '@/core/SplitPanel';

import 'drag-drop-touch';

function onDragOver(e: DragEvent) {
  e.preventDefault();
}

function addClone(event: DragEvent, el: HTMLElement, anchor: BoxCoord) {
  if (!event.dataTransfer) return undefined;

  // make a deep clone of the template/invisible ghost,
  const cloned = el.cloneNode(true) as HTMLElement;

  // temporarily put it way off screen so we can't see it
  cloned.style.position = 'fixed';
  cloned.style.top = '-100vh';
  cloned.style.left = '-100vw';
  cloned.style.display = 'block';

  document.body.append(cloned);

  const { width, height } = cloned.getBoundingClientRect();

  event.dataTransfer.setDragImage(cloned, width * anchor.x, height * anchor.y);
  return cloned;
}

function checkDrag(panel: SplitPanel, canDrag?: (panel: SplitPanel) => boolean) {
  return !panel.numChildren && (canDrag === undefined || canDrag?.(panel) === true);
}

function checkDrop(panel: SplitPanel, canDrop?: (panel: SplitPanel) => boolean) {
  return !panel.numChildren && (canDrop === undefined || canDrop?.(panel) === true);
}

export default function configureDraggable(
  options?: {
    dragSelector?: string,
    dropSelector?: string,
    draggingClass?: string,
    dropzoneClass?: string,
    canDrag?: (panel: SplitPanel) => boolean,
    canDrop?: (panel: SplitPanel) => boolean,
    onDrop?: (opts: { target: SplitPanel, panel: SplitPanel }) => void,
    ghost?: (panel: SplitPanel) => HTMLElement,
    ghostAnchor?: (panel: SplitPanel) => BoxCoord,
  }
): DraggableStrategy {
  return (panel: SplitPanel) => {
    const dragSelector = options?.dragSelector ?? '.drag-handle';
    const dropSelector = options?.dropSelector;
    const draggingClass = options?.draggingClass ?? 'split-panel-dragging';
    const dropzoneClass = options?.dropzoneClass ?? 'split-panel-dropzone';
    let unbindSetup: () => void;
    let unbindDrag: () => void;
    let unbindDrop: () => void;
    let dragHandle: HTMLElement;
    let dropZone: HTMLElement;
    let ghostEl: HTMLElement;
    const returnVal: DraggableStrategyReturn = {
      unbind: undefined,
    };

    function onDrop(e: DragEvent) {
      const id = e.dataTransfer.getData('text/plain');
      const droppedPanel = panel.byId(id);

      options?.onDrop?.({ target: panel, panel: droppedPanel });
    }

    function setupDropIfNeeded() {
      if (dropZone || !checkDrop(panel, options?.canDrop)) return;

      dropZone = panel.contentEl?.querySelector(dropSelector) ?? panel.contentEl;

      if (!dropZone) return;

      dropZone.addEventListener('drop', onDrop);
      dropZone.addEventListener('dragover', onDragOver);

      unbindDrop = () => {
        dropZone.removeEventListener('drop', onDrop);
        dropZone.removeEventListener('dragover', onDragOver);
      };
    }

    let dropzoneClassCleanup: HTMLElement[];

    function removeDropzoneClass() {
      for (const el of dropzoneClassCleanup || []) {
        el?.classList.remove(dropzoneClass);
      }

      dropzoneClassCleanup = undefined;
    }

    function addDropzoneClass() {
      removeDropzoneClass();
      dropzoneClassCleanup = [];

      for (const child of panel.root.allChildren) {
        if (child.id !== panel.id && checkDrop(child, options?.canDrop) && child.containerEl) {
          child.containerEl.classList.add(dropzoneClass);
          dropzoneClassCleanup.push(child.containerEl);
        }
      }
    }

    let dragClassCleanup: HTMLElement[];

    function removeDraggingClass() {
      for (const el of dragClassCleanup || []) {
        el?.classList.remove(draggingClass);
      }
    }

    function addDraggingClass() {
      removeDraggingClass();

      if (checkDrag(panel, options?.canDrag) && panel.containerEl) {
        dragClassCleanup = [panel.containerEl];
        panel.containerEl.classList.add(draggingClass);
      }
    }

    function onDrag(e: DragEvent) {
      const anchor = options?.ghostAnchor?.(panel);
      const newAnchor = {
        x: 0.5,
        y: 1,
        ...anchor,
      };

      ghostEl = addClone(
        e,
        options?.ghost?.(panel) ?? panel.contentEl,
        newAnchor
      );
      e.dataTransfer.dropEffect = 'move';
      e.dataTransfer.setData('text/plain', panel.id);
      addDraggingClass();
      addDropzoneClass();
    }

    function setupDragIfNeeded() {
      if (dragHandle || !checkDrag(panel, options?.canDrag)) return;

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
        removeDraggingClass();
        removeDropzoneClass();
      };

      dragHandle.addEventListener('dragend', unbindDrag);
    }

    function scan() {
      setupDropIfNeeded();
      setupDragIfNeeded();
    }

    function setupListeners() {
      const { contentEl } = panel;

      contentEl.addEventListener('mousedown', scan);
      contentEl.addEventListener('touchstart', scan, { passive: true });

      unbindSetup = () => {
        contentEl.removeEventListener('mousedown', scan);
        contentEl.removeEventListener('touchstart', scan);
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
