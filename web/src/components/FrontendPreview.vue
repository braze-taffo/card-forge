<script setup>
import { ref, watch } from 'vue'
import { state, editCard } from '../store.js'
import { S, fmt } from '../lib/strings.js'
import { portableFrontendIssues } from '../lib/models.js'
import AppIcon from './AppIcon.vue'

const local = ref('')
let timer = null

watch(() => state.current?.id, () => {
  clearTimeout(timer)
  local.value = state.current?.card?.frontendHtml ?? ''
}, { immediate: true })

watch(() => state.current?.card?.frontendHtml, (html) => {
  if (state.busy && local.value !== (html ?? '')) local.value = html ?? ''
})
watch(() => state.busy, (busy) => {
  if (!busy) local.value = state.current?.card?.frontendHtml ?? ''
})

watch(local, () => {
  clearTimeout(timer)
  if (state.busy) return
  timer = setTimeout(() => editCard({ frontendHtml: local.value }), 400)
})

const issues = () => portableFrontendIssues(local.value)

/** 裸 div 片段 → 带移动视口与清零边距的完整预览文档。 */
function wrapPreviewHtml(html) {
  return '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<style>html,body{margin:0;padding:0}</style></head><body>' + html + '</body></html>'
}
</script>

<template>
  <div class="frontend">
    <h3 class="panel-heading"><AppIcon name="code" />开场的另一种表达</h3>
    <p class="muted">{{ S.frontendHint }}</p>
    <iframe
      v-if="local.trim()"
      class="preview"
      sandbox=""
      title="开场 HTML 隔离预览"
      :srcdoc="wrapPreviewHtml(local)"
    ></iframe>
    <label class="field"><span>{{ S.fieldFrontendHtml }}</span>
      <textarea v-model="local" rows="10" :disabled="state.busy"></textarea>
    </label>
    <p v-if="issues().length > 0" class="issues">{{ fmt(S.portabilityIssues, issues().map((k) => S[k]).join('、')) }}</p>
    <p class="muted">{{ fmt(S.firstMessagePreview, state.current?.card?.firstMessage ?? '') }}</p>
  </div>
</template>

<style scoped>
.frontend {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  overflow-y: auto;
  height: 100%;
}

.preview {
  width: 100%;
  height: 56vh;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fff;
}

.issues {
  color: var(--danger);
  font-size: 13px;
  margin: 0;
}
</style>
