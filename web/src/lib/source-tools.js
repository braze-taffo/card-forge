// 聊天按需读取本地原文；工具结果只携带有限片段，不把整本书放进上下文。
function integer(args, key, fallback, min, max = Number.MAX_SAFE_INTEGER) {
  const value = args[key] ?? fallback
  if (!Number.isSafeInteger(value) || value < min) throw new Error(`${key} 必须是大于等于 ${min} 的整数`)
  return Math.min(value, max)
}

export async function executeSourceTool(call, session, readSource) {
  const name = call.name
  try {
    const args = call.arguments ?? {}
    const offset = integer(args, 'offset', 0, 0)
    const limit = name === 'read_source'
      ? integer(args, 'limit', 4000, 1, 7000)
      : integer(args, 'limit', 5, 1, 10)
    const keyword = typeof args.keyword === 'string' ? args.keyword.trim() : ''
    if (name === 'search_source' && keyword === '') throw new Error('keyword 不能为空')
    const source = await readSource?.()
    if (typeof source !== 'string') throw new Error('原文不存在，请重新导入。')
    if (offset > source.length) throw new Error('offset 超过原文长度')
    const metadata = { source_name: session.sourceName || '', total_length: source.length }
    if (name === 'read_source') {
      const end = Math.min(source.length, offset + limit)
      return { ok: true, name, payload: { ...metadata, start: offset, end,
        text: source.slice(offset, end), next_offset: end < source.length ? end : null } }
    }
    const matches = []
    let found = source.indexOf(keyword, offset)
    let nextOffset = null
    while (found !== -1 && matches.length < limit) {
      const start = Math.max(0, found - 150)
      const end = Math.min(source.length, found + 150)
      matches.push({ offset: found, start, end, text: source.slice(start, end) })
      nextOffset = found + 1
      found = source.indexOf(keyword, nextOffset)
    }
    return { ok: true, name, payload: { ...metadata, matches,
      next_offset: found === -1 ? null : nextOffset } }
  } catch (e) {
    if (e.name === 'AbortError') throw e
    return { ok: false, name, payload: { error: e.message } }
  }
}
