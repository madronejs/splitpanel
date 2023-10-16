import { auto, watch } from '@madronejs/core';
import { type DraggableStrategy, type DraggableStrategyReturn, BoxCoord } from '@/core/defs';
import type SplitPanel from '@/core/SplitPanel';

import 'drag-drop-touch';

function onDragOver(e: DragEvent) {
  e.preventDefault();
}

function addClone(event: DragEvent, el: HTMLElement, anchor: BoxCoord) {
  if (!event.dataTransfer) return undefined;

  // make a deep clone of the template/invisible ghost,
  const cloned = el?.cloneNode(true) as HTMLElement;

  if (cloned) {
    // temporarily put it way off screen so we can't see it
    cloned.style.position = 'fixed';
    cloned.style.top = '-100vh';
    cloned.style.left = '-100vw';
    cloned.style.display = 'block';
    document.body.append(cloned);

    const { width, height } = cloned.getBoundingClientRect();

    event.dataTransfer.setDragImage(cloned, width * anchor.x, height * anchor.y);
  }

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
    dragoverClass?: string,
    canDrag?: (panel: SplitPanel) => boolean,
    canDrop?: (panel: SplitPanel) => boolean,
    onDragOver?: (opts: { target: SplitPanel, enter: boolean }) => void,
    onDrop?: (opts: { target: SplitPanel, panel: SplitPanel }) => void,
    ghost?: (panel: SplitPanel) => HTMLElement,
    ghostAnchor?: (panel: SplitPanel) => BoxCoord,
  }
): DraggableStrategy {
  const dragSelector = options?.dragSelector ?? '.drag-handle';
  const dropSelector = options?.dropSelector;
  const draggingClass = options?.draggingClass ?? 'split-panel-dragging';
  const dropzoneClass = options?.dropzoneClass ?? 'split-panel-dropzone';
  const dragoverClass = options?.dragoverClass ?? 'split-panel-dragover';

  let dropzoneClassCleanup: HTMLElement[];

  function removeDropzoneClass() {
    for (const el of dropzoneClassCleanup || []) {
      el?.classList.remove(dropzoneClass);
    }

    dropzoneClassCleanup = undefined;
  }

  let dragClassCleanup: HTMLElement[];

  function removeDraggingClass() {
    for (const el of dragClassCleanup || []) {
      el?.classList.remove(draggingClass);
    }
  }

  const dragState = auto<{
    panel: SplitPanel,
  }>({
    panel: undefined,
  });

  function setDragoverPanel(panel: SplitPanel) {
    dragState.panel = panel;
  }
  // let dragoverEl: HTMLElement;

  // function unsetDragoverEl() {
  //   dragoverEl?.classList.remove(dragoverClass);
  //   dragoverEl = undefined;
  // }

  // function setDragoverEl(el: HTMLElement) {
  //   unsetDragoverEl();
  //   dragoverEl = el;
  //   dragoverEl?.classList.add(dragoverClass);
  // }

  return (panel: SplitPanel) => {
    let unbindSetup: () => void;
    let unbindDrag: () => void;
    let unbindDrop: () => void;
    let dragHandle: HTMLElement;
    let dropZone: HTMLElement;
    let ghostEl: HTMLElement;
    const returnVal: DraggableStrategyReturn = auto({
      dragging: false,
      unbind: undefined,
    });

    function getPanelFromEvent(e: DragEvent) {
      return panel.byId(e.dataTransfer.getData('text/plain'));
    }

    function onDrop(e: DragEvent) {
      setDragoverPanel(null);
      options?.onDrop?.({ target: panel, panel: getPanelFromEvent(e) });
    }

    function onDragEnter() {
      if (returnVal.dragging) {
        setDragoverPanel(null);
      } else {
        setDragoverPanel(panel);
        options?.onDragOver?.({ target: panel, enter: true });
      }
    }

    function onDragLeave() {
      if (!returnVal.dragging) {
        options?.onDragOver?.({ target: panel, enter: false });
      }
    }

    function setupDropIfNeeded() {
      if (dropZone || !checkDrop(panel, options?.canDrop)) return;

      dropZone = panel.containerEl?.querySelector(dropSelector) ?? panel.containerEl;

      if (!dropZone) return;

      dropZone.addEventListener('drop', onDrop);
      dropZone.addEventListener('dragover', onDragOver);
      dropZone.addEventListener('dragenter', onDragEnter);
      dropZone.addEventListener('dragleave', onDragLeave);

      unbindDrop = () => {
        dropZone.removeEventListener('drop', onDrop);
        dropZone.removeEventListener('dragover', onDragOver);
        dropZone.removeEventListener('dragenter', onDragEnter);
        dropZone.removeEventListener('dragleave', onDragLeave);
      };
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
      e.dataTransfer.effectAllowed = 'move';
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
      returnVal.dragging = true;

      unbindDrag = () => {
        returnVal.dragging = false;
        dragHandle?.setAttribute('draggable', originalDraggable);
        dragHandle?.removeEventListener('touchstart', onDrag);
        dragHandle?.removeEventListener('dragstart', onDrag);
        dragHandle?.removeEventListener('dragend', unbindDrag);
        ghostEl?.remove();
        dragHandle = undefined;
        removeDraggingClass();
        removeDropzoneClass();
        setDragoverPanel(null);
      };

      dragHandle.addEventListener('dragend', unbindDrag);
    }

    function scan() {
      setupDropIfNeeded();
      setupDragIfNeeded();
    }

    function setupListeners() {
      const { contentEl } = panel;

      contentEl?.addEventListener('mousedown', scan);
      contentEl?.addEventListener('touchstart', scan, { passive: true });

      unbindSetup = () => {
        contentEl?.removeEventListener('mousedown', scan);
        contentEl?.removeEventListener('touchstart', scan);
      };
    }

    const disposeDragoverPanelWatcher = watch(() => dragState.panel, (val, old) => {
      old?.containerEl?.classList.remove(dragoverClass);
      val?.containerEl?.classList.add(dragoverClass);
    });

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
      disposeDragoverPanelWatcher();
      disposeChildWatcher();
      unbindSetup?.();
      unbindDrag?.();
      unbindDrop?.();
    };

    return returnVal;
  };
}
