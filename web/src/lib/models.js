// CreationModels / CharacterExporter / WorldBookCodec 移植。
// 草稿在浏览器里就是普通 JS 对象；originalCard/originalBook 保存原始 JSON 树作为合并基。

export const CREATOR_LABEL = '锻卡炉 AI 协作创作'

export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxx-xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16))
}

export function newSession(kind) {
  return {
    id: `creation_${uuid()}`,
    kind, // 'Character' | 'WorldBook'
    turns: [],
    card: emptyCharacterDraft(),
    coverSha256: '',
    worldName: '',
    lore: [],
    sourceName: '',
    sourceSha256: '',
    sourceCursor: 0,
    sourceLength: 0,
    savedArtifactId: '',
    partialTurnSaved: false,
    pendingRun: null,
    pendingReplies: [],
    updatedAt: Date.now(),
    nextLoreNumber: 0,
    originalCard: null,
    originalBook: null,
    advancedExtensions: null,
    reference: null,
    allowLoreEdits: false,
  }
}

export function emptyCharacterDraft() {
  return {
    name: '',
    description: '',
    personality: '',
    scenario: '',
    firstMessage: '',
    alternateGreetings: [],
    exampleMessages: '',
    systemPrompt: '',
    postHistoryInstructions: '',
    creatorNotes: '',
    tags: [],
    frontendHtml: '',
  }
}

export function emptyLore() {
  return {
    title: '',
    keys: [],
    content: '',
    secondaryKeys: [],
    selective: false,
    constant: false,
    insertionOrder: 100,
    depth: 4,
    position: 0,
    probability: 100,
    matchWholeWords: false,
    sourceQuote: '',
    sourceOffset: -1,
    sourceName: '',
    sourceSha256: '',
    note: '',
    id: '',
    originalEntry: null,
  }
}

/** 提炼结果和旧草稿可能只有正文等少数字段；补齐编辑器与工具的默认值。 */
export function normalizeLore(entry) {
  let normalized = entry
  for (const [key, fallback] of Object.entries(emptyLore())) {
    const value = entry[key]
    const invalid = fallback === null ? value === undefined
      : Array.isArray(fallback) ? !Array.isArray(value) || value.some((item) => typeof item !== 'string')
      : typeof value !== typeof fallback || (typeof fallback === 'number' && !Number.isFinite(value))
    if (!invalid) continue
    if (normalized === entry) normalized = { ...entry }
    normalized[key] = Array.isArray(fallback) && Array.isArray(value)
      ? value.filter((item) => typeof item === 'string') : fallback
  }
  return normalized
}

// ---------------------------------------------------------------- 卡片导入

function str(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function strArray(value) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => typeof item === 'string')
}

/** 读取 V2/V3 角色卡 JSON（data 优先，顶层镜像兜底）。 */
export function parseCharacterCardJson(raw) {
  const data = raw && typeof raw.data === 'object' && raw.data !== null && !Array.isArray(raw.data) ? raw.data : {}
  const pick = (key) => str(data[key] ?? raw[key])
  const book = data.character_book ?? raw.character_book
  return {
    name: pick('name'),
    description: pick('description'),
    personality: pick('personality'),
    scenario: pick('scenario'),
    firstMessage: pick('first_mes'),
    exampleMessages: pick('mes_example'),
    creatorNotes: pick('creator_notes') || pick('creatorcomment'),
    tags: strArray(data.tags ?? raw.tags),
    alternateGreetings: strArray(data.alternate_greetings ?? raw.alternate_greetings),
    systemPrompt: str(data.system_prompt),
    postHistoryInstructions: str(data.post_history_instructions),
    characterBook: book && typeof book === 'object' ? book : null,
    raw,
  }
}

/** ST 世界书条目解析：WorldBookCodec.parseWorldBookEntries 移植。 */
export function parseWorldBookEntries(rawBook) {
  const entriesObj = rawBook && typeof rawBook.entries === 'object' && rawBook.entries !== null
    ? rawBook.entries : null
  if (!entriesObj) return []
  const embedded = Array.isArray(entriesObj)
  const entries = []
  for (const [key, value] of Object.entries(entriesObj)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const e = embedded ? embeddedEntryToStandalone(value, Number(key)) : value
    const extensions = e.extensions && typeof e.extensions === 'object' && !Array.isArray(e.extensions) ? e.extensions : null
    const bool = (v, d) => {
      if (typeof v === 'boolean') return v
      if (typeof v === 'string') return v === 'true' ? true : v === 'false' ? false : d
      return d
    }
    const int = (v, d) => {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
      return Number.isFinite(n) ? Math.trunc(n) : d
    }
    const delayRaw = e.delayUntilRecursion
    const delay = int(delayRaw, NaN)
    const delayFinal = Number.isFinite(delay) ? delay
      : bool(delayRaw, false) ? 1 : 0
    entries.push({
      id: str(e.uid, key),
      keys: strArray(e.key),
      secondaryKeys: strArray(e.keysecondary),
      content: str(e.content),
      enabled: !bool(e.disable, false),
      selective: bool(e.selective, true),
      constant: bool(e.constant, false),
      priority: int(e.priority, 0),
      insertionOrder: int(e.order, 100),
      depth: int(e.depth, 4),
      scanDepth: 'scanDepth' in e ? int(e.scanDepth, NaN) : int(extensions?.scan_depth, NaN),
      position: int(e.position, 0),
      probability: int(e.probability, 100),
      useProbability: bool(e.useProbability, true),
      selectiveLogic: int(e.selectiveLogic, 0),
      role: int(e.role, 0),
      matchWholeWords: bool(e.matchWholeWords, false),
      useRegex: bool(e.useRegex, false),
      caseSensitive: bool(e.caseSensitive, false),
      comment: str(e.comment),
      excludeRecursion: bool(e.excludeRecursion, false),
      preventRecursion: bool(e.preventRecursion, false),
      delayUntilRecursion: delayFinal,
      ignoreBudget: bool(extensions?.ignore_budget ?? e.ignoreBudget ?? e.ignore_budget, false),
      group: str(e.group),
      groupOverride: bool(e.groupOverride, false),
      groupWeight: int(e.groupWeight, 100),
      useGroupScoring: bool(e.useGroupScoring, false),
      raw: e,
      embeddedRaw: embedded ? value : null,
    })
  }
  return entries
}

export function entryToLoreDraft(entry) {
  const title = entry.comment !== '' ? entry.comment
    : (entry.keys[0] || (entry.content.split('\n')[0] || '')).slice(0, 24)
  return {
    ...emptyLore(),
    title,
    keys: [...entry.keys],
    secondaryKeys: [...entry.secondaryKeys],
    content: entry.content,
    selective: entry.selective && entry.secondaryKeys.length > 0,
    constant: entry.constant,
    insertionOrder: entry.insertionOrder,
    depth: entry.depth,
    position: entry.position,
    probability: entry.probability,
    matchWholeWords: entry.matchWholeWords,
    originalEntry: entry,
  }
}

/** 从已存角色卡 JSON 创建编辑会话。 */
export function sessionFromCharacterCard(raw) {
  const parsed = parseCharacterCardJson(raw)
  const bookEntries = parsed.characterBook ? parseWorldBookEntries(parsed.characterBook) : []
  const session = {
    ...newSession('Character'),
    card: {
      ...emptyCharacterDraft(),
      name: parsed.name,
      description: parsed.description,
      personality: parsed.personality,
      scenario: parsed.scenario,
      firstMessage: parsed.firstMessage,
      alternateGreetings: [...parsed.alternateGreetings],
      exampleMessages: parsed.exampleMessages,
      systemPrompt: parsed.systemPrompt,
      postHistoryInstructions: parsed.postHistoryInstructions,
      creatorNotes: parsed.creatorNotes,
      tags: [...parsed.tags],
    },
    worldName: parsed.characterBook && typeof parsed.characterBook.name === 'string' ? parsed.characterBook.name : '',
    lore: bookEntries.map(entryToLoreDraft),
    originalCard: raw,
    originalBook: parsed.characterBook,
    advancedExtensions: {},
  }
  return withAssignedLoreIds(session)
}

/** 独立世界书 JSON → 编辑会话。 */
export function sessionFromWorldBookJson(rawBook) {
  const session = {
    ...newSession('WorldBook'),
    worldName: str(rawBook?.name),
    lore: parseWorldBookEntries(rawBook).map(entryToLoreDraft),
    originalBook: rawBook,
  }
  return withAssignedLoreIds(session)
}

/** 以角色卡为素材另建独立世界书（不改来源卡）。 */
export function worldBookSessionFromCard(raw) {
  const source = sessionFromCharacterCard(raw)
  return {
    ...source,
    id: `creation_${uuid()}`,
    kind: 'WorldBook',
    worldName: source.worldName !== '' ? source.worldName : `${source.card.name}世界书`,
    savedArtifactId: '',
    sourceName: source.card.name,
    originalCard: raw,
    originalBook: source.originalBook,
    advancedExtensions: {},
  }
}

/** 补齐旧草稿和提炼结果的字段、缺失 id，保留已有编号。 */
export function withAssignedLoreIds(session) {
  const normalized = session.lore.map(normalizeLore)
  const used = new Set(normalized.map((entry) => entry.id))
  const previous = Number.isSafeInteger(session.nextLoreNumber) ? session.nextLoreNumber : 0
  let highest = previous
  for (const id of used) {
    const match = /^L(\d+)$/.exec(id)
    if (match) highest = Math.max(highest, Number(match[1]))
  }
  let next = Math.max(1, previous + 1)
  const filled = normalized.map((entry) => {
    if (entry.id !== '') return entry
    while (used.has(`L${next}`)) next++
    const id = `L${next}`
    used.add(id)
    highest = Math.max(highest, next++)
    return { ...entry, id }
  })
  const reference = session.reference ? withAssignedLoreIds(session.reference) : session.reference
  if (filled.every((entry, index) => entry === session.lore[index]) &&
      highest === session.nextLoreNumber && reference === session.reference) return session
  return {
    ...session,
    lore: filled,
    nextLoreNumber: highest,
    ...(reference ? { reference } : {}),
  }
}

// ---------------------------------------------------------------- 导出

function trimmedDistinct(list) {
  const seen = new Set()
  const out = []
  for (const item of list) {
    const t = typeof item === 'string' ? item.trim() : ''
    if (t === '' || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/** 开场正文 + 可移植前端片段拼接。 */
function withFrontend(card, opening) {
  return [opening.trim(), card.frontendHtml.trim()].filter((s) => s !== '').join('\n\n')
}

/** 草稿 → 装配完成的角色卡中间表示（typed + raw）。 */
export function toCharacterCard(session) {
  if (session.kind !== 'Character' || session.card.name.trim() === '') {
    throw new Error('只有填写了名称的角色卡草稿才能导出')
  }
  const card = session.card
  const opening = withFrontend(card, card.firstMessage)
  const greetings = card.alternateGreetings.map((g) => withFrontend(card, g))
  const base = session.originalCard
  const rawData = base && typeof base.data === 'object' && !Array.isArray(base.data) ? base.data : null
  const data = rawData ? { ...rawData } : {}
  data.name = card.name.trim()
  data.description = card.description
  data.personality = card.personality
  data.scenario = card.scenario
  data.first_mes = opening
  data.mes_example = card.exampleMessages
  data.creator_notes = card.creatorNotes
  if (card.systemPrompt !== '') data.system_prompt = card.systemPrompt
  else if (!('system_prompt' in data)) data.system_prompt = ''
  if (card.postHistoryInstructions !== '') data.post_history_instructions = card.postHistoryInstructions
  else if (!('post_history_instructions' in data)) data.post_history_instructions = ''
  if (!('creator' in data) || data.creator === '') data.creator = CREATOR_LABEL
  if (!('character_version' in data) || data.character_version === '') data.character_version = '1.0'
  data.tags = [...card.tags]
  data.alternate_greetings = [...greetings]
  const extensions = session.advancedExtensions && Object.keys(session.advancedExtensions).length > 0
    ? session.advancedExtensions
    : (data.extensions && typeof data.extensions === 'object' ? data.extensions : {})
  data.extensions = extensions
  if (session.lore.length > 0) data.character_book = serializeBookForCard(session)
  else delete data.character_book
  if (!('fav' in data)) data.fav = false
  const raw = { ...(base ?? {}) }
  delete raw.chat
  raw.spec = raw.spec ?? 'chara_card_v2'
  raw.spec_version = raw.spec_version ?? '2.0'
  raw.data = data
  return {
    name: card.name.trim(),
    description: card.description,
    firstMessage: opening,
    raw,
  }
}

// 与 SillyTavern convertWorldInfoToCharacterBook / convertCharacterBook 一致。
const BOOK_EXTENSION_FIELDS = {
  position: 'position', excludeRecursion: 'exclude_recursion', displayIndex: 'display_index',
  probability: 'probability', useProbability: 'useProbability', depth: 'depth', selectiveLogic: 'selectiveLogic',
  outletName: 'outlet_name', group: 'group', groupOverride: 'group_override', groupWeight: 'group_weight',
  preventRecursion: 'prevent_recursion', delayUntilRecursion: 'delay_until_recursion', scanDepth: 'scan_depth',
  matchWholeWords: 'match_whole_words', useGroupScoring: 'use_group_scoring', caseSensitive: 'case_sensitive',
  automationId: 'automation_id', role: 'role', vectorized: 'vectorized', sticky: 'sticky', cooldown: 'cooldown',
  delay: 'delay', matchPersonaDescription: 'match_persona_description', matchCharacterDescription: 'match_character_description',
  matchCharacterPersonality: 'match_character_personality', matchCharacterDepthPrompt: 'match_character_depth_prompt',
  matchScenario: 'match_scenario', matchCreatorNotes: 'match_creator_notes', triggers: 'triggers', ignoreBudget: 'ignore_budget',
}

function embeddedEntryToStandalone(entry, index) {
  const out = { ...entry, uid: entry.id ?? index, key: entry.keys, keysecondary: entry.secondary_keys,
    comment: entry.comment ?? entry.name ?? '', order: entry.insertion_order,
    disable: entry.enabled === false, position: entry.position === 'before_char' ? 0 : 1,
    caseSensitive: entry.case_sensitive, useRegex: entry.use_regex }
  for (const [key, extension] of Object.entries(BOOK_EXTENSION_FIELDS)) {
    if (entry.extensions?.[extension] != null) out[key] = entry.extensions[extension]
  }
  for (const key of ['id', 'keys', 'secondary_keys', 'insertion_order', 'enabled', 'case_sensitive', 'use_regex']) delete out[key]
  return out
}

/** CCv2/v3 内嵌 entries 是数组，独立 ST 世界书 entries 是对象。 */
function serializeBookForCard(session) {
  const bookName = session.worldName || session.card.name || '新世界书'
  const entries = session.lore.map((lore, index) => {
    const st = serializeLoreEntry(lore, index, { standalone: true })
    const out = { ...(lore.originalEntry?.embeddedRaw ?? st) }
    const extensions = { ...(st.extensions ?? {}) }
    for (const [key, extension] of Object.entries(BOOK_EXTENSION_FIELDS)) {
      if (key in st) extensions[extension] = st[key]
      delete out[key]
    }
    for (const key of ['uid', 'key', 'keysecondary', 'order', 'disable', 'addMemo', 'useRegex', 'caseSensitive']) delete out[key]
    return { ...out, id: st.uid, keys: st.key, secondary_keys: st.keysecondary, comment: st.comment,
      content: st.content, enabled: !st.disable, insertion_order: st.order,
      constant: st.constant, selective: st.selective, position: st.position === 0 ? 'before_char' : 'after_char',
      case_sensitive: st.caseSensitive, use_regex: st.useRegex, extensions }
  })
  return { ...(session.originalBook ?? {}), name: bookName, extensions: session.originalBook?.extensions ?? {}, entries }
}

/** 独立世界书 JSON（保留 book 级 raw 的其余键）。 */
export function toWorldBookJson(session) {
  const bookName = session.worldName || session.card.name || '新世界书'
  const base = session.originalBook && typeof session.originalBook === 'object'
    ? session.originalBook : {}
  const out = {}
  for (const [key, value] of Object.entries(base)) {
    if (key !== 'name' && key !== 'entries') out[key] = value
  }
  out.name = bookName
  const entries = {}
  session.lore.forEach((lore, index) => {
    entries[String(index)] = serializeLoreEntry(lore, index, { standalone: true })
  })
  out.entries = entries
  return out
}

/** 单条 LoreDraft → ST 条目：raw 为基、草稿字段覆盖，未建模字段原样保留。 */
const usedUids = new Set()

function nextFreshUid() {
  let next = 1
  for (const used of usedUids) if (used >= next) next = used + 1
  return next
}

function serializeLoreEntry(lore, index, { standalone }) {
  // 导出也兼容尚未经过重开迁移的旧提炼草稿，避免直接遍历缺失的关键词数组。
  lore = normalizeLore(lore)
  const original = lore.originalEntry
  const raw = original?.raw && typeof original.raw === 'object' ? original.raw : null
  const merged = { ...(raw ?? { comment: lore.title, extensions: {} }) }
  let uid
  if (merged.uid !== undefined) uid = Number(merged.uid)
  if (!Number.isFinite(uid)) {
    const numeric = parseInt(String(lore.id ?? ''), 10)
    uid = Number.isFinite(numeric) ? numeric : NaN
  }
  if (!Number.isFinite(uid) || usedUids.has(uid)) uid = nextFreshUid()
  usedUids.add(uid)
  merged.uid = uid
  merged.key = trimmedDistinct(lore.keys)
  merged.keysecondary = trimmedDistinct(lore.secondaryKeys)
  merged.content = lore.content.trim()
  merged.constant = lore.constant
  merged.selective = lore.selective && lore.secondaryKeys.length > 0
  merged.order = lore.insertionOrder
  merged.position = lore.position
  merged.disable = original ? !original.enabled : false
  merged.depth = lore.depth
  merged.probability = Math.max(0, Math.min(100, lore.probability))
  merged.useProbability = original?.useProbability ?? true
  merged.selectiveLogic = original?.selectiveLogic ?? 0
  merged.role = original?.role ?? 0
  merged.matchWholeWords = lore.matchWholeWords
  merged.useRegex = original?.useRegex ?? false
  merged.caseSensitive = original?.caseSensitive ?? false
  merged.comment = lore.title
  merged.excludeRecursion = original?.excludeRecursion ?? false
  merged.preventRecursion = original?.preventRecursion ?? false
  merged.delayUntilRecursion = original?.delayUntilRecursion ?? 0
  merged.ignoreBudget = original?.ignoreBudget ?? false
  merged.group = original?.group ?? ''
  merged.groupOverride = original?.groupOverride ?? false
  merged.groupWeight = original?.groupWeight ?? 100
  merged.useGroupScoring = original?.useGroupScoring ?? false
  if (standalone) {
    merged.scanDepth = original?.scanDepth ?? null
    const priority = original?.priority ?? 0
    if (priority !== 0 || (raw && 'priority' in raw)) merged.priority = priority
  } else {
    merged.priority = original?.priority ?? 0
  }
  if (!('sticky' in merged)) merged.sticky = 0
  if (!('cooldown' in merged)) merged.cooldown = 0
  if (!('delay' in merged)) merged.delay = 0
  if (!('displayIndex' in merged)) merged.displayIndex = index
  if (!('addMemo' in merged)) merged.addMemo = true
  if (!('extensions' in merged) || typeof merged.extensions !== 'object') merged.extensions = {}
  return merged
}

function collectRawUids(obj) {
  if (!obj || typeof obj !== 'object') return []
  const out = []
  const uid = parseInt(String(obj.uid ?? ''), 10)
  if (Number.isFinite(uid)) out.push(uid)
  return out
}

// 每次整书序列化前重置 uid 游标，跨书不串号。
export function resetLoreUidCursor() {
  usedUids.clear()
}

/** 完整 V2 角色卡导出 JSON（顶层镜像 + data）。导出前调用 resetLoreUidCursor()。 */
export function exportCardJson(session) {
  resetLoreUidCursor()
  const typed = toCharacterCard(session)
  const data = typed.raw.data
  const base = session.originalCard ?? {}
  const out = {}
  for (const [key, value] of Object.entries(base)) {
    if (key !== 'data' && key !== 'chat') out[key] = value
  }
  out.spec = base.spec ?? 'chara_card_v2'
  out.spec_version = base.spec_version ?? '2.0'
  out.name = typed.name
  out.description = typed.description
  out.personality = session.card.personality
  out.scenario = session.card.scenario
  out.first_mes = typed.firstMessage
  out.mes_example = session.card.exampleMessages
  out.creatorcomment = session.card.creatorNotes
  out.tags = [...session.card.tags]
  if ('creator_notes' in base) out.creator_notes = session.card.creatorNotes
  if ('alternate_greetings' in base) out.alternate_greetings = [...data.alternate_greetings]
  out.data = data
  if ('character_book' in out) {
    if (data.character_book) out.character_book = data.character_book
    else delete out.character_book
  }
  return sanitizeCard(out)
}

export function exportWorldBookJson(session) {
  resetLoreUidCursor()
  const book = toWorldBookJson(session)
  // 回读校验：条目数一致才允许导出。
  const reparsed = parseWorldBookEntries(book)
  if (reparsed.length !== session.lore.length) {
    throw new Error('世界书导出回读失败')
  }
  return book
}

// ---------------------------------------------------------------- 可移植前端检查

/** 无脚本、无外部资源、无酒馆专属 API 的可移植开场面板约束。 */
export function portableFrontendIssues(html) {
  if (!html || html.trim() === '') return []
  const issues = []
  const checks = [
    [/<\s*script\b/i, 'frontendScript'],
    [/\bon[a-z]+\s*=/i, 'frontendInlineEvent'],
    [/<\s*(iframe|object|embed|link|form|img|video|audio|canvas|svg|math|meta|base|input|button|textarea|select|template)\b/i, 'frontendForbiddenTag'],
    [/\b(src|href|srcset|action)\s*=/i, 'frontendExternalRef'],
    [/@import\b|url\s*\(|expression\s*\(|behavior\s*:/i, 'frontendDynamicStyle'],
    [/\{\{/i, 'frontendTemplateVar'],
  ]
  for (const [pattern, key] of checks) {
    if (pattern.test(html)) issues.push(key)
  }
  return issues
}

// ---------------------------------------------------------------- 敏感字段脱敏

const SENSITIVE_KEYS = new Set([
  'api_key', 'apikey', 'api-key', 'api_secret', 'apisecret',
  'access_token', 'access-token', 'bearer_token', 'bearer-token',
  'secret_key', 'secret-key', 'secret_token', 'password', 'passwd',
  'auth_token', 'auth-token', 'private_key', 'private-key', 'credentials',
  'refresh_token', 'client_secret',
])

const SENSITIVE_VALUE_PATTERNS = [
  /^sk-[a-zA-Z0-9]{20,}$/,
  /^key-[a-zA-Z0-9]{20,}$/,
  /^xai-[a-zA-Z0-9]{20,}$/,
  /^[a-zA-Z0-9]{40,}$/,
]

function looksLikeSecret(key, value) {
  if (SENSITIVE_KEYS.has(key.toLowerCase())) return true
  return SENSITIVE_VALUE_PATTERNS.some((p) => p.test(value))
}

/** 按 key 名与值形态脱敏；导出的卡不应携带密钥。 */
export function sanitizeCard(obj) {
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk)
    if (node && typeof node === 'object') {
      const out = {}
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === 'string' && looksLikeSecret(key, value)) {
          out[key] = '[REDACTED]'
        } else {
          out[key] = walk(value)
        }
      }
      return out
    }
    return node
  }
  return walk(obj)
}
