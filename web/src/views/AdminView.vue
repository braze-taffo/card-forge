<script setup>
import { ref, onMounted } from 'vue'
import { navigate, loadServerConfig } from '../store.js'
import AppIcon from '../components/AppIcon.vue'
import AdminAnalytics from '../components/AdminAnalytics.vue'

const username = ref('admin')
const password = ref('')
const session = ref(null)
const models = ref([])
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const info = ref('')
const day = ref('')
async function request(path, options = {}) {
  const response = await fetch('/api/admin/' + path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } })
  const data = await response.json()
  if (!response.ok) {
    if (response.status === 401) session.value = null
    throw Object.assign(new Error(data.error?.message || '操作失败，请稍后重试'), { status: response.status })
  }
  return data
}
async function refresh() {
  const data = await request('settings')
  models.value = data.models
  day.value = data.day
}
onMounted(async () => {
  try { session.value = await request('session'); await refresh() }
  catch (e) { if (e.status !== 401) error.value = e.message }
  finally { loading.value = false }
})
async function login() {
  busy.value = true
  error.value = ''
  try {
    session.value = await request('login', { method: 'POST', body: JSON.stringify({ username: username.value.trim(), password: password.value }) })
    password.value = ''
    await refresh()
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}
async function save() {
  busy.value = true
  error.value = ''
  info.value = ''
  try {
    const data = await request('settings', { method: 'PUT', body: JSON.stringify({ models: models.value }) })
    models.value = data.models
    day.value = data.day
    await loadServerConfig()
    info.value = '已保存，新的模型开关和额度立即生效。'
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}
async function logout() {
  busy.value = true
  error.value = ''
  try { await request('logout', { method: 'POST' }); session.value = null; models.value = []; info.value = '' }
  catch (e) { error.value = e.message }
  finally { busy.value = false }
}
</script>

<template>
  <div class="admin-page">
    <div class="admin-top"><button class="link" @click="navigate('home')"><AppIcon name="back" />返回创作空间</button><button v-if="session" class="link" :disabled="busy" @click="logout">退出后台</button></div>
    <div class="admin-intro"><span class="eyebrow">照看这间创作工坊</span><h1>后台管理</h1><p class="muted">查看访问与模型用量，管理免费模型及额度。</p></div>
    <p v-if="loading" class="muted">正在读取后台…</p>
    <div v-if="error" class="banner error" role="alert">{{ error }}</div>
    <div v-if="info" class="banner info" role="status">{{ info }}</div>
    <AdminAnalytics v-if="!loading && session" :request="request" :models="models" />
    <form v-if="!loading && !session" class="card admin-login" @submit.prevent="login">
      <h2><AppIcon name="shield" />管理员登录</h2>
      <label class="field"><span>管理员账号</span><input v-model="username" type="text" autocomplete="username" required :disabled="busy" /></label>
      <label class="field"><span>管理员密码</span><input v-model="password" type="password" autocomplete="current-password" required :disabled="busy" /></label>
      <button class="primary" :disabled="busy || !username.trim() || !password">{{ busy ? '正在登录…' : '登录后台' }}</button>
    </form>
    <form v-else-if="!loading && session" @submit.prevent="save">
      <div class="admin-summary"><span>{{ session.username }} · 已登录</span><span>{{ day }} · 今日用量</span></div>
      <section v-for="model in models" :key="model.id" class="card admin-model">
        <div class="admin-model-head"><div><h2>{{ model.name }}</h2><span class="model-id">{{ model.id }}</span></div><label class="admin-switch"><input v-model="model.enabled" type="checkbox" :disabled="busy" /><span>{{ model.enabled ? '提供免费服务' : '已停用' }}</span></label></div>
        <div class="admin-fields">
          <label class="field"><span>显示名称</span><input v-model="model.name" type="text" maxlength="80" required :disabled="busy" /></label>
          <label class="field"><span>每 IP 每分钟请求上限</span><input v-model.number="model.ratePerMinute" type="number" min="1" max="10000" step="1" required :disabled="busy" /></label>
          <label class="field"><span>每 IP 每日请求上限</span><input v-model.number="model.dailyRequestsPerIp" type="number" min="1" max="1000000" step="1" required :disabled="busy" /></label>
        </div>
        <p class="admin-usage"><AppIcon name="chat" />今日累计请求 <strong>{{ model.requestsToday }}</strong><span class="muted">两个模型的额度分别计算</span></p>
      </section>
      <div class="admin-actions"><p class="muted">每日额度于 00:00（UTC+8）重置。停用模型不会删除已有草稿。</p><button class="primary" :disabled="busy"><AppIcon name="check" />{{ busy ? '正在保存…' : '保存并立即生效' }}</button></div>
    </form>
  </div>
</template>

<style scoped>
.admin-page { width: 100%; max-width: 1000px; margin: 0 auto; padding: 28px 24px 56px; }
.admin-top { display: flex; align-items: center; justify-content: space-between; margin-left: -10px; }
.admin-intro { margin: 28px 0; }
.admin-intro h1 { font-size: 34px; line-height: 1.4; margin: 8px 0; }
.admin-intro p { font-size: 15px; margin: 0; }
.admin-login { max-width: 440px; padding: 28px; box-shadow: var(--shadow); }
h2 { display: flex; align-items: center; gap: 10px; font-size: 20px; margin: 0 0 18px; }
.admin-login .primary { width: 100%; margin-top: 10px; }
.admin-summary { display: flex; justify-content: space-between; gap: 12px; color: var(--text-dim); font-size: 12px; margin-bottom: 18px; }
.admin-model { padding: 26px; margin-bottom: 20px; border-radius: 18px 21px 17px 20px; }
.admin-model-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid var(--border); }
.admin-model-head h2 { margin-bottom: 4px; }
.model-id { color: var(--text-dim); font-size: 12px; }
.admin-switch { display: flex; align-items: center; gap: 9px; font-size: 13px; cursor: pointer; }
.admin-switch input { width: 18px; height: 18px; }
.admin-fields { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 20px; }
.admin-usage { display: flex; align-items: center; gap: 8px; font-size: 13px; margin: 8px 0 0; }
.admin-usage .muted { margin-left: auto; font-size: 11px; }
.admin-actions { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 8px 0; }
.admin-actions p { font-size: 12px; }
@media (max-width: 720px) {
  .admin-page { padding: 20px 20px 36px; }
  .admin-intro h1 { font-size: 28px; }
  .admin-model, .admin-login { padding: 22px; }
  .admin-model-head { align-items: flex-start; flex-direction: column; }
  .admin-fields { grid-template-columns: 1fr; gap: 4px; }
  .admin-actions { align-items: stretch; flex-direction: column; gap: 4px; }
  .admin-usage { flex-wrap: wrap; }
  .admin-usage .muted { width: 100%; margin: 0; }
}
</style>
