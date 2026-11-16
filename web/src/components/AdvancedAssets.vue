<script setup>
import { computed } from 'vue'
import { state, send, QUICK_ACTIONS } from '../store.js'
import { S, fmt } from '../lib/strings.js'
import AppIcon from './AppIcon.vue'

const session = () => state.current

// 与工具箱一致的读取口径：advancedExtensions 优先，其次来源卡 data.extensions。
function extensionsOf(target) {
  if (target.advancedExtensions && Object.keys(target.advancedExtensions).length > 0) return target.advancedExtensions
  const data = target.originalCard && typeof target.originalCard.data === 'object' ? target.originalCard.data : null
  const ext = data && typeof data.extensions === 'object' && data.extensions !== null ? data.extensions : null
  return ext && !Array.isArray(ext) ? ext : {}
}

const helper = computed(() => {
  const ext = extensionsOf(session() ?? {})
  return ext.tavern_helper && typeof ext.tavern_helper === 'object' && !Array.isArray(ext.tavern_helper) ? ext.tavern_helper : null
})

const scripts = computed(() => (Array.isArray(helper.value?.scripts) ? helper.value.scripts : [])
  .filter((s) => s && typeof s === 'object'))

const regexes = computed(() => {
  const list = extensionsOf(session() ?? {}).regex_scripts
  return Array.isArray(list) ? list.filter((r) => r && typeof r === 'object') : []
})

const variables = computed(() => {
  const raw = helper.value?.variables
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return Object.keys(raw)
  if (Array.isArray(raw)) return raw.map((pair) => (Array.isArray(pair) ? pair[0] : null)).filter((k) => typeof k === 'string')
  return []
})
</script>

<template>
  <div class="assets">
    <h3 class="panel-heading"><AppIcon name="layers" />{{ fmt(S.assetsSummary, scripts.length, regexes.length, variables.length) }}</h3>
    <p class="muted">{{ S.assetsHint }}</p>
    <button :disabled="state.busy" @click="send(QUICK_ACTIONS.checkAssets)">{{ S.btnCheckAssets }}</button>
    <div v-for="(script, i) in scripts" :key="'s' + i" class="muted line">
      {{ fmt(S.scriptLine, script.name ?? '', script.enabled ? S.enabled : S.disabled, (script.content ?? '').length) }}
    </div>
    <div v-for="(regex, i) in regexes" :key="'r' + i" class="muted line">
      {{ fmt(S.regexLine, regex.scriptName ?? '') }}
    </div>
    <div v-if="variables.length > 0" class="muted line">{{ fmt(S.variablesLine, variables.join('、')) }}</div>
  </div>
</template>

<style scoped>
.assets {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  overflow-y: auto;
  height: 100%;
}

.assets h3 {
  margin: 0;
}

.line {
  font-size: 13px;
}
</style>
