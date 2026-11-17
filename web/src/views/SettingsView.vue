<script setup>
import { ref, watch, computed, onMounted } from 'vue'
import { state, navigate, saveSettings, setAccessCode, loadServerConfig, showInfo, showError } from '../store.js'
import { S, fmt } from '../lib/strings.js'
import AppIcon from '../components/AppIcon.vue'
import { customApiUrls } from '../lib/api-urls.js'

const mode = ref(state.settings.channelMode)
const baseUrl = ref(state.settings.customBaseUrl)
const apiKey = ref(state.settings.customApiKey)
const model = ref(state.settings.customModel)
const freeModel = ref(state.settings.freeModel || state.serverConfig.freeModels?.[0]?.id || '')
const selectedFreeModel = computed(() => state.serverConfig.freeModels?.find((entry) => entry.id === freeModel.value) || state.serverConfig.freeModels?.[0])
onMounted(() => loadServerConfig())
watch(() => state.serverConfig.freeModels, (models) => {
  if (!models?.some((entry) => entry.id === freeModel.value)) freeModel.value = models?.[0]?.id || ''
}, { immediate: true })
const accessCode = ref(localStorage.getItem('cardforge.accessCode') || '')
const testing = ref(false)

function save() {
  saveSettings({
    channelMode: mode.value,
    customBaseUrl: baseUrl.value.trim(),
    customApiKey: apiKey.value.trim(),
    customModel: model.value.trim(),
    freeModel: freeModel.value,
  })
  if (accessCode.value !== (localStorage.getItem('cardforge.accessCode') || '')) {
    setAccessCode(accessCode.value.trim())
    loadServerConfig()
  }
  showInfo(S.settingsSaved)
}

async function testConnection() {
  testing.value = true
  try {
    if (mode.value === 'free') {
      await loadServerConfig()
      if (state.serverConfig.freeModelAvailable) {
        showInfo(fmt(S.testOk, state.serverConfig.freeDisplayName || '站内免费模型'))
      } else {
        showError(S.freeUnavailable)
      }
      return
    }
    const url = customApiUrls(baseUrl.value).models
    const response = await fetch(url, {
      headers: apiKey.value.trim() ? { Authorization: `Bearer ${apiKey.value.trim()}` } : {},
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const data = await response.json()
    const count = Array.isArray(data?.data) ? data.data.length : 0
    showInfo(fmt(S.testOk, `可访问，${count} 个模型`))
  } catch (e) {
    showError(fmt(S.testFailed, e.message))
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <div class="settings">
    <button class="link settings-back" @click="navigate(state.current ? 'editor' : 'home')"><AppIcon name="back" />返回{{ state.current ? '编辑器' : '创作空间' }}</button>
    <div class="settings-intro"><span class="eyebrow">让灵感接上线</span><h1>{{ S.settingsTitle }}</h1><p class="muted">选择适合你的模型，开始下一段创作。</p></div>
    <div v-if="state.error" class="banner error" role="alert">{{ state.error }}</div>
    <div v-if="state.info" class="banner info" role="status">{{ state.info }}</div>
    <div class="card">
      <h3><AppIcon name="layers" />{{ S.channelTitle }}</h3>
      <div class="mode-row">
        <button class="chip" :class="{ active: mode === 'free' }" :aria-pressed="mode === 'free'" :disabled="!state.serverConfig.freeModelAvailable" @click="mode = 'free'">
          {{ S.channelFree }}{{ state.serverConfig.freeModelAvailable ? '' : '（不可用）' }}
        </button>
        <button class="chip" :class="{ active: mode === 'custom' }" :aria-pressed="mode === 'custom'" @click="mode = 'custom'">{{ S.channelCustom }}</button>
      </div>
      <p v-if="state.serverConfig.freeModelAvailable" class="muted">
        {{ fmt(S.freeQuotaHint, selectedFreeModel?.dailyRequestsPerIp ?? state.serverConfig.dailyRequestsPerIp, selectedFreeModel?.ratePerMinute ?? state.serverConfig.ratePerMinute) }}
        <span v-if="state.serverConfig.freeModels?.length > 1">各模型额度分别计算。</span>
      </p>
      <p v-else class="muted">{{ S.freeUnavailable }}</p>

      <label v-if="mode === 'free' && state.serverConfig.freeModels?.length" class="field">
        <span>选择免费创作模型</span>
        <select v-model="freeModel">
          <option v-for="entry in state.serverConfig.freeModels" :key="entry.id" :value="entry.id">{{ entry.name }}</option>
        </select>
      </label>

      <template v-if="mode === 'custom'">
        <label class="field"><span>{{ S.customBaseUrl }}</span>
          <input v-model="baseUrl" type="text" placeholder="https://api.example.com/v1" />
        </label>
        <p class="muted">可填写基础地址，也可直接粘贴完整的 /chat/completions 地址。</p>
        <label class="field"><span>{{ S.customApiKey }}</span>
          <input v-model="apiKey" type="password" autocomplete="off" placeholder="sk-..." />
        </label>
        <label class="field"><span>{{ S.customModel }}</span>
          <input v-model="model" type="text" placeholder="例如 glm-4.7 / deepseek-chat / ..." />
        </label>
        <p class="muted privacy">{{ S.privacyHint }}</p>
      </template>

      <p class="muted" role="status">
        联网搜索：{{ state.serverConfig.webSearchAvailable ? '可用，agent 可按需搜索参考资料' : '暂不可用，等待管理员配置' }}。
        自带 API 和站内免费模型均可使用。
        <span v-if="state.serverConfig.webSearchAvailable">每 IP 每分钟 {{ state.serverConfig.webSearchRatePerMinute }} 次，每日 {{ state.serverConfig.webSearchDailyRequestsPerIp }} 次，与创作模型额度分别计算。</span>
      </p>

      <label v-if="state.serverConfig.accessCodeRequired" class="field">
        <span>访问码</span>
        <input v-model="accessCode" type="password" autocomplete="off" />
      </label>

      <div class="actions">
        <button class="primary" @click="save"><AppIcon name="check" />{{ S.saveSettings }}</button>
        <button :disabled="testing" @click="testConnection">{{ testing ? '正在测试…' : S.testConnection }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings {
  max-width: 620px;
  width: 100%;
  margin: 0 auto;
  padding: 20px 16px 48px;
}

.settings h3 {
  margin: 0 0 10px;
}

.mode-row {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.privacy {
  border-left: 3px solid var(--accent);
  padding-left: 10px;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}
</style>
