// CreationToolBox + CreationAdvancedAssets 移植：对草稿工作副本执行工具调用。
// 载荷字段名与 Android 版一致（系统提示词按这些名字描述工具）。

import { emptyLore, uuid } from './models.js'

const SYSTEM_MANAGED_LORE_FIELDS = new Set(['sourceQuote', 'sourceOffset', 'sourceName', 'sourceSha256', 'originalEntry'])

const LORE_WRITABLE_FIELDS = new Set([
  'id', 'title', 'keys', 'content', 'secondaryKeys', 'selective', 'constant',
  'insertionOrder', 'depth', 'position', 'probability', 'matchWholeWords', 'note',
])

const LORE_KEY_ALIASES = {
  key: 'keys',
  keysecondary: 'secondaryKeys',
  secondary_keys: 'secondaryKeys',
  order: 'insertionOrder',
  insert_order: 'insertionOrder',
  match_whole_words: 'matchWholeWords',
  comment: 'title',
}

const CARD_FIELD_WHITELIST = new Set([
  'name', 'description', 'personality', 'scenario', 'firstMessage', 'alternateGreetings',
  'exampleMessages', 'systemPrompt', 'postHistoryInstructions', 'creatorNotes', 'tags', 'frontendHtml',
])

function argInt(args, name, fallback) {
  if (!(name in args)) return fallback
  const value = args[name]
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.trunc(value) !== value) {
    throw new Error(`${name} 必须是整数，收到：${JSON.stringify(value)}`)
  }
  return value
}

function argString(args, name, fallback = null) {
  if (!(name in args)) return fallback
  const value = args[name]
  if (typeof value !== 'string') throw new Error(`${name} 必须是字符串`)
  return value
}

function argStringArray(args, name) {
  if (!(name in args)) return []
  const value = args[name]
  if (!Array.isArray(value)) throw new Error(`${name} 必须是字符串数组`)
  return value.map((item, index) => {
    if (typeof item !== 'string') throw new Error(`${name} 第 ${index + 1} 项必须是字符串`)
    return item
  })
}

function argBool(args, name) {
  if (!(name in args)) return null
  const value = args[name]
  if (typeof value !== 'boolean') throw new Error(`${name} 必须是布尔值`)
  return value
}

const LORE_FIELD_TYPES = {
  title: 'string', content: 'string', note: 'string',
  keys: 'stringArray', secondaryKeys: 'stringArray',
  selective: 'boolean', constant: 'boolean', matchWholeWords: 'boolean',
  insertionOrder: 'int', depth: 'int', position: 'int', probability: 'int',
}

function validateLoreFields(normalized) {
  for (const [key, type] of Object.entries(LORE_FIELD_TYPES)) {
    if (!(key in normalized)) continue
    const value = normalized[key]
    switch (type) {
      case 'string':
        if (typeof value !== 'string') throw new Error(`${key} 必须是字符串`)
        break
      case 'stringArray':
        if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
          throw new Error(`${key} 必须是字符串数组`)
        }
        break
      case 'boolean':
        if (typeof value !== 'boolean') throw new Error(`${key} 必须是布尔值`)
        break
      case 'int':
        if (typeof value !== 'number' || !Number.isFinite(value) || Math.trunc(value) !== value) {
          throw new Error(`${key} 必须是整数`)
        }
        break
    }
  }
}

const CARD_FIELD_TYPES = {
  name: 'string', description: 'string', personality: 'string', scenario: 'string',
  firstMessage: 'string', exampleMessages: 'string', systemPrompt: 'string',
  postHistoryInstructions: 'string', creatorNotes: 'string', frontendHtml: 'string',
  alternateGreetings: 'stringArray', tags: 'stringArray',
}

// ---------------------------------------------------------------- 高级资源

function extensionsOf(session) {
  if (session.advancedExtensions && Object.keys(session.advancedExtensions).length > 0) return session.advancedExtensions
  const data = session.originalCard && typeof session.originalCard.data === 'object' ? session.originalCard.data : null
  const ext = data && typeof data.extensions === 'object' && data.extensions !== null ? data.extensions : null
  return ext && !Array.isArray(ext) ? ext : {}
}

function scriptsOf(session) {
  const helper = extensionsOf(session).tavern_helper
  const scripts = helper && typeof helper === 'object' && !Array.isArray(helper) ? helper.scripts : null
  return Array.isArray(scripts) ? scripts.filter((s) => s && typeof s === 'object') : []
}

function regexesOf(session) {
  const list = extensionsOf(session).regex_scripts
  return Array.isArray(list) ? list.filter((s) => s && typeof s === 'object') : []
}

function variablesOf(session) {
  const helper = extensionsOf(session).tavern_helper
  const raw = helper && typeof helper === 'object' && !Array.isArray(helper) ? helper.variables : null
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...raw }
  if (Array.isArray(raw)) {
    const out = {}
    for (const item of raw) {
      if (!Array.isArray(item) || item.length < 2) continue
      if (typeof item[0] !== 'string') continue
      out[item[0]] = item[1]
    }
    return out
  }
  return {}
}

function withTavernHelper(session, patch) {
  const ext = { ...extensionsOf(session) }
  const helper = ext.tavern_helper && typeof ext.tavern_helper === 'object' && !Array.isArray(ext.tavern_helper)
    ? { ...ext.tavern_helper } : {}
  Object.assign(helper, patch)
  ext.tavern_helper = helper
  return { ...session, advancedExtensions: ext, updatedAt: Date.now() }
}

function withRegexes(session, regexes) {
  const ext = { ...extensionsOf(session), regex_scripts: regexes }
  return { ...session, advancedExtensions: ext, updatedAt: Date.now() }
}

function executeAdvancedAsset(session, call) {
  if (session.kind !== 'Character') throw new Error('高级资源只能写入角色卡草稿')
  const args = call.arguments
  const name = call.name
  if (name === 'list_assets') {
    return [session, {
      ok: true, name,
      payload: {
        scripts: scriptsOf(session).map((s) => ({
          id: typeof s.id === 'string' ? s.id : '',
          name: typeof s.name === 'string' ? s.name : '',
          type: typeof s.type === 'string' ? s.type : '',
          enabled: s.enabled === true,
          content_chars: typeof s.content === 'string' ? s.content.length : 0,
        })),
        regex_scripts: regexesOf(session).map((r) => ({
          id: typeof r.id === 'string' ? r.id : '',
          name: typeof r.scriptName === 'string' ? r.scriptName : '',
        })),
        variable_keys: Object.keys(variablesOf(session)),
      },
    }]
  }
  if (name === 'read_script') {
    const id = argString(args, 'id', '')?.trim()
    if (!id) throw new Error('id 不能为空')
    const script = scriptsOf(session).find((s) => s.id === id && s.type === 'script')
    if (!script) throw new Error(`找不到脚本 ${id}`)
    const content = typeof script.content === 'string' ? script.content : ''
    const offset = Math.max(0, Math.min(argInt(args, 'offset', 0), content.length))
    const limit = Math.max(1, Math.min(argInt(args, 'limit', 4000), 6000))
    return [session, {
      ok: true, name,
      payload: {
        id,
        name: typeof script.name === 'string' ? script.name : '',
        enabled: script.enabled === true,
        total_chars: content.length,
        offset,
        content: content.slice(offset, Math.min(offset + limit, content.length)),
      },
    }]
  }
  if (name === 'upsert_script') {
    const id = argString(args, 'id', '')?.trim() || uuid()
    const items = [...scriptsOf(session)]
    const index = items.findIndex((s) => s.id === id)
    const previous = index >= 0 ? items[index] : null
    if (previous && previous.type !== 'script') throw new Error('该 id 属于脚本文件夹')
    const allowed = new Set(['id', 'name', 'enabled', 'content', 'mode', 'info'])
    const unknown = Object.keys(args).filter((k) => !allowed.has(k))
    if (unknown.length > 0) throw new Error(`未知脚本字段：${unknown.join(',')}`)
    const mode = argString(args, 'mode', 'replace')
    if (mode !== 'replace' && mode !== 'append') throw new Error('mode 只能是 replace 或 append')
    const nameValue = argString(args, 'name', null) ?? (previous && typeof previous.name === 'string' ? previous.name : '')
    if (!nameValue.trim()) throw new Error('脚本需要 name')
    const enabled = argBool(args, 'enabled') ?? (previous ? previous.enabled === true : false)
    const chunk = argString(args, 'content', '') ?? ''
    if (chunk.length > 24_000) throw new Error('单次脚本内容过长，请分块追加')
    const previousContent = previous && typeof previous.content === 'string' ? previous.content : ''
    const content = mode === 'append' ? previousContent + chunk
      : ('content' in args) ? chunk : previousContent
    const updated = {
      ...(previous ?? {}),
      type: 'script',
      id,
      name: nameValue,
      enabled,
      content,
    }
    if (argString(args, 'info', null) !== null) updated.info = args.info
    if (index >= 0) items[index] = updated
    else items.push(updated)
    const next = withTavernHelper(session, { scripts: items })
    return [next, {
      ok: true, name,
      payload: { id, status: index >= 0 ? 'updated' : 'created', content_chars: content.length, enabled },
    }]
  }
  if (name === 'upsert_regex') {
    const id = argString(args, 'id', '')?.trim() || uuid()
    const items = [...regexesOf(session)]
    const index = items.findIndex((r) => r.id === id)
    const previous = index >= 0 ? items[index] : null
    const allowed = new Set(['id', 'scriptName', 'findRegex', 'replaceString', 'trimStrings',
      'placement', 'disabled', 'markdownOnly', 'promptOnly', 'runOnEdit', 'substituteRegex',
      'minDepth', 'maxDepth'])
    if (Object.keys(args).some((k) => !allowed.has(k))) throw new Error('未知正则字段')
    for (const field of ['scriptName', 'findRegex', 'replaceString']) argString(args, field, null)
    for (const field of ['disabled', 'markdownOnly', 'promptOnly', 'runOnEdit']) argBool(args, field)
    for (const field of ['substituteRegex', 'minDepth', 'maxDepth']) {
      if (!(field in args)) continue
      const value = args[field]
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.trunc(value) !== value) {
        throw new Error(`${field} 必须是整数`)
      }
    }
    for (const field of ['trimStrings', 'placement']) {
      if (!(field in args)) continue
      const values = args[field]
      if (!Array.isArray(values)) throw new Error(`${field} 必须是数组`)
      for (const item of values) {
        if (field === 'placement') {
          if (typeof item !== 'number' || Math.trunc(item) !== item) throw new Error(`${field} 的元素类型无效`)
        } else if (typeof item !== 'string') {
          throw new Error(`${field} 的元素类型无效`)
        }
      }
    }
    const defaults = previous ?? {
      id,
      trimStrings: [],
      disabled: false,
      markdownOnly: false,
      promptOnly: false,
      runOnEdit: false,
      substituteRegex: 0,
      minDepth: 0,
      maxDepth: 0,
    }
    const updated = { ...defaults, ...args, id }
    if (typeof updated.scriptName !== 'string' || updated.scriptName.trim() === '') throw new Error('正则需要 scriptName')
    if (typeof updated.findRegex !== 'string' || updated.findRegex.trim() === '') throw new Error('正则需要 findRegex')
    if (!Array.isArray(updated.placement) || updated.placement.length === 0) throw new Error('正则需要 placement 数组')
    if (index >= 0) items[index] = updated
    else items.push(updated)
    const next = withRegexes(session, items)
    return [next, { ok: true, name, payload: { id, status: index >= 0 ? 'updated' : 'created' } }]
  }
  if (name === 'read_regex') {
    const id = argString(args, 'id', '')?.trim()
    if (!id) throw new Error('id 不能为空')
    const regex = regexesOf(session).find((r) => r.id === id)
    if (!regex) throw new Error(`找不到正则 ${id}`)
    return [session, { ok: true, name, payload: regex }]
  }
  if (name === 'remove_asset') {
    const type = argString(args, 'type', null)
    const id = argString(args, 'id', '')?.trim()
    if (!id) throw new Error('id 不能为空')
    let next
    if (type === 'script') {
      const items = scriptsOf(session)
      if (!items.some((s) => s.id === id)) throw new Error(`找不到脚本 ${id}`)
      next = withTavernHelper(session, { scripts: items.filter((s) => s.id !== id) })
    } else if (type === 'regex') {
      const items = regexesOf(session)
      if (!items.some((r) => r.id === id)) throw new Error(`找不到正则 ${id}`)
      next = withRegexes(session, items.filter((r) => r.id !== id))
    } else if (type === 'variable') {
      const values = variablesOf(session)
      if (!(id in values)) throw new Error(`找不到变量 ${id}`)
      const remaining = { ...values }
      delete remaining[id]
      next = withTavernHelper(session, { variables: remaining })
    } else {
      throw new Error('type 只能是 script、regex 或 variable')
    }
    return [next, { ok: true, name, payload: { removed: id, type } }]
  }
  if (name === 'set_variables') {
    const patch = args.values
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('values 必须是 JSON 对象')
    const values = { ...variablesOf(session), ...patch }
    const next = withTavernHelper(session, { variables: values })
    return [next, { ok: true, name, payload: { keys: Object.keys(patch), total: Object.keys(values).length } }]
  }
  if (name === 'read_variables') {
    const all = variablesOf(session)
    let names = Array.isArray(args.names)
      ? args.names.map((n, i) => {
        if (typeof n !== 'string') throw new Error('names 必须是字符串数组')
        return n
      })
      : Object.keys(all).slice(0, 20)
    if (names.length > 30) throw new Error('单次最多读取 30 个变量')
    const values = {}
    for (const n of names) if (n in all) values[n] = all[n]
    return [session, { ok: true, name, payload: { values } }]
  }
  throw new Error('未知高级资源工具')
}

// ---------------------------------------------------------------- 工具箱

export class ToolBox {
  constructor(initial) {
    this.session = initial
    const current = initial.nextLoreNumber > 0 ? initial.nextLoreNumber
      : Math.max(0, ...initial.lore.map((e) => parseInt(String(e.id || '').replace(/^L/, ''), 10)).filter(Number.isFinite))
    this.loreIdCursor = current
  }

  nextLoreId() {
    this.loreIdCursor += 1
    return `L${this.loreIdCursor}`
  }

  execute(call) {
    try {
      switch (call.name) {
        case 'read_reference': return this.readReference()
        case 'list_reference_lore': return this.listLore(call.arguments, this.session.reference?.lore ?? [], 'list_reference_lore')
        case 'read_reference_lore': return this.readLore(call.arguments, this.session.reference?.lore ?? [], 'read_reference_lore')
        case 'read_card': return this.readCard()
        case 'list_lore': return this.listLore(call.arguments)
        case 'read_lore': return this.readLore(call.arguments)
        case 'set_card_fields': return this.setCardFields(call.arguments)
        case 'upsert_lore': return this.upsertLore(call.arguments)
        case 'remove_lore': return this.removeLore(call.arguments)
        case 'list_assets': case 'read_script': case 'upsert_script': case 'upsert_regex':
        case 'read_regex': case 'set_variables': case 'read_variables': case 'remove_asset': {
          const [updated, result] = executeAdvancedAsset(this.session, call)
          this.session = updated
          return result
        }
        default:
          return {
            ok: false, name: call.name,
            payload: { error: '未知工具。可用：read_card, list_lore, read_lore, read_reference, list_reference_lore, read_reference_lore, set_card_fields, upsert_lore, remove_lore, list_assets, read_script, upsert_script, read_regex, upsert_regex, read_variables, set_variables, remove_asset' },
          }
      }
    } catch (e) {
      if (e && e.name === 'AbortError') throw e
      return { ok: false, name: call.name, payload: { error: e && e.message ? e.message : '参数无效' } }
    }
  }

  readCard() {
    const payload = {
      kind: this.session.kind === 'Character' ? '角色卡' : '世界书',
      card: { ...this.session.card },
      world_name: this.session.worldName,
      lore_count: this.session.lore.length,
      source_name: this.session.sourceName || '',
      source_length: this.session.sourceLength || 0,
      reference: this.session.reference ? { name: this.session.reference.name, kind: this.session.reference.kind, lore_count: this.session.reference.lore.length, read_only: true } : null,
      lore_editable: !this.loreLocked(),
    }
    if (this.session.kind === 'WorldBook' && this.session.originalCard) {
      const name = this.session.originalCard?.data?.name ?? this.session.originalCard?.name ?? ''
      payload.source_card_name = typeof name === 'string' ? name : ''
      payload.source_card_is_reference_only = true
    }
    return { ok: true, name: 'read_card', payload }
  }

  readReference() {
    const source = this.session.reference
    if (!source) throw new Error('未关联参考草稿')
    return { ok: true, name: 'read_reference', payload: { name: source.name, kind: source.kind,
      card: source.kind === 'Character' ? source.card : null, world_name: source.worldName,
      lore_count: source.lore.length, read_only: true, captured_at: source.capturedAt } }
  }

  loreLocked() {
    return this.session.kind === 'Character' && this.session.reference?.kind === 'WorldBook' && !this.session.allowLoreEdits
  }

  listLore(args, entries = this.session.lore, name = 'list_lore') {
    const offset = Math.max(0, argInt(args, 'offset', 0))
    const limit = Math.max(1, Math.min(argInt(args, 'limit', 20), 50))
    const keyword = (argString(args, 'keyword', '') || '').trim()
    const filtered = keyword === '' ? entries : entries.filter((entry) =>
      entry.title.toLowerCase().includes(keyword.toLowerCase()) ||
      entry.keys.some((k) => k.toLowerCase().includes(keyword.toLowerCase())) ||
      entry.content.toLowerCase().includes(keyword.toLowerCase()))
    return {
      ok: true, name,
      payload: {
        total: filtered.length,
        offset,
        limit,
        entries: filtered.slice(offset, offset + limit).map((entry) => ({
          id: entry.id,
          title: entry.title,
          keys: [...entry.keys],
          constant: entry.constant,
          insertionOrder: entry.insertionOrder,
        })),
      },
    }
  }

  loreModelView(entry) {
    return {
      id: entry.id,
      title: entry.title,
      keys: [...entry.keys],
      content: entry.content,
      secondaryKeys: [...entry.secondaryKeys],
      selective: entry.selective,
      constant: entry.constant,
      insertionOrder: entry.insertionOrder,
      depth: entry.depth,
      position: entry.position,
      probability: entry.probability,
      matchWholeWords: entry.matchWholeWords,
      note: entry.note,
      enabled: entry.originalEntry?.enabled ?? true,
    }
  }

  readLore(args, entries = this.session.lore, name = 'read_lore') {
    const ids = argStringArray(args, 'ids')
    if (ids.length === 0) throw new Error('ids 不能为空')
    if (ids.length > 20) throw new Error(`单次最多读取 20 条（收到 ${ids.length} 条）`)
    const found = entries.filter((e) => ids.includes(e.id)).map((e) => this.loreModelView(e))
    const notFound = ids.filter((id) => !entries.some((e) => e.id === id))
    return { ok: true, name, payload: { found, not_found: notFound } }
  }

  setCardFields(patch) {
    const unknown = Object.keys(patch).filter((k) => !CARD_FIELD_WHITELIST.has(k))
    if (unknown.length > 0) {
      throw new Error(`未知 card 字段：${unknown.sort().join(', ')}。合法字段：${[...CARD_FIELD_WHITELIST].sort().join(', ')}`)
    }
    if (this.session.kind === 'WorldBook') {
      const unsupported = Object.keys(patch).filter((k) => k !== 'name')
      if (unsupported.length > 0) {
        throw new Error(`世界书会话只能用 name 修改世界书名称，不支持：${unsupported.sort().join(', ')}`)
      }
      const name = typeof patch.name === 'string' ? patch.name.trim() : ''
      if (!name) throw new Error('name 不能为空')
      this.session = { ...this.session, worldName: name, nextLoreNumber: this.loreIdCursor, updatedAt: Date.now() }
      return { ok: true, name: 'set_card_fields', payload: { applied: ['name'], world_name: name } }
    }
    for (const [key, type] of Object.entries(CARD_FIELD_TYPES)) {
      if (!(key in patch)) continue
      const value = patch[key]
      const bad = type === 'stringArray'
        ? (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))
        : typeof value !== 'string'
      if (bad) throw new Error(`${key} 的类型不正确`)
    }
    const merged = { ...this.session.card, ...patch }
    this.session = { ...this.session, card: merged, nextLoreNumber: this.loreIdCursor, updatedAt: Date.now() }
    return {
      ok: true, name: 'set_card_fields',
      payload: { applied: Object.keys(patch).sort(), card: { ...merged } },
    }
  }

  normalizeLoreKeys(incoming) {
    const out = {}
    for (const [key, value] of Object.entries(incoming)) {
      if (SYSTEM_MANAGED_LORE_FIELDS.has(key)) continue
      out[LORE_KEY_ALIASES[key] ?? key] = value
    }
    return out
  }

  creationWarnings(entry) {
    const warnings = []
    if (entry.title.trim() === '') warnings.push('缺少标题')
    if (entry.content.trim() === '') warnings.push('缺少内容')
    if (!entry.constant && !entry.keys.some((k) => k.trim() !== '')) {
      warnings.push('非常驻条目缺少触发词 keys，保存前需补齐')
    }
    return warnings
  }

  titleConflictWarnings(entry, id, list) {
    if (entry.title.trim() !== '' && list.some((other) => other.id !== id &&
      other.title.trim().toLowerCase() === entry.title.trim().toLowerCase())) {
      return [`与其他条目同名：${entry.title.trim()}（同名不冲突，但请确认不是笔误）`]
    }
    return []
  }

  upsertLore(args) {
    if (this.loreLocked()) throw new Error('参考世界书只读，当前角色卡的世界书修改未获授权。请只填写角色字段；用户可在关联创作中审核嵌入，或开启允许 AI 编辑卡内世界书。')
    const entries = args.entries
    if (!Array.isArray(entries)) throw new Error('缺少 entries 数组')
    if (entries.length === 0) throw new Error('entries 不能为空')
    if (entries.length > 20) throw new Error(`单次最多处理 20 条（收到 ${entries.length} 条），请分多轮打包`)
    const working = [...this.session.lore]
    const outcomes = []
    const notFound = []
    for (const element of entries) {
      if (!element || typeof element !== 'object' || Array.isArray(element)) {
        throw new Error('entries 中的每一项必须是 JSON 对象')
      }
      const normalized = this.normalizeLoreKeys(element)
      validateLoreFields(normalized)
      const unknownKeys = Object.keys(normalized).filter((k) => !LORE_WRITABLE_FIELDS.has(k))
      const unknownWarnings = unknownKeys.sort().map((k) => `未识别字段被忽略：${k}（合法字段见工具说明）`)
      const id = typeof normalized.id === 'string' ? normalized.id : null
      if (!id || id.trim() === '') {
        const { id: _ignored, ...rest } = normalized
        const created = { ...emptyLore(), ...rest, id: this.nextLoreId() }
        working.push(created)
        outcomes.push({
          id: created.id,
          status: 'created',
          fields: Object.keys(normalized).filter((k) => k !== 'id').sort(),
          warnings: [...unknownWarnings, ...this.creationWarnings(created)],
        })
      } else {
        const index = working.findIndex((e) => e.id === id)
        if (index < 0) {
          notFound.push(id)
          continue
        }
        const { id: _ignored, ...rest } = normalized
        const updated = { ...working[index], ...rest }
        working[index] = updated
        outcomes.push({
          id: updated.id,
          status: 'updated',
          fields: Object.keys(normalized).filter((k) => k !== 'id').sort(),
          warnings: [...unknownWarnings, ...this.titleConflictWarnings(updated, id, working)],
        })
      }
    }
    this.session = { ...this.session, lore: working, nextLoreNumber: this.loreIdCursor, updatedAt: Date.now() }
    return { ok: true, name: 'upsert_lore', payload: { results: outcomes, not_found: notFound } }
  }

  removeLore(args) {
    if (this.loreLocked()) throw new Error('当前角色卡的世界书受保护，请由用户开启允许 AI 编辑卡内世界书。')
    const ids = argStringArray(args, 'ids')
    if (ids.length === 0) throw new Error('ids 不能为空')
    const removed = this.session.lore.filter((e) => ids.includes(e.id))
      .map((e) => ({ id: e.id, title: e.title }))
    const notFound = ids.filter((id) => !this.session.lore.some((e) => e.id === id))
    this.session = {
      ...this.session,
      lore: this.session.lore.filter((e) => !ids.includes(e.id)),
      updatedAt: Date.now(),
    }
    return { ok: true, name: 'remove_lore', payload: { removed, not_found: notFound } }
  }
}
