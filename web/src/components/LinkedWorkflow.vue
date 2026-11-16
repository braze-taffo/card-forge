<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { state, refresh, continueLinked, linkDraft, returnToLinkedCard, embedLinked, setLinkedLorePermission, showError } from '../store.js'
import { embeddingPlan } from '../lib/workflow.js'
import AppIcon from './AppIcon.vue'

const dialog = ref(null)
const role = ref('person')
const sourceId = ref('')
const selected = ref([])
const cardLabels = { name: '名称', description: '角色描述', personality: '性格', scenario: '情境', firstMessage: '开场白', alternateGreetings: '备选开场', exampleMessages: '示例对话', systemPrompt: '系统提示', postHistoryInstructions: '历史后提示', creatorNotes: '创作者备注', tags: '标签', frontendHtml: '开场页面' }
const reference = computed(() => state.current?.reference)
const isCharacter = computed(() => state.current?.kind === 'Character')
const candidates = computed(() => state.sessions.filter((s) => s.kind !== state.current?.kind))
const plan = computed(() => isCharacter.value && reference.value?.kind === 'WorldBook' ? embeddingPlan(state.current) : [])
const selectedCount = computed(() => plan.value.filter((row) => row.status !== 'identical' && selected.value.includes(row.entry.id)).length)
watch(() => reference.value, () => { selected.value = plan.value.filter((row) => row.status === 'new').map((row) => row.entry.id) }, { immediate: true })
watch(() => state.current?.id, () => { sourceId.value = '' })
onBeforeUnmount(() => dialog.value?.close())
async function run(action, closeAfter = false) {
  try { await action(); if (closeAfter) dialog.value?.close() } catch (e) { showError(e.message) }
}
async function show() { await refresh(); dialog.value.showModal() }
</script>

<template>
  <button class="workflow-trigger" :disabled="state.busy" @click="show"><AppIcon name="book" />关联创作<span v-if="reference" class="linked-dot" aria-label="已有参考"></span></button>
  <dialog ref="dialog" class="workflow-dialog" aria-labelledby="workflow-title" @click="(e) => { if (e.target === dialog && !state.busy) dialog.close() }" @cancel="(e) => { if (state.busy) e.preventDefault() }">
    <div class="workflow-heading"><div><small>让角色与世界接续生长</small><h2 id="workflow-title">关联创作</h2></div><button autofocus :disabled="state.busy" aria-label="关闭关联创作" @click="dialog.close()">关闭</button></div>
    <p class="muted">参考内容可被 AI 完整读取。来源草稿独立保留，嵌入条目由你审核决定。</p>
    <section class="workflow-section">
      <h3>{{ isCharacter ? '从角色继续构建世界' : '从世界开始塑造角色' }}</h3>
      <p>{{ isCharacter ? '以当前角色为参考，另建世界书；已有卡内条目会复制过去，方便继续扩写。' : '以当前世界书为参考，另建角色卡；先完成人物或导演设定，再将世界书嵌入。' }}</p>
      <label v-if="!isCharacter" class="field"><span>角色卡类型</span><select v-model="role" :disabled="state.busy"><option value="person">人物卡</option><option value="director">导演卡</option></select></label>
      <button class="primary" :disabled="state.busy" @click="run(() => continueLinked(role), true)">{{ isCharacter ? '继续制作世界书' : '继续制作角色卡' }}</button>
      <button v-if="!isCharacter && reference?.kind === 'Character'" :disabled="state.busy" @click="run(returnToLinkedCard)">返回来源角色卡，审核嵌入</button>
    </section>
    <section class="workflow-section">
      <h3>{{ reference ? '当前参考' : '关联已有草稿' }}</h3>
      <template v-if="reference">
        <div class="reference-summary"><strong>{{ reference.name }}</strong><span>{{ reference.kind === 'Character' ? '角色卡' : '世界书' }} · {{ reference.lore.length }} 条</span></div>
        <p class="muted">使用保存的完整快照。来源有新修改时，点击刷新；来源删除后，快照仍可阅读。</p>
        <button :disabled="state.busy" @click="run(() => linkDraft(reference.id))">刷新参考内容</button>
        <details v-if="reference.kind === 'Character'" class="reference-preview"><summary>查看来源角色字段</summary><div v-for="(value, key) in reference.card" :key="key"><template v-if="value?.length"><strong>{{ cardLabels[key] || key }}</strong><p>{{ Array.isArray(value) ? value.join('、') : value }}</p></template></div></details>
        <details v-if="reference.lore.length" class="reference-preview"><summary>查看参考世界书全文</summary><details v-for="entry in reference.lore" :key="entry.id"><summary>{{ entry.title }} <small>{{ entry.keys.join('、') }}</small></summary><p>{{ entry.content }}</p></details></details>
      </template>
      <label class="field"><span>{{ reference ? '换一本参考草稿' : '选择参考草稿' }}</span><select v-model="sourceId" :disabled="state.busy"><option value="">请选择{{ isCharacter ? '世界书' : '角色卡' }}</option><option v-for="s in candidates" :key="s.id" :value="s.id">{{ s.cardName || s.worldName || '未命名草稿' }} · {{ s.loreCount }} 条</option></select></label>
      <p v-if="!candidates.length" class="muted">可以先在创作空间导入或制作{{ isCharacter ? '世界书' : '角色卡' }}，再回到这里关联。</p>
      <button :disabled="state.busy || !sourceId" @click="run(() => linkDraft(sourceId))">关联所选草稿</button>
    </section>
    <section v-if="isCharacter && reference?.kind === 'WorldBook'" class="workflow-section">
      <h3>审核并嵌入世界书</h3>
      <p>选中的条目将随角色卡导出 JSON / PNG。内容相同的条目会跳过；同名或已嵌入后有更新的条目，勾选表示替换卡内那一条。</p>
      <p v-if="!plan.length" class="muted">参考世界书还没有条目。</p>
      <div v-for="row in plan" :key="row.entry.id" class="embed-row" :class="{ conflict: row.status === 'conflict' }">
        <label><input v-model="selected" type="checkbox" :value="row.entry.id" :disabled="state.busy || row.status === 'identical'" /><span>{{ row.entry.title }}<small>{{ row.status === 'identical' ? '内容相同，已跳过' : row.status === 'conflict' ? '存在同名或更新内容 · 勾选将替换' : '新增条目' }}</small></span></label>
        <details><summary>查看内容{{ row.status === 'conflict' ? '与差异' : '' }}</summary><div v-if="row.status === 'conflict'"><strong>卡内已有</strong><p>{{ state.current.lore.find((e) => e.id === row.targetId)?.content }}</p><strong>参考内容</strong></div><p>{{ row.entry.content }}</p><small>触发词：{{ row.entry.keys.join('、') || '常驻条目' }}</small></details>
      </div>
      <button class="primary" :disabled="state.busy || !selectedCount" @click="run(() => embedLinked(selected))">嵌入选中条目（{{ selectedCount }}）</button>
      <label class="permission"><input type="checkbox" :checked="state.current.allowLoreEdits" :disabled="state.busy" @change="run(() => setLinkedLorePermission($event.target.checked))" /><span>允许 AI 编辑卡内世界书<small>默认关闭。开启后 AI 可修改卡内条目，来源世界书仍保持只读。</small></span></label>
    </section>
  </dialog>
</template>

<style scoped>
.workflow-trigger { font-size: 12px; white-space: nowrap; }
.linked-dot { width: 6px; height: 6px; background: var(--accent); border-radius: 50%; }
.workflow-dialog { width: min(680px, calc(100vw - 28px)); max-height: 84dvh; overflow: auto; color: var(--text); background: #fafbf6; border: 1px solid var(--border); border-radius: 18px 22px 17px 20px; padding: 26px; box-shadow: 0 20px 70px #24362a26; }
.workflow-dialog::backdrop { background: #25342d55; backdrop-filter: blur(5px); }
.workflow-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.workflow-heading small { color: var(--text-dim); letter-spacing: 2px; }
h2 { margin: 3px 0; font-size: 25px; } h3 { margin: 0 0 8px; font-size: 18px; }
p { font-size: 13px; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; }
.workflow-section { padding: 20px 0; border-top: 1px solid var(--border); margin-top: 12px; }
.workflow-section > button { margin: 4px 8px 4px 0; }
.reference-summary { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; }
.reference-summary span, small { color: var(--text-dim); font-size: 12px; }
.reference-preview { border: 1px solid var(--border); border-radius: 10px; padding: 12px; margin: 12px 0; }
summary { cursor: pointer; font-size: 13px; } .reference-preview details { margin: 12px 0; }
.embed-row { padding: 12px; border: 1px solid var(--border); border-radius: 10px; margin-bottom: 10px; background: #ffffff80; }
.embed-row.conflict { border-color: #bca888; }
.embed-row label, .permission { display: flex; gap: 10px; align-items: flex-start; font-size: 14px; }
.embed-row small, .permission small { display: block; margin-top: 3px; }
.embed-row details { margin: 8px 0 0 24px; }
.permission { margin-top: 18px; } input[type=checkbox] { margin-top: 5px; accent-color: var(--accent); flex-shrink: 0; }
@media (max-width: 720px) { .workflow-dialog { padding: 20px; max-height: 88dvh; } .workflow-trigger { padding: 6px 8px; } }
</style>
