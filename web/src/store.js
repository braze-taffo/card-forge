// 全局状态与动作：CreationViewModel 的移植。
// 会话草稿持久化在 IndexedDB；模型通道 = 站内免费代理 或 用户自带 key 直连。
import { reactive } from 'vue'
import { S, fmt } from './lib/strings.js'
import { splitReasoning } from './lib/reasoning.js'
import { streamChat } from './lib/openai.js'
import { proseWithoutToolBlocks, creationNativeTools } from './lib/tool-protocol.js'
import {
  converse, extractChunk, nextSourceChunk, countSourceChunks,
  verifiedLoreFromChunk, mergeExtractedLore,
} from './lib/engine.js'
import {
  newSession, withAssignedLoreIds, sessionFromCharacterCard, sessionFromWorldBookJson,
  worldBookSessionFromCard, parseCharacterCardJson, exportCardJson, exportWorldBookJson,
  portableFrontendIssues, emptyLore,
} from './lib/models.js'
import * as db from './lib/idb.js'
import { extractCardJson, embedCardJson } from './lib/png.js'
import { downloadJson, downloadPng } from './lib/download.js'
import { pngObjectUrl } from './lib/image.js'
import { receivedTurns, waitForChoice } from './lib/conversation-state.js'
import { attachReference, continueFromSession, embedReferenceEntries } from './lib/workflow.js'

const SETTINGS_KEY = 'cardforge.settings'

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    return {
      channelMode: raw.channelMode === 'custom' ? 'custom' : 'free',
      customBaseUrl: typeof raw.customBaseUrl === 'string' ? raw.customBaseUrl : '',
      customApiKey: typeof raw.customApiKey === 'string' ? raw.customApiKey : '',
      customModel: typeof raw.customModel === 'string' ? raw.customModel : '',
      freeModel: typeof raw.freeModel === 'string' ? raw.freeModel : '',
    }
  } catch {
    return { channelMode: 'free', customBaseUrl: '', customApiKey: '', customModel: '', freeModel: '' }
  }
}

export const state = reactive({
  route: window.location.pathname === '/admin' ? 'admin' : 'home',
  editorTab: 0,
  sessions: [],
  current: null,
  coverPreviewUrl: null,
  busy: false,
  extractionProgress: '',
  operationLabel: '',
  modelPhase: '',
  liveReasoning: '',
  liveOutput: '',
  liveAssistantMessage: '',
  operationStartedAtMillis: 0,
  modelElapsedMillis: 0,
  firstDeltaMillis: null,
  lastDeltaMillis: null,
  deltaCount: 0,
  providerLabel: '',
  toolEvents: [],
  pendingQuestion: null,
  error: null,
  info: null,
  serverConfig: { freeModelAvailable: false, freeDisplayName: '', freeModels: [], dailyRequestsPerIp: 0, ratePerMinute: 0, accessCodeRequired: false },
  settings: loadSettings(),
})

let generationController = null
let askResolver = null

// 写入串行化：避免草稿并发覆盖。
let writeChain = Promise.resolve()
function writeSession(session) {
  const snapshot = JSON.parse(JSON.stringify(session))
  const run = writeChain.then(() => db.saveSession(snapshot))
  writeChain = run.catch(() => {})
  return run
}

export function navigate(route) {
  state.route = route
  if (route === 'admin' && window.location.pathname !== '/admin') history.pushState({}, '', '/admin')
  else if (route !== 'admin' && window.location.pathname === '/admin') history.pushState({}, '', '/')
  if (route === 'home') refresh()
}
window.addEventListener('popstate', () => {
  state.route = window.location.pathname === '/admin' ? 'admin' : 'home'
})

export async function refresh() {
  try {
    state.sessions = await db.listSummaries()
  } catch (e) {
    state.error = e.message ?? S.failedDefault
  }
}

export async function loadServerConfig() {
  try {
    const response = await fetch('/api/config', { headers: acceptCodeHeader() })
    if (response.ok) {
      Object.assign(state.serverConfig, await response.json())
    }
  } catch { /* dev 模式没有后端时保持默认 */ }
}

function acceptCodeHeader() {
  let code = ''
  try {
    code = localStorage.getItem('cardforge.accessCode') || ''
  } catch { /* 忽略 */ }
  return code ? { 'X-Access-Code': code } : {}
}

export function saveSettings(settings) {
  state.settings = { ...state.settings, ...settings }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings))
}

export function setAccessCode(code) {
  localStorage.setItem('cardforge.accessCode', code)
}

export function channelForGeneration() {
  if (state.settings.channelMode === 'custom' && state.settings.customBaseUrl.trim() !== '') {
    return {
      mode: 'custom',
      baseUrl: state.settings.customBaseUrl.trim(),
      apiKey: state.settings.customApiKey.trim(),
      model: state.settings.customModel.trim(),
    }
  }
  if (!state.serverConfig.freeModelAvailable) {
    throw new Error(S.errorProviderNotSupported)
  }
  const models = state.serverConfig.freeModels || []
  const model = models.find((entry) => entry.id === state.settings.freeModel) || models[0]
  return { mode: 'free', model: model?.id || '' }
}

function channelLabel() {
  if (state.settings.channelMode === 'custom' && state.settings.customBaseUrl.trim() !== '') {
    const model = state.settings.customModel.trim() || S.defaultModelLabel
    let host = state.settings.customBaseUrl.trim()
    try {
      host = new URL(/^https?:\/\//.test(host) ? host : `https://${host}`).host
    } catch { /* 保留原样 */ }
    return `${host} · ${model}`
  }
  const models = state.serverConfig.freeModels || []
  const model = models.find((entry) => entry.id === state.settings.freeModel) || models[0]
  return model?.name || state.serverConfig.freeDisplayName || '站内免费模型'
}

function resetRunState(operationLabel) {
  state.operationLabel = operationLabel
  state.extractionProgress = ''
  state.error = null
  state.info = null
  state.modelPhase = ''
  state.liveReasoning = ''
  state.liveOutput = ''
  state.liveAssistantMessage = ''
  state.operationStartedAtMillis = Date.now()
  state.modelElapsedMillis = 0
  state.firstDeltaMillis = null
  state.lastDeltaMillis = null
  state.deltaCount = 0
  state.providerLabel = ''
  state.toolEvents = []
  state.pendingQuestion = null
}

function showModelProgress(update) {
  if (update.phase !== undefined) state.modelPhase = update.phase
  if (update.output !== undefined) state.liveOutput = update.output
  if (update.reasoning !== undefined) state.liveReasoning = update.reasoning
  if (update.assistantMessage !== undefined) state.liveAssistantMessage = update.assistantMessage
  if (update.elapsedMillis !== undefined) state.modelElapsedMillis = update.elapsedMillis
  if (update.firstDeltaMillis !== undefined) state.firstDeltaMillis = update.firstDeltaMillis
  if (update.lastDeltaMillis !== undefined) state.lastDeltaMillis = update.lastDeltaMillis
  if (update.deltaCount !== undefined) state.deltaCount = update.deltaCount
  if (update.providerLabel && update.providerLabel !== '') state.providerLabel = update.providerLabel
}

function checkAborted(e) {
  return Boolean(e && (e.aborted || e.name === 'AbortError'))
}

/**
 * 引擎的 generate 闭包：流式请求 + 80ms 节流进度发布 + 连接失败重试一次。
 * 第三参数是引擎的进度回调（流片可见文本以此推送）。
 */
async function engineGenerate(messages, temperature, onProgress, phasePrefix = '') {
  const channel = channelForGeneration()
  showModelProgress({ phase: phasePrefix + S.phasePrepareRequest })
  showModelProgress({ phase: phasePrefix + S.phaseConnecting, providerLabel: channelLabel() })
  onProgress({ requestStarted: true, output: '', reasoning: '', assistantMessage: '' })

  let output = ''
  let reasoning = ''
  let deltaCount = 0
  const requestStartedAt = Date.now()
  let firstDeltaMillis = null
  let lastDeltaMillis = null
  let lastPublish = 0
  let publishedOutput = false
  let publishedAssistant = false
  let retriedConnect = false

  const publish = (force = false) => {
    const now = Date.now()
    const parts = splitReasoning(output)
    const visibleOutput = parts.status === 'parsed' ? parts.body : output
    const visibleReasoning = parts.status === 'parsed'
      ? [reasoning, parts.reasoning].filter((s) => s && s.trim() !== '').join('\n\n')
      : reasoning
    const assistantMessage = proseWithoutToolBlocks(visibleOutput)
    const firstVisible = (visibleOutput !== '' && !publishedOutput) || (assistantMessage !== '' && !publishedAssistant)
    if (!force && !firstVisible && now - lastPublish < 80) return
    lastPublish = now
    publishedOutput = publishedOutput || visibleOutput !== ''
    publishedAssistant = publishedAssistant || assistantMessage !== ''
    onProgress({ output: visibleOutput, reasoning: visibleReasoning, assistantMessage, deltaCount, firstDeltaMillis, lastDeltaMillis })
  }

  const runOnce = () => streamChat({
    channel,
    messages: messages.map((m) => ({ ...m })),
    temperature,
    maxTokens: 128_000,
    tools: creationNativeTools(),
    signal: generationController?.signal,
    onDelta: (piece) => {
      if (piece.text) output += piece.text
      if (piece.reasoning) reasoning += piece.reasoning
      deltaCount++
      lastDeltaMillis = Date.now() - requestStartedAt
      if (firstDeltaMillis === null) firstDeltaMillis = lastDeltaMillis
      publish()
    },
  })

  let result = null
  while (true) {
    try {
      result = await runOnce()
      break
    } catch (e) {
      publish(true)
      if (checkAborted(e)) throw e
      if (e.network && deltaCount === 0 && !retriedConnect && !generationController?.signal.aborted) {
        // 仅网络层失败且未收到任何流片时重试一次，避免重复计费。
        retriedConnect = true
        showModelProgress({ phase: phasePrefix + S.phaseConnectRetry })
        continue
      }
      const stage = output !== '' ? S.stageBodyOutput
        : reasoning !== '' ? S.stageReasoningOutput : S.stageBeforeFirstChunk
      const code = e.httpStatus != null ? ` HTTP ${e.httpStatus}` : ''
      throw new Error(fmt(S.errorStreamInterrupted, stage, deltaCount, code, '', (e.message || '').slice(0, 300)))
    }
  }
  publish(true)
  onProgress({ requestFinished: true, truncated: result.finishReason === 'length' })
  showModelProgress({
    phase: phasePrefix + S.phaseValidating,
    firstDeltaMillis: result.stats.firstDeltaMillis,
    lastDeltaMillis: result.stats.lastDeltaMillis,
    deltaCount: result.stats.deltaCount,
  })
  const raw = result.text
  const parts = splitReasoning(raw)
  if (raw.trim() === '' && (!result.toolCalls || result.toolCalls.length === 0)) {
    if (result.reasoning.trim() === '' && reasoning.trim() === '') throw new Error(S.errorNoContent)
    // 思考耗尽输出额度：交给回路反馈路径处理，而不是报“无内容”。
    return { text: '', finishReason: result.finishReason ?? 'length', toolCalls: null }
  }
  return { text: parts.body, finishReason: result.finishReason, toolCalls: result.toolCalls ?? null }
}

export async function start(kind) {
  if (state.busy) return
  const session = newSession(kind)
  state.current = session
  state.coverPreviewUrl = null
  resetRunState('')
  state.editorTab = 0
  await writeSession(session)
  await refresh()
  navigate('editor')
}

export async function open(id) {
  if (state.busy) return
  state.current = null
  state.coverPreviewUrl = null
  resetRunState('')
  state.editorTab = 0
  try {
    const loaded = await db.loadSession(id)
    const session = withAssignedLoreIds(loaded)
    if (session !== loaded) await writeSession(session)
    state.current = session
    if (session.coverSha256) {
      try {
        const cover = await db.readCover(id, session.coverSha256)
        state.coverPreviewUrl = pngObjectUrl(cover)
      } catch (e) {
        state.error = e.message
      }
    }
  } catch (e) {
    state.error = e.message
  }
  navigate('editor')
}

export function closeEditor() {
  if (state.busy) return
  state.current = null
  state.coverPreviewUrl = null
  resetRunState('')
  navigate('home')
}

// 关联只保存参考快照，角色字段和来源世界书不会互相覆盖。
export async function continueLinked(role = 'person') {
  if (state.busy || !state.current) return
  state.busy = true
  try {
    const source = state.current
    await writeSession(source)
    const next = continueFromSession(source, role)
    await writeSession(next)
    state.current = next
    state.coverPreviewUrl = null
    resetRunState('')
    state.info = next.kind === 'Character' ? '已关联完整世界书。先创作角色，完成后在关联创作中审核嵌入。' : '已关联来源角色卡，可以继续扩写世界书。来源卡仍保留在草稿列表。'
    await refresh()
  } finally { state.busy = false }
}

export async function linkDraft(id) {
  if (state.busy || !state.current) return
  state.busy = true
  try {
    const source = withAssignedLoreIds(await db.loadSession(id))
    const next = attachReference(state.current, source)
    await writeSession(next)
    state.current = next
    state.info = '参考已关联。AI 可读取完整内容；卡内条目将在审核后嵌入。'
  } finally { state.busy = false }
}

export async function returnToLinkedCard() {
  const source = state.current
  if (state.busy || source?.kind !== 'WorldBook' || source.reference?.kind !== 'Character') return
  state.busy = true
  try {
    await writeSession(source)
    const target = withAssignedLoreIds(await db.loadSession(source.reference.id))
    const next = attachReference(target, source)
    await writeSession(next)
    state.current = next
    state.coverPreviewUrl = null
    if (next.coverSha256) state.coverPreviewUrl = pngObjectUrl(await db.readCover(next.id, next.coverSha256))
    resetRunState('')
    state.info = '已返回来源角色卡并关联这本世界书。请在关联创作中审核嵌入条目。'
    await refresh()
  } finally { state.busy = false }
}

export async function embedLinked(selectedIds) {
  if (state.busy || !state.current) return
  const next = embedReferenceEntries(state.current, selectedIds)
  await writeSession(next)
  state.current = next
  state.info = '选中条目已嵌入，可以在世界书页编辑，并随角色卡导出 JSON / PNG。'
  await refresh()
}

export async function setLinkedLorePermission(allowed) {
  if (state.busy || !state.current) return
  const next = { ...state.current, allowLoreEdits: Boolean(allowed), pendingRun: null }
  await writeSession(next)
  state.current = next
}

/** 导入 JSON/PNG 角色卡或独立世界书 JSON 为新会话。 */
export async function importFile(file, asWorldBookSource = false) {
  if (state.busy) throw new Error('创作进行中，稍后再导入')
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.length > 12_000_000) throw new Error('文件超过 12 MB，请拆分；没有截断导入。')
  let raw = null
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    raw = await extractCardJson(bytes)
    if (!raw) throw new Error('PNG 中没有角色卡数据（缺少 chara/ccv3）')
  } else {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    raw = JSON.parse(text.replace(/^\uFEFF/, ''))
  }
  if (!raw || typeof raw !== 'object') throw new Error('无法识别的文件：需要角色卡 JSON/PNG 或世界书 JSON')
  const isCard = Boolean(raw.data || raw.first_mes || (raw.name && !raw.entries))
  let session
  if (!isCard) {
    if (raw.entries && typeof raw.entries === 'object') {
      session = sessionFromWorldBookJson(raw)
    } else {
      throw new Error('无法识别的文件：需要角色卡 JSON/PNG 或世界书 JSON')
    }
  } else {
    session = asWorldBookSource ? worldBookSessionFromCard(raw) : sessionFromCharacterCard(raw)
  }
  state.current = session
  resetRunState('')
  state.editorTab = 0
  await writeSession(session)
  await refresh()
  navigate('editor')
}

export async function deleteDraft(id) {
  if (state.busy) return
  state.busy = true
  try {
    await db.deleteSession(id)
    state.sessions = state.sessions.filter((s) => s.id !== id)
    if (state.current?.id === id) {
      state.current = null
      state.coverPreviewUrl = null
    }
    state.info = S.draftDeleted
    await refresh()
  } catch (e) {
    state.error = e.message
  } finally {
    state.busy = false
  }
}

export async function send(text) {
  return runConversation(text, false)
}

async function runConversation(text, resume) {
  const session = state.current
  if (!session || state.busy || text.trim() === '') return
  generationController = new AbortController()
  const signal = generationController.signal
  const context = resume ? session : {
    ...session, turns: [...session.turns, ...receivedTurns(session.pendingReplies)],
    pendingRun: null, pendingReplies: [], partialTurnSaved: false,
  }
  const withUser = {
    ...context,
    turns: resume ? context.turns : [...context.turns, { role: 'user', text: text.trim() }],
    updatedAt: Date.now(),
  }
  state.current = withUser
  state.busy = true
  state.error = null
  state.info = null
  resetRunState(S.opConverse)
  state.modelPhase = S.phasePreparing
  let replies = structuredClone(JSON.parse(JSON.stringify(context.pendingReplies || [])))
  let replyIndex = -1
  let saveTimer = null
  const publishReplies = () => {
    state.current = { ...state.current, pendingReplies: replies.map((reply) => ({ ...reply })) }
    if (saveTimer === null) saveTimer = setTimeout(() => {
      saveTimer = null
      writeSession(state.current).catch((e) => { state.error = `草稿保存失败：${e.message}` })
    }, 500)
  }
  const flushReplies = async () => {
    clearTimeout(saveTimer)
    saveTimer = null
    state.current = { ...state.current, pendingReplies: replies.map((reply) => ({ ...reply })) }
    await writeSession(state.current)
  }
  try {
    await writeSession(withUser)
    const reply = await converse({
      session: context,
      userText: text.trim(),
      generate: engineGenerate,
      readSource: () => db.readSource(context.id, context.sourceSha256),
      onProgress: (update) => {
        showModelProgress(update)
        if (update.requestStarted) {
          replyIndex = replies.length
          replies.push({ role: 'agent', text: '', reasoning: '', incomplete: true })
        }
        if (replyIndex >= 0) {
          if (update.assistantMessage !== undefined) replies[replyIndex].text = update.assistantMessage
          if (update.reasoning !== undefined) replies[replyIndex].reasoning = update.reasoning
          if (update.requestFinished) replies[replyIndex].incomplete = Boolean(update.truncated)
          publishReplies()
        }
      },
      onCheckpoint: async (working) => {
        const checkpoint = {
          ...working,
          turns: withUser.turns,
          pendingReplies: replies.map((reply) => ({ ...reply })),
          partialTurnSaved: true,
          updatedAt: Date.now(),
        }
        state.current = checkpoint
        await writeSession(checkpoint)
      },
      onToolEvent: (event) => {
        state.toolEvents = [...state.toolEvents, event]
      },
      onAskUser: async (question) => {
        if (!replies.some((reply) => reply.text === question.question)) {
          replies.push({ role: 'agent', text: question.question, incomplete: false })
          await flushReplies()
        }
        const answer = await waitForChoice(signal, (resolve) => {
          askResolver = resolve
          state.pendingQuestion = question
        })
        replies.push({ role: 'user', text: answer })
        await flushReplies()
        return answer
      },
      signal,
      resume,
    })
    state.modelPhase = S.phaseVerifySave
    clearTimeout(saveTimer)
    saveTimer = null
    const transcript = receivedTurns(replies)
    const message = reply.message || '草稿已更新，请检查内容。'
    if (transcript.at(-1)?.role !== 'agent' || transcript.at(-1)?.text.trim() !== message.trim()) {
      transcript.push({ role: 'agent', text: message })
    }
    const next = {
      ...reply.session,
      turns: [...withUser.turns, ...transcript],
      partialTurnSaved: false,
      pendingRun: null,
      pendingReplies: [],
      updatedAt: Date.now(),
    }
    await writeSession(next)
    state.current = next
    state.modelPhase = S.phaseTurnDone
    await refresh()
  } catch (e) {
    await flushReplies().catch((saveError) => { state.error = `草稿保存失败：${saveError.message}` })
    if (checkAborted(e)) {
      state.modelPhase = state.current?.partialTurnSaved ? S.phaseStoppedSaved : S.phaseStoppedNotApplied
    } else {
      state.error = e.message ?? S.failedDefault
      state.modelPhase = state.current?.partialTurnSaved ? S.phaseInterruptedSaved : S.phaseTurnFailed
    }
  } finally {
    clearTimeout(saveTimer)
    askResolver = null
    state.pendingQuestion = null
    state.busy = false
    generationController = null
    await refresh()
  }
}

export function cancelGeneration() {
  generationController?.abort()
}

export function answerAgentQuestion(choice) {
  if (!askResolver || !state.pendingQuestion || typeof choice !== 'string' || !choice.trim()) return false
  const resolver = askResolver
  askResolver = null
  state.pendingQuestion = null
  resolver(choice.trim())
  return true
}

export async function retry() {
  const session = state.current
  if (session?.pendingRun && !state.busy) return runConversation(session.pendingRun.userText, true)
  if (!session || state.busy || session.partialTurnSaved) return
  const last = session.turns[session.turns.length - 1]
  if (!last || last.role !== 'user') return
  state.current = { ...session, turns: session.turns.slice(0, -1) }
  await send(last.text)
}

export async function continueIncomplete() {
  if (state.current?.pendingRun && !state.busy) return runConversation(state.current.pendingRun.userText, true)
  await send('请从已保存的草稿继续完成上一轮未完成的工作；不要重复创建已经写入的条目。')
}

export async function setSource(name, text) {
  const session = state.current
  if (!session || state.busy || text.trim() === '') return
  if (text.length > 4_000_000) {
    state.error = S.errorSourceTooLarge
    return
  }
  state.busy = true
  resetRunState(S.opSaveSource)
  state.modelPhase = S.phaseSavingSource
  try {
    const { hash, length } = await db.saveSource(session.id, text)
    const next = {
      ...session,
      sourceName: name !== '' ? name : '粘贴原文',
      sourceSha256: hash,
      sourceCursor: 0,
      sourceLength: length,
      updatedAt: Date.now(),
    }
    await writeSession(next)
    state.current = next
    state.info = S.sourceSaved
    state.modelPhase = S.phaseSourceSaved
    await refresh()
  } catch (e) {
    state.error = e.message
  } finally {
    state.busy = false
  }
}

export async function extractSource() {
  const starting = state.current
  if (!starting || state.busy || starting.sourceLength === 0) return
  generationController = new AbortController()
  state.busy = true
  resetRunState(S.opExtract)
  state.modelPhase = S.phaseReadingSource
  let current = starting
  try {
    const source = await db.readSource(starting.id, starting.sourceSha256)
    if (source.length !== starting.sourceLength) throw new Error(S.errorSourceLengthMismatch)
    const chunkCount = countSourceChunks(source, starting.sourceCursor)
    let chunkNumber = chunkCount.completed
    while (true) {
      generationController.signal.throwIfAborted()
      const chunk = nextSourceChunk(source, current.sourceCursor)
      if (!chunk) break
      chunkNumber++
      state.extractionProgress = fmt(S.extractProgressChunk, chunkNumber, chunkCount.total, chunk.start, chunk.end, source.length, current.sourceCursor)
      state.modelPhase = fmt(S.phaseExtractChunk, chunkNumber)
      state.liveReasoning = ''
      state.liveOutput = ''
      state.liveAssistantMessage = ''
      state.modelElapsedMillis = 0
      state.firstDeltaMillis = null
      state.lastDeltaMillis = null
      state.deltaCount = 0
      const reply = await extractChunk({
        chunk,
        sourceName: starting.sourceName,
        generate: engineGenerate,
        onProgress: showModelProgress,
      })
      state.modelPhase = fmt(S.phaseVerifyChunk, chunkNumber)
      const proposed = reply.lore ?? []
      const verified = verifiedLoreFromChunk(chunk, proposed, starting.sourceName, starting.sourceSha256)
      const rejected = proposed.length - verified.length
      current = {
        ...current,
        lore: mergeExtractedLore(current.lore, verified),
        worldName: current.worldName !== '' ? current.worldName : (reply.worldName ?? ''),
        sourceCursor: chunk.end,
        turns: [...current.turns, {
          role: 'agent',
          text: `已提炼 ${chunk.end}/${source.length} 字符，新增 ${verified.length} 条；${rejected} 条因缺少可定位原文证据而未加入。`,
        }],
        updatedAt: Date.now(),
      }
      current = withAssignedLoreIds(current)
      await writeSession(current)
      state.current = current
      state.extractionProgress = fmt(S.extractProgressSaved, current.sourceCursor, source.length, current.lore.length)
      state.modelPhase = fmt(S.phaseChunkSaved, chunkNumber)
    }
    state.info = S.extractDone
    state.modelPhase = S.phaseExtractDone
    await refresh()
  } catch (e) {
    if (checkAborted(e)) {
      state.modelPhase = S.phaseExtractStopped
    } else {
      state.error = e.message
      state.modelPhase = S.phaseExtractInterrupted
    }
  } finally {
    state.busy = false
    generationController = null
    await refresh()
  }
}

// ---------------------------------------------------------------- 草稿编辑

export async function editCard(patch) {
  if (state.busy || !state.current) return
  state.current = {
    ...state.current,
    card: { ...state.current.card, ...patch },
    updatedAt: Date.now(),
  }
  state.info = null
  await writeSession(state.current)
}

export async function editWorldName(name) {
  if (state.busy || !state.current) return
  state.current = { ...state.current, worldName: name, updatedAt: Date.now() }
  await writeSession(state.current)
}

export async function editLore(index, entry) {
  if (state.busy || !state.current) return
  const items = [...state.current.lore]
  if (entry === null) {
    if (index >= 0 && index < items.length) items.splice(index, 1)
  } else if (index >= 0 && index < items.length) {
    items[index] = entry
  } else if (index === items.length) {
    items.push(entry)
  }
  const nextLoreNumber = Math.max(state.current.nextLoreNumber || 0, ...items.map((e) => Number(String(e.id || '').replace(/^L/, '')) || 0))
  state.current = { ...state.current, lore: items, nextLoreNumber, updatedAt: Date.now() }
  await writeSession(state.current)
}

export function newLoreForUi() {
  const used = new Set((state.current?.lore ?? [])
    .map((e) => parseInt(String(e.id || '').replace(/^L/, ''), 10)).filter(Number.isFinite))
  const next = Math.max(state.current?.nextLoreNumber || 0, 0, ...used) + 1
  return { ...emptyLore(), title: '新条目', id: `L${next}` }
}

export async function setCoverPng(pngBytes) {
  const session = state.current
  if (!session || session.kind !== 'Character' || state.busy) return
  state.busy = true
  try {
    const hash = await db.saveCover(session.id, pngBytes)
    const next = { ...session, coverSha256: hash, updatedAt: Date.now() }
    await writeSession(next)
    await db.pruneCovers(session.id, hash)
    if (state.coverPreviewUrl) URL.revokeObjectURL(state.coverPreviewUrl)
    state.coverPreviewUrl = pngObjectUrl(pngBytes)
    state.current = next
    state.info = S.coverSaved
    await refresh()
  } catch (e) {
    state.error = e.message
  } finally {
    state.busy = false
  }
}

// ---------------------------------------------------------------- 导出

function validateLoreForExport(session) {
  for (const lore of session.lore) {
    if (lore.content.trim() === '' || (!lore.constant && !lore.keys.some((k) => k.trim() !== ''))) {
      throw new Error(S.errorLoreEmpty)
    }
  }
}

function checkedCharacterCardJson(session) {
  if (session.card.name.trim() === '') throw new Error(S.errorNameRequired)
  validateLoreForExport(session)
  const issues = portableFrontendIssues(session.card.frontendHtml)
  if (issues.length > 0) {
    throw new Error(fmt(S.errorFrontendPortable, issues.map((key) => S[key]).join('、')))
  }
  return exportCardJson(session)
}

function checkedWorldBookJson(session) {
  if (session.worldName.trim() === '' || session.lore.length === 0) throw new Error(S.errorWorldbookRequired)
  validateLoreForExport(session)
  return exportWorldBookJson(session)
}

function firstMessageOf(session) {
  const card = session.card
  return [card.firstMessage.trim(), card.frontendHtml.trim()].filter((s) => s !== '').join('\n\n')
}

export function exportCharacterJson() {
  const session = state.current
  if (!session || session.kind !== 'Character' || state.busy) throw new Error(S.errorCannotExportCard)
  const json = checkedCharacterCardJson(session)
  const reparsed = parseCharacterCardJson(json)
  if (reparsed.name !== session.card.name.trim() || reparsed.firstMessage.trim() !== firstMessageOf(session).trim()) {
    throw new Error(S.errorCardExportRoundtrip)
  }
  downloadJson(json, session.card.name, 'character')
  state.info = S.exportJsonDone
}

export async function exportCharacterPng() {
  const session = state.current
  if (!session || session.kind !== 'Character' || state.busy) throw new Error(S.errorCannotExportCard)
  if (!session.coverSha256) throw new Error(S.errorCoverRequiredForPng)
  const json = checkedCharacterCardJson(session)
  const cover = await db.readCover(session.id, session.coverSha256)
  const png = embedCardJson(cover, json)
  const reparsed = await extractCardJson(png)
  if (!reparsed || parseCharacterCardJson(reparsed).name !== session.card.name.trim()) {
    throw new Error(S.errorPngExportRoundtrip)
  }
  downloadPng(png, session.card.name)
  state.info = S.exportPngDone
}

export function exportWorldBook() {
  const session = state.current
  if (!session || state.busy) throw new Error(S.errorCannotExportWorldbook)
  const book = checkedWorldBookJson(session)
  downloadJson(book, session.worldName || session.card.name, 'worldbook')
  state.info = S.exportWorldbookDone
}

// ---------------------------------------------------------------- 通知

export function clearNotice() {
  state.error = null
  state.info = null
}

export function showError(message) {
  state.error = message
}

export function showInfo(message) {
  state.info = message
  state.error = null
}

export async function saveTavernReport(sessionId, report) {
  if (state.busy) throw new Error('创作进行中，请结束后保存验收报告')
  const session = state.current?.id === sessionId ? state.current : await db.loadSession(sessionId)
  if (!session) throw new Error('原草稿已不存在，请下载报告保留')
  const next = { ...session, tavernReports: [...(session.tavernReports || []).filter(x => x.leaseId !== report.leaseId), report].slice(-5), updatedAt: Date.now() }
  await writeSession(next)
  if (state.current?.id === sessionId) state.current = next
}

// 快捷指令与网页创作起点共用同一套规则。
export { QUICK_ACTIONS } from './lib/creation-prompts.js'
