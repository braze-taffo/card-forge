import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAnalytics, UsageObserver, normalizeUsage } from './analytics.mjs'

const usage = normalizeUsage({ prompt_tokens: 100, completion_tokens: 25, total_tokens: 125, prompt_tokens_details: { cached_tokens: 50 }, completion_tokens_details: { reasoning_tokens: 10 } })
function fixture(context) {
  const dataDir = mkdtempSync(join(tmpdir(), 'card-forge-analytics-'))
  let time = Date.parse('2026-10-07T12:00:00+08:00')
  const config = { dataDir, quotaTimezone: 'Asia/Singapore' }
  const stats = createAnalytics(config, { now: () => time, flushDelay: 60000 })
  context.after(() => { stats.flush(); rmSync(dataDir, { recursive: true, force: true }) })
  return { stats, config, clock: () => time, setTime: (value) => { time = Date.parse(value) } }
}

test('SSE 任意字节分片、UTF-8、多行 data、重复累计用量，不重复累计 token', () => {
  const observer = new UsageObserver()
  const text = ': ping\r\n\r\ndata: {"choices":[{"delta":{"content":"雾港"}}],"usage":null}\r\n\r\ndata: {"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}\n\ndata: {"choices":[],\ndata: "usage":{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13}}\n\ndata: [DONE]\n\n'
  const bytes = new TextEncoder().encode(text)
  for (const byte of bytes) observer.push(new Uint8Array([byte]))
  observer.finish()
  assert.equal(observer.usage.totalTokens, 13)
  assert.equal(observer.usage.promptTokens, 10)
  assert.equal(observer.done, true)
})

test('无用量、坏 JSON、截断和 SSE 错误不编造用量或完成状态', () => {
  const observer = new UsageObserver()
  observer.push(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"部分回复"}}]}\n\ndata: {"usage":'))
  observer.finish()
  assert.equal(observer.usage, null)
  assert.equal(observer.done, false)
  assert.equal(observer.finished, false)
  const failed = new UsageObserver()
  failed.push(new TextEncoder().encode('data: {"error":{"message":"failure"}}\n\ndata: [DONE]\n\n'))
  failed.finish()
  assert.equal(failed.error, true)
})

test('token 输入/输出求和仅在缺少 total 时使用，思考和缓存不能重复加总', () => {
  assert.equal(usage.totalTokens, 125)
  assert.equal(usage.reasoningTokens, 10)
  assert.equal(usage.cachedTokens, 50)
  assert.equal(normalizeUsage({ prompt_tokens: 4, completion_tokens: 8 }).totalTokens, 12)
  assert.equal(normalizeUsage({ total_tokens: -1 }), null)
  assert.equal(normalizeUsage({ total_tokens: '100' }), null)
})

test('按 IP 去重访问与独立模型调用累计，限流仅计请求，结束回执幂等', (context) => {
  const { stats } = fixture(context)
  stats.visit('192.0.2.1'); stats.visit('192.0.2.1'); stats.visit('192.0.2.2')
  stats.request('192.0.2.1', 'step')
  const first = stats.startCall('192.0.2.1', 'step')
  stats.finishCall(first, 'succeeded', usage)
  stats.finishCall(first, 'succeeded', usage)
  stats.request('192.0.2.1', 'deepseek')
  stats.finishCall(stats.startCall('192.0.2.1', 'deepseek'), 'failed')
  stats.request('192.0.2.1', 'step', true)
  const result = stats.snapshot({ period: 'all' })
  assert.equal(result.summary.uniqueVisitors, 2)
  assert.equal(result.summary.visits, 3)
  assert.equal(result.summary.requests, 3)
  assert.equal(result.summary.calls, 2)
  assert.equal(result.summary.blocked, 1)
  assert.equal(result.summary.totalTokens, 125)
  assert.equal(result.summary.usageMissing, 1)
  assert.equal(result.ips.find((row) => row.ip === '192.0.2.1').models.step.calls, 1)
  assert.equal(result.models.find((row) => row.id === 'deepseek').failed, 1)
})

test('已发起调用但没有页面访问的 IP 不伪装成网站访客', (context) => {
  const { stats } = fixture(context)
  stats.request('192.0.2.3', 'step')
  stats.finishCall(stats.startCall('192.0.2.3', 'step'), 'succeeded')
  const result = stats.snapshot({ period: 'all' })
  assert.equal(result.summary.uniqueVisitors, 0)
  assert.equal(result.summary.uniqueCallerIps, 1)
  assert.equal(result.summary.usageMissing, 1)
})

test('UTC+8 跨天、7/30 天和累计统计一致，跨午夜调用按发起日期归属', (context) => {
  const { stats, setTime } = fixture(context)
  setTime('2026-10-06T23:59:59+08:00')
  stats.visit('192.0.2.1')
  stats.request('192.0.2.1', 'step')
  const id = stats.startCall('192.0.2.1', 'step')
  setTime('2026-10-07T00:00:01+08:00')
  stats.finishCall(id, 'succeeded', usage)
  stats.visit('192.0.2.1'); stats.visit('192.0.2.2')
  assert.equal(stats.snapshot().summary.calls, 0)
  assert.equal(stats.snapshot().summary.visits, 2)
  assert.equal(stats.snapshot({ period: '7d' }).summary.calls, 1)
  assert.equal(stats.snapshot({ period: '30d' }).summary.uniqueVisitors, 2)
  assert.equal(stats.snapshot({ period: 'all' }).summary.visits, 3)
})

test('统计跨重启保留，进行中调用重启计中断且不重复；数据不含对话或密钥', (context) => {
  const { stats, config, clock } = fixture(context)
  stats.visit('192.0.2.1')
  stats.request('192.0.2.1', 'step')
  stats.startCall('192.0.2.1', 'step')
  stats.flush()
  const restored = createAnalytics(config, { now: clock })
  const result = restored.snapshot({ period: 'all' })
  assert.equal(result.summary.calls, 1)
  assert.equal(result.summary.interrupted, 1)
  assert.equal(result.summary.inFlight, 0)
  assert.equal(result.summary.usageMissing, 1)
  restored.flush()
  assert.equal(createAnalytics(config, { now: clock }).snapshot({ period: 'all' }).summary.interrupted, 1)
  const saved = readFileSync(join(config.dataDir, 'analytics.json'), 'utf8')
  assert.ok(!saved.includes('messages') && !saved.includes('apiKey') && !saved.includes('content'))
})

test('IP 明细搜索分页只过滤明细，不改变汇总，范围参数校验', (context) => {
  const { stats } = fixture(context)
  for (let i = 1; i <= 60; i++) stats.visit(`192.0.2.${i}`)
  const page = stats.snapshot({ period: 'all', page: 2 })
  assert.equal(page.ips.length, 25)
  assert.equal(page.pagination.total, 60)
  assert.equal(page.summary.uniqueVisitors, 60)
  assert.equal(stats.snapshot({ search: '192.0.2.60' }).ips.length, 1)
  assert.equal(stats.snapshot({ search: '192.0.2.60' }).summary.uniqueVisitors, 60)
  assert.throws(() => stats.snapshot({ period: 'invalid' }), /无效/)
})

test('90 天明细清理不会丢失累计访客与模型调用', (context) => {
  const { stats, setTime } = fixture(context)
  stats.visit('192.0.2.1')
  stats.request('192.0.2.1', 'step')
  stats.finishCall(stats.startCall('192.0.2.1', 'step'), 'succeeded', usage)
  setTime('2027-02-07T12:00:00+08:00')
  stats.visit('192.0.2.2')
  assert.equal(stats.snapshot({ period: 'all' }).summary.totalTokens, 125)
  assert.equal(stats.snapshot({ period: '30d' }).summary.calls, 0)
  assert.equal(stats.snapshot({ period: 'all' }).summary.uniqueVisitors, 2)
})

test('统计文件损坏时拒绝静默清空并保留原文件', (context) => {
  const { stats, config } = fixture(context)
  stats.flush()
  writeFileSync(join(config.dataDir, 'analytics.json'), 'broken-json')
  assert.throws(() => createAnalytics(config))
  assert.equal(readFileSync(join(config.dataDir, 'analytics.json'), 'utf8'), 'broken-json')
})
