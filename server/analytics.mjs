import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FIELDS = ['visits', 'requests', 'calls', 'succeeded', 'failed', 'interrupted', 'blocked', 'usageReported', 'usageMissing', 'promptTokens', 'completionTokens', 'totalTokens', 'reasoningTokens', 'cachedTokens']
const empty = () => Object.fromEntries(FIELDS.map((key) => [key, 0]))
const bucket = () => ({ ...empty(), models: {}, ips: {} })
const own = (obj, key, factory) => {
  if (!Object.hasOwn(obj, key)) Object.defineProperty(obj, key, { value: factory(), enumerable: true, writable: true, configurable: true })
  return obj[key]
}
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null

export function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null
  const prompt = count(usage.prompt_tokens)
  const completion = count(usage.completion_tokens)
  const total = count(usage.total_tokens) ?? (prompt !== null && completion !== null ? prompt + completion : null)
  if (total === null) return null
  return { promptTokens: prompt ?? 0, completionTokens: completion ?? 0, totalTokens: total,
    reasoningTokens: count(usage.completion_tokens_details?.reasoning_tokens) ?? 0,
    cachedTokens: count(usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens) ?? 0 }
}

// 旁路观察 SSE，原始字节仍由代理直接发送。用量是每次请求的最终累计值，不能逐片相加。
export class UsageObserver {
  constructor() { this.decoder = new TextDecoder(); this.buffer = ''; this.lines = []; this.usage = null; this.done = false; this.finished = false; this.error = false; this.overflow = false }
  push(bytes) { this.consume(this.decoder.decode(bytes, { stream: true })) }
  consume(text) {
    this.buffer += text
    let end
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end).replace(/\r$/, '')
      this.buffer = this.buffer.slice(end + 1)
      if (line === '') { this.event(); continue }
      if (line.startsWith('data:') && !this.overflow) {
        this.lines.push(line.slice(5).replace(/^ /, ''))
        if (this.lines.reduce((size, item) => size + item.length, 0) > 2_000_000) { this.lines = []; this.overflow = true }
      }
    }
    if (this.buffer.length > 2_000_000) { this.buffer = ''; this.overflow = true }
  }
  event() {
    const text = this.lines.join('\n').trim()
    this.lines = []
    if (this.overflow) { this.overflow = false; return }
    if (text === '[DONE]') { this.done = true; return }
    if (!text) return
    try {
      const event = JSON.parse(text)
      const usage = normalizeUsage(event.usage)
      if (usage) this.usage = usage
      if (event.error) this.error = true
      if (event.choices?.some((choice) => choice.finish_reason != null)) this.finished = true
    } catch { /* 非 JSON 心跳或不完整数据不作为用量。 */ }
  }
  finish() {
    this.consume(this.decoder.decode())
    if (this.buffer) { if (this.buffer.startsWith('data:')) this.lines.push(this.buffer.slice(5).trimStart()); this.buffer = '' }
    this.event()
  }
}

export function createAnalytics({ dataDir, quotaTimezone = 'Asia/Singapore' }, { now = () => Date.now(), flushDelay = 1000 } = {}) {
  const path = join(dataDir, 'analytics.json')
  const formatDay = new Intl.DateTimeFormat('en-CA', { timeZone: quotaTimezone, year: 'numeric', month: '2-digit', day: '2-digit' })
  const dayAt = (time) => formatDay.format(new Date(time))
  const loaded = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
  if (loaded && (loaded.version !== 1 || !loaded.totals || !loaded.days || !loaded.pending)) throw new Error('统计文件格式不正确，已保留原文件')
  const data = loaded || { version: 1, startedAt: now(), updatedAt: now(), totals: bucket(), days: {}, pending: {} }
  let dirty = !loaded
  let timer = null
  let storageError = ''
  function flush() {
    clearTimeout(timer); timer = null
    if (!dirty) return
    try {
      mkdirSync(dataDir, { recursive: true, mode: 0o700 })
      writeFileSync(path + '.pending', JSON.stringify(data), { mode: 0o600 })
      renameSync(path + '.pending', path)
      dirty = false; storageError = ''
    } catch (error) { storageError = '统计数据尚未落盘：' + error.message; console.error('[card-forge]', storageError) }
  }
  function changed() {
    dirty = true; data.updatedAt = now()
    if (!timer) timer = setTimeout(flush, flushDelay).unref()
  }
  function ipBucket(scope, ip, time) {
    const item = own(scope.ips, ip, () => ({ ...empty(), firstSeen: time, lastSeen: time, models: {} }))
    item.lastSeen = Math.max(item.lastSeen, time)
    return item
  }
  function add(ip, model, changes, day = dayAt(now())) {
    const time = now()
    const daily = own(data.days, day, bucket)
    for (const scope of [data.totals, daily]) {
      const item = ipBucket(scope, ip, time)
      const targets = [scope, item]
      if (model) targets.push(own(scope.models, model, empty), own(item.models, model, empty))
      for (const target of targets) for (const [key, value] of Object.entries(changes)) target[key] += value
    }
    // 保留最近 90 天的日期明细；累计汇总与每 IP 总数一直保留。
    const oldest = dayAt(time - 90 * 86400_000)
    for (const key of Object.keys(data.days)) if (key < oldest && !Object.values(data.pending).some((call) => call.day === key)) delete data.days[key]
    changed()
  }
  function finishCall(id, outcome, usage = null) {
    const pending = data.pending[id]
    if (!pending) return
    if (!['succeeded', 'failed', 'interrupted'].includes(outcome)) throw new Error('未知调用状态')
    const changes = { [outcome]: 1, usageReported: usage ? 1 : 0, usageMissing: usage ? 0 : 1, ...(usage || {}) }
    add(pending.ip, pending.model, changes, pending.day)
    delete data.pending[id]
    changed()
  }
  // 重启时未完成的调用计为中断，不假装成功或把未知用量补成零。
  for (const id of Object.keys(data.pending)) finishCall(id, 'interrupted')
  flush()
  return {
    visit(ip) { add(ip, '', { visits: 1 }) },
    request(ip, model, blocked = false) { add(ip, model, { requests: 1, ...(blocked ? { blocked: 1 } : {}) }) },
    startCall(ip, model) {
      const id = randomUUID(); const day = dayAt(now())
      data.pending[id] = { ip, model, day, startedAt: now() }
      add(ip, model, { calls: 1 }, day)
      return id
    },
    finishCall,
    flush,
    snapshot({ period = 'today', search = '', page = 1, pageSize = 25 } = {}) {
      if (!['today', '7d', '30d', 'all'].includes(period)) throw new Error('统计时间范围无效')
      const today = dayAt(now())
      const first = dayAt(now() - (period === '7d' ? 6 : period === '30d' ? 29 : 0) * 86400_000)
      let scope = data.totals
      if (period !== 'all') {
        scope = bucket()
        for (const [day, daily] of Object.entries(data.days)) {
          if (day < first || day > today) continue
          for (const key of FIELDS) scope[key] += daily[key]
          for (const [model, value] of Object.entries(daily.models)) {
            const aggregate = own(scope.models, model, empty)
            for (const key of FIELDS) aggregate[key] += value[key]
          }
          for (const [ip, value] of Object.entries(daily.ips)) {
            const aggregate = ipBucket(scope, ip, value.lastSeen)
            aggregate.firstSeen = Math.min(aggregate.firstSeen, value.firstSeen)
            for (const key of FIELDS) aggregate[key] += value[key]
            for (const [model, metrics] of Object.entries(value.models)) {
              const m = own(aggregate.models, model, empty)
              for (const key of FIELDS) m[key] += metrics[key]
            }
          }
        }
      }
      const summary = Object.fromEntries(FIELDS.map((key) => [key, scope[key]]))
      summary.uniqueVisitors = Object.values(scope.ips).filter((ip) => ip.visits > 0).length
      summary.uniqueCallerIps = Object.values(scope.ips).filter((ip) => ip.calls > 0).length
      summary.inFlight = Object.values(data.pending).filter((call) => period === 'all' || (call.day >= first && call.day <= today)).length
      const keyword = String(search).trim().slice(0, 100).toLowerCase()
      const rows = Object.entries(scope.ips).filter(([ip]) => ip.toLowerCase().includes(keyword)).sort((a, b) => b[1].lastSeen - a[1].lastSeen || a[0].localeCompare(b[0]))
      const limit = Math.max(1, Math.min(100, Math.trunc(Number(pageSize)) || 25))
      const pageCount = Math.max(1, Math.ceil(rows.length / limit))
      const currentPage = Math.max(1, Math.min(pageCount, Math.trunc(Number(page)) || 1))
      return { startedAt: data.startedAt, updatedAt: data.updatedAt, storageError, day: today, timezone: quotaTimezone, period,
        summary, models: Object.entries(scope.models).map(([id, metrics]) => ({ id, ...metrics })),
        ips: rows.slice((currentPage - 1) * limit, currentPage * limit).map(([ip, metrics]) => ({ ip, ...metrics })),
        pagination: { page: currentPage, pageSize: limit, total: rows.length, pageCount } }
    },
  }
}
