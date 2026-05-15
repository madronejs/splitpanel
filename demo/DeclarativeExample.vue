<script setup lang="ts">
/**
 * Declarative-tree demo. Every panel is a <SplitPanel> in the template; the
 * tree shape (a nested column inside a row) is expressed by <SplitContainer>.
 * v-for adds tabs dynamically — each new entry mounts a SplitPanel which
 * registers itself with the runtime and slot-teleports its content into the
 * leaf SplitGrid creates.
 *
 * No imperative `addChild` / `removeChild` calls in this file. The grid's
 * tree mirrors the items array, and Vue reactivity does the rest.
 */
import { computed, ref } from 'vue';
import { SplitContainer, SplitGridView, SplitPanel } from '../src/vue';

interface Tab { id: string, title: string, body: string }

let nextTabSeq = 1;
const tabs = ref<Tab[]>([
  { id: 'tab-1', title: 'README', body: 'Welcome to the declarative demo.' },
  { id: 'tab-2', title: 'CHANGELOG', body: 'Tabs are <SplitPanel v-for=...>.' },
]);

function addTab() {
  nextTabSeq += 1;
  const id = `tab-${Date.now()}`;

  tabs.value.push({
    id,
    title: `Tab #${nextTabSeq}`,
    body: 'Lorem ipsum dolor sit amet.',
  });
}

function removeTab(id: string) {
  tabs.value = tabs.value.filter((t) => t.id !== id);
}

const showInspector = ref(true);
const showConsole = ref(true);
const tabCount = computed(() => tabs.value.length);
</script>

<template>
  <div class="decl-demo">
    <div class="decl-demo__bar">
      <button type="button" @click="addTab">+ tab</button>
      <button type="button" :disabled="!tabCount" @click="removeTab(tabs[tabs.length - 1].id)">
        − last tab
      </button>
      <span class="decl-demo__divider" />
      <label class="decl-demo__check">
        <input v-model="showInspector" type="checkbox" />
        inspector
      </label>
      <label class="decl-demo__check">
        <input v-model="showConsole" type="checkbox" />
        console
      </label>
      <span class="decl-demo__count">{{ tabCount }} tabs · template-driven</span>
    </div>

    <div class="decl-demo__stage">
      <SplitGridView id="decl-root" direction="row" :resizer="{ size: 8 }">
        <!-- Static sidebar — explicit panel-id for keyboard-shortcut wiring. -->
        <SplitPanel panel-id="sidebar" size="220px" min="160px" max="320px">
          <div class="decl-panel decl-panel--sidebar">
            <strong>Sidebar</strong>
            <p>panel-id="sidebar"</p>
          </div>
        </SplitPanel>

        <!-- Nested column for editor + (optional) console. -->
        <SplitContainer direction="column" :resizer="{ size: 8 }">
          <SplitPanel min="120px">
            <div class="decl-panel decl-panel--editor">
              <strong>Editor</strong>
              <p>No panel-id — auto-generated, but template-stable.</p>
            </div>
          </SplitPanel>

          <SplitPanel v-if="showConsole" size="30%" min="80px">
            <div class="decl-panel decl-panel--console">
              <strong>Console</strong>
              <p>Toggled by v-if. Mounts/unmounts via the registry.</p>
            </div>
          </SplitPanel>
        </SplitContainer>

        <!-- v-for tabs: each one is a SplitPanel; data prop carries the row. -->
        <SplitPanel
          v-for="tab in tabs"
          :key="tab.id"
          :panel-id="tab.id"
          :data="tab"
          min="120px"
        >
          <template #default="{ panel }">
            <div class="decl-panel decl-panel--tab">
              <header>
                <strong>{{ tab.title }}</strong>
                <button type="button" @click="removeTab(tab.id)">×</button>
              </header>
              <p>{{ tab.body }}</p>
              <small>id={{ panel?.id }}</small>
            </div>
          </template>
        </SplitPanel>

        <!-- Optional inspector — same toggle pattern as console. -->
        <SplitPanel v-if="showInspector" panel-id="inspector" size="20%" min="140px">
          <div class="decl-panel decl-panel--inspector">
            <strong>Inspector</strong>
            <p>panel-id="inspector" · toggled by v-if</p>
          </div>
        </SplitPanel>
      </SplitGridView>
    </div>
  </div>
</template>

<style>
.decl-demo {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.decl-demo__bar {
  display: flex;
  gap: 8px;
  padding: 8px 10px;
  background: #f0f2f6;
  border-bottom: 1px solid #d8dde6;
  align-items: center;
  flex-wrap: wrap;
}
.decl-demo__bar button {
  font: inherit;
  border: 1px solid #c4c9d3;
  background: #fff;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
}
.decl-demo__bar button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.decl-demo__bar button:hover:not(:disabled) {
  background: #eef1f5;
}
.decl-demo__divider {
  width: 1px;
  height: 20px;
  background: #c4c9d3;
  margin: 0 4px;
}
.decl-demo__check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #2a3242;
  user-select: none;
}
.decl-demo__count {
  margin-left: auto;
  color: #5a6577;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.decl-demo__stage {
  flex: 1;
  min-height: 0;
}

.decl-panel {
  width: 100%;
  height: 100%;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: #fbfbfd;
  overflow: hidden;
}
.decl-panel p {
  margin: 0;
  color: #4a5568;
  font-size: 13px;
}
.decl-panel--sidebar    { background: #eef4ff; }
.decl-panel--editor     { background: #fbfbfd; }
.decl-panel--console    { background: #1e2738; color: #cbd3e3; }
.decl-panel--console p  { color: #97a0b3; }
.decl-panel--inspector  { background: #fff4d6; }
.decl-panel--tab        { background: #f4f5f7; }

.decl-panel--tab header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.decl-panel--tab button {
  border: none;
  background: rgba(0, 0, 0, 0.08);
  width: 22px;
  height: 22px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}
.decl-panel--tab button:hover {
  background: rgba(0, 0, 0, 0.18);
}
.decl-panel--tab small {
  color: #97a0b3;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  margin-top: auto;
}
</style>
