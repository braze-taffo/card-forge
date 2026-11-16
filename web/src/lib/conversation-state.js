/** 已收到的文字属于当前会话，即使请求未完成也不能随进度面板消失。 */
export function receivedTurns(replies = []) {
  return replies.filter((reply) => reply.text?.trim() || reply.reasoning?.trim()).map((reply) => ({
    role: reply.role || 'agent', text: reply.text || '', reasoning: reply.reasoning || '',
    incomplete: Boolean(reply.incomplete),
  }))
}

/** 自定义文本可独立作答，多选时把全部选择与补充完整回传。 */
export function composeQuestionAnswer(question, selected = [], text = '') {
  const labels = (question.options || []).map((option) => option.label).filter((label) => selected.includes(label))
  const custom = typeof text === 'string' ? text.trim() : ''
  if (!labels.length) return custom
  return `我选择：${labels.join('、')}${custom ? `\n补充：${custom}` : ''}`
}

/** 停止等待选项时也应结束任务，而不是永远停留在 busy。 */
export function waitForChoice(signal, present) {
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason ?? new DOMException('已停止', 'AbortError')) }
    const cleanup = () => signal?.removeEventListener('abort', abort)
    if (signal?.aborted) { abort(); return }
    signal?.addEventListener('abort', abort, { once: true })
    present((answer) => { cleanup(); resolve(answer) })
  })
}
