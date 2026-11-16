<script setup>
// 单条世界书条目编辑器：输入即时进入草稿，切换关联时不丢失编辑。
// 展开时才挂载，长列表不物化全部输入框。
import { ref, watch, toRaw } from 'vue'
import { S, fmt } from '../lib/strings.js'

const props = defineProps({
  lore: { type: Object, required: true },
  index: { type: Number, required: true },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['update', 'remove'])

const local = ref({
  title: props.lore.title,
  keys: (props.lore.keys ?? []).join(', '),
  content: props.lore.content,
  secondaryKeys: (props.lore.secondaryKeys ?? []).join(', '),
  note: props.lore.note,
})

let timer = null
let lastEmitted = null
function commit(part) {
  clearTimeout(timer)
    lastEmitted = {
      ...props.lore,
      title: local.value.title,
      keys: splitList(local.value.keys),
      content: local.value.content,
      secondaryKeys: splitList(local.value.secondaryKeys),
      note: local.value.note,
      ...part,
    }
    emit('update', lastEmitted)
}

function splitList(value) {
  return value.split(/[,，]/).map((s) => s.trim()).filter((s) => s !== '')
}

function toggle(key) {
  clearTimeout(timer)
  emit('update', { ...props.lore, [key]: !props.lore[key] })
}

// 会话切换/草稿重开时同步本地态（同一 index 内容被外部替换）。
watch(() => props.lore, (next) => {
  clearTimeout(timer)
  if (toRaw(next) === lastEmitted) return
  local.value = {
    title: next.title,
    keys: (next.keys ?? []).join(', '),
    content: next.content,
    secondaryKeys: (next.secondaryKeys ?? []).join(', '),
    note: next.note,
  }
})
</script>

<template>
  <div class="lore-body">
    <label class="field"><span>{{ S.fieldLoreTitle }}</span>
      <input v-model="local.title" type="text" :disabled="busy" @input="commit()" />
    </label>
    <label class="field"><span>{{ S.fieldKeys }}</span>
      <input v-model="local.keys" type="text" :disabled="busy" @input="commit()" />
    </label>
    <label class="field"><span>{{ S.fieldLoreContent }}</span>
      <textarea v-model="local.content" rows="4" :disabled="busy" @input="commit()"></textarea>
    </label>
    <label class="field"><span>{{ S.fieldSecondaryKeys }}</span>
      <input v-model="local.secondaryKeys" type="text" :disabled="busy" @input="commit()" />
    </label>
    <div class="switch-line">
      <label class="switch-row">
        <input type="checkbox" :checked="lore.constant" :disabled="busy" @change="toggle('constant')" />
        <span>{{ S.constantEntry }}</span>
      </label>
      <label class="switch-row">
        <input type="checkbox" :checked="lore.selective" :disabled="busy || !lore.secondaryKeys?.length" @change="toggle('selective')" />
        <span>{{ S.selectiveEntry }}</span>
      </label>
    </div>
    <label class="field"><span>{{ S.fieldNote }}</span>
      <input v-model="local.note" type="text" :disabled="busy" @input="commit()" />
    </label>
    <p v-if="lore.sourceQuote" class="muted quote">{{ fmt(S.sourceQuote, lore.sourceName, lore.sourceOffset, lore.sourceQuote) }}</p>
    <button class="danger" :disabled="busy" @click="emit('remove')">{{ S.deleteEntry }}</button>
  </div>
</template>

<style scoped>
.lore-body {
  padding: 0 14px 12px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.switch-line {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.switch-row {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  margin: 0;
}

.quote {
  word-break: break-all;
}

input[type='checkbox'] {
  width: 18px;
  height: 18px;
  accent-color: var(--accent);
}
</style>
