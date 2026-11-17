// CreationToolProtocol 移植：<tool_call> 文本块 + DeepSeek DSML + 原生函数调用的解析。
// 语义与 Android 版逐条对应：括号定界、闭合标签丢失恢复、DSML 包装器尾部恢复。

export const TOOL_CALL_OPEN = '<tool_call>'
export const TOOL_CALL_CLOSE = '</tool_call>'

const COMPLETE_BLOCK_RE = /<tool_call>([\s\S]*?)<\/tool_call>/g
// 部分兼容中转会把 DSML 标签写成 <｜DSML｜tool_calls｜> 一类变体；一并归一化。
const DSML_TAG_RE = /<(\/?)[｜|]{1,2}DSML[｜|]{1,2}\s*(tool_calls|calls|invoke|parameter)([^>]*)>/g
const DSML_WRAPPER_RE = /<DSML:(?:tool_calls|calls)>([\s\S]*?)<\/DSML:(?:tool_calls|calls)>/g
const DSML_WRAPPER_OPEN_RE = /<DSML:(?:tool_calls|calls)>/
const DSML_WRAPPER_CLOSE_RE = /<\/DSML:(?:tool_calls|calls)>/
const DSML_INVOKE_RE = /<DSML:invoke([^>]*)>([\s\S]*?)<\/DSML:invoke>/g
const DSML_PARAMETER_RE = /<DSML:parameter([^>]*)>([\s\S]*?)<\/DSML:parameter>/g
const DSML_ATTRIBUTE_RE = /([A-Za-z_]+)\s*=\s*"([^"]*)"/g
const FENCE = '```'

function normalizeDsmlTags(raw) {
  return raw.replace(DSML_TAG_RE, (_, slash, name, attrs) => `<${slash}DSML:${name}${attrs}>`)
}

function completeToolRanges(body) {
  const ranges = []
  for (const m of body.matchAll(COMPLETE_BLOCK_RE)) ranges.push([m.index, m.index + m[0].length])
  for (const m of body.matchAll(DSML_WRAPPER_RE)) ranges.push([m.index, m.index + m[0].length])
  ranges.sort((a, b) => a[0] - b[0])
  return ranges
}

function removeCompleteToolBlocks(body) {
  let remainder = ''
  let cursor = 0
  for (const [start, end] of completeToolRanges(body)) {
    if (start < cursor) continue
    remainder += body.slice(cursor, start)
    cursor = end
  }
  return remainder + body.slice(cursor)
}

function firstToolStart(body) {
  const candidates = [
    body.indexOf(TOOL_CALL_OPEN),
    body.indexOf('<DSML:'),
    body.indexOf('<｜'),
    body.indexOf('<|DSML'),
  ].filter((i) => i >= 0)
  return candidates.length > 0 ? Math.min(...candidates) : body.length
}

/** 用户可见的流式文本：完整工具块以外的部分，并在第一个工具块开头截断。 */
export function proseWithoutToolBlocks(raw) {
  const remainder = removeCompleteToolBlocks(normalizeDsmlTags(raw))
  return remainder.slice(0, firstToolStart(remainder)).trim()
}

function dsmlAttributes(raw) {
  const found = [...raw.matchAll(DSML_ATTRIBUTE_RE)]
  const stripped = raw.replace(DSML_ATTRIBUTE_RE, '')
  if (stripped.trim() !== '') return null
  const names = found.map((m) => m[1])
  if (new Set(names).size !== names.length) return null
  const map = {}
  for (const m of found) map[m[1]] = m[2]
  return map
}

function parseDsmlInvoke(matchText, attrsRaw, inner) {
  const attrs = dsmlAttributes(attrsRaw)
  const name = attrs?.name && attrs.name.trim() !== '' ? attrs.name : null
  if (name === null || !attrs || Object.keys(attrs).join(',') !== 'name') {
    return { valid: false, reason: 'DSML invoke 缺少合法 name', raw: matchText }
  }
  const arguments_ = {}
  for (const param of inner.matchAll(DSML_PARAMETER_RE)) {
    const paramAttrs = dsmlAttributes(param[1])
    const key = paramAttrs?.name && paramAttrs.name.trim() !== '' ? paramAttrs.name : null
    const stringFlag = paramAttrs?.string
    const extraAttrs = Object.keys(paramAttrs || {}).filter((k) => k !== 'name' && k !== 'string')
    if (key === null || extraAttrs.length > 0 ||
      !['true', 'false'].includes(stringFlag) && stringFlag !== undefined || key in arguments_) {
      return { valid: false, reason: 'DSML parameter 属性无效或重复', raw: matchText }
    }
    let value
    if (stringFlag === 'false') {
      try {
        value = JSON.parse(param[2].trim())
      } catch {
        return { valid: false, reason: 'DSML parameter 不是合法 JSON', raw: matchText }
      }
    } else {
      value = param[2]
    }
    arguments_[key] = value
  }
  if (inner.replace(DSML_PARAMETER_RE, '').trim() !== '') {
    return { valid: false, reason: 'DSML invoke 含无法解析的内容', raw: matchText }
  }
  return { valid: true, call: { name, arguments: arguments_ } }
}

function parseDsmlWrapper(matchText, inner) {
  const invokes = [...inner.matchAll(DSML_INVOKE_RE)]
  if (invokes.length === 0) return [{ valid: false, reason: 'DSML 工具块没有完整 invoke', raw: matchText }]
  const blocks = invokes.map((m) => parseDsmlInvoke(m[0], m[1], m[2]))
  if (inner.replace(DSML_INVOKE_RE, '').trim() !== '') {
    blocks.push({ valid: false, reason: 'DSML 工具块含无法解析的内容', raw: matchText })
  }
  return blocks
}

function parseBlockBody(bodyText, reported) {
  const inner = bodyText.trim()
    .replace(/^```json/, '').replace(/^```/, '').replace(/```$/, '').trim()
  if (inner === '') return { valid: false, reason: '工具块内容为空', raw: reported }
  let root
  try {
    root = JSON.parse(inner)
  } catch {
    return { valid: false, reason: '工具块内不是合法 JSON 对象', raw: reported }
  }
  if (typeof root !== 'object' || root === null || Array.isArray(root)) {
    return { valid: false, reason: '工具块内不是合法 JSON 对象', raw: reported }
  }
  const name = typeof root.name === 'string' ? root.name : null
  if (!name || name.trim() === '') return { valid: false, reason: '缺少 name 字段', raw: reported }
  if ('arguments' in root && (typeof root.arguments !== 'object' || root.arguments === null || Array.isArray(root.arguments))) {
    return { valid: false, reason: 'arguments 必须是 JSON 对象', raw: reported }
  }
  return { valid: true, call: { name, arguments: root.arguments ?? {} } }
}

/** 跳过工具块开头标签后的空白与 ```json 围栏。 */
function skipBlockPreamble(body, from) {
  let i = from
  while (i < body.length && /\s/.test(body[i])) i++
  if (/^```json/i.test(body.slice(i))) i += FENCE.length + 4
  else if (body.startsWith(FENCE, i)) i += FENCE.length
  while (i < body.length && /\s/.test(body[i])) i++
  return i
}

/** 跳过 JSON 结束后的空白与闭合 ``` 围栏。 */
function skipBlockEpilogue(body, from) {
  let i = from
  while (i < body.length && /\s/.test(body[i])) i++
  if (body.startsWith(FENCE, i)) {
    i += FENCE.length
    while (i < body.length && /\s/.test(body[i])) i++
  }
  return i
}

/**
 * 从 from 开始的 JSON 对象结束位置（不含）；字符串内的括号计为文本。
 * 不完整时返回 -1。
 */
function scanJsonObjectEnd(body, from) {
  if (from >= body.length || body[from] !== '{') return -1
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = from; i < body.length; i++) {
    const ch = body[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return i + 1
      if (depth < 0) return -1
    }
  }
  return -1
}

function scanToolCallBlocks(body) {
  const blocks = []
  let hasUnclosedBlock = false
  let recoveredMissingCloseTag = false
  let cursor = 0
  while (true) {
    const start = body.indexOf(TOOL_CALL_OPEN, cursor)
    if (start < 0) break
    const bodyStart = skipBlockPreamble(body, start + TOOL_CALL_OPEN.length)
    const jsonEnd = scanJsonObjectEnd(body, bodyStart)
    const closeStart = body.indexOf(TOOL_CALL_CLOSE, bodyStart)
    if (jsonEnd < 0) {
      if (closeStart < 0) {
        hasUnclosedBlock = true
        break
      }
      const raw = body.slice(start, closeStart + TOOL_CALL_CLOSE.length)
      blocks.push([start, parseBlockBody(body.slice(start + TOOL_CALL_OPEN.length, closeStart), raw)])
      cursor = closeStart + TOOL_CALL_CLOSE.length
      continue
    }
    const afterBody = skipBlockEpilogue(body, jsonEnd)
    const closed = body.startsWith(TOOL_CALL_CLOSE, afterBody)
    const end = closed ? afterBody + TOOL_CALL_CLOSE.length : jsonEnd
    blocks.push([start, parseBlockBody(body.slice(bodyStart, jsonEnd), body.slice(start, end))])
    if (!closed) recoveredMissingCloseTag = true
    cursor = end
  }
  return { blocks, hasUnclosedBlock, recoveredMissingCloseTag }
}

/** 从未闭合的 DSML 包装器尾部恢复完整 invoke。 */
function unclosedDsmlWrapper(body) {
  let cursor = 0
  while (true) {
    const open = DSML_WRAPPER_OPEN_RE.exec(body.slice(cursor))
    if (!open) return null
    const absStart = cursor + open.index
    const afterOpen = absStart + open[0].length
    const rest = body.slice(afterOpen)
    const closeMatch = DSML_WRAPPER_CLOSE_RE.exec(rest)
    const nextOpen = DSML_WRAPPER_OPEN_RE.exec(rest)
    if (!closeMatch || (nextOpen && nextOpen.index < closeMatch.index)) {
      return [absStart, body.slice(absStart)]
    }
    cursor = afterOpen + closeMatch.index + closeMatch[0].length
  }
}

export function parseToolCallBlocks(body) {
  const normalized = normalizeDsmlTags(body)
  const indexedBlocks = []
  const scan = scanToolCallBlocks(normalized)
  indexedBlocks.push(...scan.blocks)
  for (const match of normalized.matchAll(DSML_WRAPPER_RE)) {
    for (const block of parseDsmlWrapper(match[0], match[1])) {
      indexedBlocks.push([match.index, block])
    }
  }
  let hasUnclosedBlock = scan.hasUnclosedBlock
  let recoveredUnclosedBlock = scan.recoveredMissingCloseTag
  const dsmlTail = unclosedDsmlWrapper(normalized)
  if (dsmlTail) {
    const [start, tail] = dsmlTail
    const invokes = [...tail.matchAll(DSML_INVOKE_RE)].map((m) => parseDsmlInvoke(m[0], m[1], m[2]))
    const valid = invokes.filter((b) => b.valid)
    if (valid.length === 0) {
      hasUnclosedBlock = true
    } else {
      for (const block of valid) indexedBlocks.push([start, block])
      recoveredUnclosedBlock = true
    }
  }
  return {
    blocks: indexedBlocks.sort((a, b) => a[0] - b[0]).map((pair) => pair[1]),
    prose: proseWithoutToolBlocks(body),
    hasUnclosedBlock,
    recoveredUnclosedBlock,
  }
}

/** OpenAI 兼容中转可能在 message.content 之外返回原生函数调用。 */
export function parseNativeCreationCalls(calls) {
  if (!Array.isArray(calls)) return []
  return calls.map((element) => {
    const fn = element && typeof element === 'object' ? element.function : null
    if (!fn || typeof fn !== 'object') {
      return { valid: false, reason: '原生工具缺少名称', raw: '' }
    }
    const nativeName = typeof fn.name === 'string' ? fn.name : ''
    const rawValue = fn.arguments
    let arguments_ = null
    if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
      arguments_ = rawValue
    } else if (typeof rawValue === 'string' && rawValue !== '') {
      try {
        const parsed = JSON.parse(rawValue)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) arguments_ = parsed
      } catch { /* 保持 null */ }
    }
    const rawForReport = typeof rawValue === 'string' ? rawValue.slice(0, 200) : ''
    if (!arguments_) {
      return { valid: false, reason: `原生工具 ${nativeName} 的 arguments 不是完整 JSON 对象`, raw: rawForReport }
    }
    if (nativeName === 'creation_tool') {
      const name = typeof arguments_.name === 'string' ? arguments_.name : ''
      const nested = arguments_.arguments
      if (!name || name.trim() === '' || !nested || typeof nested !== 'object' || Array.isArray(nested)) {
        return { valid: false, reason: 'creation_tool 缺少 name 或 arguments 对象', raw: rawForReport }
      }
      return { valid: true, call: { name, arguments: nested } }
    }
    if (nativeName.trim() === '') {
      return { valid: false, reason: '原生工具缺少名称', raw: rawForReport }
    }
    return { valid: true, call: { name: nativeName, arguments: arguments_ } }
  })
}

export function renderToolResult(result, index) {
  const safeName = /^[A-Za-z_][A-Za-z_0-9]{0,63}$/.test(result.name) ? result.name : 'unknown'
  return `<tool_result index="${index}" name="${safeName}" ok="${result.ok ? 'true' : 'false'}">` +
    JSON.stringify(result.payload).replace(/</g, '\\u003c') + '</tool_result>'
}

/** 原生调用回放为文本工具块，让下一轮请求看到模型自己发过的调用。 */
export function renderToolCallReplay(call) {
  return TOOL_CALL_OPEN + JSON.stringify({ name: call.name, arguments: call.arguments }) + TOOL_CALL_CLOSE
}

/** ask_user 参数解析：question + 2-6 个带 label 的选项；形状不可用时返回 null。 */
export function parseAskUserQuestion(arguments_) {
  const question = typeof arguments_.question === 'string' ? arguments_.question.trim() : ''
  if (!question) return null
  if (!Array.isArray(arguments_.options)) return null
  const options = []
  for (const element of arguments_.options) {
    if (!element || typeof element !== 'object') continue
    const label = typeof element.label === 'string' ? element.label.trim() : ''
    if (!label) continue
    options.push({ label, description: typeof element.description === 'string' ? element.description : '' })
  }
  if (options.length < 2 || options.length > 6) return null
  return { question, options }
}

/** 工具活动单行摘要：只有计数与字段名。 */
export function toolEventDetail(result) {
  if (!result.ok) {
    const err = result.payload && typeof result.payload.error === 'string' ? result.payload.error : ''
    return (err || 'error').slice(0, 80)
  }
  const payload = result.payload || {}
  const count = (key) => (Array.isArray(payload[key]) ? payload[key].length : null)
  const num = (key) => (typeof payload[key] === 'number' ? payload[key] : null)
  switch (result.name) {
    case 'read_card': return num('lore_count') != null ? `lore ${num('lore_count')}` : 'card'
    case 'list_reference_lore':
    case 'list_lore': {
      const shown = count('entries')
      const total = num('total')
      return shown != null && total != null ? `${shown}/${total}` : ''
    }
    case 'read_reference_lore':
    case 'read_lore': {
      const found = count('found')
      const miss = count('not_found')
      return found != null && miss != null ? `found ${found}, miss ${miss}` : ''
    }
    case 'search_source': return `命中 ${count('matches') ?? 0} 处`
    case 'web_search': return `${payload.query || '联网搜索'} · ${count('results') ?? 0} 条来源`.slice(0, 100)
    case 'read_source': return `${payload.start ?? 0}..${payload.end ?? 0} / ${payload.total_length ?? 0} 字符`
    case 'set_card_fields':
      return (Array.isArray(payload.applied) ? payload.applied.filter((x) => typeof x === 'string') : [])
        .join(', ').slice(0, 80)
    case 'upsert_lore': {
      const results = Array.isArray(payload.results) ? payload.results : []
      const created = results.filter((r) => r && r.status === 'created').length
      const updated = results.filter((r) => r && r.status === 'updated').length
      const miss = count('not_found') || 0
      const parts = []
      if (created > 0) parts.push(`new ${created}`)
      if (updated > 0) parts.push(`upd ${updated}`)
      if (miss > 0) parts.push(`miss ${miss}`)
      return parts.join(', ')
    }
    case 'remove_lore': {
      const removed = count('removed') || 0
      const miss = count('not_found') || 0
      return miss > 0 ? `del ${removed}, miss ${miss}` : `del ${removed}`
    }
    case 'ask_user':
      return typeof payload.answer === 'string' ? payload.answer.slice(0, 40) : ''
    default: return ''
  }
}

/** 原生 creation_tool 的 JSON Schema（保持单函数，跨中转兼容面最小）。 */
export function creationNativeTools({ webSearchAvailable = false } = {}) {
  return [{
    type: 'function',
    function: {
      name: 'creation_tool',
      description: 'Read or update the current character card/world book draft, or search reference material with available tools. Tool names and arguments are described in the system message.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            enum: [
              'read_card', 'list_lore', 'read_lore', 'set_card_fields', 'upsert_lore', 'remove_lore',
              'search_source', 'read_source',
              ...(webSearchAvailable ? ['web_search'] : []),
              'read_reference', 'list_reference_lore', 'read_reference_lore',
              'list_assets', 'read_script', 'upsert_script', 'read_regex', 'upsert_regex',
              'read_variables', 'set_variables', 'remove_asset', 'ask_user',
            ],
          },
          arguments: { type: 'object', additionalProperties: true },
        },
        required: ['name', 'arguments'],
      },
    },
  }]
}
