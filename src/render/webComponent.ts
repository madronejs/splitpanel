import { computed, reactive, watch } from '@madronejs/core';
import debounce from 'lodash/debounce';
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
    this._syncDebounced = debounce(this.sync.bind(this));
    this._rebalanceDebounced = debounce(this.rebalance.bind(this));
  }

  @reactive private _panelViewMap: Record<string, SplitPanelView<DType>>;
  @reactive private _panelElementMap: Record<string, HTMLElement>;
  @reactive private _panelSlotMap: Record<string, HTMLSlotElement>;
  @reactive private _splitPanel: SplitPanel<DType>;
  @reactive.shallow _mutationObserver: MutationObserver;
  @reactive.shallow private _disposeWatchers: () => void;
  @reactive.shallow private _syncDebounced: () => void;
  @reactive.shallow private _rebalanceDebounced: () => void;

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
    this._syncStyles();
  }

  disconnectedCallback() {
    this._mutationObserver?.disconnect();
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

  private _syncStyles() {
    if (this.splitPanel) {
      const val = this.splitPanel.style;

      for (const key of Object.keys(val)) {
        this.style[key] = val[key];
      }
    }
  }

  private _syncResizeStyles() {
    if (this.splitPanel && this.resizeEl) {
      for (const key of Object.keys(this.splitPanel.resizeElStyle)) {
        this.resizeEl.style[key] = this.splitPanel.resizeElStyle[key];
      }
    }
  }

  private _setupMutationObserver() {
    if (this.splitPanel?.isRoot && !this._mutationObserver) {
      this._mutationObserver = new MutationObserver(this._syncDebounced);
      this._mutationObserver.observe(this, {
        childList: true,
        subtree: false,
        attributes: false,
      });
    }
  }

  setSplitPanel(splitPanel: SplitPanel<DType>) {
    if (!splitPanel) return;

    this._splitPanel = splitPanel;
    splitPanel.attachEl(this);
    this._setupMutationObserver();

    const toDispose = [
      // ROOT
      watch(() => splitPanel.isRoot, (val) => {
        if (val) {
          this.classList.add(SplitPanelView.classNames.root);
        } else {
          this.classList.remove(SplitPanelView.classNames.root);
        }
      }, { immediate: true }),
      watch(() => splitPanel.allChildren, this._syncDebounced),
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
      watch(() => (this.contentEl ? `direction-${splitPanel.direction}` : undefined), (val, old) => {
        if (val) {
          this.contentEl.classList.remove(old);
          this.contentEl.classList.add(val);
        }
      }, { immediate: true }),
      // STYLE
      watch(() => splitPanel.style, this._syncStyles.bind(this)),
      watch(() => splitPanel.resizeElStyle, this._syncResizeStyles.bind(this)),
      watch(() => splitPanel.children, this._rebalanceDebounced),
    ];

    this._disposeWatchers = () => {
      for (const dispose of toDispose) {
        dispose();
      }
    };

    this.sync();
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
      this._syncResizeStyles();
    }
  }

  private _createItemContentIfNeeded() {
    if (!this._panelElementMap[this.contentElName]) {
      const el = document.createElement('div');

      el.classList.add(SplitPanelView.classNames.content);
      this.append(el);
      this._panelElementMap[this.contentElName] = el;
      this.splitPanel.attachContentEl(el);
    }
  }

  private _syncResizeSlotIfNeeded() {
    const canHaveSlot = !this.splitPanel.isRoot;
    const needsSlot = !this._panelSlotMap[this.resizeElName];

    if (needsSlot && canHaveSlot) {
      const slot = this._createPanelSlot(this.resizeElName);

      this._panelSlotMap[this.resizeElName] = slot;
      this.resizeEl?.append(slot);
    } else if (!canHaveSlot) {
      this._panelSlotMap[this.resizeElName]?.remove();
      delete this._panelSlotMap[this.resizeElName];
    }
  }

  private _syncItemSlotIfNeeded() {
    const canHaveSlot = !this.splitPanel.isRoot && !this.splitPanel.numChildren;
    const needsSlot = !this._panelSlotMap[this.contentElName];

    if (needsSlot && canHaveSlot) {
      const slot = this._createPanelSlot(this.contentElName);

      this._panelSlotMap[this.contentElName] = slot;
      this.contentEl?.append(slot);
    } else if (!canHaveSlot) {
      this._panelSlotMap[this.contentElName]?.remove();
      delete this._panelSlotMap[this.contentElName];
    }
  }

  private _removeSlotElements() {
    for (const key of Object.keys(this._panelSlotMap)) {
      this._panelSlotMap[key]?.remove();
      delete this._panelSlotMap[key];
      // this._panelElementMap[key]?.remove();
      // delete this._panelElementMap[key];
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
      if (!this._panelViewMap[panel.id] && this.contentEl) {
        const panelEl = this._createPanel(panel);

        this._panelViewMap[panel.id] = panelEl;
        this.contentEl.append(panelEl);
      }
    }
  }

  private _syncSlots() {
    this._syncItemSlotIfNeeded();
    this._syncResizeSlotIfNeeded();

    if (this.splitPanel.isRoot) {
      const items = [...this.children] as HTMLElement[];

      for (const item of items) {
        if (item.slot) {
          const slotName = item.slot;
          const id = SplitPanelView.idFromSlotName(slotName);
          const panel = this.splitPanel.byId(id);
          const container = panel?.containerEl as SplitPanelView<DType>;
          const slot = container?.getSlot(slotName);

          if (slot) {
            item.style.display = null;
            slot.replaceChildren(item);
          } else {
            item.style.display = 'none';
          }
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

    if (!this.splitPanel.isRoot) {
      this._createItemResizerIfNeeded();
    }

    this._createItemContentIfNeeded();
    this._addChild(...this.splitPanel.children);
    this._syncSlots();
  }

  rebalance() {
    this.sync();
    this.splitPanel.equalizeChildrenSizes();
  }
}
