// CreationBrief 移植：创作起点表单 → 首条用户消息。
// 起点留在会话里，重开草稿时仍然可见。
import { GUIDED_INSTRUCTION, CHARACTER_DRAFT_INSTRUCTION } from './creation-prompts.js'

export const DETAIL_OPTIONS = [
  { key: 'Concise', label: '精简', characterLength: '约 500 至 1000 字' },
  { key: 'Normal', label: '标准', characterLength: '约 1000 至 2000 字' },
  { key: 'Rich', label: '详细', characterLength: '约 2000 至 5000 字' },
]

export function briefToPrompt(brief) {
  const lines = []
  lines.push('【创作起点】')
  lines.push(brief.kind === 'Character' ? '请帮我创作角色卡。' : '请帮我创作世界书。')
  lines.push(`创作方式：${brief.guided ? '引导对话' : '直接生成初稿'}。`)
  if (brief.kind === 'Character') {
    const detail = DETAIL_OPTIONS.find((d) => d.key === brief.detail) ?? DETAIL_OPTIONS[1]
    lines.push(`篇幅：${detail.label}（${detail.characterLength}，请以内容质量为准，不为凑字数重复）。`)
    if (brief.characters.trim() !== '') {
      lines.push(`多角色设定（每行一个角色，保留各自身份与关系）：\n${brief.characters.trim()}`)
    }
    if (brief.relationship.trim() !== '') lines.push(`角色与用户的关系：${brief.relationship.trim()}`)
    if (brief.userPersona.trim() !== '') lines.push(`用户自身设定：${brief.userPersona.trim()}`)
  } else {
    lines.push(brief.loreOneByOne
      ? '世界书方式：先逐条讨论；每条确认后再加入草稿。'
      : '世界书方式：根据现有信息生成一版可编辑的完整条目草稿。')
  }
  if (brief.title.trim() !== '') {
    lines.push(`${brief.kind === 'Character' ? '角色或故事名' : '世界书名'}：${brief.title.trim()}`)
  }
  if (brief.premise.trim() !== '') lines.push(`核心设定：\n${brief.premise.trim()}`)
  let closing
  if (brief.kind === 'WorldBook' && brief.loreOneByOne) {
    closing = '请先提议第一条世界书条目，等我确认后再写入草稿。'
  } else if (brief.guided) {
    closing = GUIDED_INSTRUCTION
  } else if (brief.kind === 'Character') {
    closing = CHARACTER_DRAFT_INSTRUCTION
  } else {
    closing = '请现在实际填写可编辑的世界书条目草稿。'
  }
  lines.push(closing + '最后简短说明实际改动及真正需要我核对之处，不输出固定审核清单。')
  return lines.join('\n').trim()
}
