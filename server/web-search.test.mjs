import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createWebSearch, validateSearchRequest } from './web-search.mjs'

function harness({ key = 'search-test-key', dailyLimit = 30, timeoutMs = 1000, fetchImpl } = {}) {
  const state = { used: 0, pending: 0, calls: 0, rateBlocked: false }
  const handle = createWebSearch({ deepseekApiKey: key, webSearchRatePerMinute: 6, webSearchDailyRequestsPerIp: dailyLimit }, {
    readBody: async (req) => Buffer.from(req.body),
    sendJson: (res, status, body, headers = {}) => { res.status = status; res.body = body; res.headers = headers; res.writableEnded = res.writableFinished = true },
    clientIp: () => '127.0.0.1',
    rateLimitGate: (_, quota) => {
      assert.equal(quota.id, '__web_search__')
      return state.rateBlocked ? { ok: false, status: 429, message: '搜索过于频繁', retryAfter: 12 } : { ok: true }
    },
    dailyQuotaGate: () => ({ ok: state.used + state.pending < dailyLimit, status: 429 }),
    reserveDailyQuota: () => { state.pending++; return () => { state.pending-- } },
    consumeDailyQuota: () => { state.used++ },
    fetchImpl: async (...args) => { state.calls++; return fetchImpl ? fetchImpl(...args) : Response.json({ results: [] }) }, timeoutMs,
  })
  const start = (payload = { query: '服饰资料' }) => {
    const req = { body: typeof payload === 'string' ? payload : JSON.stringify(payload) }
    const res = new EventEmitter()
    const done = handle(req, res)
    return { res, done }
  }
  const run = async (payload) => { const request = start(payload); await request.done; return request.res }
  return { state, start, run }
}

test('搜索参数限制字符与数量，保留站点/时间搜索语法', () => {
  assert.deepEqual(validateSearchRequest({ query: ' 城市 site:example.com after:2025 ', count: 3 }), { query: '城市 site:example.com after:2025', count: 3 })
  assert.equal(validateSearchRequest({ query: '😀'.repeat(128) }).query.length, 256)
  for (const payload of [null, [], {}, { query: ' ' }, { query: 123 }, { query: '字'.repeat(129) },
    { query: '词', count: 0 }, { query: '词', count: 11 }, { query: '词', count: 1.1 }, { query: '词', count: '5' }]) {
    assert.throws(() => validateSearchRequest(payload))
  }
})

test('服务端携带独立密钥请求官方 Search API，限制返回量和摘要长度', async () => {
  const { run, state } = harness({ fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/v1/tools/search')
    assert.equal(options.headers.Authorization, 'Bearer search-test-key')
    assert.deepEqual(JSON.parse(options.body), { query: '资料', count: 2, need_content: false })
    assert.equal(options.redirect, 'error')
    return Response.json({ results: [
      { title: '官方资料', url: 'https://example.com/source', summary: '字'.repeat(5000), snippet: '摘要', content: '忽略整页正文', date: null, site_name: '资料站' },
      { title: '错误链接', url: 'javascript:alert(1)' },
      { title: '超过请求数', url: 'https://example.com/extra' },
    ] })
  } })
  const res = await run({ query: '资料', count: 2, apiKey: 'client-ignored', url: 'https://foreign.example' })
  assert.equal(res.status, 200)
  assert.equal(res.body.results.length, 1)
  assert.equal(res.body.results[0].summary.length, 2000)
  assert.ok(!JSON.stringify(res.body).includes('search-test-key'))
  assert.ok(!JSON.stringify(res.body).includes('忽略整页正文'))
  assert.equal(res.body.results[0].date, null)
  assert.ok(res.body.retrieved_at)
  assert.equal(state.used, 1)
  assert.equal(state.pending, 0)
})

test('未配置、参数错误、分钟限流不调用上游；空结果不扣每日额度', async () => {
  const unavailable = harness({ key: '' })
  assert.equal((await unavailable.run()).status, 503)
  assert.equal(unavailable.state.calls, 0)
  const h = harness()
  for (const input of ['{invalid', {}, { query: ' ' }, { query: '字', count: 50 }]) {
    assert.equal((await h.run(input)).status, 400)
  }
  assert.equal(h.state.calls, 0)
  h.state.rateBlocked = true
  const blocked = await h.run()
  assert.equal(blocked.status, 429)
  assert.equal(blocked.headers['Retry-After'], '12')
  assert.equal(h.state.calls, 0)
  h.state.rateBlocked = false
  const empty = await h.run()
  assert.equal(empty.status, 200)
  assert.deepEqual(empty.body.results, [])
  assert.equal(h.state.used, 0)
  assert.equal(h.state.pending, 0)
})

test('并发搜索预留每日额度；完成后额度独立生效', async () => {
  let finish
  const h = harness({ dailyLimit: 1, fetchImpl: () => new Promise((resolve) => { finish = resolve }) })
  const first = h.start()
  // 让请求读完 body、进入上游等待。
  while (!finish) await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.state.pending, 1)
  assert.equal((await h.run()).status, 429)
  assert.equal(h.state.calls, 1)
  finish(Response.json({ results: [{ title: '资料', url: 'https://example.com', summary: '事实' }] }))
  await first.done
  assert.equal(h.state.pending, 0)
  assert.equal(h.state.used, 1)
  assert.equal((await h.run()).status, 429)
})

test('上游鉴权/余额/限流/服务错误返回可理解错误，不暴露上游正文，释放额度', async () => {
  for (const status of [401, 402, 429, 500]) {
    const h = harness({ fetchImpl: async () => new Response('private upstream details search-test-key', { status }) })
    const res = await h.run()
    assert.equal(res.status, status === 429 ? 429 : 502)
    assert.match(res.body.error.message, /密钥无效|余额不足|过于频繁|暂不可用/)
    assert.ok(!JSON.stringify(res.body).includes('search-test-key'))
    assert.equal(h.state.used, 0)
    assert.equal(h.state.pending, 0)
  }
  for (const fetchImpl of [async () => Response.json({}), async () => { throw new Error('secret') }]) {
    const h = harness({ fetchImpl })
    assert.equal((await h.run()).status, 502)
    assert.equal(h.state.pending, 0)
  }
})

test('搜索超时与客户端取消终止上游请求并释放预留额度', async () => {
  const waiting = (_, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  const timed = harness({ timeoutMs: 10, fetchImpl: waiting })
  assert.equal((await timed.run()).status, 504)
  assert.equal(timed.state.pending, 0)
  let upstreamSignal
  const cancelled = harness({ fetchImpl: (url, options) => { upstreamSignal = options.signal; return waiting(url, options) } })
  const request = cancelled.start()
  while (!upstreamSignal) await new Promise(resolve => setImmediate(resolve))
  request.res.destroyed = true
  request.res.emit('close')
  await request.done
  assert.ok(upstreamSignal.aborted)
  assert.equal(cancelled.state.used, 0)
  assert.equal(cancelled.state.pending, 0)
  assert.equal(request.res.status, undefined)
})
