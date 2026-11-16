// 服务端单元测试：URL 拼接、限流窗口、每日额度。
import test from 'node:test'
import assert from 'node:assert/strict'
import { joinUrl, rateLimitGate, dailyQuotaGate, consumeDailyQuota, todayKey, dailyQuota } from './index.mjs'

test('joinUrl：/v1 去重', () => {
  assert.equal(joinUrl('https://gw.example.com', '/chat/completions'), 'https://gw.example.com/v1/chat/completions')
  assert.equal(joinUrl('https://gw.example.com/v1', '/chat/completions'), 'https://gw.example.com/v1/chat/completions')
  assert.equal(joinUrl('https://gw.example.com/v2/', '/chat/completions'), 'https://gw.example.com/v2/chat/completions')
})

test('rateLimitGate：窗口内超过限值拒绝', () => {
  const ip = `test-rate-${Math.random()}`
  for (let i = 0; i < 3; i++) {
    assert.equal(rateLimitGate(ip).ok, true)
  }
  // 默认限值 6：第 4-6 次仍应通过
  assert.equal(rateLimitGate(ip).ok, true)
  assert.equal(rateLimitGate(ip).ok, true)
  assert.equal(rateLimitGate(ip).ok, true)
  const blocked = rateLimitGate(ip)
  assert.equal(blocked.ok, false)
  assert.equal(blocked.status, 429)
})

test('dailyQuotaGate / consumeDailyQuota', () => {
  const ip = `test-quota-${Math.random()}`
  consumeDailyQuota(ip)
  consumeDailyQuota(ip)
  const gate = dailyQuotaGate(ip)
  assert.equal(gate.ok, true)
  assert.equal(gate.used, 2)
  // 直接操纵当日桶验证上限
  dailyQuota[todayKey()][ip] = 30
  const blocked = dailyQuotaGate(ip)
  assert.equal(blocked.ok, false)
  assert.match(blocked.message, /免费额度已用完/)
  delete dailyQuota[todayKey()][ip]
})

test('同一 IP 的 Step 与 DeepSeek 分别限流和计数', () => {
  const ip = `per-model-${Math.random()}`
  const step = { id: 'step-test', name: 'Step', ratePerMinute: 2, dailyRequestsPerIp: 2 }
  const deepseek = { id: 'deepseek-test', name: 'DeepSeek', ratePerMinute: 1, dailyRequestsPerIp: 1 }
  assert.equal(rateLimitGate(ip, step).ok, true)
  assert.equal(rateLimitGate(ip, step).ok, true)
  assert.equal(rateLimitGate(ip, step).ok, false)
  assert.equal(rateLimitGate(ip, deepseek).ok, true)
  assert.equal(rateLimitGate(ip, deepseek).ok, false)
  consumeDailyQuota(ip, step)
  consumeDailyQuota(ip, step)
  assert.equal(dailyQuotaGate(ip, step).ok, false)
  assert.equal(dailyQuotaGate(ip, deepseek).used, 0)
  consumeDailyQuota(ip, deepseek)
  assert.equal(dailyQuotaGate(ip, deepseek).ok, false)
  for (const model of [step, deepseek]) delete dailyQuota[todayKey()][JSON.stringify([model.id, ip])]
})
