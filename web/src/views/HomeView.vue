<script setup>
import { ref } from 'vue'
import { state, start, open, deleteDraft, importFile } from '../store.js'
import { S, fmt } from '../lib/strings.js'
import AppIcon from '../components/AppIcon.vue'
import TellevCard from '../components/TellevCard.vue'

const pendingDelete = ref(null)
const importMode = ref('card') // card | worldbook-source
const fileInput = ref(null)

function sessionName(summary) {
  return summary.cardName || summary.worldName ||
    (summary.kind === 'Character' ? S.unnamedCharacter : S.unnamedWorldbook)
}

async function onImportFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  try {
    await importFile(file, importMode.value === 'worldbook-source')
  } catch (e) {
    state.error = e.message
  }
}
</script>

<template>
  <div class="home">
    <div class="home-opening">
    <section class="intro">
      <span class="eyebrow">一间小小的创作工坊</span>
      <h1>把灵感，<br class="mobile-break" />写成故事。</h1>
      <p class="muted">从一个想法开始，和 AI 一起勾勒角色，构建世界。</p>
      <span class="intro-stroke" aria-hidden="true"></span>
    </section>
    <TellevCard />
    </div>

    <section class="start-grid">
      <button class="start-card" :disabled="state.busy" @click="start('Character')">
        <span class="start-top"><span class="icon character-icon"><AppIcon name="card" /></span><span class="card-index">01 / CHARACTER</span></span>
        <span class="title">{{ S.newCharacter }}</span>
        <span class="desc">{{ S.newCharacterDesc }}</span>
        <span class="start-link">赋予一个角色生命<AppIcon name="arrow" /></span>
      </button>
      <button class="start-card" :disabled="state.busy" @click="start('WorldBook')">
        <span class="start-top"><span class="icon world-icon"><AppIcon name="book" /></span><span class="card-index">02 / WORLDBOOK</span></span>
        <span class="title">{{ S.newWorldbook }}</span>
        <span class="desc">{{ S.newWorldbookDesc }}</span>
        <span class="start-link">展开一个新的世界<AppIcon name="arrow" /></span>
      </button>
    </section>

    <section class="import-row card">
      <input ref="fileInput" type="file" accept=".json,.png,application/json,image/png" style="display:none" @change="onImportFile" />
      <div class="import-heading"><AppIcon name="upload" /><div><strong>接着已有的灵感写</strong><p class="muted import-hint">{{ S.importCardHint }}</p></div></div>
      <div class="import-controls">
        <div class="segmented import-buttons" aria-label="导入方式">
          <button :class="{ active: importMode === 'card' }" :aria-pressed="importMode === 'card'" @click="importMode = 'card'">编辑角色卡</button>
          <button :class="{ active: importMode === 'worldbook-source' }" :aria-pressed="importMode === 'worldbook-source'" @click="importMode = 'worldbook-source'">提炼世界书</button>
        </div>
        <button :disabled="state.busy" @click="fileInput.click()"><AppIcon name="upload" />{{ S.importCard }}</button>
      </div>
    </section>

    <section class="drafts">
      <div class="drafts-heading"><h2>{{ S.draftsTitle }} <span class="count">{{ state.sessions.length }}</span></h2><span class="muted">灵感随时续写</span></div>
      <div v-if="state.error" class="banner error">{{ state.error }}</div>
      <div v-if="state.info" class="banner info">{{ state.info }}</div>
      <div v-if="state.sessions.length === 0" class="empty"><AppIcon name="folder" /><strong>故事的第一页，等你来写</strong><p class="muted">新建角色或世界书，你的草稿会保存在这里。</p></div>
      <div
        v-for="summary in state.sessions"
        :key="summary.id"
        class="draft-row"
        :class="{ disabled: state.busy }"
      >
        <button class="draft-open" :disabled="state.busy" @click="open(summary.id)">
          <span class="draft-icon"><AppIcon :name="summary.kind === 'Character' ? 'card' : 'book'" /></span>
          <span class="draft-main">
            <span class="draft-name">{{ sessionName(summary) }}</span>
            <span class="muted">
              {{ fmt(S.sessionMeta, summary.kind === 'Character' ? S.kindCharacter : S.kindWorldbook, summary.turnsCount, summary.loreCount) }}
            </span>
            <span v-if="summary.sourceLength > 0" class="muted">
              {{ fmt(S.sourceExtractedShort, summary.sourceCursor, summary.sourceLength) }}
            </span>
          </span>
          <AppIcon name="arrow" />
        </button>
        <button
          class="danger"
          :disabled="state.busy"
          :aria-label="'删除草稿：' + sessionName(summary)"
          @click.stop="pendingDelete = summary"
        ><AppIcon name="trash" /></button>
      </div>
    </section>

    <div v-if="pendingDelete" class="modal-backdrop" @click.self="pendingDelete = null">
      <div class="modal card" role="dialog" aria-modal="true" aria-labelledby="delete-title" @keydown.esc="pendingDelete = null">
        <h3 id="delete-title">{{ S.deleteDraftTitle }}</h3>
        <p>{{ fmt(S.deleteDraftBody, sessionName(pendingDelete)) }}</p>
        <div class="modal-actions">
          <button class="danger" :disabled="state.busy" @click="deleteDraft(pendingDelete.id); pendingDelete = null">{{ S.delete }}</button>
          <button autofocus @click="pendingDelete = null">{{ S.cancel }}</button>
        </div>
      </div>
    </div>
    <footer class="home-footer"><span>每个世界，都从一点灵感开始。</span><span>CARD FORGE · 创作工坊</span></footer>
  </div>
</template>

<style scoped>
.home { max-width: 1000px; width: 100%; margin: 0 auto; padding: 56px 28px 24px; }
.home-opening { display: flex; align-items: flex-start; justify-content: space-between; gap: 30px; margin-bottom: 40px; }
.home-opening > .tellev-card { flex-shrink: 0; margin-top: 7px; }
.intro { position: relative; min-width: 0; }
.intro h1 { font-size: clamp(32px, 4vw, 46px); font-weight: 700; line-height: 1.4; letter-spacing: 1px; margin: 12px 0 14px; }
.intro p { font-size: 16px; margin: 0; }
.intro-stroke { display: block; width: 56px; height: 4px; margin-top: 22px; border-top: 2px solid #b78360; border-radius: 50%; transform: rotate(-3deg); }
.mobile-break { display: none; }
.start-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; margin-bottom: 24px; }
.start-card { text-align: left; align-items: stretch; display: flex; flex-direction: column; background: #fff9; border: 1px solid #d7ddd3; border-radius: 18px 21px 16px 22px; padding: 28px; min-height: 238px; box-shadow: 0 4px 24px #28362f03; }
.start-card:hover:not(:disabled) { background: #fffffff0; border-color: #9eae9b; transform: translateY(-3px); box-shadow: var(--shadow); }
.start-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.icon { display: inline-flex; align-items: center; justify-content: center; width: 54px; height: 54px; border-radius: 16px 13px 18px 12px; }
.icon .app-icon { width: 34px; height: 34px; stroke-width: 1.35; }
.character-icon { background: #f6eee5; color: #926644; transform: rotate(-4deg); }
.world-icon { background: #eaf0e7; color: #5a7457; transform: rotate(3deg); }
.card-index { font-size: 10px; letter-spacing: 1.7px; color: #858c80; }
.start-card .title { font-size: 23px; font-weight: 700; }
.start-card .desc { font-size: 14px; color: var(--text-dim); }
.start-link { display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--border); margin-top: 16px; padding-top: 14px; font-size: 13px; color: var(--accent); }
.import-row { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 22px 24px; margin-bottom: 42px; background: #fff7; }
.import-heading { display: flex; align-items: center; gap: 16px; }
.import-heading > .app-icon { width: 24px; height: 24px; color: var(--text-dim); }
.import-heading strong { font-size: 15px; }
.import-hint { font-size: 11px; margin: 4px 0 0; }
.import-controls { display: flex; align-items: center; gap: 12px; }
.import-controls > button { font-size: 12px; white-space: nowrap; }
.drafts-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
.drafts h2 { font-size: 20px; margin: 0; display: flex; align-items: center; gap: 10px; }
.count { font-size: 12px; color: var(--text-dim); background: #e9ede5; border-radius: 50%; min-width: 23px; text-align: center; }
.empty { padding: 30px 16px; text-align: center; border: 1px dashed #cbd3c7; border-radius: 15px; background: #ffffff40; display: flex; flex-direction: column; align-items: center; gap: 7px; }
.empty > .app-icon { width: 30px; height: 30px; color: #8d9d86; margin-bottom: 3px; }
.empty strong { font-weight: 400; font-size: 15px; }
.empty p { margin: 0; font-size: 12px; }
.draft-row { display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--border); padding: 8px 0; }
.draft-open { flex: 1; min-width: 0; border: none; background: transparent; justify-content: flex-start; text-align: left; padding: 14px 8px; gap: 15px; }
.draft-icon { background: #eef0e9; color: var(--accent); border-radius: 10px; padding: 10px; display: flex; }
.draft-main { flex: 1; min-width: 0; }
.draft-main .muted { display: block; font-size: 12px; }
.draft-name { display: block; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.draft-row > .danger { background: transparent; border: none; padding: 10px; }
.home-footer { margin-top: 40px; padding-top: 18px; border-top: 1px solid var(--border); display: flex; justify-content: space-between; gap: 12px; color: #818a7b; font-size: 11px; }
.modal-backdrop { position: fixed; inset: 0; background: #28362f40; backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 16px; }
.modal { max-width: 440px; width: 100%; background: #fcfcf8; box-shadow: var(--shadow); }
.modal h3 { margin-top: 0; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
@media (max-width: 920px) { .import-row { align-items: flex-start; flex-direction: column; } .import-controls { width: 100%; justify-content: space-between; } }
@media (max-width: 640px) {
  .home { padding: 32px 20px 22px; }
  .home-opening { flex-direction: column; gap: 28px; margin-bottom: 28px; }
  .home-opening > .tellev-card { order: -1; margin-top: 0; }
  .intro h1 { font-size: 36px; }
  .intro p { font-size: 14px; max-width: 280px; }
  .mobile-break { display: block; }
  .start-grid { grid-template-columns: 1fr; gap: 14px; }
  .start-card { padding: 22px; min-height: 210px; }
  .import-row { padding: 18px; margin-bottom: 30px; }
  .import-controls { flex-direction: column; align-items: stretch; gap: 12px; }
  .import-controls > button { align-self: flex-start; }
  .home-footer { flex-direction: column; gap: 4px; }
}
</style>
