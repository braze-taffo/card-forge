// OpenAI 兼容流式客户端。
// 两种通道：
//   free   —— 同源 /api/v1/chat/completions，由本站后端代理真实网关（密钥在服务端）
//   custom —— 用户自己的 Base URL + 密钥，浏览器直连，不经本站
// 与 Android 版对齐的语义：既无 [DONE] 又无 finish_reason 的流视为不完整。

import { customApiUrls } from './api-urls.js'

export const READ_IDLE_TIMEOUT_MS = 5 * 60 * 1000

export function freeAccessCode() {
  try {
    return localStorage.getItem('cardforge.accessCode') || ''
  } catch {
    return ''
  }
}

/**
 * 流式对话请求。
 * @returns {{text, reasoning, finishReason, toolCalls, stats:{firstDeltaMillis,lastDeltaMillis,deltaCount}}}
 * @throws {Error} 网络/HTTP/不完整流错误（message 为可展示中文）
 */
export async function streamChat({channel, messages, temperature, maxTokens, tools, signal, onDelta}) {
  const isFree = channel.mode === 'free'
  const url = isFree ? '/api/v1/chat/completions' : customApiUrls(channel.baseUrl).chat
  const headers = { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' }
  if (isFree) {
    const code = freeAccessCode()
    if (code) headers['X-Access-Code'] = code
  } else {
    if (!channel.apiKey) throw new Error('未填写 API 密钥（设置 → 我自己的 API）')
    headers['Authorization'] = `Bearer ${channel.apiKey}`
  }
  const body = {
    messages,
    stream: true,
  }
  if (channel.model) body.model = channel.model
  else if (!isFree) body.model = ''
  if (typeof temperature === 'number') body.temperature = temperature
  if (typeof maxTokens === 'number' && maxTokens > 0) body.max_tokens = maxTokens
  if (Array.isArray(tools) && tools.length > 0) {
    body.tools = tools
    body.tool_choice = 'auto'
  }

  const controller = new AbortController()
  let idleTimedOut = false
  let userAborted = false
  const onExternalAbort = () => {
    userAborted = true
    controller.abort()
  }
  signal?.addEventListener('abort', onExternalAbort, { once: true })
  let idleTimer = null
  const armIdleTimer = () => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      idleTimedOut = true
      controller.abort()
    }, READ_IDLE_TIMEOUT_MS)
  }

  let text = ''
  let reasoning = ''
  let finishReason = null
  let sawDone = false
  const toolAcc = new Map()
  const startedAt = Date.now()
  let firstDeltaMillis = null
  let lastDeltaMillis = null
  let deltaCount = 0

  const noteDelta = () => {
    deltaCount++
    const now = Date.now() - startedAt
    lastDeltaMillis = now
    if (firstDeltaMillis === null) firstDeltaMillis = now
  }

  try {
    armIdleTimer()
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      let message = `HTTP ${response.status}`
      try {
        const parsed = JSON.parse(errText)
        if (parsed?.error?.message) message = parsed.error.message
        else if (typeof parsed?.error === 'string') message = parsed.error
      } catch { /* 保留默认 */ }
      const e = new Error(message)
      e.httpStatus = response.status
      throw e
    }
    if (!response.body) throw new Error('供应商未返回流式响应体')

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    const handleSseBlock = (block) => {
      for (const rawLine of block.split(/\r?\n/)) {
        const line = rawLine.trimEnd()
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '') continue
        if (payload === '[DONE]') {
          sawDone = true
          continue
        }
        let event
        try {
          event = JSON.parse(payload)
        } catch {
          continue
        }
        const choice = Array.isArray(event.choices) ? event.choices[0] : null
        if (!choice) continue
        const delta = choice.delta ?? choice.message
        if (delta && typeof delta === 'object') {
          if (typeof delta.content === 'string' && delta.content !== '') {
            text += delta.content
            noteDelta()
            onDelta?.({ text: delta.content, reasoning: '' })
          }
          const reasoningPiece = delta.reasoning_content ?? delta.reasoning
          if (typeof reasoningPiece === 'string' && reasoningPiece !== '') {
            reasoning += reasoningPiece
            noteDelta()
            onDelta?.({ text: '', reasoning: reasoningPiece })
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const fragment of delta.tool_calls) {
              if (!fragment || typeof fragment !== 'object') continue
              const index = typeof fragment.index === 'number' ? fragment.index : 0
              const slot = toolAcc.get(index) ?? { id: '', name: '', arguments: '' }
              if (typeof fragment.id === 'string' && fragment.id !== '') slot.id = fragment.id
              if (fragment.function && typeof fragment.function === 'object') {
                if (typeof fragment.function.name === 'string' && fragment.function.name !== '') {
                  slot.name = fragment.function.name
                }
                const args = fragment.function.arguments
                if (typeof args === 'string') slot.arguments += args
                else if (args && typeof args === 'object') slot.arguments += JSON.stringify(args)
              }
              toolAcc.set(index, slot)
            }
            noteDelta()
          }
        }
        if (typeof choice.finish_reason === 'string' && choice.finish_reason !== '') {
          finishReason = choice.finish_reason
        }
      }
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      armIdleTimer()
      buffer += decoder.decode(value, { stream: true })
      let separator
      while ((separator = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const block = buffer.slice(0, separator)
        buffer = buffer.slice(separator + (buffer.slice(separator).startsWith('\r\n') ? 4 : 2))
        handleSseBlock(block)
      }
    }
    if (buffer.trim() !== '') handleSseBlock(buffer)

    if (idleTimedOut) {
      throw new Error('模型读取超时：连接建立后超过 5 分钟没有收到新的流式数据')
    }
    if (userAborted || signal?.aborted) {
      const e = new Error('已停止')
      e.aborted = true
      throw e
    }
    if (!sawDone && !finishReason && text === '' && reasoning === '' && toolAcc.size === 0) {
      throw new Error('模型未返回内容')
    }
    if (!sawDone && !finishReason) {
      const e = new Error('模型流式响应不完整（既无 [DONE] 也无 finish_reason）；未应用不完整的工具调用，已收到的文字会保留')
      e.incompleteStream = true
      throw e
    }
  } catch (e) {
    if (userAborted || signal?.aborted) {
      const err = new Error('已停止')
      err.aborted = true
      throw err
    }
    if (idleTimedOut) {
      throw new Error('模型读取超时：连接建立后超过 5 分钟没有收到新的流式数据')
    }
    if (e instanceof TypeError) {
      // fetch 网络层失败：DNS/断网/CORS。未曾收到任何字节时允许上层重连一次。
      const err = new Error(`无法连接到模型服务（${isFree ? '本站免费通道' : channel.baseUrl}）：${e.message}`)
      err.network = true
      throw err
    }
    throw e
  } finally {
    clearTimeout(idleTimer)
    signal?.removeEventListener('abort', onExternalAbort)
  }

  const toolCalls = [...toolAcc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, slot]) => ({ id: slot.id, type: 'function', function: { name: slot.name, arguments: slot.arguments } }))
    .filter((call) => call.function.name !== '' || call.function.arguments !== '')

  return {
    text,
    reasoning,
    finishReason,
    toolCalls,
    stats: { firstDeltaMillis, lastDeltaMillis, deltaCount },
  }
}
