// 引擎纯函数测试：分段、证据校验、提取回复解析、思考流可见性、对话回路（脚本化模型）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  nextSourceChunk, countSourceChunks, verifiedLoreFromChunk, mergeExtractedLore,
  parseAgentReply, visibleCreationStream, converse,
} from '../src/lib/engine.js'
import { newSession } from '../src/lib/models.js'

test('分段覆盖全文且在换行处断开', () => {
  const source = 'a'.repeat(6000) + '\nline\n' + 'b'.repeat(2000)
  const first = nextSourceChunk(source, 0)
  assert.ok(first.end <= 7000)
  assert.equal(source[first.end - 1], '\n')
  const second = nextSourceChunk(source, first.end)
  assert.equal(second.end, source.length)
  assert.equal(nextSourceChunk(source, source.length), null)
})

test('无换行时硬截断，不静默丢尾', () => {
  const source = 'x'.repeat(16000)
  const a = nextSourceChunk(source, 0)
  assert.equal(a.end, 7000)
  const b = nextSourceChunk(source, a.end)
  assert.equal(b.end, 14000)
  const c = nextSourceChunk(source, b.end)
  assert.equal(c.end, 16000)
})

test('countSourceChunks 与保存游标一致', () => {
  const source = 'y'.repeat(15000)
  const { total } = countSourceChunks(source, 0)
  assert.equal(total, 3)
  const after = countSourceChunks(source, 7000)
  assert.equal(after.completed, 1)
  assert.equal(after.total, 3)
})

test('证据定位：quote 命中段内则换算绝对偏移，未命中则丢弃', () => {
  const chunk = { start: 100, end: 200, text: '前文。赵云字子龙。后文。' }
  const entries = [
    { title: '赵云', keys: ['赵云'], content: '常山赵子龙', sourceQuote: '赵云字子龙', sourceOffset: -1 },
    { title: '编造', keys: ['不存在'], content: '没有证据', sourceQuote: '这句话不在原文里', sourceOffset: -1 },
    { title: '空引用', keys: ['空'], content: '引用为空', sourceQuote: '', sourceOffset: -1 },
  ]
  const verified = verifiedLoreFromChunk(chunk, entries, '书名', 'hash')
  assert.equal(verified.length, 1)
  assert.equal(verified[0].title, '赵云')
  assert.equal(verified[0].sourceOffset, chunk.start + chunk.text.indexOf('赵云字子龙'))
  assert.equal(verified[0].sourceSha256, 'hash')
})

test('mergeExtractedLore 按标题+内容去重', () => {
  const existing = [{ title: ' A ', content: 'x', keys: [] }]
  const incoming = [
    { title: 'a', content: 'x', keys: [] },
    { title: 'a', content: 'y', keys: [] },
  ]
  const merged = mergeExtractedLore(existing, incoming)
  assert.equal(merged.length, 2)
})

test('提取回复解析（含围栏）', () => {
  const reply = parseAgentReply('```json\n{"assistant_message":"摘要","world_name":"名","lore":[{"title":"t"}]}\n```')
  assert.equal(reply.message, '摘要')
  assert.equal(reply.worldName, '名')
  assert.equal(reply.lore.length, 1)
})

test('提取回复缺 JSON 抛格式错误', () => {
  assert.throws(() => parseAgentReply('这不是 JSON'), /格式无效/)
})

test('思考流：成对标签解析为 reasoning + 正文', () => {
  const update = visibleCreationStream('<think>想过程</think>正文', '')
  assert.equal(update.reasoning, '想过程')
  assert.equal(update.output, '正文')
  assert.equal(update.phase, '正在接收草稿')
})

test('思考流：供应商 reasoning 与正文标签并存时合并', () => {
  const update = visibleCreationStream('正文B', 'API思考')
  assert.equal(update.reasoning, 'API思考')
  assert.equal(update.output, '正文B')
})

// ---------------------------------------------------------------- 对话回路（脚本化模型）

function scriptedEngine(script) {
  let call = 0
  const generate = async () => script[Math.min(call++, script.length - 1)]
  return { generate, calls: () => call }
}

test('对话回路：工具写入 + 最终纯文本回复 + 检查点', async () => {
  const session = newSession('Character')
  const script = [
    { text: '先写名称。<tool_call>{"name":"set_card_fields","arguments":{"name":"阿焰"}}</tool_call>', finishReason: 'tool_calls' },
    { text: '再加两条。<tool_call>{"name":"upsert_lore","arguments":{"entries":[{"title":"T1","keys":["k1"],"content":"C1"}]}}</tool_call>', finishReason: 'tool_calls' },
    { text: '已完成，请查看。', finishReason: 'stop' },
  ]
  const { generate } = scriptedEngine(script)
  const checkpoints = []
  const toolEvents = []
  const result = await converse({
    session,
    userText: '创建一个角色',
    generate,
    onProgress: () => {},
    onCheckpoint: (working) => checkpoints.push(working),
    onToolEvent: (e) => toolEvents.push(e),
  })
  assert.equal(result.message, '已完成，请查看。')
  assert.equal(result.rounds, 3)
  assert.equal(result.session.card.name, '阿焰')
  assert.equal(result.session.lore.length, 1)
  assert.match(result.session.lore[0].id, /^L\d+$/)
  assert.ok(checkpoints.some((s) => s.card.name === '阿焰' && s.pendingRun.pendingRound?.blockIndex === 1))
  assert.ok(checkpoints.some((s) => s.pendingRun.history.some((m) => m.content.includes('tool_result'))))
  assert.equal(toolEvents.filter((e) => e.ok).length, 2)
})

test('对话回路：无效工具块回执 + 三轮停滞报错', async () => {
  const session = newSession('WorldBook')
  const bad = { text: '<tool_call>{"name":"', finishReason: null }
  const { generate, calls } = scriptedEngine([bad, bad, bad, bad])
  await assert.rejects(
    converse({ session, userText: 'x', generate }),
    /连续三轮/,
  )
  assert.equal(calls(), 3)
})

test('对话回路：ask_user 挂起等待用户选择', async () => {
  const session = newSession('Character')
  const script = [
    { text: '<tool_call>{"name":"ask_user","arguments":{"question":"用第几人称？","options":[{"label":"第一人称"},{"label":"第三人称"}]}}</tool_call>', finishReason: null },
    { text: '好的，用第一人称。', finishReason: 'stop' },
  ]
  const { generate } = scriptedEngine(script)
  const result = await converse({
    session,
    userText: '开始',
    generate,
    onProgress: () => {},
    onAskUser: async (question) => {
      assert.equal(question.question, '用第几人称？')
      return '第一人称'
    },
  })
  assert.equal(result.message, '好的，用第一人称。')
})
