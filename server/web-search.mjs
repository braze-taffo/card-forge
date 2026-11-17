// DeepSeek 独立 Search API；密钥、目标地址和请求额度由服务端控制。
const SEARCH_URL = 'https://api.deepseek.com/v1/tools/search'
const clipped = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : ''

export function validateSearchRequest(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('搜索参数必须是 JSON 对象')
  const query = typeof payload.query === 'string' ? payload.query.trim() : ''
  if (!query || [...query].length > 128) throw new Error('query 必须是 1–128 个字符的搜索词')
  const count = payload.count === undefined ? 5 : payload.count
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error('count 必须是 1–10 的整数')
  return { query, count }
}

function normalizeResults(data, count) {
  if (!data || !Array.isArray(data.results)) throw new Error('搜索服务返回格式无效')
  return data.results.slice(0, count).flatMap((item) => {
    if (!item || typeof item.url !== 'string' || item.url.length > 8192) return []
    let url
    try { url = new URL(item.url) } catch { return [] }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return []
    return [{ title: clipped(item.title, 300), url: url.href,
      snippet: clipped(item.snippet, 1000), summary: clipped(item.summary, 2000),
      site_name: clipped(item.site_name, 200), date: clipped(item.date, 100) || null }]
  })
}

export function createWebSearch(config, { readBody, sendJson, clientIp, rateLimitGate,
  dailyQuotaGate, reserveDailyQuota, consumeDailyQuota, fetchImpl = fetch, timeoutMs = 30_000 }) {
  const quota = { id: '__web_search__', name: '联网搜索',
    ratePerMinute: config.webSearchRatePerMinute, dailyRequestsPerIp: config.webSearchDailyRequestsPerIp }
  return async function handleWebSearch(req, res) {
    if (!config.deepseekApiKey) {
      sendJson(res, 503, { error: { message: '联网搜索尚未配置 DeepSeek API key' } })
      return
    }
    let payload
    try { payload = validateSearchRequest(JSON.parse((await readBody(req, 4096)).toString('utf8'))) }
    catch (error) {
      sendJson(res, error.statusCode || 400, { error: { message: error instanceof SyntaxError ? '搜索参数不是合法 JSON' : error.message } })
      return
    }
    const ip = clientIp(req)
    const rate = rateLimitGate(ip, quota)
    const daily = rate.ok ? dailyQuotaGate(ip, quota) : rate
    if (!daily.ok) {
      sendJson(res, daily.status, { error: { message: rate.ok ? `今日联网搜索额度已用完（每 IP 每天 ${quota.dailyRequestsPerIp} 次）` : rate.message } },
        rate.ok ? {} : { 'Retry-After': String(rate.retryAfter || 60) })
      return
    }
    // 先预留额度，避免并发请求越过每日上限；失败或取消时释放。
    const release = reserveDailyQuota(ip, quota)
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    const onClose = () => { if (!res.writableFinished) controller.abort() }
    res.on('close', onClose)
    try {
      const upstream = await fetchImpl(SEARCH_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.deepseekApiKey}` },
        body: JSON.stringify({ ...payload, need_content: false }), signal: controller.signal,
        redirect: 'error',
      })
      if (!upstream.ok) {
        const messages = { 401: 'DeepSeek 搜索密钥无效，请联系管理员', 402: 'DeepSeek 搜索账户余额不足，请联系管理员',
          429: 'DeepSeek 搜索请求过于频繁，请稍后重试' }
        await upstream.body?.cancel()
        sendJson(res, upstream.status === 429 ? 429 : 502, { error: { message: messages[upstream.status] || `DeepSeek 搜索服务暂不可用（HTTP ${upstream.status}）` } })
        return
      }
      const results = normalizeResults(await upstream.json(), payload.count)
      controller.signal.throwIfAborted()
      if (results.length) consumeDailyQuota(ip, quota)
      sendJson(res, 200, { query: payload.query, results, retrieved_at: new Date().toISOString() })
    } catch {
      if (!res.destroyed && !res.writableEnded) sendJson(res, timedOut ? 504 : 502,
        { error: { message: timedOut ? '联网搜索超时，请稍后重试' : '联网搜索暂时失败，请稍后重试' } })
    } finally {
      clearTimeout(timer)
      res.off('close', onClose)
      release()
    }
  }
}
