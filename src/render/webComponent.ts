import { computed, reactive, watch } from '@madronejs/core';
import difference from 'lodash/difference';
import type SplitPanel from '@/core/SplitPanel';

export default class SplitPanelView<DType = any> extends HTMLElement {
  @reactive static tag = 'split-panel';

  static register() {
    if (!customElements.get(SplitPanelView.tag)) {
      customElements.define(SplitPanelView.tag, SplitPanelView);
    }
    return customElements.whenDefined(SplitPanelView.tag);
  }

  static classNames = {
    root: 'split-panel-root',
    dragging: 'dragging',
    content: 'split-panel-content',
    resizer: 'split-panel-resize',
  };

  static idFromSlotName(name: string) {
    return name?.split(':').pop();
  }

  static itemSlotName(panel: SplitPanel) {
    return `item:${panel?.id}`;
  }

  static resizeSlotName(panel: SplitPanel) {
    return `resize:${panel?.id}`;
  }

  constructor() {
    super();
    this._panelViewMap = {};
    this._panelElementMap = {};
    this._panelSlotMap = {};
    this.setSplitPanel = this.setSplitPanel.bind(this);
    this._styleTasks = [];
  }

  @reactive private _panelViewMap: Record<string, SplitPanelView<DType>>;
  @reactive private _panelElementMap: Record<string, HTMLElement>;
  @reactive private _panelSlotMap: Record<string, HTMLSlotElement>;
  @reactive private _splitPanel: SplitPanel<DType>;
  @reactive private _styleTasks: Array<() => void>;
  @reactive.shallow private _disposeWatchers: () => void;

  @reactive private _root: SplitPanelView<DType>;
  @computed get root() {
    return this._root ?? this;
  }

  set root(val) {
    this._root = val;
  }

  @computed get contentElName() {
    return SplitPanelView.itemSlotName(this.splitPanel);
  }

  @computed get contentEl() {
    return this._panelElementMap[this.contentElName];
  }

  @computed get resizeElName() {
    return SplitPanelView.resizeSlotName(this.splitPanel);
  }

  @computed get resizeEl() {
    return this._panelElementMap[this.resizeElName];
  }

  @reactive parent: SplitPanelView<DType>;

  @computed get splitPanel() {
    return this._splitPanel;
  }

  set splitPanel(val) {
    this.setSplitPanel(val);
  }

  connectedCallback() {
    this.sync();
    this._runStyleTasks();
  }

  disconnectedCallback() {
    this.splitPanel?.unbind();
    this._disposeWatchers?.();
  }

  getSlot(name: string) {
    return this._panelSlotMap[name];
  }

  setParentView(val: SplitPanelView<DType>) {
    this.parent = val;
  }

  setRootView(val: SplitPanelView<DType>) {
    this._root = val;
  }

  setStyles(styles?: Record<string, any>) {
    const val = styles || this.splitPanel?.style || {};

    for (const key of Object.keys(val)) {
      this.style[key] = val[key];
    }
  }

  setSplitPanel(splitPanel: SplitPanel<DType>) {
    if (!splitPanel) return;

    this._splitPanel = splitPanel;
    splitPanel.attachEl(this);

    const toDispose = [
      // ROOT
      watch(() => splitPanel.isRoot, (val) => {
        if (val) {
          this.classList.add(SplitPanelView.classNames.root);
        } else {
          this.classList.remove(SplitPanelView.classNames.root);
        }
      }, { immediate: true }),
      // DRAGGING
      watch(() => splitPanel.id, (val) => {
        if (val) {
          this.dataset.panelId = val;
        }
      }, { immediate: true }),
      // DRAGGING
      watch(() => splitPanel.dragging, (val) => {
        if (val) {
          this.classList.add(SplitPanelView.classNames.dragging);
        } else {
          this.classList.remove(SplitPanelView.classNames.dragging);
        }
      }),
      // DIRECTION
      watch(() => `direction-${splitPanel.direction}`, (val, old) => {
        this.classList.remove(old);
        this.classList.add(val);
      }, { immediate: true }),
      // STYLE
      watch(() => splitPanel.style, (val) => {
        this._styleTasks.push(() => {
          this.setStyles(val);
        });
        this._runStyleTasks();
      }),
      // RESIZE EL STYLE
      watch(() => splitPanel.resizeElStyle, (val) => {
        if (this.resizeEl) {
          for (const key of Object.keys(val)) {
            this.resizeEl.style[key] = val[key];
          }
        }
      }),
    ];

    this._disposeWatchers = () => {
      for (const dispose of toDispose) {
        dispose();
      }
    };

    this.sync();
  }

  private _runStyleTasks() {
    if (this.splitPanel) {
      const todo = [...this._styleTasks].reverse();

      this._styleTasks = [];

      for (const task of todo) {
        task();
      }
    }
  }

  private _createPanel(panel: SplitPanel<DType>) {
    const panelEl = document.createElement(SplitPanelView.tag) as SplitPanelView<DType>;

    panelEl.setSplitPanel(panel);
    panelEl.setRootView(this.root);
    panelEl.setParentView(this);
    return panelEl;
  }

  private _createPanelSlot(name: string) {
    const slotEl = document.createElement('slot');

    slotEl.setAttribute('name', name);
    return slotEl;
  }

  private _createItemResizerIfNeeded() {
    const name = SplitPanelView.resizeSlotName(this.splitPanel);

    if (!this._panelElementMap[name] && this.splitPanel?.shouldShowResizeEl) {
      const el = document.createElement('div');
      const slot = this._createPanelSlot(name);

      el.classList.add(SplitPanelView.classNames.resizer);
      el.append(slot);
      this.append(el);
      this._panelElementMap[name] = el;
      this._panelSlotMap[name] = slot;
      this.splitPanel.attachResizeEl(el);
    }
  }

  private _createItemContentIfNeeded() {
    const name = SplitPanelView.itemSlotName(this.splitPanel);

    if (!this._panelElementMap[name]) {
      const el = document.createElement('div');
      const slot = this._createPanelSlot(name);

      el.classList.add(SplitPanelView.classNames.content);
      el.append(slot);
      this.append(el);
      this._panelElementMap[name] = el;
      this._panelSlotMap[name] = slot;
      this.splitPanel.attachContentEl(el);
    }
  }

  private _addContentElements() {
    if (!this.splitPanel) {
      return;
    }

    this._createItemResizerIfNeeded();
    this._createItemContentIfNeeded();
  }

  private _removeContentElements() {
    for (const key of Object.keys(this._panelElementMap)) {
      this._panelElementMap[key]?.remove();
      delete this._panelElementMap[key];
      delete this._panelSlotMap[key];
    }
  }

  private _removeChild(...ids: string[]) {
    for (const id of ids) {
      this._panelViewMap[id]?.remove();
      delete this._panelViewMap[id];
    }
  }

  private _addChild(...panels: Array<SplitPanel<DType>>) {
    for (const panel of panels) {
      if (!this._panelViewMap[panel.id]) {
        const panelEl = this._createPanel(panel);

        this._panelViewMap[panel.id] = panelEl;
        this.append(panelEl);
      }
    }
  }

  private _moveSlots() {
    if (this.splitPanel.isRoot) {
      const items = [...this.children] as HTMLElement[];

      for (const item of items) {
        const slotName = item.slot;
        const id = SplitPanelView.idFromSlotName(slotName);
        const panel = this.splitPanel.allChildMap[id];
        const container = panel?.containerEl as SplitPanelView<DType>;
        const slot = container?.getSlot(slotName);

        if (slot) {
          item.style.display = null;
          slot.replaceChildren(item);
        } else if (!(item instanceof SplitPanelView)) {
          item.style.display = 'none';
        }
      }
    }
  }

  sync() {
    const childIds = Object.keys(this.splitPanel?.childMap || {});
    const componentIds = Object.keys(this._panelViewMap);
    const oldIds = difference(componentIds, childIds);

    this._removeChild(...oldIds);

    if (!this.splitPanel) {
      return;
    }

    if (!this.splitPanel.containerEl) {
      this.splitPanel.attachEl(this);
    }

    if (this.splitPanel.numChildren) {
      this._removeContentElements();
      this._addChild(...this.splitPanel.children);
    } else {
      this._addContentElements();
    }

    this._moveSlots();
  }
}
