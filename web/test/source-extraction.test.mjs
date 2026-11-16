import test from 'node:test'
import assert from 'node:assert/strict'
import { newSession, withAssignedLoreIds, exportWorldBookJson } from '../src/lib/models.js'
import { extractChunk, verifiedLoreFromChunk, mergeExtractedLore, converse } from '../src/lib/engine.js'
import { ToolBox } from '../src/lib/toolbox.js'
import { executeSourceTool } from '../src/lib/source-tools.js'

const source = '青石城位于北境。城中禁止明火。'
const tool = (name, args) => `<tool_call>${JSON.stringify({ name, arguments: args })}</tool_call>`

test('提示词规定的提炼结果能保存、按正文检索、按 ID 读取并导出', async () => {
  const chunk = { start: 0, end: source.length, text: source }
  const reply = await extractChunk({ chunk, sourceName: 'test.txt', onProgress: () => {},
    generate: async () => ({ text: JSON.stringify({ lore: [{ title: '青石城', keys: ['青石城'],
      content: source, constant: false, sourceQuote: source, sourceOffset: -1 }] }) }),
  })
  const session = withAssignedLoreIds({ ...newSession('WorldBook'),
    lore: mergeExtractedLore([], verifiedLoreFromChunk(chunk, reply.lore, 'test.txt', 'source-key')) })
  const entry = session.lore[0]
  assert.equal(entry.id, 'L1')
  assert.deepEqual(entry.secondaryKeys, [])
  assert.equal(entry.secondaryKeys.join(', '), '')
  assert.equal(entry.insertionOrder, 100)
  const box = new ToolBox(session)
  const list = box.execute({ name: 'list_lore', arguments: { keyword: '明火' } })
  assert.equal(list.payload.total, 1)
  const read = box.execute({ name: 'read_lore', arguments: { ids: [list.payload.entries[0].id] } })
  assert.equal(read.ok, true)
  assert.equal(read.payload.found[0].content, source)
  assert.equal(exportWorldBookJson(session).entries[0].content, source)
})

test('四千条旧草稿补齐字段和编号，保留正文、来源、扩展，重开编号稳定', () => {
  const session = newSession('WorldBook')
  session.nextLoreNumber = 5000
  session.lore = Array.from({ length: 4000 }, (_, index) => ({
    title: `地点${index}`, keys: [`地点${index}`], content: `正文${index}`,
    sourceQuote: `证据${index}`, sourceOffset: index, sourceName: 'old.txt',
    customField: { preserved: index }, id: [undefined, null, '', 'L5002'][index % 4],
  }))
  // 只有一个已有编号，其余模拟缺失/null/空字符串。
  session.lore.forEach((entry, index) => { if (index > 3) delete entry.id })
  const repaired = withAssignedLoreIds(session)
  assert.equal(repaired.lore.length, 4000)
  assert.equal(new Set(repaired.lore.map((entry) => entry.id)).size, 4000)
  assert.equal(repaired.lore[3].id, 'L5002')
  for (const [index, entry] of repaired.lore.entries()) {
    assert.equal(entry.content, `正文${index}`)
    assert.equal(entry.sourceQuote, `证据${index}`)
    assert.equal(entry.sourceOffset, index)
    assert.deepEqual(entry.customField, { preserved: index })
    assert.deepEqual(entry.secondaryKeys, [])
  }
  const reopened = JSON.parse(JSON.stringify(repaired))
  assert.equal(withAssignedLoreIds(reopened), reopened)
  assert.equal(session.lore[0].id, undefined)
  const afterDeletion = withAssignedLoreIds({ ...reopened, lore: [{ title: '新地点', keys: [], content: '新正文' }] })
  assert.equal(afterDeletion.lore[0].id, `L${reopened.nextLoreNumber + 1}`)
})

test('旧的只读参考快照同样能补齐，当前草稿与参考编号各自独立', () => {
  const session = newSession('Character')
  session.reference = { kind: 'WorldBook', name: '旧书', lore: [{ title: '城', keys: ['城'], content: source }] }
  const repaired = withAssignedLoreIds(session)
  const read = new ToolBox(repaired).execute({ name: 'read_reference_lore', arguments: { ids: ['L1'] } })
  assert.equal(read.ok, true)
  assert.equal(read.payload.found[0].content, source)
  assert.equal(repaired.lore.length, 0)
})

test('原文搜索可分页，命中正文之外的词，并给出可供读取的绝对位置', async () => {
  const text = '前文。暗号。中段。暗号。尾段。暗号。'
  const session = newSession('WorldBook')
  const run = (args) => executeSourceTool({ name: 'search_source', arguments: args }, session, async () => text)
  const first = await run({ keyword: '暗号', limit: 2 })
  assert.equal(first.ok, true)
  assert.deepEqual(first.payload.matches.map((match) => match.offset), [3, 9])
  assert.ok(first.payload.matches.every((match) => match.text === text.slice(match.start, match.end)))
  const second = await run({ keyword: '暗号', limit: 2, offset: first.payload.next_offset })
  assert.deepEqual(second.payload.matches.map((match) => match.offset), [15])
  assert.equal(second.payload.next_offset, null)
  const none = await run({ keyword: '不存在' })
  assert.deepEqual(none.payload.matches, [])
  assert.equal(none.payload.next_offset, null)
})

test('分段读取覆盖完整原文，单次读取和搜索返回量有上限', async () => {
  const text = '城'.repeat(16001)
  const session = newSession('WorldBook')
  let offset = 0
  let restored = ''
  do {
    const result = await executeSourceTool({ name: 'read_source', arguments: { offset, limit: 99999 } }, session, async () => text)
    assert.equal(result.ok, true)
    assert.ok(result.payload.text.length <= 7000)
    restored += result.payload.text
    offset = result.payload.next_offset
  } while (offset !== null)
  assert.equal(restored, text)
  const search = await executeSourceTool({ name: 'search_source', arguments: { keyword: '城', limit: 999 } }, session, async () => text)
  assert.equal(search.payload.matches.length, 10)
  assert.ok(search.payload.matches.every((match) => match.text.length <= 300))
})

test('原文缺失、读取失败和无效位置返回明确错误，取消操作继续上抛', async () => {
  const session = newSession('WorldBook')
  const call = { name: 'read_source', arguments: {} }
  assert.match((await executeSourceTool(call, session)).payload.error, /原文不存在，请重新导入/)
  assert.match((await executeSourceTool(call, session, async () => { throw new Error('读取失败') })).payload.error, /读取失败/)
  for (const args of [{ offset: -1 }, { offset: 1.5 }, { limit: 0 }, { offset: 1000 }]) {
    assert.equal((await executeSourceTool({ ...call, arguments: args }, session, async () => source)).ok, false)
  }
  assert.equal((await executeSourceTool({ name: 'search_source', arguments: { keyword: ' ' } }, session, async () => source)).ok, false)
  await assert.rejects(executeSourceTool(call, session, async () => { throw new DOMException('停止', 'AbortError') }), { name: 'AbortError' })
})

test('聊天通过文本/原生工具搜索原文、读取命中位置，并拿到完整回执', async () => {
  const session = { ...newSession('WorldBook'), sourceName: 'novel.txt', sourceLength: source.length }
  let requests = 0
  let reads = 0
  const events = []
  await converse({ session, userText: '原文中禁止什么？', readSource: async () => { reads++; return source },
    onToolEvent: (event) => events.push(event),
    generate: async (messages) => {
      const context = messages.map((message) => message.content).join('\n')
      if (requests++ === 0) {
        assert.match(context, /已保存原文：novel.txt/)
        assert.match(messages[0].content, /search_source/)
        return { text: tool('search_source', { keyword: '明火' }), finishReason: 'stop' }
      }
      if (requests === 2) {
        assert.match(context, /name="search_source" ok="true"/)
        assert.match(context, /城中禁止明火/)
        return { text: '', finishReason: 'tool_calls', toolCalls: [{ id: 'call1', type: 'function',
          function: { name: 'creation_tool', arguments: JSON.stringify({ name: 'read_source', arguments: { offset: 9, limit: 7 } }) } }] }
      }
      assert.match(context, /name="read_source" ok="true"/)
      assert.match(context, /城中禁止明火/)
      return { text: '城中禁止明火。', finishReason: 'stop' }
    },
  })
  assert.equal(reads, 1)
  assert.deepEqual(events.map((event) => [event.name, event.ok]), [['search_source', true], ['read_source', true]])
})
