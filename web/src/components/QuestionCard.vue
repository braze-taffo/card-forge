<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { composeQuestionAnswer } from '../lib/conversation-state.js'
import AppIcon from './AppIcon.vue'
const props = defineProps({ question: { type: Object, required: true } })
const emit = defineEmits(['answer'])
const customOpen = ref(false)
const selected = ref([])
const customText = ref('')
const customInput = ref(null)
const answer = computed(() => composeQuestionAnswer(props.question, selected.value, customText.value))
watch(() => props.question, () => { customOpen.value = false; selected.value = []; customText.value = '' })
async function openCustom() {
  customOpen.value = !customOpen.value
  if (customOpen.value) { await nextTick(); customInput.value?.focus() }
}
</script>

<template>
  <div class="card question">
    <div class="asking">等待你的选择</div>
    <p class="question-text">{{ question.question }}</p>
    <button v-for="(option, i) in question.options" :key="i" class="option" @click="emit('answer', option.label)">
      <span>{{ option.label }}</span><span v-if="option.description" class="muted">{{ option.description }}</span>
    </button>
    <button class="option custom-option" :aria-expanded="customOpen" @click="openCustom">
      <span><AppIcon name="chat" />自己输入 / 组合选项</span>
      <span class="muted">不局限于上面的答案，也可以同时选择多个。</span>
    </button>
    <form v-if="customOpen" class="custom-answer" @submit.prevent="answer && emit('answer', answer)">
      <fieldset>
        <legend>可同时选择多个选项</legend>
        <label v-for="(option, i) in question.options" :key="i" class="combined-option">
          <input v-model="selected" type="checkbox" :value="option.label" />{{ option.label }}
        </label>
      </fieldset>
      <label class="field"><span>你的想法（可选）</span>
        <textarea ref="customInput" v-model="customText" rows="3" placeholder="写一个自己的答案，或说明选项如何组合。" aria-label="自定义回答" />
      </label>
      <button class="primary" type="submit" :disabled="!answer">提交回答<AppIcon name="arrow" /></button>
    </form>
    <p class="input-hint">也可以直接在下方对话框回答。</p>
  </div>
</template>

<style scoped>
.question { border-color: #a9baa1; }
.asking { color: var(--accent-text); font-size: 13px; }
.question-text { margin: 8px 0 14px; white-space: pre-wrap; overflow-wrap: anywhere; }
.option { display: flex; flex-direction: column; align-items: flex-start; width: 100%; margin-bottom: 8px; text-align: left; }
.option .muted { font-size: 11px; }
.custom-option { background: #eef3e8; border-style: dashed; }
.custom-option > span:first-child { display: flex; align-items: center; gap: 8px; }
.custom-answer { border-top: 1px solid var(--border); padding-top: 15px; margin-top: 14px; }
fieldset { border: none; margin: 0 0 14px; padding: 0; display: flex; flex-wrap: wrap; gap: 8px 14px; }
legend { font-size: 12px; color: var(--text-dim); padding: 0; margin-bottom: 9px; }
.combined-option { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; cursor: pointer; min-height: 32px; }
.combined-option input { width: 16px; height: 16px; }
.input-hint { color: var(--text-dim); font-size: 11px; margin: 12px 0 0; }
</style>
