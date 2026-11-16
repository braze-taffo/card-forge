import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const script = fileURLToPath(new URL('./relay-analytics.py', import.meta.url))

export function createRelayAnalytics(config) {
  const cache = new Map()
  return async (period) => {
    if (!config.relayDatabase) return { available: false, message: '本环境未配置中转站账本' }
    if (!['today', '7d', '30d', 'all'].includes(period)) throw new Error('统计时间范围无效')
    const cached = cache.get(period)
    if (cached && Date.now() - cached.at < 10000) return cached.value
    const value = await new Promise((resolve) => {
      execFile(config.analyticsPython || 'python3', [script, '--db', config.relayDatabase, '--period', period, '--timezone', config.quotaTimezone],
        { timeout: 8000, maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout) => {
          if (error) { resolve({ available: false, message: '中转站账本暂时无法读取，请检查服务端数据库路径和读取权限。' }); return }
          try { resolve(JSON.parse(stdout)) } catch { resolve({ available: false, message: '中转站账本返回格式无效' }) }
        })
    })
    cache.set(period, { at: Date.now(), value })
    return value
  }
}
