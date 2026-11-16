<script setup>
import { ref, computed } from 'vue'
import { state, editWorldName, editLore, setSource, extractSource, exportWorldBook, newLoreForUi, showError } from '../store.js'
import { S, fmt } from '../lib/strings.js'
import LoreEdit from './LoreEdit.vue'
import AppIcon from './AppIcon.vue'

const pastedSource = ref('')
const expandedIds = ref(new Set())
const sourceFile = ref(null)

const session = () => state.current

const duplicateTitleCount = computed(() => {
  const groups = new Map()
  for (const lore of session()?.lore ?? []) {
    const key = (lore.title || '').trim().toLowerCase()
    if (key === '') continue
    groups.set(key, (groups.get(key) ?? 0) + 1)
  }
  let count = 0
  for (const size of groups.values()) if (size > 1) count++
  return count
})

function toggleExpand(id) {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
}

const expanded = (lore, index) => expandedIds.value.has(lore.id || String(index))

async function onImportSource(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.length > 12_000_000) throw new Error('文件超过 12 MB，请拆分；没有截断导入。')
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')
    await setSource(file.name, text)
  } catch (e) {
    if (String(e.message).includes('fatal')) showError('仅支持 UTF-8 文本；文件编码无法解码，原文未处理。')
    else showError(e.message)
  }
}

function onSavePasted() {
  setSource('粘贴原文', pastedSource.value)
  pastedSource.value = ''
}

function onExport() {
  try {
    exportWorldBook()
  } catch (e) {
    showError(fmt(S.exportFailed, e.message))
  }
}

function onAdd() {
  const entry = newLoreForUi()
  editLore((session()?.lore ?? []).length, entry)
  const next = new Set(expandedIds.value)
  next.add(entry.id)
  expandedIds.value = next
}
</script>

<template>
  <div class="worldbook">
    <div class="card header">
      <label class="field"><span>{{ S.fieldWorldbookName }}</span>
        <input :value="session()?.worldName" type="text" :disabled="state.busy" @input="editWorldName($event.target.value)" />
      </label>
      <div class="row">
        <button :disabled="state.busy" @click="onExport"><AppIcon name="download" />{{ S.exportWorldbookJson }}</button>
      </div>
      <label class="field"><span>{{ S.fieldPasteSource }}</span>
        <textarea v-model="pastedSource" rows="3" :disabled="state.busy"></textarea>
      </label>
      <div class="row">
        <button class="primary" :disabled="state.busy || !pastedSource.trim()" @click="onSavePasted">{{ S.saveSource }}</button>
        <input ref="sourceFile" type="file" accept=".txt,text/plain,text/*" style="display:none" @change="onImportSource" />
        <button :disabled="state.busy" @click="sourceFile.click()"><AppIcon name="upload" />{{ S.importTextFile }}</button>
      </div>
      <template v-if="session() && session().sourceLength > 0">
        <p class="muted">{{ fmt(S.sourceStatus, session().sourceName, session().sourceCursor, session().sourceLength) }}</p>
        <button class="primary" :disabled="state.busy || session().sourceCursor >= session().sourceLength" @click="extractSource()">
          {{ session().sourceCursor === 0 ? S.startExtract : S.continueExtract }}
        </button>
      </template>
      <div class="lore-summary">
        <strong>{{ fmt(S.loreCount, (session()?.lore ?? []).length) }}</strong>
        <button :disabled="state.busy" @click="onAdd"><AppIcon name="plus" />{{ S.addEntry }}</button>
      </div>
      <p v-if="duplicateTitleCount > 0" class="dup-warn">{{ fmt(S.duplicateTitles, duplicateTitleCount) }}</p>
    </div>

    <div v-for="(lore, index) in (session()?.lore ?? [])" :key="lore.id || String(index)" class="card lore">
      <button class="lore-head" :aria-expanded="expanded(lore, index)" @click="toggleExpand(lore.id || String(index))">
        <span class="lore-title">{{ lore.title || '（无标题）' }}</span>
        <span class="muted lore-meta">{{ lore.id }} · {{ lore.constant ? '常驻' : lore.keys.join('、') || '无关键词' }}</span>
      </button>
      <LoreEdit
        v-if="expanded(lore, index)"
        :lore="lore"
        :index="index"
        :busy="state.busy"
        @update="(entry) => editLore(index, entry)"
        @remove="editLore(index, null)"
      />
    </div>
  </div>
</template>

<style scoped>
.worldbook {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  overflow-y: auto;
  height: 100%;
}

.row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.lore-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
}

.dup-warn {
  color: var(--danger);
  font-size: 13px;
  margin: 4px 0 0;
}

.lore {
  padding: 0;
  overflow: hidden;
}

.lore-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  cursor: pointer;
}

.lore-head:hover {
  background: var(--bg-overlay);
}

.lore-title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lore-meta {
  flex-shrink: 0;
  font-size: 12px;
}
</style>
