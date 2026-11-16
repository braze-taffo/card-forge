import test from 'node:test'
import assert from 'node:assert/strict'
import { converse } from '../src/lib/engine.js'
import { newSession } from '../src/lib/models.js'
import { receivedTurns, waitForChoice, composeQuestionAnswer } from '../src/lib/conversation-state.js'
import { reactive } from 'vue'

const tool = (name, args) => `<tool_call>${JSON.stringify({ name, arguments: args })}</tool_call>`
const completed = (text) => ({ text, finishReason: 'stop' })
const clone = (value) => JSON.parse(JSON.stringify(value))

test('429 后恢复同一会话和工具回执，不重复创建世界书条目', async () => {
  const session = newSession('Character')
  let persisted
  let calls = 0
  await assert.rejects(converse({ session, userText: '保留基调，添加灯塔。',
    generate: async () => {
      if (calls++ === 0) return completed(tool('upsert_lore', { entries: [{ title: '灯塔', keys: ['灯塔'], content: '灯塔每晚点灯。' }] }))
      throw new Error('HTTP 429')
    }, onCheckpoint: (s) => { persisted = clone(s) },
  }), /429/)
  assert.equal(persisted.id, session.id)
  assert.equal(persisted.lore.length, 1)
  const result = await converse({ session: reactive(persisted), resume: true, userText: persisted.pendingRun.userText,
    generate: async (messages) => {
      const context = messages.map((m) => m.content).join('\n')
      assert.match(context, /保留基调，添加灯塔/)
      assert.match(context, /tool_result.*upsert_lore/)
      assert.match(context, /灯塔每晚点灯/)
      return completed('已完成，沿用原本的基调。')
    },
  })
  assert.equal(result.session.id, session.id)
  assert.equal(result.session.lore.length, 1)
})

test('首片前限流仍保留请求，恢复时不添加另一条用户消息', async () => {
  let persisted
  const session = { ...newSession('Character'), turns: [{ role: 'user', text: '写一位图书管理员。' }] }
  await assert.rejects(converse({ session, userText: '写一位图书管理员。',
    generate: async () => { throw new Error('HTTP 429') }, onCheckpoint: (s) => { persisted = clone(s) },
  }), /429/)
  const result = await converse({ session: persisted, resume: true, userText: persisted.pendingRun.userText,
    generate: async (messages) => { assert.match(messages[1].content, /图书管理员/); return completed('名字叫小舟。') },
  })
  assert.deepEqual(result.session.turns, session.turns)
})

test('批次写入后等待选择时停止，恢复跳过已执行的工具并保留选择', async () => {
  const controller = new AbortController()
  let persisted
  let requests = 0
  await assert.rejects(converse({ session: newSession('Character'), userText: '开始创作', signal: controller.signal,
    generate: async () => { requests++; return completed(
      tool('upsert_lore', { entries: [{ title: '城镇', keys: ['城镇'], content: '海边小镇。' }] }) +
      tool('ask_user', { question: '用哪种基调？', options: [{ label: '温柔' }, { label: '冷峻' }] }) +
      tool('set_card_fields', { name: '小舟' })) },
    onCheckpoint: (s) => { persisted = clone(s) },
    onAskUser: () => waitForChoice(controller.signal, () => controller.abort()),
  }), { name: 'AbortError' })
  assert.equal(persisted.lore.length, 1)
  assert.equal(persisted.pendingRun.pendingRound.blockIndex, 1)
  const result = await converse({ session: persisted, resume: true, userText: persisted.pendingRun.userText,
    onAskUser: async (q) => { assert.equal(q.question, '用哪种基调？'); return '温柔' },
    generate: async (messages) => {
      requests++
      assert.match(messages.at(-1).content, /温柔/)
      return completed('好的，沿用温柔的基调。')
    },
  })
  assert.equal(requests, 2)
  assert.equal(result.session.lore.length, 1)
  assert.equal(result.session.card.name, '小舟')
})

test('中断回复保留正文与思考，恢复上下文只使用正文', async () => {
  const session = { ...newSession('Character'), pendingReplies: [
    { role: 'agent', text: '我会保留新人设定，接着补充', reasoning: '真实供应商思考', incomplete: true },
  ], pendingRun: { userText: '沿用新人设定', history: [{ role: 'system', content: '创作' }, { role: 'user', content: '沿用新人设定' }], round: 0 } }
  assert.deepEqual(receivedTurns(session.pendingReplies), [{ role: 'agent', text: '我会保留新人设定，接着补充', reasoning: '真实供应商思考', incomplete: true }])
  await converse({ session, resume: true, userText: session.pendingRun.userText,
    generate: async (messages) => {
      assert.match(messages.at(-1).content, /我会保留新人设定，接着补充/)
      assert.ok(!messages.some((m) => m.content.includes('真实供应商思考')))
      return completed('后续内容。')
    },
  })
})

test('等待选项前已停止时，不呈现新的选项', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(waitForChoice(controller.signal, () => assert.fail('不应呈现选项')), { name: 'AbortError' })
})

test('连续限流不会重复堆叠同一条中断续写上下文', async () => {
  let persisted = { ...newSession('Character'), pendingReplies: [{ role: 'agent', text: '已经收到的片段', incomplete: true }],
    pendingRun: { userText: '继续角色', history: [{ role: 'system', content: '创作' }, { role: 'user', content: '继续角色' }], round: 0 } }
  for (let attempt = 0; attempt < 3; attempt++) {
    await assert.rejects(converse({ session: reactive(persisted), resume: true, userText: '继续角色',
      generate: async (messages) => {
        assert.equal(messages.filter((m) => m.content.includes('<interrupted_reply>')).length, 1)
        throw new Error('429')
      }, onCheckpoint: (s) => { persisted = clone(s) },
    }), /429/)
  }
})

test('自定义回答不必选择任何预设选项，空白不能提交', () => {
  const question = { options: [{ label: '温柔' }, { label: '冷峻' }] }
  assert.equal(composeQuestionAnswer(question, [], '  我想用幽默的基调  '), '我想用幽默的基调')
  assert.equal(composeQuestionAnswer(question, [], '   '), '')
})

test('多个选项和自由补充完整组合，不丢第二个选择', () => {
  const question = { options: [{ label: '温柔' }, { label: '冷峻' }] }
  assert.equal(composeQuestionAnswer(question, ['冷峻', '温柔'], '外冷内热'), '我选择：温柔、冷峻\n补充：外冷内热')
  assert.equal(composeQuestionAnswer(question, ['温柔', '冷峻'], ''), '我选择：温柔、冷峻')
})

test('自定义组合答复作为同一轮工具结果回传并保存', async () => {
  let calls = 0
  let persisted
  const question = { question: '什么基调？', options: [{ label: '温柔' }, { label: '冷峻' }] }
  const answer = composeQuestionAnswer(question, ['温柔', '冷峻'], '外冷内热')
  await converse({ session: newSession('Character'), userText: '先讨论基调',
    generate: async (messages) => {
      if (calls++ === 0) return completed(tool('ask_user', question))
      assert.ok(messages.at(-1).content.includes(JSON.stringify({ answer })))
      return completed('按外冷内热继续。')
    }, onAskUser: async () => answer, onCheckpoint: (s) => { persisted = clone(s) },
  })
  assert.ok(persisted.pendingRun.history.at(-1).content.includes(JSON.stringify({ answer })))
  assert.equal(calls, 2)
})
