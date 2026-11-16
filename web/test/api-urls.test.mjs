import test from 'node:test'
import assert from 'node:assert/strict'
import { customApiUrls } from '../src/lib/api-urls.js'
import { streamChat } from '../src/lib/openai.js'

test('官方主机、版本基础地址和完整接口均使用同一对接口', () => {
  for (const input of [
    'https://api.deepseek.com',
    'https://api.deepseek.com/v1',
    ' https://api.deepseek.com/v1/ ',
    'https://api.deepseek.com/v1/chat/completions',
    'https://api.deepseek.com/v1/chat/completions/',
    'https://api.deepseek.com/v1/models',
  ]) {
    assert.deepEqual(customApiUrls(input), {
      chat: 'https://api.deepseek.com/v1/chat/completions',
      models: 'https://api.deepseek.com/v1/models',
    })
  }
})

test('保留完整接口的代理前缀、版本和查询参数', () => {
  assert.deepEqual(customApiUrls('https://example.com/proxy/chat/completions?route=a#ignored'), {
    chat: 'https://example.com/proxy/chat/completions?route=a',
    models: 'https://example.com/proxy/models?route=a',
  })
  assert.equal(customApiUrls('https://example.com/proxy').chat, 'https://example.com/proxy/v1/chat/completions')
  assert.equal(customApiUrls('https://example.com/v2').models, 'https://example.com/v2/models')
  assert.equal(customApiUrls('http://127.0.0.1:8000/v1').chat, 'http://127.0.0.1:8000/v1/chat/completions')
  for (const input of [
    'https://generativelanguage.googleapis.com/v1beta/openai/',
    'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  ]) {
    assert.equal(customApiUrls(input).models, 'https://generativelanguage.googleapis.com/v1beta/openai/models')
  }
})

test('空地址、相对地址及非 HTTP 协议给出明确错误', () => {
  assert.throws(() => customApiUrls('  '), /不能为空/)
  for (const input of ['api.example.com/v1', '/v1', 'not a url']) {
    assert.throws(() => customApiUrls(input), /完整网址/)
  }
  assert.throws(() => customApiUrls('ftp://example.com/v1'), /http/)
})

test('实际流式创作使用完整接口，免费通道地址继续保持同源', async (t) => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(url)
    return new Response('data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    })
  })
  const custom = await streamChat({
    channel: { mode: 'custom', baseUrl: 'https://api.deepseek.com/v1/chat/completions', apiKey: 'test-only', model: 'test-model' },
    messages: [{ role: 'user', content: 'test' }],
  })
  assert.equal(custom.text, 'OK')
  await streamChat({ channel: { mode: 'free' }, messages: [] })
  assert.deepEqual(requests, ['https://api.deepseek.com/v1/chat/completions', '/api/v1/chat/completions'])
})
