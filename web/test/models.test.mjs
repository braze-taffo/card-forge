// 数据模型测试：会话构造、V2 导出回读、世界书序列化、脱敏、可移植检查、工具箱。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  newSession, sessionFromCharacterCard, sessionFromWorldBookJson, withAssignedLoreIds,
  exportCardJson, exportWorldBookJson, parseCharacterCardJson, portableFrontendIssues, sanitizeCard,
} from '../src/lib/models.js'
import { ToolBox } from '../src/lib/toolbox.js'

function makeLore(overrides = {}) {
  return {
    title: '条目', keys: ['关键词'], content: '内容', secondaryKeys: [], selective: false,
    constant: false, insertionOrder: 100, depth: 4, position: 0, probability: 100,
    matchWholeWords: false, sourceQuote: '', sourceOffset: -1, sourceName: '', sourceSha256: '',
    note: '', id: '', originalEntry: null, ...overrides,
  }
}

test('会话 → V2 导出 → 回读：字段与开场拼接一致', () => {
  const session = newSession('Character')
  session.card = {
    ...session.card,
    name: '测试角色',
    description: '描述',
    firstMessage: '开场正文',
    frontendHtml: '<div style="color:red">面板</div>',
    alternateGreetings: ['备选一', '备选二'],
    systemPrompt: '系统提示',
    tags: ['原创'],
  }
  session.lore = [makeLore({ title: '设定一', keys: ['设定'], content: '设定内容', id: 'L1' })]
  const json = exportCardJson(session)
  assert.equal(json.spec, 'chara_card_v2')
  assert.equal(json.data.name, '测试角色')
  assert.equal(json.data.first_mes, '开场正文\n\n<div style="color:red">面板</div>')
  assert.equal(json.data.alternate_greetings.length, 2)
  assert.ok(json.data.alternate_greetings[0].includes('备选一'))
  assert.ok(json.data.alternate_greetings[0].includes('面板'))
  assert.equal(json.data.character_book.entries['0'].comment, '设定一')
  assert.equal(json.data.character_book.name, '测试角色')
  // 回读
  const reparsed = parseCharacterCardJson(json)
  assert.equal(reparsed.name, '测试角色')
  assert.equal(reparsed.firstMessage, json.data.first_mes)
  assert.equal(reparsed.alternateGreetings.length, 2)
})

test('导入已有卡再导出：保留来源未知字段与 fav', () => {
  const raw = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '原卡',
      description: '原描述',
      first_mes: '原开场',
      fav: true,
      custom_extension_field: { deep: [1, 2] },
      extensions: { regex_scripts: [{ id: 'r1', scriptName: '测试正则', findRegex: 'a', replaceString: 'b', placement: [2] }] },
      character_book: { name: '原书', entries: { '0': { uid: 5, key: ['旧键'], content: '旧内容', comment: '旧条目', constant: true } } },
    },
  }
  const session = sessionFromCharacterCard(raw)
  assert.equal(session.card.name, '原卡')
  assert.equal(session.lore.length, 1)
  assert.match(session.lore[0].id, /^L\d+$/)
  // 编辑后导出
  session.card.name = '改名'
  session.lore[0].content = '新内容'
  const json = exportCardJson(session)
  assert.equal(json.data.fav, true)
  assert.deepEqual(json.data.custom_extension_field, { deep: [1, 2] })
  assert.equal(json.data.extensions.regex_scripts[0].scriptName, '测试正则')
  assert.equal(json.data.character_book.entries[0].id, 5)
  assert.equal(json.data.character_book.entries['0'].content, '新内容')
  assert.equal(json.data.character_book.entries[0].keys[0], '旧键')
})

test('独立世界书导出：条目数一致 + book 级字段保留', () => {
  const raw = { name: '原书', originalData: { x: 1 }, entries: { '0': { uid: 1, key: ['k'], content: 'c', comment: 't' } } }
  const session = sessionFromWorldBookJson(raw)
  session.worldName = '新书名'
  session.lore.push(makeLore({ title: '新条目', keys: ['n'], content: 'nc', id: 'L9' }))
  const json = exportWorldBookJson(session)
  assert.equal(json.name, '新书名')
  assert.deepEqual(json.originalData, { x: 1 })
  assert.equal(Object.keys(json.entries).length, 2)
  assert.equal(json.entries['0'].uid, 1)
})

test('withAssignedLoreIds 补齐空 id 且不复用编号', () => {
  const session = newSession('WorldBook')
  session.lore = [makeLore({ id: 'L2' }), makeLore({ id: '' }), makeLore({ id: '' })]
  const filled = withAssignedLoreIds(session)
  assert.equal(filled.lore[1].id, 'L1')
  assert.equal(filled.lore[2].id, 'L3')
  assert.ok(filled.nextLoreNumber >= 3)
})

test('旧提炼草稿缺少辅助关键词时可直接导出世界书和角色卡，不修改原草稿', () => {
  for (const kind of ['WorldBook', 'Character']) {
    const session = newSession(kind)
    session.card.name = '角色'
    session.worldName = '北境'
    session.lore = [{ title: '青石城', keys: ['青石城'], content: '青石城位于北境。',
      constant: false, sourceQuote: '青石城位于北境。', sourceOffset: 12, sourceName: 'novel.txt' }]
    const before = structuredClone(session)
    const json = kind === 'WorldBook' ? exportWorldBookJson(session) : exportCardJson(session)
    const reopened = kind === 'WorldBook' ? sessionFromWorldBookJson(json) : sessionFromCharacterCard(json)
    assert.equal(reopened.lore.length, 1)
    assert.equal(reopened.lore[0].content, session.lore[0].content)
    assert.deepEqual(reopened.lore[0].keys, ['青石城'])
    assert.deepEqual(reopened.lore[0].secondaryKeys, [])
    assert.equal(reopened.lore[0].selective, false)
    assert.equal(reopened.lore[0].insertionOrder, 100)
    assert.equal(reopened.lore[0].probability, 100)
    assert.deepEqual(session, before)
  }
})

test('导出兼容旧草稿中非数组的关键词字段，合法关键词仍去重并保留', () => {
  for (const value of [undefined, null, {}, 42, '关键词']) {
    const session = newSession('WorldBook')
    session.lore = [makeLore({ keys: value, secondaryKeys: value, constant: true, selective: true }),
      makeLore({ keys: [' 城 ', null, '城', 7, '北境'], secondaryKeys: [' 门 ', null, '门'], selective: true })]
    const before = structuredClone(session)
    const book = exportWorldBookJson(session)
    assert.deepEqual(book.entries[0].key, [])
    assert.deepEqual(book.entries[0].keysecondary, [])
    assert.equal(book.entries[0].constant, true)
    assert.equal(book.entries[0].selective, false)
    assert.deepEqual(book.entries[1].key, ['城', '北境'])
    assert.deepEqual(book.entries[1].keysecondary, ['门'])
    assert.equal(book.entries[1].selective, true)
    assert.deepEqual(session, before)
  }
})

test('可移植前端检查', () => {
  assert.equal(portableFrontendIssues('').length, 0)
  assert.equal(portableFrontendIssues('<div style="x:1">ok</div>').length, 0)
  assert.ok(portableFrontendIssues('<script>a()</script>').includes('frontendScript'))
  assert.ok(portableFrontendIssues('<div onclick="x">').includes('frontendInlineEvent'))
  assert.ok(portableFrontendIssues('<img src="a">').length >= 2) // 禁止标签 + 外链
  assert.ok(portableFrontendIssues('{{user}}').includes('frontendTemplateVar'))
})

test('敏感字段脱敏', () => {
  const out = sanitizeCard({
    name: '正常',
    api_key: 'sk-abcdefabcdefabcdefabcdef',
    nested: { password: '123456', keep: '保留' },
  })
  assert.equal(out.api_key, '[REDACTED]')
  assert.equal(out.nested.password, '[REDACTED]')
  assert.equal(out.nested.keep, '保留')
})

// ---------------------------------------------------------------- 工具箱

test('upsert_lore：新建、更新、别名映射、系统字段忽略', () => {
  const session = newSession('WorldBook')
  const box = new ToolBox(session)
  const created = box.execute({ name: 'upsert_lore', arguments: { entries: [
    { title: 'A', key: ['别名键'], content: '内容A', order: 5, sourceQuote: '不应写入' },
  ] } })
  assert.ok(created.ok)
  assert.equal(box.session.lore.length, 1)
  assert.deepEqual(box.session.lore[0].keys, ['别名键'])
  assert.equal(box.session.lore[0].insertionOrder, 5)
  assert.equal(box.session.lore[0].sourceQuote, '')
  assert.equal(created.payload.results[0].status, 'created')
  const id = created.payload.results[0].id
  // 更新：只发改动字段
  const updated = box.execute({ name: 'upsert_lore', arguments: { entries: [{ id, content: '新内容' }] } })
  assert.ok(updated.ok)
  assert.equal(updated.payload.results[0].status, 'updated')
  assert.equal(box.session.lore[0].content, '新内容')
  assert.equal(box.session.lore[0].title, 'A')
  // 不存在的 id → not_found
  const missing = box.execute({ name: 'upsert_lore', arguments: { entries: [{ id: 'L999', content: 'x' }] } })
  assert.deepEqual(missing.payload.not_found, ['L999'])
})

test('upsert_lore：超过 20 条拒绝', () => {
  const box = new ToolBox(newSession('WorldBook'))
  const entries = Array.from({ length: 21 }, (_, i) => ({ title: `t${i}`, keys: ['k'], content: 'c' }))
  const result = box.execute({ name: 'upsert_lore', arguments: { entries } })
  assert.equal(result.ok, false)
  assert.match(result.payload.error, /最多处理 20 条/)
})

test('set_card_fields：白名单、字段校验、世界书限制', () => {
  const box = new ToolBox(newSession('Character'))
  const ok = box.execute({ name: 'set_card_fields', arguments: { name: '新名', frontendHtml: '<div>x</div>' } })
  assert.ok(ok.ok)
  assert.deepEqual(ok.payload.applied, ['frontendHtml', 'name'])
  assert.equal(box.session.card.name, '新名')

  const bad = box.execute({ name: 'set_card_fields', arguments: { nope: 1 } })
  assert.equal(bad.ok, false)
  assert.match(bad.payload.error, /未知 card 字段/)

  const wrongType = box.execute({ name: 'set_card_fields', arguments: { tags: 'not-array' } })
  assert.equal(wrongType.ok, false)

  const wb = new ToolBox(newSession('WorldBook'))
  const wbName = wb.execute({ name: 'set_card_fields', arguments: { name: '书名' } })
  assert.ok(wbName.ok)
  assert.equal(wb.session.worldName, '书名')
  const wbBad = wb.execute({ name: 'set_card_fields', arguments: { description: 'x' } })
  assert.equal(wbBad.ok, false)
  assert.match(wbBad.payload.error, /只能用 name/)
})

test('read_card / list_lore / read_lore / remove_lore 载荷形状', () => {
  const session = newSession('WorldBook')
  session.lore = [makeLore({ id: 'L1', title: '一', keys: ['a'], constant: true }), makeLore({ id: 'L2', title: '二', keys: ['b'] })]
  const box = new ToolBox(session)
  const card = box.execute({ name: 'read_card', arguments: {} })
  assert.equal(card.payload.kind, '世界书')
  assert.equal(card.payload.lore_count, 2)
  assert.ok(card.payload.card && 'frontendHtml' in card.payload.card)

  const list = box.execute({ name: 'list_lore', arguments: { offset: 0, limit: 1 } })
  assert.equal(list.payload.total, 2)
  assert.equal(list.payload.entries.length, 1)
  assert.equal(list.payload.entries[0].id, 'L1')

  const read = box.execute({ name: 'read_lore', arguments: { ids: ['L1', 'L404'] } })
  assert.equal(read.payload.found.length, 1)
  assert.deepEqual(read.payload.not_found, ['L404'])
  assert.equal(read.payload.found[0].title, '一')

  const removed = box.execute({ name: 'remove_lore', arguments: { ids: ['L1'] } })
  assert.equal(removed.payload.removed[0].id, 'L1')
  assert.equal(box.session.lore.length, 1)
})

test('id 单调：删除后不复用', () => {
  const box = new ToolBox(newSession('WorldBook'))
  const first = box.execute({ name: 'upsert_lore', arguments: { entries: [{ title: 'a', keys: ['k'], content: 'c' }] } })
  const id1 = first.payload.results[0].id
  box.execute({ name: 'remove_lore', arguments: { ids: [id1] } })
  const second = box.execute({ name: 'upsert_lore', arguments: { entries: [{ title: 'b', keys: ['k'], content: 'c' }] } })
  const id2 = second.payload.results[0].id
  assert.notEqual(id1, id2)
})

test('高级资源：脚本与变量（仅角色卡）', () => {
  const box = new ToolBox(newSession('Character'))
  box.session = { ...box.session, card: { ...box.session.card, name: '资源卡' } }
  const script = box.execute({ name: 'upsert_script', arguments: { name: '状态栏', content: 'console.log(1)', enabled: false } })
  assert.ok(script.ok)
  assert.equal(script.payload.status, 'created')
  const id = script.payload.id

  const listed = box.execute({ name: 'list_assets', arguments: {} })
  assert.equal(listed.payload.scripts.length, 1)
  assert.equal(listed.payload.scripts[0].name, '状态栏')

  const read = box.execute({ name: 'read_script', arguments: { id } })
  assert.equal(read.payload.content, 'console.log(1)')

  const appended = box.execute({ name: 'upsert_script', arguments: { id, content: 'more', mode: 'append' } })
  assert.equal(appended.payload.content_chars, 'console.log(1)more'.length)

  const vars = box.execute({ name: 'set_variables', arguments: { values: { 体力: { value: 100 } } } })
  assert.ok(vars.ok)
  const readVars = box.execute({ name: 'read_variables', arguments: { names: ['体力'] } })
  assert.deepEqual(readVars.payload.values, { 体力: { value: 100 } })

  // 导出时进入 extensions
  const json = exportCardJson(box.session)
  assert.equal(json.data.extensions.tavern_helper.scripts.length, 1)
  assert.deepEqual(json.data.extensions.tavern_helper.variables, { 体力: { value: 100 } })

  const wbBox = new ToolBox(newSession('WorldBook'))
  const rejected = wbBox.execute({ name: 'list_assets', arguments: {} })
  assert.equal(rejected.ok, false)
  assert.match(rejected.payload.error, /只能写入角色卡/)
})

test('未知工具报错并列出可用工具', () => {
  const box = new ToolBox(newSession('Character'))
  const result = box.execute({ name: 'hack_tool', arguments: {} })
  assert.equal(result.ok, false)
  assert.match(result.payload.error, /未知工具/)
})
