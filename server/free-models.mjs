export function normalizeFreeModels(raw, legacyId = '', legacyName = '站内免费模型') {
  if (raw === undefined || raw === null || raw === '') {
    return legacyId ? [{ id: legacyId, name: legacyName }] : []
  }
  let entries = raw
  if (typeof raw === 'string') {
    try { entries = JSON.parse(raw) } catch { throw new Error('FREE_MODELS 必须是 JSON 数组') }
  }
  if (!Array.isArray(entries)) throw new Error('freeModels 必须是数组')
  const seen = new Set()
  return entries.map((entry) => {
    const id = typeof entry?.id === 'string' ? entry.id.trim() : ''
    if (!id || seen.has(id)) throw new Error('免费模型 id 不能为空或重复')
    seen.add(id)
    const model = { id, name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id }
    for (const property of ['ratePerMinute', 'dailyRequestsPerIp', 'enabled']) {
      if (entry[property] !== undefined) model[property] = entry[property]
    }
    return model
  })
}

export function selectFreeModel(models, requested) {
  if (requested === undefined || requested === '') return models[0] ?? null
  if (typeof requested !== 'string') return null
  return models.find((model) => model.id === requested) ?? null
}
