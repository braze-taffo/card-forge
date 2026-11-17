// 配置读取：环境变量 > server/config.json > 默认值。
// 密钥只放在 config.json（已 gitignore）或环境变量里，永不下发给前端。
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeFreeModels } from './free-models.mjs'

const here = dirname(fileURLToPath(import.meta.url))

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

const fileConfig = readJsonFile(resolve(here, 'config.json'))

function pick(envName, fileValue, fallback) {
  const env = process.env[envName]
  if (env !== undefined && env !== '') return env
  if (fileValue !== undefined && fileValue !== null && fileValue !== '') return fileValue
  return fallback
}

function pickInt(envName, fileValue, fallback) {
  const raw = pick(envName, fileValue, fallback)
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

export function loadConfig() {
  const freeModels = normalizeFreeModels(
    pick('FREE_MODELS', fileConfig.freeModels, undefined),
    pick('FREE_MODEL', fileConfig.freeModel, ''),
    pick('FREE_DISPLAY_NAME', fileConfig.freeDisplayName, '站内免费模型'),
  )
  return {
    port: pickInt('PORT', fileConfig.port, 8787),
    host: pick('HOST', fileConfig.host, '127.0.0.1'),
    // 免费模型上游（OpenAI 兼容网关，例如 New API）。
    freeBaseUrl: pick('FREE_BASE_URL', fileConfig.freeBaseUrl, ''),
    freeApiKey: pick('FREE_API_KEY', fileConfig.freeApiKey, ''),
    // 全局联网搜索使用独立的 DeepSeek 官方密钥，与创作模型通道无关。
    deepseekApiKey: pick('DEEPSEEK_API_KEY', fileConfig.deepseekApiKey, ''),
    webSearchRatePerMinute: pickInt('WEB_SEARCH_RATE_PER_MINUTE', fileConfig.webSearchRatePerMinute, 20),
    webSearchDailyRequestsPerIp: pickInt('WEB_SEARCH_DAILY_REQUESTS_PER_IP', fileConfig.webSearchDailyRequestsPerIp, 30),
    freeModel: freeModels[0]?.id || '',
    freeModels,
    freeDisplayName: pick('FREE_DISPLAY_NAME', fileConfig.freeDisplayName, '站内免费模型'),
    // 免费通道单次请求允许的最大输出 token（转发时截断 max_tokens）。
    freeMaxOutputTokens: pickInt('FREE_MAX_OUTPUT_TOKENS', fileConfig.freeMaxOutputTokens, 32768),
    // 防滥用：每 IP 每分钟请求数 与 每日请求总额度。
    ratePerMinute: pickInt('RATE_PER_MINUTE', fileConfig.ratePerMinute, 6),
    dailyRequestsPerIp: pickInt('DAILY_REQUESTS_PER_IP', fileConfig.dailyRequestsPerIp, 30),
    // 可选访问码；留空表示公开。设置后前端需带 X-Access-Code 请求 /api。
    accessCode: pick('ACCESS_CODE', fileConfig.accessCode, ''),
    adminCredentialsFile: pick('ADMIN_CREDENTIALS_FILE', fileConfig.adminCredentialsFile, ''),
    relayDatabase: pick('RELAY_ANALYTICS_DB', fileConfig.relayDatabase, ''),
    analyticsPython: pick('ANALYTICS_PYTHON', fileConfig.analyticsPython, 'python3'),
    labControlUrl: pick('LAB_CONTROL_URL', fileConfig.labControlUrl, ''),
    labControlToken: pick('LAB_CONTROL_TOKEN', fileConfig.labControlToken, ''),
    labEmbedOrigin: pick('LAB_EMBED_ORIGIN', fileConfig.labEmbedOrigin, ''),
    labStaticDir: pick('LAB_STATIC_DIR', fileConfig.labStaticDir, ''),
    quotaTimezone: pick('QUOTA_TIMEZONE', fileConfig.quotaTimezone, 'Asia/Singapore'),
    // nginx 反代后按 X-Forwarded-For 取真实 IP。
    trustProxy: pick('TRUST_PROXY', fileConfig.trustProxy, 'true') === 'true',
    dataDir: resolve(here, pick('DATA_DIR', fileConfig.dataDir, 'data')),
    staticDir: resolve(here, '..', 'web', 'dist'),
  }
}
