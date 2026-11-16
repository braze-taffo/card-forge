// 工具协议解析测试：<tool_call> 块、闭合丢失恢复、DSML、原生调用。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseToolCallBlocks, parseNativeCreationCalls, proseWithoutToolBlocks,
  parseAskUserQuestion,
} from '../src/lib/tool-protocol.js'

test('完整工具块解析', () => {
  const result = parseToolCallBlocks('先看一下。<tool_call>{"name":"read_card","arguments":{}}</tool_call>完成。')
  assert.equal(result.blocks.length, 1)
  assert.ok(result.blocks[0].valid)
  assert.equal(result.blocks[0].call.name, 'read_card')
  // 与 Android 版一致：完整工具块被移除，块外前后文本都保留
  assert.equal(result.prose, '先看一下。完成。')
  assert.equal(result.hasUnclosedBlock, false)
})

test('围栏代码块内的工具调用', () => {
  const result = parseToolCallBlocks('```json\n<tool_call>{"name":"read_card","arguments":{}}</tool_call>\n```')
  assert.equal(result.blocks.length, 1)
  assert.ok(result.blocks[0].valid)
})

test('字符串内花括号不截断 JSON', () => {
  const result = parseToolCallBlocks('<tool_call>{"name":"set_card_fields","arguments":{"description":"内容有 } 花括号"}}</tool_call>')
  assert.ok(result.blocks[0].valid)
  assert.equal(result.blocks[0].call.arguments.description, '内容有 } 花括号')
})

test('闭合标签丢失但 JSON 完整：恢复执行并标记', () => {
  const result = parseToolCallBlocks('<tool_call>{"name":"read_card","arguments":{}}')
  assert.equal(result.blocks.length, 1)
  assert.ok(result.blocks[0].valid)
  assert.equal(result.recoveredUnclosedBlock, true)
  assert.equal(result.hasUnclosedBlock, false)
})

test('截断的未闭合块不执行', () => {
  const result = parseToolCallBlocks('正文<tool_call>{"name":"upsert_lore","argu')
  assert.equal(result.blocks.length, 0)
  assert.equal(result.hasUnclosedBlock, true)
  assert.equal(result.prose, '正文')
})

test('多个工具块顺序与 prose 提取', () => {
  const body = '说明A<tool_call>{"name":"a1","arguments":{"x":1}}</tool_call>中间<tool_call>{"name":"a2","arguments":{}}</tool_call>尾巴'
  const result = parseToolCallBlocks(body)
  assert.equal(result.blocks.length, 2)
  assert.equal(result.blocks[0].call.name, 'a1')
  assert.equal(result.blocks[1].call.name, 'a2')
  assert.equal(result.prose, '说明A中间尾巴')
})

test('DSML 包装器（ASCII 管道与双管道变体）', () => {
  const body = '<|DSML|tool_calls><DSML:invoke name="read_card"><DSML:parameter name="ids">["L1"]</DSML:parameter></DSML:invoke></DSML:tool_calls>'
  const result = parseToolCallBlocks(body)
  assert.equal(result.blocks.length, 1)
  assert.ok(result.blocks[0].valid)
  assert.equal(result.blocks[0].call.name, 'read_card')
  assert.deepEqual(result.blocks[0].call.arguments, { ids: '["L1"]' })
})

test('原生 creation_tool 调用解包', () => {
  const calls = [{ id: '1', type: 'function', function: { name: 'creation_tool', arguments: '{"name":"read_card","arguments":{}}' } }]
  const blocks = parseNativeCreationCalls(calls)
  assert.equal(blocks.length, 1)
  assert.ok(blocks[0].valid)
  assert.equal(blocks[0].call.name, 'read_card')
})

test('原生调用 arguments 为对象时也可解析', () => {
  const calls = [{ function: { name: 'read_card', arguments: {} } }]
  const blocks = parseNativeCreationCalls(calls)
  assert.ok(blocks[0].valid)
  assert.equal(blocks[0].call.name, 'read_card')
})

test('原生 creation_tool 缺嵌套参数判无效', () => {
  const calls = [{ function: { name: 'creation_tool', arguments: '{"name":"read_card"}' } }]
  const blocks = parseNativeCreationCalls(calls)
  assert.equal(blocks[0].valid, false)
})

test('proseWithoutToolBlocks：完整块移除、未闭合块截断', () => {
  assert.equal(proseWithoutToolBlocks('你好<tool_call>{"name":"x","arguments":{}}</tool_call>后续'), '你好后续')
  assert.equal(proseWithoutToolBlocks('你好<tool_call>{"name":"x","argu'), '你好')
})

test('ask_user 参数校验', () => {
  assert.equal(parseAskUserQuestion({ question: '', options: [{ label: 'a' }, { label: 'b' }] }), null)
  assert.equal(parseAskUserQuestion({ question: '视角？', options: [{ label: 'a' }] }), null)
  const ok = parseAskUserQuestion({ question: '视角？', options: [{ label: '第一人称' }, { label: '第三人称', description: '限知' }] })
  assert.equal(ok.question, '视角？')
  assert.equal(ok.options.length, 2)
  assert.equal(ok.options[1].description, '限知')
})
