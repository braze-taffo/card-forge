// 测试连接和创作共用地址规则，完整接口地址不会再次追加 /v1。
export function customApiUrls(baseUrl) {
  const input = String(baseUrl || '').trim()
  if (!input) throw new Error('Base URL 不能为空')
  let url
  try {
    url = new URL(input)
  } catch {
    throw new Error('Base URL 必须是完整网址，例如 https://api.example.com/v1')
  }
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname) {
    throw new Error('Base URL 必须使用 http:// 或 https://')
  }
  let path = url.pathname.replace(/\/+$/, '')
  const endpoint = /\/(?:chat\/completions|models)$/
  if (endpoint.test(path)) {
    path = path.replace(endpoint, '')
  } else if (!/\/v\d+(?:beta\d*)?(?:\/openai)?$/.test(path) && !/\/openai$/.test(path)) {
    // 保留已有的主机地址、代理前缀自动补 /v1 的行为。
    path += '/v1'
  }
  url.hash = ''
  url.pathname = `${path}/chat/completions`
  const chat = url.href
  url.pathname = `${path}/models`
  return { chat, models: url.href }
}
