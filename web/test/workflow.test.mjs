import test from 'node:test'
import assert from 'node:assert/strict'
import { newSession, emptyLore, sessionFromCharacterCard, sessionFromWorldBookJson, exportCardJson, exportWorldBookJson } from '../src/lib/models.js'
import { continueFromSession, attachReference, embeddingPlan, embedReferenceEntries } from '../src/lib/workflow.js'
import { ToolBox } from '../src/lib/toolbox.js'
import { converse } from '../src/lib/engine.js'
import { embedCardJson, extractCardJson } from '../src/lib/png.js'

function book() {
  return sessionFromWorldBookJson({ name: '雾港', scan_depth: 5, token_budget: 1800, extensions: { customBook: '保留' }, entries: {
    '0': { uid: 7, key: ['雾港'], keysecondary: ['夜间'], comment: '雾港规则', content: '雾港禁止明火。', order: 42, selective: true, disable: true, position: 4, depth: 6, probability: 65, group: '禁令', scanDepth: 3, excludeRecursion: true, sticky: 2, customTop: '自定义', extensions: { plugin: '保留' } },
    '1': { uid: 8, key: ['引路人'], comment: '引路人', content: '引路人只在白天上岸。' },
  } })
}

test('世界书到人物/导演卡：完整只读快照，不复制未审核条目，不带来源运行状态', () => {
  const source = book()
  source.pendingRun = { history: [{ content: '旧请求' }] }
  source.sourceLength = 4000
  const card = continueFromSession(source, 'director')
  assert.equal(card.kind, 'Character')
  assert.equal(card.lore.length, 0)
  assert.equal(card.pendingRun, null)
  assert.equal(card.sourceLength, 0)
  assert.match(card.turns[0].text, /导演卡/)
  assert.equal(card.reference.lore.length, 2)
  source.lore[0].content = '来源后来修改'
  assert.equal(card.reference.lore[0].content, '雾港禁止明火。')
})

test('角色到世界书：参考全字段，复制内嵌条目，保留原卡', () => {
  const card = newSession('Character')
  card.card.name = '引路人'
  card.card.description = '不能在夜晚上岸。'
  card.card.firstMessage = '雾来了。'
  card.lore = [{ ...emptyLore(), id: 'L3', title: '码头', keys: ['码头'], content: '关闭于日落。' }]
  const before = JSON.stringify(card)
  const target = continueFromSession(card)
  const box = new ToolBox(target)
  assert.equal(box.execute({ name: 'read_reference', arguments: {} }).payload.card.firstMessage, '雾来了。')
  box.execute({ name: 'upsert_lore', arguments: { entries: [{ id: 'L3', content: '关闭于正午。' }] } })
  assert.equal(box.session.lore[0].content, '关闭于正午。')
  assert.equal(JSON.stringify(card), before)
  assert.equal(target.card.name, '')
})

test('参考世界书分页和全文读取与当前草稿隔离，AI 未获允许不能新增/删除条目', () => {
  const source = book()
  source.lore.push(...Array.from({ length: 52 }, (_, i) => ({ ...emptyLore(), id: `L${i + 3}`, title: `地点${i}`, content: `完整正文${i}`, keys: [`地点${i}`] })))
  const box = new ToolBox(continueFromSession(source))
  const index = box.execute({ name: 'list_reference_lore', arguments: { offset: 50, limit: 50 } })
  assert.equal(index.payload.total, 54)
  assert.equal(index.payload.entries.length, 4)
  const read = box.execute({ name: 'read_reference_lore', arguments: { ids: ['L54', 'L404'] } })
  assert.equal(read.payload.found[0].content, '完整正文51')
  assert.deepEqual(read.payload.not_found, ['L404'])
  assert.equal(box.execute({ name: 'list_lore', arguments: {} }).payload.total, 0)
  assert.equal(box.execute({ name: 'upsert_lore', arguments: { entries: [{ title: '擅自新增', content: 'x', keys: ['x'] }] } }).ok, false)
  assert.equal(box.execute({ name: 'remove_lore', arguments: { ids: ['L1'] } }).ok, false)
  box.session = { ...box.session, allowLoreEdits: true }
  assert.equal(box.execute({ name: 'upsert_lore', arguments: { entries: [{ title: '获准新增', content: 'x', keys: ['x'] }] } }).ok, true)
  assert.equal(source.lore.length, 54)
})

test('审核嵌入：选择、重复跳过、显式替换冲突、刷新引用均不修改来源', () => {
  const source = book()
  const card = continueFromSession(source)
  card.card.name = '测试人物'
  const one = embedReferenceEntries(card, ['L1'])
  assert.equal(one.lore.length, 1)
  assert.equal(one.originalBook.token_budget, 1800)
  assert.equal(embedReferenceEntries(one, ['L1']).lore.length, 1)
  const stableId = one.lore[0].id
  source.lore[0].content = '新规则：禁止明火和鸣笛。'
  const refreshed = attachReference(one, source)
  const plan = embeddingPlan(refreshed)
  assert.equal(plan[0].status, 'conflict')
  assert.equal(embedReferenceEntries(refreshed, ['L2']).lore[0].content, '雾港禁止明火。')
  const replaced = embedReferenceEntries(refreshed, ['L1', 'L2'])
  assert.equal(replaced.lore[0].id, stableId)
  assert.equal(replaced.lore[0].content, source.lore[0].content)
  assert.equal(source.lore.length, 2)
})

test('同名冲突不静默覆盖，旧卡字段/扩展保留，不递归保存参考关系', () => {
  const original = sessionFromCharacterCard({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: '原卡', description: '原描述', first_mes: '旧开场', extensions: { plugin: { keep: true } } } })
  original.lore = [{ ...emptyLore(), id: 'L10', title: '雾港规则', keys: ['雾港'], content: '旧版规则。' }]
  const source = continueFromSession(original)
  source.lore[0].content = '新规则。'
  const linked = attachReference(original, source)
  assert.equal(linked.reference.reference, undefined)
  const result = embedReferenceEntries(linked, [])
  assert.equal(result.lore[0].content, '旧版规则。')
  const json = exportCardJson(embedReferenceEntries(linked, ['L10']))
  assert.equal(json.spec, 'chara_card_v3')
  assert.equal(json.data.first_mes, '旧开场')
  assert.deepEqual(json.data.extensions.plugin, { keep: true })
})

test('标准内嵌数组导出/导入与独立世界书转换：原生触发属性及 book/entry 未知字段保留', () => {
  const card = continueFromSession(book())
  card.card.name = '巡夜人'
  const embedded = embedReferenceEntries(card, ['L1', 'L2'])
  const json = exportCardJson(embedded)
  const cb = json.data.character_book
  assert.ok(Array.isArray(cb.entries))
  assert.equal(cb.scan_depth, 5)
  assert.deepEqual(cb.extensions, { customBook: '保留' })
  const first = cb.entries[0]
  assert.equal(first.id, 7)
  assert.deepEqual(first.keys, ['雾港'])
  assert.equal(first.enabled, false)
  assert.equal(first.insertion_order, 42)
  assert.equal(first.extensions.position, 4)
  assert.equal(first.extensions.probability, 65)
  assert.equal(first.extensions.sticky, 2)
  assert.equal(first.extensions.exclude_recursion, true)
  assert.equal(first.customTop, '自定义')
  assert.equal(first.extensions.plugin, '保留')
  const loaded = sessionFromCharacterCard(json)
  assert.equal(loaded.lore.length, 2)
  assert.equal(loaded.lore[0].originalEntry.enabled, false)
  const standalone = exportWorldBookJson(loaded)
  assert.equal(standalone.entries['0'].uid, 7)
  assert.equal(standalone.entries['0'].position, 4)
  assert.equal(standalone.entries['0'].sticky, 2)
  assert.equal(standalone.entries['0'].scanDepth, 3)
  assert.equal(standalone.entries['0'].disable, true)
  assert.equal(standalone.entries['0'].customTop, '自定义')
})

test('标准原生卡数组可导入，修改后保留未知扩展与字段；旧对象格式也继续兼容', () => {
  const raw = { data: { name: '标准卡', character_book: { name: '标准书', extensions: { keep: true }, entries: [
    { id: 30, keys: ['K'], secondary_keys: ['S'], comment: 'T', content: 'C', enabled: true, insertion_order: 88,
      position: 'before_char', extensions: { depth: 7, group: 'G', position: 0, custom: true }, extra: '原字段' },
  ] } } }
  const loaded = sessionFromCharacterCard(raw)
  assert.equal(loaded.lore.length, 1)
  loaded.lore[0].content = '编辑后'
  const exported = exportCardJson(loaded).data.character_book.entries[0]
  assert.equal(exported.id, 30)
  assert.equal(exported.content, '编辑后')
  assert.equal(exported.extensions.custom, true)
  assert.equal(exported.extra, '原字段')
  const legacy = sessionFromCharacterCard({ data: { name: '旧卡', character_book: { entries: { 0: { uid: 4, key: ['K'], comment: 'T', content: 'C' } } } } })
  assert.equal(legacy.lore.length, 1)
  assert.ok(Array.isArray(exportCardJson(legacy).data.character_book.entries))
})

test('合并时来源重复 uid 重分配，酒馆反向转换不会丢失条目', () => {
  const source = book()
  source.lore[1].originalEntry.raw.uid = 7
  const target = continueFromSession(source)
  target.card.name = 'UID测试'
  const entries = exportCardJson(embedReferenceEntries(target, ['L1', 'L2'])).data.character_book.entries
  assert.equal(new Set(entries.map((e) => e.id)).size, 2)
})

test('更换参考使旧工具计划失效，但保留中断回复和所有已有对话', () => {
  const target = newSession('Character')
  target.turns = [{ role: 'user', text: '已有对话' }]
  target.pendingRun = { round: 3 }
  target.pendingReplies = [{ role: 'agent', text: '已有部分回复' }]
  const result = attachReference(target, book())
  assert.equal(result.pendingRun, null)
  assert.deepEqual(result.turns, target.turns)
  assert.deepEqual(result.pendingReplies, target.pendingReplies)
})

test('只改变原生触发配置也会进入冲突审核，同名多条不重复覆盖一个目标', () => {
  const source = book()
  let card = continueFromSession(source)
  card = embedReferenceEntries(card, ['L1'])
  source.lore[0].originalEntry.group = '新分组'
  source.lore[1].title = source.lore[0].title
  const linked = attachReference(card, source)
  const plan = embeddingPlan(linked)
  assert.equal(plan[0].status, 'conflict')
  assert.equal(plan[1].status, 'new')
  assert.equal(embedReferenceEntries(linked, ['L1', 'L2']).lore.length, 2)
})

test('关联内容随会话 JSON 持久化，不依赖临时内存', () => {
  const target = JSON.parse(JSON.stringify(continueFromSession(book())))
  assert.equal(new ToolBox(target).execute({ name: 'read_reference_lore', arguments: { ids: ['L1'] } }).payload.found[0].content, '雾港禁止明火。')
  assert.throws(() => attachReference(book(), book()), /另一种类型/)
})

test('新提取且尚未重开的条目也有可读参考 id，删除过的编号不会复用', () => {
  const source = newSession('WorldBook')
  source.nextLoreNumber = 8
  source.lore = [{ ...emptyLore(), content: '新提取正文', keys: ['新'], title: '新条目' }]
  const target = continueFromSession(source)
  assert.equal(target.reference.lore[0].id, 'L9')
  assert.equal(new ToolBox(target).execute({ name: 'read_reference_lore', arguments: { ids: ['L9'] } }).payload.found[0].content, '新提取正文')
})

test('脚本化模型完整工具回路：读取参考、拒绝越权世界书写入、保存人物字段', async () => {
  const script = [
    '<tool_call>{"name":"read_reference","arguments":{}}</tool_call><tool_call>{"name":"list_reference_lore","arguments":{"offset":0,"limit":20}}</tool_call>',
    '<tool_call>{"name":"read_reference_lore","arguments":{"ids":["L1","L2"]}}</tool_call>',
    '<tool_call>{"name":"upsert_lore","arguments":{"entries":[{"title":"私自新增","keys":["x"],"content":"x"}]}}</tool_call><tool_call>{"name":"set_card_fields","arguments":{"name":"引路人","description":"只在白天上岸，不携明火。"}}</tool_call>',
    '人物初稿已完成，请审核后嵌入世界书。',
  ]
  let n = 0
  const events = []
  const result = await converse({ session: continueFromSession(book()), userText: '生成初稿',
    generate: async (history) => {
      if (n === 2) assert.ok(history.some((m) => m.content.includes('雾港禁止明火。')))
      return { text: script[n++], finishReason: 'stop' }
    }, onToolEvent: (event) => events.push(event) })
  assert.equal(result.session.card.name, '引路人')
  assert.equal(result.session.lore.length, 0)
  assert.equal(result.session.reference.lore.length, 2)
  assert.ok(events.some((e) => e.name === 'upsert_lore' && !e.ok))
})

test('嵌入世界书可通过 PNG 字符块导出并完整回读', async () => {
  const source = book()
  const target = continueFromSession(source)
  target.card.name = 'PNG测试'
  const json = exportCardJson(embedReferenceEntries(target, ['L1', 'L2']))
  const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64'))
  const decoded = await extractCardJson(embedCardJson(png, json))
  assert.equal(sessionFromCharacterCard(decoded).lore.length, 2)
  assert.deepEqual(decoded.data.character_book, json.data.character_book)
})
