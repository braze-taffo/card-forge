// 两种创作模型通道都走同一站内搜索接口，不携带创作模型的地址或密钥。
export async function searchWeb(args, { signal, headers = {}, fetchImpl = fetch } = {}) {
  const response = await fetchImpl('/api/tools/web-search', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(args), signal,
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error?.message || `联网搜索失败（HTTP ${response.status}）`)
  if (!Array.isArray(data?.results)) throw new Error('联网搜索返回格式无效')
  return data
}

export async function executeWebSearch(call, search, signal) {
  try {
    signal?.throwIfAborted()
    if (!search) throw new Error('联网搜索当前不可用，请联系管理员配置 DeepSeek API key')
    const payload = await search(call.arguments, { signal })
    signal?.throwIfAborted()
    return { ok: true, name: 'web_search', payload }
  } catch (error) {
    signal?.throwIfAborted()
    if (error.name === 'AbortError') throw error
    return { ok: false, name: 'web_search', payload: { error: error.message || '联网搜索失败' } }
  }
}
