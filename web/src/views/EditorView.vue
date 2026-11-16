<script setup>
import { ref, computed, watch } from 'vue'
import { state, closeEditor } from '../store.js'
import { S } from '../lib/strings.js'
import ConversationPanel from '../components/ConversationPanel.vue'
import CharacterEditor from '../components/CharacterEditor.vue'
import WorldBookEditor from '../components/WorldBookEditor.vue'
import FrontendPreview from '../components/FrontendPreview.vue'
import AdvancedAssets from '../components/AdvancedAssets.vue'
import AppIcon from '../components/AppIcon.vue'
import LinkedWorkflow from '../components/LinkedWorkflow.vue'
import TavernLab from '../components/TavernLab.vue'

// 桌面右栏面板 / 手机全屏页签 共用的面板序号：1=角色卡 2=世界书 3=前端 4=高级
const isCharacter = computed(() => state.current?.kind === 'Character')
const mobileTab = ref(0)

const tabs = computed(() => {
  const list = [{ key: 0, label: S.tabChat, icon: 'chat' }]
  if (isCharacter.value) {
    list.push({ key: 1, label: S.kindCharacter, icon: 'card' })
    list.push({ key: 2, label: S.kindWorldbook, icon: 'book' })
    list.push({ key: 3, label: S.tabFrontend, icon: 'code' })
    list.push({ key: 4, label: S.tabAdvanced, icon: 'layers' })
  } else {
    list.push({ key: 2, label: S.kindWorldbook, icon: 'book' })
  }
  return list
})

const panel = ref(isCharacter.value ? 1 : 2)
watch(() => state.current?.id, () => {
  panel.value = isCharacter.value ? 1 : 2
  mobileTab.value = 0
})
</script>

<template>
  <div class="editor-root">
    <div class="editor-topbar">
      <button class="link" :disabled="state.busy" @click="closeEditor()"><AppIcon name="back" />{{ S.back }}</button>
      <span class="topbar-divider"></span>
      <strong class="title">{{ state.current ? (isCharacter ? S.editorTitleCharacter : S.editorTitleWorldbook) : S.loadingDraft }}</strong>
      <LinkedWorkflow v-if="state.current" />
      <div v-if="state.current" class="preview-entry"><TavernLab /></div>
      <span class="save-hint"><AppIcon name="check" />草稿保存在此浏览器</span>
    </div>

    <div v-if="!state.current" class="loading">
      <p :class="{ error: state.error }">{{ state.error ?? S.loadingDraft }}</p>
    </div>

    <template v-else>
      <div v-if="state.error" class="banner error">{{ state.error }}</div>
      <div v-if="state.info" class="banner info">{{ state.info }}</div>

      <!-- 桌面：左对话 + 右面板 -->
      <div class="desktop-split">
        <section class="pane chat-pane">
          <ConversationPanel />
        </section>
        <section class="pane panel-pane">
          <div class="panel-tabs">
            <button
              v-for="tab in tabs.filter((t) => t.key !== 0)"
              :key="tab.key"
              class="chip"
              :class="{ active: panel === tab.key }"
              :aria-pressed="panel === tab.key"
              @click="panel = tab.key"
            ><AppIcon :name="tab.icon" />{{ tab.label }}</button>
          </div>
          <div class="panel-body">
            <CharacterEditor v-if="panel === 1" />
            <WorldBookEditor v-else-if="panel === 2" />
            <FrontendPreview v-else-if="panel === 3" />
            <AdvancedAssets v-else-if="panel === 4" />
          </div>
        </section>
      </div>

      <!-- 手机：单栏 + 底部页签 -->
      <div class="mobile-split">
        <div class="mobile-body">
          <ConversationPanel v-if="mobileTab === 0" />
          <CharacterEditor v-else-if="mobileTab === 1" />
          <WorldBookEditor v-else-if="mobileTab === 2" />
          <FrontendPreview v-else-if="mobileTab === 3" />
          <AdvancedAssets v-else-if="mobileTab === 4" />
        </div>
        <nav class="mobile-nav">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="nav-item"
            :class="{ active: mobileTab === tab.key }"
            :aria-pressed="mobileTab === tab.key"
            @click="mobileTab = tab.key"
          >
            <span class="dot" v-if="tab.key === 0 && state.busy"></span>
            <AppIcon :name="tab.icon" />
            {{ tab.label }}
          </button>
        </nav>
      </div>
    </template>
  </div>
</template>

<style scoped>
.editor-root {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.editor-topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
}

.editor-topbar .title {
  font-size: 15px;
}

.loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  text-align: center;
  color: var(--text-dim);
}

.loading .error {
  color: var(--danger);
}

/* 桌面双栏 */
.desktop-split {
  flex: 1;
  display: flex;
  min-height: 0;
}

.pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.chat-pane {
  flex: 1.05;
  border-right: 1px solid var(--border);
}

.panel-pane {
  flex: 1;
}

.panel-tabs {
  display: flex;
  gap: 8px;
  padding: 10px 12px 6px;
  overflow-x: auto;
}

.panel-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.panel-body > * {
  flex: 1;
}

/* 手机单栏 */
.mobile-split {
  display: none;
}

.mobile-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.mobile-body > * {
  flex: 1;
}

.mobile-nav {
  display: flex;
  border-top: 1px solid var(--border);
  background: var(--bg-raised);
  padding-bottom: env(safe-area-inset-bottom);
}

.nav-item {
  flex: 1;
  border: none;
  border-radius: 0;
  background: none;
  padding: 10px 4px;
  font-size: 13px;
  position: relative;
  color: var(--text-dim);
}

.nav-item.active {
  color: var(--accent-text);
  box-shadow: inset 0 -2px 0 var(--accent);
}

.nav-item .dot {
  position: absolute;
  top: 6px;
  right: 22%;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}

@media (max-width: 860px) {
  .preview-entry { order: 10; flex: 1 0 100%; display: flex; justify-content: flex-end; }
  .preview-entry :deep(.lab-entry) { width: 100%; justify-content: center; }
  .save-hint { display: none; }
  .editor-topbar { gap: 8px !important; padding: 10px 12px !important; }
  .editor-topbar .title { font-size: 13px; }
  .desktop-split { display: none; }
  .mobile-split {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
  }
}
</style>
