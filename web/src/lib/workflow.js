import { newSession, withAssignedLoreIds, sanitizeCard, exportWorldBookJson } from './models.js'

const copy = (value) => value == null ? null : JSON.parse(JSON.stringify(value))
export const draftName = (session) => (session.kind === 'Character' ? session.card.name : session.worldName) || (session.kind === 'Character' ? '未命名角色卡' : '未命名世界书')

// 保存完整、无循环的参考快照。来源草稿删除后仍可阅读；刷新由用户明确触发。
export function referenceFromSession(source) {
  source = withAssignedLoreIds(source)
  return sanitizeCard(copy({
    id: source.id, kind: source.kind, name: draftName(source), capturedAt: Date.now(),
    card: source.card, worldName: source.worldName, lore: source.lore,
    originalBook: source.originalBook,
  }))
}

export function attachReference(target, source) {
  if (target.id === source.id || target.kind === source.kind) throw new Error('请选择另一种类型的草稿作为参考')
  return { ...target, reference: referenceFromSession(source), allowLoreEdits: false, pendingRun: null, updatedAt: Date.now() }
}

export function continueFromSession(source, role = 'person') {
  const target = newSession(source.kind === 'WorldBook' ? 'Character' : 'WorldBook')
  if (target.kind === 'WorldBook') {
    target.worldName = source.worldName || `${draftName(source)}世界书`
    target.lore = copy(source.lore)
    target.originalBook = copy(source.originalBook)
  }
  const text = target.kind === 'Character'
    ? `【创作起点】根据关联世界书创作${role === 'director' ? '导演卡：负责场景、事件和配角的推进，尊重玩家自主性' : '人物角色卡'}。先阅读参考目录和相关条目，遵循既有设定；先制作角色字段，不添加或改写世界书。参考世界书将在审核后由用户嵌入。`
    : '【创作起点】根据关联角色卡扩写独立世界书。先阅读来源角色的完整字段和已有条目，保持人物与世界设定一致；不要修改来源角色卡。完成后可返回角色卡审核、嵌入并导出。'
  target.turns = [{ role: 'user', text }]
  return withAssignedLoreIds(attachReference(target, source))
}

function entrySignature(entry) {
  const raw = exportWorldBookJson({ ...newSession('WorldBook'), lore: [entry] }).entries['0']
  delete raw.uid
  const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value
  return JSON.stringify(stable(raw))
}

// 原书条目有稳定来源身份；同名不同内容须显式审核，不静默覆盖。
export function embeddingPlan(target, reference = target.reference) {
  if (target.kind !== 'Character' || reference?.kind !== 'WorldBook') throw new Error('只有角色卡可以嵌入参考世界书')
  const matched = new Set()
  const bySignature = new Map(target.lore.map((entry) => [entrySignature(entry), entry]))
  return reference.lore.map((entry) => {
    const same = bySignature.get(entrySignature(entry))
    const previous = target.lore.find((item) => item.linkedOrigin?.sessionId === reference.id && item.linkedOrigin?.entryId === entry.id)
    const named = target.lore.find((item) => !matched.has(item.id) && item.title.trim() && item.title.trim() === entry.title.trim())
    const conflict = previous || named
    if (same || conflict) matched.add((same || conflict).id)
    return { entry, status: same ? 'identical' : conflict ? 'conflict' : 'new', targetId: (same || conflict)?.id ?? null }
  })
}

export function embedReferenceEntries(target, selectedIds) {
  const selected = new Set(selectedIds)
  const plan = embeddingPlan(target)
  const next = { ...target, lore: copy(target.lore), updatedAt: Date.now() }
  let cursor = Math.max(target.nextLoreNumber || 0, ...target.lore.map((e) => Number(String(e.id).replace(/^L/, '')) || 0))
  for (const row of plan) {
    if (!selected.has(row.entry.id) || row.status === 'identical') continue
    const entry = { ...copy(row.entry), id: row.targetId || `L${++cursor}`,
      linkedOrigin: { sessionId: target.reference.id, entryId: row.entry.id } }
    const index = next.lore.findIndex((item) => item.id === row.targetId)
    if (index >= 0) next.lore[index] = entry
    else next.lore.push(entry)
  }
  if (!target.lore.length && next.lore.length) {
    next.worldName = target.reference.worldName || target.reference.name
    next.originalBook = copy(target.reference.originalBook)
  }
  next.nextLoreNumber = cursor
  // 审核改变了工具目标，旧的中断工具计划不能继续执行；历史回复保持不变。
  next.pendingRun = null
  return next
}
