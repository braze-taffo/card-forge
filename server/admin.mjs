import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function atomicJson(path, value) {
  const temporary = path + '.pending'
  writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
  renameSync(temporary, path)
}

export function validatePolicies(entries, baseline, defaults) {
  if (!Array.isArray(entries) || entries.length !== baseline.length) throw new Error('请保留完整的模型列表')
  const seen = new Set()
  return entries.map((entry) => {
    if (!baseline.some((model) => model.id === entry?.id) || seen.has(entry.id)) throw new Error('模型列表包含未知或重复型号')
    seen.add(entry.id)
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    if (!name || name.length > 80) throw new Error('模型名称需要 1–80 个字符')
    const rate = entry.ratePerMinute ?? defaults.ratePerMinute
    const daily = entry.dailyRequestsPerIp ?? defaults.dailyRequestsPerIp
    if (!Number.isInteger(rate) || rate < 1 || rate > 10000) throw new Error('每分钟额度需要是 1–10000 的整数')
    if (!Number.isInteger(daily) || daily < 1 || daily > 1000000) throw new Error('每日额度需要是 1–1000000 的整数')
    if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') throw new Error('模型开关格式无效')
    return { id: entry.id, name, enabled: entry.enabled !== false, ratePerMinute: rate, dailyRequestsPerIp: daily }
  })
}

export function createAdmin(config) {
  const policiesPath = join(config.dataDir, 'model-settings.json')
  const authPath = join(config.dataDir, 'admin-auth.json')
  const defaults = { ratePerMinute: config.ratePerMinute, dailyRequestsPerIp: config.dailyRequestsPerIp }
  let policies = validatePolicies(config.freeModels, config.freeModels, defaults)
  if (existsSync(policiesPath)) policies = validatePolicies(JSON.parse(readFileSync(policiesPath, 'utf8')), config.freeModels, defaults)
  let auth = existsSync(authPath) ? JSON.parse(readFileSync(authPath, 'utf8')) : null
  if (!auth && config.adminCredentialsFile) {
    const credentials = JSON.parse(readFileSync(config.adminCredentialsFile, 'utf8'))
    if (typeof credentials.username !== 'string' || !credentials.username.trim() || typeof credentials.password !== 'string' || credentials.password.length < 12) {
      throw new Error('后台管理员凭据格式无效，密码至少需要 12 位')
    }
    const salt = randomBytes(32).toString('hex')
    auth = { username: credentials.username.trim(), salt, hash: scryptSync(credentials.password, salt, 64).toString('hex') }
    mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })
    atomicJson(authPath, auth)
  }
  const sessions = new Map()
  const failures = new Map()
  return {
    models: () => policies.map((model) => ({ ...model })),
    enabledModels: () => policies.filter((model) => model.enabled).map((model) => ({ ...model })),
    saveModels(entries) {
      const next = validatePolicies(entries, config.freeModels, defaults)
      mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })
      atomicJson(policiesPath, next)
      policies = next
      return this.models()
    },
    login(username, password, ip) {
      const now = Date.now()
      const recent = (failures.get(ip) || []).filter((time) => now - time < 15 * 60 * 1000)
      if (recent.length >= 5) return { status: 429, error: '登录尝试过多，请 15 分钟后再试' }
      const salt = auth?.salt || 'unconfigured-admin'
      const candidate = scryptSync(typeof password === 'string' ? password : '', salt, 64)
      const expected = auth ? Buffer.from(auth.hash, 'hex') : Buffer.alloc(64)
      const valid = timingSafeEqual(candidate, expected) && auth && username === auth.username
      if (!valid) {
        recent.push(now)
        failures.set(ip, recent)
        if (failures.size > 10000) for (const [key, times] of failures) if (times.every((time) => now - time >= 15 * 60 * 1000)) failures.delete(key)
        return { status: 401, error: '账号或密码不正确' }
      }
      failures.delete(ip)
      for (const [token, session] of sessions) if (session.expiresAt <= now) sessions.delete(token)
      const token = randomBytes(32).toString('hex')
      const session = { username: auth.username, expiresAt: now + 12 * 60 * 60 * 1000 }
      sessions.set(token, session)
      return { status: 200, token, session }
    },
    session(cookie) {
      const token = /(?:^|;\s*)cardforge_admin=([a-f0-9]{64})(?:;|$)/.exec(cookie || '')?.[1]
      const session = token && sessions.get(token)
      if (!session || session.expiresAt <= Date.now()) {
        if (token) sessions.delete(token)
        return null
      }
      return { ...session }
    },
    logout(cookie) {
      const token = /(?:^|;\s*)cardforge_admin=([a-f0-9]{64})(?:;|$)/.exec(cookie || '')?.[1]
      if (token) sessions.delete(token)
    },
  }
}
