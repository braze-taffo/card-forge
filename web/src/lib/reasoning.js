// MessageReasoning 移植：思考标签边界检测只在原始内容上进行。
// 状态：none（无标签）/ parsed（成对标签）/ ambiguous（嵌套或不匹配，原样保留）。

const PREFIX = /^\s*<(think|reasoning)>/i

export function splitReasoning(text) {
  const start = text.match(PREFIX)
  if (!start) return { body: text, reasoning: '', status: 'none' }
  const startEnd = start.index + start[0].length
  const tagRe = /<\/?(?:think|reasoning)>/gi
  tagRe.lastIndex = startEnd
  const end = tagRe.exec(text)
  if (!end || end[0].toLowerCase() !== `</${start[1].toLowerCase()}>`) {
    return { body: text, reasoning: '', status: 'ambiguous' }
  }
  return {
    body: text.slice(end.index + end[0].length).replace(/^\s+/, ''),
    reasoning: text.slice(startEnd, end.index).trim(),
    status: 'parsed',
  }
}

export function reasoningFromResponse(text, apiReasoning) {
  const parsed = splitReasoning(text)
  return {
    ...parsed,
    reasoning: [apiReasoning, parsed.reasoning].filter((s) => s && s.trim() !== '').join('\n\n'),
  }
}
