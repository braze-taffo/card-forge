<script setup>
import { ref, computed, onMounted } from 'vue'
import AppIcon from './AppIcon.vue'
const props = defineProps({ request: { type: Function, required: true }, models: { type: Array, default: () => [] } })
const report = ref(null)
const period = ref('all')
const search = ref('')
const busy = ref(false)
const error = ref('')
const expanded = ref('')
const relayScope = ref('site')
const n = (value) => Number(value || 0).toLocaleString('zh-CN')
const date = (value) => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: report.value?.timezone || 'Asia/Singapore', dateStyle: 'short', timeStyle: 'short', hour12: false }).format(value) : '—'
const name = (id) => props.models.find((model) => model.id === id)?.name || id
const summary = computed(() => report.value?.summary || {})
const relay = computed(() => report.value?.relay)
const relayModels = computed(() => relay.value?.[relayScope.value]?.models || [])
const cards = computed(() => [
  { label: '访问人数 · 按 IP 去重', value: summary.value.uniqueVisitors, note: `页面加载 ${n(summary.value.visits)} 次` },
  { label: '新记录 · 免费模型调用', value: summary.value.calls, note: `调用 IP ${n(summary.value.uniqueCallerIps)} 个 · 进行中 ${n(summary.value.inFlight)}` },
  { label: '新记录 · 已上报 token', value: summary.value.totalTokens, note: `输入 ${n(summary.value.promptTokens)} / 输出 ${n(summary.value.completionTokens)}` },
  { label: '已完成调用', value: summary.value.succeeded, note: `失败 ${n(summary.value.failed)} / 中断 ${n(summary.value.interrupted)}` },
])
async function load(page = 1) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    const query = new URLSearchParams({ period: period.value, search: search.value.trim(), page: String(page) })
    report.value = await props.request('analytics?' + query)
    expanded.value = ''
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}
onMounted(() => load())
</script>

<template>
  <section class="analytics" aria-labelledby="analytics-title">
    <div class="stats-heading"><div><h2 id="analytics-title"><AppIcon name="layers" />访问与模型用量</h2><p class="muted">统计从 {{ date(report?.startedAt) }} 开始 · {{ report?.timezone || 'UTC+8' }}</p></div><button :disabled="busy" @click="load(report?.pagination.page || 1)">{{ busy ? '正在读取…' : '刷新统计' }}</button></div>
    <div class="stats-controls"><label class="field"><span>统计范围</span><select v-model="period" :disabled="busy" @change="load(1)"><option value="all">累计</option><option value="today">今天</option><option value="7d">最近 7 天</option><option value="30d">最近 30 天</option></select></label><span class="muted" v-if="report">数据更新于 {{ date(report.updatedAt) }}</span></div>
    <p v-if="error" class="banner error" role="alert">{{ error }}</p>
    <p v-if="report?.storageError" class="banner error" role="alert">{{ report.storageError }}</p>
    <template v-if="report">
      <div class="stats-grid"><div v-for="item in cards" :key="item.label" class="stat-card"><span>{{ item.label }}</span><strong>{{ n(item.value) }}</strong><small>{{ item.note }}</small></div></div>
      <p class="stats-footnote">IP 去重是访客人数的近似口径，共用网络可能合并多人，换网络可能重复计数。访问统计计入网站页面加载，资源请求与后台页面不计入。</p>
      <div class="stats-status"><span>请求 {{ n(summary.requests) }}</span><span>限流拦截 {{ n(summary.blocked) }}</span><span>用量已上报 {{ n(summary.usageReported) }} 次</span><span :class="{ 'missing-usage': summary.usageMissing }">用量未上报 {{ n(summary.usageMissing) }} 次</span></div>
      <p class="stats-footnote">以上是启用统计后的站内免费模型请求，一轮创作可能调用多次；限流不计入调用次数。token 使用流中上报的实际用量，未上报部分不估算。历史用量请看下方中转站账本；自带密钥调用本机中转站也计入中转站总量。</p>
      <div class="relay-ledger" aria-labelledby="relay-title">
        <h3 id="relay-title">中转站账本 · 含历史用量</h3>
        <template v-if="relay?.available">
          <div class="relay-grid">
            <div v-for="scope in [{ id: 'site', label: '锻卡炉专用令牌' }, { id: 'total', label: '整个中转站' }]" :key="scope.id" class="ledger-card">
              <h4>{{ scope.label }}</h4>
              <template v-if="relay[scope.id]"><div class="ledger-numbers"><span>调用 <strong>{{ n(relay[scope.id].summary.calls) }}</strong></span><span>总 token <strong>{{ n(relay[scope.id].summary.totalTokens) }}</strong></span></div><p>输入 {{ n(relay[scope.id].summary.promptTokens) }} / 输出 {{ n(relay[scope.id].summary.completionTokens) }}</p></template>
              <p v-else>未找到锻卡炉专用令牌。</p>
            </div>
          </div>
          <p class="stats-footnote">按所选时间范围读取中转站现存消耗日志，最早记录 {{ date(relay.firstLogAt) }}。专用令牌用量已包含在中转站总量中，也与上方的新记录重叠，不应相加。旧账本未记录的 IP 无法补回；下方 IP 明细从本站启用统计时开始。</p>
          <label class="ledger-scope">账本模型明细<select v-model="relayScope"><option value="site">锻卡炉专用令牌</option><option value="total">整个中转站</option></select></label>
          <div v-if="relayModels.length" class="table-scroll"><table><thead><tr><th>模型</th><th>调用</th><th>输入 token</th><th>输出 token</th><th>总 token</th></tr></thead><tbody><tr v-for="model in relayModels" :key="model.id"><td>{{ name(model.id) }}</td><td>{{ n(model.calls) }}</td><td>{{ n(model.promptTokens) }}</td><td>{{ n(model.completionTokens) }}</td><td>{{ n(model.totalTokens) }}</td></tr></tbody></table></div>
          <p v-else class="stats-empty">这个范围内没有消耗记录。</p>
        </template>
        <p v-else class="stats-footnote" role="status">{{ relay?.message || '正在读取中转站账本…' }}</p>
      </div>
      <div class="stats-models" v-if="report.models.length"><h3>各模型用量</h3><div class="table-scroll"><table><thead><tr><th>模型</th><th>调用</th><th>成功 / 失败 / 中断</th><th>输入 token</th><th>输出 token</th><th>总 token</th><th>未上报用量</th></tr></thead><tbody><tr v-for="model in report.models" :key="model.id"><td>{{ name(model.id) }}</td><td>{{ n(model.calls) }}</td><td>{{ n(model.succeeded) }} / {{ n(model.failed) }} / {{ n(model.interrupted) }}</td><td>{{ n(model.promptTokens) }}</td><td>{{ n(model.completionTokens) }}</td><td>{{ n(model.totalTokens) }}</td><td>{{ n(model.usageMissing) }}</td></tr></tbody></table></div></div>
      <div class="ip-heading"><h3>IP 访问与调用明细</h3><form class="ip-search" @submit.prevent="load(1)"><input v-model="search" type="text" placeholder="搜索 IP" aria-label="搜索访问 IP" maxlength="100" :disabled="busy" /><button :disabled="busy">查询</button></form></div>
      <p v-if="!report.ips.length" class="stats-empty">{{ search.trim() ? '没有匹配的 IP。' : '这个时间范围内还没有访问或模型调用记录。' }}</p>
      <div v-else class="ip-list">
        <article v-for="ip in report.ips" :key="ip.ip" class="ip-row">
          <button class="ip-toggle" :aria-expanded="expanded === ip.ip" @click="expanded = expanded === ip.ip ? '' : ip.ip"><div class="ip-id"><strong>{{ ip.ip }}</strong><small>最近活动 {{ date(ip.lastSeen) }}</small></div><div class="ip-counts"><span>访问 <b>{{ n(ip.visits) }}</b></span><span>调用 <b>{{ n(ip.calls) }}</b></span><span>token <b>{{ n(ip.totalTokens) }}</b></span></div><AppIcon name="chevron" :class="{ rotated: expanded === ip.ip }" /></button>
          <div v-if="expanded === ip.ip" class="ip-details"><p class="muted">首次活动 {{ date(ip.firstSeen) }} · 请求 {{ n(ip.requests) }} · 限流 {{ n(ip.blocked) }} · 未上报用量 {{ n(ip.usageMissing) }}</p><p v-if="!Object.keys(ip.models).length" class="muted">此 IP 尚未调用站内模型。</p><div v-for="(model, id) in ip.models" :key="id" class="ip-model"><strong>{{ name(id) }}</strong><span>调用 {{ n(model.calls) }} · 输入 {{ n(model.promptTokens) }} / 输出 {{ n(model.completionTokens) }} · 总 token {{ n(model.totalTokens) }}</span><small>成功 {{ n(model.succeeded) }} / 失败 {{ n(model.failed) }} / 中断 {{ n(model.interrupted) }} · 限流 {{ n(model.blocked) }} · 未上报用量 {{ n(model.usageMissing) }}</small></div></div>
        </article>
      </div>
      <div class="stats-pagination"><span>共 {{ n(report.pagination.total) }} 个 IP · 第 {{ report.pagination.page }} / {{ report.pagination.pageCount }} 页</span><div><button :disabled="busy || report.pagination.page <= 1" @click="load(report.pagination.page - 1)">上一页</button><button :disabled="busy || report.pagination.page >= report.pagination.pageCount" @click="load(report.pagination.page + 1)">下一页</button></div></div>
    </template>
  </section>
</template>

<style scoped>
.analytics { margin: 30px 0 36px; padding-bottom: 28px; border-bottom: 1px solid var(--border); }
.stats-heading, .stats-controls, .ip-heading, .stats-pagination { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
h2 { display: flex; gap: 8px; align-items: center; font-size: 22px; margin: 0 0 6px; } h3 { font-size: 17px; margin: 0; }
.stats-heading p, .stats-controls > span { margin: 0; font-size: 12px; }
.stats-controls { margin: 20px 0 14px; } .stats-controls .field { margin: 0; flex-direction: row; align-items: center; gap: 12px; } select { min-width: 150px; }
.stats-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.stat-card { border: 1px solid var(--border); border-radius: 13px 16px 12px 15px; padding: 18px; background: #ffffff80; display: flex; flex-direction: column; gap: 7px; overflow-wrap: anywhere; }
.stat-card > span { font-size: 12px; color: var(--text-dim); } .stat-card > strong { font-size: 30px; color: var(--accent-text); font-variant-numeric: tabular-nums; } .stat-card small { font-size: 11px; color: var(--text-dim); }
.stats-footnote { font-size: 12px; color: var(--text-dim); line-height: 1.85; margin: 12px 0; }
.stats-status { display: flex; flex-wrap: wrap; gap: 8px 18px; font-size: 12px; padding: 12px 16px; border-radius: 10px; background: var(--accent-soft); } .missing-usage { color: #976a30; }
.stats-models { margin: 22px 0; } .table-scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; margin-top: 12px; background: #ffffff80; }
table { width: 100%; border-collapse: collapse; font-size: 12px; } th, td { padding: 12px 14px; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; } th { color: var(--text-dim); font-weight: normal; background: #eef1e780; } tr:last-child td { border-bottom: 0; }
.ip-heading { margin: 22px 0 12px; } .ip-search { display: flex; gap: 8px; } .ip-search input { max-width: 230px; }
.ip-list { border: 1px solid var(--border); border-radius: 14px; background: #ffffff70; overflow: hidden; }
.ip-row + .ip-row { border-top: 1px solid var(--border); } .ip-toggle { width: 100%; border: 0; border-radius: 0; background: transparent; display: flex; align-items: center; gap: 12px; padding: 15px 18px; text-align: left; }
.ip-id { flex: 1; min-width: 0; } .ip-id strong { display: block; overflow-wrap: anywhere; font-size: 14px; font-variant-numeric: tabular-nums; } .ip-id small { font-size: 11px; color: var(--text-dim); }
.ip-counts { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 12px; color: var(--text-dim); } .ip-counts b { color: var(--text); font-weight: normal; }
.ip-details { padding: 0 18px 18px; } .ip-details p { font-size: 12px; } .ip-model { border-top: 1px dashed var(--border); padding-top: 10px; margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 12px; } .ip-model small { width: 100%; color: var(--text-dim); }
.rotated { transform: rotate(180deg); }
.relay-ledger { margin: 22px 0; padding: 18px; border: 1px dashed var(--border); border-radius: 14px; background: #f5f6ed80; }
.relay-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }
.ledger-card { padding: 16px; background: #ffffff80; border: 1px solid var(--border); border-radius: 12px; overflow-wrap: anywhere; }
.ledger-card h4 { margin: 0 0 10px; font-size: 14px; font-weight: normal; } .ledger-card p { margin: 8px 0 0; font-size: 12px; color: var(--text-dim); }
.ledger-numbers { display: flex; flex-wrap: wrap; gap: 8px 20px; font-size: 12px; color: var(--text-dim); } .ledger-numbers strong { display: block; font-size: 23px; color: var(--accent-text); font-variant-numeric: tabular-nums; }
.ledger-scope { display: flex; gap: 12px; align-items: center; font-size: 12px; flex-wrap: wrap; } .ledger-scope select { width: auto; }
@media(max-width: 520px) { .relay-grid { grid-template-columns: 1fr; } .relay-ledger { padding: 12px; } }
.stats-empty { text-align: center; padding: 24px 12px; color: var(--text-dim); font-size: 13px; }
.stats-pagination { margin-top: 14px; color: var(--text-dim); font-size: 12px; } .stats-pagination > div { display: flex; gap: 8px; }
@media(max-width: 720px) { .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .stat-card { padding: 14px; } .stat-card > strong { font-size: 25px; } .stats-heading, .stats-controls, .ip-heading { align-items: flex-start; flex-wrap: wrap; gap: 10px; } .ip-search { width: 100%; } .ip-search input { max-width: none; } .ip-toggle { flex-wrap: wrap; } .ip-id { flex-basis: calc(100% - 35px); } .ip-counts { order: 3; width: 100%; } .stats-pagination { flex-wrap: wrap; } }
</style>
