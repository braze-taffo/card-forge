// 锻卡炉后端：静态托管 web/dist + 免费模型 SSE 代理 + 每 IP 限流与每日额度。
// Node >= 18。免费模型经本站代理；自带密钥可直连同机中转站或外部供应商。
// 同机中转站历史用量由只读账本查询提供，部署环境需要 Python 3。
import http from 'node:http'
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { loadConfig } from './config.mjs'
import { selectFreeModel } from './free-models.mjs'
import { createAdmin } from './admin.mjs'
import { createAnalytics, UsageObserver } from './analytics.mjs'
import { isIP } from 'node:net'
import { createRelayAnalytics } from './relay-analytics.mjs'
import { createLab } from './lab.mjs'
import { createWebSearch } from './web-search.mjs'

const config = loadConfig()
const admin = createAdmin(config)
const analytics = createAnalytics(config)
const relayAnalytics = createRelayAnalytics(config)
const lab = createLab(config, { readBody, sendJson, clientIp })
const handleWebSearch = createWebSearch(config, { readBody, sendJson, clientIp,
  rateLimitGate, dailyQuotaGate, reserveDailyQuota, consumeDailyQuota })

if (!config.freeBaseUrl || !config.freeApiKey || !config.freeModel) {
  console.warn('[card-forge] 未配置免费模型（FREE_BASE_URL / FREE_API_KEY / FREE_MODEL），'
    + '/api/v1/chat/completions 将返回 503。静态站点与自带密钥模式不受影响。')
}

// ---------------------------------------------------------------- 限流与额度

/** 每 IP 滑动窗口（毫秒时间戳）。内存态，重启即清。 */
const minuteWindow = new Map()
const pendingDaily = new Map()
const quotaKey = (ip, model) => model ? JSON.stringify([model.id, ip]) : ip
/** 每 IP 每日计数：{ '2026-10-06': Map<ip, count> }，落盘到 data/quota.json。 */
const quotaFile = join(config.dataDir, 'quota.json')

function loadQuota() {
  try {
    return JSON.parse(readFileSync(quotaFile, 'utf8'))
  } catch {
    return {}
  }
}
const dailyQuota = loadQuota()

function todayKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.quotaTimezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

let quotaDirty = false
function persistQuota() {
  if (!quotaDirty) return
  quotaDirty = false
  try {
    mkdirSync(config.dataDir, { recursive: true })
    writeFileSync(quotaFile, JSON.stringify(dailyQuota), 'utf8')
  } catch (e) {
    console.error('[card-forge] 额度落盘失败:', e.message)
  }
}
setInterval(persistQuota, 30_000).unref()
process.on('SIGTERM', () => { persistQuota(); analytics.flush(); process.exit(0) })
process.on('SIGINT', () => { persistQuota(); analytics.flush(); process.exit(0) })

// 只保留今天的计数，避免文件无限增长。
function ensureTodayBucket() {
  const key = todayKey()
  if (dailyQuota[key] && typeof dailyQuota === 'object') {
    for (const day of Object.keys(dailyQuota)) {
      if (day !== key) delete dailyQuota[day]
    }
    if (typeof dailyQuota[key] !== 'object' || dailyQuota[key] === null) dailyQuota[key] = {}
    return
  }
  for (const day of Object.keys(dailyQuota)) delete dailyQuota[day]
  dailyQuota[key] = {}
}

function clientIp(req) {
  const normalizeIp = (value) => {
    const ip = typeof value === 'string' ? value.trim().replace(/^::ffff:/i, '') : ''
    if (!isIP(ip)) return ''
    return isIP(ip) === 6 ? new URL(`http://[${ip}]/`).hostname.slice(1, -1) : ip
  }
  if (config.trustProxy) {
    // 本站 nginx 覆盖 X-Real-IP。XFF 后备取最后一跳，避免客户端伪造首项。
    const forwarded = req.headers['x-forwarded-for']
    const ip = normalizeIp(req.headers['x-real-ip']) || normalizeIp(typeof forwarded === 'string' ? forwarded.split(',').at(-1) : '')
    if (ip) return ip
  }
  return normalizeIp(req.socket.remoteAddress) || 'unknown'
}

function rateLimitGate(ip, model) {
  const key = quotaKey(ip, model)
  const limit = model?.ratePerMinute ?? config.ratePerMinute
  const now = Date.now()
  const window = (minuteWindow.get(key) || []).filter((t) => now - t < 60_000)
  if (window.length >= limit) {
    return { ok: false, status: 429, retryAfter: Math.ceil((60_000 - (now - window[0])) / 1000),
      message: `${model?.name || '免费模型'}请求过于频繁：每 IP 每分钟最多 ${limit} 次，请 ${Math.ceil((60_000 - (now - window[0])) / 1000)} 秒后再试。` }
  }
  window.push(now)
  minuteWindow.set(key, window)
  if (minuteWindow.size > 10_000) {
    for (const [key, list] of minuteWindow) {
      if (list.every((t) => now - t >= 60_000)) minuteWindow.delete(key)
    }
  }
  return { ok: true }
}

function dailyQuotaGate(ip, model) {
  ensureTodayBucket()
  const key = quotaKey(ip, model)
  const used = dailyQuota[todayKey()][key] || 0
  const limit = model?.dailyRequestsPerIp ?? config.dailyRequestsPerIp
  if (used + (pendingDaily.get(key) || 0) >= limit) {
    return { ok: false, status: 429, message: `${model?.name || '免费模型'}今日免费额度已用完（每 IP 每天 ${limit} 次请求）。你可以切换其他模型或使用自己的 API，草稿不受影响。` }
  }
  return { ok: true, used }
}

function consumeDailyQuota(ip, model) {
  ensureTodayBucket()
  const key = quotaKey(ip, model)
  dailyQuota[todayKey()][key] = (dailyQuota[todayKey()][key] || 0) + 1
  quotaDirty = true
}

function reserveDailyQuota(ip, model) {
  const key = quotaKey(ip, model)
  pendingDaily.set(key, (pendingDaily.get(key) || 0) + 1)
  let reserved = true
  return () => {
    if (!reserved) return
    reserved = false
    const remaining = (pendingDaily.get(key) || 1) - 1
    if (remaining) pendingDaily.set(key, remaining)
    else pendingDaily.delete(key)
  }
}

// ---------------------------------------------------------------- 工具函数

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
}

function sendJson(res, status, body, extraHeaders = {}) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  })
  res.end(text)
}

function readBody(req, limit) {
  return new Promise((resolveBody, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > limit) {
        reject(Object.assign(new Error('请求体过大'), { statusCode: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolveBody(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// ---------------------------------------------------------------- 路由

async function handleChatCompletions(req, res) {
  if (!config.freeBaseUrl || !config.freeApiKey || !admin.enabledModels().length) {
    sendJson(res, 503, { error: { message: '本站尚未配置免费模型；请在设置里使用自己的 API 密钥。' } })
    return
  }
  const ip = clientIp(req)

  let payload
  try {
    const body = await readBody(req, 24 * 1024 * 1024)
    payload = JSON.parse(body.toString('utf8'))
  } catch (e) {
    sendJson(res, e.statusCode || 400, { error: { message: '请求体不是合法 JSON' } })
    return
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.messages)) {
    sendJson(res, 400, { error: { message: '缺少 messages 数组' } })
    return
  }

  const selectedModel = selectFreeModel(admin.enabledModels(), payload.model)
  if (!selectedModel) {
    sendJson(res, 400, { error: { message: '请选择本站提供的免费模型。' } })
    return
  }
  const rate = rateLimitGate(ip, selectedModel)
  if (!rate.ok) {
    analytics.request(ip, selectedModel.id, true)
    sendJson(res, rate.status, { error: { message: rate.message } }, { 'Retry-After': String(rate.retryAfter || 60) })
    return
  }
  const quota = dailyQuotaGate(ip, selectedModel)
  if (!quota.ok) {
    analytics.request(ip, selectedModel.id, true)
    sendJson(res, quota.status, { error: { message: quota.message } })
    return
  }
  // 用户只能选择服务端列出的模型；密钥和输出上限始终由服务端控制。
  const upstream = {
    model: selectedModel.id,
    messages: payload.messages,
    stream: true,
    stream_options: { include_usage: true },
  }
  if (typeof payload.temperature === 'number') upstream.temperature = payload.temperature
  if (Array.isArray(payload.tools) && payload.tools.length > 0) {
    upstream.tools = payload.tools
    upstream.tool_choice = payload.tool_choice || 'auto'
  }
  const requestedMax = typeof payload.max_tokens === 'number' ? payload.max_tokens : config.freeMaxOutputTokens
  upstream.max_tokens = Math.max(256, Math.min(Math.floor(requestedMax), config.freeMaxOutputTokens))

  analytics.request(ip, selectedModel.id)
  const callId = analytics.startCall(ip, selectedModel.id)
  const observer = new UsageObserver()
  const controller = new AbortController()
  let disconnected = false
  let outcome = 'failed'
  const onClose = () => { if (!res.writableFinished) { disconnected = true; controller.abort() } }
  res.on('close', onClose)
  const releaseReservation = reserveDailyQuota(ip, selectedModel)
  try {
    const upstreamRes = await fetch(joinUrl(config.freeBaseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.freeApiKey}`,
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(upstream),
      signal: controller.signal,
    })
    if (!upstreamRes.ok || !upstreamRes.body) {
      const errText = await upstreamRes.text().catch(() => '')
      let message = `免费模型网关返回 ${upstreamRes.status}`
      try {
        const parsed = JSON.parse(errText)
        if (parsed?.error?.message) message = parsed.error.message
      } catch { /* 保留默认信息 */ }
      sendJson(res, upstreamRes.status === 401 || upstreamRes.status === 403 ? 502 : upstreamRes.status,
        { error: { message } })
      return
    }

    consumeDailyQuota(ip, selectedModel)
    releaseReservation()
    const remaining = Math.max(0, selectedModel.dailyRequestsPerIp - dailyQuota[todayKey()][quotaKey(ip, selectedModel)])
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Quota-Remaining': String(remaining),
    })
    // 保持原始 SSE 字节透传，用量解析仅在旁路观察，不保存对话内容。
    for await (const chunk of upstreamRes.body) {
      observer.push(chunk)
      if (res.destroyed) { disconnected = true; controller.abort(); break }
      res.write(chunk)
    }
    observer.finish()
    outcome = observer.error ? 'failed' : (observer.done || observer.finished) ? 'succeeded' : 'interrupted'
    res.end()
  } catch (e) {
    outcome = disconnected ? 'interrupted' : 'failed'
    if (!res.destroyed && !res.writableEnded) {
      if (res.headersSent) res.destroy()
      else sendJson(res, 502, { error: { message: `无法连接免费模型网关：${e.message}` } })
    }
  } finally {
    releaseReservation()
    res.off('close', onClose)
    observer.finish()
    analytics.finishCall(callId, disconnected ? 'interrupted' : outcome, observer.usage)
  }
}

function joinUrl(base, path) {
  const trimmed = String(base || '').trim().replace(/\/+$/, '')
  if (!trimmed) return path
  if (/\/v\d+$/.test(trimmed)) return trimmed + path
  return trimmed + '/v1' + path
}

function handleConfig(req, res) {
  sendJson(res, 200, {
    freeModelAvailable: Boolean(config.freeBaseUrl && config.freeApiKey && admin.enabledModels().length),
    freeDisplayName: config.freeDisplayName,
    freeModels: admin.enabledModels(),
    quotaTimezone: config.quotaTimezone,
    dailyRequestsPerIp: admin.enabledModels()[0]?.dailyRequestsPerIp ?? config.dailyRequestsPerIp,
    ratePerMinute: admin.enabledModels()[0]?.ratePerMinute ?? config.ratePerMinute,
    accessCodeRequired: config.accessCode !== '',
    labAvailable: lab.enabled,
    webSearchAvailable: Boolean(config.deepseekApiKey),
    webSearchRatePerMinute: config.webSearchRatePerMinute,
    webSearchDailyRequestsPerIp: config.webSearchDailyRequestsPerIp,
  })
}

function serveStatic(req, res, pathname) {
  let relative = decodeURIComponent(pathname)
  if (relative.includes('..')) {
    sendJson(res, 400, { error: { message: '非法路径' } })
    return
  }
  const base = normalize(config.staticDir)
  let filePath = normalize(join(base, relative))
  if (!filePath.startsWith(base)) {
    sendJson(res, 400, { error: { message: '非法路径' } })
    return
  }
  if (relative === '/index.html') {
    // 直接请求首页：走下方静态分支
  } else if (extname(relative) !== '') {
    // 带扩展名：存在即返回，缺失即 404（不吞掉坏掉的资源引用）。
    if (!existsSync(filePath) || !statOrNull(filePath)?.isFile()) {
      sendJson(res, 404, { error: { message: 'Not Found' } })
      return
    }
  } else {
    // 不带扩展名的路径：SPA 回退到 index.html。
    filePath = join(base, 'index.html')
  }
  if (!existsSync(filePath) || !statOrNull(filePath)?.isFile()) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('web/dist 尚未构建：请先在 web/ 目录执行 npm run build，或用 npm run dev 开发。')
    return
  }
  const mime = MIME[extname(filePath)] || 'application/octet-stream'
  const isHashedAsset = /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(filePath)
  res.writeHead(200, {
    'Content-Type': mime,
    'Cache-Control': isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  if (mime.startsWith('text/html') && !/^\/admin(?:\/|$)/.test(pathname)) analytics.visit(clientIp(req))
  const stream = createReadStream(filePath)
  stream.on('error', () => {
    if (!res.writableEnded) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('读取文件失败')
    }
  })
  stream.pipe(res)
}

function statOrNull(path) {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

async function handleAdmin(req, res, pathname) {
  const secure = Boolean(req.socket.encrypted || (config.trustProxy && req.headers['x-forwarded-proto'] === 'https'))
  const origin = `${secure ? 'https' : 'http'}://${req.headers.host}`
  if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== origin) {
    sendJson(res, 403, { error: { message: '请在本站后台操作' } })
    return
  }
  const cookie = `Path=/api/admin; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`
  if (pathname === '/api/admin/login' && req.method === 'POST') {
    let body
    try { body = JSON.parse((await readBody(req, 16384)).toString('utf8')) } catch {
      sendJson(res, 400, { error: { message: '登录信息格式无效' } })
      return
    }
    const result = admin.login(body?.username, body?.password, clientIp(req))
    if (result.status !== 200) sendJson(res, result.status, { error: { message: result.error } })
    else sendJson(res, 200, result.session, { 'Set-Cookie': `cardforge_admin=${result.token}; ${cookie}; Max-Age=43200` })
    return
  }
  const session = admin.session(req.headers.cookie)
  if (!session) {
    sendJson(res, 401, { error: { message: '请先登录后台' } })
    return
  }
  if (pathname === '/api/admin/session' && req.method === 'GET') {
    sendJson(res, 200, session)
    return
  }
  if (pathname === '/api/admin/analytics' && req.method === 'GET') {
    const query = new URL(req.url, 'http://localhost').searchParams
    try {
      const period = query.get('period') || 'today'
      const report = analytics.snapshot({ period, search: query.get('search') || '', page: query.get('page') || 1 })
      report.relay = await relayAnalytics(period)
      sendJson(res, 200, report)
    } catch (error) { sendJson(res, 400, { error: { message: error.message } }) }
    return
  }
  if (pathname === '/api/admin/logout' && req.method === 'POST') {
    admin.logout(req.headers.cookie)
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': `cardforge_admin=; ${cookie}; Max-Age=0` })
    return
  }
  if (pathname === '/api/admin/settings') {
    if (req.method === 'PUT') {
      try {
        const body = JSON.parse((await readBody(req, 65536)).toString('utf8'))
        admin.saveModels(body.models)
      } catch (error) {
        sendJson(res, 400, { error: { message: error.message } })
        return
      }
    } else if (req.method !== 'GET') {
      sendJson(res, 405, { error: { message: 'Method Not Allowed' } })
      return
    }
    const models = admin.models().map((model) => {
      let requestsToday = 0
      for (const [key, count] of Object.entries(dailyQuota[todayKey()] || {})) {
        try { if (JSON.parse(key)?.[0] === model.id) requestsToday += count } catch { /* legacy shared quota */ }
      }
      return { ...model, requestsToday }
    })
    sendJson(res, 200, { models, day: todayKey(), quotaTimezone: config.quotaTimezone })
    return
  }
  sendJson(res, 404, { error: { message: 'Unknown admin API' } })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (lab.isBrowserHost(req)) { await lab.handleBrowser(req, res, url); return }
  const pathname = url.pathname
  try {
    if (pathname.startsWith('/api/')) {
      if (pathname.startsWith('/api/admin/')) {
        await handleAdmin(req, res, pathname)
        return
      }
      if (config.accessCode !== '' && req.headers['x-access-code'] !== config.accessCode) {
        sendJson(res, 401, { error: { message: '访问码不正确' } })
        return
      }
      if (pathname.startsWith('/api/lab/')) {
        await lab.handle(req, res, url)
        return
      }
      if (pathname === '/api/v1/chat/completions' && req.method === 'POST') {
        await handleChatCompletions(req, res)
        return
      }
      if (pathname === '/api/tools/web-search' && req.method === 'POST') {
        await handleWebSearch(req, res)
        return
      }
      if (pathname === '/api/config' && req.method === 'GET') {
        handleConfig(req, res)
        return
      }
      sendJson(res, 404, { error: { message: 'Unknown API' } })
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: { message: 'Method Not Allowed' } })
      return
    }
    serveStatic(req, res, pathname === '/' ? '/index.html' : pathname)
  } catch (e) {
    console.error('[card-forge] 请求处理异常:', e)
    if (!res.writableEnded) sendJson(res, 500, { error: { message: '服务器内部错误' } })
  }
})

// 仅直接运行（node index.mjs）时启动监听；被测试导入时不启动。
import { pathToFileURL } from 'node:url'
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isMain) {
  server.listen(config.port, config.host, () => {
    console.log(`[card-forge] listening on http://${config.host}:${config.port}`)
    console.log(`[card-forge] 静态目录: ${config.staticDir}`)
    console.log(`[card-forge] 免费模型: ${config.freeModel || '(未配置)'} · 每 IP ${config.ratePerMinute}/分钟 · 每日 ${config.dailyRequestsPerIp} 次`)
  })
}

export { joinUrl, rateLimitGate, dailyQuotaGate, consumeDailyQuota, todayKey, dailyQuota, clientIp, loadQuota }
