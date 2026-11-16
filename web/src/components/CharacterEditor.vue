<script setup>
import { ref, watch } from 'vue'
import { state, editCard, exportCharacterJson, exportCharacterPng, setCoverPng, showError, showInfo } from '../store.js'
import { S, fmt } from '../lib/strings.js'
import { decodeImageAsPng, MAX_COVER_INPUT_BYTES } from '../lib/image.js'
import DraftSection from './DraftSection.vue'
import AppIcon from './AppIcon.vue'

const card = () => state.current?.card ?? {}

// 输入即时更新草稿，关联切换和导出都能取得最后一次输入。
const local = ref({
  name: '', description: '', personality: '', scenario: '', firstMessage: '',
  alternateGreetings: '', exampleMessages: '', systemPrompt: '',
  postHistoryInstructions: '', creatorNotes: '', tags: '',
})
let timer = null

watch(() => state.current?.id, () => resetLocal(), { immediate: true })
// 工具回路替换草稿时，同步可编辑字段；普通输入仍由本地态防抖保存。
watch(() => state.current?.card, () => {
  if (state.busy) resetLocal()
})
watch(() => state.busy, (busy) => {
  if (!busy) resetLocal()
})

function resetLocal() {
  clearTimeout(timer)
  const c = card()
  local.value = {
    name: c.name ?? '',
    description: c.description ?? '',
    personality: c.personality ?? '',
    scenario: c.scenario ?? '',
    firstMessage: c.firstMessage ?? '',
    alternateGreetings: (c.alternateGreetings ?? []).join('\n\n'),
    exampleMessages: c.exampleMessages ?? '',
    systemPrompt: c.systemPrompt ?? '',
    postHistoryInstructions: c.postHistoryInstructions ?? '',
    creatorNotes: c.creatorNotes ?? '',
    tags: (c.tags ?? []).join(', '),
  }
}

function queuePersist(patch) {
  editCard(patch).catch((e) => showError(e.message))
}

function onField(key, transform = (v) => v) {
  queuePersist({ [key]: transform(local.value[key]) })
}

const splitGreetings = (value) => value.split(/\n\s*\n/).map((s) => s.trim()).filter((s) => s !== '')
const splitTags = (value) => value.split(/[,，]/).map((s) => s.trim()).filter((s) => s !== '')

const coverInput = ref(null)

async function onPickCover(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.length > MAX_COVER_INPUT_BYTES) throw new Error('图片超过 12 MB，请选择较小的文件。')
    const png = await decodeImageAsPng(bytes)
    await setCoverPng(png)
  } catch (e) {
    showError(fmt(S.coverFailed, e.message))
  }
}

function onExportJson() {
  try {
    exportCharacterJson()
  } catch (e) {
    showError(fmt(S.exportFailed, e.message))
  }
}

async function onExportPng() {
  try {
    await exportCharacterPng()
  } catch (e) {
    showError(fmt(S.exportFailed, e.message))
  }
}
</script>

<template>
  <div class="editor-scroll">
    <DraftSection :title="S.sectionCover">
      <img v-if="state.coverPreviewUrl" :src="state.coverPreviewUrl" class="cover" :alt="S.coverCd" />
      <p v-else class="muted">{{ S.coverMissingHint }}</p>
      <input ref="coverInput" type="file" accept="image/*" style="display:none" @change="onPickCover" />
      <div class="row">
        <button :disabled="state.busy" @click="coverInput.click()">
          <AppIcon name="image" />
          {{ state.coverPreviewUrl ? S.coverChange : S.coverPick }}
        </button>
      </div>
      <div class="row">
        <button :disabled="state.busy" @click="onExportJson"><AppIcon name="download" />{{ S.exportJson }}</button>
        <button class="primary" :disabled="state.busy || !state.coverPreviewUrl" @click="onExportPng"><AppIcon name="download" />{{ S.exportPng }}</button>
      </div>
    </DraftSection>

    <DraftSection :title="S.sectionBasic" :initially-expanded="true">
      <label class="field"><span>{{ S.fieldName }}</span><input v-model="local.name" type="text" :disabled="state.busy" @input="onField('name')" /></label>
      <label class="field"><span>{{ S.fieldDescription }}</span><textarea v-model="local.description" rows="5" :disabled="state.busy" @input="onField('description')"></textarea></label>
      <label class="field"><span>{{ S.fieldPersonality }}</span><textarea v-model="local.personality" rows="4" :disabled="state.busy" @input="onField('personality')"></textarea></label>
      <label class="field"><span>{{ S.fieldScenario }}</span><textarea v-model="local.scenario" rows="3" :disabled="state.busy" @input="onField('scenario')"></textarea></label>
    </DraftSection>

    <DraftSection :title="S.sectionOpening">
      <label class="field"><span>{{ S.fieldFirstMessage }}</span><textarea v-model="local.firstMessage" rows="6" :disabled="state.busy" @input="onField('firstMessage')"></textarea></label>
      <label class="field"><span>{{ S.fieldAlternateGreetings }}</span><textarea v-model="local.alternateGreetings" rows="4" :disabled="state.busy" @input="onField('alternateGreetings', splitGreetings)"></textarea></label>
      <label class="field"><span>{{ S.fieldExampleMessages }}</span><textarea v-model="local.exampleMessages" rows="5" :disabled="state.busy" @input="onField('exampleMessages')"></textarea></label>
    </DraftSection>

    <DraftSection :title="S.sectionAdvanced">
      <label class="field"><span>{{ S.fieldSystemPrompt }}</span><textarea v-model="local.systemPrompt" rows="4" :disabled="state.busy" @input="onField('systemPrompt')"></textarea></label>
      <label class="field"><span>{{ S.fieldPostHistory }}</span><textarea v-model="local.postHistoryInstructions" rows="3" :disabled="state.busy" @input="onField('postHistoryInstructions')"></textarea></label>
      <label class="field"><span>{{ S.fieldCreatorNotes }}</span><textarea v-model="local.creatorNotes" rows="3" :disabled="state.busy" @input="onField('creatorNotes')"></textarea></label>
      <label class="field"><span>{{ S.fieldTags }}</span><input v-model="local.tags" type="text" :disabled="state.busy" @input="onField('tags', splitTags)" /></label>
    </DraftSection>
  </div>
</template>

<style scoped>
.editor-scroll {
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
}

.cover {
  max-width: 100%;
  max-height: 220px;
  border-radius: 8px;
  border: 1px solid var(--border);
  object-fit: contain;
}
</style>
